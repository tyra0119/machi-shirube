// 避難場所の「建物の中に入れる人数」：町のオープンデータの想定収容人数は、屋内と屋外（校庭や広場）の合計のことがある。
// 地域防災計画の資料編の表（収容者数 屋内・屋外・合計）を PC で読み、名前と合計が合う行から「建物の中」の人数を拾って、避難場所のデータに足す。
// Claude は使わない。計画の PDF は local/cache/plans/ にあるもの（scripts/plan-excerpts.mjs が取ったもの）
// 動かし方: npm run build:shelter-inside -- 39428
import fs from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const PLANS = { 39428: "local/cache/plans/tiiki-bousaikeikaku-siryou202603.pdf" };
const flat = (s) => s.normalize("NFKC").replace(/[\s　]+/g, "");

export async function buildShelterInside(code, log = console.log) {
  const pdf = PLANS[code];
  if (!pdf || !fs.existsSync(pdf)) throw new Error("この町の防災計画の資料編が手元にありません");
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), verbosity: 0 }).promise;
  // 表の行：「名前 住所 ○ … 面積 ㎡ 面積 ㎡ 屋内 人 屋外 人 合計 人」
  const rows = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const t = (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ").replace(/[ ]+/g, " ");
    for (const m of t.matchAll(/([0-9]+) 人 ([0-9]+) 人 ([0-9]+) 人/g)) {
      const [a, b, sum] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (a + b === sum) rows.push({ page: i, before: flat(t.slice(Math.max(0, m.index - 160), m.index)), inside: a, outside: b, sum });
    }
  }
  const file = `site/data/shelters/${code}.json`;
  const sh = JSON.parse(fs.readFileSync(file, "utf8"));
  let hit = 0;
  for (const f of sh.features) {
    const p = f.properties;
    const cap = Number(String(p.capacity ?? "").replace(/[^0-9]/g, ""));
    if (!cap) continue;
    // 名前（「黒潮町立」などを外したもの）が行の前にあり、合計が想定収容人数と同じ行
    const name = flat(p.name).replace(/^黒潮町立/, "");
    const r = rows.find((x) => x.sum === cap && x.before.includes(name));
    if (r) { p.inside = r.inside; hit++; } else delete p.inside;
  }
  sh.insideSource = { title: "黒潮町地域防災計画（令和8年3月）資料編の、避難場所の表（収容者数 屋内）", note: "町のオープンデータの想定収容人数と合計が合う行だけ" };
  fs.writeFileSync(file, JSON.stringify(sh));
  log(`${code}：建物の中の人数が分かった避難場所 ${hit} / 人数のある ${sh.features.filter((f) => f.properties.capacity).length}`);
}

if (process.argv[1]?.endsWith("build-shelter-inside.mjs")) for (const c of process.argv.slice(2)) await buildShelterInside(c);
