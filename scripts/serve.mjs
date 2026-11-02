// 手元の画面を配る小さなサーバー。127.0.0.1 だけで待ち受ける（ほかの機械からは見えない）。
// 動かし方: npm run serve（スマホは adb reverse tcp:8080 tcp:8080 で見る）
// 手元だけの口（公開のサイトには無い）：
//   GET  /api/ping   手元の画面かどうか
//   POST /api/areas  複数の町・字を「まとまり」として保存する（site/data/areas.json に書く）
//   GET  /api/review 確かめる一覧（引用した元の文も入る。手元だけ）
//   POST /api/review/{番号}  決める（ok・fix・reject・unknown・undo、理由1行）
//   POST /api/sites  はじめて使うサイトを、町ごとに1回決める（scope・host・ok か reject・理由1行）
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import * as ledger from "./ledger.mjs";
import { research, researchTown, RUN_LIMIT_USD } from "./research.mjs";

// 町をまとめて調べる（調べる画面から）。一度に1つだけ。様子はメモリに持ち、終わったら local/runs/ に残す
const runs = new Map();
let activeRun = null;

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

// 町を調べる（API の鍵を使うので、鍵が読めるときだけ。npm run serve:research で .env を読んで動かす）
async function startResearch(req, res) {
  if (!process.env.ANTHROPIC_API_KEY) return send(res, 400, { error: "調べるには npm run serve:research で動かしてください（.env の鍵を読む）" });
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const { code, question } = JSON.parse(body || "{}");
    if (!/^\d{5}$/.test(code ?? "")) return send(res, 400, { error: "市区町村コードが正しくありません" });
    if (!ledger.can("owner", "request", `muni:${code}`)) return send(res, 403, { error: "この範囲を調べる権限がありません" });
    const r = await research(code, question ? String(question).slice(0, 200) : undefined, { log: () => {} });
    send(res, 200, { id: r.item.id, status: r.item.status, value: r.item.value, why: r.item.why, usd: r.usd, steps: r.steps.map((s) => s.text) });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}

async function startRun(req, res) {
  if (!process.env.ANTHROPIC_API_KEY) return send(res, 400, { error: "調べるには npm run serve:research で動かしてください（.env の鍵を読む）" });
  if (activeRun && runs.get(activeRun)?.status === "running") return send(res, 409, { error: "ほかの町を調べている最中です", runId: activeRun });
  let body = "";
  for await (const chunk of req) body += chunk;
  const { code, part } = JSON.parse(body || "{}");
  if (!/^\d{5}$/.test(code ?? "")) return send(res, 400, { error: "市区町村コードが正しくありません" });
  if (part != null && !/^\d{4}$/.test(part)) return send(res, 400, { error: "町・字の番号が正しくありません" });
  if (!ledger.can("owner", "request", `muni:${code}`)) return send(res, 403, { error: "この範囲を調べる権限がありません" });
  const id = `run-${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}-${code}${part ? `-${part}` : ""}`;
  const run = { id, code, part, startedAt: new Date().toISOString(), status: "running", usd: 0, limit: RUN_LIMIT_USD, log: [], items: [], stopRequested: false };
  runs.set(id, run);
  activeRun = id;
  send(res, 200, run);
  researchTown(code, {
    part,
    log: (text) => run.log.push({ at: new Date().toISOString(), text: text.replace(/^\d\d:\d\d:\d\d /, "") }),
    onItem: (q, it, total) => { run.usd = total; run.items.push({ qid: q.id, id: it.id, status: it.status, value: it.value, why: it.why }); },
    shouldStop: () => run.stopRequested,
  }).then((total) => {
    run.usd = total;
    run.status = run.stopRequested ? "stopped" : "done";
  }).catch((e) => {
    run.status = "failed";
    run.log.push({ at: new Date().toISOString(), text: `止まりました：${e.message}` });
  }).finally(() => {
    run.endedAt = new Date().toISOString();
    fs.mkdirSync("local/runs", { recursive: true });
    fs.writeFileSync(`local/runs/${id}.summary.json`, JSON.stringify(run, null, 1));
  });
}

// はじめて使うサイトを、町ごとに1回決める（そのサイトの確かめ待ちの答えに、まとめて効く）
async function decideSiteReq(req, res) {
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const { scope, host, action, reason } = JSON.parse(body || "{}");
    send(res, 200, ledger.decideSite(scope, host, action, { user: "owner", reason: String(reason ?? "").slice(0, 200) }));
  } catch (e) {
    send(res, e.status ?? 400, { error: e.message });
  }
}

async function decideItem(req, res, id) {
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const { action, reason } = JSON.parse(body || "{}");
    const it = ledger.decide(id, action, { user: "owner", reason: String(reason ?? "").slice(0, 200) });
    send(res, 200, it);
    // 「直して」：指摘を添えて、その問いだけを Claude に調べ直させる（新しい答えは確かめる一覧へ）
    if (action === "fix" && process.env.ANTHROPIC_API_KEY && it.kind === "answer") {
      const code = it.scope.match(/(\d{5})/)?.[1];
      research(code, it.question, { log: () => {}, qid: it.qid, hint: reason, redoOf: it.id })
        .catch((e) => console.error(`${it.id} の調べ直しができませんでした：${e.message}`));
    }
  } catch (e) {
    send(res, e.status ?? 400, { error: e.message });
  }
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/ping") return send(res, 200, { local: true });
    if (url.pathname === "/api/areas" && req.method === "POST") return saveArea(req, res);
    if (url.pathname === "/api/review" && req.method === "GET") { const d = ledger.load(); return send(res, 200, { ...d, items: d.items.map((it) => ({ ...it, score: ledger.scoreOf(it) })) }); }
    if (url.pathname === "/api/research" && req.method === "POST") return startResearch(req, res);
    if (url.pathname === "/api/runs" && req.method === "POST") return startRun(req, res);
    // いま調べている町（日本地図で点滅させる）
    if (url.pathname === "/api/runs" && req.method === "GET") return send(res, 200, { running: [...runs.values()].filter((x) => x.status === "running").map((x) => ({ id: x.id, code: x.code, usd: x.usd })) });
    const r = url.pathname.match(/^\/api\/runs\/([\w-]+)(\/stop)?$/);
    if (r && req.method === "GET") return runs.has(r[1]) ? send(res, 200, runs.get(r[1])) : send(res, 404, { error: "見つかりません" });
    if (r && r[2] && req.method === "POST") {
      const run = runs.get(r[1]);
      if (!run) return send(res, 404, { error: "見つかりません" });
      run.stopRequested = true;
      run.log.push({ at: new Date().toISOString(), text: "止めるように頼みました（いま調べている問いが終わったら止まります）" });
      return send(res, 200, run);
    }
    if (url.pathname === "/api/sites" && req.method === "POST") return decideSiteReq(req, res);
    const m = url.pathname.match(/^\/api\/review\/(r\d{5})$/);
    if (m && req.method === "POST") return decideItem(req, res, m[1]);
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) return res.writeHead(404).end("not found");
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`http://127.0.0.1:${PORT}/`));
