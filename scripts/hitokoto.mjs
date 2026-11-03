// 町・字ごとの「わが町のひとこと」：町・字ごとの数（年齢・浸水や土砂の想定の区域に住む人・坂・揺れ・事故・中の避難場所）を PC が集め、
// AI（Sonnet）がその数だけを使って、その地区に住む人に向けて2〜3文にまとめる。文の中の数が渡した数にあるかを PC が照らし、
// 無い数を書いたものは捨てる（その町・字は出さない）。防災計画の抜き出しは、人が確かめてから渡す
// 動かし方: npm run hitokoto -- 39428
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { record, spent, japanDay, DAILY_LIMIT_USD, TOTAL_LIMIT_USD } from "../src/cost.mjs";
import { polygonsOf, inPoly } from "./build-flood-pop.mjs";

const MODEL = "claude-sonnet-5-5";
const BATCH = 10; // 1回に頼む町・字の数
const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);

function partFacts(code) {
  const parts = polygonsOf(read(`site/data/towns/${code}.json`));
  const fp = read(`site/data/flood-pop/${code}.json`)?.kinds ?? {};
  const sl = read(`site/data/slope/${code}.json`)?.parts ?? {};
  const qk = read(`site/data/quake-pop/${code}.json`)?.parts ?? {};
  const ac = read(`site/data/accidents/${code}.json`)?.parts ?? {};
  const sh = read(`site/data/shelters/${code}.json`)?.features ?? [];
  const plan = read(`site/data/plan/${code}.json`);
  const planOk = plan && (plan.status === "ok" || plan.status === "auto");
  const lore = read(`site/data/lore/${code}.json`)?.own ?? [];
  return parts.filter((p) => (p.props.population ?? 0) >= 30).map((p) => {
    const k = p.props.part;
    const f = [`人口 ${p.props.population}人`];
    if (p.props.over65Rate != null) f.push(`65歳以上 ${p.props.over65Rate}%`);
    for (const [kind, v] of Object.entries(fp)) { const r = v.parts?.[k]?.rate; if (r) f.push(`${kind === "土砂" ? "土砂災害警戒区域" : `${kind}で浸かる想定の所`}に住む人 ${r}%`); }
    if (sl[k]?.rate) f.push(`坂が多い所に住む人 ${sl[k].rate}%`);
    if (qk[k]) f.push(`30年以内に震度6強以上の確率 ${qk[k].p60}%`);
    if (ac[k]?.n) f.push(`人身事故 3年で${ac[k].n}件${ac[k].ped ? `（歩行者 ${ac[k].ped}件）` : ""}`);
    const inside = sh.filter((s) => inPoly(s.geometry.coordinates[0], s.geometry.coordinates[1], p.polys));
    if (inside.length) {
      const tsunami = inside.filter((s) => s.properties.kinds.includes("津波"));
      f.push(`地区の中の避難場所 ${inside.length}か所${tsunami.length ? `（津波のときに使える所 ${tsunami.length}か所）` : ""}`);
    }
    // 地区の中の、昔の災害を伝える碑（国土地理院）。昔の災害と、いまの想定をつないで言えるように
    for (const x of lore.filter((x) => inPoly(x.at[0], x.at[1], p.polys))) f.push(`地区の中の碑：「${x.name}」${x.disaster}を伝える碑`);
    if (planOk && plan.parts[k]) f.push(...plan.parts[k].points.slice(0, 2).map((x) => `防災計画より：${x.text}`));
    return { part: k, name: p.props.name, facts: f };
  });
}

export async function hitokoto(code, log = console.log) {
  if (spent(japanDay(new Date().toISOString())) >= DAILY_LIMIT_USD || spent() >= TOTAL_LIMIT_USD) throw new Error("費用の上限に達しています");
  const stats = read("site/data/stats.json");
  const t = stats.towns[code];
  const name = `${t.pref} ${t.name.replace(/^.+?郡(?=.+[町村]$)/, "")}`;
  const list = partFacts(code);
  const client = new Anthropic();
  let usd = 0;
  const out = {};
  for (let i = 0; i < list.length; i += BATCH) {
    const chunk = list.slice(i, i + BATCH);
    const res = await client.messages.create({
      model: MODEL, max_tokens: 3000, output_config: { effort: "low" },
      system: "町・字に住む人に向けて、その地区の暮らしと備えで気をつけたいことを、やさしい短い日本語でまとめます。渡す数だけを使い、数を変えたり計算したり足したりしません。地区を評価したり、怖がらせたりしません。書き方の決まり：避難場所（まず逃げる先）と避難所（あとで過ごす所）を混ぜない。地震の確率には「今後30年に」を付ける。人身事故を「車の事故」と言いかえない。市なら「市」、町なら「町」、村なら「村」と書く。お年寄りは「お年寄り」と書き、数を言う所だけ「65歳以上」。和暦の略（R7年度など）は「令和7年度」と書く。かっこは全角の（）。英語の単語を混ぜない。低い数を「なので」で備えの理由にしない（低くても備える、と書く）。区域の中に住む人に「近づかない」と書かない。本人が経験していない昔のことを「思い出す」と書かない。",
      messages: [{ role: "user", content: `${name}の町・字ごとの数です。\n${chunk.map((x) => `<part id="${x.part}" name="${x.name}">\n${x.facts.map((f) => `- ${f}`).join("\n")}\n</part>`).join("\n")}\n\nそれぞれの町・字について、そこに住む人に向けた「ひとこと」を2〜3文（あわせて90字ほど）で書いてください。特に気をつけたいことを先に、数を1つ以上そのまま使って。地区の中に碑があれば、昔の災害といまの想定をつないでください（碑の名前と年はそのまま）。次の形だけで：\n<hitokoto id="番号">文</hitokoto>` }],
    });
    usd += record(MODEL, res.usage, `わが町のひとこと：${name}`);
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    for (const m of text.matchAll(/<hitokoto id="(\d{4})">([\s\S]*?)<\/hitokoto>/g)) {
      const x = chunk.find((c) => c.part === m[1]);
      if (!x) continue;
      const all = x.facts.join(" ").replace(/,/g, "");
      const nums = (m[2].match(/\d[\d,.]*/g) ?? []).map((v) => v.replace(/,/g, "").replace(/\.$/, ""));
      const bad = nums.filter((v) => !all.includes(v));
      if (!nums.length || bad.length) { log(`  捨てました：${x.name}（${bad.length ? `渡していない数 ${bad.join("・")}` : "数が無い"}）`); continue; }
      out[x.part] = { name: x.name, text: m[2].trim(), facts: x.facts };
    }
    log(`  ${Math.min(i + BATCH, list.length)}/${list.length}（$${usd.toFixed(3)}）`);
  }
  fs.mkdirSync("site/data/hitokoto", { recursive: true });
  fs.writeFileSync(`site/data/hitokoto/${code}.json`, JSON.stringify({
    code, name, createdAt: new Date().toISOString(), model: MODEL, parts: out,
    note: "町・字ごとの国のデータ（年齢・浸水や土砂の想定・坂・揺れ・事故・避難場所・昔の災害を伝える碑）から、AI がまとめたものです。文の中の数は、国のデータと合っているかを確かめています。めやすの数を含みます",
  }, null, 1));
  log(`${name}：町・字 ${Object.keys(out).length} / ${list.length}（$${usd.toFixed(3)}）`);
  return { parts: Object.keys(out).length, usd };
}

if (process.argv[1]?.endsWith("hitokoto.mjs")) for (const c of process.argv.slice(2)) await hitokoto(c);
