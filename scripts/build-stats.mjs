// 住民基本台帳（総務省、令和8年1月1日）から、市区町村ごとの数字と「全国の中での位置」を作る。
// 動かし方: npm run build:stats（入力は data/raw/juki/ の3つの表。出力は site/data/stats.json）
// 全国と比べる相手は市区町村 1,741（政令市はまるごと1つ。政令市の区と県の行は比べる相手に入れない）。
// 区の数字も、同じ 1,741 の並びの中に置いて位置を出す。
import fs from "node:fs";
import ExcelJS from "exceljs";

const RAW = "data/raw/juki";
const SOURCE = {
  name: "住民基本台帳に基づく人口、人口動態及び世帯数（総務省）",
  asOf: "令和8年1月1日",
  changePeriod: "令和7年1月1日〜12月31日",
  urls: [
    "https://www.soumu.go.jp/main_content/000892952.xlsx",
    "https://www.soumu.go.jp/main_content/000892953.xlsx",
    "https://www.soumu.go.jp/main_content/000892960.xlsx",
  ],
  license: "政府標準利用規約（第2.0版）に準拠。出典を書き、加工したことを書く",
};

async function rows(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(`${RAW}/${file}`);
  const out = [];
  wb.worksheets[0].eachRow((row) => out.push(row.values.slice(1)));
  return out;
}
const isCode = (v) => typeof v === "string" && /^\d{6}$/.test(v);

// 1. 総計の表：人口・世帯・1年の増減
const towns = new Map();
for (const r of await rows("000892952.xlsx")) {
  if (!isCode(r[0])) continue;
  const code = r[0].slice(0, 5);
  towns.set(code, {
    code,
    pref: r[1],
    name: r[2],
    population: r[5],
    households: r[6],
    movedInFromAbroad: r[8],
    changeRate: r[20],
    naturalChangeRate: r[22],
    socialChangeRate: r[24],
  });
}

// 2. 年齢の表：15歳未満・65歳以上（「計」の行だけ使う）
for (const r of await rows("000892953.xlsx")) {
  if (!isCode(r[0]) || r[3] !== "計") continue;
  const t = towns.get(r[0].slice(0, 5));
  if (!t) continue;
  const bands = r.slice(5, 26); // 0〜4歳 … 100歳以上（21の階級）
  const total = r[4];
  t.under15Rate = ((bands[0] + bands[1] + bands[2]) / total) * 100;
  t.over65Rate = (bands.slice(13).reduce((a, b) => a + b, 0) / total) * 100;
}

// 3. 外国人住民の表
for (const r of await rows("000892960.xlsx")) {
  if (!isCode(r[0])) continue;
  const t = towns.get(r[0].slice(0, 5));
  if (!t) continue;
  t.foreigners = r[5];
  t.foreignRate = (r[5] / t.population) * 100;
}

// 4. 全国の中での位置（高いほうから何%か）
const isPref = (t) => t.code.endsWith("000");
const isWard = (t) => /市.+区$/.test(t.name);
const isCounty = (t) => !/[市町村区]$/.test(t.name); // 郡・支庁（島しょ）の小計の行
const noPeople = (t) => !t.population; // 北方領土の6村（人口 0）
const peers = [...towns.values()].filter((t) => !isPref(t) && !isWard(t) && !isCounty(t) && !noPeople(t));
const METRICS = ["population", "over65Rate", "under15Rate", "foreignRate", "changeRate", "socialChangeRate"];
const sorted = Object.fromEntries(METRICS.map((m) => [m, peers.map((t) => t[m]).sort((a, b) => a - b)]));

// 自分より高い町の割合（0 なら全国でいちばん高い）
function topPercent(metric, value) {
  const arr = sorted[metric];
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= value) lo = mid + 1; else hi = mid;
  }
  return ((arr.length - lo) / arr.length) * 100;
}
// 高いほうから何番目か（同じ値は同じ順位）
const rankOf = (metric, value) => sorted[metric].filter((v) => v > value).length + 1;

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const out = {};
for (const t of towns.values()) {
  if (isPref(t) || isCounty(t) || noPeople(t)) continue;
  const rec = {
    pref: t.pref,
    name: t.name,
    population: t.population,
    households: t.households,
    foreigners: t.foreigners,
    movedInFromAbroad: t.movedInFromAbroad,
    over65Rate: round(t.over65Rate),
    under15Rate: round(t.under15Rate),
    foreignRate: round(t.foreignRate),
    changeRate: round(t.changeRate),
    naturalChangeRate: round(t.naturalChangeRate),
    socialChangeRate: round(t.socialChangeRate),
    ward: isWard(t),
    top: {},
    rank: {},
  };
  for (const m of METRICS) {
    rec.top[m] = round(topPercent(m, t[m]), 1);
    rec.rank[m] = rankOf(m, t[m]);
  }
  out[t.code] = rec;
}

// 境目（確かめ用）：中央と上位10%
const q = (m, p) => sorted[m][Math.floor((sorted[m].length - 1) * p)];
const summary = Object.fromEntries(METRICS.map((m) => [m, { median: round(q(m, 0.5)), top10: round(q(m, 0.9)), bottom10: round(q(m, 0.1)) }]));

fs.writeFileSync(
  "site/data/stats.json",
  JSON.stringify({ source: SOURCE, peers: peers.length, summary, towns: out }),
);
console.log(`比べる相手 ${peers.length}、書き出した区域 ${Object.keys(out).length}`);
console.log(JSON.stringify(summary, null, 1));
for (const c of ["39428", "10524", "11227", "28109"]) {
  const r = out[c];
  console.log(c, r.name, `人口 ${r.population}`, `65歳以上 ${r.over65Rate}%（上位${r.top.over65Rate}%）`, `外国 ${r.foreignRate}%（${r.rank.foreignRate}位）`, `増減 ${r.changeRate}%`);
}
