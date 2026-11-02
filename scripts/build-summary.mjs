// 日本地図の「数字で並べて探す」に使う、外部のデータの数を全国の市区町村の分だけ小さな1つのファイルにまとめる
//   交通事故（site/data/accidents/、警察庁）・これからの人口（site/data/future.json、社人研）
// 動かし方: npm run build:summary（交通事故・これからの人口を作り直したあとに）
import fs from "node:fs";

const out = {};
const put = (code, k, v) => ((out[code] ??= {})[k] = v);
for (const f of fs.readdirSync("site/data/accidents").filter((x) => /^\d{5}\.json$/.test(x))) {
  const a = JSON.parse(fs.readFileSync(`site/data/accidents/${f}`, "utf8"));
  if (!a.population) continue;
  put(a.code, "accPer1000", a.per1000);
  if (a.ped) put(a.code, "accOldPedShare", Math.round((a.oldPed / a.ped) * 1000) / 10);
}
const fu = JSON.parse(fs.readFileSync("site/data/future.json", "utf8"));
for (const [code, t] of Object.entries(fu.towns)) {
  put(code, "pop2050", Math.round((t.pop[6] / t.pop[0]) * 1000) / 10);
  if (t.old) put(code, "old2050", t.old[6]);
}
fs.writeFileSync("site/data/summary.json", JSON.stringify({
  sources: { accidents: "警察庁 交通事故統計オープンデータ 2022〜2024年を加工", future: fu.source.title },
  towns: out,
}));
console.log(`市区町村 ${Object.keys(out).length}`);
