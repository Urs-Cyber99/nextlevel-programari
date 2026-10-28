// Rulează automat în fiecare oră; la ora 10:00 (ora României) trimite SMS-ul de reminder
// tuturor clienților care au programare MÂINE. Fiecare programare primește un singur reminder.
import { getDb, mutate } from "./store.mjs";
import { loadSettings, nowLocal, addDays, dayKey, emptyDay, smsBooking } from "./core.mjs";

export const REMINDER_HOUR = 10;

export async function runReminders({ force = false } = {}) {
  const now = nowLocal();
  const hour = Math.floor(now.min / 60);
  if (!force && (hour < REMINDER_HOUR || hour >= 21)) return { skipped: true, hour };

  const db = await getDb();
  const s = await loadSettings(db);
  if (!s.smsReminder) return { skipped: true, reason: "reminder dezactivat" };

  const date = addDays(now.date, 1);
  const { data } = await db.get(dayKey(date));
  const todo = (data?.bookings || []).filter((b) => b.status === "confirmed" && !b.reminderSent && b.phone);

  const results = [];
  for (const b of todo) {
    const r = await smsBooking(s, b, "reminder");
    results.push({ id: b.id, ok: r.ok });
    // marchez ca trimis și dacă a eșuat de 3 ori, ca să nu insiste la nesfârșit
    await mutate(db, dayKey(date), emptyDay, (day) => {
      const x = day.bookings.find((y) => y.id === b.id);
      if (!x) return;
      x.reminderTries = (x.reminderTries || 0) + 1;
      if (r.ok || x.reminderTries >= 3) x.reminderSent = true;
      x.reminderOk = r.ok;
    });
  }
  console.log(`Reminder ${date}: ${results.filter((r) => r.ok).length}/${results.length} trimise`);
  return { date, sent: results.filter((r) => r.ok).length, total: results.length };
}
