// Stocare: Netlify Blobs (în producție) sau memorie (pentru teste locale, MOCK_STORE=1).
// Fiecare zi are un singur document: zi/AAAA-LL-ZZ -> { bookings: [], blocks: [] }
// Scrierile pe zile sunt condiționate (etag), ca doi clienți să nu poată lua aceeași oră.

let memory = null;

function memoryStore() {
  const data = new Map();
  let n = 0;
  return {
    async get(key) {
      const v = data.get(key);
      return v ? { data: JSON.parse(v.json), etag: v.etag } : { data: null, etag: null };
    },
    async put(key, value, etag) {
      const cur = data.get(key);
      if (etag ? !cur || cur.etag !== etag : !!cur) return false;
      data.set(key, { json: JSON.stringify(value), etag: "e" + ++n });
      return true;
    },
    async set(key, value) {
      data.set(key, { json: JSON.stringify(value), etag: "e" + ++n });
    },
    async del(key) {
      data.delete(key);
    },
  };
}

export async function getDb() {
  if (process.env.MOCK_STORE) return (memory ??= memoryStore());
  const { getStore } = await import("@netlify/blobs");
  const s = getStore({ name: "programari", consistency: "strong" });
  return {
    async get(key) {
      const r = await s.getWithMetadata(key, { type: "json" });
      return r ? { data: r.data, etag: r.etag ?? null } : { data: null, etag: null };
    },
    async put(key, value, etag) {
      const r = await s.setJSON(key, value, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
      return !(r && r.modified === false);
    },
    async set(key, value) {
      await s.setJSON(key, value);
    },
    async del(key) {
      await s.delete(key);
    },
  };
}

// Citește-modifică-scrie cu reîncercare dacă altcineva a scris între timp.
export async function mutate(db, key, init, fn) {
  for (let i = 0; i < 8; i++) {
    const { data, etag } = await db.get(key);
    const doc = data ?? init();
    const result = await fn(doc);
    if (await db.put(key, doc, etag)) return result;
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 120));
  }
  throw new HttpError(409, "Sistemul e ocupat, mai încearcă o dată.");
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
