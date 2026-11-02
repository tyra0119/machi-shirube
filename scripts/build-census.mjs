// 国勢調査2020 の世帯と住まいの数を、47都道府県ぶん取って市区町村ごとにまとめる。
// 動かし方: npm run build:census（数分かかる。取ったものは data/raw/estat/ に残り、2回目からは取らない）
// 出力は data/census-munis.json（市区町村コード5けた → 数）。割合は npm run build:stats で計算する
import fs from "node:fs";
import { householdCounts } from "./estat.mjs";

const out = {};
for (let p = 1; p <= 47; p++) {
  const pref = String(p).padStart(2, "0");
  const counts = await householdCounts(pref);
  let n = 0;
  for (const [key, c] of counts) {
    if (key.length !== 5) continue;
    out[key] = c;
    n++;
  }
  console.log(`${pref}: 市区町村 ${n}`);
}
fs.writeFileSync("data/census-munis.json", JSON.stringify(out));
console.log(`書き出した市区町村 ${Object.keys(out).length}`);
