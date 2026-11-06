// 近くの介護の事業所：厚生労働省「介護サービス情報公表システム」のオープンデータ（事業所の CSV、サービスの種類ごと）から、
// 町ごとに、住む人に要る種類だけを取り出す → site/data/kaigo/{コード}.json（名前・種類・住所・電話・緯度経度）
// 利用条件：厚生労働省ホームページの利用規約の条件の下で自由に使える（出典を書き、加工したことを書く）。取った CSV そのものは local/cache/kaigo にだけ置く
// （作者「住民にとって役立つ情報を増やしたい」→ kozdai の「近くの介護の事業所」→「全部やる」）
// 使い方：node scripts/build-kaigo.mjs 39428 10524 …（町を調べるときは overlays.mjs からも動く）
import fs from "node:fs";

import { UA } from "../src/ua.mjs"; // 名札（.env の MACHI_SHIRUBE_UA で変えられる）
const BASE = "https://www.mhlw.go.jp/content/12300000/";
// 住む人に要る種類を、4つのまとまりに
export const KINDS = [
  ["430", "相談", "居宅介護支援（ケアマネジャー）"],
  ["150", "通う", "通所介護（デイサービス）"],
  ["780", "通う", "地域密着型通所介護（小さなデイサービス）"],
  ["730", "通う", "小規模多機能型居宅介護"],
  ["110", "家に来る", "訪問介護（ホームヘルプ）"],
  ["130", "家に来る", "訪問看護"],
  ["210", "泊まる・住む", "短期入所生活介護（ショートステイ）"],
  ["510", "泊まる・住む", "介護老人福祉施設（特別養護老人ホーム）"],
  ["540", "泊まる・住む", "地域密着型介護老人福祉施設（小さな特別養護老人ホーム）"],
  ["520", "泊まる・住む", "介護老人保健施設"],
  ["550", "泊まる・住む", "介護医療院"],
  ["320", "泊まる・住む", "認知症対応型共同生活介護（グループホーム）"],
];
const CACHE = "local/cache/kaigo";

// 行儀よく取る：名乗り、1つずつ、1秒以上あける。手元にあれば取り直さない
let last = 0;
async function csvOf(no) {
  const file = `${CACHE}/jigyosho_${no}.csv`;
  if (!fs.existsSync(file)) {
    fs.mkdirSync(CACHE, { recursive: true });
    const wait = last + 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(`${BASE}jigyosho_${no}.csv`, { headers: { "User-Agent": UA } });
    last = Date.now();
    if (!res.ok) throw new Error(`jigyosho_${no}.csv：応答 ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return fs.readFileSync(file, "utf8").replace(/^﻿/, "");
}
// CSV の1行を、かっこ（"）で囲んだ項目に気をつけて分ける
function splitRow(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
const rowsCache = new Map();
async function rowsOf(no) {
  if (!rowsCache.has(no)) {
    const lines = (await csvOf(no)).split(/\r?\n/).filter(Boolean);
    const head = splitRow(lines[0]);
    const ix = (name) => head.indexOf(name);
    const col = { code: ix("都道府県コード又は市町村コード"), name: ix("事業所名"), addr: ix("住所"), bld: ix("方書（ビル名等）"), lat: ix("緯度"), lon: ix("経度"), tel: ix("電話番号"), url: ix("URL") };
    rowsCache.set(no, lines.slice(1).map(splitRow).map((r) => ({ code5: (r[col.code] ?? "").slice(0, 5), name: r[col.name], addr: [r[col.addr], r[col.bld]].filter(Boolean).join(" "), lat: Number(r[col.lat]), lon: Number(r[col.lon]), tel: r[col.tel], url: r[col.url] })));
  }
  return rowsCache.get(no);
}

export async function buildKaigo(code, log = console.log) {
  const items = [];
  for (const [no, group, kind] of KINDS) {
    for (const r of await rowsOf(no)) {
      if (r.code5 !== code) continue;
      items.push({ group, kind, name: r.name, addr: r.addr, tel: r.tel || null, url: /^https?:\/\//.test(r.url) ? r.url : null, ...(Number.isFinite(r.lat) && Number.isFinite(r.lon) && r.lat && r.lon ? { lat: r.lat, lon: r.lon } : {}) });
    }
  }
  fs.mkdirSync("site/data/kaigo", { recursive: true });
  const out = {
    code, createdAt: new Date().toISOString(), count: items.length, items,
    note: "介護保険のサービスの事業所のうち、相談・通う・家に来る・泊まる／住むのものです。空きや受け入れの条件は、事業所に問い合わせてください",
    sources: [{ title: "介護サービス情報公表システム オープンデータ（厚生労働省）を加工して作成", url: "https://www.mhlw.go.jp/stf/kaigo-kouhyou_opendata.html" }],
  };
  fs.writeFileSync(`site/data/kaigo/${code}.json`, JSON.stringify(out));
  log(`介護の事業所：${items.length} か所 → site/data/kaigo/${code}.json`);
  return out;
}

if (process.argv[1]?.endsWith("build-kaigo.mjs")) for (const code of process.argv.slice(2)) await buildKaigo(code);
