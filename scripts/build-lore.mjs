// 昔の災害を伝える碑：国土地理院「自然災害伝承碑」（地理院タイル disaster_lore_all、全国 約2,500 基）を、市区町村ごとに分ける。
// 碑の番号の頭5桁が、碑を届けた市区町村の番号。その町の碑がないときも、近く（町の避難場所の真ん中から 12km 以内）の、ほかの町の碑を3つまで添える
// Claude は使わない（PC の仕分けだけ）。碑の文（伝承の内容）は国土地理院の公開のまま出し、出典を書く
// 動かし方: npm run build:lore（全国）
// タイルは local/cache/lore/ にだけ置く
import fs from "node:fs";
import { cached } from "./build-flood-pop.mjs";

const NEAR_KM = 12;
const tidy = (s) => String(s ?? "").replace(/<br\s*\/?>/g, " ").replace(/\s+/g, " ").trim();
const km = (a, b) => {
  const r = Math.PI / 180, x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r), y = (b[1] - a[1]) * r;
  return Math.sqrt(x * x + y * y) * 6371;
};

export async function buildLore(log = console.log) {
  // 日本をおおう z7 のタイル（碑はこの大きさのタイルにだけある）
  const all = [];
  for (let x = 107; x <= 118; x++) for (let y = 44; y <= 58; y++) {
    const buf = await cached(`https://cyberjapandata.gsi.go.jp/xyz/disaster_lore_all/7/${x}/${y}.geojson`, `local/cache/lore/7-${x}-${y}.geojson`);
    if (buf?.length) all.push(...JSON.parse(buf.toString("utf8")).features);
  }
  const lore = all.map((f) => {
    const p = f.properties;
    return {
      id: p.ID, muni: p.ID.split("-")[0], name: tidy(p.LoreName), disaster: tidy(p.DisasterName), kind: tidy(p.DisasterKind),
      built: tidy(p.LoreYear) || null, address: tidy(p.Address), text: tidy(p.DisasterInfo), image: tidy(p.Image) || null,
      at: f.geometry.coordinates.map((v) => Math.round(v * 1e5) / 1e5),
    };
  });
  log(`伝承碑 ${lore.length} 基（${new Set(lore.map((x) => x.muni)).size} 市区町村）`);
  const towns = JSON.parse(fs.readFileSync("site/data/stats.json", "utf8")).towns;
  fs.mkdirSync("site/data/lore", { recursive: true });
  let files = 0;
  for (const code of Object.keys(towns)) {
    const own = lore.filter((x) => x.muni === code);
    // 町の真ん中：町の避難場所の位置の平均（全国の町にある）
    const sh = fs.existsSync(`site/data/shelters/${code}.json`) ? JSON.parse(fs.readFileSync(`site/data/shelters/${code}.json`, "utf8")).features : [];
    const c = sh.length ? [sh.reduce((s, f) => s + f.geometry.coordinates[0], 0) / sh.length, sh.reduce((s, f) => s + f.geometry.coordinates[1], 0) / sh.length] : null;
    const near = c ? lore.filter((x) => x.muni !== code).map((x) => ({ ...x, km: Math.round(km(c, x.at) * 10) / 10 })).filter((x) => x.km <= NEAR_KM).sort((a, b) => a.km - b.km).slice(0, 3) : [];
    if (!own.length && !near.length) continue;
    const nameOf = (m) => (towns[m] ? `${towns[m].pref} ${towns[m].name}` : m);
    fs.writeFileSync(`site/data/lore/${code}.json`, JSON.stringify({
      code, own, near: near.map((x) => ({ ...x, muniName: nameOf(x.muni) })),
      note: "昔の災害（津波・洪水・土砂災害など）のようすや教訓を伝える石碑やモニュメントです。碑の文は国土地理院の公開のままです",
      sources: [{ title: "自然災害伝承碑（国土地理院）", url: "https://www.gsi.go.jp/bousaichiri/denshouhi.html" }],
    }, null, 1));
    files++;
  }
  log(`町のファイル ${files}（site/data/lore/）`);
}

if (process.argv[1]?.endsWith("build-lore.mjs")) await buildLore();
