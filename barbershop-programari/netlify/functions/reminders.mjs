// Rulează automat în fiecare oră; la ora 10:00 (ora României) trimite SMS-ul de reminder
// clienților care au programare MÂINE (logica e în netlify/lib/reminders.mjs).
import { runReminders } from "../lib/reminders.mjs";

export const config = { schedule: "0 * * * *" };

export default async function handler() {
  await runReminders();
  return new Response("ok");
}
