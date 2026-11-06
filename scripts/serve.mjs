// 手元の画面を配る小さなサーバー。127.0.0.1 だけで待ち受ける（ほかの機械からは見えない）。
// 動かし方: npm run serve（スマホは adb reverse tcp:8080 tcp:8080 で見る）
// 手元だけの口（公開のサイトには無い）：
//   GET  /api/ping   手元の画面かどうか
//   POST /api/areas  複数の町・字を「まとまり」として保存する（site/data/areas.json に書く）
//   GET  /api/review 確かめる一覧（引用した元の文も入る。手元だけ）
//   POST /api/review/{番号}  決める（ok・fix・reject・unknown・undo、理由1行）
//   GET/POST /api/publish  公開に送る（GET は送る前の中身、POST で点検・確かめ・コミット・push）
//   POST /api/sites  はじめて使うサイトを、町ごとに1回決める（scope・host・ok か reject・理由1行）
//   POST /api/runs   町を調べ始める（ほかの町を調べている最中なら予約。202 と何番目かを返す）／ GET /api/runs  いま調べている町と予約の列
//   POST /api/queue/{予約の番号}/cancel  予約を取り消す
//   GET  /api/unfinished  調べの途中の町（まだ調べていない問い・前に見つからなかった問いの数）
//   GET  /api/history?code=&part=  その町の前の調べの記録（回ごとの作業の流れ）
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import * as ledger from "./ledger.mjs";
import { research, researchTown, townProgress, RUN_LIMIT_USD } from "./research.mjs";
import { backupLedger } from "./backup-ledger.mjs";
import { propose, decideProposal, loadProposals, requestToQuestion } from "./propose.mjs";
import { buildOverlays } from "./overlays.mjs";
import { mitate } from "./mitate.mjs";
import { hitokoto } from "./hitokoto.mjs";
import { dekiru } from "./dekiru.mjs";
import { mitateAsk } from "./mitate-ask.mjs";
import { preview, publish } from "./publish.mjs";
import { spent, japanDay, DAILY_LIMIT_USD, TOTAL_LIMIT_USD } from "../src/cost.mjs";

// 費用の上限（1日・合計）に届いているか。届いていたら調べを始めない（作者「まとめて続きを調べるを押しても反応しなくなった」11/6：
// 1日の上限 $80 を超えたあと、押した4町が何もせずに 0.1 秒で終わり、画面には何も出なかった）
function capNow() {
  const today = spent(japanDay(new Date().toISOString())), total = spent();
  const why = today >= DAILY_LIMIT_USD ? `今日の費用が 1 日の上限に届いています（$${today.toFixed(2)} ／ $${DAILY_LIMIT_USD}）。日本時間の 0 時から、また調べられます（上限は .env の DAILY_LIMIT_USD で変えられます）`
    : total >= TOTAL_LIMIT_USD ? `費用の合計が上限に届いています（$${total.toFixed(2)} ／ $${TOTAL_LIMIT_USD}）。上限は .env の TOTAL_LIMIT_USD で変えられます` : null;
  return { today, daily: DAILY_LIMIT_USD, total, totalLimit: TOTAL_LIMIT_USD, over: !!why, why };
}

// 町をまとめて調べる（調べる画面から）。一度に1つだけ。様子はメモリに持ち、終わったら local/runs/ に残す
const runs = new Map();
let activeRun = null;
// 予約（作者「どこかの町を調べている最中に別の町で調べるを押した場合、予約できるようにして。予約した町は、調査中の町が終わったら自動実行するようにしてほしい」）。
// 調べている最中に「調べ始める」を押すと、ここに並べる。いまの調べが終わったら（止めた・止まったときも）、先頭から1つずつ始める。手元のサーバーを止めると消える
const queue = [];
const isBusy = () => activeRun && runs.get(activeRun)?.status === "running";

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
  ".webmanifest": "application/manifest+json",
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
  const cap = capNow();
  if (cap.over) return send(res, 409, { error: cap.why, cap });
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

// 「こういう情報も探して」：頼みごとを問いに直して物差しに足し（合わなければ理由を返す）、そのまま調べる
async function startRequest(req, res) {
  if (!process.env.ANTHROPIC_API_KEY) return send(res, 400, { error: "調べるには npm run serve:research で動かしてください（.env の鍵を読む）" });
  const cap = capNow();
  if (cap.over) return send(res, 409, { error: cap.why, cap });
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const { code, part, text } = JSON.parse(body || "{}");
    if (!/^\d{5}$/.test(code ?? "")) return send(res, 400, { error: "市区町村コードが正しくありません" });
    if (part != null && !/^\d{4}$/.test(part)) return send(res, 400, { error: "町・字の番号が正しくありません" });
    if (!ledger.can("owner", "request", `muni:${code}`)) return send(res, 403, { error: "この範囲を頼む権限がありません" });
    const r = await requestToQuestion(code, String(text ?? "").slice(0, 200), { part });
    if (!r.ok) return send(res, 200, { ok: false, reason: r.reason, usd: r.usd });
    const yq = JSON.parse(fs.readFileSync("site/data/yardstick.json", "utf8")).questions.find((q) => q.id === r.qid);
    const a = await research(code, yq.text, { log: () => {}, qid: yq.id, part });
    send(res, 200, { ok: true, qid: yq.id, question: yq.text, same: r.same ?? null, id: a.item.id, status: a.item.status, value: a.item.value, why: a.item.why, usd: r.usd + a.usd, steps: a.steps.map((s) => s.text) });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}

async function startRun(req, res) {
  if (!process.env.ANTHROPIC_API_KEY) return send(res, 400, { error: "調べるには npm run serve:research で動かしてください（.env の鍵を読む）" });
  const cap = capNow();
  if (cap.over) return send(res, 409, { error: cap.why, cap });
  let body = "";
  for await (const chunk of req) body += chunk;
  const { code, part, qids: rawQids, redo } = JSON.parse(body || "{}");
  // 1問だけ調べ直す（作者「あるカード（例えばQ76）だけを再度調べることはできる？」）：qids に問いの番号、redo: true
  const qids = Array.isArray(rawQids) && rawQids.length ? rawQids.slice(0, 10).map(String) : null;
  if (qids && !qids.every((x) => /^[QT]\d+$/.test(x))) return send(res, 400, { error: "問いの番号が正しくありません" });
  if (!/^\d{5}$/.test(code ?? "")) return send(res, 400, { error: "市区町村コードが正しくありません" });
  if (part != null && !/^\d{4}$/.test(part)) return send(res, 400, { error: "町・字の番号が正しくありません" });
  if (!ledger.can("owner", "request", `muni:${code}`)) return send(res, 403, { error: "この範囲を調べる権限がありません" });
  const same = (x) => x.code === code && (x.part ?? null) === (part ?? null);
  const sameQ = (x) => same(x) && String(x.qids ?? "") === String(qids ?? "");
  if (isBusy()) {
    const cur = runs.get(activeRun);
    if (same(cur)) return send(res, 409, { error: "この町は、いま調べている最中です", runId: activeRun });
    let q = queue.find(sameQ);
    if (!q) { q = { id: `q-${Date.now()}-${code}${part ? `-${part}` : ""}`, code, part: part ?? null, qids, redo: !!redo, at: new Date().toISOString() }; queue.push(q); }
    return send(res, 202, { queued: true, id: q.id, position: queue.indexOf(q) + 1, current: { code: cur.code, part: cur.part ?? null } });
  }
  send(res, 200, launch(code, part, { qids, redo: !!redo }));
}

// 予約の先頭を始める（いまの調べが終わったあと）
function next() {
  if (isBusy() || !queue.length) return;
  if (capNow().over) { console.log(`費用の上限に届いたので、予約の ${queue.length} 町は始めずに残します`); return; }
  const q = queue.shift();
  const run = launch(q.code, q.part ?? undefined, { qids: q.qids, redo: q.redo });
  run.log.unshift({ at: run.startedAt, text: "予約していた町を、前の町の調べが終わったので始めました" });
}

function launch(code, part, { qids = null, redo = false } = {}) {
  const id = `run-${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}-${code}${part ? `-${part}` : ""}`;
  const run = { id, code, part, startedAt: new Date().toISOString(), status: "running", usd: 0, limit: RUN_LIMIT_USD, log: [], items: [], stopRequested: false, qids };
  runs.set(id, run);
  activeRun = id;
  // 続きの調べ（調べる前から、この町・字に答えがある）では、町全体の仕上げ（見立て・ひとこと・つなぎ・提案）をしない
  // （作者「A,E」11/7：1 町の費用を抑える。数問の続きでも毎回作り直し、「数から、できることへ」の確かめ待ちも毎回増えていた）
  const scope = part ? `town:${code}-${part}` : `muni:${code}`;
  const again = ledger.load().items.some((x) => x.scope === scope && x.kind === "answer");
  const finish = !qids && !again;
  // 国のデータを重ねる計算（PC だけ・無料）を、Claude の調べと並べて動かす。町・字のときは市区町村の分がもうあれば何もしない
  const overlays = buildOverlays(code, (text) => run.log.push({ at: new Date().toISOString(), text })).catch(() => {});
  researchTown(code, {
    part, qids: qids ?? undefined, redo,
    log: (text) => run.log.push({ at: new Date().toISOString(), text: text.replace(/^\d\d:\d\d:\d\d /, "") }),
    onItem: (q, it, total) => { run.usd = total; run.items.push({ qid: q.id, id: it.id, status: it.status, value: it.value, why: it.why }); },
    shouldStop: () => run.stopRequested,
  }).then(async (total) => {
    run.usd = total;
    await overlays;
    // 重ねた数がそろったら、Claude が「この町で届きにくい人」を見立てる（市区町村の調べのとき）
    // 1問だけ調べ直したときは、町全体の見立て・ひとこと・提案はしない（費用をかけない）
    if (qids) run.log.push({ at: new Date().toISOString(), text: `${qids.join("・")} だけを調べたので、町全体の見立て・ひとこと・提案はしません` });
    else if (again) run.log.push({ at: new Date().toISOString(), text: "続きの調べなので、町全体の見立て・ひとこと・つなぎ・提案は作り直しません（はじめて調べたときに作ってある）" });
    if (finish && !part && !run.stopRequested) {
      run.log.push({ at: new Date().toISOString(), text: "国のデータを重ねた数から、Claude が「この町で届きにくい人」を見立てています" });
      await mitate(code, (text) => run.log.push({ at: new Date().toISOString(), text }))
        .then((r) => { run.usd += r.usd; })
        .catch((e) => run.log.push({ at: new Date().toISOString(), text: `見立ては出せませんでした：${e.message}` }));
      // 見立てた人ごとに、その人の壁を越える町の支援の問いを結ぶ（新しい問いは、次に調べるときに調べる）
      run.log.push({ at: new Date().toISOString(), text: "見立てた人ごとに、Claude が町の支援を調べる問いを結んでいます" });
      await mitateAsk(code, (text) => run.log.push({ at: new Date().toISOString(), text }))
        .then((r) => { run.usd += r.usd; })
        .catch((e) => run.log.push({ at: new Date().toISOString(), text: `見立てから問いを結べませんでした：${e.message}` }));
      run.log.push({ at: new Date().toISOString(), text: "町・字ごとの数から、Claude が「わが町のひとこと」をまとめています" });
      await hitokoto(code, (text) => run.log.push({ at: new Date().toISOString(), text }))
        .then((r) => { run.usd += r.usd; })
        .catch((e) => run.log.push({ at: new Date().toISOString(), text: `ひとことは出せませんでした：${e.message}` }));
      run.log.push({ at: new Date().toISOString(), text: "町の数と、確かめ済みの町の案内を、Claude がつないでいます（数から、できることへ。人が確かめてから出す）" });
      await dekiru(code, (text) => run.log.push({ at: new Date().toISOString(), text }))
        .then((r) => { run.usd += r.usd; })
        .catch((e) => run.log.push({ at: new Date().toISOString(), text: `数から、できることへは出せませんでした：${e.message}` }));
    }
    // 調べ終わったら、Claude のほうから提案する（物差しにない問い・スキルにするか）。
    // 物差しを止めているあいだ（yardstick.json の frozen。作者「今はしないで止める」）は提案しない
    const frozen = JSON.parse(fs.readFileSync("site/data/yardstick.json", "utf8")).frozen;
    if (finish && frozen && !run.stopRequested && total > 0) run.log.push({ at: new Date().toISOString(), text: "物差しを止めているので、調べ終わりの提案はしません" });
    if (finish && !frozen && !run.stopRequested && total > 0) {
      run.log.push({ at: new Date().toISOString(), text: "調べ終わりました。Claude が答えの全体を見て、提案を考えています" });
      await propose(code, { part, log: (text) => run.log.push({ at: new Date().toISOString(), text }) })
        .then((r) => { run.usd += r.usd; run.proposals = r.proposals.length; })
        .catch((e) => run.log.push({ at: new Date().toISOString(), text: `提案は出せませんでした：${e.message}` }));
    }
    run.status = run.stopRequested ? "stopped" : "done";
  }).catch((e) => {
    run.status = "failed";
    run.log.push({ at: new Date().toISOString(), text: `止まりました：${e.message}` });
  }).finally(() => {
    run.endedAt = new Date().toISOString();
    fs.mkdirSync("local/runs", { recursive: true });
    fs.writeFileSync(`local/runs/${id}.summary.json`, JSON.stringify(run, null, 1));
    next();
  });
  return run;
}

async function revokeCardReq(req, res, id) {
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const { reason } = JSON.parse(body || "{}");
    send(res, 200, ledger.revokeCard(id, { user: "owner", reason: String(reason ?? "").slice(0, 200) }));
  } catch (e) {
    send(res, e.status ?? 400, { error: e.message });
  }
}

async function decideProposalReq(req, res, id) {
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const { action } = JSON.parse(body || "{}");
    send(res, 200, decideProposal(id, action));
  } catch (e) {
    send(res, e.status ?? 400, { error: e.message });
  }
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
    // 見張りが見つけた切れ（kind: watch）も、「直して」で調べ直す（新しいページを探す）
    if (action === "fix" && process.env.ANTHROPIC_API_KEY && (it.kind === "answer" || it.kind === "watch")) {
      const code = it.scope.match(/(\d{5})/)?.[1];
      const part = it.scope.startsWith("town:") ? it.scope.slice(-4) : undefined;
      // 指摘には、作者の理由に加えて、見張りが見つけたこと（ページが消えた・中身が変わった）も渡す
      const hint = [it.kind === "watch" ? it.why : "", reason].filter(Boolean).join(" ／ ");
      research(code, it.question, { log: () => {}, qid: it.qid, hint, redoOf: it.redoOf ?? it.id, part })
        .catch((e) => console.error(`${it.id} の調べ直しができませんでした：${e.message}`));
    }
  } catch (e) {
    send(res, e.status ?? 400, { error: e.message });
  }
}

// 調べる画面の見込み：これまでの調べの記録（local/runs/）の、近い 30 件の中ほどの値（問い1つの費用と時間）
function estimate() {
  const dir = "local/runs";
  if (!fs.existsSync(dir)) return null;
  const runs = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().slice(-30).map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")))
    .filter((r) => r.steps?.length > 1).map((r) => ({ usd: r.usd, min: (Date.parse(r.steps.at(-1).at) - Date.parse(r.steps[0].at)) / 60000 }));
  if (runs.length < 5) return null;
  const mid = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return { usd: Math.round(mid(runs.map((r) => r.usd)) * 100) / 100, min: Math.max(1, Math.round(mid(runs.map((r) => r.min)))), n: runs.length };
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    // 画面の点検のページ（scripts/check-page.html）。公開のサイト（site/）には入れない
    if (url.pathname === "/check") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync("scripts/check-page.html")); }
    if (url.pathname === "/api/ping") return send(res, 200, { local: true, estimate: estimate(), runLimit: RUN_LIMIT_USD });
    if (url.pathname === "/api/areas" && req.method === "POST") return saveArea(req, res);
    if (url.pathname === "/api/review" && req.method === "GET") { const d = ledger.load(); return send(res, 200, { ...d, items: d.items.map((it) => ({ ...it, score: ledger.scoreOf(it) })) }); }
    if (url.pathname === "/api/research" && req.method === "POST") return startResearch(req, res);
    if (url.pathname === "/api/requests" && req.method === "POST") return startRequest(req, res);
    if (url.pathname === "/api/runs" && req.method === "POST") return startRun(req, res);
    // いま調べている町（日本地図で点滅させる）
    if (url.pathname === "/api/runs" && req.method === "GET") return send(res, 200, { running: [...runs.values()].filter((x) => x.status === "running").map((x) => ({ id: x.id, code: x.code, part: x.part ?? null, qids: x.qids ?? null, usd: x.usd })), queue });
    // 調べの途中の町（作者「調査が終わってない町の一覧がほしい。そこから調査を再開できるようにしたい」）：
    // 一度でも調べた町（町・字）のうち、まだ調べていない問いか、前に見つからなかった問いが残っている所。日本地図の作る側の帯に出す
    if (url.pathname === "/api/unfinished" && req.method === "GET") {
      const scopes = [...new Set(ledger.load().items.filter((x) => x.kind === "answer" && /^(muni:\d{5}|town:\d{5}-\d{4})$/.test(x.scope)).map((x) => x.scope))];
      const list = scopes.map((s) => {
        const [code, part] = s.replace(/^(muni|town):/, "").split("-");
        const p = townProgress(code, { part });
        const r = [...runs.values()].find((x) => x.status === "running" && x.code === code && (x.part ?? null) === (part ?? null));
        const q = queue.findIndex((x) => x.code === code && (x.part ?? null) === (part ?? null));
        // 調べ中のカード（作者「調べ中のカードは、もっと分かりやすくしてほしい」）：いまの作業・費用・始めた時刻
        const run = r && { id: r.id, usd: r.usd, limit: r.limit, startedAt: r.startedAt, now: r.log.at(-1)?.text ?? "", answers: r.items?.length ?? 0 };
        return { code, part: part ?? null, ...p, running: !!r, run, queued: q >= 0 ? q + 1 : null, queueId: q >= 0 ? queue[q].id : null };
      }).filter((x) => x.never + x.retry > 0 || x.running || x.queued)
        .sort((a, b) => (b.running - a.running) || ((a.queued ?? 1e9) - (b.queued ?? 1e9)));
      // 何回探して見つからなければ調べ終わりにするか（research.mjs の GIVE_UP_TRIES）。それより少ない問いだけが「続き」に数えられる
      return send(res, 200, { list, limit: RUN_LIMIT_USD, cap: capNow() });
    }
    // 前の調べの記録（作者「作業ログについて、過去の分も表示することはできない？」11/6）：その町の local/runs/ から。
    // 画面から調べた回は、回ごとの作業の流れ（*.summary.json）。画面を作る前やコマンドから調べた分は、問いごとの記録（*.json）を日ごとにまとめる
    if (url.pathname === "/api/history" && req.method === "GET") {
      const code = url.searchParams.get("code"), part = url.searchParams.get("part");
      if (!/^\d{5}$/.test(code ?? "") || (part && !/^\d{4}$/.test(part))) return send(res, 400, { error: "町のコードが正しくありません" });
      const key = part ? `${code}-${part}` : code;
      const dir = "local/runs";
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => new RegExp(`^run-\\d{14}-${key}(\\.summary)?\\.json$`).test(f)).sort() : [];
      const read = (f) => { try { return JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")); } catch { return null; } };
      const list = files.filter((f) => f.endsWith(".summary.json")).map(read).filter(Boolean).map((r) => ({
        kind: "run", id: r.id, startedAt: r.startedAt, endedAt: r.endedAt, status: r.status, usd: r.usd ?? 0, answers: r.items?.length ?? 0, log: r.log ?? [] }));
      // いま調べている回の問いの記録は、その回が終わるまで出さない
      const live = [...runs.values()].filter((x) => x.status === "running" && x.code === code && (x.part ?? null) === (part ?? null)).map((x) => x.startedAt);
      const inRun = (at) => list.some((r) => at >= r.startedAt && at <= (r.endedAt ?? r.startedAt)) || live.some((s) => at >= s);
      const days = new Map();
      for (const f of files.filter((f) => !f.endsWith(".summary.json"))) {
        const q = read(f);
        const at = q?.steps?.[0]?.at;
        if (!at || inRun(at)) continue;
        const day = new Date(at).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
        const d = days.get(day) ?? { kind: "cli", id: `cli-${day}`, startedAt: at, endedAt: at, usd: 0, questions: 0, log: [] };
        d.usd += q.usd ?? 0; d.questions += 1; d.log.push(...q.steps);
        const last = q.steps.at(-1)?.at ?? at;
        if (last > d.endedAt) d.endedAt = last;
        days.set(day, d);
      }
      const all = [...list, ...days.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
      return send(res, 200, { list: all });
    }
    // 予約を取り消す
    const qm =url.pathname.match(/^\/api\/queue\/([\w-]+)\/cancel$/);
    if (qm && req.method === "POST") {
      const i = queue.findIndex((x) => x.id === qm[1]);
      if (i < 0) return send(res, 404, { error: "予約が見つかりません" });
      queue.splice(i, 1);
      return send(res, 200, { queue });
    }
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
    // 情報源カード：一覧と、カードごとの取り消し（そのサイトの答えを全部下げる）
    if (url.pathname === "/api/cards" && req.method === "GET") return send(res, 200, ledger.loadCards());
    const cm = url.pathname.match(/^\/api\/cards\/(c\d{4})\/revoke$/);
    if (cm && req.method === "POST") return revokeCardReq(req, res, cm[1]);
    // Claude からの提案：その町の、まだ決めていないもの。決める（town・all・later・skill）
    if (url.pathname === "/api/proposals" && req.method === "GET") {
      const code = url.searchParams.get("code") ?? "";
      return send(res, 200, { proposals: loadProposals().proposals.filter((p) => p.status === "open" && (!code || p.scope.includes(code))) });
    }
    const pm = url.pathname.match(/^\/api\/proposals\/(p\d{4})$/);
    if (pm && req.method === "POST") return decideProposalReq(req, res, pm[1]);
    // 公開に送る（確かめる一覧のボタン）：GET は送る前に見せる中身、POST で点検・確かめ・コミット・push（scripts/publish.mjs）
    if (url.pathname === "/api/publish" && req.method === "GET") { try { return send(res, 200, preview()); } catch (e) { return send(res, 500, { error: e.message }); } }
    if (url.pathname === "/api/publish" && req.method === "POST") return publish().then((r) => send(res, 200, r));
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

// 承認の台帳の控え：始めたときと、6時間ごとに作品のフォルダの外へ写す（scripts/backup-ledger.mjs）
const backupNow = () => { try { backupLedger(); } catch (e) { console.error(`台帳の控えを写せませんでした：${e.message}`); } };
backupNow();
setInterval(backupNow, 6 * 60 * 60 * 1000);
