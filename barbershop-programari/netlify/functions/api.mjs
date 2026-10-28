import { getDb, mutate, HttpError } from "../lib/store.mjs";
import {
  loadSettings, publicSettings, freeSlots, isFree, emptyDay, dayKey, occupies,
  nowLocal, addDays, dow, toMin, fromMin, isDate, isTime, normPhone, cleanText, newId,
  touchClient, pruneUpcoming, worksOn, smsBooking, notifyBarber, fillTemplate, DEFAULT_SETTINGS,
} from "../lib/core.mjs";
import { sendSms, smsConfigured } from "../lib/sms.mjs";

export const config = { path: "/api/*" };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
    const method = req.method.toUpperCase();
    const q = Object.fromEntries(url.searchParams);
    const body = method === "POST" ? await req.json().catch(() => ({})) : {};
    const db = await getDb();
    const s = await loadSettings(db);

    if (path.startsWith("admin/")) {
      checkAdmin(req);
      return json(await adminRoute(path.slice(6), method, q, body, db, s));
    }

    switch (`${method} ${path}`) {
      case "GET settings":
        return json(publicSettings(s));
      case "GET days":
        return json(await daysOverview(db, s, q));
      case "GET slots": {
        if (!isDate(q.date)) throw new HttpError(400, "Dată invalidă");
        const svc = findService(s, q.service);
        const { data } = await db.get(dayKey(q.date));
        return json({ date: q.date, slots: freeSlots(s, data || emptyDay(), q.date, svc.duration, q.barber || "any") });
      }
      case "POST book":
        return json(await createBooking(db, s, body, false));
      case "GET booking":
        return json(await getByToken(db, s, q.t));
      case "POST cancel":
        return json(await cancelByToken(db, s, body.t));
      default:
        throw new HttpError(404, "Nu există");
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Eroare de server. Încearcă din nou." }, 500);
  }
}

/* ---------------- public ---------------- */

function findService(s, id, admin = false) {
  const svc = s.services.find((x) => x.id === id && (x.active || admin));
  if (!svc) throw new HttpError(400, "Alege un serviciu");
  return svc;
}

async function daysOverview(db, s, q) {
  const svc = findService(s, q.service);
  const today = nowLocal().date;
  const dates = Array.from({ length: s.maxDaysAhead + 1 }, (_, i) => addDays(today, i)).filter((d) => s.days.includes(dow(d)));
  const docs = await Promise.all(dates.map((d) => db.get(dayKey(d))));
  return {
    days: dates.map((d, i) => ({
      date: d,
      free: freeSlots(s, docs[i].data || emptyDay(), d, svc.duration, q.barber || "any").length,
    })),
  };
}

async function createBooking(db, s, input, admin) {
  const svc = findService(s, input.serviceId, admin);
  const date = input.date, time = input.time;
  if (!isDate(date) || !isTime(time)) throw new HttpError(400, "Alege ziua și ora");
  const duration = admin && +input.duration > 0 ? Math.min(+input.duration, 600) : svc.duration;
  const name = cleanText(input.name, 50);
  const phone = normPhone(input.phone);
  const start = toMin(time), end = start + duration;
  const now = nowLocal();

  if (!admin) {
    if (input.website) throw new HttpError(400, "Cerere invalidă"); // capcană pentru roboți
    if (name.length < 2) throw new HttpError(400, "Scrie-ți numele");
    if (!phone) throw new HttpError(400, "Număr de telefon invalid (ex: 07xx xxx xxx)");
    if (!input.consent) throw new HttpError(400, "Bifează acordul pentru folosirea datelor");
    if (!s.days.includes(dow(date))) throw new HttpError(400, "Salonul e închis în ziua aleasă");
    if (date < now.date || date > addDays(now.date, s.maxDaysAhead)) throw new HttpError(400, "Ziua nu e disponibilă");
    if (start < toMin(s.open) || end > toMin(s.close) || (start - toMin(s.open)) % s.slotStep) throw new HttpError(400, "Ora nu e disponibilă");
    if (date === now.date && start < now.min + s.minLeadMinutes) throw new HttpError(400, "Ora e prea apropiată, alege alta");
    const { data: clients } = await db.get("clienti");
    const c = clients?.[phone];
    if (c?.blocked) throw new HttpError(403, "Programarea online nu e disponibilă pentru acest număr. Te rugăm să ne suni.");
    if (c) {
      pruneUpcoming(c);
      if (c.upcoming.length >= s.maxUpcomingPerPhone) throw new HttpError(409, "Ai deja mai multe programări active. Anulează una sau sună-ne.");
    }
  } else {
    if (!name) throw new HttpError(400, "Scrie numele clientului");
    if (input.phone && !phone) throw new HttpError(400, "Număr de telefon invalid");
  }

  const id = newId(8), token = newId(10);
  const tomorrow = addDays(now.date, 1);
  const booking = await mutate(db, dayKey(date), emptyDay, (day) => {
    let barber = input.barber;
    const active = s.barbers.filter((b) => admin || (b.active && worksOn(s, b, date)));
    if (!barber || barber === "any") {
      const free = active.filter((b) => isFree(day, b.id, start, end));
      if (!free.length) throw new HttpError(409, "Ora tocmai a fost ocupată. Alege alta.");
      const load = (bid) => day.bookings.filter((x) => x.barber === bid && occupies(x)).length;
      barber = free.sort((a, b) => load(a.id) - load(b.id))[0].id;
    } else {
      if (!active.some((b) => b.id === barber)) throw new HttpError(400, "Frizerul ales nu lucrează în ziua asta");
      if (!(admin && input.force) && !isFree(day, barber, start, end))
        throw new HttpError(409, admin ? "Intervalul se suprapune cu altă programare sau pauză." : "Ora tocmai a fost ocupată. Alege alta.");
    }
    if (!admin && day.bookings.some((x) => x.phone === phone && occupies(x)))
      throw new HttpError(409, "Ai deja o programare în ziua asta.");
    const b = {
      id, token, date, barber, start: time, end: fromMin(end),
      serviceId: svc.id, serviceName: svc.name, price: svc.price, priceMax: svc.priceMax || svc.price, duration,
      name, phone: phone || "", note: cleanText(input.note, 200),
      status: "confirmed", source: admin ? "salon" : "online",
      createdAt: new Date().toISOString(),
      reminderSent: date <= now.date || (date === tomorrow && now.min >= 600),
    };
    day.bookings.push(b);
    return b;
  });

  await db.set(`token/${token}`, { date, id });
  await touchClient(db, phone, (c) => {
    if (name) c.name = name;
    pruneUpcoming(c);
    c.upcoming.push(`${date}|${id}`);
  });

  let sms = null;
  if (phone && s.smsConfirm && (!admin || input.sendSms)) sms = (await smsBooking(s, booking, "confirm")).ok;
  if (!admin) await notifyBarber(s, booking);

  return { booking: publicBooking(s, booking), sms };
}

function publicBooking(s, b) {
  const barber = s.barbers.find((x) => x.id === b.barber);
  return {
    date: b.date, start: b.start, end: b.end, barber: b.barber, barberName: barber?.name || b.barber,
    serviceName: b.serviceName, price: b.price, priceMax: b.priceMax || b.price, name: b.name, status: b.status, token: b.token,
  };
}

async function findByToken(db, t) {
  if (!t || !/^[a-z0-9]{6,20}$/.test(t)) throw new HttpError(404, "Programarea nu a fost găsită");
  const { data: ref } = await db.get(`token/${t}`);
  if (!ref) throw new HttpError(404, "Programarea nu a fost găsită");
  return ref;
}

async function getByToken(db, s, t) {
  const ref = await findByToken(db, t);
  const { data: day } = await db.get(dayKey(ref.date));
  const b = day?.bookings.find((x) => x.id === ref.id);
  if (!b) throw new HttpError(404, "Programarea nu a fost găsită");
  return { booking: publicBooking(s, b), canCancel: canClientCancel(s, b), salon: publicSettings(s) };
}

function canClientCancel(s, b) {
  if (b.status !== "confirmed") return false;
  const now = nowLocal();
  if (b.date < now.date) return false;
  if (b.date === now.date && toMin(b.start) - now.min < s.cancelHours * 60) return false;
  return true;
}

async function cancelByToken(db, s, t) {
  const ref = await findByToken(db, t);
  const b = await mutate(db, dayKey(ref.date), emptyDay, (day) => {
    const b = day.bookings.find((x) => x.id === ref.id);
    if (!b) throw new HttpError(404, "Programarea nu a fost găsită");
    if (b.status === "cancelled") throw new HttpError(409, "Programarea e deja anulată");
    if (!canClientCancel(s, b)) throw new HttpError(403, `Anularea online e posibilă până cu ${s.cancelHours} ore înainte. Te rugăm să ne suni.`);
    b.status = "cancelled";
    b.cancelledBy = "client";
    b.cancelledAt = new Date().toISOString();
    return b;
  });
  await touchClient(db, b.phone, (c) => {
    c.cancels++;
    c.upcoming = (c.upcoming || []).filter((u) => u !== `${b.date}|${b.id}`);
  });
  const barber = s.barbers.find((x) => x.id === b.barber);
  const bp = barber?.notify && normPhone(barber.phone);
  if (bp) await sendSms(bp, fillTemplate("ANULARE: {nume} {telefon}, {zi} ora {ora}", s, b)).catch(() => {});
  return { ok: true, booking: publicBooking(s, b) };
}

/* ---------------- admin ---------------- */

function checkAdmin(req) {
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) throw new HttpError(500, "Setează ADMIN_PASSWORD în Netlify (Environment variables).");
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  let diff = got.length ^ pass.length;
  for (let i = 0; i < pass.length; i++) diff |= pass.charCodeAt(i) ^ (got.charCodeAt(i) || 0);
  if (diff) throw new HttpError(401, "Parolă greșită");
}

async function adminRoute(path, method, q, body, db, s) {
  switch (`${method} ${path}`) {
    case "GET check":
      return { ok: true, smsConfigured: smsConfigured(), settings: s, today: nowLocal() };

    case "GET day": {
      if (!isDate(q.date)) throw new HttpError(400, "Dată invalidă");
      const { data } = await db.get(dayKey(q.date));
      return { date: q.date, ...(data || emptyDay()) };
    }

    case "GET range": {
      if (!isDate(q.from) || !isDate(q.to) || q.to < q.from) throw new HttpError(400, "Interval invalid");
      const dates = [];
      for (let d = q.from; d <= q.to && dates.length < 93; d = addDays(d, 1)) dates.push(d);
      const docs = await Promise.all(dates.map((d) => db.get(dayKey(d))));
      return { days: Object.fromEntries(dates.map((d, i) => [d, docs[i].data || emptyDay()])) };
    }

    case "POST book":
      return createBooking(db, s, body, true);

    case "POST status": {
      const allowed = ["confirmed", "done", "noshow", "cancelled"];
      if (!allowed.includes(body.status)) throw new HttpError(400, "Status invalid");
      const { b, old } = await mutate(db, dayKey(body.date), emptyDay, (day) => {
        const b = day.bookings.find((x) => x.id === body.id);
        if (!b) throw new HttpError(404, "Programarea nu există");
        if (body.status === "confirmed" && b.status === "cancelled") {
          const others = { ...day, bookings: day.bookings.filter((x) => x !== b) };
          if (!isFree(others, b.barber, toMin(b.start), toMin(b.end))) throw new HttpError(409, "Intervalul e ocupat între timp");
        }
        const old = b.status;
        b.status = body.status;
        if (body.status === "cancelled") { b.cancelledBy = "salon"; b.cancelledAt = new Date().toISOString(); }
        return { b, old };
      });
      if (old !== b.status) {
        await touchClient(db, b.phone, (c) => {
          const key = `${b.date}|${b.id}`;
          if (old === "done") c.visits = Math.max(0, c.visits - 1);
          if (old === "noshow") c.noshows = Math.max(0, c.noshows - 1);
          if (b.status === "done") { c.visits++; c.last = b.date; }
          if (b.status === "noshow") c.noshows++;
          c.upcoming = (c.upcoming || []).filter((u) => u !== key);
          if (b.status === "confirmed") c.upcoming.push(key);
        });
      }
      return { ok: true, booking: b };
    }

    case "POST edit": {
      // mutare / modificare programare (zi, oră, frizer, serviciu, notă)
      const svc = body.serviceId ? findService(s, body.serviceId, true) : null;
      const { data: src } = await db.get(dayKey(body.date));
      const orig = src?.bookings.find((x) => x.id === body.id);
      if (!orig) throw new HttpError(404, "Programarea nu există");
      const newDate = isDate(body.newDate) ? body.newDate : orig.date;
      const time = isTime(body.time) ? body.time : orig.start;
      const duration = +body.duration > 0 ? +body.duration : svc ? svc.duration : orig.duration;
      const nb = {
        ...orig, date: newDate, start: time, end: fromMin(toMin(time) + duration), duration,
        barber: body.barber || orig.barber,
        ...(svc ? { serviceId: svc.id, serviceName: svc.name, price: svc.price, priceMax: svc.priceMax || svc.price } : {}),
        ...(body.note !== undefined ? { note: cleanText(body.note, 200) } : {}),
        ...(body.name ? { name: cleanText(body.name, 50) } : {}),
        ...(body.phone !== undefined ? { phone: normPhone(body.phone) || "" } : {}),
      };
      if (newDate !== orig.date || time !== orig.start) nb.reminderSent = false;
      const tomorrow = addDays(nowLocal().date, 1);
      if (nb.date <= nowLocal().date || (nb.date === tomorrow && nowLocal().min >= 600)) nb.reminderSent = true;
      await mutate(db, dayKey(newDate), emptyDay, (day) => {
        const rest = day.bookings.filter((x) => x.id !== orig.id);
        if (!body.force && !isFree({ ...day, bookings: rest }, nb.barber, toMin(nb.start), toMin(nb.end)))
          throw new HttpError(409, "Intervalul se suprapune cu altă programare sau pauză.");
        day.bookings = [...rest, nb];
      });
      if (newDate !== orig.date) {
        await mutate(db, dayKey(orig.date), emptyDay, (day) => {
          day.bookings = day.bookings.filter((x) => x.id !== orig.id);
        });
        await db.set(`token/${orig.token}`, { date: newDate, id: orig.id });
        await touchClient(db, nb.phone, (c) => {
          c.upcoming = (c.upcoming || []).filter((u) => u !== `${orig.date}|${orig.id}`);
          if (nb.status === "confirmed") c.upcoming.push(`${newDate}|${nb.id}`);
        });
      }
      let sms = null;
      if (body.sendSms && nb.phone) sms = (await smsBooking(s, nb, "confirm")).ok;
      return { ok: true, booking: nb, sms };
    }

    case "POST block": {
      const from = body.from, to = isDate(body.to) ? body.to : body.from;
      if (!isDate(from) || to < from) throw new HttpError(400, "Dată invalidă");
      if (!isTime(body.start) || !isTime(body.end) || body.end <= body.start) throw new HttpError(400, "Interval orar invalid");
      if (body.barber !== "all" && !s.barbers.some((b) => b.id === body.barber)) throw new HttpError(400, "Frizer invalid");
      const conflicts = [];
      for (let d = from, n = 0; d <= to && n < 62; d = addDays(d, 1), n++) {
        await mutate(db, dayKey(d), emptyDay, (day) => {
          day.blocks.push({ id: newId(6), barber: body.barber, start: body.start, end: body.end, reason: cleanText(body.reason, 60) });
          for (const b of day.bookings)
            if (occupies(b) && b.status === "confirmed" && (body.barber === "all" || b.barber === body.barber) &&
                toMin(b.start) < toMin(body.end) && toMin(b.end) > toMin(body.start))
              conflicts.push(`${d} ${b.start} ${b.name}`);
        });
      }
      return { ok: true, conflicts };
    }

    case "POST unblock":
      await mutate(db, dayKey(body.date), emptyDay, (day) => {
        day.blocks = day.blocks.filter((k) => k.id !== body.id);
      });
      return { ok: true };

    case "GET clients": {
      const { data } = await db.get("clienti");
      return { clients: data || {} };
    }

    case "POST client": {
      const phone = normPhone(body.phone);
      if (!phone) throw new HttpError(400, "Telefon invalid");
      await touchClient(db, phone, (c) => {
        if (body.blocked !== undefined) c.blocked = !!body.blocked;
        if (body.note !== undefined) c.note = cleanText(body.note, 300);
        if (body.name) c.name = cleanText(body.name, 50);
      });
      return { ok: true };
    }

    case "POST settings": {
      const next = sanitizeSettings(body, s);
      await db.set("settings", next);
      return { ok: true, settings: next };
    }

    case "POST sms": {
      const phone = normPhone(body.phone);
      if (!phone) throw new HttpError(400, "Telefon invalid");
      const text = cleanText(body.text, 300) || `Test SMS de la ${s.salonName}. Totul functioneaza!`;
      const r = await sendSms(phone, text);
      if (!r.ok) throw new HttpError(502, `SMS-ul nu a plecat: ${r.error || r.raw}`);
      return { ok: true };
    }

    default:
      throw new HttpError(404, "Nu există");
  }
}

function sanitizeSettings(b, cur) {
  const str = (v, max, def) => (typeof v === "string" ? v.replace(/[<>]/g, "").trim().slice(0, max) : def);
  const slug = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  const out = { ...cur };
  for (const k of ["salonName", "tagline", "address", "mapsUrl", "phone", "instagram"]) out[k] = str(b[k], k === "mapsUrl" ? 400 : 120, cur[k]);
  for (const k of ["smsConfirmText", "smsReminderText", "smsBarberText"]) out[k] = str(b[k], 320, cur[k]) || DEFAULT_SETTINGS[k];
  if (isTime(b.open)) out.open = b.open;
  if (isTime(b.close)) out.close = b.close;
  if (toMin(out.close) <= toMin(out.open)) throw new HttpError(400, "Ora de închidere trebuie să fie după deschidere");
  if (Array.isArray(b.days)) out.days = [...new Set(b.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort();
  const int = (v, lo, hi, def) => (Number.isFinite(+v) && v !== "" && v !== null ? Math.min(hi, Math.max(lo, Math.round(+v))) : def);
  out.slotStep = [5, 10, 15, 20, 30, 60].includes(+b.slotStep) ? +b.slotStep : cur.slotStep;
  out.minLeadMinutes = int(b.minLeadMinutes, 0, 1440, cur.minLeadMinutes);
  out.maxDaysAhead = int(b.maxDaysAhead, 1, 90, cur.maxDaysAhead);
  out.cancelHours = int(b.cancelHours, 0, 72, cur.cancelHours);
  out.maxUpcomingPerPhone = int(b.maxUpcomingPerPhone, 1, 20, cur.maxUpcomingPerPhone);
  out.smsConfirm = b.smsConfirm !== undefined ? !!b.smsConfirm : cur.smsConfirm;
  out.smsReminder = b.smsReminder !== undefined ? !!b.smsReminder : cur.smsReminder;
  if (Array.isArray(b.barbers)) {
    const seen = new Set();
    out.barbers = b.barbers.slice(0, 10).map((x) => {
      const name = str(x.name, 40, "");
      let id = cur.barbers.find((c) => c.id === x.id) ? x.id : slug(name) || newId(5);
      while (seen.has(id)) id += "-2";
      seen.add(id);
      const days = Array.isArray(x.days) ? [...new Set(x.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : out.days;
      return { id, name, phone: normPhone(x.phone) || "", notify: !!x.notify, active: x.active !== false, days };
    }).filter((x) => x.name);
    if (!out.barbers.length) throw new HttpError(400, "Trebuie cel puțin un frizer");
  }
  if (Array.isArray(b.services)) {
    const seen = new Set();
    out.services = b.services.slice(0, 40).map((x) => {
      const name = str(x.name, 60, "");
      let id = cur.services.find((c) => c.id === x.id) ? x.id : slug(name) || newId(5);
      while (seen.has(id)) id += "-2";
      seen.add(id);
      const price = int(x.price, 0, 100000, 0);
      return { id, name, desc: str(x.desc, 120, ""), duration: int(x.duration, 5, 480, 30), price, priceMax: Math.max(price, int(x.priceMax, 0, 100000, price)), active: x.active !== false };
    }).filter((x) => x.name);
    if (!out.services.length) throw new HttpError(400, "Trebuie cel puțin un serviciu");
  }
  return out;
}
