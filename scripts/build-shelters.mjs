// 避難場所の一覧（町のオープンデータ）を、地図用の点にする。
// 動かし方: npm run build:shelters -- 39428 <CSV の URL> <使ってよい条件> <出典の名前>
// 取ったものは data/raw/shelters/（公開しない）。出力は site/data/shelters/{市区町村コード}.json
// CSV は「指定緊急避難場所一覧」の全国でそろった形（緯度・経度・災害種別_津波 などの列）を前提にする
import fs from "node:fs";

const UA = "machi-shirube/0.1 (+https://github.com/tyra0119/machi-shirube)";
const [code, url, license, title] = process.argv.slice(2);
if (!/^\d{5}$/.test(code ?? "") || !url) throw new Error("市区町村コードと CSV の URL を渡してください");

const raw = `data/raw/shelters/${code}.csv`;
if (!fs.existsSync(raw)) {
  fs.mkdirSync("data/raw/shelters", { recursive: true });
  await new Promise((r) => setTimeout(r, 1000));
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`取れませんでした（${res.status}）`);
  fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
}
const buf = fs.readFileSync(raw);
let text = new TextDecoder("utf-8").decode(buf);
if (text.includes("�")) text = new TextDecoder("shift_jis").decode(buf);
const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
const head = lines[0].split(",");
const col = (name) => head.indexOf(name);
const KINDS = { 洪水: "災害種別_洪水", 土砂: "災害種別_崖崩れ、土石流及び地滑り", 高潮: "災害種別_高潮", 地震: "災害種別_地震", 津波: "災害種別_津波", 火事: "災害種別_大規模な火事", 内水: "災害種別_内水氾濫", 火山: "災害種別_火山現象" };

const features = [];
for (const line of lines.slice(1)) {
  const r = line.split(",");
  const lat = Number(r[col("緯度")]);
  const lon = Number(r[col("経度")]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  features.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: {
      id: r[col("ID")],
      name: r[col("名称")],
      address: r[col("所在地_連結表記")],
      kinds: Object.entries(KINDS).filter(([, c]) => r[col(c)] === "1").map(([k]) => k),
      capacity: r[col("想定収容人数")] || undefined,
    },
  });
}
fs.mkdirSync("site/data/shelters", { recursive: true });
fs.writeFileSync(`site/data/shelters/${code}.json`, JSON.stringify({
  source: { title: title ?? "指定緊急避難場所一覧", url, license: license ?? "", fetchedAt: new Date().toISOString().slice(0, 10) },
  type: "FeatureCollection",
  features,
}));
console.log(`${code}: 避難場所 ${features.length}（津波に使える ${features.filter((f) => f.properties.kinds.includes("津波")).length}）`);
