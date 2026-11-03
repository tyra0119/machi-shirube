// 日本地図（トップ）。N03 の市区町村の形だけで描く（背景の地図の画像は使わない）。
// 色は style.css の役割の色を読んで使い、夜の画面に切り替わったら塗り直す。
const NO_DATA = (code) => /000$/.test(code) || (code >= "01695" && code <= "01700"); // 所属未定地・北方領土

const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    // 地図の上の名前：漢字・かなはブラウザの文字で描く。「々」や全角のかっこなど、それで描けない文字だけ
    // 国土地理院が公開している地図用の文字（Noto Sans CJK JP）を取る
    glyphs: "https://maps.gsi.go.jp/xyz/noto-jp/{fontstack}/{range}.pbf",
    sources: {},
    layers: [{ id: "sea", type: "background", paint: { "background-color": color("--sea") } }],
  },
  localIdeographFontFamily: "'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic UI', sans-serif",
  center: [137.5, 37.5],
  zoom: 4.3,
  minZoom: 3.5,
  maxZoom: 14,
  maxBounds: [[110, 15], [165, 50]],
  hash: "z",
  attributionControl: false,
});
map.addControl(new MapButtons({ onNoLocation: showMessage }), "bottom-right");

// データを読む。読めなかったら、パネルの上に何が読めなかったかを出し続ける（黙って空の画面にしない）
const DATA_NAMES = {
  "stats.json": "全国の数字", "flags.json": "南海トラフの津波・火山・豪雪・離島の印", "index.json": "中の町の一覧",
  "japan.topo.json": "日本地図の形", "labels.json": "地図の名前", "pref-labels.json": "県の名前", "names.json": "町・字の名前",
};
async function getJSON(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch (e) {
    const file = path.split("/").pop();
    const what = DATA_NAMES[file] ?? (/^\d{5}\.json$/.test(file) ? "中の町の形" : file);
    const box = document.getElementById("problems");
    box.insertAdjacentHTML("beforeend", `<li>${what}が読み込めませんでした（${path}・${e.message}）</li>`);
    box.parentElement.hidden = false;
    throw e;
  }
}

let stats = null; // 住民基本台帳の数字（site/data/stats.json）
const statsReady = getJSON("data/stats.json").then((d) => (stats = d));
let flagData = { flags: {}, sources: {} }; // 南海トラフの津波・火山・豪雪・離島の印（site/data/flags.json）
getJSON("data/flags.json").then((d) => (flagData = d));
let summary = { towns: {} }; // 外部のデータの数（交通事故・これからの人口。site/data/summary.json）
getJSON("data/summary.json").then((d) => (summary = d)).catch(() => {});
// 市区町村の印。政令市まるごとは、どれかの区に付いていれば付ける
function flagsOf(code, t) {
  const own = flagData.flags[code];
  if (own || !t || t.ward) return own ?? {};
  const out = {};
  for (const [c, w] of Object.entries(stats.towns)) {
    if (w.ward && w.pref === t.pref && w.name.startsWith(t.name)) Object.assign(out, flagData.flags[c]);
  }
  return out;
}
let townIndex = { codes: [], names: [] }; // 中の町（町・字）の形を用意した市・区と、町・字の名前
const townIndexReady = getJSON("data/towns/index.json").then((d) => (townIndex = d));
let munis = null; // 市区町村の形（GeoJSON）
const byCode = new Map(); // 市区町村コード → 形
let shownTowns = null; // いま中の町を出している市・区のコード
let townData = null; // いま出している中の町の形

map.on("load", async () => {
  const [topo, labels, prefLabels] = await Promise.all([
    getJSON("data/japan.topo.json"),
    getJSON("data/labels.json"),
    getJSON("data/pref-labels.json"),
  ]);
  munis = topojson.feature(topo, topo.objects.municipalities);
  for (const f of munis.features) {
    const p = f.properties;
    p.noData = NO_DATA(p.code);
    p.label = p.ward || p.city || `${p.pref}の所属未定地`;
    p.fullName = `${p.city}${p.ward}` || p.label;
    byCode.set(p.code, f);
  }
  for (const f of labels.features) f.properties.label = byCode.get(f.properties.code)?.properties.label ?? "";
  const prefLines = topojson.mesh(topo, topo.objects.prefectures, (a, b) => a !== b);

  // 拡大したときだけ、道路や線路の見える背景を出す。町のページと同じ地理院地図 Vector（色をうすくしたもの）から、
  // 線と面（道路・線路・川・建物など）だけを借りる。名前の文字はこの地図が自分で描く
  const base = await baseStyle();
  const vsrc = Object.entries(base.sources ?? {}).find(([, s]) => s.type === "vector");
  if (vsrc) {
    map.addSource("gsi-v", vsrc[1]);
    for (const l of base.layers) {
      if (l.source !== vsrc[0] || !["fill", "line"].includes(l.type) || l.layout?.visibility === "none") continue;
      map.addLayer({ ...l, id: `base-${l.id}`, source: "gsi-v", minzoom: Math.max(l.minzoom ?? 0, 7), layout: { ...l.layout, visibility: basemapOn ? "visible" : "none" } });
    }
  }
  map.addSource("munis", { type: "geojson", data: munis, promoteId: "code" });
  map.addSource("prefs", { type: "geojson", data: prefLines });
  map.addSource("labels", { type: "geojson", data: { type: "FeatureCollection", features: labels.features.filter((f) => f.geometry) } });
  map.addLayer({ id: "muni-fill", type: "fill", source: "munis" });
  // 灯り：Claude が調べて答えを出した町は濃く光る（答えが多いほど濃い）。調べている最中の町は点滅（手元の画面だけ）
  map.addLayer({ id: "muni-lit", type: "fill", source: "munis" });
  map.addLayer({ id: "muni-lit-line", type: "line", source: "munis" });
  // 日本全体の大きさでも見えるよう、調べた町の位置に光る丸を置く（外側はぼかした光、内側は濃い点）
  map.addSource("lit-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "lit-glow", type: "circle", source: "lit-points", maxzoom: 9,
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 12, 8, 22], "circle-blur": 0.9, "circle-opacity": ["case", ["get", "running"], ["coalesce", ["feature-state", "blink"], 0.5], 0.55] } });
  map.addLayer({ id: "lit-dot", type: "circle", source: "lit-points", maxzoom: 9,
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 8, 7], "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" } });
  // 境目は、背景の地図の上でも見えるよう白い縁取りの上に濃い線を引く
  map.addLayer({ id: "muni-casing", type: "line", source: "munis", minzoom: 7 });
  map.addLayer({ id: "muni-line", type: "line", source: "munis" });
  // 県境は市町村の境目より太く濃い点線にして、白い縁取りで背景から浮かせる
  map.addLayer({ id: "pref-casing", type: "line", source: "prefs" });
  map.addLayer({ id: "pref-line", type: "line", source: "prefs" });
  map.addSource("pref-labels", { type: "geojson", data: prefLabels });
  map.addLayer({
    id: "pref-label", type: "symbol", source: "pref-labels", minzoom: 4.5, maxzoom: 7.5,
    layout: { "text-field": ["get", "pref"], "text-font": ["NotoSansCJKjp-Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 4.5, 12, 7, 16] },
  });
  map.addLayer({
    id: "muni-label", type: "symbol", source: "labels", minzoom: 7, maxzoom: 10, // その先は背景の地図の地名に任せる
    layout: { "text-field": ["get", "label"], "text-font": ["NotoSansCJKjp-Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 7, 12, 10, 15], "text-padding": 4 },
  });
  paint();
  lightTowns();

  // PC：マウスを乗せた町の名前を出す
  const tip = document.getElementById("tip");
  let hovered = null;
  map.on("mousemove", (e) => {
    const town = shownTowns && map.queryRenderedFeatures(e.point, { layers: ["town-fill"] })[0];
    const muni = !town && map.queryRenderedFeatures(e.point, { layers: ["muni-fill"] })[0];
    const code = muni?.properties.code ?? null;
    if (hovered !== code) {
      if (hovered) map.setFeatureState({ source: "munis", id: hovered }, { hover: false });
      if (code) map.setFeatureState({ source: "munis", id: code }, { hover: true });
      hovered = code;
    }
    const name = town ? town.properties.name : muni ? muni.properties.fullName : "";
    map.getCanvas().style.cursor = name ? "pointer" : "";
    tip.hidden = !name;
    if (name) {
      tip.textContent = name;
      tip.style.transform = `translate(${e.point.x + 14}px, ${e.point.y + 14}px)`;
    }
  });
  map.getCanvas().addEventListener("mouseleave", () => (tip.hidden = true));

  // 中の町が出ていれば中の町を、そうでなければ市区町村を選ぶ
  map.on("click", (e) => {
    const town = shownTowns && map.queryRenderedFeatures(e.point, { layers: ["town-fill"] })[0];
    // 複数を選んでいるとき・Ctrl（⌘）や Shift を押しながらのときは、選ぶ・外すを切り替える
    const add = e.originalEvent.ctrlKey || e.originalEvent.metaKey || e.originalEvent.shiftKey;
    if (town && (picked.size || add)) return togglePick(town.properties); // 複数を選ぶときは寄らない（選びにくくなるので）
    // 押した町・字や市区町村に寄る（形は描くために切れていることがあるので、元の形で）
    if (town) {
      const f = townData.features.find((x) => x.properties.town === town.properties.town);
      if (f) fit([f], 14);
      return showTownCard(town.properties);
    }
    const muni = map.queryRenderedFeatures(e.point, { layers: ["muni-fill"] })[0];
    if (muni) {
      const f = byCode.get(muni.properties.code);
      if (f) fit([f], 11);
      showCard(muni.properties);
    }
  });

  // URL で送られた町を開く（?pref=兵庫県 ／ ?muni=39428 ／ ?muni=11227&towns ／ ?town=11227-0130 ／ ?area=28109-a1）
  const q = new URLSearchParams(location.search);
  await statsReady.catch(() => {});
  await townIndexReady.catch(() => {});
  if (q.get("pref")) {
    if (munis.features.some((f) => f.properties.pref === q.get("pref"))) goPref(q.get("pref"));
  } else if (q.get("area")) {
    openArea(q.get("area"));
  } else if (q.get("town")) {
    const [code, partList] = q.get("town").split("-");
    const parts = partList.split(",");
    if (parts.length === 1) selectTown(code, parts[0]);
    else {
      await showTowns(code);
      for (const part of parts) {
        const f = townData.features.find((x) => x.properties.part === part);
        if (f) togglePick(f.properties);
      }
      fit(townData.features.filter((f) => picked.has(f.properties.town)), 14);
    }
  } else if (q.get("muni") && byCode.has(q.get("muni"))) {
    if (q.has("towns") && townIndex.codes.includes(q.get("muni"))) showTowns(q.get("muni"));
    else selectMuni(q.get("muni"));
  }
});

// 選んでいる町を URL に残す（送ると同じ町が開く。見ている場所は #z= のまま）
function rememberInURL() {
  const q = new URLSearchParams();
  if (shownTowns && currentArea) q.set("area", currentArea.id);
  else if (shownTowns && picked.size) q.set("town", `${shownTowns}-${[...picked.keys()].map((k) => k.slice(5)).join(",")}`);
  else if (shownTowns && selectedTown) q.set("town", `${shownTowns}-${selectedTown.slice(5)}`);
  else if (shownTowns) { q.set("muni", shownTowns); q.set("towns", ""); }
  else if (selected) q.set("muni", selected);
  else if (currentPref) q.set("pref", currentPref);
  const s = q.toString().replace(/=(&|$)/g, "$1").replace(/%2C/g, ",");
  history.replaceState(null, "", `${location.pathname}${s ? `?${s}` : ""}${location.hash}`);
}

// 形がおさまる範囲
function boundsOf(features) {
  const box = new maplibregl.LngLatBounds();
  for (const f of features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const pt of poly[0]) box.extend(pt);
  }
  return box;
}
const fit = (features, maxZoom = 12) => map.fitBounds(boundsOf(features), { padding: 60, maxZoom, duration: 700 });

// 市・区の中の町（町・字）を地図に出す
async function showTowns(code, { list = true } = {}) {
  const topo = await getJSON(`data/towns/${code}.json`);
  townData = topojson.feature(topo, topo.objects.towns);
  if (map.getSource("towns")) map.getSource("towns").setData(townData);
  else {
    map.addSource("towns", { type: "geojson", data: townData, promoteId: "town" });
    map.addLayer({ id: "town-fill", type: "fill", source: "towns" }, "pref-line");
    // 灯り：Claude が町・字を深く調べて答えを出した所は、中の町の地図でも光る（答えが多いほど濃い）
    map.addLayer({ id: "town-lit", type: "fill", source: "towns", paint: { "fill-color": color("--accent"), "fill-opacity": ["coalesce", ["feature-state", "lit"], 0] } }, "pref-line");
    map.addLayer({ id: "town-casing", type: "line", source: "towns" }, "pref-line");
    map.addLayer({ id: "town-line", type: "line", source: "towns" }, "pref-line");
    map.addLayer({
      id: "town-label", type: "symbol", source: "towns", minzoom: 11,
      layout: { "text-field": ["get", "name"], "text-font": ["NotoSansCJKjp-Regular"], "text-size": 13, "text-padding": 2 },
    });
  }
  for (const id of TOWN_LAYERS) map.setLayoutProperty(id, "visibility", "visible");
  map.setLayoutProperty("muni-label", "visibility", "none");
  lightParts(code);
  shownTowns = code;
  selectedTownName = null;
  picked.clear();
  paintTowns();
  updateCrumb();
  fit(townData.features);
  if (list) showTownList();
}
// 中の町をしまって、市区町村の地図に戻る（戻った市・区を選んだ状態にする）
function hideTowns({ quiet = false } = {}) {
  if (!shownTowns) return;
  const code = shownTowns;
  for (const id of TOWN_LAYERS) map.setLayoutProperty(id, "visibility", "none");
  map.setLayoutProperty("muni-label", "visibility", "visible");
  if (selectedTown) map.setFeatureState({ source: "towns", id: selectedTown }, { selected: false });
  selectedTown = null;
  selectedTownName = null;
  clearPicks();
  shownTowns = null;
  updateCrumb();
  if (quiet) return;
  const f = byCode.get(code);
  if (f) showCard(f.properties);
  map.easeTo({ zoom: Math.max(map.getZoom() - 1.5, 6), duration: 500 });
}
addEventListener("keydown", (e) => e.key === "Escape" && hideTowns());

// いま見ている所の道すじ（日本 › 県 › 市区町村 › 町・字）。どこを押しても、その段に戻る
let selectedTownName = null;
function updateCrumb() {
  rememberInURL();
  const crumb = document.getElementById("crumb");
  const code = shownTowns ?? selected;
  const p = code && byCode.get(code)?.properties;
  if (p) currentPref = null; // 町を選んだら、県だけの状態は終わり
  if (!p && currentPref) {
    crumb.querySelector(".path").innerHTML = `<li><button type="button">日本</button></li><li aria-current="location"><span>${currentPref}</span></li>`;
    crumb.querySelector(".path button").addEventListener("click", goJapan);
    crumb.hidden = false;
    return;
  }
  if (!p) { crumb.hidden = true; return; }
  const steps = [
    { label: "日本", go: goJapan },
    { label: p.pref, go: () => goPref(p.pref) },
    { label: p.fullName, go: () => (shownTowns ? hideTowns() : null) },
  ];
  if (shownTowns && currentArea) steps.push({ label: currentArea.name, go: null });
  else if (shownTowns && picked.size) steps.push({ label: `${picked.size}つの町・字`, go: null });
  else if (shownTowns) steps.push({ label: selectedTownName ?? "中の町", go: selectedTownName ? showTownList : null });
  const path = crumb.querySelector(".path");
  path.innerHTML = steps.map((s, i) =>
    i === steps.length - 1 || !s.go
      ? `<li aria-current="${i === steps.length - 1 ? "location" : "false"}"><span>${s.label}</span></li>`
      : `<li><button type="button" data-i="${i}">${s.label}</button></li>`,
  ).join("");
  path.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => steps[Number(b.dataset.i)].go()));
  crumb.hidden = false;
}
function goJapan() {
  currentPref = null;
  hideTowns({ quiet: true });
  hideCard();
  map.easeTo({ center: [137.5, 37.5], zoom: 4.3, bearing: 0, pitch: 0, duration: 700 });
}
let currentPref = null; // 県に寄っているとき（道すじと URL に出す）
function goPref(pref) {
  hideTowns({ quiet: true });
  hideCard();
  currentPref = pref;
  updateCrumb();
  fit(munis.features.filter((f) => f.properties.pref === pref), 10);
}

const TOWN_LAYERS = ["town-fill", "town-lit", "town-casing", "town-line", "town-label"];
const isSelected = ["boolean", ["feature-state", "selected"], false];
function paintTowns() {
  if (!map.getLayer("town-fill")) return;
  if (colorBy?.source === "towns") {
    map.setPaintProperty("town-fill", "fill-color", choropleth());
    map.setPaintProperty("town-fill", "fill-opacity", 0.85);
  } else {
    map.setPaintProperty("town-fill", "fill-color", ["case", isSelected, color("--accent"), color("--land")]);
    map.setPaintProperty("town-fill", "fill-opacity", basemapOn ? ["case", isSelected, 0.45, 0.15] : ["case", isSelected, 0.9, 1]);
  }
  map.setPaintProperty("town-casing", "line-color", color("--land"));
  map.setPaintProperty("town-casing", "line-width", 4);
  map.setPaintProperty("town-casing", "line-opacity", basemapOn ? 0.9 : 0);
  map.setPaintProperty("town-line", "line-color", color("--text"));
  map.setPaintProperty("town-line", "line-width", 1.5);
  paintLabel("town-label");
}

// 背景の地図を出す・消す（どちらにしたかは、この端末に覚えておく）
let basemapOn = true;
try { basemapOn = localStorage.getItem("basemap") !== "off"; } catch {}
const basemapButton = document.getElementById("basemap");
function showBasemapState() {
  basemapButton.textContent = basemapOn ? "背景の地図：表示中" : "背景の地図：非表示";
  basemapButton.setAttribute("aria-pressed", String(basemapOn));
}
showBasemapState();
basemapButton.addEventListener("click", () => {
  basemapOn = !basemapOn;
  try { localStorage.setItem("basemap", basemapOn ? "on" : "off"); } catch {}
  showBasemapState();
  for (const l of map.getStyle().layers) if (l.id.startsWith("base-")) map.setLayoutProperty(l.id, "visibility", basemapOn ? "visible" : "none");
  paint();
  paintTowns();
});
function paintLabel(id) {
  map.setPaintProperty(id, "text-color", color("--text"));
  map.setPaintProperty(id, "text-halo-color", color("--land"));
  map.setPaintProperty(id, "text-halo-width", 2);
}

// 数字の色分け：範囲の外は地の色、選んでいる町は濃い線の代わりに作品の色をそのまま
function choropleth() {
  const v = ["feature-state", "v"];
  return [
    "case",
    ["==", v, null], color("--land"),
    ["interpolate", ["linear"], v, colorBy.low, color("--land"), colorBy.high, color("--accent")],
  ];
}

function paint() {
  map.setPaintProperty("sea", "background-color", color("--sea"));
  const lit = ["coalesce", ["feature-state", "lit"], 0];
  const running = ["boolean", ["feature-state", "running"], false];
  map.setPaintProperty("muni-lit", "fill-color", color("--accent"));
  map.setPaintProperty("muni-lit", "fill-opacity", ["case", running, ["coalesce", ["feature-state", "blink"], 0.2], ["*", lit, 0.75]]);
  map.setPaintProperty("muni-lit-line", "line-color", color("--accent"));
  map.setPaintProperty("muni-lit-line", "line-width", ["case", ["any", running, [">", lit, 0]], 2, 0]);
  map.setPaintProperty("lit-glow", "circle-color", color("--accent"));
  map.setPaintProperty("lit-dot", "circle-color", color("--accent"));
  // 数字で並べているときは、灯りを消して数字の色だけにする
  for (const id of ["muni-lit", "muni-lit-line", "lit-glow", "lit-dot"]) map.setLayoutProperty(id, "visibility", colorBy ? "none" : "visible");
  map.setPaintProperty("muni-fill", "fill-color", [
    "case",
    ["get", "noData"], color("--no-data"),
    ["boolean", ["feature-state", "selected"], false], color("--accent"),
    ["boolean", ["feature-state", "hover"], false], color("--line"),
    color("--land"),
  ]);
  // 拡大すると背景の地図が透けて見えるよう、町の塗りを薄くする（背景を消したときは塗ったまま）
  map.setPaintProperty("muni-fill", "fill-opacity", basemapOn
    ? ["interpolate", ["linear"], ["zoom"], 7, ["case", isSelected, 1, 1], 9, ["case", isSelected, 0.45, 0.15]]
    : 1);
  // 数字で並べているときは、その数字で塗り分ける
  if (colorBy?.source === "munis") {
    map.setPaintProperty("muni-fill", "fill-color", ["case", ["get", "noData"], color("--no-data"), choropleth()]);
    map.setPaintProperty("muni-fill", "fill-opacity", ["case", isSelected, 1, 0.85]);
  }
  // 背景を出しているときは、大きく拡大したら名前を背景の地名に任せる
  map.setLayerZoomRange("muni-label", 7, basemapOn ? 10 : 24);
  map.setPaintProperty("muni-casing", "line-color", color("--land"));
  map.setPaintProperty("muni-casing", "line-width", ["interpolate", ["linear"], ["zoom"], 7, 2, 12, 6]);
  map.setPaintProperty("muni-casing", "line-opacity", basemapOn ? ["interpolate", ["linear"], ["zoom"], 7, 0, 9, 0.9] : 0);
  const dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
  // 絵の背景（淡色地図）は、地理院地図 Vector が読めなかったときだけある。無いのに塗ると、ここで止まって続きの線の色が付かなかった
  if (map.getLayer("gsi-pale")) {
    map.setPaintProperty("gsi-pale", "raster-brightness-max", dark ? 0.4 : 1);
    map.setPaintProperty("gsi-pale", "raster-saturation", dark ? -0.6 : 0);
    map.setPaintProperty("gsi-pale", "raster-opacity", ["interpolate", ["linear"], ["zoom"], 7, 0, 8.5, 1]);
  }
  map.setPaintProperty("muni-line", "line-color", color("--pref-line"));
  map.setPaintProperty("muni-line", "line-opacity", ["interpolate", ["linear"], ["zoom"], 4, 0.3, 9, 0.9]);
  map.setPaintProperty("muni-line", "line-width", ["interpolate", ["linear"], ["zoom"], 4, 0.2, 9, 1, 12, 2]);
  map.setPaintProperty("pref-casing", "line-color", color("--land"));
  map.setPaintProperty("pref-casing", "line-width", ["interpolate", ["linear"], ["zoom"], 4, 1.5, 9, 6, 12, 9]);
  map.setPaintProperty("pref-casing", "line-opacity", 0.9);
  map.setPaintProperty("pref-line", "line-color", color("--text"));
  map.setPaintProperty("pref-line", "line-width", ["interpolate", ["linear"], ["zoom"], 4, 0.8, 9, 2.5, 12, 4]);
  map.setPaintProperty("pref-line", "line-dasharray", [3, 1.5]);
  paintLabel("muni-label");
  paintLabel("pref-label");
  map.setPaintProperty("pref-label", "text-color", color("--text-sub"));
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (map.getLayer("muni-fill")) paint();
  paintTowns();
});

let selected = null;
function showCard(p) {
  if (selected) map.setFeatureState({ source: "munis", id: selected }, { selected: false });
  selected = p.code;
  map.setFeatureState({ source: "munis", id: selected }, { selected: true });
  updateCrumb();

  const card = document.getElementById("card");
  const where = [p.pref, p.county].filter(Boolean).join(" ");
  const town = stats?.towns[p.code];
  const f = town ? flagsOf(p.code, town) : {};
  const tagList = [f.tsunami && "南海トラフの津波の特別強化地域", f.volcano && "火山の警戒地域", f.snow, f.island && "離島がある"].filter(Boolean);
  const tags = tagList.length ? `<p class="tags">${tagList.map((t) => `<span>${t}</span>`).join("")}</p>` : "";
  const types = town ? `<h3 class="sub">届きにくい人の候補</h3>${typeCandidatesHTML(town, f, stats.summary)}` : "";
  const body = p.noData || !town ? "<p>この地域には国の統計がありません。</p>" : tags + featureCard(town) + types;
  // 市・区は広いので、中の町（町・字）まで下りられるようにする
  const isCityOrWard = /[市区]$/.test(p.fullName);
  const hasTowns = townIndex.codes.includes(p.code);
  // 町村はそのまま1つの町。中の地区（字）も見られるようにする
  const towns = hasTowns ? `<button type="button" class="secondary towns">${isCityOrWard ? "中の町を選ぶ" : "中の地区（字）を見る"}</button>`
    : isCityOrWard ? `<p class="note">中の町（町・字）の形は、まだ用意していません。</p>` : "";
  card.innerHTML = `
    <button type="button" class="close" aria-label="閉じる">×</button>
    <h2>${p.fullName}</h2>
    <p class="where">${where}・市区町村コード ${p.code}</p>
    ${actions(town ? `town.html?muni=${p.code}` : null, towns)}
    ${body}`;
  card.querySelector(".close").addEventListener("click", hideCard);
  // 手元の画面だけ：この町を調べる（調べる画面で「調べ始める」を押すと、裏で Claude が物差しの問いを調べる）
  if (town) {
    isLocal.then((ok) => {
      if (!ok || selected !== p.code) return;
      card.querySelector(".card-actions")?.insertAdjacentHTML("beforeend",
        `<a class="secondary as-button" href="research.html?muni=${p.code}">この町を調べる（手元の画面だけ）</a>`);
    });
  }
  card.querySelector(".towns")?.addEventListener("click", () => {
    map.setFeatureState({ source: "munis", id: p.code }, { selected: false });
    showTowns(p.code);
  });
  openCard();
}

// カードのボタンの段：どのカードも名前のすぐ下の同じ場所に。いちばん上は「この町のページを開く」（目立つボタンは1つだけ）、
// その下に控えめなボタン
function actions(pageHref, more = "", pageLabel = "この町のページを開く") {
  const page = pageHref ? `<a class="primary as-button" href="${pageHref}">${pageLabel}</a>` : "";
  return page || more ? `<div class="card-actions">${page}${more}</div>` : "";
}

// パネル：はじめの説明と、町のカードを入れかえる
function openCard() {
  const card = document.getElementById("card");
  document.getElementById("guide").hidden = true;
  document.getElementById("rank").hidden = true;
  // 並べた一覧から来たときは、一覧に戻るボタンを付ける
  if (rankOn && !card.querySelector(".back-to-rank")) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "back-to-rank";
    back.textContent = "← 並べた一覧に戻る";
    back.addEventListener("click", showRankPanel);
    card.prepend(back);
  }
  card.hidden = false;
  document.querySelector(".panel-body").scrollTop = 0;
}
function closeCard() {
  document.getElementById("card").hidden = true;
  if (rankOn) return showRankPanel();
  document.getElementById("guide").hidden = false;
}

// 中の町の一覧（地図で押すほか、ここからも選べる）
function showTownList() {
  if (selectedTown) map.setFeatureState({ source: "towns", id: selectedTown }, { selected: false });
  selectedTown = null;
  selectedTownName = null;
  updateCrumb();
  const muni = byCode.get(shownTowns)?.properties;
  const card = document.getElementById("card");
  const towns = [...townData.features].sort((a, b) => a.properties.part.localeCompare(b.properties.part));
  card.innerHTML = `
    <button type="button" class="close" aria-label="閉じる">×</button>
    <h2>${muni?.fullName ?? ""}の中の町</h2>
    <p class="where">地図で町を押すか、下から選んでください（${towns.length}の町・字）</p>
    ${actions(`town.html?muni=${shownTowns}`, `<button type="button" class="secondary multi">複数の町・字を選ぶ（合わせて見る）</button>`, `${muni?.fullName ?? ""}のページを開く`)}
    ${areas.some((a) => a.muni === shownTowns) ? `<p class="where">まとまり</p><ul class="town-list areas">${areas.filter((a) => a.muni === shownTowns).map((a) =>
      `<li><button type="button" data-area="${a.id}"><span class="n">${a.name}</span><span class="p">${a.parts.length}の町・字</span></button></li>`).join("")}</ul><p class="where">町・字</p>` : ""}
    <ul class="town-list">${towns.map((f) => `<li><button type="button" data-part="${f.properties.part}"><span class="n">${f.properties.name}</span><span class="p">${f.properties.population ? `${f.properties.population.toLocaleString("ja-JP")}人` : "人が住んでいない"}</span></button></li>`).join("")}</ul>
    <p class="cite">人口：${townIndex.source}（${townIndex.asOf}）</p>`;
  card.querySelector(".close").addEventListener("click", hideTowns);
  card.querySelector(".multi").addEventListener("click", () => showPickedCard());
  for (const b of card.querySelectorAll(".town-list button")) {
    b.addEventListener("click", () => (b.dataset.area ? openArea(b.dataset.area) : selectTown(shownTowns, b.dataset.part)));
  }
  openCard();
}

// まとまり：複数の町・字に名前を付けて、1つの町として扱う（site/data/areas.json。保存は手元の画面だけ）
let areas = [];
const areasReady = fetch("data/areas.json").then((r) => (r.ok ? r.json() : { areas: [] })).then((d) => (areas = d.areas)).catch(() => {});
const isLocal = fetch("api/ping").then((r) => r.ok).catch(() => false); // 手元のサーバーなら保存できる
let currentArea = null;

async function openArea(id) {
  await areasReady;
  const a = areas.find((x) => x.id === id);
  if (!a) return;
  if (shownTowns !== a.muni) await showTowns(a.muni, { list: false });
  clearPicks();
  for (const part of a.parts) {
    const f = townData.features.find((x) => x.properties.part === part);
    if (f) picked.set(f.properties.town, f.properties);
  }
  for (const k of picked.keys()) map.setFeatureState({ source: "towns", id: k }, { selected: true });
  currentArea = a;
  fit(townData.features.filter((f) => picked.has(f.properties.town)), 14);
  showPickedCard();
}

async function saveArea(name) {
  const res = await fetch("api/areas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, muni: shownTowns, parts: [...picked.keys()].map((k) => k.slice(5)) }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.status);
  areas.push(body);
  cands = null; // 名前で探す候補を作り直す
  return body;
}

// 複数の町・字を選んで合わせて見る（picked：町・字のキー9けた → 数字）
const picked = new Map();
function togglePick(p) {
  // 1つだけ選んでいた町・字があれば、それも選んだものに入れてから始める
  if (selectedTown && !picked.size && selectedTown !== p.town) {
    const f = townData.features.find((x) => x.properties.town === selectedTown);
    if (f) picked.set(selectedTown, f.properties);
  }
  selectedTown = null;
  selectedTownName = null;
  currentArea = null; // まとまりの中身を変えたら、まとまりではなく「選んだ町・字」にもどる
  if (picked.has(p.town)) picked.delete(p.town);
  else picked.set(p.town, p);
  for (const f of townData.features) {
    map.setFeatureState({ source: "towns", id: f.properties.town }, { selected: picked.has(f.properties.town) });
  }
  showPickedCard();
}
function clearPicks() {
  for (const k of picked.keys()) map.setFeatureState({ source: "towns", id: k }, { selected: false });
  picked.clear();
  currentArea = null;
}
// 割合は、町・字ごとの割合に人数（世帯の割合は世帯の数）で重みをつけて合わせる。めやす
const PERSON_RATES = ["over65Rate", "over75Rate", "under15Rate", "foreignRate"];
const HOUSEHOLD_RATES = ["elderlySingleRate", "singleRate", "ownedRate", "apartmentRate"];
function combined() {
  const list = [...picked.values()];
  const sum = (k) => list.reduce((s, p) => s + (p[k] ?? 0), 0);
  const out = { population: sum("population"), households: sum("households") };
  for (const m of [...PERSON_RATES, ...HOUSEHOLD_RATES]) {
    const w = PERSON_RATES.includes(m) ? "population" : "households";
    const have = list.filter((p) => p[m] != null && p[w]);
    const weight = have.reduce((s, p) => s + p[w], 0);
    out[m] = weight ? have.reduce((s, p) => s + p[m] * p[w], 0) / weight : null;
    out[`${m}Missing`] = list.length - have.length;
  }
  return out;
}
function showPickedCard() {
  updateCrumb();
  const card = document.getElementById("card");
  const muni = byCode.get(shownTowns)?.properties;
  if (!picked.size) {
    card.innerHTML = `
      <button type="button" class="close" aria-label="閉じる">×</button>
      <h2>複数の町・字を選ぶ</h2>
      <p class="where">${muni?.fullName ?? ""}の中の町・字を、地図か下の一覧で押して選んでください。もう一度押すと外れます</p>
      <ul class="town-list">${[...townData.features].sort((a, b) => a.properties.part.localeCompare(b.properties.part)).map((f) =>
        `<li><button type="button" data-town="${f.properties.town}"><span class="n">${f.properties.name}</span><span class="p">${f.properties.population ? `${f.properties.population.toLocaleString("ja-JP")}人` : "人が住んでいない"}</span></button></li>`).join("")}</ul>`;
    card.querySelector(".close").addEventListener("click", showTownList);
    for (const b of card.querySelectorAll(".town-list button")) {
      b.addEventListener("click", () => togglePick(townData.features.find((f) => f.properties.town === b.dataset.town).properties));
    }
    return openCard();
  }
  const c = combined();
  const rows = [...PERSON_RATES, ...HOUSEHOLD_RATES].filter((m) => c[m] != null).map((m) =>
    `<li><span class="label">${TOWN_METRICS[m].label}</span><span class="value">${c[m].toFixed(1)}%</span>${c[`${m}Missing`] ? `<span class="place">${c[`${m}Missing`]}の町・字は数字が無く、入れずに計算</span>` : ""}</li>`);
  const a = currentArea;
  const names = [...picked.values()].map((p) => a
    ? `<li><span>${p.name}</span></li>`
    : `<li><span>${p.name}</span><button type="button" data-town="${p.town}" aria-label="${p.name}を外す">×</button></li>`).join("");
  card.innerHTML = `
    <button type="button" class="close" aria-label="閉じる">×</button>
    <h2>${a ? a.name : `選んだ町・字（${picked.size}）`}</h2>
    <p class="where">${muni ? `${muni.pref} ${muni.fullName}` : ""}・${a ? `まとまり（${picked.size}の町・字）` : "地図か一覧で押すと、選ぶ・外すが切り替わります"}</p>
    <div class="card-actions">
      ${a ? `<a class="primary as-button" href="town.html?area=${a.id}">この町のページを開く</a>` : picked.size >= 2 ? `<div class="save-area">
        <button type="button" class="primary to-area">1つの町のページにする</button>
        <form class="area-form" hidden>
          <label class="field">町の名前（例：上津台地区）<input name="name" maxlength="30" required></label>
          <button type="submit" class="primary">名前を付けて、町のページを作る</button>
          <p class="note">保存すると site/data/areas.json に書かれ、コミットすると公開のサイトにも出ます。</p>
        </form>
      </div>` : ""}
      <button type="button" class="secondary done">${a ? "中の町の一覧へ" : "選び終わる（中の町の一覧へ）"}</button>
    </div>
    <ul class="picked">${names}</ul>
    <p class="pop">合わせて 人口 ${c.population.toLocaleString("ja-JP")}人・${c.households.toLocaleString("ja-JP")}世帯</p>
    <ul class="features">${rows.join("")}</ul>
    <p class="note">割合は、町・字ごとの割合に人数（世帯の割合は世帯の数）で重みをつけて合わせた、めやすです。</p>
    <p class="cite">出典：${townIndex.source}（${townIndex.asOf}）</p>`;
  card.querySelector(".close").addEventListener("click", () => { clearPicks(); showTownList(); });
  card.querySelector(".done").addEventListener("click", () => { clearPicks(); showTownList(); });
  for (const b of card.querySelectorAll(".picked button")) b.addEventListener("click", () => togglePick(picked.get(b.dataset.town)));
  // 2つ以上選んだら、1つの町のページにできる。手元の画面なら名前を付けて保存（まとまり）、
  // 公開のサイトでは保存せず、選んだ町・字を URL に入れてページを開く
  const save = card.querySelector(".save-area");
  if (save) {
    const form = save.querySelector(".area-form");
    const parts = [...picked.keys()].map((k) => k.slice(5)).join(",");
    save.querySelector(".to-area").addEventListener("click", async (e) => {
      if (!(await isLocal)) return (location.href = `town.html?town=${shownTowns}-${parts}`);
      e.target.hidden = true;
      form.hidden = false;
      form.name.focus();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const area = await saveArea(form.name.value);
        location.href = `town.html?area=${area.id}`;
      } catch (err) {
        showMessage(`保存できませんでした：${err.message}`);
      }
    });
  }
  openCard();
}

// 政令市（形は区ごと）：区を選んでもらう
function showCityCard(cityName, pref) {
  const wards = munis.features.filter((f) => f.properties.city === cityName && f.properties.pref === pref && f.properties.ward);
  fit(wards, 10);
  hideCard();
  const card = document.getElementById("card");
  card.innerHTML = `
    <button type="button" class="close" aria-label="閉じる">×</button>
    <h2>${cityName}</h2>
    <p class="where">${pref}・区を選んでください</p>
    <div class="choices">${wards.map((w) => `<button type="button" data-code="${w.properties.code}">${w.properties.ward}</button>`).join("")}</div>`;
  card.querySelector(".close").addEventListener("click", closeCard);
  for (const b of card.querySelectorAll(".choices button")) b.addEventListener("click", () => selectMuni(b.dataset.code));
  openCard();
}

let selectedTown = null;
function showTownCard(p) {
  if (selectedTown) map.setFeatureState({ source: "towns", id: selectedTown }, { selected: false });
  selectedTown = p.town;
  selectedTownName = p.name;
  map.setFeatureState({ source: "towns", id: selectedTown }, { selected: true });
  updateCrumb();
  const muni = byCode.get(shownTowns)?.properties;
  const card = document.getElementById("card");
  const rows = ["over65Rate", "over75Rate", "under15Rate", "foreignRate", "elderlySingleRate", "singleRate", "ownedRate", "apartmentRate"].filter((m) => p[m] != null);
  const ages = (rows.length
    ? `<ul class="features">${rows.map((m) =>
        `<li><span class="label">${TOWN_METRICS[m].label}</span><span class="value">${p[m].toFixed(1)}%</span><span class="place">${townPlace(p, m)}</span></li>`).join("")}</ul>`
    : "") + (p.ageHidden || p.foreignHidden || p.householdHidden ? `<p class="note">一部の数字は、住む人が少ないため国勢調査で隠されています。</p>` : "");
  const people = p.population
    ? `<p class="pop">人口 ${p.population.toLocaleString("ja-JP")}人・${p.households.toLocaleString("ja-JP")}世帯</p>${ages}`
    : `<p class="pop">人の住んでいない町・字です</p>`;
  card.innerHTML = `
    <button type="button" class="close" aria-label="閉じる">×</button>
    <h2>${p.name}</h2>
    <p class="where">${muni ? `${muni.pref} ${muni.fullName}` : ""}・町・字の番号 ${p.part}</p>
    ${actions(`town.html?town=${shownTowns}-${p.part}`, `<button type="button" class="secondary multi">ほかの町・字も選ぶ（合わせて見る）</button>`)}
    ${people}
    <p class="note">この町は、まだ深く調べていません。</p>
    <p class="cite">出典：${townIndex.source}（${townIndex.asOf}）</p>`;
  card.querySelector(".multi").addEventListener("click", () => togglePick(p));
  // 手元の画面だけ：この町・字を調べる（町・字ごとに違うこと＝ごみの曜日・校区・自治会・近くの計画を、町・字の問いで調べる）
  isLocal.then((ok) => {
    if (!ok || selectedTown !== p.town) return;
    card.querySelector(".card-actions")?.insertAdjacentHTML("beforeend",
      `<a class="secondary as-button" href="research.html?muni=${shownTowns}&part=${p.part}">この町・字を調べる（手元の画面だけ）</a>`);
  });
  // 閉じると、中の町の一覧に戻る
  card.querySelector(".close").addEventListener("click", () => {
    map.setFeatureState({ source: "towns", id: selectedTown }, { selected: false });
    selectedTown = null;
    showTownList();
  });
  openCard();
}

// 町・字の数字が、同じ市・区の中で高いほう（低いほう）から何%の所か（順位は言わない）
function townPlace(p, m) {
  const vals = townData.features.map((f) => f.properties[m]).filter((v) => typeof v === "number");
  const muni = byCode.get(shownTowns)?.properties.fullName ?? "";
  return `${muni}の町・字の中で${partShare(vals, p[m])}`;
}
// 高いほうから ○%（50% を超えるときは 低いほうから ○%）
function partShare(vals, v) {
  const top = ((vals.filter((x) => x > v).length + 1) / vals.length) * 100;
  return top <= 50 ? `高いほうから ${Math.max(top, 0.1).toFixed(0)}%` : `低いほうから ${Math.max(100 - top + 100 / vals.length, 0.1).toFixed(0)}%`;
}

// 選ぶ（名前で探したときも、地図で押したときと同じ形にする）
function selectMuni(code) {
  if (shownTowns) hideTowns();
  const f = byCode.get(code);
  if (!f) return;
  fit([f], 11);
  showCard(f.properties);
}
async function selectTown(code, part) {
  if (shownTowns !== code) await showTowns(code);
  const f = townData.features.find((x) => x.properties.part === part);
  if (!f) return;
  fit([f], 13);
  showTownCard(f.properties);
}

// 特色のカード：どの町でも同じ順で5つ出し、全国の上下 20% に入る数字に「目立つ」の印（3つまで、真ん中から遠い順）
const METRICS = {
  over65Rate: { label: "65歳以上の人の割合", unit: "%" },
  under15Rate: { label: "15歳未満の子どもの割合", unit: "%" },
  foreignRate: { label: "外国の住民の割合", unit: "%" },
  changeRate: { label: "1年の人口の増減", unit: "%", signed: true },
  socialChangeRate: { label: "引っ越しによる1年の増減", unit: "%", signed: true },
};
function featureCard(t) {
  const notable = new Set(
    Object.keys(METRICS)
      .map((m) => ({ m, edge: Math.min(t.top[m], 100 - t.top[m]) }))
      .filter((x) => x.edge <= 20)
      .sort((a, b) => a.edge - b.edge)
      .slice(0, 3)
      .map((x) => x.m),
  );
  const items = Object.keys(METRICS).map((m) => {
    const { label, unit, signed } = METRICS[m];
    const v = t[m];
    const value = `${signed && v > 0 ? "+" : ""}${v.toFixed(1)}${unit}`;
    const top = t.top[m];
    const place =
      top <= 50 ? `全国で高いほうから ${Math.max(top, 0.1).toFixed(1)}%`
      : `全国で低いほうから ${Math.max(100 - top, 0.1).toFixed(1)}%`;
    // 人の少ない村の大きな割合に埋もれる町は、人口2万人以上の中での順位も添える（3番目まで）
    const big = t.rankBig?.[m];
    const bigNote = big && big <= 3 && big < t.rank[m]
      ? `<span class="place">人口2万人以上の市区町村では${big === 1 ? "全国一" : `全国で ${big} 番目`}</span>` : "";
    const mark = notable.has(m) ? `<span class="mark">目立つ</span>` : "";
    return `<li class="${notable.has(m) ? "notable" : ""}"><span class="label">${label}${mark}</span><span class="value">${value}</span><span class="place">${place}</span>${bigNote}</li>`;
  });
  const s = stats.source;
  return `
    <p class="pop">人口 ${t.population.toLocaleString("ja-JP")}人</p>
    <p class="note">全国の市区町村と比べると（「目立つ」は全国の上下 20% に入る数字）</p>
    <ul class="features">${items.join("")}</ul>
    <p class="note">${t.ward ? "区の数字を、" : ""}全国の市区町村 ${stats.peers.toLocaleString("ja-JP")} と比べています。</p>
    <p class="cite">出典：${s.name}（${s.asOf}。増減は${s.changePeriod}）を加工</p>`;
}

function hideCard() {
  closeCard();
  if (selected) map.setFeatureState({ source: "munis", id: selected }, { selected: false });
  selected = null;
  updateCrumb();
}

function showMessage(text) {
  const box = document.createElement("div");
  box.className = "map-message";
  box.textContent = text;
  document.querySelector("main").append(box);
  setTimeout(() => box.remove(), 4000);
}

// 数字で並べて探す：範囲（全国・県の中・市・区の中の町）と項目と順を選び、一覧と地図の色で見せる
const shortName = (n) => n.replace(/^.+?郡(?=.+[町村]$)/, ""); // 「幡多郡黒潮町」→「黒潮町」（「大和郡山市」はそのまま）
const MUNI_METRICS = {
  population: { label: "人口", unit: "人", int: true },
  ...METRICS,
  over75Rate: { label: "75歳以上の人の割合", unit: "%" },
  under5Rate: { label: "0〜4歳の子どもの割合", unit: "%" },
  perHousehold: { label: "1世帯あたりの人数", unit: "人", digits: 2 },
  abroadPer1000: { label: "国外からの転入（1年、人口1,000人あたり）", unit: "人", digits: 2 },
  naturalChangeRate: { label: "生まれた人と亡くなった人の差（1年）", unit: "%", signed: true },
  singleRate: { label: "一人暮らしの世帯の割合", unit: "%", src: "census" },
  elderlySingleRate: { label: "65歳以上の一人暮らしの世帯の割合", unit: "%", src: "census" },
  ownedRate: { label: "持ち家の世帯の割合", unit: "%", src: "census" },
  apartmentRate: { label: "共同住宅（マンション・アパート）の世帯の割合", unit: "%", src: "census" },
  accPer1000: { label: "人身事故（1年、人口1,000人あたり。警察庁）", unit: "件", digits: 2, ext: true },
  accOldPedShare: { label: "歩行者の事故のうち65歳以上の歩行者の割合（警察庁）", unit: "%", ext: true },
  pop2050: { label: "2050年の人口（2020年を100としたとき。社人研）", unit: "", ext: true },
  old2050: { label: "2050年の65歳以上の割合（社人研）", unit: "%", ext: true },
};
const TOWN_METRICS = {
  population: { label: "人口", unit: "人", int: true },
  households: { label: "世帯", unit: "世帯", int: true },
  over65Rate: { label: "65歳以上の人の割合", unit: "%" },
  over75Rate: { label: "75歳以上の人の割合", unit: "%" },
  under15Rate: { label: "15歳未満の子どもの割合", unit: "%" },
  foreignRate: { label: "外国の住民の割合", unit: "%" },
  singleRate: { label: "一人暮らしの世帯の割合", unit: "%" },
  elderlySingleRate: { label: "65歳以上の一人暮らしの世帯の割合", unit: "%" },
  ownedRate: { label: "持ち家の世帯の割合", unit: "%" },
  apartmentRate: { label: "共同住宅（マンション・アパート）の世帯の割合", unit: "%" },
};
const rankState = { scope: "all", metric: "over65Rate", order: "desc" };
let rankOn = false;
let colorBy = null; // 地図の色分け { source, low, high }
const rankEl = document.getElementById("rank");
const scopeSel = document.getElementById("rank-scope");
const metricSel = document.getElementById("rank-metric");

function fillScopes() {
  const prefs = [...new Set(Object.values(stats.towns).map((t) => t.pref))];
  const here = shownTowns ?? selected; // いま選んでいる市区町村（その中の町で並べられる）
  scopeSel.innerHTML = `
    <option value="all">全国の市区町村（${stats.peers.toLocaleString("ja-JP")}）</option>
    <optgroup label="県の中の市区町村">${prefs.map((p) => `<option value="pref:${p}">${p}</option>`).join("")}</optgroup>
    ${here && townIndex.codes.includes(here) ? `<optgroup label="中の町（町・字）"><option value="towns:${here}">${byCode.get(here)?.properties.fullName}の中の町</option></optgroup>` : ""}`;
  if (rankState.scope.startsWith("towns:") && rankState.scope !== `towns:${here}`) rankState.scope = "all";
  scopeSel.value = rankState.scope;
}
function fillMetrics() {
  const towns = rankState.scope.startsWith("towns:");
  document.getElementById("rank-filters").disabled = towns;
  const list = towns ? TOWN_METRICS : MUNI_METRICS;
  if (!list[rankState.metric]) rankState.metric = Object.keys(list)[0];
  metricSel.innerHTML = Object.entries(list).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  metricSel.value = rankState.metric;
}

async function rankRows() {
  const { scope, metric } = rankState;
  if (scope.startsWith("towns:")) {
    const code = scope.slice(6);
    if (shownTowns !== code) await showTowns(code, { list: false });
    const m = byCode.get(code)?.properties.fullName ?? "";
    return townData.features.map((f) => ({
      key: f.properties.town, name: f.properties.name, sub: m, value: f.properties[metric],
      go: () => selectTown(code, f.properties.part),
    }));
  }
  if (shownTowns) hideTowns({ quiet: true });
  const pref = scope.startsWith("pref:") ? scope.slice(5) : null;
  const want = [...document.querySelectorAll("#rank-filters input:checked")].map((i) => i.value);
  const pass = (code, t) => {
    const f = flagsOf(code, t);
    // 人口2万人以上：大泉町の外国の住民の割合が「人口2万人以上で全国一」なのを、並べて確かめられるように
    return want.every((w) => (w === "pop20k" ? t.population >= 20000 : w === "specialSnow" ? f.snow === "特別豪雪地帯" : !!f[w]));
  };
  return Object.entries(stats.towns)
    .filter(([code, t]) => !t.ward && (!pref || t.pref === pref) && pass(code, t))
    .map(([code, t]) => ({
      key: code, name: shortName(t.name), sub: t.pref, value: t[metric] ?? summary.towns[code]?.[metric],
      go: () => (byCode.has(code) ? selectMuni(code) : showCityCard(t.name, t.pref)),
      wards: byCode.has(code) ? null : munis.features.filter((f) => f.properties.pref === t.pref && f.properties.city === t.name && f.properties.ward),
    }));
}

const fmt = (v, def) => (def.int ? Math.round(v).toLocaleString("ja-JP") : `${def.signed && v > 0 ? "+" : ""}${v.toFixed(def.digits ?? 1)}`) + def.unit;

async function renderRank() {
  const towns = rankState.scope.startsWith("towns:");
  const def = (towns ? TOWN_METRICS : MUNI_METRICS)[rankState.metric];
  const rows = (await rankRows()).filter((r) => typeof r.value === "number");
  rows.sort((a, b) => (rankState.order === "desc" ? b.value - a.value : a.value - b.value));
  const list = document.getElementById("rank-list");
  const shown = rows.slice(0, 50);
  list.innerHTML = shown.map((r, i) =>
    `<li><button type="button" data-i="${i}"><span class="nm">${r.name}<small>${r.sub}</small></span><span class="val">${fmt(r.value, def)}</span></button></li>`,
  ).join("") + (rows.length > shown.length ? `<li class="more"><p class="cite">ほか ${rows.length - shown.length}。地図の色でも見られます</p></li>` : "");
  list.querySelectorAll("button[data-i]").forEach((b) => b.addEventListener("click", () => shown[Number(b.dataset.i)].go()));

  // 地図の色分け（はずれ値に引っぱられないよう、下から5%〜上から5%の幅で塗る）
  const vals = rows.map((r) => r.value).sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor((vals.length - 1) * p))];
  const source = towns ? "towns" : "munis";
  map.removeFeatureState({ source: "munis" });
  if (map.getSource("towns")) map.removeFeatureState({ source: "towns" });
  for (const r of rows) {
    if (r.wards) for (const w of r.wards) map.setFeatureState({ source, id: w.properties.code }, { v: r.value });
    else map.setFeatureState({ source, id: r.key }, { v: r.value });
  }
  colorBy = { source, low: q(0.05), high: q(0.95) };
  if (colorBy.low === colorBy.high) colorBy.high = colorBy.low + 1;
  paint();
  paintTowns();
  document.getElementById("rank-legend").innerHTML =
    `<span>${fmt(colorBy.low, def)}</span><span class="bar" style="background:linear-gradient(to right, ${color("--land")}, ${color("--accent")})"></span><span>${fmt(colorBy.high, def)}</span>`;
  // 絞ったときは、いくつ残ったかと、絞りの出典も添える（例：南海トラフの特別強化地域 139市町村）
  const want = towns ? [] : [...document.querySelectorAll("#rank-filters input:checked")].map((i) => (i.value === "specialSnow" ? "snow" : i.value));
  const filterSrc = [...new Set(want)].map((w) => flagData.sources[w]).filter(Boolean);
  document.getElementById("rank-cite").textContent = (want.length ? `絞った市区町村 ${rows.length}。` : "") + (towns
    ? `出典：${townIndex.source}（${townIndex.asOf}）`
    : def.src === "census"
      ? `出典：${stats.census.name}（${stats.census.asOf}）を加工。政令市は区を足して計算`
      : `出典：${stats.source.name}（${stats.source.asOf}。増減・転入は${stats.source.changePeriod}）を加工`)
    + (filterSrc.length ? `。絞り：${filterSrc.join("・")}` : "");
  if (!towns) {
    const pref = rankState.scope.startsWith("pref:") ? rankState.scope.slice(5) : null;
    if (pref) fit(munis.features.filter((f) => f.properties.pref === pref), 10);
  }
}

function showRankPanel() {
  document.getElementById("guide").hidden = true;
  document.getElementById("card").hidden = true;
  rankEl.hidden = false;
  rankOn = true;
}
async function openRank() {
  if (shownTowns) rankState.scope = `towns:${shownTowns}`;
  fillScopes();
  fillMetrics();
  showRankPanel();
  document.querySelector(".panel-body").scrollTop = 0;
  await renderRank();
}
function closeRank() {
  rankOn = false;
  colorBy = null;
  rankEl.hidden = true;
  map.removeFeatureState({ source: "munis" });
  if (map.getSource("towns")) map.removeFeatureState({ source: "towns" });
  selected = null;
  selectedTown = null;
  paint();
  paintTowns();
  closeCard();
}
document.getElementById("open-rank").addEventListener("click", openRank);
rankEl.querySelector(".close").addEventListener("click", closeRank);
scopeSel.addEventListener("change", () => { rankState.scope = scopeSel.value; fillMetrics(); renderRank(); });
metricSel.addEventListener("change", () => { rankState.metric = metricSel.value; renderRank(); });
document.getElementById("rank-filters").addEventListener("change", renderRank);
for (const b of rankEl.querySelectorAll(".order button")) {
  b.addEventListener("click", () => {
    rankState.order = b.dataset.order;
    rankEl.querySelectorAll(".order button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderRank();
  });
}

// はじめの説明の「たとえば」
for (const b of document.querySelectorAll(".examples button")) {
  b.addEventListener("click", () => {
    if (b.dataset.muni) return selectMuni(b.dataset.muni);
    const [code, part] = b.dataset.town.split(":");
    selectTown(code, part);
  });
}

// 名前で探す：市区町村・政令市・用意した中の町（町・字）。前から合うものを先に
const searchBox = document.getElementById("search");
const results = document.getElementById("results");
const normalize = (s) => s.replace(/\s/g, "").replace(/[ヶヵ]/g, "ケ");
function candidates() {
  const list = [];
  const cities = new Set();
  for (const f of munis?.features ?? []) {
    const p = f.properties;
    if (p.noData && !p.city) continue;
    list.push({ name: p.fullName, sub: [p.pref, p.county].filter(Boolean).join(" "), go: () => selectMuni(p.code) });
    if (p.ward && !cities.has(p.pref + p.city)) {
      cities.add(p.pref + p.city);
      list.push({ name: p.city, sub: `${p.pref}（区を選ぶ）`, go: () => showCityCard(p.city, p.pref) });
    }
  }
  for (const a of areas) {
    const m = byCode.get(a.muni)?.properties;
    list.push({ name: a.name, sub: m ? `${m.pref} ${m.fullName}のまとまり（${a.parts.length}の町・字）` : "", go: () => openArea(a.id) });
  }
  for (const [code, part, name] of townNames ?? []) {
    const m = byCode.get(code)?.properties;
    list.push({ name, sub: m ? `${m.pref} ${m.fullName}の町・字` : "", go: () => selectTown(code, part) });
  }
  return list;
}
let found = [];
let active = -1;
// 全国の町・字の名前は大きいので、探す欄を初めて使ったときに読む
let townNames = null;
let cands = null;
let loadingNames = null;
function loadNames() {
  loadingNames ??= getJSON("data/towns/names.json").then((d) => {
    townNames = d;
    cands = null;
    // 読み終えたとき、まだ欄で入力しているときだけ候補を出し直す（町を選んだあとに開き直して、カードを隠していた）
    if (searchBox.value && document.activeElement === searchBox) search();
  });
}
function search() {
  if (!munis) return; // 地図の形を読み込む前は探さない
  loadNames();
  const q = normalize(searchBox.value);
  active = -1;
  if (!q) return closeResults();
  // 候補は一度だけ作り、名前を整えたものも持っておく（全国の町・字で 10万ほどになるため）
  cands ??= candidates().map((c) => ({ ...c, n: normalize(c.name), s: normalize(c.sub) }));
  found = cands
    .map((c) => ({ c, at: c.n.indexOf(q), also: c.s.includes(q) }))
    .filter((x) => x.at >= 0 || x.also)
    .sort((a, b) => (a.at < 0) - (b.at < 0) || (a.at !== 0) - (b.at !== 0) || a.c.name.length - b.c.name.length)
    .slice(0, 8)
    .map((x) => x.c);
  results.innerHTML = found.length
    ? found.map((c, i) => `<li role="option" id="r${i}"><button type="button" data-i="${i}"><span class="name">${c.name}</span><span class="sub">${c.sub}</span></button></li>`).join("")
    : `<li class="none">見つかりません。市区町村の名前か、町・字の名前で探せます</li>`;
  results.hidden = false;
  searchBox.setAttribute("aria-expanded", "true");
}
function choose(i) {
  const c = found[i];
  if (!c) return;
  searchBox.value = c.name;
  closeResults();
  searchBox.blur();
  c.go();
}
function closeResults() {
  results.hidden = true;
  searchBox.setAttribute("aria-expanded", "false");
}
searchBox.addEventListener("input", search);
searchBox.addEventListener("focus", () => searchBox.value && search());
searchBox.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + found.length) % found.length;
    results.querySelectorAll("button").forEach((b, i) => b.classList.toggle("active", i === active));
  } else if (e.key === "Enter") {
    choose(active >= 0 ? active : 0);
  } else if (e.key === "Escape") {
    closeResults();
    e.stopPropagation();
  }
});
results.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-i]");
  if (b) choose(Number(b.dataset.i));
});
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest(".search")) closeResults();
});

// 灯りと数える欄：site/data/progress.json（承認の台帳から書き出す）。手元の画面では、いま調べている町を点滅させ、
// 調べ終わった町が1つずつ灯っていくのを見せる
let progress = null;
async function lightTowns() {
  progress = await fetch("data/progress.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (progress) {
    for (const [code, t] of Object.entries(progress.towns)) map.setFeatureState({ source: "munis", id: code }, { lit: Math.min(1, 0.35 + t.answers / 15) });
  }
  updatePoints();
  // 数える欄（調べた町・答え・読んだページ・費用・スキル）は作る側のもの。住民が見る公開のサイトには出さず、手元の画面だけに出す
  if (!lightTowns.polling && (await fetch("api/ping").then((r) => r.ok).catch(() => false))) {
    lightTowns.local = true;
    lightTowns.polling = true;
    pollRuns();
  }
  if (lightTowns.local) { showCounter(); showBuilderBox(); }
}
// 作る側の帯（左メニューの検索のすぐ下。手元の画面だけ）：確かめ待ちと判断待ちの提案の数と、確かめる一覧への入口
// （作者「確かめ待ちのような大事な情報がどこかに表示されていると分かりやすい」「『確かめる一覧を見る』が左メニューの一番下にあるのが不自然」）
async function showBuilderBox() {
  const box = document.getElementById("builder-box");
  const [rev, prop] = await Promise.all([
    fetch("api/review").then((r) => r.json()).catch(() => null),
    fetch("api/proposals").then((r) => r.json()).catch(() => null),
  ]);
  if (!rev) return;
  const pending = rev.items.filter((x) => x.status === "pending").length;
  const props = prop?.proposals ?? [];
  const towns = [...new Set(props.map((p) => p.scope.match(/(\d{5})/)?.[1]).filter(Boolean))];
  box.hidden = false;
  box.classList.toggle("has", pending + props.length > 0);
  box.innerHTML = `<p class="bb-title">${icon("eye")}作る側（この PC の画面だけ）</p>
    ${pending + props.length
      ? `<p class="bb-nums"><span><strong>${pending}</strong>件 確かめ待ち</span>${props.length ? `<span><strong>${props.length}</strong>件 判断待ちの提案</span>` : ""}</p>`
      : `<p class="bb-none">確かめ待ちと判断待ちの提案はありません</p>`}
    <a class="secondary as-button" href="review.html">確かめる一覧を開く</a>
    ${towns.map((c) => `<a class="secondary as-button" href="research.html?muni=${c}">提案を見る：${String(stats?.towns?.[c]?.name ?? c).replace(/[&<>"]/g, "")}</a>`).join("")}`;
}

function showCounter(running = []) {
  const t = progress?.totals;
  if (!t) return;
  const box = document.getElementById("counter");
  box.hidden = false;
  // カウンターの帯に地図の見方も出るので、地図の見方の札は隠す
  document.getElementById("map-key").hidden = true;
  box.innerHTML = `
    <span><strong>${t.towns}</strong>町を Claude が調べた</span>
    ${t.questions ? `<span><strong>${t.questions}</strong>問の物差し</span>` : ""}
    <span><strong>${t.answers}</strong>の答え</span>
    <span><strong>${t.pages.toLocaleString("ja-JP")}</strong>ページを読んだ</span>
    <span><strong>$${t.usd.toFixed(2)}</strong>使った</span>
    <span><strong>${t.skills}</strong>の調べ方のスキル（OK したもの）</span>
    ${running.length ? `<span class="now">いま ${running.length}町を調べています</span>` : ""}
    <span class="key"><i class="lit"></i>調べた町（濃いほど答えが多い）<i class="base"></i>国のデータだけの町</span>`;
}
// 中の町（町・字）の灯り：progress.json の parts（"11227-0130": 答えの数）
function lightParts(code) {
  for (const [k, n] of Object.entries(progress?.parts ?? {})) {
    if (k.startsWith(`${code}-`)) map.setFeatureState({ source: "towns", id: k.replace("-", "") }, { lit: Math.min(0.75, 0.35 + n / 10) });
  }
}
// 光る丸：調べた町と、いま調べている町の位置（市区町村の名前の位置）
let labelPoints = null;
async function updatePoints() {
  labelPoints ??= (await getJSON("data/labels.json")).features;
  const lit = new Set(Object.keys(progress?.towns ?? {}));
  const features = labelPoints.filter((f) => f.geometry && (lit.has(f.properties.code) || runningCodes.has(f.properties.code)))
    .map((f, i) => ({ ...f, id: i, properties: { code: f.properties.code, running: runningCodes.has(f.properties.code) } }));
  map.getSource("lit-points")?.setData({ type: "FeatureCollection", features });
  pointIds = new Map(features.map((f) => [f.properties.code, f.id]));
}
let pointIds = new Map();

// 手元の画面：いま調べている町を点滅させる。終わったら、その町の灯りを点け直す
let runningCodes = new Set();
async function pollRuns() {
  const r = await fetch("api/runs").then((x) => x.json()).catch(() => ({ running: [] }));
  const now = new Set(r.running.map((x) => x.code));
  for (const c of runningCodes) if (!now.has(c)) map.setFeatureState({ source: "munis", id: c }, { running: false });
  for (const c of now) map.setFeatureState({ source: "munis", id: c }, { running: true });
  const finished = [...runningCodes].some((c) => !now.has(c));
  const started = [...now].some((c) => !runningCodes.has(c));
  runningCodes = now;
  if (started) await updatePoints();
  if (finished) await lightTowns();
  else showCounter(r.running);
  setTimeout(pollRuns, 3000);
}
// 点滅（調べている町の濃さを、ゆっくり行き来させる）
setInterval(() => {
  if (!runningCodes.size) return;
  const v = 0.15 + 0.6 * (0.5 + 0.5 * Math.sin(Date.now() / 300));
  for (const c of runningCodes) {
    map.setFeatureState({ source: "munis", id: c }, { blink: v });
    if (pointIds.has(c)) map.setFeatureState({ source: "lit-points", id: pointIds.get(c) }, { blink: v });
  }
}, 100);

// 左のパネルの「はじめかた」の印と、「たとえば」のイラスト（site/icons.js）
for (const el of document.querySelectorAll(".step-ic[data-ic]")) el.innerHTML = icon(el.dataset.ic);
for (const b of document.querySelectorAll(".examples button[data-il]")) b.insertAdjacentHTML("afterbegin", illust(b.dataset.il));

// 録画用の「灯りの波」（?wave で開く。W のキーでもう一度）。全国の市区町村を、九州から北へ波が進むように次々と灯す
// （作者「波は九州から北へ広げて」。前の演出の飛行〈沖縄から北海道へ〉と向きをそろえる）。
// 塗るのは本物のデータ：どの町も国の統計（住民基本台帳）で特色のカードができている。最後に、Claude が深く調べた町だけが濃く光る
// （作者「日本地図の町がどんどん塗りつぶされていく……ここでわくわく感を演出してみたい」。作り物の数字は出さない）
async function playWave() {
  while (!map.getSource("labels") || !stats || !progress) await new Promise((r) => setTimeout(r, 200));
  const labels = (await getJSON("data/labels.json")).features;
  // 九州の南（鹿児島）から札幌へ向かう線の上で、どこまで進んだ所かの順に灯す。九州より南の島（沖縄・奄美）は最初に一緒に灯る
  const from = [130.55, 31.4], to = [141.35, 43.06];
  const kx = Math.cos((37 * Math.PI) / 180);
  const ax = (to[0] - from[0]) * kx, ay = to[1] - from[1], alen = Math.hypot(ax, ay);
  const order = labels
    .filter((f) => byCode.has(f.properties.code) && !byCode.get(f.properties.code).properties.noData)
    .map((f) => { const [x, y] = f.geometry.coordinates; return { code: f.properties.code, d: Math.max(0, ((x - from[0]) * kx * ax + (y - from[1]) * ay) / alen) }; })
    .sort((a, b) => a.d - b.d);
  const total = Object.values(stats.towns).filter((t) => !t.ward).length; // 1,741
  if (!map.getLayer("muni-wave")) map.addLayer({ id: "muni-wave", type: "fill", source: "munis", paint: { "fill-color": color("--accent"), "fill-opacity": ["coalesce", ["feature-state", "wave"], 0] } }, "muni-lit");
  for (const id of ["muni-lit", "muni-lit-line", "lit-glow", "lit-dot"]) map.setLayoutProperty(id, "visibility", "none");
  for (const o of order) map.setFeatureState({ source: "munis", id: o.code }, { wave: 0 });
  let box = document.getElementById("wave-count");
  if (!box) { document.body.insertAdjacentHTML("beforeend", `<div id="wave-count" class="wave-count"></div>`); box = document.getElementById("wave-count"); }
  const SPREAD = 7000; // 全国に広がるまで
  const FADE = 900; // 灯ってから落ち着くまで
  const maxD = order.at(-1).d;
  const t0 = performance.now();
  const lastSet = new Map();
  await new Promise((done) => {
    const step = (now) => {
      const t = now - t0;
      let shown = 0;
      for (const o of order) {
        const at = (o.d / maxD) * SPREAD;
        if (t < at) break;
        shown++;
        const k = Math.min(1, (t - at) / FADE);
        const v = Math.round((0.95 - 0.5 * k) * 100) / 100; // 明るく灯って、半分ほどの濃さで残る（日本が塗りつぶされていく）
        if (lastSet.get(o.code) !== v) { map.setFeatureState({ source: "munis", id: o.code }, { wave: v }); lastSet.set(o.code, v); }
      }
      box.innerHTML = `<strong>${Math.round((total * shown) / order.length).toLocaleString("ja-JP")}</strong> / ${total.toLocaleString("ja-JP")} の市区町村を、国の統計で比べました<small>住民基本台帳（令和8年1月1日）</small>`;
      if (t < SPREAD + FADE) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  // 最後に、波の色を薄くしていき、深く調べた町が浮かび上がる
  for (const id of ["muni-lit", "muni-lit-line", "lit-glow", "lit-dot"]) map.setLayoutProperty(id, "visibility", "visible");
  await new Promise((done) => {
    const t1 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t1) / 1200);
      for (const o of order) map.setFeatureState({ source: "munis", id: o.code }, { wave: Math.round((0.45 - 0.33 * k) * 100) / 100 });
      if (k < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  box.innerHTML = `<strong>${progress.totals.towns}</strong> の町を、Claude が深く調べました<small>${total.toLocaleString("ja-JP")} の市区町村は、国の統計で比べてあります</small>`;
}
if (new URLSearchParams(location.search).has("wave")) {
  map.on("load", () => setTimeout(playWave, 1500));
  addEventListener("keydown", (e) => { if (e.key === "w" || e.key === "W") playWave(); });
}

// 地図の下の出典の文（.source）を、カウンターの帯と地図の見方の札で隠さない：出典の文の高さを測り、その上に置く
// （スマホでは出典の文が2行に折れて、札に隠れていた。出典はいつも見えるようにする決まり）
function placeAboveSource() {
  const src = document.querySelector("main .source");
  if (!src) return;
  document.documentElement.style.setProperty("--source-top", `${src.offsetHeight + 12}px`);
}
placeAboveSource();
addEventListener("resize", placeAboveSource);
