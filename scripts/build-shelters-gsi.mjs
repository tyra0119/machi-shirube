// 全国の指定緊急避難場所（国土地理院）を、市区町村ごとの地図用の点にする（町のページの「わが家の避難」）。
// 動かし方: npm run build:shelters-gsi
// 入力 data/raw/gsi-hinan/kinkyu-all.csv（国土地理院「指定緊急避難場所・指定避難所データ」の全国の指定緊急避難場所。
//      https://hinanmap.gsi.go.jp/ で「ご利用上の注意」に同意して取ったもの。国土地理院コンテンツ利用規約）
// 出力 site/data/shelters/{市区町村コード}.json（政令市は住所の区の名前で区ごとに分ける）
// 町のオープンデータ（scripts/build-shelters.mjs で作ったもの）がある町は、そちらを残す（町が出している分、収容人数などが詳しい）
import fs from "node:fs";
import { rows } from "./csv.mjs";

const UPDATED = "2026-10-30"; // ダウンロードの一覧に書かれていた全国データの最終更新日
const towns = JSON.parse(fs.readFileSync("site/data/stats.json", "utf8")).towns;
const R = rows(fs.readFileSync("data/raw/gsi-hinan/kinkyu-all.csv", "utf8"));
const head = R[0];
const col = (n) => head.indexOf(n);
const KINDS = { 洪水: "洪水", 土砂: "崖崩れ、土石流及び地滑り", 高潮: "高潮", 地震: "地震", 津波: "津波", 火事: "大規模な火事", 内水: "内水氾濫", 火山: "火山現象" };

// 政令市の区：市のコード → [[区のコード, "札幌市中央区"]]
const wardsOf = (city) => Object.entries(towns).filter(([c, t]) => t.ward && c > city && Number(c) - Number(city) < 30 && t.pref === towns[city]?.pref)
  .map(([c, t]) => [c, t.name]);

const byMuni = new Map();
let unassigned = 0;
for (const r of R.slice(1)) {
  let code = r[col("共通ID")].slice(1, 6);
  const address = r[col("住所")];
  if (towns[code] && !towns[code].ward && wardsOf(code).length) {
    const w = wardsOf(code).find(([, name]) => address.includes(name));
    if (!w) { unassigned++; continue; }
    code = w[0];
  }
  if (!byMuni.has(code)) byMuni.set(code, []);
  byMuni.get(code).push({
    type: "Feature",
    geometry: { type: "Point", coordinates: [Math.round(Number(r[col("経度")]) * 1e6) / 1e6, Math.round(Number(r[col("緯度")]) * 1e6) / 1e6] },
    properties: {
      id: r[col("共通ID")],
      name: r[col("施設・場所名")],
      address,
      kinds: Object.entries(KINDS).filter(([, c]) => r[col(c)] === "1").map(([k]) => k),
      note: r[col("備考")]?.replace(/\s+/g, " ").trim() || undefined,
    },
  });
}

const source = {
  title: "指定緊急避難場所データ（国土地理院）",
  url: "https://www.gsi.go.jp/bousaichiri/hinanbasho.html",
  license: "国土地理院コンテンツ利用規約",
  fetchedAt: "2026-11-02",
  updated: UPDATED,
  gsi: true,
};
let written = 0, kept = 0, points = 0;
for (const [code, features] of byMuni) {
  const out = `site/data/shelters/${code}.json`;
  if (fs.existsSync(out) && !JSON.parse(fs.readFileSync(out, "utf8")).source.gsi) { kept++; continue; }
  fs.writeFileSync(out, JSON.stringify({ source, type: "FeatureCollection", features }));
  written++;
  points += features.length;
}
console.log(`避難場所 ${R.length - 1}・市区町村 ${byMuni.size}（書いた ${written}・町のデータを残した ${kept}）・点 ${points}・区の分からないもの ${unassigned}`);
for (const c of ["39428", "10524", "11227", "28109", "14101"]) console.log(c, byMuni.get(c)?.length);
