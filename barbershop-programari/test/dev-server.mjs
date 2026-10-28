// Server local de test (fără Netlify): MOCK_STORE=1 ADMIN_PASSWORD=test node test/dev-server.mjs
// Pagina clienților: http://localhost:8888  ·  Admin: http://localhost:8888/admin (parola: test)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import handler from "../netlify/functions/api.mjs";
import { nowLocal, addDays, dow } from "../netlify/lib/core.mjs";

const PUB = new URL("../public/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".css": "text/css", ".js": "text/javascript", ".webmanifest": "application/manifest+json" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const body = req.method === "POST" ? await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); }) : undefined;
    const r = await handler(new Request("http://localhost" + req.url, { method: req.method, headers: req.headers, body }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(await r.text());
  }
  let p = url.pathname === "/" ? "/index.html" : url.pathname === "/admin" ? "/admin.html" : url.pathname.startsWith("/a/") ? "/anulare.html" : url.pathname;
  try {
    const f = await readFile(join(PUB, p));
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(f);
  } catch { res.writeHead(404); res.end("404"); }
});

// câteva programări demo
async function seed() {
  let d = nowLocal().date;
  if (dow(d) === 0) d = addDays(d, 1);
  const call = (path, body) => handler(new Request("http://localhost/api/" + path, { method: "POST", headers: { authorization: "Bearer " + process.env.ADMIN_PASSWORD, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const demo = [["andi", "09:00", "tuns-barbati", "Mihai Ionescu", "0722111222"], ["andi", "10:00", "pachet-exclusiv", "George Stan", "0733222333"],
    ["radu", "09:30", "tuns-barba", "Vlad Marin", "0744333444"], ["radu", "12:00", "tuns-copii", "Matei (copil)", "0755444555"],
    ["lazarescu", "11:00", "tuns-clasic", "Cristi Pop", "0766555666"], ["ionita", "14:00", "aranjat-barba", "Dan Rusu", "0777666777"],
    ["ionita", "15:00", "tuns-barbati", "Alex Toma", "0788777888"], ["andi", "16:00", "tuns-barba", "Sorin Dinu", ""]];
  for (const [barber, time, serviceId, name, phone] of demo) await call("admin/book", { date: d, barber, time, serviceId, name, phone, force: true });
  await call("admin/block", { from: d, barber: "lazarescu", start: "13:00", end: "14:00", reason: "Pauză de masă" });
}
await seed();
server.listen(8888, () => console.log("http://localhost:8888"));
