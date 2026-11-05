// 町のページが読む「その町の分だけ」の小さなファイル（site/data/muni/{コード}.json）を、全国の市区町村について作る。
// 町のページは前、全国の分（日本全体の地図の形 0.7MB・全国の町の数字 0.25MB など、圧縮しても約1.1MB）を毎回読んでいて、
// 電波の弱い所では天気が出るまで待たされた（作者「全部やる」→ 3回目の点検の 1）。
// 中身：町の数字と全国の真ん中など（stats.json から）・町の形（japan.topo.json から）・名前の位置（labels.json）・町の印（flags.json）・
//      これからの人口と全国の中での減りにくさの順番（future.json）・天気の地域（jma.json）。政令市まるごとは、その区の分も入れる
// 動かし方: npm run build:muni（もとのファイルを作り直したあとに動かす）
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const stats = read("site/data/stats.json");
const labels = read("site/data/labels.json").features;
const flags = read("site/data/flags.json").flags;
const future = read("site/data/future.json");
const jma = read("site/data/jma.json");

// 町の形：日本全体の地図（TopoJSON）を、いちど GeoJSON にして町ごとに分ける（mapshaper。手元だけに置く）
const GEO = "local/cache/muni-outline.geojson";
if (!fs.existsSync(GEO) || fs.statSync(GEO).mtimeMs < fs.statSync("site/data/japan.topo.json").mtimeMs) {
  fs.mkdirSync("local/cache", { recursive: true });
  execFileSync(process.execPath, ["node_modules/mapshaper/bin/mapshaper", "site/data/japan.topo.json", "-target", "municipalities", "-o", GEO, "format=geojson", "precision=0.0001"], { stdio: "inherit" });
}
const outlines = new Map(read(GEO).features.map((f) => [f.properties.code, f]));

// 全国の市区町村の数（政令市の区は数えない）と、これからの人口の減りにくさの順番
const total = Object.values(stats.towns).filter((t) => !t.ward).length;
const ratio = (p) => p.at(-1) / p[0];
const futureTotal = Object.keys(future.towns).length;
const futureRank = (code) => Object.values(future.towns).filter((x) => ratio(x.pop) > ratio(future.towns[code].pop)).length + 1;

fs.mkdirSync("site/data/muni", { recursive: true });
// 町ごとのデータの置き場（site/data/{置き場}/{コード}.json）。町のページは、ここにあってこの町に無いものを読みに行かない
// （浅い町では 20 ほどのファイルが無く、そのたびに GitHub Pages の 404 のページ〈約 9KB〉が返っていた）。
// aed は置き場ごとまだ無い（CSV のある町が無かった）が、町のページが読みに行くので入れる。ここに無い新しい置き場は、これまでどおり読みに行く
const NOT_TOWN = new Set(["i18n", "muni", "translations"]);
const DIRS = [...fs.readdirSync("site/data", { withFileTypes: true }).filter((x) => x.isDirectory() && !NOT_TOWN.has(x.name)).map((x) => x.name), "aed"];
const dirFiles = new Map(DIRS.map((d) => [d, new Set(fs.existsSync(`site/data/${d}`) ? fs.readdirSync(`site/data/${d}`) : [])]));
let n = 0;
for (const [code, t] of Object.entries(stats.towns)) {
  // 政令市まるごと（例 14100）は、同じ市の区も入れる（届きにくい人の候補・天気の地域で使う）
  const wards = Object.entries(stats.towns).filter(([c, w]) => w.ward && w.pref === t.pref && !t.ward && w.name.startsWith(t.name) && c !== code);
  const towns = Object.fromEntries([[code, t], ...wards]);
  const near = (table) => Object.fromEntries(Object.entries(table).filter(([k]) => k === code || (k > code && k < String(Number(code) + 30).padStart(5, "0"))));
  const label = labels.find((x) => x.properties.code === code) ?? labels.find((x) => x.properties.code.startsWith(code.slice(0, 4)));
  const out = {
    code,
    stats: { source: stats.source, census: stats.census, peers: stats.peers, bigPeers: stats.bigPeers, summary: stats.summary, total, towns, flags: Object.fromEntries(Object.keys(towns).filter((c) => flags[c]).map((c) => [c, flags[c]])) },
    outline: outlines.get(code) ?? null,
    label: label?.geometry.coordinates ?? null,
    future: future.towns[code] ? { years: future.years, nation: future.nation, source: future.source, note: future.note, town: future.towns[code], rank: futureRank(code), total: futureTotal } : null,
    jma: near(jma),
    // 訳のある言葉の一覧（名前だけ。訳そのものは data/translations/{コード}.json）。訳を作り直したら、これも作り直す
    langs: fs.existsSync(`site/data/translations/${code}.json`) ? Object.fromEntries(Object.entries(read(`site/data/translations/${code}.json`).langs).map(([k, l]) => [k, { name: l.name, ja: l.ja, items: [] }])) : null,
    // ある物の一覧（深く調べた町は、日々データが増えるので入れない。町のページは全部読みに行く）
    files: dirFiles.get("answers").has(`${code}.json`) ? null : { dirs: DIRS, have: DIRS.filter((d) => dirFiles.get(d).has(`${code}.json`)) },
  };
  fs.writeFileSync(`site/data/muni/${code}.json`, JSON.stringify(out));
  n++;
}
console.log(`町ごとの小さなファイル：${n} 個 → site/data/muni/`);
