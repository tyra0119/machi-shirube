// Claude のほうから言ってくる：町を調べ終わったら、答えの全体を見て
//  ① 物差しにない、この町で大事な問い（最大2つ）を提案する → 人が［この町だけ］［ほかの町にも］［今はしない］を選ぶ
//  ② うまくいった調べ方を「スキル」（次の町でも使える手順）にまとめるか聞く → 人が［スキルにする］［今はしない］を選ぶ
// 手元の PC だけで動く。提案は local/ledger/proposals.json、スキルにしたものは site/data/skills.json（公開してよい：手順と公式のページの種類だけ）
// 動かし方: npm run propose -- 39428 [--part 0130]
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { record, spent, japanDay, DAILY_LIMIT_USD, TOTAL_LIMIT_USD } from "../src/cost.mjs";
import * as ledger from "./ledger.mjs";

const MODEL = "claude-sonnet-5-5";
const FILE = "local/ledger/proposals.json";
const SKILLS = "site/data/skills.json";
const YARD = "site/data/yardstick.json";
export const loadProposals = () => (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { proposals: [] });
const saveProposals = (d) => fs.writeFileSync(FILE, JSON.stringify(d, null, 1));
export const loadSkills = () => (fs.existsSync(SKILLS) ? JSON.parse(fs.readFileSync(SKILLS, "utf8")) : { skills: [] });
const between = (t, tag) => t.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];

export async function propose(code, { part, log = console.log } = {}) {
  if (spent(japanDay(new Date().toISOString())) >= DAILY_LIMIT_USD || spent() >= TOTAL_LIMIT_USD) throw new Error("費用の上限に達しています");
  const scope = part ? `town:${code}-${part}` : `muni:${code}`;
  const stats = JSON.parse(fs.readFileSync("site/data/stats.json", "utf8"));
  const t = stats.towns[code];
  const yard = JSON.parse(fs.readFileSync(YARD, "utf8"));
  const items = ledger.load().items.filter((x) => x.scope === scope && x.kind === "answer" && !["void", "rejected"].includes(x.status));
  if (!items.length) throw new Error("まだ答えがありません（調べたあとに提案します）");
  // 答えに使った公式のページ（スキルの材料）：調査の記録の「読んでいます」から
  const read = {};
  for (const it of items) {
    const f = it.runId && `local/runs/${it.runId}.json`;
    if (!f || !fs.existsSync(f)) continue;
    read[it.qid] = JSON.parse(fs.readFileSync(f, "utf8")).steps.map((s) => s.text).filter((x) => /^(読んでいます|公式のサイトを探しています)/.test(x)).slice(0, 8);
  }
  const facts = {
    町: `${t.pref} ${t.name}`,
    人口: t.population,
    "65歳以上の割合": t.over65Rate, "外国の住民の割合": t.foreignRate, "15歳未満の割合": t.under15Rate, "1年の人口の増減": t.changeRate,
  };
  const client = new Anthropic();
  log("Claude が、答えの全体を見て提案を考えています");
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "medium" },
    system: `あなたは、町の暮らしの情報を集める仕組み「まちしるべ」の相談役です。渡すのは、ある町の数字と、物差し（どの町にも聞く問い）と、Claude が公式のサイトから調べた答えです。
1. この町で、暮らしの情報が届きにくい人（お年寄り・外国の住民・子育て・引っ越してきた人など）のために大事なのに、物差しに無い問いを、多くても2つ提案してください。
   すでにある問いと重ならないこと。公式のサイトで調べられること。うわさや個人のことは問いにしない。
   どの町にも聞くとよいか（all）、この町だけか（town）、決まりつきの町だけか（rule：例「外国の住民の割合が高い町」）も書いてください。
2. 答えに使ったページを見て、次に別の町で同じことを調べるときに役に立つ「調べ方」（どの種類の公式ページを、どの順で見るか）を、スキルとして1つにまとめてください。
   町の名前や個別の URL ではなく、どの町でも使える言い方で。役に立ちそうに無ければ null。
<proposal>{"questions": [{"text": "問い", "short": "短い見出し", "why": "なぜこの町で大事か（数字があれば）", "reach": "all" | "town" | "rule", "rule": "決まり（rule のとき）", "page": "bousai|gomi|iryo|komatta|kosodate|kaigo|koutsuu|tetsuzuki|foreign|okane|shisetsu|shiru"}], "skill": {"name": "スキルの名前", "forQids": ["使える問いの番号"], "steps": ["手順1", "手順2"], "why": "なぜ役に立つか"} または null}</proposal> の形だけで答えてください。`,
    messages: [{ role: "user", content: JSON.stringify({
      町の数字: facts,
      物差し: yard.questions.map((q) => ({ id: q.id, text: q.text })),
      答え: items.map((it) => ({ qid: it.qid, value: it.value, source: it.source?.title, 読んだページ: read[it.qid] ?? [] })),
    }, null, 1) }],
  });
  const usd = record(MODEL, res.usage, `提案を考える：${t.name}`);
  const p = JSON.parse(between(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""), "proposal") ?? "{}");
  const d = loadProposals();
  const at = new Date().toISOString();
  const add = (x) => { const id = `p${String(d.proposals.length + 1).padStart(4, "0")}`; d.proposals.push({ id, scope, scopeName: `${t.pref} ${t.name}`, at, status: "open", ...x }); return id; };
  for (const q of (p.questions ?? []).slice(0, 2)) add({ kind: "question", ...q });
  if (p.skill?.name) add({ kind: "skill", ...p.skill });
  saveProposals(d);
  log(`提案 ${(p.questions ?? []).length}つ・スキル ${p.skill?.name ? 1 : 0}つ（$${usd.toFixed(3)}）`);
  return { proposals: d.proposals.filter((x) => x.at === at), usd };
}

// 人が選ぶ：town（この町だけ）・all（ほかの町にも）・later（今はしない）・skill（スキルにする）
export function decideProposal(id, action) {
  const d = loadProposals();
  const p = d.proposals.find((x) => x.id === id);
  if (!p) throw Object.assign(new Error("見つかりません"), { status: 404 });
  if (p.status !== "open") throw Object.assign(new Error("もう決めてあります"), { status: 400 });
  const at = new Date().toISOString();
  if (p.kind === "question" && (action === "town" || action === "all")) {
    const yard = JSON.parse(fs.readFileSync(YARD, "utf8"));
    const n = Math.max(...yard.questions.filter((q) => /^Q\d+$/.test(q.id)).map((q) => Number(q.id.slice(1)))) + 1;
    const code = p.scope.match(/(\d{5})/)[1];
    const q = { id: `Q${String(n).padStart(2, "0")}`, group: action === "all" ? "Claude の提案から" : "この町だけ", text: p.text, short: p.short, page: p.page ?? "shiru",
      origin: { from: p.scopeName, proposal: p.id, at, why: p.why } };
    if (action === "town") q.only = code;
    if (action === "all" && p.reach === "rule" && p.rule) q.rule = p.rule;
    if (p.scope.startsWith("town:")) q.level = "town";
    yard.questions.push(q);
    yard.version = (yard.version ?? 1) + 1;
    fs.writeFileSync(YARD, JSON.stringify(yard, null, 1));
    p.addedAs = q.id;
  }
  if (p.kind === "skill" && action === "skill") {
    const s = loadSkills();
    const sid = `s${String(s.skills.length + 1).padStart(3, "0")}`;
    s.skills.push({ id: sid, name: p.name, forQids: p.forQids ?? [], steps: p.steps ?? [], why: p.why, from: p.scopeName, at, version: 1 });
    fs.writeFileSync(SKILLS, JSON.stringify(s, null, 1));
    p.addedAs = sid;
  }
  p.status = action;
  p.decidedAt = at;
  saveProposals(d);
  ledger.exportProgress();
  return p;
}

// 「こういう情報も探して」：管理者の頼みごとを、物差しの問いの形に直す。まちしるべの決まりに合わない頼みは、理由を添えて断る。
// 合えば「この町だけ」の問いとして物差しに足す（出どころ＝誰の・いつの頼みか を残す）。頼みの記録は local/ledger/requests.json
const REQUESTS = "local/ledger/requests.json";
export async function requestToQuestion(code, text, { part, user = "owner" } = {}) {
  if (spent(japanDay(new Date().toISOString())) >= DAILY_LIMIT_USD || spent() >= TOTAL_LIMIT_USD) throw new Error("費用の上限に達しています");
  const yard = JSON.parse(fs.readFileSync(YARD, "utf8"));
  const t = JSON.parse(fs.readFileSync("site/data/stats.json", "utf8")).towns[code];
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL, max_tokens: 1500, output_config: { effort: "low" },
    system: `あなたは、町の暮らしの情報を集める仕組み「まちしるべ」の受付です。管理者の頼みごと（こういう情報も探して）を、町の公式のサイトで調べられる「問い」の形に直してください。
決まり：公式の出典（国・県・市区町村のサイト）で調べられること。個人の情報・うわさ・特定の店や人の評判・医療の判断は扱わない。
すでにある問いと同じなら、その番号を same に。合わなければ ok を false にして、理由を短く。
<request>{"ok": true か false, "reason": "合わない理由（ok のときは空）", "same": "同じ問いの番号か null", "text": "問い（町の公式のサイトで答えを探せる形）", "short": "短い見出し", "page": "bousai|gomi|iryo|komatta|kosodate|kaigo|koutsuu|tetsuzuki|foreign|okane|shisetsu|shiru"}</request> の形だけで答えてください。`,
    messages: [{ role: "user", content: JSON.stringify({ 町: `${t.pref} ${t.name}`, 頼みごと: text, すでにある問い: yard.questions.map((q) => ({ id: q.id, text: q.text })) }) }],
  });
  const usd = record(MODEL, res.usage, `頼みごとを問いに直す：${t.name}`);
  const raw = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const body = between(raw, "request") ?? raw.match(/\{[\s\S]*\}/)?.[0];
  let r;
  try { r = JSON.parse(body); } catch { throw new Error(`Claude の答えの形が読めませんでした：${raw.slice(0, 160)}`); }
  const at = new Date().toISOString();
  let qid = r.same ?? null;
  if (r.ok && !r.same) {
    const n = Math.max(...yard.questions.filter((q) => /^Q\d+$/.test(q.id)).map((q) => Number(q.id.slice(1)))) + 1;
    qid = `Q${String(n).padStart(2, "0")}`;
    yard.questions.push({ id: qid, group: "管理者の頼みから", text: r.text, short: r.short, page: r.page ?? "shiru", only: code, ...(part ? { level: "town" } : {}),
      origin: { from: `${t.pref} ${t.name}`, request: text, by: user, at } });
    yard.version = (yard.version ?? 1) + 1;
    fs.writeFileSync(YARD, JSON.stringify(yard, null, 1));
  }
  const log = fs.existsSync(REQUESTS) ? JSON.parse(fs.readFileSync(REQUESTS, "utf8")) : { requests: [] };
  log.requests.push({ at, by: user, scope: part ? `town:${code}-${part}` : `muni:${code}`, text, ok: !!r.ok, reason: r.reason || undefined, qid });
  fs.writeFileSync(REQUESTS, JSON.stringify(log, null, 1));
  return { ...r, qid, usd };
}

// 調べるときの手がかり：その問いに使えるスキルの手順（research.mjs が Claude に渡す）
export function skillHint(qid) {
  const s = loadSkills().skills.filter((x) => x.forQids?.includes(qid));
  return s.length ? s.map((x) => `【${x.name}】${x.steps.join(" → ")}`).join("\n") : null;
}

if (process.argv[1]?.endsWith("propose.mjs")) {
  const args = process.argv.slice(2);
  const pi = args.indexOf("--part");
  const part = pi >= 0 ? args.splice(pi, 2)[1] : undefined;
  const r = await propose(args[0], { part });
  console.log(JSON.stringify(r.proposals, null, 1));
}
