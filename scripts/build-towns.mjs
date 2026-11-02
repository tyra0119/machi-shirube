// 市区町村の中の町（町・字。丁目はまとめる）の形と数字を、県ごとに作る。
// 動かし方: npm run build:towns -- all（全国）／ npm run build:towns -- 11 28（県の番号2けた）
// 元は e-Stat の国勢調査2020（境界データと小地域集計。県ごとに取る。取ったものは data/raw/estat/、公開しない）
// 出力は site/data/towns/{市区町村コード}.json（TopoJSON）、index.json（作った市区町村の一覧）、names.json（名前で探す用）
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import mapshaper from "mapshaper";
import { boundaryZip, gisTable, householdCounts, householdRates, num, smallAreaTable } from "./estat.mjs";

const RAW = "data/raw/estat";
const OUT = "site/data/towns";
let currentCache = null; // 今の市区町村の形（currentMunis）
const args = process.argv.slice(2);
const prefs = args.includes("all")
  ? Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, "0"))
  : args.filter((a) => /^\d{2}$/.test(a));
if (!prefs.length) throw new Error("県の番号（2けた）か all を渡してください");
fs.mkdirSync(`${RAW}/tmp`, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const cli = (args) =>
  execFileSync(process.execPath, ["node_modules/mapshaper/bin/mapshaper", ...args], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 30 });

for (const pref of prefs) {
  // 1. 境界：丁目を町・字にまとめ、人口と世帯を足す。名前の「〇丁目」を外す
  const tmp = `${RAW}/tmp/towns-${pref}.json`;
  cli([
    await boundaryZip(pref), "encoding=shiftjis",
    "-filter", "KEY_CODE && KEY_CODE.length >= 9",
    "-each", "town=KEY_CODE.slice(0,9), muni=KEY_CODE.slice(0,5), part=KIHON1, name=S_NAME ? S_NAME.replace(/[一二三四五六七八九十〇0-9０-９]+丁目$/, '') : ''",
    "-dissolve", "town", "copy-fields=muni,part,name", "sum-fields=JINKO,SETAI",
    "-rename-fields", "population=JINKO,households=SETAI",
    "-simplify", "30%", "keep-shapes",
    "-o", tmp, "format=geojson", "precision=0.00001",
  ]);

  // 2. 数字：年齢・外国の住民・世帯と住まい
  const [ages, foreign, hh] = [await ageTable(pref), await foreignTable(pref), await householdCounts(pref)];
  const groups = new Map();
  for (const f of JSON.parse(fs.readFileSync(tmp, "utf8")).features) {
    const p = f.properties;
    const c = hh.get(p.town);
    if (c?.householdHidden) p.householdHidden = true;
    if (c) for (const [k, v] of Object.entries(householdRates(c))) if (v != null) p[k] = v;
    const fr = foreign.get(p.town);
    if (fr?.hidden) p.foreignHidden = true;
    else if (fr) Object.assign(p, fr);
    const a = ages.get(p.town);
    if (a?.hidden) p.ageHidden = true;
    else if (a) Object.assign(p, a.rates);
    if (!groups.has(p.muni)) groups.set(p.muni, []);
    groups.get(p.muni).push(f);
  }

  // 国勢調査（2020年）のあとに区が組みかわった所（浜松市 2024年）は、町・字の位置で今の区に入れ直す
  const current = await currentMunis();
  for (const [muni, features] of [...groups]) {
    if (current.has(muni)) continue;
    groups.delete(muni);
    for (const f of features) {
      const to = whichMuni(f, current, pref);
      if (!to) { console.log(`  今の市区町村が見つからない町・字：${f.properties.name}（${muni}）`); continue; }
      f.properties.muni = to;
      if (!groups.has(to)) groups.set(to, []);
      groups.get(to).push(f);
    }
    console.log(`  ${muni} は今の市区町村に無いので、位置で入れ直した`);
  }

  // 3. 市区町村ごとに、境目を共有する形（TopoJSON）で書く
  let bytes = 0;
  for (const [muni, features] of groups) {
    const out = await mapshaper.applyCommands(
      "-i towns.json -o format=topojson quantization=20000 towns.json",
      { "towns.json": JSON.stringify({ type: "FeatureCollection", features }) },
    );
    fs.writeFileSync(`${OUT}/${muni}.json`, out["towns.json"]);
    bytes += out["towns.json"].length;
  }
  console.log(`${pref}: 市区町村 ${groups.size}・町・字 ${[...groups.values()].reduce((s, g) => s + g.length, 0)}（${(bytes / 1e6).toFixed(1)}MB）`);
}

// 4. 作った市区町村の一覧と、名前で探すための町・字の名前（[市区町村コード, 町・字の番号, 名前]）
const done = fs.readdirSync(OUT).filter((f) => /^\d{5}\.json$/.test(f)).map((f) => f.slice(0, 5)).sort();
const names = [];
for (const code of done) {
  const topo = JSON.parse(fs.readFileSync(`${OUT}/${code}.json`, "utf8"));
  for (const g of topo.objects.towns.geometries) names.push([code, g.properties.part, g.properties.name]);
}
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify({
  source: "国勢調査 2020年（令和2年）小地域の境界データと小地域集計（年齢・外国人人口・世帯の家族類型・住宅）（総務省統計局、e-Stat）を加工して作成",
  asOf: "2020年10月1日",
  codes: done,
}));
fs.writeFileSync(`${OUT}/names.json`, JSON.stringify(names));
console.log(`市区町村 ${done.length}・町・字の名前 ${names.length}`);

// 今の市区町村の形（site/data/japan.topo.json）を、コード → GeoJSON の形で
async function currentMunis() {
  if (currentCache) return currentCache;
  const out = await mapshaper.applyCommands(
    "-i japan.topo.json -o format=geojson target=municipalities munis.json",
    { "japan.topo.json": fs.readFileSync("site/data/japan.topo.json", "utf8") },
  );
  currentCache = new Map(JSON.parse(out["munis.json"]).features.map((f) => [f.properties.code, f]));
  return currentCache;
}

// 町・字のおおよその真ん中（いちばん外の輪の点の平均）が、同じ県のどの市区町村に入るか
function whichMuni(f, current, pref) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const ring = polys.reduce((a, b) => (b[0].length > a[0].length ? b : a))[0];
  const pt = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
  const inside = (r) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > pt[1]) !== (r[j][1] > pt[1]) && pt[0] < ((r[j][0] - r[i][0]) * (pt[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    }
    return c;
  };
  for (const [code, m] of current) {
    if (!code.startsWith(pref)) continue;
    const mp = m.geometry.type === "Polygon" ? [m.geometry.coordinates] : m.geometry.coordinates;
    if (mp.some((poly) => inside(poly[0]) && !poly.slice(1).some(inside))) return code;
  }
  return null;
}

// 第2表：町・字（市区町村コード＋町丁字コード4けた）ごとの外国の住民の数と割合
async function foreignTable(pref) {
  const out = new Map();
  for (const r of await smallAreaTable(pref, "男女別人口，外国人人口及び世帯数", "t2")) {
    // 地域階層レベル：2 = 丁目のない町・字、3 = 丁目をまとめた町・字
    if (!/^\d{5}$/.test(r[0]) || !/^\d{4}$/.test(r[1]) || (r[2] !== "2" && r[2] !== "3")) continue;
    const total = num(r[10]);
    const foreigners = num(r[13]);
    if (r[3] || total === null || foreigners === null) { out.set(r[0] + r[1], { hidden: true }); continue; }
    if (!total) continue;
    out.set(r[0] + r[1], { foreigners, foreignRate: Math.round((foreigners / total) * 1000) / 10 });
  }
  return out;
}

// T001082「年齢（5歳階級）別人口」：町・字（KEY_CODE 9けた）ごとの割合
async function ageTable(pref) {
  const rows = await gisTable(pref, "T001082");
  const head = rows[0];
  const [U15, A1564, O65, O75] = ["T001082017", "T001082018", "T001082019", "T001082020"].map((id) => head.indexOf(id));
  const out = new Map();
  for (const r of rows.slice(2)) {
    // 段：2 = 丁目のない町・字、3 = 丁目をまとめた町・字（4 は丁目、1 は市区町村）
    if (r[1] !== "2" && r[1] !== "3") continue;
    const [u15, a1564, o65, o75] = [U15, A1564, O65, O75].map((i) => num(r[i]));
    // 秘匿の処理：1 = 隠した、2 = 隣の町・字と合わせた
    if (r[4] === "1" || r[4] === "2" || [u15, a1564, o65].includes(null)) { out.set(r[0], { hidden: true }); continue; }
    const known = u15 + a1564 + o65; // 年齢の分かっている人
    if (!known) continue;
    const pct = (v) => Math.round((v / known) * 1000) / 10;
    out.set(r[0], { rates: { under15Rate: pct(u15), over65Rate: pct(o65), over75Rate: o75 === null ? null : pct(o75) } });
  }
  return out;
}
