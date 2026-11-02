// わが家の避難の計算の部品：見る人のブラウザが、その場で地図の絵（タイル）の色を読んで計算する。データはリポジトリに入れない。
// - 浸水の深さ：ハザードマップポータルサイト「重ねるハザードマップ」の想定の地図（公共データ利用規約 第1.0版）の色を、凡例で読みかえる
// - 海抜：地理院タイルの標高タイル（5m メッシュ、無い所は 10m メッシュ）
// - 歩く時間：まっすぐの線の上を 20m ごとに区切り、坂の上り下りで歩く速さを変える（平らな所で 1分 60m のめやす）
const HAZARD_TILES = {
  津波: { url: "https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png", name: "津波浸水想定" },
  洪水: { url: "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png", name: "洪水浸水想定区域（想定最大規模）" },
};
// 凡例の色 → 浸水の深さ（ハザードマップポータルサイトの凡例 shinsui_legend3 から読んだ）
const DEPTH_COLORS = [
  [[255, 255, 179], "0.3m 未満"], [[247, 245, 169], "0.3〜0.5m"], [[248, 225, 166], "0.5〜1m"], [[255, 216, 192], "1〜3m"],
  [[255, 183, 183], "3〜5m"], [[255, 145, 145], "5〜10m"], [[242, 133, 201], "10〜20m"], [[220, 122, 220], "20m 以上"],
];

const tileCache = new Map();
async function tilePixels(url) {
  if (!tileCache.has(url)) {
    tileCache.set(url, (async () => {
      const res = await fetch(url).catch(() => null);
      if (!res?.ok) return null; // 想定の無い所（海や区域の外）はタイルが無い
      const bmp = await createImageBitmap(await res.blob());
      const c = new OffscreenCanvas(256, 256);
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, 256, 256).data;
    })());
  }
  return tileCache.get(url);
}
// 経度・緯度の場所の色 [r, g, b, a]（タイルが無ければ null）
async function pixelAt(tpl, z, lon, lat) {
  const n = 2 ** z;
  const px = ((lon + 180) / 360) * n * 256;
  const r = (lat * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * 256;
  const [tx, ty] = [Math.floor(px / 256), Math.floor(py / 256)];
  const data = await tilePixels(tpl.replace("{z}", z).replace("{x}", tx).replace("{y}", ty));
  if (!data) return null;
  const i = (Math.floor(py - ty * 256) * 256 + Math.floor(px - tx * 256)) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

// 浸水の深さの想定（色が凡例に無い・透明なら「想定の区域の外」）
async function depthAt(kind, lon, lat) {
  const t = HAZARD_TILES[kind];
  if (!t) return null;
  const p = await pixelAt(t.url, 16, lon, lat);
  if (!p || p[3] < 128) return { label: null };
  let best = null;
  for (const [c, label] of DEPTH_COLORS) {
    const d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
    if (!best || d < best.d) best = { d, label };
  }
  return { label: best.d < 30 ? best.label : null };
}

// 海抜（m）。標高タイルの色は x = R×65536 + G×256 + B、x < 2^23 なら x×0.01m、無い所は 2^23
async function elevationAt(lon, lat) {
  for (const [tpl, z] of [["https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png", 15], ["https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png", 14]]) {
    const p = await pixelAt(tpl, z, lon, lat);
    if (!p) continue;
    const x = p[0] * 65536 + p[1] * 256 + p[2];
    if (x === 2 ** 23) continue;
    return (x < 2 ** 23 ? x : x - 2 ** 24) * 0.01;
  }
  return null;
}

// まっすぐの線の上を歩く時間（分）と、上り・下りの合計（m）。坂の速さはトブラーの式を、平らな所が 1分 60m になるように合わせたもの
async function walkMinutes(a, b, meters) {
  const steps = Math.max(1, Math.min(150, Math.ceil(meters / 20)));
  const pts = Array.from({ length: steps + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps]);
  const hs = await Promise.all(pts.map(([lon, lat]) => elevationAt(lon, lat)));
  let min = 0, up = 0, down = 0;
  const seg = meters / steps;
  for (let i = 0; i < steps; i++) {
    const dh = hs[i] != null && hs[i + 1] != null ? hs[i + 1] - hs[i] : 0;
    if (dh > 0) up += dh; else down -= dh;
    const factor = Math.exp(-3.5 * Math.abs(dh / seg + 0.05)) / Math.exp(-3.5 * 0.05);
    min += seg / (60 * factor);
  }
  return { min: Math.max(1, Math.round(min)), up: Math.round(up), down: Math.round(down), hasElevation: hs.some((h) => h != null) };
}
