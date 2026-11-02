// 国や公の機関のデータを重ねる計算を、町ごとにまとめて動かす（Claude は使わない。町を調べるときに、Claude の調べと並べて動かす）
// 浸水・土砂（ハザードマップ × 250m の人口）・地震の揺れの確率（J-SHIS × 250m の人口）・交通事故（警察庁）・買い物（農林水産政策研究所）・坂（標高 × 250m の人口）
// これからの人口（site/data/future.json）は全国の分がもうある。バス（GTFS）は町ごとに時刻表を選ぶので、ここでは動かさない
// 動かし方: node scripts/overlays.mjs 39428
import fs from "node:fs";
import { buildFloodPop } from "./build-flood-pop.mjs";
import { buildQuakePop } from "./build-quake-pop.mjs";
import { buildAccidents } from "./build-accidents.mjs";
import { buildShopAccess } from "./build-shop-access.mjs";
import { buildSlope } from "./build-slope.mjs";
import { buildClimate } from "./build-climate.mjs";

export async function buildOverlays(code, log = console.log, { force = false } = {}) {
  const steps = [
    ["浸水・土砂災害の想定の区域に住む人", `site/data/flood-pop/${code}.json`, () => buildFloodPop(code, () => {})],
    ["大きな地震の揺れの確率", `site/data/quake-pop/${code}.json`, () => buildQuakePop(code, () => {})],
    ["交通事故", `site/data/accidents/${code}.json`, () => buildAccidents([code], () => {})],
    ["買い物に困っているお年寄り", `site/data/shop-access/${code}.json`, () => buildShopAccess([code], () => {})],
    ["坂の多い所に住む人", `site/data/slope/${code}.json`, () => buildSlope(code, () => {})],
    ["町の気候（平年値）", `site/data/climate/${code}.json`, () => buildClimate(code, () => {})],
  ];
  for (const [name, file, run] of steps) {
    if (!force && fs.existsSync(file)) continue;
    log(`国のデータを重ねています：${name}`);
    try { await run(); } catch (e) { log(`${name}は出せませんでした：${e.message}`); }
  }
  log("国のデータを重ねる計算が終わりました");
}

if (process.argv[1]?.endsWith("overlays.mjs")) for (const c of process.argv.slice(2)) await buildOverlays(c);
