// 坂の多い所に住む人（めやす）：国土地理院の標高タイル（5m メッシュ、無い所は 10m メッシュ）で、人が住む 250m 四方ごとに
// 中の 6×6 か所の標高から平均の坂のきつさ（勾配、%）を出し、坂の多い四角に住む人・65歳以上を、町・字ごとに足す。Claude は使わない
// 動かし方: npm run build:slope -- 39428
// 標高タイルは local/cache/ にだけ置く。リポジトリには足し上げた数だけを入れる
import fs from "node:fs";
import { PNG } from "pngjs";
import { townMeshes, cached } from "./build-flood-pop.mjs";

const DEMS = [["dem5a_png", 15], ["dem_png", 14]];
const N = 6; // 250m 四方の中を 6×6 か所で見る（およそ 40m おき）
const SLOPE = 5, STEEP = 10; // 平均の勾配 %：5% 以上を「坂が多い」、10% 以上を「急な坂が多い」

const tiles = new Map();
async function elevation(lon, lat) {
  for (const [name, z] of DEMS) {
    const n = 2 ** z;
    const px = ((lon + 180) / 360) * n * 256;
    const r = (lat * Math.PI) / 180;
    const py = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * 256;
    const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
    const key = `${name}/${tx}/${ty}`;
    if (!tiles.has(key)) {
      const buf = await cached(`https://cyberjapandata.gsi.go.jp/xyz/${name}/${z}/${tx}/${ty}.png`, `local/cache/dem/${name}/${z}/${tx}/${ty}.png`);
      tiles.set(key, buf ? PNG.sync.read(buf) : null);
    }
    const png = tiles.get(key);
    if (!png) continue;
    const i = (Math.floor(py - ty * 256) * 256 + Math.floor(px - tx * 256)) * 4;
    const x = png.data[i] * 65536 + png.data[i + 1] * 256 + png.data[i + 2];
    if (x === 2 ** 23) continue; // 値の無い所（海など）
    return (x < 2 ** 23 ? x : x - 2 ** 24) * 0.01;
  }
  return null;
}

export async function buildSlope(code, log = console.log) {
  const { parts, inTown, pop } = await townMeshes(code, log);
  let people = 0, steep = 0, old = 0, oldSteep = 0, oldAll = 0;
  const byPart = {};
  for (const [k, m] of inTown.entries()) {
    const dx = (m.b.w / N) * 111320 * Math.cos(((m.b.lat + m.b.h / 2) * Math.PI) / 180), dy = (m.b.h / N) * 110540; // 1か所の間（m）
    const g = [];
    for (let i = 0; i < N; i++) { const row = []; for (let j = 0; j < N; j++) row.push(await elevation(m.b.lon + ((j + 0.5) / N) * m.b.w, m.b.lat + ((i + 0.5) / N) * m.b.h)); g.push(row); }
    const grades = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (g[i][j] == null) continue;
      if (j + 1 < N && g[i][j + 1] != null) grades.push((Math.abs(g[i][j + 1] - g[i][j]) / dx) * 100);
      if (i + 1 < N && g[i + 1][j] != null) grades.push((Math.abs(g[i + 1][j] - g[i][j]) / dy) * 100);
    }
    if (!grades.length) continue;
    const mean = grades.reduce((s, x) => s + x, 0) / grades.length;
    const bp = (byPart[m.part] ??= { pop: 0, slope: 0 });
    bp.pop += m.pop;
    if (m.old != null) oldAll += m.old;
    if (mean >= SLOPE) { people += m.pop; bp.slope += m.pop; if (m.old != null) old += m.old; }
    if (mean >= STEEP) { steep += m.pop; if (m.old != null) oldSteep += m.old; }
    if (k % 100 === 99) log(`  ${k + 1}/${inTown.length}`);
  }
  const r10 = (v) => Math.round(v / 10) * 10, pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const out = {
    code, createdAt: new Date().toISOString(), population: pop,
    slope: { people: r10(people), rate: pct(people, pop), over65: r10(old), over65Rate: pct(old, oldAll) },
    steep: { people: r10(steep), rate: pct(steep, pop), over65: r10(oldSteep) },
    parts: Object.fromEntries(Object.entries(byPart).filter(([, v]) => v.pop >= 20).map(([k, v]) => [k, { name: parts.find((p) => p.props.part === k)?.props.name, rate: pct(v.slope, v.pop) }])),
    note: `人が住む 250m 四方ごとに、中の 6×6 か所（およそ 40m おき）の標高から平均の坂のきつさを出し、${SLOPE}% 以上を「坂が多い」、${STEEP}% 以上を「急な坂が多い」とした、めやすです（道の坂ではなく、土地の傾き）。人は四角の中に均等に住むとみなしています`,
    sources: [
      { title: "国土地理院 標高タイル（基盤地図情報 数値標高モデル 5m・10m）を加工して作成", url: "https://maps.gsi.go.jp/development/ichiran.html" },
      { title: "国勢調査 2020年 地域メッシュ統計（250m）人口（総務省統計局 e-Stat）", url: "https://www.e-stat.go.jp/gis/statmap-search?page=1&type=1&toukeiCode=00200521&toukeiYear=2020&aggregateUnit=Q" },
    ],
  };
  fs.mkdirSync("site/data/slope", { recursive: true });
  fs.writeFileSync(`site/data/slope/${code}.json`, JSON.stringify(out, null, 1));
  log(`${code}：坂が多い所に住む人 約${out.slope.people}人（${out.slope.rate}%）・65歳以上 約${out.slope.over65}人（65歳以上の${out.slope.over65Rate}%）。急な坂 約${out.steep.people}人`);
  return out;
}

if (process.argv[1]?.endsWith("build-slope.mjs")) for (const c of process.argv.slice(2)) await buildSlope(c);
