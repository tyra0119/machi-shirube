// 地震の揺れの確率と住む人（めやす）：防災科研 J-SHIS の確率論的地震動予測地図（250m 四方。今後30年に震度6弱以上・6強以上の揺れに見舞われる確率）を、
// 町の中で人が住む 250m 四方ごとに取り、人の数で重みをつけて町・字ごとにまとめる。Claude は使わない（PC の計算だけ）
// 動かし方: npm run build:quake-pop -- 39428
// J-SHIS の値そのものは local/cache/ にだけ置く（利用規約：加工した成果は配ってよいが、そのままの複製は配らない）
import fs from "node:fs";
import { townMeshes, cached } from "./build-flood-pop.mjs";

const VERSION = "Y2024"; // 地震動予測地図 2024年版
const api = (lon, lat) => `https://www.j-shis.bosai.go.jp/map/api/pshm/${VERSION}/AVR/TTL_MTTL/meshinfo.geojson?position=${lon.toFixed(5)},${lat.toFixed(5)}&epsg=4326`;

export async function buildQuakePop(code, log = console.log) {
  const { parts, inTown, pop } = await townMeshes(code, log);
  const rows = [];
  for (const [i, m] of inTown.entries()) {
    const buf = await cached(api(m.b.lon + m.b.w / 2, m.b.lat + m.b.h / 2), `local/cache/jshis/${VERSION}/${m.code}.json`);
    const p = buf && JSON.parse(buf.toString("utf8")).features?.[0]?.properties;
    if (p?.T30_I55_PS != null) rows.push({ ...m, p55: Number(p.T30_I55_PS), p60: Number(p.T30_I60_PS) });
    if (i % 100 === 99) log(`  ${i + 1}/${inTown.length}`);
  }
  const wavg = (list, k) => list.reduce((s, m) => s + m[k] * m.pop, 0) / list.reduce((s, m) => s + m.pop, 0);
  const pct = (v) => Math.round(v * 1000) / 10;
  const r10 = (v) => Math.round(v / 10) * 10;
  const byPart = {};
  for (const m of rows) (byPart[m.part] ??= []).push(m);
  // 確率の高さの段ごとに住む人（6弱以上）
  const BANDS = [[0.26, "26%以上（非常に高い）"], [0.06, "6〜26%（高い）"], [0.03, "3〜6%（やや高い）"], [0, "3%未満"]];
  const bands = Object.fromEntries(BANDS.map(([, l]) => [l, 0]));
  for (const m of rows) bands[BANDS.find(([v]) => m.p55 >= v)[1]] += m.pop;
  const out = {
    code, version: VERSION, createdAt: new Date().toISOString(), population: pop,
    p55: pct(wavg(rows, "p55")), p60: pct(wavg(rows, "p60")),
    max55: pct(Math.max(...rows.map((m) => m.p55))), min55: pct(Math.min(...rows.map((m) => m.p55))),
    bands: Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, r10(v)]).filter(([, v]) => v > 0)),
    parts: Object.fromEntries(Object.entries(byPart).map(([k, l]) => [k, { name: parts.find((p) => p.props.part === k)?.props.name, p55: pct(wavg(l, "p55")), p60: pct(wavg(l, "p60")) }])),
    note: "人が住む 250m 四方ごとの確率を、住む人の数で重みをつけて平均した、めやすです（今後30年に、その場所が震度6弱以上・6強以上の揺れに見舞われる確率。すべての地震を合わせた平均の場合）。地盤の揺れやすさも入っています",
    sources: [
      { title: "防災科学技術研究所 J-SHIS 確率論的地震動予測地図（2024年版）を加工して作成", url: "https://www.j-shis.bosai.go.jp/" },
      { title: "国勢調査 2020年 地域メッシュ統計（250m）人口（総務省統計局 e-Stat）", url: "https://www.e-stat.go.jp/gis/statmap-search?page=1&type=1&toukeiCode=00200521&toukeiYear=2020&aggregateUnit=Q" },
    ],
  };
  fs.mkdirSync("site/data/quake-pop", { recursive: true });
  fs.writeFileSync(`site/data/quake-pop/${code}.json`, JSON.stringify(out, null, 1));
  log(`${code}：震度6弱以上 ${out.p55}%・6強以上 ${out.p60}%（住む人で重みをつけた平均。町の中で ${out.min55}〜${out.max55}%）`);
  return out;
}

if (process.argv[1]?.endsWith("build-quake-pop.mjs")) for (const c of process.argv.slice(2)) await buildQuakePop(c);
