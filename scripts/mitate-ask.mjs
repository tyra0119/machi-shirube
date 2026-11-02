// 見立てを手がかりに調べる：届きにくい人の見立て（site/data/mitate/{コード}.json）の1人ずつについて、
// 「その人のための町の支援や窓口」を調べる問いを Claude（Sonnet）に作らせる。その町に当てはまる物差しの問いで、もう聞いているものがあれば、それを使う。
// 新しい問いは、その町だけの問い（only）として物差しに足し、見立ての人に問いの番号を結ぶ。調べるのは research.mjs（採点と探し直しつき）
// 動かし方: npm run mitate-ask -- 10524 のあと npm run research -- 10524 --all
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { record, spent, japanDay, DAILY_LIMIT_USD, TOTAL_LIMIT_USD } from "../src/cost.mjs";

const MODEL = "claude-sonnet-5-5";
const PAGES = ["bousai", "komatta", "gomi", "tetsuzuki", "foreign", "iryo", "koutsuu", "kosodate", "kaigo", "okane", "shisetsu", "shiru", "keikaku"];
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

export async function mitateAsk(code, log = console.log) {
  if (spent(japanDay(new Date().toISOString())) >= DAILY_LIMIT_USD || spent() >= TOTAL_LIMIT_USD) throw new Error("費用の上限に達しています");
  const mfile = `site/data/mitate/${code}.json`;
  const m = read(mfile);
  const yfile = "site/data/yardstick.json";
  const y = read(yfile);
  const feats = read("site/data/features.json")?.towns?.[code] ?? [];
  const mine = y.questions.filter((q) => q.level !== "town" && (!q.only || q.only === code) && (!q.feature || feats.includes(q.feature)));
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL, max_tokens: 3000, output_config: { effort: "medium" },
    system: "町の公式のページから調べる問いを作ります。問いは、その人のために町（や県・社会福祉協議会など公の機関）がしている支援・窓口・制度を、出典つきで答えられる形にします。町を評価する問いや、町の公式のページで答えられない問いは作りません。",
    messages: [{ role: "user", content: `町：${m.name}\n\nこの町で、暮らしの情報が届きにくいと見立てた人：\n${m.who.map((w, i) => `<who id="${i}">\n人：${w.person}\n壁：${w.wall}\n理由：${w.why}\n</who>`).join("\n")}\n\nこの町で、もう聞いている問い：\n${mine.map((q) => `${q.id} ${q.short}：${q.text}`).join("\n")}\n\nそれぞれの人について、「その人が壁を越えるための、町の支援や窓口」を調べる問いを1つ決めてください。もう聞いている問いで足りるなら、その番号を使ってください（新しく作らない）。足りないときだけ、新しい問いを作ります。次の形だけで：\n<ask id="人の番号">\n<use>もう聞いている問いの番号（使うときだけ）</use>\n<text>新しい問い（80字ほど。窓口・申し込み方・連絡先を聞く形で）</text>\n<short>見出し（15字まで）</short>\n<page>載せるページ：${PAGES.join("・")} のどれか</page>\n</ask>` }],
  });
  const usd = record(MODEL, res.usage, `見立てから問いを作る：${m.name}`);
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let next = Math.max(...y.questions.map((q) => Number(q.id.slice(1)) || 0)) + 1;
  const made = [];
  for (const a of text.matchAll(/<ask id="(\d+)">([\s\S]*?)<\/ask>/g)) {
    const w = m.who[Number(a[1])];
    if (!w) continue;
    const g = (tag) => a[2].match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? "";
    const use = g("use").match(/[QT]\d+/)?.[0];
    if (use && mine.some((q) => q.id === use)) { w.ask = use; log(`  ${w.person} → もう聞いている ${use}`); continue; }
    const q = { id: `Q${next++}`, group: "見立てから", page: PAGES.includes(g("page")) ? g("page") : "komatta", short: g("short").slice(0, 20), text: g("text"), only: code,
      origin: { from: m.name, mitate: m.createdAt, who: w.person, at: new Date().toISOString(), why: `見立て「${w.person}（${w.wall}）」の人のための町の支援や窓口を調べる` } };
    if (!q.text || !q.short) { log(`  ${w.person}：問いを読めなかった`); continue; }
    y.questions.push(q);
    w.ask = q.id;
    made.push(q);
    log(`  ${w.person} → 新しい問い ${q.id}「${q.short}」：${q.text}`);
  }
  if (made.length) { y.version += 1; fs.writeFileSync(yfile, JSON.stringify(y, null, 1)); }
  fs.writeFileSync(mfile, JSON.stringify(m, null, 1));
  log(`${m.name}：新しい問い ${made.length}（$${usd.toFixed(3)}）`);
  return { made, usd };
}

if (process.argv[1]?.endsWith("mitate-ask.mjs")) for (const c of process.argv.slice(2)) await mitateAsk(c);
