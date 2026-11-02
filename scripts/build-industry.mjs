// 市区町村ごとの、働く人の産業の割合（国勢調査2020 小地域集計 第11表「男女，産業（大分類）別就業者数（15歳以上）」）。
// 動かし方: npm run build:industry（47都道府県ぶん取る。取ったものは data/raw/estat/ に残り、2回目からは取らない）
// 出力 site/data/industry.json：コード → 働く人・農業林業・漁業の割合。全国で高いほうから何%か（町の特徴のページを出すかの決まりに使う）
import fs from "node:fs";
import { smallAreaTable, num } from "./estat.mjs";

const TITLE = "男女，産業（大分類）別就業者数（15歳以上）－町丁・字等";
const towns = {};
for (let p = 1; p <= 47; p++) {
  const pref = String(p).padStart(2, "0");
  const t = await smallAreaTable(pref, TITLE, "industry");
  let n = 0;
  for (const r of t) {
    // 列：0 男女・1 市区町村コード・3 段（1 市区町村）・4 秘匿・11 総数・12 農業，林業・13 うち農業・14 漁業
    if (r[0] !== "総数" || r[3] !== "1" || !/^\d{5}$/.test(r[1]) || r[4]) continue;
    const all = num(r[11]);
    if (!all) continue;
    const pct = (v) => Math.round((num(v) / all) * 1000) / 10;
    towns[r[1]] = { workers: all, agri: pct(r[12]), farm: pct(r[13]), fish: pct(r[14]) };
    n++;
  }
  console.log(`${pref}: 市区町村 ${n}`);
}
// 全国で高いほうから何%か（政令市の区も1つと数える）
for (const k of ["agri", "fish"]) {
  const vals = Object.values(towns).map((t) => t[k]).sort((a, b) => b - a);
  for (const t of Object.values(towns)) t[`${k}Top`] = Math.round((vals.filter((v) => v > t[k]).length / vals.length) * 1000) / 10;
}
fs.writeFileSync("site/data/industry.json", JSON.stringify({
  source: { title: "令和2年国勢調査 小地域集計 第11表 男女，産業（大分類）別就業者数（15歳以上）（総務省統計局、e-Stat）", asOf: "2020年10月1日", license: "政府標準利用規約（第2.0版）準拠・CC BY 4.0 互換" },
  towns,
}));
const k = towns["39428"];
console.log(`市区町村 ${Object.keys(towns).length}・黒潮町 農業林業 ${k.agri}%（上から ${k.agriTop}%）・漁業 ${k.fish}%（上から ${k.fishTop}%）`);
