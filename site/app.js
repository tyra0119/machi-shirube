// 日本地図（トップ）。N03 の市区町村の形だけで描く（背景の地図の画像は使わない）。
// 色は style.css の役割の色を読んで使い、夜の画面に切り替わったら塗り直す。
const NO_DATA = (code) => /000$/.test(code) || (code >= "01695" && code <= "01700"); // 所属未定地・北方領土

const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const map = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [{ id: "sea", type: "background", paint: { "background-color": color("--sea") } }] },
  center: [137.5, 37.5],
  zoom: 4.3,
  minZoom: 3.5,
  maxZoom: 13,
  maxBounds: [[110, 15], [165, 50]],
  hash: "z",
  attributionControl: false,
});
map.addControl(new MapButtons({ onNoLocation: showMessage }), "bottom-right");

map.on("load", async () => {
  const topo = await (await fetch("data/japan.topo.json")).json();
  const munis = topojson.feature(topo, topo.objects.municipalities);
  for (const f of munis.features) f.properties.noData = NO_DATA(f.properties.code);
  const prefLines = topojson.mesh(topo, topo.objects.prefectures, (a, b) => a !== b);

  map.addSource("munis", { type: "geojson", data: munis, promoteId: "code" });
  map.addSource("prefs", { type: "geojson", data: prefLines });
  map.addLayer({ id: "muni-fill", type: "fill", source: "munis" });
  map.addLayer({ id: "muni-line", type: "line", source: "munis" });
  map.addLayer({ id: "pref-line", type: "line", source: "prefs" });
  paint();

  let hovered = null;
  map.on("mousemove", "muni-fill", (e) => {
    const code = e.features[0].properties.code;
    if (hovered === code) return;
    if (hovered) map.setFeatureState({ source: "munis", id: hovered }, { hover: false });
    hovered = code;
    map.setFeatureState({ source: "munis", id: code }, { hover: true });
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "muni-fill", () => {
    if (hovered) map.setFeatureState({ source: "munis", id: hovered }, { hover: false });
    hovered = null;
    map.getCanvas().style.cursor = "";
  });
  map.on("click", "muni-fill", (e) => showCard(e.features[0].properties));
});

function paint() {
  map.setPaintProperty("sea", "background-color", color("--sea"));
  map.setPaintProperty("muni-fill", "fill-color", [
    "case",
    ["get", "noData"], color("--no-data"),
    ["boolean", ["feature-state", "selected"], false], color("--accent"),
    ["boolean", ["feature-state", "hover"], false], color("--line"),
    color("--land"),
  ]);
  map.setPaintProperty("muni-line", "line-color", color("--line"));
  map.setPaintProperty("muni-line", "line-width", ["interpolate", ["linear"], ["zoom"], 4, 0.2, 9, 1]);
  map.setPaintProperty("pref-line", "line-color", color("--pref-line"));
  map.setPaintProperty("pref-line", "line-width", ["interpolate", ["linear"], ["zoom"], 4, 0.6, 9, 2]);
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => map.getLayer("muni-fill") && paint());

let selected = null;
function showCard(p) {
  if (selected) map.setFeatureState({ source: "munis", id: selected }, { selected: false });
  selected = p.code;
  map.setFeatureState({ source: "munis", id: selected }, { selected: true });

  const card = document.getElementById("card");
  const name = `${p.city}${p.ward}`;
  const where = [p.pref, p.county].filter(Boolean).join(" ");
  const body = p.noData
    ? "この地域には国の統計がありません。"
    : "この町のくわしいページは、まだありません。";
  card.innerHTML = `
    <button type="button" class="close" aria-label="閉じる">×</button>
    <h2>${name || p.pref}</h2>
    <p class="where">${where}・市区町村コード ${p.code}</p>
    <p>${body}</p>`;
  card.querySelector(".close").addEventListener("click", hideCard);
  card.hidden = false;
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
