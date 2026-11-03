// 町のクイズ：確かめ済みの町の答えと、国のデータを重ねた数・昔の災害を伝える碑・町の気候から、Claude（Sonnet）が3択のクイズを作る。
// 正しい答えの言葉（数）が、もとにした答えや数の文の中に本当にあるかを PC が照らし、無いものは捨てる。住む人が町を知るきっかけに
// （作者「余裕があれば追加したい。…町のクイズ」）
// 動かし方: npm run quiz -- 39428
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { record, spent, japanDay, DAILY_LIMIT_USD, TOTAL_LIMIT_USD } from "../src/cost.mjs";
import { townFacts } from "./mitate.mjs";

const MODEL = "claude-sonnet-5-5";
const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const flat = (s) => String(s ?? "").normalize("NFKC").replace(/[\s,、。「」（）()]/g, "");
const between = (t, tag) => t.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? "";

export async function quiz(code, log = console.log) {
  if (spent(japanDay(new Date().toISOString())) >= DAILY_LIMIT_USD || spent() >= TOTAL_LIMIT_USD) throw new Error("費用の上限に達しています");
  const t = read("site/data/stats.json").towns[code];
  const name = `${t.pref} ${t.name.replace(/^.+?郡(?=.+[町村]$)/, "")}`;
  // もとにするもの（番号つき）：確かめ済みの答え・国のデータの数・碑・気候
  const src = [];
  for (const a of read(`site/data/answers/${code}.json`)?.answers ?? []) {
    if (a.value && a.value !== "見つからなかった" && a.source?.url) src.push({ text: a.value, title: a.source.title, url: a.source.url });
  }
  for (const f of townFacts(code)) src.push({ text: f, title: f.match(/（([^（）]*)）$/)?.[1] ?? "国の統計", url: null });
  for (const x of read(`site/data/lore/${code}.json`)?.own ?? []) src.push({ text: `「${x.name}」は${x.disaster}を伝える碑。${x.text}`, title: "自然災害伝承碑（国土地理院）", url: "https://www.gsi.go.jp/bousaichiri/denshouhi.html" });
  for (const b of read(`site/data/climate/${code}.json`)?.bright ?? []) src.push({ text: b, title: "平年値メッシュ（国土交通省）", url: "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-G02-2022.html" });
  if (src.length < 5) throw new Error("クイズにする材料が足りません");
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL, max_tokens: 3000, output_config: { effort: "medium" },
    system: "町に住む人が、自分の町を楽しく知るための3択のクイズを作ります。渡す材料に書いてあることだけを使います。答えが材料から一つに決まる問いだけにします。町を評価したり、怖がらせたりしません。避難や医療の判断を問う問題は作りません。やさしい短い日本語で書きます。書き方の決まり：避難場所（まず逃げる先）と避難所（あとで過ごす所）を混ぜない。地震の確率には「今後30年に」を付ける。人身事故を「車の事故」と言いかえない。市なら「市」、町なら「町」、村なら「村」と書く。お年寄りは「お年寄り」と書き、数を言う所だけ「65歳以上」。和暦の略（R7年度など）は「令和7年度」と書く。かっこは全角の（）。英語の単語を混ぜない。低い数を「なので」で備えの理由にしない（低くても備える、と書く）。区域の中に住む人に「近づかない」と書かない。本人が経験していない昔のことを「思い出す」と書かない。",
    messages: [{ role: "user", content: `町：${name}\n材料（番号つき）：\n${src.map((x, i) => `<src id="${i}">${x.text}</src>`).join("\n")}\n\n3択のクイズを5問作ってください。町の歴史・名所・催し・暮らしの窓口・町の数・昔の災害など、いろいろな話から。正しい答えは、材料の文にある言葉か数を、そのまま使ってください。ほかの2つは、ありそうだが材料と違うもの。次の形だけで：\n<quiz>\n<q>問い（40字ほど）</q>\n<a>正しい答え（材料のとおり、15字まで）</a>\n<b>ちがう答え1</b>\n<c>ちがう答え2</c>\n<why>ひとことの説明（50字ほど）</why>\n<src>使った材料の番号</src>\n</quiz>` }],
  });
  const usd = record(MODEL, res.usage, `町のクイズ：${name}`);
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const out = [];
  for (const m of text.matchAll(/<quiz>([\s\S]*?)<\/quiz>/g)) {
    const q = { q: between(m[1], "q"), a: between(m[1], "a"), b: between(m[1], "b"), c: between(m[1], "c"), why: between(m[1], "why") };
    const s = src[Number(between(m[1], "src").replace(/\D/g, ""))];
    // 正しい答えが材料の文にあるか・ちがう答えが正しい答えと同じでないか
    const why = !s ? "材料の番号が無い" : !q.q || !q.a || !q.b || !q.c ? "文が空" : !flat(s.text).includes(flat(q.a)) ? "正しい答えが材料に無い"
      : new Set([q.a, q.b, q.c].map(flat)).size < 3 ? "答えが重なっている" : flat(s.text).includes(flat(q.b)) && flat(s.text).includes(flat(q.c)) ? "ちがう答えも材料にあり、答えが一つに決まらない" : "";
    if (why) { log(`  捨てました：${q.q}（${why}）`); continue; }
    out.push({ ...q, source: { title: s.title, url: s.url } });
  }
  if (!out.length) throw new Error("クイズが作れませんでした");
  fs.mkdirSync("site/data/quiz", { recursive: true });
  fs.writeFileSync(`site/data/quiz/${code}.json`, JSON.stringify({
    code, name, createdAt: new Date().toISOString(), model: MODEL, questions: out,
    note: "確かめた町の答えと国のデータから、AI が作ったクイズです。正しい答えが、もとにした答えや数の中にあるかを確かめています",
  }, null, 1));
  log(`${name}：クイズ ${out.length} 問（$${usd.toFixed(3)}）`);
  return { n: out.length, usd };
}

if (process.argv[1]?.endsWith("quiz.mjs")) for (const c of process.argv.slice(2)) await quiz(c);
