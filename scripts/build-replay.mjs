// 審査の方への体験（site/try.html）で再生する「調べの記録」を作る（作者「ハッカソンの審査員に町の調査の操作を試して貰いたい」→「A,B両方。一般の人が見る公開ページと審査員が見る公開ページは分けたい」）。
// もとは手元の調べの記録（local/runs/、公開しない）。公開するのは、決まった種類の行（探す・読む公式のページ・確かめ・採点・国のデータ・見立て・提案など）と、
// 時刻（はじめからの秒）・問いの番号と見出し・点・費用だけ。台帳の番号は外す。答えの中身は、いま公開している答え（site/data/answers/）だけを使う
// 動かし方: node scripts/build-replay.mjs run-20261104054322-15385
import fs from "node:fs";
import * as ledger from "./ledger.mjs";

const runId = process.argv[2] ?? "run-20261104054322-15385";
const run = JSON.parse(fs.readFileSync(`local/runs/${runId}.summary.json`, "utf8"));
const code = run.code;
const yard = JSON.parse(fs.readFileSync("site/data/yardstick.json", "utf8")).questions;
const shortOf = (qid) => yard.find((q) => q.id === qid)?.short ?? qid;

// 通す行の種類（これ以外の行は出さない）
const KEEP = [
  /調べ始めます：/, /公式サイトの場所を確かめています/, /^公式サイト：/, /^国のデータを重ねています/, /^国のデータを重ねる計算が終わりました/,
  /^(浸水・土砂災害|大きな地震|坂の多い所|町の気候|近くの介護|買い物に困って)[^：]*：/, /^公式のサイトを探しています/, /^読んでいます：https?:\/\//,
  /^Claude の答えが返りました/, /^出典を PC 側で取り直しています/, /^元の文がありました/, /^確かめ役/, /^確かめる一覧に入れました/, /^自動で承認しました/,
  /^採点：/, /の足りない所を探し直します$/, /^探し直し/, /^スキルを使います：/, /^取れませんでした/, /上限.*止めます$/,
  /見立てています$/, /問いを結んでいます$/, /^\s+.+ → (もう聞いている|新しい問い)/, /^新潟県 阿賀町：/, /ひとこと」をまとめています$/, /^\s+\d+\/\d+（/,
  /できることへ。人が確かめてから出す）$/, /^数から、できることへは出せませんでした/, /^調べ終わりました/, /^Managed Agents/, /^採点役/, /^提案 /,
];
const t0 = Date.parse(run.startedAt);
const steps = [];
for (const l of run.log) {
  if (!KEEP.some((re) => re.test(l.text))) continue;
  const text = l.text
    .replace(/（r\d{5}）/g, "")
    .replace(/、止まった理由 \w+/, "")
    .replace(/ → site\/data\/\S+/, "")
    .replace(/^(.+?)：\d{5}：/, "$1：")
    .replace(/（sesn_\w+）/, "")
    .replace(/（An independent grader[\s\S]*$/, "")
    .replace(/大きな地震の揺れの確率は出せませんでした：fetch failed/, "大きな地震の揺れの確率は、取り先につながらず出せませんでした");
  steps.push({ s: Math.round((Date.parse(l.at) - t0) / 1000), t: text });
}

// 問いのます目：この調べで答えた問い（点はその場の採点、状態はその時点の確かめ待ち・自動）
const scores = {};
for (const s of steps) { const m = s.t.match(/^採点：(\w+) は (\d) 点/); if (m) scores[m[1]] = Number(m[2]); }
const items = run.items.map((it) => ({ qid: it.qid, short: shortOf(it.qid), status: it.status, score: scores[it.qid] ?? null }));

// 確かめる一覧の体験：この調べで確かめ待ちになり、いまは公開している答えから 3 つ（確かめ役が気にした所のあるもの・合っていたもの・見つからなかったもの）
const pub = JSON.parse(fs.readFileSync(`site/data/answers/${code}.json`, "utf8")).answers;
const all = ledger.load().items;
const review = [];
for (const it of run.items) {
  const p = pub.find((a) => a.qid === it.qid && a.value !== "見つからなかった");
  const first = all.find((x) => x.id === it.id);
  if (!p || !first) continue;
  review.push({ qid: it.qid, short: shortOf(it.qid), question: p.question, value: p.value, source: p.source ? { title: p.source.title, url: p.source.url } : null,
    why: String(first.why ?? "").replace(/（r\d{5}）/g, ""), decided: first.status === "ok" ? "OK" : first.status === "fix" ? "直して" : first.status });
}
const pick = [review.find((r) => /確かめ役/.test(r.why)), review.find((r) => !/確かめ役/.test(r.why) && r.why), review.filter((r) => /確かめ役/.test(r.why))[1]].filter(Boolean).slice(0, 3);

fs.mkdirSync("site/data/replay", { recursive: true });
fs.writeFileSync(`site/data/replay/${code}.json`, JSON.stringify({
  code, name: "新潟県 阿賀町", date: run.startedAt.slice(0, 10), seconds: Math.round((Date.parse(run.endedAt) - t0) / 1000),
  usd: Math.round(run.usd * 100) / 100, limit: run.limit, steps, items, review: pick,
  note: "本物の調べの記録（作者の手元の PC で、はじめて阿賀町を調べたときの1回目）から、決まった種類の行だけを出したもの。答えの中身は、いま公開している答え",
}, null, 1));
console.log(`site/data/replay/${code}.json：行 ${steps.length}（もとは ${run.log.length}）・問い ${items.length}・確かめる体験 ${pick.length}`);
