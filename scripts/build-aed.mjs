// AED の場所：町が公開している AED 設置箇所の一覧（CSV。多くは自治体標準オープンデータセットの形：名称・住所・緯度・経度・設置位置・利用可能日時 など）を読み、
// 町のページの地図に出す点にする。CSV の場所は、物差しの問い Q48 の答え（町の公式のページ）から作者が確かめたもの。Claude は使わない
// 動かし方: npm run build:aed -- 39428 https://…/aed.csv
// CSV そのものは local/cache/aed/ にだけ置く
import fs from "node:fs";
import { cached } from "./build-flood-pop.mjs";
import { rows as csvRows } from "./csv.mjs";

export async function buildAed(code, url, log = console.log) {
  const buf = await cached(url, `local/cache/aed/${code}.csv`);
  if (!buf) throw new Error("CSV を取れませんでした");
  // 文字の形：UTF-8 で読めなければ Shift_JIS
  let text = buf.toString("utf8");
  if (text.includes("�")) text = new TextDecoder("shift_jis").decode(buf);
  const [head, ...body] = csvRows(text.replace(/^﻿/, ""));
  const col = (...names) => head.findIndex((h) => names.some((n) => h.trim().includes(n)));
  const c = { name: col("名称", "施設名"), addr: col("住所", "所在地"), lat: col("緯度"), lon: col("経度"), place: col("設置位置", "設置場所"), days: col("利用可能日", "利用可能曜日"), start: col("開始時間"), end: col("終了時間"), note: col("備考") };
  if (c.lat < 0 || c.lon < 0) throw new Error(`緯度・経度の列がありません（${head.join("・")}）`);
  const g = (r, i) => (i >= 0 ? String(r[i] ?? "").trim() : "");
  const features = body.filter((r) => Number(g(r, c.lat)) && Number(g(r, c.lon))).map((r) => ({
    type: "Feature", geometry: { type: "Point", coordinates: [Math.round(Number(g(r, c.lon)) * 1e5) / 1e5, Math.round(Number(g(r, c.lat)) * 1e5) / 1e5] },
    properties: { name: g(r, c.name), address: g(r, c.addr), place: g(r, c.place), hours: [g(r, c.days), g(r, c.start) && `${g(r, c.start)}〜${g(r, c.end)}`].filter(Boolean).join(" "), note: g(r, c.note) },
  }));
  if (!features.length) throw new Error("場所のある行がありません");
  fs.mkdirSync("site/data/aed", { recursive: true });
  fs.writeFileSync(`site/data/aed/${code}.json`, JSON.stringify({
    code, source: { url, fetchedAt: new Date().toISOString().slice(0, 10) }, type: "FeatureCollection", features,
    note: "町が公開している AED 設置箇所の一覧から作りました。使える日と時間は施設によってちがいます。建物が閉まっていると使えないことがあります",
  }));
  log(`${code}：AED ${features.length} か所`);
  return features.length;
}

if (process.argv[1]?.endsWith("build-aed.mjs")) await buildAed(process.argv[2], process.argv[3]);
