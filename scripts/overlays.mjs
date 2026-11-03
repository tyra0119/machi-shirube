// 国や公の機関のデータを重ねる計算を、町ごとにまとめて動かす（Claude は使わない。町を調べるときに、Claude の調べと並べて動かす）
// 浸水・土砂（ハザードマップ × 250m の人口）・地震の揺れの確率（J-SHIS × 250m の人口）・交通事故（警察庁）・買い物（農林水産政策研究所）・坂（標高 × 250m の人口）
// これからの人口（site/data/future.json）は全国の分がもうある。バス（GTFS）は町ごとに時刻表を選ぶので、ここでは動かさない
// 動かし方: node scripts/overlays.mjs 39428
import fs from "node:fs";
import { buildFloodPop, townMeshes } from "./build-flood-pop.mjs";
import { buildQuakePop } from "./build-quake-pop.mjs";
import { buildAccidents } from "./build-accidents.mjs";
import { buildShopAccess } from "./build-shop-access.mjs";
import { buildSlope } from "./build-slope.mjs";
import { buildClimate } from "./build-climate.mjs";
import { buildKaigo } from "./build-kaigo.mjs";

export async function buildOverlays(code, log = console.log, { force = false } = {}) {
  const steps = [
    ["浸水・土砂災害の想定の区域に住む人", `site/data/flood-pop/${code}.json`, (l) => buildFloodPop(code, l)],
    ["大きな地震の揺れの確率", `site/data/quake-pop/${code}.json`, (l) => buildQuakePop(code, l)],
    ["交通事故", `site/data/accidents/${code}.json`, (l) => buildAccidents([code], l)],
    ["買い物に困っているお年寄り", `site/data/shop-access/${code}.json`, (l) => buildShopAccess([code], l)],
    ["坂の多い所に住む人", `site/data/slope/${code}.json`, (l) => buildSlope(code, l)],
    ["町の気候（平年値）", `site/data/climate/${code}.json`, (l) => buildClimate(code, l)],
    ["近くの介護の事業所", `site/data/kaigo/${code}.json`, (l) => buildKaigo(code, l)],
  ];
  // 250m 四方の人口の表は、どの計算も使うので先に1回だけ読む（e-Stat へ同時に取りに行かないように）
  const todo = steps.filter(([, file]) => force || !fs.existsSync(file));
  if (!todo.length) { log("国のデータを重ねる計算は、もう済んでいます"); return; }
  await townMeshes(code, () => {}).catch(() => {});
  // 計算ごとに読みに行くサイトがちがうので、同時に動かす（同じサイトへの行儀は build-flood-pop.mjs の polite が守る）
  await Promise.all(todo.map(async ([name, file, run]) => {
    log(`国のデータを重ねています：${name}`);
    // 途中の進み具合も画面の作業の流れに出す（揺れの確率などは数分かかり、出さないと止まって見える）
    try { await run((t) => log(`${name}：${String(t).trim()}`)); } catch (e) { log(`${name}は出せませんでした：${e.message}`); }
  }));
  log("国のデータを重ねる計算が終わりました");
}

if (process.argv[1]?.endsWith("overlays.mjs")) for (const c of process.argv.slice(2)) await buildOverlays(c);
