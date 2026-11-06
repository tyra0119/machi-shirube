// 公園・図書館・公民館・公衆トイレの場所（作者「公園や図書館などgooglemapと連携できるものは、連携してほしい（経路検索できるように）」
// 「重ねて見る地図に表示できるもの増やせないかな」→ 3 と 5）。
// もとは OpenStreetMap（有志が作る地図。ODbL 1.0・© OpenStreetMap contributors）。町の形の中にある点だけを残す。Claude は使わない
// 取り先：Overpass API の公開の窓口 overpass.kumi.systems（overpass-api.de は robots.txt で /api/ を断っているので使わない）
// 名乗って取り、町ごとに間をあける。取った返事そのものは local/cache/places/ にだけ置く
// 動かし方: npm run build:places -- 10524,11227,15385,21211,39428
import fs from "node:fs";

const UA = "machi-shirube/0.1 (+https://github.com/tyra0119/machi-shirube)";
const API = "https://overpass.kumi.systems/api/interpreter";
const KINDS = [
  ["park", '["leisure"="park"]'],
  ["library", '["amenity"="library"]'],
  ["community", '["amenity"="community_centre"]'],
  ["toilets", '["amenity"="toilets"]'],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 点が町の形（Polygon・MultiPolygon）の中か
function inside([x, y], geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const rings of polys) {
    let inRing = false;
    for (const ring of rings.slice(0, 1)) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inRing = !inRing;
      }
    }
    if (inRing) return true;
  }
  return false;
}

async function overpass(code, bbox) {
  const file = `local/cache/places/${code}.json`;
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const [w, s, e, n] = bbox;
  // 公園は relation を頼まない（黒潮町で、国立公園などの大きな relation の真ん中を出すのに時間がかかり、何度頼んでも 90 秒で切れた。11/6）
  // 種類ごとに分けて、1つずつ頼む（まとめて頼むと、混んでいるときに 504 で断られた。11/6）。断られたら 20 秒あけて 2 回まで頼み直す
  const j = { elements: [] };
  for (const [k, f] of KINDS) {
    const q = `[out:json][timeout:60];${k === "park" ? "nw" : "nwr"}${f}(${s},${w},${n},${e});out center tags;`;
    for (let tryN = 0; ; tryN++) {
      const r = await fetch(API, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(90000) }).catch((err) => ({ ok: false, status: err.name }));
      if (r.ok) { j.elements.push(...((await r.json()).elements ?? [])); break; }
      if (tryN >= 2) throw new Error(`Overpass ${r.status}（${k}）`);
      await sleep(20000);
    }
    await sleep(3000);
  }
  fs.mkdirSync("local/cache/places", { recursive: true });
  fs.writeFileSync(file, JSON.stringify(j));
  return j;
}

export async function buildPlaces(code, log = console.log) {
  const muni = JSON.parse(fs.readFileSync(`site/data/muni/${code}.json`, "utf8"));
  const geom = muni.outline?.geometry;
  if (!geom) throw new Error("町の形がありません");
  const pts = (geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates).flat(2);
  const bbox = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  const j = await overpass(code, bbox);
  const items = [];
  const seen = new Set();
  for (const el of j.elements ?? []) {
    const t = el.tags ?? {};
    const lon = el.lon ?? el.center?.lon, lat = el.lat ?? el.center?.lat;
    if (lon == null || !inside([lon, lat], geom)) continue;
    const k = t.leisure === "park" ? "park" : t.amenity === "library" ? "library" : t.amenity === "community_centre" ? "community" : t.amenity === "toilets" ? "toilets" : null;
    if (!k) continue;
    if (k === "toilets" && /^(private|customers|no)$/.test(t.access ?? "")) continue; // 店の客だけ・使えないトイレは出さない
    const name = t["name:ja"] ?? t.name ?? "";
    if (k !== "toilets" && !name) continue; // 名前の無い公園などは、場所を人に伝えにくいので出さない
    const p = [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
    const key = `${k}:${name}:${p[0].toFixed(3)},${p[1].toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ k, n: name, p, ...(t.wheelchair ? { wc: t.wheelchair } : {}), ...(t.opening_hours ? { h: t.opening_hours } : {}) });
  }
  const count = Object.fromEntries(KINDS.map(([k]) => [k, items.filter((x) => x.k === k).length]));
  fs.mkdirSync("site/data/places", { recursive: true });
  fs.writeFileSync(`site/data/places/${code}.json`, JSON.stringify({
    code, createdAt: new Date().toISOString().slice(0, 10), count, items,
    source: { title: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright", license: "ODbL 1.0", credit: "© OpenStreetMap contributors" },
    note: "有志が作る地図（OpenStreetMap）から作りました。載っていない所や、古い所があります。開いている時間は、施設のページで確かめてください",
  }));
  log(`${code}：公園 ${count.park}・図書館 ${count.library}・公民館など ${count.community}・公衆トイレ ${count.toilets}`);
  return count;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const codes = (process.argv[2] ?? "").split(",").filter(Boolean);
  for (const [i, c] of codes.entries()) {
    if (i) await sleep(5000);
    try { await buildPlaces(c); } catch (e) { console.error(`${c}：${e.message}`); }
  }
}
