// 届きにくい人の見立て：町の数（国の統計と、国や公の機関のデータを重ねた数）を Claude（Sonnet）に渡し、
// 「この町で、暮らしの情報が届きにくいのは誰か・どんな壁があるか」を多くて3つ、渡した数だけを使って書かせる。
// 理由の中の数が、渡した数に本当にあるかを PC が照らし、無い数を書いたものは捨てる。町の評価はさせない
// 動かし方: npm run mitate -- 39428
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { record, spent, japanDay, DAILY_LIMIT_USD, TOTAL_LIMIT_USD } from "../src/cost.mjs";

const MODEL = "claude-sonnet-5-5";
const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const PAGES = { bousai: "防災・避難", chizu: "地図", foreign: "外国の方へ", kaigo: "お年寄り・介護", kosodate: "子育て", koutsuu: "交通と道の安全", tetsuzuki: "手続き", iryo: "医療・健康", keikaku: "町の計画と話題", gomi: "ごみ" };

// 町の数を、出典つきの短い行にまとめる（Claude に渡すのはこれだけ）
export function townFacts(code) {
  const stats = read("site/data/stats.json");
  const t = stats.towns[code];
  const s = stats.summary;
  const f = [];
  const add = (text, src) => f.push(`${text}（${src}）`);
  const top = (k) => (t.top?.[k] != null ? `全国の市区町村の上から ${t.top[k]}%` : "");
  add(`人口 ${t.population.toLocaleString("ja-JP")}人、65歳以上 ${t.over65Rate}%（${top("over65Rate")}、全国の上から10%の境目は ${s.over65Rate.top10}%）、75歳以上 ${t.over75Rate}%、15歳未満 ${t.under15Rate}%`, "住民基本台帳 令和8年1月1日");
  add(`外国の住民 ${t.foreignRate}%（${top("foreignRate")}、全国の上から10%の境目は ${s.foreignRate.top10}%）、1年の人口の増減 ${t.changeRate}%、引っ越しによる増減 ${t.socialChangeRate}%`, "住民基本台帳");
  if (t.elderlySingleRate != null) add(`65歳以上の一人暮らしの世帯 ${t.elderlySingleRate}%（全国の上から10%の境目は ${s.elderlySingleRate.top10}%）`, "国勢調査 2020年");
  const feats = read("site/data/features.json")?.towns?.[code];
  if (feats?.length) add(`町の特徴：${feats.map((x) => ({ nougyou: "農業", gyogyou: "漁業", yuki: "雪", kazan: "火山", shima: "島" })[x] ?? x).join("・")}`, "国勢調査・国の指定");
  const fp = read(`site/data/flood-pop/${code}.json`);
  for (const [k, v] of Object.entries(fp?.kinds ?? {})) add(`${k === "土砂" ? "土砂災害警戒区域" : `${k}で浸かる想定の所`}に住む人 約${v.people.toLocaleString("ja-JP")}人（町の${v.rate}%）、うち65歳以上 約${v.over65?.toLocaleString("ja-JP")}人`, "250m 四方の人口 × ハザードマップ。めやす");
  const q = read(`site/data/quake-pop/${code}.json`);
  if (q) add(`今後30年に震度6弱以上の揺れに見舞われる確率 ${q.p55}%、6強以上 ${q.p60}%（住む人で重みをつけた平均）`, "J-SHIS 2024年版");
  const a = read(`site/data/accidents/${code}.json`);
  if (a?.total) add(`人身事故 3年で${a.total}件、人1000人あたり年${a.per1000}件（全国 ${a.nationPer1000}件）、歩行者が関わる ${a.ped}件・うち65歳以上の歩行者 ${a.oldPed}件、自転車が関わる ${a.bike}件`, "警察庁 2022〜2024年");
  const sh = read(`site/data/shop-access/${code}.json`);
  if (sh) add(`店まで500m以上で車を使うのが難しい65歳以上 ${sh.rate}%（全国 ${sh.nationRate}%）`, "農林水産政策研究所 2020年");
  const b = read(`site/data/bus/${code}.json`);
  if (b) add(`バス停まで500m以上の所に住む65歳以上 ${b.farRate}%、近いバス停が1日10本未満 ${b.fewRate}%（時刻表データのあるバスだけ：${b.routes.join("・")}）`, "GTFS × 250m 四方の人口。めやす");
  const fu = read("site/data/future.json");
  const ft = fu?.towns?.[code];
  if (ft) add(`2050年の人口は2020年の${Math.round((ft.pop[6] / ft.pop[0]) * 100)}%（全国 ${Math.round((fu.nation.pop[6] / fu.nation.pop[0]) * 100)}%）、65歳以上の割合 ${ft.old?.[0]}% → ${ft.old?.[6]}%`, "社人研 2023年推計");
  return f;
}

export async function mitate(code, log = console.log) {
  if (spent(japanDay(new Date().toISOString())) >= DAILY_LIMIT_USD || spent() >= TOTAL_LIMIT_USD) throw new Error("費用の上限に達しています");
  const stats = read("site/data/stats.json");
  const t = stats.towns[code];
  const name = `${t.pref} ${t.name.replace(/^.+?郡(?=.+[町村]$)/, "")}`;
  const facts = townFacts(code);
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL, max_tokens: 2000, output_config: { effort: "medium" },
    system: "あなたは、町の暮らしの情報が届きにくい人を見つける手伝いをします。渡す数だけを使い、推測で数を足しません。町を評価したり、良し悪しを言ったりしません。やさしい短い日本語で書きます。",
    messages: [{ role: "user", content: `町：${name}\n町の数（出典つき）：\n${facts.map((x) => `- ${x}`).join("\n")}\n\nこの町で、暮らしや備えの情報が届きにくい（または、届かないと困る）のは、どんな人でしょう。多くても3つ、大事な順に、次の形で書いてください。理由には上の数を必ず1つ以上、書いてあるとおりに使ってください（数を変えたり、計算したりしない）。「めやす」や「時刻表データのあるバスだけ」のような但し書きのある数を使うときは、その但し書きも理由に短く入れてください。\n<who id="1">\n<person>どんな人か（20字ほど）</person>\n<wall>その人を阻む壁（15字ほど）</wall>\n<why>理由（上の数を使って、60字ほど）</why>\n<page>助けになるページ：${Object.keys(PAGES).join("・")} のどれか1つ</page>\n</who>` }],
  });
  const usd = record(MODEL, res.usage, `届きにくい人の見立て：${name}`);
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const all = facts.join(" ");
  const out = [];
  for (const m of text.matchAll(/<who[^>]*>([\s\S]*?)<\/who>/g)) {
    const g = (tag) => m[1].match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? "";
    const w = { person: g("person"), wall: g("wall"), why: g("why"), page: g("page").replace(/[^a-z]/g, "") };
    // 理由の数が、渡した数にあるか（ない数を書いたものは捨てる）
    const nums = (w.why.match(/\d[\d,.]*/g) ?? []).map((x) => x.replace(/,/g, "").replace(/\.$/, ""));
    const bad = nums.filter((x) => !all.replace(/,/g, "").includes(x));
    if (!w.person || !nums.length || bad.length) { log(`  捨てました（${w.person}：${bad.length ? `渡していない数 ${bad.join("・")}` : "数が無い"}）`); continue; }
    if (!PAGES[w.page]) w.page = "bousai";
    out.push(w);
  }
  fs.mkdirSync("site/data/mitate", { recursive: true });
  fs.writeFileSync(`site/data/mitate/${code}.json`, JSON.stringify({ code, name, createdAt: new Date().toISOString(), model: MODEL, facts, who: out, note: "国の統計と、国や公の機関のデータを重ねた数から、Claude が見立てたものです。理由の数は、渡した数にあるかを PC で照らしています。町の評価ではありません" }, null, 1));
  log(`${name}：${out.map((w) => `${w.person}（${w.wall}）`).join("／")}（$${usd.toFixed(3)}）`);
  return { who: out, usd };
}

if (process.argv[1]?.endsWith("mitate.mjs")) for (const c of process.argv.slice(2)) await mitate(c);
