// 町の気候（平年値）：国土数値情報「平年値メッシュ」（2022年度版、1km 四方。気象庁の過去30年の観測から）を、
// 人が住む 250m 四方の人口で重みをつけて町の値にし、東京都心（千代田区）の値と並べる。明るい話題（日がよく当たる・冬も暖かい）にも使う。
// Claude は使わない（PC の計算だけ）。利用条件は「非商用」（作者が使ってよいとした。2026-11-03）
// 動かし方: npm run build:climate -- 39428
// 平年値メッシュの zip は local/cache/g02/ にだけ置く
import fs from "node:fs";
import AdmZip from "adm-zip";
import { townMeshes, cached } from "./build-flood-pop.mjs";

const TOKYO = "53394611"; // 東京都千代田区（皇居の東）の 1km 四方
const meshCache = new Map();
async function meshes1(m1) {
  if (!meshCache.has(m1)) {
    const buf = await cached(`https://nlftp.mlit.go.jp/ksj/gml/data/G02/G02-22/G02-22_${m1}-jgd_GML.zip`, `local/cache/g02/G02-22_${m1}.zip`);
    const map = new Map();
    if (buf) {
      const g = JSON.parse(new AdmZip(buf).getEntries().find((e) => e.entryName.endsWith(".geojson")).getData().toString("utf8"));
      for (const f of g.features) {
        const p = f.properties;
        const ok = (v) => (v == null || v >= 99999 ? null : v); // 999999 は「値なし」（雪なら、雪の平年値を出していない暖かい所）
        map.set(String(p.G02_001), { sun: ok(p.G02_071) / 10, jan: ok(p.G02_017) / 10, aug: ok(p.G02_038) / 10, rain: ok(p.G02_014) / 10, snow: ok(p.G02_058) });
      }
    }
    meshCache.set(m1, map);
  }
  return meshCache.get(m1);
}
const at = async (code3) => (await meshes1(code3.slice(0, 4))).get(code3);

export async function buildClimate(code, log = console.log) {
  const { inTown } = await townMeshes(code, log);
  const sum = { sun: 0, jan: 0, aug: 0, rain: 0, snow: 0 }, w = { sun: 0, jan: 0, aug: 0, rain: 0, snow: 0 };
  for (const m of inTown) {
    const v = await at(m.code.slice(0, 8)); // 250m 四方のコードの頭8桁が、それを含む 1km 四方
    if (!v) continue;
    for (const k of Object.keys(sum)) if (v[k] != null && !Number.isNaN(v[k])) { sum[k] += v[k] * m.pop; w[k] += m.pop; }
  }
  if (!w.sun) throw new Error("平年値が見つかりませんでした");
  const town = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, w[k] ? Math.round((v / w[k]) * 10) / 10 : null]));
  const tokyo = await at(TOKYO);
  // 明るい話題（PC の決まりで言う。良い所だけ）
  const bright = [];
  if (town.sun - tokyo.sun >= 100) bright.push(`日の当たる時間が、東京都心より年に約${Math.round((town.sun - tokyo.sun) / 10) * 10}時間長い`);
  if (town.jan - tokyo.jan >= 0.5) bright.push(`1月の平均気温が、東京都心より約${(town.jan - tokyo.jan).toFixed(1)}℃高い（冬も比べて暖かい）`);
  if (tokyo.aug - town.aug >= 0.5) bright.push(`8月の平均気温が、東京都心より約${(tokyo.aug - town.aug).toFixed(1)}℃低い（夏は比べて涼しい）`);
  const out = {
    code, createdAt: new Date().toISOString(), town, tokyo: { ...tokyo, name: "東京都心（千代田区）" }, bright,
    note: "気象庁の過去30年（1991〜2020年）の観測から 1km 四方ごとに推定した平年値を、人が住む所の人口で重みをつけて町の値にした、めやすです",
    sources: [
      { title: "国土数値情報（平年値メッシュデータ、2022年度）国土交通省 を加工して作成（非商用）", url: "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-G02-2022.html" },
      { title: "国勢調査 2020年 地域メッシュ統計（250m）人口（総務省統計局 e-Stat）", url: "https://www.e-stat.go.jp/gis/statmap-search?page=1&type=1&toukeiCode=00200521&toukeiYear=2020&aggregateUnit=Q" },
    ],
  };
  fs.mkdirSync("site/data/climate", { recursive: true });
  fs.writeFileSync(`site/data/climate/${code}.json`, JSON.stringify(out, null, 1));
  log(`${code}：日照 ${town.sun}時間（東京 ${tokyo.sun}）・1月 ${town.jan}℃（${tokyo.jan}）・8月 ${town.aug}℃（${tokyo.aug}）・年降水量 ${town.rain}mm・最深積雪 ${town.snow}cm。${bright.join("／") || "明るい話題なし"}`);
  return out;
}

if (process.argv[1]?.endsWith("build-climate.mjs")) for (const c of process.argv.slice(2)) await buildClimate(c);
