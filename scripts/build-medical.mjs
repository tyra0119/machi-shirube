// 病院・診療所の一覧と、曜日ごとの診療時間を、市区町村ごとの小さな表にする（町のページの「今日やっている病院」）。
// 動かし方: npm run build:medical
// 入力 data/raw/mhlw/*.zip（厚生労働省「医療情報ネットのオープンデータ」2026年6月1日時点。公共データ利用規約 第1.0版）
//      data/raw/syukujitsu.csv（内閣府「国民の祝日」。公共データ利用規約 第1.0版）
// 出力 site/data/iryo/{市区町村コード}.json と site/data/holidays.json
// 中身は医療機関から届けられたもの。変わっていることがあるので、ページでは「行く前に電話で確かめて」と必ず書く
import fs from "node:fs";
import JSZip from "jszip";
import { cells } from "./csv.mjs";

const AS_OF = "20260601";
const KINDS = [["01", "hospital", "病院"], ["02", "clinic", "診療所"]];
const DAYS = ["月", "火", "水", "木", "金", "土", "日", "祝"];

async function readCSV(name) {
  const zip = await JSZip.loadAsync(fs.readFileSync(`data/raw/mhlw/${name}.zip`));
  const file = Object.values(zip.files).find((f) => f.name.endsWith(".csv"));
  const lines = (await file.async("string")).replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const head = cells(lines[0]);
  return { head, rows: lines.slice(1).map(cells), col: (n) => head.indexOf(n) };
}

// "09:00" → 900。時間帯ごとに [始め, 終わり]
const hm = (s) => (/^\d{1,2}:\d{2}$/.test(s) ? Number(s.replace(":", "")) : null);
function merge(list) {
  const out = [];
  for (const [s, e] of list.filter(([s, e]) => s != null && e != null && e > s).sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

const byMuni = new Map();
const facilities = new Map();
for (const [no, en, label] of KINDS) {
  const fac = await readCSV(`${no}-1_${en}_facility_info`);
  const c = fac.col;
  for (const r of fac.rows) {
    const code = r[c("都道府県コード")] + r[c("市区町村コード")];
    if (!/^\d{5}$/.test(code)) continue;
    const lat = Number(r[c("所在地座標（緯度）")]), lon = Number(r[c("所在地座標（経度）")]);
    // 毎週の休み（0：休診）と、第何週の休み（例 {2: [5]} は第2週の土曜休み）
    const weekly = DAYS.slice(0, 7).map((d) => r[c(`毎週決まった曜日に休診（${d}）`)] !== "0");
    const nth = {};
    for (let w = 1; w <= 5; w++) {
      const off = DAYS.slice(0, 7).map((d, i) => (r[c(`決まった週に休診（定期週）第${w}週（${d}）`)] === "0" ? i : -1)).filter((i) => i >= 0);
      if (off.length) nth[w] = off;
    }
    const f = {
      n: r[c("正式名称")], k: label, a: r[c("所在地")],
      p: Number.isFinite(lat) && Number.isFinite(lon) && lat && lon ? [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] : null,
      u: r[c("案内用ホームページアドレス")] || undefined,
      w: weekly.map(Number).join(""),
      hol: r[c("祝日に休診")] === "1" ? 1 : 0,
      nth: Object.keys(nth).length ? nth : undefined,
      other: r[c("その他の休診日（gw、お盆等）")]?.replace(/（改行）/g, " ") || undefined,
      s: [], h: {},
    };
    facilities.set(r[c("ID")], f);
    if (!byMuni.has(code)) byMuni.set(code, []);
    byMuni.get(code).push(f);
  }
  const hours = await readCSV(`${no}-2_${en}_speciality_hours`);
  const h = hours.col;
  const spans = new Map(); // ID → 曜日 → [[始め, 終わり]]
  for (const r of hours.rows) {
    const f = facilities.get(r[h("ID")]);
    if (!f) continue;
    const name = r[h("診療科目名")];
    if (name && !f.s.includes(name)) f.s.push(name);
    if (!spans.has(f)) spans.set(f, {});
    const sp = spans.get(f);
    for (const d of DAYS) {
      // 診療時間を使い、書いていなければ外来の受付時間を使う
      let s = hm(r[h(`${d}_診療開始時間`)]), e = hm(r[h(`${d}_診療終了時間`)]);
      if (s == null || e == null) { s = hm(r[h(`${d}_外来受付開始時間`)]); e = hm(r[h(`${d}_外来受付終了時間`)]); }
      if (s != null && e != null) (sp[d] ??= []).push([s, e]);
    }
  }
  for (const [f, sp] of spans) for (const [d, list] of Object.entries(sp)) { const m = merge(list); if (m.length) f.h[d] = m; }
}

fs.rmSync("site/data/iryo", { recursive: true, force: true });
fs.mkdirSync("site/data/iryo", { recursive: true });
const source = {
  title: "医療情報ネット（ナビイ）のオープンデータ（厚生労働省）",
  url: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/newpage_43373.html",
  asOf: `${AS_OF.slice(0, 4)}年${Number(AS_OF.slice(4, 6))}月${Number(AS_OF.slice(6))}日時点`,
  license: "公共データ利用規約（第1.0版）",
};
let total = 0, bytes = 0;
for (const [code, list] of byMuni) {
  list.sort((a, b) => (a.k === b.k ? a.n.localeCompare(b.n, "ja") : a.k === "病院" ? -1 : 1));
  for (const f of list) if (!f.s.length) delete f.s;
  const json = JSON.stringify({ source, list });
  fs.writeFileSync(`site/data/iryo/${code}.json`, json);
  total += list.length;
  bytes += json.length;
}

// 祝日（今年と来年）
const sj = new TextDecoder("shift_jis").decode(fs.readFileSync("data/raw/syukujitsu.csv")).trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
const holidays = Object.fromEntries(sj.filter(([d]) => /^202[6-7]\//.test(d)).map(([d, n]) => [d.split("/").map((x) => x.padStart(2, "0")).join("-"), n]));
fs.writeFileSync("site/data/holidays.json", JSON.stringify({
  source: { title: "国民の祝日について（内閣府）", url: "https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html", license: "公共データ利用規約（第1.0版）" },
  holidays,
}));
console.log(`市区町村 ${byMuni.size}・病院と診療所 ${total}・合わせて ${(bytes / 1e6).toFixed(1)}MB・祝日 ${Object.keys(holidays).length}`);
for (const c of ["39428", "10524", "11227", "28109"]) console.log(c, byMuni.get(c)?.length);
