// 町の紹介（町を知るページのいちばん上）：確かめ済みの町の答え（町のなりたち・催し・町の花と木・ゆかりの人と名所・旬の野菜）と国のデータの数から、
// Claude（Sonnet）が、その町を知らない人に向けた短い紹介を書く。1文ごとに使った材料の番号を付けさせ、文の中の数と「」の名前が、その材料に本当にあるかを
// PC が照らし、無い文は捨てる（クイズと同じやり方）。出すときは「確かめた答えから AI がまとめた」と書き、文ごとに出典を付ける
// （作者「町外の人が、まったく知らない町を見る楽しみが出来るかとおもった」→ A と B の両方。B は町のページが国の数字から決まりで作る）
// 動かし方: npm run intro -- 39428 10524
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { record, spent, japanDay, DAILY_LIMIT_USD, TOTAL_LIMIT_USD } from "../src/cost.mjs";
import { townFacts } from "./mitate.mjs";

const MODEL = "claude-sonnet-5-5";
const QIDS = ["Q09", "Q10", "Q11", "Q39", "Q47"]; // 町のなりたち・催し・町の花と木・ゆかりの人と名所・旬の野菜（「これからの催し」は日が過ぎるので使わない）
const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const flat = (s) => String(s ?? "").normalize("NFKC").replace(/[\s,、。・「」『』（）()]/g, "");
const between = (t, tag) => t.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? "";

// 文が材料に合っているか：数（3 や 1,234 や 25.3）と「」『』の中の名前が、使った材料の文にあるか。合わなければ、その理由
export function checkSentence(s, mats) {
  const all = flat(mats.map((m) => m.text).join(""));
  for (const n of s.normalize("NFKC").match(/\d[\d,.]*/g) ?? []) if (!all.includes(n.replace(/,/g, "").replace(/\.$/, "")) && !all.includes(n.replace(/\.$/, ""))) return `数「${n}」が材料に無い`;
  for (const [, q] of s.matchAll(/[「『]([^」』]+)[」』]/g)) if (!all.includes(flat(q))) return `「${q}」が材料に無い`;
  // 今年より先（今年を含む）の決まった日付の文は捨てる（紹介はしばらく出し続けるので、日が過ぎる。美濃加茂市で「令和8年は10月25日に…」が入った）
  const now = new Date().getFullYear();
  const years = [...s.matchAll(/(20\d\d)年/g)].map((x) => Number(x[1])).concat([...s.matchAll(/令和(\d+)年/g)].map((x) => 2018 + Number(x[1])));
  if (years.some((y) => y >= now)) return "今年より先の日付がある（日が過ぎる）";
  return "";
}

export async function intro(code, log = console.log) {
  if (spent(japanDay(new Date().toISOString())) >= DAILY_LIMIT_USD || spent() >= TOTAL_LIMIT_USD) throw new Error("費用の上限に達しています");
  const t = read("site/data/stats.json").towns[code];
  const name = `${t.pref} ${t.name.replace(/^.+?郡(?=.+[町村]$)/, "")}`;
  const src = [];
  for (const a of read(`site/data/answers/${code}.json`)?.answers ?? []) {
    if (QIDS.includes(a.qid) && a.value && a.value !== "見つからなかった" && a.source?.url) src.push({ text: a.value, title: a.source.title, url: a.source.url });
  }
  if (src.length < 2) throw new Error("紹介にする確かめ済みの答えが足りません（町のなりたち・催し・町の花と木・ゆかりの人と名所・旬の野菜）");
  for (const f of townFacts(code)) src.push({ text: f, title: f.match(/（([^（）]*)）$/)?.[1] ?? "国の統計", url: null });
  for (const b of read(`site/data/climate/${code}.json`)?.bright ?? []) src.push({ text: b, title: "平年値メッシュ（国土交通省）", url: "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-G02-2022.html" });
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL, max_tokens: 2000, output_config: { effort: "medium" },
    system: "まだその町を知らない人に向けて、町の短い紹介を書きます。渡す材料に書いてあることだけを使い、推測で足しません。町を評価したり、ほかの町と比べて良し悪しを言ったりしません。観光の宣伝の言い方（「ぜひ」「魅力あふれる」など）はしません。やさしい短い日本語で、1文は60字ほどまで。市なら「市」、町なら「町」、村なら「村」と書く。和暦の略は「令和7年度」と書く。かっこは全角の（）。英語の単語を混ぜない。数を書くときは材料の数をそのまま使う。名前は材料のとおりに書き、「」でくくる。催しは「毎年○月ごろ」と書き、今年の日付は書かない。位置は「○番目に高い」「高いほう」と書き、「上から ○%」「上から ○番目」とは書かない。",
    messages: [{ role: "user", content: `町：${name}\n材料（番号つき）：\n${src.map((x, i) => `<src id="${i}">${x.text}</src>`).join("\n")}\n\nこの町を知らない人が「行ってみたい・もっと知りたい」と思えるような紹介を、4文で書いてください。町のなりたち、名所やゆかりの人、催し、町の花や木、旬のものなど、いろいろな話から。1文ごとに、使った材料の番号を付けてください（1つか2つ）。次の形だけで：\n<s src="番号">文</s>` }],
  });
  const usd = record(MODEL, res.usage, `町の紹介：${name}`);
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const out = [];
  for (const m of text.matchAll(/<s src="([\d,\s]+)">([\s\S]*?)<\/s>/g)) {
    const ids = m[1].split(/[,\s]+/).filter(Boolean).map(Number), s = m[2].trim();
    const mats = ids.map((i) => src[i]).filter(Boolean);
    const why = !s ? "文が空" : !mats.length ? "材料の番号が無い" : checkSentence(s, mats);
    if (why) { log(`  捨てました：${s}（${why}）`); continue; }
    out.push({ text: s, sources: mats.filter((x) => x.url).map((x) => ({ title: x.title, url: x.url })).concat(mats.some((x) => !x.url) ? [{ title: mats.find((x) => !x.url).title, url: null }] : []) });
  }
  if (out.length < 2) throw new Error("紹介が作れませんでした（材料に合う文が2つ未満）");
  fs.mkdirSync("site/data/intro", { recursive: true });
  fs.writeFileSync(`site/data/intro/${code}.json`, JSON.stringify({
    code, name, createdAt: new Date().toISOString(), model: MODEL, sentences: out,
    note: "確かめた町の答えと国のデータから、AI がまとめた紹介です。文の中の数と名前が、もとにした答えや数の中にあるかを確かめています",
  }, null, 1));
  log(`${name}：紹介 ${out.length} 文（$${usd.toFixed(3)}）`);
  return { n: out.length, usd };
}

if (process.argv[1]?.endsWith("intro.mjs")) for (const c of process.argv.slice(2)) await intro(c);
