// 町のページの決まった文字の辞書（見出し・注意書き・ボタンなど）を、ほかの言葉に訳す。手元の PC だけで動く。
// 動かし方: npm run i18n -- pt,es,en,easy
// 見出し語：site/data/i18n/keys-page.json（ページから集めた決まった文字）と、site/*.js の T("…") の文字
// Claude（Sonnet）が訳し、別の Claude（Haiku）が日本語に訳し戻して確かめる。ずれた文字は辞書に入れない（日本語のまま出す）
// 出力 site/data/i18n/{言葉}.json
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { record } from "../src/cost.mjs";
import { LANGS, checkLang } from "./translate.mjs";

const MODEL = "claude-sonnet-5-5";
const between = (t, tag) => t.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
const textOf = (res) => res.content.filter((b) => b.type === "text").map((b) => b.text).join("");

const keys = new Set(JSON.parse(fs.readFileSync("site/data/i18n/keys-page.json", "utf8")));
for (const f of fs.readdirSync("site").filter((x) => x.endsWith(".js"))) {
  for (const m of fs.readFileSync(`site/${f}`, "utf8").matchAll(/T\("([^"]+)"\)/g)) keys.add(m[1]);
  // 数などの入る文（TN("…{m}…", { m })。i18n.js）も
  for (const m of fs.readFileSync(`site/${f}`, "utf8").matchAll(/TN\("([^"]+)",/g)) keys.add(m[1]);
}
for (const k of ["日本語", "（AI による訳）"]) keys.add(k);
const list = [...keys];
console.log(`見出し語 ${list.length}`);

const client = new Anthropic();
const langs = (process.argv[2] ?? "pt,es,en,easy").split(",");
let usd = 0;
for (const lang of langs) {
  const L = LANGS[lang];
  // すでに訳して確かめた文字は飛ばし、足した文字だけを訳す
  const file = `site/data/i18n/${lang}.json`;
  const dict = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).dict : {};
  const todo = list.filter((k) => !dict[k]);
  console.log(`${L.ja}：訳す文字 ${todo.length}（すでにある ${list.length - todo.length}）`);
  for (let i = 0; i < todo.length; i += 60) {
    const part = todo.slice(i, i + 60).map((ja, j) => ({ id: String(i + j), ja }));
    const res = await client.messages.create({
      model: MODEL, max_tokens: 12000,
      system: `町の暮らしの案内のウェブページの、画面の決まった文字（見出し・ボタン・注意書き）を訳します。
- ${lang === "easy" ? "やさしい日本語にしてください。短い文、むずかしい漢字にはひらがなで読みを（ ）でつけ、むずかしい言葉は言いかえる" : `${L.ja}（${L.name}）に訳してください。短く、画面のボタンや見出しに合う言い方で`}
- <strong> などの HTML の印はそのまま残す。{m} や {name} のような { } の印も、そのまま残す（あとで数や名前が入る）。数字・119・記号もそのまま
- 意味を変えず、足さず、減らさない
- 1件ずつ <item id="番号">訳</item> の形だけで答えてください`,
      messages: [{ role: "user", content: part.map((x) => `<item id="${x.id}">${x.ja}</item>`).join("\n") }],
    });
    usd += record(MODEL, res.usage, `画面の文字を訳す（${L.ja}）`);
    const got = Object.fromEntries([...textOf(res).matchAll(/<item id="(\d+)">([\s\S]*?)<\/item>/g)].map(([, id, t]) => [id, t.trim()]));
    const { checks, usd: u } = await checkLang(client, part.filter((x) => got[x.id]).map((x) => ({ id: x.id, original: x.ja, translation: got[x.id] })), `画面の文字（${L.ja}）`);
    usd += u;
    for (const x of part) {
      const c = checks.find((k) => k.id === x.id);
      if (got[x.id] && c?.ok) dict[x.ja] = got[x.id];
      else if (got[x.id]) console.log(`  ずれ（日本語のまま）：${x.ja.slice(0, 30)} → ${got[x.id].slice(0, 30)}（${c?.problems?.join("・") ?? "確かめられなかった"}）`);
    }
  }
  fs.writeFileSync(file, JSON.stringify({ lang, name: L.name, createdAt: new Date().toISOString(), model: MODEL, checker: "claude-haiku-5-5", count: Object.keys(dict).length, of: list.length, dict }, null, 1));
  console.log(`${L.ja}：${Object.keys(dict).length} / ${list.length}`);
}
console.log(`合計 $${usd.toFixed(3)}`);
