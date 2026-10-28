// Trimitere SMS prin SMSLink.ro (SMS Gateway, HTTP POST).
// Variabile de mediu necesare în Netlify: SMSLINK_CONNECTION_ID, SMSLINK_PASSWORD

const ENDPOINT = "https://secure.smslink.ro/sms/gateway/communicate/index.php";

// Fără diacritice: un SMS cu diacritice are doar 70 de caractere în loc de 160 (costă dublu).
export function toGsm(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-̧̦ͯ]/g, "")
    .replace(/[„”“]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-");
}

export const smsConfigured = () => !!(process.env.SMSLINK_CONNECTION_ID && process.env.SMSLINK_PASSWORD);

export async function sendSms(to, message) {
  const text = toGsm(message);
  if (process.env.MOCK_STORE) {
    (globalThis.__sentSms ??= []).push({ to, text });
    return { ok: true, mock: true };
  }
  if (!smsConfigured()) {
    console.warn("SMS neconfigurat - lipsesc SMSLINK_CONNECTION_ID / SMSLINK_PASSWORD");
    return { ok: false, error: "SMS neconfigurat" };
  }
  try {
    const body = new URLSearchParams({
      connection_id: process.env.SMSLINK_CONNECTION_ID,
      password: process.env.SMSLINK_PASSWORD,
      to,
      message: text,
    });
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const raw = (await res.text()).trim();
    // Răspuns SMSLink: "MESSAGE;1;<id>;..." la succes, "ERROR;<cod>;<descriere>" la eroare
    const ok = raw.startsWith("MESSAGE");
    if (!ok) console.error("SMSLink a refuzat:", raw);
    return { ok, raw };
  } catch (e) {
    console.error("Eroare SMS:", e);
    return { ok: false, error: String(e) };
  }
}
