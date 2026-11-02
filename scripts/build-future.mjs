// これからの人口：国立社会保障・人口問題研究所「日本の地域別将来推計人口（令和5(2023)年推計）」の結果表から、
// 全国の市区町村の総人口（2020〜2050年、5年ごと）と65歳以上の割合を、小さな1つのファイルにまとめる。Claude は使わない
// 動かし方: npm run build:future（先に local/cache/ipss/ に kekkahyo1.xlsx と kekkahyo3_3.xlsx を置く）
//   取る所：https://www.ipss.go.jp/pp-shicyoson/j/shicyoson23/t-page.asp の「結果表1」「結果表3_3」
import fs from "node:fs";
import ExcelJS from "exceljs";

async function rows(file) {
  const w = new ExcelJS.Workbook();
  await w.xlsx.readFile(file);
  const out = [];
  w.worksheets[0].eachRow((r, i) => {
    if (i < 6) return;
    const v = r.values.slice(1).map((x) => (x?.result != null ? x.result : x));
    if (/^\d{4,5}$/.test(String(v[0] ?? ""))) out.push(v);
  });
  return out;
}

const pop = await rows("local/cache/ipss/kekkahyo1.xlsx");
const old = new Map((await rows("local/cache/ipss/kekkahyo3_3.xlsx")).map((v) => [String(v[0]).padStart(5, "0"), v]));
const towns = {};
let nation = [0, 0, 0, 0, 0, 0, 0], nationOld = [0, 0, 0, 0, 0, 0, 0];
for (const v of pop) {
  const code = String(v[0]).padStart(5, "0");
  const p = v.slice(4, 11).map(Number);
  const o = old.get(code)?.slice(4, 11).map(Number);
  if (v[1] === "a") { // 都道府県の行を足して全国にする
    p.forEach((x, i) => (nation[i] += x));
    if (o) o.forEach((x, i) => (nationOld[i] += (x / 100) * p[i]));
    continue;
  }
  if (!p.every((x) => x > 0)) continue;
  towns[code] = { pop: p, old: o ? o.map((x) => Math.round(x * 10) / 10) : null };
}
const out = {
  years: [2020, 2025, 2030, 2035, 2040, 2045, 2050],
  nation: { pop: nation, old: nationOld.map((x, i) => Math.round((x / nation[i]) * 1000) / 10) },
  towns,
  source: { title: "国立社会保障・人口問題研究所「日本の地域別将来推計人口（令和5(2023)年推計）」結果表1・結果表3-3 を加工して作成", url: "https://www.ipss.go.jp/pp-shicyoson/j/shicyoson23/t-page.asp" },
  note: "2020年の国勢調査をもとにした推計で、これまでの出生・死亡・引っ越しの傾向が続いた場合の姿です。福島県の浜通りの13市町村は、個別の推計がありません",
};
fs.writeFileSync("site/data/future.json", JSON.stringify(out));
console.log(`市区町村 ${Object.keys(towns).length}・全国 2050年 ${nation[6].toLocaleString("ja-JP")} 人（65歳以上 ${out.nation.old[6]}%）`);
