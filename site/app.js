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

let stats = null; // 住民基本台帳の数字（site/data/stats.json）
fetch("data/stats.json").then((r) => r.json()).then((d) => (stats = d));
let townIndex = { codes: [], names: [] }; // 中の町（町・字）の形を用意した市・区と、町・字の名前
fetch("data/towns/index.json").then((r) => r.json()).then((d) => (townIndex = d));
let munis = null; // 市区町村の形（GeoJSON）
const byCode = new Map(); // 市区町村コード → 形
let shownTowns = null; // いま中の町を出している市・区のコード
let townData = null; // いま出している中の町の形

map.on("load", async () => {
  const [topo, labels, prefLabels] = await Promise.all([
    fetch("data/japan.topo.json").then((r) => r.json()),
    fetch("data/labels.json").then((r) => r.json()),
    fetch("data/pref-labels.json").then((r) => r.json()),
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

  // 拡大したときだけ、道路や線路の見える背景（国土地理院の淡色地図）を出す
  map.addSource("gsi-pale", {
    type: "raster",
    tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
    tileSize: 256,
    minzoom: 5,
    maxzoom: 18,
  });
  map.addLayer({ id: "gsi-pale", type: "raster", source: "gsi-pale", minzoom: 7, layout: { visibility: basemapOn ? "visible" : "none" } });
  map.addSource("munis", { type: "geojson", data: munis, promoteId: "code" });
  map.addSource("prefs", { type: "geojson", data: prefLines });
  map.addSource("labels", { type: "geojson", data: { type: "FeatureCollection", features: labels.features.filter((f) => f.geometry) } });
  map.addLayer({ id: "muni-fill", type: "fill", source: "munis" });
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
    if (town) return showTownCard(town.properties);
    const muni = map.queryRenderedFeatures(e.point, { layers: ["muni-fill"] })[0];
    if (muni) showCard(muni.properties);
  });
});

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
  townData = await (await fetch(`data/towns/${code}.json`)).json();
  if (map.getSource("towns")) map.getSource("towns").setData(townData);
  else {
    map.addSource("towns", { type: "geojson", data: townData, promoteId: "town" });
    map.addLayer({ id: "town-fill", type: "fill", source: "towns" }, "pref-line");
    map.addLayer({ id: "town-casing", type: "line", source: "towns" }, "pref-line");
    map.addLayer({ id: "town-line", type: "line", source: "towns" }, "pref-line");
    map.addLayer({
      id: "town-label", type: "symbol", source: "towns", minzoom: 11,
      layout: { "text-field": ["get", "name"], "text-font": ["NotoSansCJKjp-Regular"], "text-size": 13, "text-padding": 2 },
    });
  }
  for (const id of TOWN_LAYERS) map.setLayoutProperty(id, "visibility", "visible");
  map.setLayoutProperty("muni-label", "visibility", "none");
  shownTowns = code;
  paintTowns();
  const crumb = document.getElementById("crumb");
  crumb.querySelector(".here").textContent = `${byCode.get(code)?.properties.fullName ?? ""}の中の町`;
  crumb.hidden = false;
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
  shownTowns = null;
  document.getElementById("crumb").hidden = true;
  if (quiet) return;
  const f = byCode.get(code);
  if (f) showCard(f.properties);
  map.easeTo({ zoom: Math.max(map.getZoom() - 1.5, 6), duration: 500 });
}
document.querySelector("#crumb .back").addEventListener("click", hideTowns);
addEventListener("keydown", (e) => e.key === "Escape" && hideTowns());

const TOWN_LAYERS = ["town-fill", "town-casing", "town-line", "town-label"];
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
  if (!map.getLayer("gsi-pale")) return;
  map.setLayoutProperty("gsi-pale", "visibility", basemapOn ? "visible" : "none");
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
  map.setPaintProperty("gsi-pale", "raster-brightness-max", dark ? 0.4 : 1);
  map.setPaintProperty("gsi-pale", "raster-saturation", dark ? -0.6 : 0);
  map.setPaintProperty("gsi-pale", "raster-opacity", ["interpolate", ["linear"], ["zoom"], 7, 0, 8.5, 1]);
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

  const card = document.getElementById("card");
  const where = [p.pref, p.county].filter(Boolean).join(" ");
  const town = stats?.towns[p.code];
  const body = p.noData || !town ? "<p>この地域には国の統計がありません。</p>" : featureCard(town);
  // 市・区は広いので、中の町（町・字）まで下りられるようにする
  const isCityOrWard = /[市区]$/.test(p.fullName);
  const hasTowns = townIndex.codes.includes(p.code);
  const towns = !isCityOrWard ? ""
    : hasTowns ? `<button type="button" class="primary towns">中の町を選ぶ</button>`
    : `<p class="note">中の町（町・字）の形は、まだ用意していません。</p>`;
  card.innerHTML = `
    <button type="button" class="close" aria-label="閉じる">×</button>
    <h2>${p.fullName}</h2>
    <p class="where">${where}・市区町村コード ${p.code}</p>
    ${towns}
    ${body}`;
  card.querySelector(".close").addEventListener("click", hideCard);
  card.querySelector(".towns")?.addEventListener("click", () => {
    map.setFeatureState({ source: "munis", id: p.code }, { selected: false });
    showTowns(p.code);
  });
  openCard();
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
  const muni = byCode.get(shownTowns)?.properties;
  const card = document.getElementById("card");
  const towns = [...townData.features].sort((a, b) => a.properties.part.localeCompare(b.properties.part));
  card.innerHTML = `
    <button type="button" class="close" aria-label="閉じる">×</button>
    <h2>${muni?.fullName ?? ""}の中の町</h2>
    <p class="where">地図で町を押すか、下から選んでください（${towns.length}の町・字）</p>
    <ul class="town-list">${towns.map((f) => `<li><button type="button" data-part="${f.properties.part}"><span class="n">${f.properties.name}</span><span class="p">${f.properties.population ? `${f.properties.population.toLocaleString("ja-JP")}人` : "人が住んでいない"}</span></button></li>`).join("")}</ul>
    <p class="cite">人口：${townIndex.source}（${townIndex.asOf}）</p>`;
  card.querySelector(".close").addEventListener("click", hideTowns);
  for (const b of card.querySelectorAll(".town-list button")) b.addEventListener("click", () => selectTown(shownTowns, b.dataset.part));
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
  map.setFeatureState({ source: "towns", id: selectedTown }, { selected: true });
  const muni = byCode.get(shownTowns)?.properties;
  const card = document.getElementById("card");
  const ages = p.over65Rate != null
    ? `<ul class="features">${["over65Rate", "over75Rate", "under15Rate"].map((m) =>
        `<li><span class="label">${TOWN_METRICS[m].label}</span><span class="value">${p[m].toFixed(1)}%</span><span class="place">${townPlace(p, m)}</span></li>`).join("")}</ul>`
    : p.ageHidden ? `<p class="note">年齢の数字は、住む人が少ないため国勢調査で隠されています。</p>` : "";
  const people = p.population
    ? `<p class="pop">人口 ${p.population.toLocaleString("ja-JP")}人・${p.households.toLocaleString("ja-JP")}世帯</p>${ages}`
    : `<p class="pop">人の住んでいない町・字です</p>`;
  card.innerHTML = `
    <button type="button" class="close" aria-label="閉じる">×</button>
    <h2>${p.name}</h2>
    <p class="where">${muni ? `${muni.pref} ${muni.fullName}` : ""}・町・字の番号 ${p.part}</p>
    ${people}
    <p>この町は、まだ深く調べていません。</p>
    <p class="cite">出典：${townIndex.source}（${townIndex.asOf}）</p>`;
  // 閉じると、中の町の一覧に戻る
  card.querySelector(".close").addEventListener("click", () => {
    map.setFeatureState({ source: "towns", id: selectedTown }, { selected: false });
    selectedTown = null;
    showTownList();
  });
  openCard();
}

// 町・字の数字が、同じ市・区の中で高いほうから何番目か
function townPlace(p, m) {
  const vals = townData.features.map((f) => f.properties[m]).filter((v) => typeof v === "number");
  const rank = vals.filter((v) => v > p[m]).length + 1;
  const muni = byCode.get(shownTowns)?.properties.fullName ?? "";
  return `${muni}の ${vals.length} の町・字で高いほうから ${rank} 番目`;
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
      t.rank[m] <= 10 ? `全国で ${t.rank[m]} 番目に高い`
      : top <= 50 ? `全国で高いほうから ${Math.max(top, 0.1).toFixed(1)}%`
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
const MUNI_METRICS = { population: { label: "人口", unit: "人", int: true }, ...METRICS };
const TOWN_METRICS = {
  population: { label: "人口", unit: "人", int: true },
  households: { label: "世帯", unit: "世帯", int: true },
  over65Rate: { label: "65歳以上の人の割合", unit: "%" },
  over75Rate: { label: "75歳以上の人の割合", unit: "%" },
  under15Rate: { label: "15歳未満の子どもの割合", unit: "%" },
};
const rankState = { scope: "all", metric: "over65Rate", order: "desc" };
let rankOn = false;
let colorBy = null; // 地図の色分け { source, low, high }
const rankEl = document.getElementById("rank");
const scopeSel = document.getElementById("rank-scope");
const metricSel = document.getElementById("rank-metric");

function fillScopes() {
  const prefs = [...new Set(Object.values(stats.towns).map((t) => t.pref))];
  scopeSel.innerHTML = `
    <option value="all">全国の市区町村（${stats.peers.toLocaleString("ja-JP")}）</option>
    <optgroup label="県の中の市区町村">${prefs.map((p) => `<option value="pref:${p}">${p}</option>`).join("")}</optgroup>
    <optgroup label="市・区の中の町（町・字）">${townIndex.codes.map((c) => `<option value="towns:${c}">${byCode.get(c)?.properties.fullName ?? c}の中の町</option>`).join("")}</optgroup>`;
  scopeSel.value = rankState.scope;
}
function fillMetrics() {
  const list = rankState.scope.startsWith("towns:") ? TOWN_METRICS : MUNI_METRICS;
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
  return Object.entries(stats.towns)
    .filter(([, t]) => !t.ward && (!pref || t.pref === pref))
    .map(([code, t]) => ({
      key: code, name: shortName(t.name), sub: t.pref, value: t[metric],
      go: () => (byCode.has(code) ? selectMuni(code) : showCityCard(t.name, t.pref)),
      wards: byCode.has(code) ? null : munis.features.filter((f) => f.properties.pref === t.pref && f.properties.city === t.name && f.properties.ward),
    }));
}

const fmt = (v, def) => (def.int ? Math.round(v).toLocaleString("ja-JP") : `${def.signed && v > 0 ? "+" : ""}${v.toFixed(1)}`) + def.unit;

async function renderRank() {
  const towns = rankState.scope.startsWith("towns:");
  const def = (towns ? TOWN_METRICS : MUNI_METRICS)[rankState.metric];
  const rows = (await rankRows()).filter((r) => typeof r.value === "number");
  rows.sort((a, b) => (rankState.order === "desc" ? b.value - a.value : a.value - b.value));
  const list = document.getElementById("rank-list");
  const shown = rows.slice(0, 50);
  list.innerHTML = shown.map((r, i) =>
    `<li><button type="button" data-i="${i}"><span class="no">${i + 1}</span><span class="nm">${r.name}<small>${r.sub}</small></span><span class="val">${fmt(r.value, def)}</span></button></li>`,
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
  document.getElementById("rank-cite").textContent = towns
    ? `出典：${townIndex.source}（${townIndex.asOf}）`
    : `出典：${stats.source.name}（${stats.source.asOf}。増減は${stats.source.changePeriod}）を加工`;
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
  for (const [code, part, name] of townIndex.names) {
    const m = byCode.get(code)?.properties;
    list.push({ name, sub: m ? `${m.pref} ${m.fullName}の町・字` : "", go: () => selectTown(code, part) });
  }
  return list;
}
let found = [];
let active = -1;
function search() {
  const q = normalize(searchBox.value);
  active = -1;
  if (!q) return closeResults();
  found = candidates()
    .map((c) => ({ c, at: normalize(c.name).indexOf(q), also: normalize(c.sub).includes(q) }))
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
