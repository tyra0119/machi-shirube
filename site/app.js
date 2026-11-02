// 日本地図（トップ）。N03 の市区町村の形だけで描く（背景の地図の画像は使わない）。
// 色は style.css の役割の色を読んで使い、夜の画面に切り替わったら塗り直す。
const NO_DATA = (code) => /000$/.test(code) || (code >= "01695" && code <= "01700"); // 所属未定地・北方領土

const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    // 地図の上の名前：日本語の文字はブラウザの文字で描く（外から文字のデータを取らない）
    glyphs: "data/glyphs/{fontstack}/{range}.pbf",
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
    layout: { "text-field": ["get", "pref"], "text-font": ["sans"], "text-size": ["interpolate", ["linear"], ["zoom"], 4.5, 12, 7, 16] },
  });
  map.addLayer({
    id: "muni-label", type: "symbol", source: "labels", minzoom: 7, maxzoom: 10, // その先は背景の地図の地名に任せる
    layout: { "text-field": ["get", "label"], "text-font": ["sans"], "text-size": ["interpolate", ["linear"], ["zoom"], 7, 12, 10, 15], "text-padding": 4 },
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
async function showTowns(code) {
  townData = await (await fetch(`data/towns/${code}.json`)).json();
  if (map.getSource("towns")) map.getSource("towns").setData(townData);
  else {
    map.addSource("towns", { type: "geojson", data: townData, promoteId: "town" });
    map.addLayer({ id: "town-fill", type: "fill", source: "towns" }, "pref-line");
    map.addLayer({ id: "town-casing", type: "line", source: "towns" }, "pref-line");
    map.addLayer({ id: "town-line", type: "line", source: "towns" }, "pref-line");
    map.addLayer({
      id: "town-label", type: "symbol", source: "towns", minzoom: 11,
      layout: { "text-field": ["get", "name"], "text-font": ["sans"], "text-size": 13, "text-padding": 2 },
    });
  }
  for (const id of TOWN_LAYERS) map.setLayoutProperty(id, "visibility", "visible");
  map.setLayoutProperty("muni-label", "visibility", "none");
  shownTowns = code;
  paintTowns();
  const crumb = document.getElementById("crumb");
  crumb.querySelector(".here").textContent = `${byCode.get(code)?.properties.fullName ?? ""}の中の町`;
  crumb.hidden = false;
  document.querySelector("main").classList.add("has-crumb");
  fit(townData.features);
}
// 中の町をしまって、市区町村の地図に戻る（戻った市・区を選んだ状態にする）
function hideTowns() {
  if (!shownTowns) return;
  const code = shownTowns;
  for (const id of TOWN_LAYERS) map.setLayoutProperty(id, "visibility", "none");
  map.setLayoutProperty("muni-label", "visibility", "visible");
  if (selectedTown) map.setFeatureState({ source: "towns", id: selectedTown }, { selected: false });
  selectedTown = null;
  shownTowns = null;
  document.getElementById("crumb").hidden = true;
  document.querySelector("main").classList.remove("has-crumb");
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
  map.setPaintProperty("town-fill", "fill-color", ["case", isSelected, color("--accent"), color("--land")]);
  map.setPaintProperty("town-fill", "fill-opacity", basemapOn ? ["case", isSelected, 0.45, 0.15] : ["case", isSelected, 0.9, 1]);
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
    card.hidden = true;
  });
  card.hidden = false;
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
  card.querySelector(".close").addEventListener("click", () => (card.hidden = true));
  for (const b of card.querySelectorAll(".choices button")) b.addEventListener("click", () => selectMuni(b.dataset.code));
  card.hidden = false;
}

let selectedTown = null;
function showTownCard(p) {
  if (selectedTown) map.setFeatureState({ source: "towns", id: selectedTown }, { selected: false });
  selectedTown = p.town;
  map.setFeatureState({ source: "towns", id: selectedTown }, { selected: true });
  const muni = byCode.get(shownTowns)?.properties;
  const card = document.getElementById("card");
  const people = p.population
    ? `<p class="pop">人口 ${p.population.toLocaleString("ja-JP")}人・${p.households.toLocaleString("ja-JP")}世帯</p>`
    : `<p class="pop">人の住んでいない町・字です</p>`;
  card.innerHTML = `
    <button type="button" class="close" aria-label="閉じる">×</button>
    <h2>${p.name}</h2>
    <p class="where">${muni ? `${muni.pref} ${muni.fullName}` : ""}・町・字の番号 ${p.part}</p>
    ${people}
    <p>この町は、まだ深く調べていません。</p>
    <p class="cite">出典：${townIndex.source}（${townIndex.asOf}）</p>`;
  card.querySelector(".close").addEventListener("click", () => {
    card.hidden = true;
    map.setFeatureState({ source: "towns", id: selectedTown }, { selected: false });
    selectedTown = null;
  });
  card.hidden = false;
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

// 特色のカード：全国の市区町村と比べて目立つものを3つ（真ん中から遠い順）
const METRICS = {
  over65Rate: { label: "65歳以上の人の割合", unit: "%" },
  under15Rate: { label: "15歳未満の子どもの割合", unit: "%" },
  foreignRate: { label: "外国の住民の割合", unit: "%" },
  changeRate: { label: "1年の人口の増減", unit: "%", signed: true },
  socialChangeRate: { label: "引っ越しによる1年の増減", unit: "%", signed: true },
};
function featureCard(t) {
  const picks = Object.keys(METRICS)
    .map((m) => ({ m, edge: Math.min(t.top[m], 100 - t.top[m]) }))
    .sort((a, b) => a.edge - b.edge)
    .slice(0, 3);
  const items = picks.map(({ m }) => {
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
    return `<li><span class="label">${label}</span><span class="value">${value}</span><span class="place">${place}</span>${bigNote}</li>`;
  });
  const s = stats.source;
  return `
    <p class="pop">人口 ${t.population.toLocaleString("ja-JP")}人</p>
    <ul class="features">${items.join("")}</ul>
    <p class="note">${t.ward ? "区の数字を、" : ""}全国の市区町村 ${stats.peers.toLocaleString("ja-JP")} と比べています。</p>
    <p class="cite">出典：${s.name}（${s.asOf}。増減は${s.changePeriod}）を加工</p>`;
}

function hideCard() {
  document.getElementById("card").hidden = true;
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
