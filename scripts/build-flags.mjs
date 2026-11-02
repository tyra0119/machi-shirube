// 「絞る」の印：火山災害警戒地域・豪雪地帯・離島（期間前に取った国の一覧。data/raw/ に写したもの）
// 動かし方: npm run build:flags（先に npm run build:stats）。出力は site/data/flags.json（市区町村コード → 印）
// - 火山：内閣府の一覧（PDF、令和6年8月1日）。市町村の名前を拾い、全国で同じ名前が1つならその町、
//         いくつかあれば同じ並び（「、」でつながった市町村）のほかの町の県に合わせる。合計 179 と合うか確かめる
// - 豪雪：国土数値情報 A22（2016年度。市区町村コードと、豪雪地帯／特別豪雪地帯の区分つき）
// - 離島：国土数値情報 A19（2017年。島ごとに市区町村コードつき）
import fs from "node:fs";
import JSZip from "jszip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const stats = JSON.parse(fs.readFileSync("site/data/stats.json", "utf8")).towns;
const short = (n) => n.replace(/^.+?郡(?=.+[町村]$)/, "");
const munis = Object.entries(stats).filter(([, t]) => !t.ward).map(([code, t]) => ({ code, pref: t.pref, name: short(t.name) }));
const flags = {};
const flag = (code, k, v = true) => ((flags[code] ??= {})[k] = v);

// 火山
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync("data/raw/lists/kazansaigaichiiki.pdf")), verbosity: 0 }).promise;
let text = "";
for (let i = 1; i <= doc.numPages; i++) {
  text += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str + (x.hasEOL ? "\n" : " ")).join("");
}
const known = new Set(munis.map((m) => m.name));
// 行をまたいで切れた名前をつなぐ（「鳴\n沢村」→「鳴沢村」）
text = text.replace(/([^\s、]+)\n([^\s、]+)/g, (all, a, b) => {
  const tail = a.split(/[、\s]/).pop();
  return known.has(tail + b.split(/[、\s]/)[0]) ? a + b : all;
});
const runs = text.split(/[\s]+/).filter((s) => /[市町村]/.test(s)).map((s) => s.split("、").filter((n) => known.has(n)));
let volcano = 0;
const unresolved = [];
for (const run of runs) {
  const prefs = run.map((n) => munis.filter((m) => m.name === n)).filter((c) => c.length === 1).map((c) => c[0].pref);
  for (const n of run) {
    const c = munis.filter((m) => m.name === n);
    // 同じ名前がいくつかあり、並びにほかの町が無いときは、すぐ前に書かれた県で決める（「長野県 高山村」）
    const hit = c.length === 1 ? c[0]
      : c.find((m) => prefs.includes(m.pref)) ?? c.find((m) => new RegExp(`${m.pref}\\s+(?:[^\\s、]+、)*${n}`).test(text));
    if (!hit) { unresolved.push(n); continue; }
    if (!flags[hit.code]?.volcano) volcano++;
    flag(hit.code, "volcano");
  }
}
console.log(`火山：${volcano} 市町村（一覧の合計は 179）${unresolved.length ? `。決まらない：${unresolved.join("、")}` : ""}`);

// 豪雪・離島（市区町村コードで）。古い版なので、そのあと変わったコードは今のコードに読みかえる
const RENAMED = {
  "03305": "03216", // 滝沢村 → 滝沢市（2014年）
  "22137": "22140", // 浜松市天竜区（2024年の区の再編で新しいコード）
};
async function features(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".zip"))) {
    const files = (await JSZip.loadAsync(fs.readFileSync(`${dir}/${f}`))).files;
    const name = Object.keys(files).find((n) => n.endsWith(".geojson"));
    out.push(...JSON.parse(await files[name].async("string")).features.map((x) => x.properties));
  }
  return out;
}
for (const p of await features("data/raw/a22")) {
  const kind = p.A22_009 === "2" ? "特別豪雪地帯" : "豪雪地帯";
  const code = RENAMED[p.A22_002] ?? p.A22_002;
  if (flags[code]?.snow !== "特別豪雪地帯") flag(code, "snow", kind);
}
for (const p of await features("data/raw/a19")) flag(RENAMED[p.A19_002] ?? p.A19_002, "island");

const count = (k) => Object.values(flags).filter((f) => f[k]).length;
console.log(`豪雪：${count("snow")}（うち特別豪雪 ${Object.values(flags).filter((f) => f.snow === "特別豪雪地帯").length}）・離島のある市町村：${count("island")}`);
const missing = Object.keys(flags).filter((c) => !stats[c]);
if (missing.length) console.log(`今の市区町村に無いコード（合併などで変わった）：${missing.join(", ")}`);

fs.writeFileSync("site/data/flags.json", JSON.stringify({
  sources: {
    volcano: "火山災害警戒地域の一覧（内閣府、令和6年8月1日）",
    snow: "国土数値情報 豪雪地帯データ A22（国土交通省、2016年度）を加工",
    island: "国土数値情報 離島振興対策実施地域データ A19（国土交通省、2017年）を加工",
  },
  flags,
}));
