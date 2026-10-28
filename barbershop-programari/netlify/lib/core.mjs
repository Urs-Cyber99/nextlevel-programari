import { HttpError, mutate } from "./store.mjs";
import { sendSms } from "./sms.mjs";

export const TZ = "Europe/Bucharest";

// Prețuri pe frizer, din intervalul de pe listă: Andi = minim, Lazarescu = mijloc, Radu și Ionita = maxim
const tiers = (min, max) => {
  const mid = Math.round((min + max) / 2 / 5) * 5;
  return { andi: min, lazarescu: mid, radu: max, ionita: max };
};

export const DEFAULT_SETTINGS = {
  salonName: "Next Level",
  tagline: "Barbershop",
  address: "Str. Culturii nr. 5 (lângă Ofertis)",
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Next+Level+Barbershop+Strada+Culturii+5",
  phone: "0763 140 341",
  instagram: "NextLevelBarbershop",
  open: "09:00",
  close: "18:00",
  days: [1, 2, 3, 4, 5, 6], // 0 = duminică ... 6 = sâmbătă
  slotStep: 10, // minute între orele afișate
  minLeadMinutes: 60, // nu se poate programa cu mai puțin de 1h înainte
  maxDaysAhead: 30,
  cancelHours: 2, // clientul poate anula online până cu 2h înainte
  maxUpcomingPerPhone: 3,
  // days = zilele în care lucrează frizerul (subset al zilelor salonului)
  barbers: [
    { id: "andi", name: "Andi", phone: "", notify: false, active: true, days: [1, 2, 3, 4, 5, 6] },
    { id: "radu", name: "Radu", phone: "", notify: false, active: true, days: [1, 2, 3, 4, 5, 6] },
    { id: "lazarescu", name: "Lazarescu", phone: "", notify: false, active: true, days: [1, 2, 3, 4, 5, 6] },
    { id: "ionita", name: "Ionita", phone: "", notify: false, active: true, days: [1, 2, 3, 4, 5, 6] },
  ],
  // duration = cât blochează în calendar; prices = prețul exact la fiecare frizer
  // (price / priceMax se recalculează automat ca interval min–max dintre frizeri)
  services: [
    { id: "tuns-barbati", name: "Tuns bărbați", desc: "Tuns pentru domni", duration: 40, price: 50, priceMax: 100, prices: tiers(50, 100), active: true },
    { id: "tuns-barba", name: "Tuns și aranjat barbă", desc: "Tuns, scurtat barba și contur", duration: 60, price: 70, priceMax: 110, prices: tiers(70, 110), active: true },
    { id: "pachet-exclusiv", name: "Pachet Exclusiv", desc: "Tuns, aranjat barbă, contur, spălat, styling", duration: 60, price: 80, priceMax: 150, prices: tiers(80, 150), active: true },
    { id: "tuns-clasic", name: "Tuns Clasic", desc: "Nr. 1 laterale", duration: 30, price: 40, priceMax: 60, prices: tiers(40, 60), active: true },
    { id: "aranjat-barba", name: "Aranjat barbă", desc: "Tuns barba și contur", duration: 20, price: 20, priceMax: 40, prices: tiers(20, 40), active: true },
    { id: "tuns-copii", name: "Tuns copii", desc: "Doar pentru copii sub 14 ani", duration: 30, price: 40, priceMax: 60, prices: tiers(40, 60), active: true },
    { id: "spalat-par", name: "Spălat păr", desc: "Spălat păr și scalp", duration: 10, price: 20, priceMax: 20, prices: tiers(20, 20), active: true },
  ],
  smsConfirm: true,
  smsReminder: true,
  smsConfirmText: "{salon}: programarea ta e confirmata pe {zi}, ora {ora}, cu {frizer}. Anulare: {link}",
  smsReminderText: "Salut {nume}! Maine, {zi}, la ora {ora}, te asteptam la {salon} ({frizer}). Nu mai poti? Anuleaza: {link}",
  smsBarberText: "Programare noua: {nume} {telefon}, {zi} ora {ora}, {serviciu}",
};

/* ---------- timp (ora României) ---------- */

export function nowLocal() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}
export const addDays = (date, n) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const dow = (date) => new Date(date + "T12:00:00Z").getUTCDay();
export const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
export const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T12:00:00Z"));
export const isTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const ZILE = ["dum", "lun", "mar", "mie", "joi", "vin", "sam"];
export const prettyDay = (date) => `${ZILE[dow(date)]} ${date.slice(8, 10)}.${date.slice(5, 7)}`;

/* ---------- validări ---------- */

export function normPhone(raw) {
  let p = String(raw || "").replace(/[^\d+]/g, "");
  if (p.startsWith("+40")) p = "0" + p.slice(3);
  else if (p.startsWith("0040")) p = "0" + p.slice(4);
  else if (p.startsWith("40") && p.length === 11) p = "0" + p.slice(2);
  return /^07\d{8}$/.test(p) ? p : null;
}
export const cleanText = (s, max = 60) => String(s || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
export const newId = (len = 10) => {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
};

/* ---------- setări ---------- */

export async function loadSettings(db) {
  const { data } = await db.get("settings");
  const s = { ...DEFAULT_SETTINGS, ...(data || {}) };
  if (!Array.isArray(s.barbers) || !s.barbers.length) s.barbers = DEFAULT_SETTINGS.barbers;
  if (!Array.isArray(s.services) || !s.services.length) s.services = DEFAULT_SETTINGS.services;
  s.services = s.services.map((x) => withRange(s, x));
  return s;
}

/** Prețul serviciului la un anumit frizer (dacă nu are preț propriu, prețul de bază). */
export function priceFor(svc, barberId) {
  const p = svc.prices?.[barberId];
  return Number.isFinite(+p) && p !== "" && p !== null ? +p : svc.price;
}

/** Recalculează intervalul min–max al serviciului din prețurile frizerilor activi. */
export function withRange(s, svc) {
  const active = s.barbers.filter((b) => b.active);
  const vals = active.map((b) => priceFor(svc, b.id)).filter((n) => Number.isFinite(n));
  if (!vals.length) return { ...svc, priceMax: svc.priceMax || svc.price };
  return { ...svc, price: Math.min(...vals), priceMax: Math.max(...vals) };
}

export function publicSettings(s) {
  return {
    salonName: s.salonName, tagline: s.tagline, address: s.address, mapsUrl: s.mapsUrl,
    phone: s.phone, instagram: s.instagram, open: s.open, close: s.close, days: s.days,
    maxDaysAhead: s.maxDaysAhead, cancelHours: s.cancelHours,
    barbers: s.barbers.filter((b) => b.active).map(({ id, name, days }) => ({ id, name, days: barberDays(s, { days }) })),
    services: s.services.filter((x) => x.active).map((x) => ({
      id: x.id, name: x.name, desc: x.desc || "", duration: x.duration, price: x.price, priceMax: x.priceMax || x.price,
      prices: Object.fromEntries(s.barbers.filter((b) => b.active).map((b) => [b.id, priceFor(x, b.id)])),
    })),
  };
}

/* ---------- disponibilitate ---------- */

export const barberDays = (s, b) => (Array.isArray(b.days) && b.days.length ? b.days : s.days).filter((d) => s.days.includes(d));
export const worksOn = (s, b, date) => barberDays(s, b).includes(dow(date));

export const emptyDay = () => ({ bookings: [], blocks: [] });
export const dayKey = (date) => `zi/${date}`;
export const occupies = (b) => b.status !== "cancelled";

function busyIntervals(day, barberId) {
  const out = [];
  for (const b of day.bookings) if (b.barber === barberId && occupies(b)) out.push([toMin(b.start), toMin(b.end)]);
  for (const k of day.blocks) if (k.barber === barberId || k.barber === "all") out.push([toMin(k.start), toMin(k.end)]);
  return out;
}

export function isFree(day, barberId, start, end) {
  return busyIntervals(day, barberId).every(([a, b]) => end <= a || start >= b);
}

/** Orele libere pentru o zi: [{ time: "09:15", barbers: ["florin", "alex"] }] */
export function freeSlots(s, day, date, duration, barberFilter) {
  const now = nowLocal();
  if (!s.days.includes(dow(date))) return [];
  if (date < now.date || date > addDays(now.date, s.maxDaysAhead)) return [];
  const open = toMin(s.open), close = toMin(s.close);
  const minStart = date === now.date ? now.min + s.minLeadMinutes : 0;
  const barbers = s.barbers.filter((b) => b.active && worksOn(s, b, date) && (barberFilter === "any" || !barberFilter || b.id === barberFilter));
  const slots = [];
  for (let t = open; t + duration <= close; t += s.slotStep) {
    if (t < minStart) continue;
    const free = barbers.filter((b) => isFree(day, b.id, t, t + duration)).map((b) => b.id);
    if (free.length) slots.push({ time: fromMin(t), barbers: free });
  }
  return slots;
}

/* ---------- clienți ---------- */

export async function touchClient(db, phone, fn) {
  if (!phone) return;
  await mutate(db, "clienti", () => ({}), (all) => {
    const c = (all[phone] ??= { name: "", visits: 0, noshows: 0, cancels: 0, upcoming: [], blocked: false, note: "", first: nowLocal().date });
    fn(c);
  });
}

export const pruneUpcoming = (c) => {
  const today = nowLocal().date;
  c.upcoming = (c.upcoming || []).filter((u) => u.split("|")[0] >= today);
};

/* ---------- SMS ---------- */

export function fillTemplate(tpl, s, b) {
  const barber = s.barbers.find((x) => x.id === b.barber);
  const link = `${process.env.URL || ""}/a/${b.token}`;
  const map = {
    nume: (b.name || "").split(" ")[0], salon: s.salonName, zi: prettyDay(b.date), ora: b.start,
    frizer: barber ? barber.name : b.barber, serviciu: b.serviceName, link, telefon: b.phone || "",
  };
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
}

export async function smsBooking(s, b, kind) {
  if (!b.phone) return { ok: false, error: "fără telefon" };
  const tpl = kind === "reminder" ? s.smsReminderText : s.smsConfirmText;
  return sendSms(b.phone, fillTemplate(tpl, s, b));
}

export async function notifyBarber(s, b) {
  const barber = s.barbers.find((x) => x.id === b.barber);
  if (!barber || !barber.notify) return;
  const phone = normPhone(barber.phone);
  if (phone) await sendSms(phone, fillTemplate(s.smsBarberText, s, b)).catch(() => {});
}

export { HttpError };
