// 市区町村の読みがなとローマ字（日本地図の画面の「町の名前で探す」で、かなやローマ字でも探せるように）。
// もとは気象庁の地域の表（data/raw/jma-area.json の class20s。天気の地域を決めるのに使っているもの）の kana と enName。
// 出力 site/data/muni-kana.json：コード → [読みがな, ローマ字（小文字・長音の印なし・「City」などを外したもの）]
// （住む人の目で見ると、「しらたか」「おおいずみ」「Oizumi」で探しても「見つかりません」だった）
// 動かし方: node scripts/build-kana.mjs
import fs from "node:fs";

const area = JSON.parse(fs.readFileSync("data/raw/jma-area.json", "utf8")).class20s;
const out = {};
for (const [k, v] of Object.entries(area)) {
  const code = k.slice(0, 5);
  if (out[code] || !v.kana) continue;
  const roma = String(v.enName ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+(City|Town|Village|Ward)$/i, "").toLowerCase();
  out[code] = [v.kana, roma];
}
fs.writeFileSync("site/data/muni-kana.json", JSON.stringify(out));
console.log(`市区町村の読み：${Object.keys(out).length} → site/data/muni-kana.json`);
