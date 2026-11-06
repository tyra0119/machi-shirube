// 確かめたものから学ぶ（作者「確かめるを行った際、都度学習し、今後の判断に生かせるように学習できるようになってほしい。それこそAIを使っている意味がでてくるところ」11/7）。
// 作者が確かめる一覧で決めるたびに、Claude がその1件から「次からこう判断する・こう書く」という短い決まり（学んだこと）を1つ書く。同じことをもう覚えていれば足さない。
//   judge：AI が確かめ待ちを判断するときの決まり（scripts/ai-judge.mjs が読む）
//   write：Claude が町を調べて答えを書くときの決まり（scripts/research.mjs が読む。確かめ待ちになる答えそのものを減らす）
// 学んだことは local/ledger/lessons.json（手元だけ）。確かめる一覧の「学んだこと」で作者が見て、合わないものは止められる
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { record, spent, japanDay, DAILY_LIMIT_USD, TOTAL_LIMIT_USD } from "../src/cost.mjs";

const FILE = "local/ledger/lessons.json";
const MODEL = "claude-sonnet-5-5";
const WORD = { ok: "OK（このまま出す）", fix: "直して", reject: "出さない", unknown: "分からない（町の人に聞く）" };

export function loadLessons() {
  return fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { lessons: [] };
}
function saveLessons(d) {
  fs.mkdirSync("local/ledger", { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(d, null, 1));
}

// 確かめ待ちの種類（学んだことを、似た確かめ待ちにだけ使うため）
export function topicOf(it) {
  const w = String(it.why ?? "");
  if (it.kind === "translation") return "訳";
  if (it.kind === "watch") return "見張り";
  if (it.kind && it.kind !== "answer") return it.kind;
  if (/見つからなかった/.test(w)) return "見つからなかった";
  if (/元の文/.test(w)) return "元の文";
  if (/確かめ役/.test(w)) return "確かめ役";
  if (/古い/.test(w)) return "古いデータ";
  if (/数が合わない|食い違い/.test(w)) return "数の食い違い";
  if (/はじめて使う/.test(w)) return "はじめてのサイト";
  return "そのほか";
}

// 使う学んだこと：for（judge / write）と種類が合うもの、止めていないもの。新しいほうから
export function lessonsFor({ use, topic = null, max = 12 } = {}) {
  // 多くの確かめに当てはまったもの（count）から。同じなら新しいほう
  return loadLessons().lessons.filter((l) => l.status !== "off" && l.for === use && (!topic || !l.topic || l.topic === topic || l.topic === "すべて"))
    .map((l, i) => ({ l, i })).sort((a, b) => (b.l.count ?? 1) - (a.l.count ?? 1) || b.i - a.i).slice(0, max).map((x) => x.l.text);
}

const fence = (s) => String(s ?? "").replace(/<\/?(item|decision|lessons|lesson)\b[^>]*>/g, "");
const between = (s, tag) => s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];

// 1件の決め方から学ぶ。作者が決めたとき（手元のサーバーが）呼ぶ
export async function learnFrom(it, decision, { log = () => {} } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (spent(japanDay(new Date().toISOString())) >= DAILY_LIMIT_USD || spent() >= TOTAL_LIMIT_USD) return null;
  if (!WORD[decision.action]) return null;
  const d = loadLessons();
  const topic = topicOf(it);
  const near = d.lessons.filter((l) => l.status !== "off" && (!l.topic || l.topic === topic || l.topic === "すべて"));
  const aiBefore = (it.decisions ?? []).filter((x) => x.by === "ai").at(-1);
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL, max_tokens: 800, output_config: { effort: "low" },
    system: `あなたは、町の公式の情報を住民に伝えるサイト「まちしるべ」で、作者（人）が確かめた結果から学ぶ係です。
作者が1件の確かめ待ちをどう決めたかを見て、次から似た確かめ待ちで同じように決められるよう、短い決まりを1つ書きます。
- judge：確かめ待ちを判断するときの決まり（例：「ファイル名の 202011 から令和2年11月と読むのは言いかえの範囲で OK」）
- write：Claude が町の公式のページを調べて答えを書くときの決まり（例：「ページに無い数や窓口を、ほかのページから足して言い切らない。足すときは出典を分ける」）
町の名前や問いの番号だけに当てはまる決まりではなく、ほかの町でも使える言い方にします。1件だけから言い切れないこと・決まりにならないことは書きません（none）。
すでにある決まりと同じことなら、その番号を same に入れます（新しく足さない）。
<lesson>{"use": "judge|write|none", "text": "決まり（60字ほど。やさしい日本語）", "same": "同じ決まりの番号か null"}</lesson> の形だけで答えます。`,
    messages: [{ role: "user", content: `<item>
種類：${topic}
問い：${fence(it.question)}
答え：${fence(String(it.value ?? "").slice(0, 600))}
出典：${it.source?.url ?? it.watchUrl ?? "（無い）"}
気になった所：${fence(String(it.why ?? "").slice(0, 400))}
</item>
<decision>作者：${WORD[decision.action]}${decision.reason ? `（理由：${fence(decision.reason)}）` : ""}${aiBefore ? `\nその前に AI は「${WORD[aiBefore.action] ?? aiBefore.action}」と決めていた（${fence(aiBefore.reason)}）。作者はそれを決め直した` : ""}</decision>
<lessons>
${near.map((l) => `${l.id}（${l.for}）：${fence(l.text)}`).join("\n") || "（まだ無い）"}
</lessons>` }],
  });
  record(MODEL, res.usage, `確かめたものから学ぶ：${it.scopeName ?? it.scope} ${it.qid ?? it.kind ?? ""}`);
  let r;
  try { r = JSON.parse(between(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""), "lesson") ?? "null"); } catch { r = null; }
  if (!r || r.use === "none" || !r.text) { log(`学んだこと：なし（${it.id}）`); return null; }
  const at = new Date().toISOString();
  const same = r.same && d.lessons.find((l) => l.id === r.same);
  if (same) { same.from = [...new Set([...(same.from ?? []), it.id])]; same.count = (same.count ?? 1) + 1; same.lastAt = at; saveLessons(d); log(`学んだこと：${same.id} と同じ（${same.count} 回目）`); return same; }
  const l = { id: `L${String(d.lessons.length + 1).padStart(3, "0")}`, for: r.use === "write" ? "write" : "judge", topic, text: String(r.text).slice(0, 120), from: [it.id], count: 1, at, status: "on", how: aiBefore ? "AI の判断を作者が決め直したところから" : "作者が決めたところから" };
  d.lessons.push(l);
  saveLessons(d);
  log(`学んだこと：${l.id}（${l.for}）${l.text}`);
  return l;
}

// これまでの作者の決め方から、まとめて学ぶ（最初の1回。種類ごとに読ませる）
export async function learnPast(items, { log = console.log } = {}) {
  const owned = items.filter((x) => (x.decisions ?? []).some((d) => d.by === "owner" && WORD[d.action]));
  const groups = {};
  for (const x of owned) (groups[topicOf(x)] ??= []).push(x);
  const d = loadLessons();
  const client = new Anthropic();
  for (const [topic, xs] of Object.entries(groups)) {
    if (xs.length < 3) continue;
    const lines = xs.slice(-80).map((x) => { const dd = x.decisions.filter((y) => y.by === "owner" && WORD[y.action]).at(-1); return `- 問い：${fence(String(x.question).slice(0, 60))}／気になった所：${fence(String(x.why ?? "").slice(0, 140))}／作者：${WORD[dd.action]}${dd.reason ? `（${fence(dd.reason)}）` : ""}`; });
    const res = await client.messages.create({
      model: MODEL, max_tokens: 2000, output_config: { effort: "medium" },
      system: `あなたは、町の公式の情報を住民に伝えるサイト「まちしるべ」で、作者（人）が確かめた結果から学ぶ係です。
作者がこれまでに「${topic}」の確かめ待ちをどう決めてきたかの一覧から、次から同じように決められる決まりを、多くて 6 つ書きます。
- judge：確かめ待ちを判断するときの決まり
- write：Claude が町の公式のページを調べて答えを書くときの決まり（作者が直して・出さないにした理由から、そもそも同じことが起きないように）
作者の決め方に何度も出てくることだけを決まりにします。町の名前や問いの番号だけに当てはまることは書きません。
<lessons>[{"use": "judge|write", "text": "決まり（60字ほど。やさしい日本語）", "basis": "一覧の中で何件がこの決まりに合うか（数）"}]</lessons> の形だけで答えます。`,
      messages: [{ role: "user", content: lines.join("\n") }],
    });
    const usd = record(MODEL, res.usage, `確かめたものからまとめて学ぶ：${topic}`);
    let arr = [];
    try { arr = JSON.parse(between(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""), "lessons") ?? "[]"); } catch { arr = []; }
    for (const r of arr.filter((x) => x?.text && (x.use === "judge" || x.use === "write"))) {
      const l = { id: `L${String(d.lessons.length + 1).padStart(3, "0")}`, for: r.use, topic, text: String(r.text).slice(0, 120), from: [], count: Number(r.basis) || xs.length, at: new Date().toISOString(), status: "on", how: `これまでの作者の決め方（${topic} ${xs.length} 件）から` };
      d.lessons.push(l);
      log(`${l.id}（${l.for}・${topic}）${l.text}`);
    }
    log(`${topic}：${xs.length} 件から ${arr.length} つ（$${usd.toFixed(3)}）`);
  }
  saveLessons(d);
  return d.lessons;
}

// 作者が止める・戻す
export function setLesson(id, status) {
  const d = loadLessons();
  const l = d.lessons.find((x) => x.id === id);
  if (!l) throw Object.assign(new Error("見つかりません"), { status: 404 });
  l.status = status === "off" ? "off" : "on";
  l.changedAt = new Date().toISOString();
  saveLessons(d);
  return l;
}

if (process.argv[1]?.endsWith("lessons.mjs") && process.argv[2] === "--past") {
  const ledger = await import("./ledger.mjs");
  await learnPast(ledger.load().items);
}
