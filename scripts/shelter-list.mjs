// 避難施設の一覧（町の地域防災計画の資料の表）を、Claude に読ませて行ごとに抜き出す。
// 災害の種類ごとの指定緊急避難場所の一覧（位置つき）が国にも町にも無い町のため（阿賀町）。
// 位置は作らない（山あいの番地は住所から正しい位置を出せず、避難の距離をまちがえるため）。行政区ごとの一覧として出す
// 動かし方: node --env-file=.env scripts/shelter-list.mjs <市区町村コード> <PDF の手元の道> <PDF の URL> <資料の名前> <時点> <ページ…>
// 出力は local/shelter-list/{コード}.json（作者が確かめる前のもの）。作者が OK したら site/data/shelter-list/ に写す
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { record } from "../src/cost.mjs";

const MODEL = "claude-sonnet-5-5";
const [code, file, url, title, asOf, ...pageArgs] = process.argv.slice(2);
const pages = pageArgs.map(Number);
if (!/^\d{5}$/.test(code ?? "") || !fs.existsSync(file ?? "") || !pages.length) throw new Error("コード・PDF・ページを渡してください");

const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true }).promise;
const text = {};
for (const p of pages) text[p] = (await (await doc.getPage(p)).getTextContent()).items.map((x) => x.str).join("");

const prompt = `次は、町の地域防災計画の資料にある「避難施設」の表を、PDF から文字だけ取り出したものです。表の線が消えて、行がつながっています。
1行ずつ、次の形の JSON の配列にしてください。資料に書いてある文字をそのまま使い、足したり言いかえたりしないでください。
{"page": ページ, "area": "行政区（例：奥田区。いくつかの区をまとめた行は、そのまま「津川1～4区」）", "name": "施設名", "address": "所在地", "tel": "テレビ電話の番号（無ければ \\"\\"。「－」も \\"\\"）", "capacity": 収容人員の数, "note": "備考（広域避難所・福祉避難所など。無ければ \\"\\"）"}
行政区の欄が空の行は、すぐ上の行の行政区と同じです。表の見出しの行は入れないでください。JSON の配列だけを答えてください。

${pages.map((p) => `--- ページ ${p} ---\n${text[p]}`).join("\n\n")}`;

const client = new Anthropic();
const res = await client.messages.create({ model: MODEL, max_tokens: 16000, messages: [{ role: "user", content: prompt }] });
const usd = record(MODEL, res.usage, `避難施設の一覧を読む：${code}`);
const out = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
const rows = JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1));

// PC で照らす：施設名と所在地が、そのページの文字にそのままあるか（空白は無視）
const flat = (s) => String(s ?? "").replace(/\s/g, "");
const bad = [];
for (const r of rows) {
  const t = flat(text[r.page]);
  for (const k of ["name", "address", "area"]) if (!t.includes(flat(r[k]))) bad.push({ ...r, why: `${k} が資料に無い` });
  if (r.tel && !t.includes(flat(r.tel))) bad.push({ ...r, why: "tel が資料に無い" });
  if (!t.includes(String(r.capacity))) bad.push({ ...r, why: "capacity が資料に無い" });
}
fs.mkdirSync("local/shelter-list", { recursive: true });
const result = { code, source: { title, url, asOf, pages }, createdAt: new Date().toISOString(), rows, bad };
fs.writeFileSync(`local/shelter-list/${code}.json`, JSON.stringify(result, null, 1));
console.log(`${rows.length} 行・照らせなかったもの ${bad.length}・$${usd.toFixed(3)}`);
for (const b of bad) console.log("  ", b.why, b.name, b.address);
