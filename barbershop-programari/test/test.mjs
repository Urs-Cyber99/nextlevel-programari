// Test cap-coadă cu stocare în memorie: npm test
import assert from "node:assert/strict";
import handler from "../netlify/functions/api.mjs";
import { runReminders } from "../netlify/lib/reminders.mjs";
import { nowLocal, addDays, dow } from "../netlify/lib/core.mjs";

process.env.URL = "https://exemplu.netlify.app";
const call = async (method, path, body, admin) => {
  const res = await handler(new Request("https://x" + path, {
    method,
    headers: { "content-type": "application/json", ...(admin ? { authorization: "Bearer test" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));
  return { status: res.status, data: await res.json() };
};

const today = nowLocal().date;
let d = addDays(today, 1);
while (dow(d) === 0) d = addDays(d, 1); // prima zi lucrătoare de mâine încolo
const tomorrow = addDays(today, 1);

let r = await call("GET", "/api/settings");
assert.equal(r.status, 200);
assert.equal(r.data.barbers.length, 4);
console.log("✓ setări publice", r.data.services.map((s) => s.name).join(", "));

r = await call("GET", `/api/slots?date=${d}&service=tuns-barba&barber=andi`);
assert.equal(r.data.slots[0].time, "09:00");
assert.equal(r.data.slots.at(-1).time, "17:00"); // 60 min -> ultima oră 17:00
console.log("✓ ore libere", r.data.slots.length, "pentru Tuns+barbă la Andi");

const book = (extra) => call("POST", "/api/book", { date: d, time: "10:00", serviceId: "tuns-barba", barber: "andi", name: "Ion Popescu", phone: "0722 123 456", consent: true, ...extra });

r = await book();
assert.equal(r.status, 200, JSON.stringify(r.data));
const token = r.data.booking.token;
assert.equal(r.data.booking.price, 70, "Andi = prețul minim");
console.log("✓ programare creată", r.data.booking.start, "-", r.data.booking.end, "SMS:", r.data.sms, "| preț la Andi:", r.data.booking.price);

r = await book({ phone: "0733000111", name: "Vasile" });
assert.equal(r.status, 409);
console.log("✓ dublă rezervare blocată:", r.data.error);

r = await book({ phone: "0733000111", name: "Vasile", time: "10:30" });
assert.equal(r.status, 409, "suprapunere parțială trebuie blocată");
r = await book({ phone: "0733000111", name: "Vasile", time: "11:00" });
assert.equal(r.status, 200);
console.log("✓ suprapunere parțială blocată, ora următoare ok");

r = await book({ phone: "0733000111", name: "Vasile", time: "10:00", barber: "any" });
assert.equal(r.status, 409, "același telefon, aceeași zi");
r = await book({ phone: "0744000222", name: "Mihai", time: "10:00", barber: "any" });
assert.notEqual(r.data.booking.barber, "andi");
const exp = { lazarescu: 90, radu: 110, ionita: 110 }[r.data.booking.barber];
assert.equal(r.data.booking.price, exp);
console.log("✓ «oricine» alege frizerul liber:", r.data.booking.barberName, r.data.booking.price, "lei");

// prețuri pe frizer în setările publice: Andi < Lazarescu < Radu = Ionita
r = await call("GET", "/api/settings");
const tb = r.data.services.find((x) => x.id === "tuns-barbati");
assert.deepEqual(tb.prices, { andi: 50, radu: 100, lazarescu: 75, ionita: 100 });
assert.equal(tb.price, 50); assert.equal(tb.priceMax, 100);
console.log("✓ prețuri pe frizer (Tuns bărbați):", JSON.stringify(tb.prices));

r = await call("GET", `/api/slots?date=${d}&service=tuns-clasic&barber=any`);
assert.ok(r.data.slots.find((s) => s.time === "10:00").barbers.length === 2, "10:00: 2 din 4 frizeri ocupați");

for (const bad of [{ phone: "123" }, { consent: false, phone: "0755000333" }, { time: "18:30", phone: "0755000333" }, { time: "09:05", phone: "0755000333" }, { website: "spam", phone: "0755000333" }]) {
  r = await book({ ...bad, time: bad.time || "15:00" });
  assert.equal(r.status, 400, JSON.stringify(bad));
}
console.log("✓ validări (telefon, acord, oră în afara programului, oră nealiniată, robot)");

let sun = addDays(today, 1);
while (dow(sun) !== 0) sun = addDays(sun, 1);
r = await call("GET", `/api/slots?date=${sun}&service=tuns-clasic`);
assert.equal(r.data.slots.length, 0);
console.log("✓ duminică închis");

r = await call("GET", `/api/booking?t=${token}`);
assert.equal(r.data.canCancel, true);
r = await call("POST", "/api/cancel", { t: token });
assert.equal(r.status, 200);
r = await book({ phone: "0766000444", name: "Andrei" });
assert.equal(r.status, 200, "după anulare, ora 10:00 la Florin e iar liberă");
console.log("✓ anulare prin link + ora eliberată");

// admin
r = await call("GET", "/api/admin/check");
assert.equal(r.status, 401);
r = await call("GET", "/api/admin/check", null, true);
assert.equal(r.status, 200);
r = await call("POST", "/api/admin/block", { from: d, barber: "andi", start: "13:00", end: "14:00", reason: "Pauză masă" }, true);
r = await call("GET", `/api/slots?date=${d}&service=tuns-clasic&barber=andi`);
assert.ok(!r.data.slots.some((s) => s.time === "13:00" || s.time === "12:40"));
console.log("✓ pauză blocată în calendar");

r = await call("POST", "/api/admin/book", { date: d, time: "13:00", serviceId: "tuns-clasic", barber: "andi", name: "Walk-in" }, true);
assert.equal(r.status, 409);
r = await call("POST", "/api/admin/book", { date: d, time: "13:00", serviceId: "tuns-clasic", barber: "andi", name: "Walk-in", force: true }, true);
assert.equal(r.status, 200);
console.log("✓ programare din salon (cu forțare peste pauză)");

r = await call("GET", `/api/admin/day?date=${d}`, null, true);
const andrei = r.data.bookings.find((b) => b.name === "Andrei");
r = await call("POST", "/api/admin/edit", { date: d, id: andrei.id, time: "15:00", barber: "radu" }, true);
assert.equal(r.status, 200);
assert.equal(r.data.booking.price, 110, "mutat la Radu -> prețul lui Radu");
r = await call("POST", "/api/admin/status", { date: d, id: andrei.id, status: "done" }, true);
r = await call("GET", "/api/admin/clients", null, true);
assert.equal(r.data.clients["0766000444"].visits, 1);
console.log("✓ mutare programare + marcat «a venit» + istoric client");

r = await call("POST", "/api/admin/client", { phone: "0777000555", blocked: true }, true);
r = await book({ phone: "0777000555", name: "Rau Platnic", time: "16:00" });
assert.equal(r.status, 403);
console.log("✓ client blocat nu se poate programa online");

r = await call("POST", "/api/admin/settings", { salonName: "Test Barber", services: [{ id: "tuns-clasic", name: "Tuns", duration: 30, price: 55 }, { name: "Ceară nas", duration: 5, price: 10 }] }, true);
assert.equal(r.status, 200);
assert.equal(r.data.settings.services[1].id, "ceara-nas");
console.log("✓ setări salvate (servicii noi)");

r = await call("POST", "/api/admin/settings", { services: [{ id: "tuns-clasic", name: "Tuns", duration: 30, price: 40, prices: { andi: 45, radu: 70, lazarescu: 55, ionita: 70 } }] }, true);
assert.equal(r.status, 200);
assert.equal(r.data.settings.services[0].price, 45);
assert.equal(r.data.settings.services[0].priceMax, 70);
r = await call("POST", "/api/book", { date: d, time: "16:30", serviceId: "tuns-clasic", barber: "lazarescu", name: "Pret Test", phone: "0711222333", consent: true });
assert.equal(r.data.booking.price, 55);
console.log("✓ prețuri schimbate din admin se aplică la programare (Lazarescu 55 lei)");

// zile de lucru pe frizer: Ionita doar vineri-sâmbătă
const cur = (await call("GET", "/api/admin/check", null, true)).data.settings;
await call("POST", "/api/admin/settings", { barbers: cur.barbers.map((b) => b.id === "ionita" ? { ...b, days: [5, 6] } : b) }, true);
let mon = addDays(today, 1); while (dow(mon) !== 1) mon = addDays(mon, 1);
r = await call("GET", `/api/slots?date=${mon}&service=tuns-clasic&barber=ionita`);
assert.equal(r.data.slots.length, 0);
r = await call("POST", "/api/book", { date: mon, time: "10:00", serviceId: "tuns-clasic", barber: "ionita", name: "Test", phone: "0799000999", consent: true });
assert.equal(r.status, 400);
r = await call("GET", "/api/settings");
assert.deepEqual(r.data.barbers.find((b) => b.id === "ionita").days, [5, 6]);
console.log("✓ program separat pe frizer (Ionita doar vin-sâm)");

// reminder: o programare pe mâine
globalThis.__sentSms = [];
if (dow(tomorrow) !== 0) {
  await call("POST", "/api/admin/book", { date: tomorrow, time: "12:00", serviceId: "tuns-clasic", barber: "radu", name: "Radu Ionescu", phone: "0788111222" }, true);
  const res = await runReminders({ force: true });
  const again = await runReminders({ force: true });
  const sent = globalThis.__sentSms.filter((m) => m.to === "0788111222");
  const expect = nowLocal().min >= 600 ? 0 : 1; // după 10:00, programările de mâine nu mai primesc reminder separat
  assert.equal(sent.length, expect);
  console.log("✓ reminder:", res, "| a doua rulare:", again.total, "| SMS:", sent[0]?.text || "(nu, făcută după 10:00 - a primit confirmare)");
}
console.log("\nToate testele au trecut.");
