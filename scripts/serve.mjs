// 手元の画面を配る小さなサーバー。127.0.0.1 だけで待ち受ける（ほかの機械からは見えない）。
// 動かし方: npm run serve（スマホは adb reverse tcp:8080 tcp:8080 で見る）
// 手元だけの口（公開のサイトには無い）：
//   GET  /api/ping   手元の画面かどうか
//   POST /api/areas  複数の町・字を「まとまり」として保存する（site/data/areas.json に書く）
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("site");
const AREAS = path.join(ROOT, "data", "areas.json");
const PORT = Number(process.env.PORT ?? 8080);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};

async function saveArea(req, res) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20000) return send(res, 413, { error: "大きすぎます" });
  }
  let a;
  try { a = JSON.parse(body); } catch { return send(res, 400, { error: "形が正しくありません" }); }
  const name = String(a.name ?? "").trim();
  if (!name || name.length > 30) return send(res, 400, { error: "名前は1〜30文字にしてください" });
  if (!/^\d{5}$/.test(a.muni ?? "")) return send(res, 400, { error: "市区町村コードが正しくありません" });
  if (!Array.isArray(a.parts) || a.parts.length < 2 || a.parts.some((p) => !/^\d{4}$/.test(p))) {
    return send(res, 400, { error: "町・字を2つ以上選んでください" });
  }
  const data = fs.existsSync(AREAS) ? JSON.parse(fs.readFileSync(AREAS, "utf8")) : { areas: [] };
  const n = data.areas.filter((x) => x.muni === a.muni).length + 1;
  const area = {
    id: `${a.muni}-a${n}`,
    name,
    muni: a.muni,
    parts: [...new Set(a.parts)].sort(),
    scope: `muni:${a.muni}`, // 誰が扱えるかのもと（docs/approval-ledger.md の 8 章）
    createdBy: "owner",
    createdAt: new Date().toISOString(),
  };
  data.areas.push(area);
  fs.writeFileSync(AREAS, JSON.stringify(data, null, 1));
  send(res, 200, area);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/ping") return send(res, 200, { local: true });
    if (url.pathname === "/api/areas" && req.method === "POST") return saveArea(req, res);
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) return res.writeHead(404).end("not found");
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`http://127.0.0.1:${PORT}/`));
