// AI に任せられる確かめ待ちを、AI（Claude）が決める（作者「人間が確かめるものを減らすことはできる？…確実に人間判断がいるものはこれまでどおり人間が判断する」→「全部」11/7）。
// これまで作者が決めた 456 件を種類ごとに数え、ほとんど同じ決め方をしていた種類だけを任せる：
//   確かめ役：資料と合わない（OK 118・直して 11）・元の文がページに無い → 別の Claude（Sonnet）が出典のページを読み直して ok / fix / 人へ
//   訳の確かめ待ち（89 件すべて OK）→ 別の Claude が、もとの日本語・訳・訳し戻しを見て ok / 人へ
//   見つからなかった（OK 51・出さない 77）→ 決まり：出さない（町の人に聞きたいことへ）
//   見張り：ページが消えた・移った（直して 16・OK 5）→ 自動で「直して」（Claude が新しいページを探して調べ直す）
//   はじめて使うサイト（OK 28）→ 国・県・市町村のサイト（lg.jp・go.jp など）だけ自動で OK
// 人のまま：避難にひびくもの（数から、できることへ・防災計画など）・公式どうしの食い違い・古いデータ・公のサイト以外・作者が調べ直しを頼んだ答え・そのほか全部。
// 理由が1つでも「人のまま」の種類なら、その確かめ待ちは人に残す。AI が決めたものは台帳に by: "ai" と理由で残り、確かめる一覧の「決めたもの」で見て元に戻せる。
// 動かし方：npm run ai-judge [-- 町のコード]（手元のサーバーの確かめる一覧からも動かせる）
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import * as ledger from "./ledger.mjs";
import { research, politeText } from "./research.mjs";
import { lessonsFor, topicOf } from "./lessons.mjs";
import { record, spent, japanDay, DAILY_LIMIT_USD, TOTAL_LIMIT_USD } from "../src/cost.mjs";

const MODEL = "claude-sonnet-5-5";
export const NOT_FOUND_ACTION = "reject"; // 見つからなかった答えのふだんの扱い（作者の決め方で多かったほう。11/7）
const OFFICIAL = /(\.lg\.jp|\.go\.jp|^(www\.)?pref\.[a-z-]+\.jp|^(www\.)?(city|town|vill)\.[a-z0-9-]+\.[a-z-]+\.jp)$/;

// 理由の1つずつを、任せられる種類に分ける（null は人のまま）
function kindOf(seg, it) {
  if (/^Claude のメモ/.test(seg)) return "memo";
  const fu = seg.match(/^はじめて使う情報源（(.+?)）/);
  if (fu) return OFFICIAL.test(fu[1]) ? "site-official" : null;
  if (/^公開の資料で答えが見つからなかった/.test(seg)) return "not-found";
  if (/^確かめ役：資料と合わない/.test(seg) || /^Claude が返した元の文が、答えに使ったページの中に見つからなかった/.test(seg)) return it.kind === "answer" || !it.kind ? "judge-answer" : null;
  if (it.kind === "translation" && /^訳し戻すとずれ|^訳し戻し/.test(seg)) return "judge-translation";
  if (it.kind === "watch" && /^見張り：出典のページが(見つからない|移った)|^見張り：ページが移った/.test(seg)) return "watch-gone";
  if (it.kind === "watch" && /食い違い/.test(seg)) return "judge-answer";
  return null; // 避難にひびく・公式どうしの食い違い・古いデータ・作者が調べ直しを頼んだ・そのほか
}

// 確かめ待ち1つの見立て：どの種類か（全部が任せられるときだけ）。blocked は、作者と食い違いが続いて人に戻した種類
export function plan(it, blocked = new Set()) {
  const segs = String(it.why ?? "").split("／").filter(Boolean);
  if (!segs.length) return null;
  const kinds = segs.map((s) => kindOf(s, it));
  if (kinds.some((k) => k === null)) return null;
  const ks = [...new Set(kinds.filter((k) => k !== "memo"))];
  if (ks.some((k) => blocked.has(k))) return null;
  return ks;
}

// 確かめたものから学ぶ（作者「確かめたものを学習して、人間判断が減る工夫をしてほしい」11/7）
// ① AI と作者の食い違い：AI が決めたあとに、作者が元に戻した・別に決め直したものを、種類ごとに数える。
//    最近の 10 件のうち 2 件以上食い違った種類は、AI に任せず人に戻す（まちがいが続く種類を任せたままにしない）
const ownerAfterAi = (x) => {
  const ds = x.decisions ?? [];
  const i = ds.map((d) => d.by).lastIndexOf("ai");
  if (i < 0) return null;
  const later = ds.slice(i + 1).filter((d) => d.by === "owner");
  return { ai: ds[i].action, owner: later.at(-1)?.action ?? null, undo: later.some((d) => d.action === "undo") };
};
export function trust(items = ledger.load().items) {
  const by = {};
  for (const x of items) {
    const o = ownerAfterAi(x);
    if (!o) continue;
    for (const k of plan(x) ?? []) (by[k] ??= []).push({ at: (x.decisions ?? []).findLast((d) => d.by === "ai")?.at ?? "", miss: o.undo || (o.owner && o.owner !== o.ai) });
  }
  const out = {};
  for (const [k, xs] of Object.entries(by)) {
    const last = xs.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 10);
    const miss = last.filter((x) => x.miss).length;
    out[k] = { n: last.length, miss, blocked: miss >= 2 };
  }
  return out;
}
export const blockedKinds = (items) => new Set(Object.entries(trust(items)).filter(([, v]) => v.blocked).map(([k]) => k));

// ② 前の決め方を手本にする：作者が前に、同じ問い・同じ種類の気になる所をどう決めたかを、最大 5 件 AI に見せる
export function precedents(it, items) {
  const mine = new Set(plan(it) ?? []);
  const owned = items.filter((x) => x.id !== it.id && (x.decisions ?? []).some((d) => d.by === "owner" && ["ok", "fix", "reject", "unknown"].includes(d.action)) && (plan(x) ?? []).some((k) => mine.has(k)));
  const rank = (x) => (x.qid && x.qid === it.qid ? 0 : x.scope === it.scope ? 1 : 2);
  return owned.sort((a, b) => rank(a) - rank(b) || ((b.decisions.at(-1)?.at ?? "") < (a.decisions.at(-1)?.at ?? "") ? -1 : 1)).slice(0, 5).map((x) => {
    const d = x.decisions.filter((y) => y.by === "owner").at(-1);
    const what = String(x.why ?? "").split("／").filter((r) => !/^Claude のメモ/.test(r)).join("／").slice(0, 120);
    return `- ${x.qid ?? x.kind}（${x.scopeName ?? x.scope}）気になった所：${what} → 作者：${{ ok: "OK", fix: "直して", reject: "出さない", unknown: "分からない" }[d.action]}${d.reason ? `（${String(d.reason).slice(0, 80)}）` : ""}`;
  });
}

const fence = (s) => String(s ?? "").replace(/<\/?(answer|objection|original|translated|back|verdict|page)\b[^>]*>/g, "");

// 別の Claude が判断する：出典のページを読み直して、答えが合っているか。
// ページは PC 側で、いまのものを取る（名札つき・robots.txt を見る・同じサイトは1秒あける）。Claude のページを開く道具は前に取った写しを返すことがあり、
// 見張りが「今日中身が変わった」と言ったページを古い写しで判断してしまうため（11/7 の試しで、写しは前の日のものだった）
async function judge(it, log, items) {
  const tr = it.kind === "translation";
  const pre = precedents(it, items);
  const learned = lessonsFor({ use: "judge", topic: topicOf(it) });
  const url = it.source?.url ?? it.watchUrl ?? "";
  let page = "";
  if (!tr) {
    try { page = (await politeText(url)).replace(/\s+/g, " ").slice(0, 40000); }
    catch (e) { log(`  ${it.id}：出典のページが取れなかった（${e.message}）ので人に回します`); return { verdict: "human", reason: `出典のページが取れなかった（${e.message}）`, usd: 0 }; }
  }
  const system = `あなたは、町の公式の情報を住民に伝えるサイト「まちしるべ」の確かめ役です。確かめる係（別の Claude）が気にした所が、本当に直すべきまちがいかを決めます。
決め方：
- ok：答え（${tr ? "訳" : "答え"}）は${tr ? "もとの日本語と同じことを言っている（言いかえ・語順・敬語のちがいは問題にしない）" : "出典のページに書いてあることと合っている（言いかえや、ページから素直に読み取れる範囲はよい）"}
- fix：はっきりしたまちがいがある（数・電話番号・日時・窓口・対象がページとちがう、ページに無いことを言い切っている）。何を直すかを1行で
- human：ページの文が途中で切れていて分からない・判断がつかない・避難や命にかかわる数で少しでも迷う → 人に回す
作者が前に、同じような所をどう決めたかを <precedents> に入れます（あれば）。作者の決め方に合わせてください（作者が OK にしてきた種類のずれは ok、直してにしてきた種類は fix）。ただし、このページと答えを見て決めることが先です。
${learned.length ? `作者の確かめから学んだ決まり（これに沿って決める）：\n${learned.map((t) => `- ${t}`).join("\n")}\n` : ""}迷ったら human。<verdict>{"verdict": "ok|fix|human", "reason": "1行の理由（住民向けではなく作者向け。やさしい日本語）"}</verdict> の形だけで答えます。`;
  const content = (pre.length ? `<precedents>\n${fence(pre.join("\n"))}\n</precedents>\n` : "") + (tr
    ? `<original>${fence(it.original)}</original>\n<translated lang="${it.lang}">${fence(it.value)}</translated>\n<back>${fence(it.back)}</back>\n<objection>${fence(it.why)}</objection>`
    : `問い：${fence(it.question)}\n出典：${it.source?.url ?? it.watchUrl ?? "（無い）"}\n<answer>${fence(it.value)}</answer>\n${it.quote ? `答えの元の文：${fence(it.quote)}\n` : ""}<objection>${fence(it.why)}</objection>\n<page url="${url}">${fence(page)}</page>
上のページ（いま取ったもの）と答えを照らして、決めてください。`);
  const client = new Anthropic();
  const messages = [{ role: "user", content }];
  let res, usd = 0;
  const out = [];
  for (let turn = 0; turn < 3; turn++) {
    res = await client.messages.create({
      model: MODEL, max_tokens: 1500, output_config: { effort: "low" }, system, messages,
    });
    usd += record(MODEL, res.usage, `AI が確かめ待ちを判断：${it.scopeName ?? it.scope} ${it.qid ?? it.kind ?? ""}`);
    out.push(...res.content);
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  const text = out.filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/<verdict>([\s\S]*?)<\/verdict>/);
  let v = null;
  try { v = JSON.parse(m?.[1] ?? "null"); } catch { v = null; }
  if (!v || !["ok", "fix", "human"].includes(v.verdict)) { log(`  ${it.id}：判断の形が読めなかったので人に回します`); return { verdict: "human", reason: "AI の判断が読めなかった", usd }; }
  return { ...v, reason: String(v.reason ?? "").slice(0, 160), usd };
}

// 確かめ待ちを順に見て、任せられるものを決める。人のままのものは触らない
export async function aiJudge({ scope = null, log = console.log, shouldStop = () => false } = {}) {
  const sum = { ai: 0, human: 0, usd: 0, done: [] };
  const over = () => spent(japanDay(new Date().toISOString())) >= DAILY_LIMIT_USD || spent() >= TOTAL_LIMIT_USD;
  // 1. はじめて使う公のサイトを OK（そのサイトだけが理由の答えは、これで自動で出る）
  const sites = new Map();
  for (const it of ledger.load().items.filter((x) => x.status === "pending" && (!scope || x.scope.includes(scope)))) {
    for (const seg of String(it.why ?? "").split("／")) {
      const fu = seg.match(/^はじめて使う情報源（(.+?)）/);
      if (fu && OFFICIAL.test(fu[1])) sites.set(`${it.scope}|${fu[1]}`, { scope: it.scope, host: fu[1] });
    }
  }
  for (const { scope: sc, host } of sites.values()) {
    try { ledger.decideSite(sc, host, "ok", { user: "ai", reason: `AI の判断：国・県・市町村の公式のサイト（${host}）なので使ってよい（決まり：公のサイトは自動。作者 11/7）` }); log(`サイト ${host} を OK（公のサイト）`); }
    catch (e) { if (e.status !== 404) log(`サイト ${host}：${e.message}`); }
  }
  // 2. 確かめ待ちを1つずつ（作者と食い違いが続いた種類は人に戻す）
  const blocked = blockedKinds(ledger.load().items);
  if (blocked.size) log(`作者と食い違いが続いたので、人に戻している種類：${[...blocked].join("・")}`);
  for (const it of ledger.load().items.filter((x) => x.status === "pending" && (!scope || x.scope.includes(scope)))) {
    if (shouldStop()) break;
    const kinds = plan(it, blocked);
    if (!kinds) { sum.human++; continue; }
    // AI が一度「直して」にして調べ直した答えは、人が見る（AI どうしで直して・調べ直しを繰り返して費用がかかり続けないように）
    if (it.aiFixedFrom) { sum.human++; continue; }
    const rest = kinds.filter((k) => k !== "site-official"); // サイトは 1. で決めた
    if (!rest.length) continue;
    const decide = (action, reason) => { ledger.decide(it.id, action, { user: "ai", reason: `AI の判断：${reason}`.slice(0, 200) }); sum.ai++; sum.done.push({ id: it.id, action, reason }); log(`  ${it.scopeName ?? it.scope} ${it.qid ?? ""}（${it.id}）→ ${action}：${reason}`); };
    try {
      if (rest.length === 1 && rest[0] === "not-found") { decide(NOT_FOUND_ACTION, "公開の資料で見つからなかった答えは、町の人に聞きたいことへ（決まり。作者 11/7）"); continue; }
      if (rest.length === 1 && rest[0] === "watch-gone") {
        if (over()) { sum.human++; continue; }
        decide("fix", "出典のページが消えた・移ったので、新しいページを探して調べ直す（決まり。作者 11/7）");
        const code = it.scope.match(/(\d{5})/)?.[1];
        const part = it.scope.startsWith("town:") ? it.scope.slice(-4) : undefined;
        const r = await research(code, it.question, { log: () => {}, qid: it.qid, hint: it.why, redoOf: it.redoOf ?? it.id, part });
        sum.usd += r.usd;
        log(`    調べ直した → ${r.item.id}（${r.item.status === "auto" ? "自動で承認" : "確かめ待ち"}）`);
        continue;
      }
      if (rest.every((k) => k === "judge-answer" || k === "judge-translation")) {
        if (over()) { sum.human++; continue; }
        const v = await judge(it, log, ledger.load().items);
        sum.usd += v.usd;
        if (v.verdict === "ok") decide("ok", v.reason || "出典と合っている");
        else if (v.verdict === "fix" && it.kind !== "translation") {
          decide("fix", v.reason || "まちがいがある");
          const code = it.scope.match(/(\d{5})/)?.[1];
          const part = it.scope.startsWith("town:") ? it.scope.slice(-4) : undefined;
          const r = await research(code, it.question, { log: () => {}, qid: it.qid, hint: `AI の確かめ：${v.reason}`, redoOf: it.redoOf ?? it.id, part });
          sum.usd += r.usd;
          // AI が直して調べ直した答えには印。この答えは人が見る（AI どうしで直して・調べ直しを繰り返さない）
          ledger.annotate(r.item.id, { aiFixedFrom: it.id });
          log(`    調べ直した → ${r.item.id}（${r.item.status === "auto" ? "自動で承認" : "確かめ待ち"}）`);
        } else {
          ledger.annotate(it.id, { aiNote: `AI は決めずに人に回した：${v.reason}` });
          sum.human++;
          log(`  ${it.scopeName ?? it.scope} ${it.qid ?? ""}（${it.id}）→ 人へ：${v.reason}`);
        }
        continue;
      }
      sum.human++;
    } catch (e) {
      sum.human++;
      log(`  ${it.id}：${e.message}（人に回します）`);
    }
  }
  log(`AI が決めた ${sum.ai} 件・人に残した ${sum.human} 件（$${sum.usd.toFixed(3)}）`);
  return sum;
}

if (process.argv[1]?.endsWith("ai-judge.mjs")) {
  const code = process.argv[2];
  await aiJudge({ scope: code ? code : null });
}
