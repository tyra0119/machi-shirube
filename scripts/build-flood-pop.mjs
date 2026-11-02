// 浸水が想定される所に住む人（めやす）：250m 四方ごとの人口（国勢調査 2020年の地域メッシュ）に、
// その四角の中で浸水が想定される場所の割合（ハザードマップポータルサイトの想定の地図の色）を掛けて、町・字ごとに足す。
// 公式には公表の無い数なので、ページでは「めやす」と書く。Claude は使わない（PC の計算だけ）
// 動かし方: npm run build:flood-pop -- 39428
// 取ったもの（メッシュの表・地図の絵）は local/cache/ にだけ置く。リポジトリに入れるのは足し上げた数だけ
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { PNG } from "pngjs";

const UA = "machi-shirube/0.1 (+https://github.com/tyra0119/machi-shirube)";
const KINDS = {
  津波: "https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png",
  洪水: "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png",
};
// 凡例の色 → 浸水の深さ（site/hazard.js と同じ。ハザードマップポータルサイトの凡例 shinsui_legend3）
const DEPTH_COLORS = [
  [[255, 255, 179], "0.3m 未満"], [[247, 245, 169], "0.3〜0.5m"], [[248, 225, 166], "0.5〜1m"], [[255, 216, 192], "1〜3m"],
  [[255, 183, 183], "3〜5m"], [[255, 145, 145], "5〜10m"], [[242, 133, 201], "10〜20m"], [[220, 122, 220], "20m 以上"],
];
const Z = 15; // 1画素 およそ 4m
const STEP = 5; // 250m 四方の中を 5×5 か所で見る

let last = 0;
async function polite(url) {
  const wait = last + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  return fetch(url, { headers: { "User-Agent": UA } });
}
async function cached(url, file) {
  if (fs.existsSync(file)) return fs.readFileSync(file);
  if (fs.existsSync(file + ".none")) return null;
  const res = await polite(url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!res.ok) { fs.writeFileSync(file + ".none", String(res.status)); return null; }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

// TopoJSON の町・字の形をほどく（site/data/towns/{コード}.json）
function polygonsOf(topo) {
  const { scale, translate } = topo.transform;
  const arcs = topo.arcs.map((a) => { let x = 0, y = 0; return a.map(([dx, dy]) => [(x += dx) * scale[0] + translate[0], (y += dy) * scale[1] + translate[1]]); });
  const ring = (ids) => ids.flatMap((i, k) => { const a = i < 0 ? [...arcs[~i]].reverse() : arcs[i]; return k ? a.slice(1) : a; });
  return Object.values(topo.objects)[0].geometries.map((g) => ({
    props: g.properties,
    polys: (g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : []).map((p) => p.map(ring)),
  }));
}
function inRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPoly = (x, y, polys) => polys.some(([outer, ...holes]) => inRing(x, y, outer) && !holes.some((h) => inRing(x, y, h)));

// 地域メッシュのコード（250m＝5次メッシュ、10桁）→ 南西の角と大きさ
function meshBox(code) {
  const s = String(code);
  let lat = Number(s.slice(0, 2)) / 1.5, lon = Number(s.slice(2, 4)) + 100;
  lat += Number(s[4]) * (5 / 60); lon += Number(s[5]) * (7.5 / 60);
  lat += Number(s[6]) * (30 / 3600); lon += Number(s[7]) * (45 / 3600);
  let h = 30 / 3600, w = 45 / 3600;
  for (const q of [s[8], s[9]]) { h /= 2; w /= 2; if (q === "3" || q === "4") lat += h; if (q === "2" || q === "4") lon += w; }
  return { lat, lon, h, w };
}

const tiles = new Map();
async function colorAt(kind, lon, lat) {
  const n = 2 ** Z;
  const px = ((lon + 180) / 360) * n * 256;
  const r = (lat * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * 256;
  const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
  const key = `${kind}/${tx}/${ty}`;
  if (!tiles.has(key)) {
    const buf = await cached(KINDS[kind].replace("{z}", Z).replace("{x}", tx).replace("{y}", ty), `local/cache/hazard/${kind}/${Z}/${tx}/${ty}.png`);
    tiles.set(key, buf ? PNG.sync.read(buf) : null);
  }
  const png = tiles.get(key);
  if (!png) return null;
  const i = (Math.floor(py - ty * 256) * 256 + Math.floor(px - tx * 256)) * 4;
  return png.data[i + 3] < 128 ? null : [png.data[i], png.data[i + 1], png.data[i + 2]];
}
function depthOf(c) {
  if (!c) return null;
  let best = null;
  for (const [rgb, label] of DEPTH_COLORS) { const d = Math.hypot(rgb[0] - c[0], rgb[1] - c[1], rgb[2] - c[2]); if (!best || d < best.d) best = { d, label }; }
  return best.d < 30 ? best.label : null;
}

export async function buildFloodPop(code, log = console.log) {
  const parts = polygonsOf(JSON.parse(fs.readFileSync(`site/data/towns/${code}.json`, "utf8")));
  const all = parts.flatMap((p) => p.polys.flat(2));
  const [minX, maxX] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  const [minY, maxY] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];

  // 町にかかる1次メッシュ（約80km四方）ごとに、250m 四方の人口の表を取る
  const meshes = [];
  for (let a = Math.floor(minY * 1.5); a <= Math.floor(maxY * 1.5); a++) for (let b = Math.floor(minX - 100); b <= Math.floor(maxX - 100); b++) {
    const m1 = `${a}${b}`;
    const zip = await cached(`https://www.e-stat.go.jp/gis/statmap-search/data?statsId=T001142&code=${m1}&downloadType=2`, `local/cache/estat/T001142-${m1}.zip`);
    if (!zip) continue;
    const entry = new AdmZip(zip).getEntries().find((e) => e.entryName.endsWith(".txt"));
    const rows = new TextDecoder("shift_jis").decode(entry.getData()).trim().split(/\r?\n/).slice(2).map((l) => l.split(","));
    const num = (v) => (/^\d+$/.test(v) ? Number(v) : null);
    const byCode = new Map(rows.map((r) => [r[0], r]));
    for (const r of rows) {
      const pop = num(r[4]);
      if (!pop) continue;
      // 隠された・合わされた四角は、65歳以上の数を、合わせた先の割合で分ける（めやす）
      let old = r[1] === "0" ? num(r[22]) : null;
      if (old == null) {
        const group = [r, ...String(r[3] || r[2] || "").split(/[;；]/).map((c) => byCode.get(c)).filter(Boolean)];
        const gOld = group.map((g) => num(g[22])).find((v) => v != null);
        const gPop = group.reduce((s, g) => s + (num(g[4]) ?? 0), 0);
        old = gOld != null && gPop ? (pop * gOld) / gPop : null;
      }
      meshes.push({ code: r[0], pop, old });
    }
  }
  log(`250m 四方の人口の表：${meshes.length.toLocaleString("ja-JP")} 区画（町の外も含む）`);

  // 四角の真ん中がどの町・字に入るか
  const inTown = [];
  for (const m of meshes) {
    const b = meshBox(m.code);
    const cx = b.lon + b.w / 2, cy = b.lat + b.h / 2;
    if (cx < minX || cx > maxX || cy < minY || cy > maxY) continue;
    const part = parts.find((p) => inPoly(cx, cy, p.polys));
    if (part) inTown.push({ ...m, b, part: part.props.part });
  }
  const pop = inTown.reduce((s, m) => s + m.pop, 0);
  const oldKnown = inTown.filter((m) => m.old != null);
  log(`町の中の区画 ${inTown.length}・人口 ${pop.toLocaleString("ja-JP")}`);

  const out = { code, createdAt: new Date().toISOString(), population: pop, kinds: {} };
  for (const kind of Object.keys(KINDS)) {
    let people = 0, old = 0;
    const byDepth = {}, byPart = {};
    for (const [n, m] of inTown.entries()) {
      let hit = 0;
      const depths = [];
      for (let i = 0; i < STEP; i++) for (let j = 0; j < STEP; j++) {
        const d = depthOf(await colorAt(kind, m.b.lon + ((j + 0.5) / STEP) * m.b.w, m.b.lat + ((i + 0.5) / STEP) * m.b.h));
        if (d) { hit++; depths.push(d); }
      }
      const f = hit / (STEP * STEP);
      people += m.pop * f;
      if (m.old != null) old += m.old * f;
      for (const d of depths) byDepth[d] = (byDepth[d] ?? 0) + m.pop / (STEP * STEP);
      const bp = (byPart[m.part] ??= { pop: 0, people: 0 });
      bp.pop += m.pop; bp.people += m.pop * f;
      if (n % 200 === 199) log(`  ${kind}：${n + 1}/${inTown.length}`);
    }
    if (people < 1) { log(`${kind}：想定の区域に住む人は見つかりませんでした`); continue; }
    const r10 = (v) => Math.round(v / 10) * 10;
    out.kinds[kind] = {
      people: r10(people), rate: Math.round((people / pop) * 1000) / 10,
      over65: oldKnown.length ? r10(old) : null,
      byDepth: Object.fromEntries(DEPTH_COLORS.map(([, l]) => [l, r10(byDepth[l] ?? 0)]).filter(([, v]) => v > 0)),
      parts: Object.fromEntries(Object.entries(byPart).filter(([, v]) => v.people >= 5).map(([k, v]) => [k, { rate: Math.round((v.people / v.pop) * 1000) / 10, people: r10(v.people) }])),
    };
    log(`${kind}：約 ${out.kinds[kind].people.toLocaleString("ja-JP")} 人（${out.kinds[kind].rate}%）・65歳以上 約 ${out.kinds[kind].over65?.toLocaleString("ja-JP")} 人`);
  }
  out.note = "250m 四方ごとの人口（国勢調査 2020年）に、その四角の中で浸水が想定される場所の割合を掛けて足した、めやすです。人は四角の中に均等に住んでいるとみなしています。10人単位に丸めています";
  out.sources = [
    { title: "国勢調査 2020年 地域メッシュ統計（250m）人口及び世帯（総務省統計局 e-Stat）", url: "https://www.e-stat.go.jp/gis/statmap-search?page=1&type=1&toukeiCode=00200521&toukeiYear=2020&aggregateUnit=Q" },
    { title: "ハザードマップポータルサイト（重ねるハザードマップ）のオープンデータを加工して作成", url: "https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/opendata.html" },
  ];
  fs.mkdirSync("site/data/flood-pop", { recursive: true });
  fs.writeFileSync(`site/data/flood-pop/${code}.json`, JSON.stringify(out, null, 1));
  return out;
}

if (process.argv[1]?.endsWith("build-flood-pop.mjs")) for (const c of process.argv.slice(2)) await buildFloodPop(c);
