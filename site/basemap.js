// 町のページの地図の背景：国土地理院の「地理院地図 Vector（標準）」を、色をうすく落ち着かせて使う。
// 画像の地図（淡色地図）より文字や線がくっきりし、拡大しても粗くならない。読めないときは画像の淡色地図にもどす
const GSI_VECTOR_STYLE = "https://gsi-cyberjapan.github.io/optimal_bvmap/style/std.json";
const PALE_RASTER = {
  version: 8,
  sources: { pale: { type: "raster", tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 18 } },
  layers: [{ id: "pale", type: "raster", source: "pale" }],
};

// 色を、白に寄せて鮮やかさを落とす（文字は読めるよう少しだけ）
function muteColor(c, amount) {
  const g = document.createElement("canvas").getContext("2d");
  g.fillStyle = "#000";
  g.fillStyle = c;
  const s = g.fillStyle; // "#rrggbb" か "rgba(r, g, b, a)"
  let r, gg, b, a = 1;
  if (s.startsWith("#")) [r, gg, b] = [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  else [r, gg, b, a = 1] = s.match(/[\d.]+/g).map(Number);
  const grey = 0.3 * r + 0.59 * gg + 0.11 * b;
  const mix = (v) => Math.round((v * 0.45 + grey * 0.55) * (1 - amount) + 255 * amount);
  return `rgba(${mix(r)}, ${mix(gg)}, ${mix(b)}, ${a})`;
}

let baseStylePromise;
function baseStyle() {
  baseStylePromise ??= fetch(GSI_VECTOR_STYLE).then((r) => r.json()).then((style) => {
    // 見た目の定義は PMTiles（まとめた形）を指すので、同じ中身のふつうのタイル（{z}/{x}/{y}.pbf）に読みかえる
    for (const src of Object.values(style.sources)) {
      if (src.type === "vector") src.tiles = ["https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/{z}/{x}/{y}.pbf"];
    }
    // 色は、式の中の色までうすくする。等高線は重ねたものの邪魔になるので出さない
    const isColor = (v) => typeof v === "string" && /^(#|rgb|hsl)/.test(v);
    const walk = (v, amount) => (Array.isArray(v) ? v.map((x) => walk(x, amount)) : isColor(v) ? muteColor(v, amount) : v);
    for (const l of style.layers) {
      if (/等高線|標高点/.test(l.id)) (l.layout ??= {}).visibility = "none";
      for (const [k, v] of Object.entries(l.paint ?? {})) {
        if (k.endsWith("-color")) l.paint[k] = walk(v, k === "text-color" ? 0.15 : k === "text-halo-color" ? 0 : 0.5);
      }
    }
    return style;
  }).catch(() => PALE_RASTER);
  return baseStylePromise.then((s) => structuredClone(s));
}
// 背景の地図の文字（地名など）を、いちばん上に移す（重ねた色やおおいの下に隠れないように）。点の層を足す前に呼ぶ
function raiseLabels(map) {
  for (const l of map.getStyle().layers) if (l.type === "symbol" && !l.source?.startsWith?.("my-")) map.moveLayer(l.id);
}
const BASEMAP_NOTE = "背景の地図：地理院地図 Vector（国土地理院）";

// ページの中の地図（防災・地図・事故）：指で触る端末では、指1本はページを動かし、2本指で地図を動かす。指1本で触ると「地図は2本指で動かせます」と出る。
// （実機で、ページを読み進めようと地図の上を払うと、ページが止まって地図が動き、避難場所の点が画面の外へ出た → 作者「A」。
//   Google マップを他のサイトに埋め込んだときと同じ形。マウスのホイールでの拡大・縮小は、全体設定のとおり、そのまま）
// 画面いっぱいの日本地図（app.js）には使わない
function pageMapOptions() {
  const touch = matchMedia("(pointer: coarse)").matches;
  const t = typeof T === "function" ? T : (s) => s;
  return touch ? {
    cooperativeGestures: true,
    locale: { "CooperativeGesturesHandler.MobileHelpText": t("地図は2本指で動かせます"), "CooperativeGesturesHandler.WindowsHelpText": t("地図は2本指で動かせます"), "CooperativeGesturesHandler.MacHelpText": t("地図は2本指で動かせます") },
  } : {};
}
