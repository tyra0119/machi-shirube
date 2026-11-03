// 重ねて見る地図：避難場所・病院（いまやっている所だけにも）・津波／洪水／土砂の想定・雨雲・キキクル・町・字の境・事故・バス停を、選んで重ねる。
// どれも見る人のブラウザが、その場で公の機関のデータ（このサイトの data/ と、気象庁・ハザードマップポータルサイトの地図の絵）を読む
const LT = (s) => (typeof T === "function" ? T(s) : s);
const HZ_TILE = (layer) => `https://disaportaldata.gsi.go.jp/raster/${layer}/{z}/{x}/{y}.png`;
const JMA_TILE = "https://www.jma.go.jp/bosai/jmatile/data";

async function showLayerMap(code, townFeatures, at, esc, part = null) {
  const box = document.getElementById("layer-map");
  if (!box) return;
  const get = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [japan, flood, quake, slope, hito, shelters, med, acc, bus, nowc, risk, lore, aed] = await Promise.all([
    get("data/japan.topo.json"), get(`data/flood-pop/${code}.json`), get(`data/quake-pop/${code}.json`), get(`data/slope/${code}.json`), get(`data/hitokoto/${code}.json`),
    get(`data/shelters/${code}.json`), loadMedical(code), get(`data/accidents/${code}.json`), get(`data/bus/${code}.json`),
    get(`${JMA_TILE}/nowc/targetTimes_N1.json`), get(`${JMA_TILE}/risk/targetTimes.json`), get(`data/lore/${code}.json`), get(`data/aed/${code}.json`),
  ]);
  const outline = japan ? topojson.feature(japan, japan.objects.municipalities).features.find((f) => f.properties.code === code) : null;
  const t = (s) => `${Number(s.slice(8, 10)) + 9 >= 24 ? Number(s.slice(8, 10)) - 15 : Number(s.slice(8, 10)) + 9}:${s.slice(10, 12)}`; // UTC → 日本の時刻
  const fc = (features) => ({ type: "FeatureCollection", features });
  const pt = (p, props) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: props });

  // 病院：今日やっているか・いまやっているか
  const today = med ? medicalList(med, 0, null) : null;
  const openIds = new Map((today?.list ?? []).map((x) => [x.f, x]));
  const medFeatures = (med?.list ?? []).filter((f) => f.p).map((f) => {
    const x = openIds.get(f);
    return pt(f.p, { name: f.n, kind: f.k, s: (f.s ?? []).slice(0, 4).join("・"), state: x?.openNow ? 2 : x ? 1 : 0, hours: x ? x.h.map(([a, b]) => `${hhmm(a)}〜${hhmm(b)}`).join("、") : "" });
  });

  // 気をつけたいことの重なり：町・字ごとに、次の条件がいくつ重なるか（国の数字から。町の評価ではない）
  const CONDS = [
    ["65歳以上が4割以上", (p) => p.over65Rate >= 40],
    ["津波で浸かる想定の所に住む人が3割以上", (p) => (flood?.kinds?.津波?.parts?.[p.part]?.rate ?? 0) >= 30],
    ["洪水で浸かる想定の所に住む人が3割以上", (p) => (flood?.kinds?.洪水?.parts?.[p.part]?.rate ?? 0) >= 30],
    ["土砂災害警戒区域に住む人が1割以上", (p) => (flood?.kinds?.土砂?.parts?.[p.part]?.rate ?? 0) >= 10],
    ["30年以内に震度6強以上が26%以上", (p) => (quake?.parts?.[p.part]?.p60 ?? 0) >= 26],
    ["坂が多い所に住む人が3割以上", (p) => (slope?.parts?.[p.part]?.rate ?? 0) >= 30],
  ];
  const overlap = townFeatures.map((f) => {
    const hit = CONDS.filter(([, fn]) => fn(f.properties)).map(([l]) => l);
    return { ...f, properties: { ...f.properties, n: hit.length, hit: hit.join("／") } };
  });
  const LAYERS = [
    { id: "overlap", name: "気をつけたいことの重なり", on: true, ok: (flood || quake || slope) && overlap.some((f) => f.properties.n > 0), legend: `${["#f6dfa8", "#f0b36b", "#d9773a", "#a8462a"].map((c, i) => `<i class="dot sq" style="background:${c}"></i>${i + 1}${i === 3 ? "+" : ""}`).join(" ")}　${LT("町・字ごとに、次のうちいくつが重なるか（色が濃いほど多い）")}：${CONDS.map(([l]) => LT(l)).join("・")}。${LT("国の数字から出した、めやすです")}` },
    { id: "town", name: "町・字の境", on: true, ok: townFeatures.length > 0 },
    { id: "shelter", name: "避難場所", on: true, ok: !!shelters, legend: `<i class="dot" style="background:#2f7d4f"></i>${LT("指定緊急避難場所（押すと名前と、使える災害）")}` },
    { id: "lore", name: "昔の災害を伝える碑", on: true, ok: !!(lore?.own.length || lore?.near.length), legend: `<i class="dot" style="background:#7a5c3e"></i>${LT("自然災害伝承碑（国土地理院）。押すと、伝えている災害と碑の文")}` },
    { id: "aed", name: "AED", ok: !!aed?.features?.length, legend: `<i class="dot" style="background:#0b7a75"></i>${LT("AED の設置場所（町の一覧）。使える日と時間は施設によってちがいます")}` },
    { id: "iryo", name: "病院・診療所", ok: medFeatures.length > 0, legend: `<i class="dot" style="background:#2a6fdb"></i>${LT("いまやっている")} <i class="dot" style="background:#9db8e8"></i>${LT("今日やっている")} <i class="dot" style="background:#ccc"></i>${LT("今日は休み")}` },
    { id: "rain", name: "雨雲（いま）", ok: !!nowc, legend: `${LT("気象庁の雨雲の動き（高解像度降水ナウキャスト）")}${nowc ? `：${t(nowc[0].validtime)}` : ""}。${LT("薄い水色は弱い雨、黄・赤・紫ほど強い雨")}` },
    { id: "kikikuru", name: "キキクル（土砂）", ok: !!risk, legend: `${LT("気象庁の土砂災害の危険度分布")}${risk ? `：${t(risk[0].validtime)}` : ""}。${LT("黄＝注意・赤＝警戒（危険な所から避難の準備）・紫＝危険（避難）・黒＝災害が起きているおそれ")}` },
    { id: "tsunami", name: "津波の想定", ok: true, legend: LT("津波浸水想定（最大クラス）。色が濃いほど深い") },
    { id: "flood", name: "洪水の想定", ok: true, legend: LT("洪水浸水想定区域（想定最大規模）。色が濃いほど深い") },
    { id: "dosha", name: "土砂災害警戒区域", ok: true, legend: LT("土石流・急傾斜地の崩壊・地すべりの警戒区域（赤みの濃い所は特別警戒区域）") },
    { id: "acc", name: "事故が重なる所", ok: !!acc?.spots?.length, legend: `<i class="dot" style="background:#e8833a"></i>${LT("3年で3件以上の人身事故（警察庁）")}` },
    { id: "bus", name: "バス停", ok: !!bus?.stops?.length, legend: `<i class="dot" style="background:#5b8fc7"></i>${LT("大きいほど平日の本数が多い")}${bus?.lines?.length ? `　${LT("線はバスの路線（時刻表データから）。バス停を押すと、この先の発車")}` : ""}` },
  ].filter((l) => l.ok);

  const map = new maplibregl.Map({
    container: box,
    style: await baseStyle(),
    attributionControl: false,
    center: at ?? [139.7, 35.7], zoom: 12,
  });
  maps.push(map);
  const buttons = new MapButtons({});
  buttons.locate = () => navigator.geolocation?.getCurrentPosition((p) => map.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 15 }), () => at && map.flyTo({ center: at, zoom: 14 }));
  map.addControl(buttons, "bottom-right");

  const raster = (id, tiles, maxzoom, opacity = 0.65) => {
    map.addSource(id, { type: "raster", tiles, tileSize: 256, maxzoom });
    map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": opacity }, layout: { visibility: "none" } });
  };
  map.on("load", () => {
    // 下から：想定の色 → 雨・キキクル → 境 → 点
    raster("tsunami", [HZ_TILE("04_tsunami_newlegend_data")], 17);
    raster("flood", [HZ_TILE("01_flood_l2_shinsuishin_data")], 17);
    for (const [i, l] of ["05_dosekiryukeikaikuiki", "05_kyukeishakeikaikuiki", "05_jisuberikeikaikuiki"].entries()) raster(`dosha${i}`, [HZ_TILE(l)], 17);
    if (nowc) raster("rain", [`${JMA_TILE}/nowc/${nowc[0].basetime}/none/${nowc[0].validtime}/surf/hrpns/{z}/{x}/{y}.png`], 10, 0.7);
    if (risk) raster("kikikuru", [`${JMA_TILE}/risk/${risk[0].basetime}/${risk[0].member}/${risk[0].validtime}/surf/land/{z}/{x}/{y}.png`], 10, 0.7);
    map.addSource("overlap", { type: "geojson", data: fc(overlap) });
    map.addLayer({ id: "overlap", type: "fill", source: "overlap", layout: { visibility: "none" }, paint: { "fill-color": ["step", ["get", "n"], "rgba(0,0,0,0)", 1, "#f6dfa8", 2, "#f0b36b", 3, "#d9773a", 4, "#a8462a"], "fill-opacity": 0.7 } });
    map.addSource("town", { type: "geojson", data: fc(townFeatures) });
    // 町の外をうすく白でおおい、町の中を目立たせる
    // 穴にするのは市区町村の外形（日本地図の形。町・字の形を重ねると境が重なって抜けがおかしくなる）
    if (outline) {
      const rings = outline.geometry.type === "Polygon" ? [outline.geometry.coordinates[0]] : outline.geometry.coordinates.map((p) => p[0]);
      map.addSource("outside", { type: "geojson", data: { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-179, -80], [179, -80], [179, 80], [-179, 80], [-179, -80]], ...rings] } } });
      map.addLayer({ id: "outside", type: "fill", source: "outside", paint: { "fill-color": "#ffffff", "fill-opacity": 0.6 } });
    }
    map.addLayer({ id: "town", type: "line", source: "town", paint: { "line-color": "#3a4a5a", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 14, 1.6], "line-opacity": 0.7 } });
    // 町・字のページでは、その町・字の境を太く（どこを見ているかが分かるように）
    if (part) {
      map.addSource("here", { type: "geojson", data: part });
      map.addLayer({ id: "here", type: "line", source: "here", paint: { "line-color": "#1f3a52", "line-width": 3.5 } });
    }
    raiseLabels(map); // 地名などの文字は、重ねた色やおおいより上に（点はこのあとに足すので、さらに上）
    if (shelters) {
      map.addSource("shelter", { type: "geojson", data: shelters });
      map.addLayer({ id: "shelter", type: "circle", source: "shelter", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 13, 6, 16, 9], "circle-color": "#2f7d4f", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
    }
    map.addSource("iryo", { type: "geojson", data: fc(medFeatures) });
    map.addLayer({ id: "iryo", type: "circle", source: "iryo", layout: { visibility: "none" }, paint: { "circle-radius": ["match", ["get", "state"], 2, 7, 1, 6, 5], "circle-color": ["match", ["get", "state"], 2, "#2a6fdb", 1, "#9db8e8", "#ccc"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
    if (acc?.spots?.length) {
      map.addSource("acc", { type: "geojson", data: fc(acc.spots.map((s) => pt([s.lon, s.lat], s))) });
      map.addLayer({ id: "acc", type: "circle", source: "acc", layout: { visibility: "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["get", "n"], 3, 7, 10, 13], "circle-color": "#e8833a", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
    }
    // バスの路線の線（時刻表データの道の形か、バス停を順につないだ線）。路線ごとに色を分ける
    if (bus?.lines?.length) {
      const PAL = ["#2f6fb0", "#d0731f", "#3d9a5b", "#8a4fb5", "#c0413b", "#2a9ba6", "#9a7b2f", "#5a5a5a"];
      const names = [...new Set(bus.lines.map((l) => l.name))];
      map.addSource("bus-route", { type: "geojson", data: fc(bus.lines.map((l) => ({ type: "Feature", geometry: { type: "LineString", coordinates: l.coords }, properties: { name: l.name, color: PAL[names.indexOf(l.name) % PAL.length] } }))) });
      map.addLayer({ id: "bus-route", type: "line", source: "bus-route", layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 15, 5], "line-opacity": 0.8 } });
    }
    if (bus?.stops?.length) {
      map.addSource("bus", { type: "geojson", data: fc(bus.stops.map((s) => pt([s.lon, s.lat], s))) });
      map.addLayer({ id: "bus", type: "circle", source: "bus", layout: { visibility: "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["get", "n"], 1, 4, 30, 10], "circle-color": "#5b8fc7", "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
    }
    if (lore?.own.length || lore?.near.length) {
      map.addSource("lore", { type: "geojson", data: fc([...lore.own, ...lore.near].map((x) => pt(x.at, { name: x.name, disaster: x.disaster, text: x.text, muniName: x.muniName ?? "" }))) });
      map.addLayer({ id: "lore", type: "circle", source: "lore", layout: { visibility: "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 8], "circle-color": "#7a5c3e", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    }
    if (aed?.features?.length) {
      map.addSource("aed", { type: "geojson", data: aed });
      map.addLayer({ id: "aed", type: "circle", source: "aed", layout: { visibility: "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 14, 6], "circle-color": "#0b7a75", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
    }
    // 町の形に合わせる（町・字のページでは、その町・字に合わせて拡大して始める）
    const pts = (part ? [part] : townFeatures).flatMap((f) => (f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat()).flat());
    const fit = () => pts.length && map.fitBounds([[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]], { padding: 24, duration: 0, maxZoom: 16 });
    if (box.clientWidth) fit();
    else { const ro = new ResizeObserver(() => { if (box.clientWidth) { ro.disconnect(); map.resize(); fit(); } }); ro.observe(box); }
    for (const l of LAYERS) if (l.on) setVis(l.id, true);
    draw();
  });

  // 押した所の説明
  // 押した所の吹き出しは1つだけ（点が町・字の色の上にあるとき、両方が開いて重なっていた）。点を先に、町・字の重なりを最後に見る
  const POPS = {};
  const pop = (layer, html) => (POPS[layer] = html);
  let popup = null;
  map.on("click", (e) => {
    for (const id of ["lore", "shelter", "aed", "iryo", "acc", "bus", "overlap"]) {
      if (!POPS[id] || !map.getLayer(id) || map.getLayoutProperty(id, "visibility") === "none") continue;
      const f = map.queryRenderedFeatures(e.point, { layers: [id] })[0];
      if (!f) continue;
      popup?.remove();
      popup = new maplibregl.Popup({ maxWidth: "260px" }).setLngLat(e.lngLat).setHTML(POPS[id](f.properties)).addTo(map);
      return;
    }
  });
  pop("shelter", (p) => `<strong>${esc(p.name)}</strong><br>${esc(JSON.parse(p.kinds || "[]").join("・"))}${p.capacity ? `<br>${capText(p)}` : ""}`);
  pop("iryo", (p) => `<strong>${esc(p.name)}</strong><br>${esc(p.kind)}${p.s ? `・${esc(p.s)}` : ""}<br>${p.state ? `${LT("今日")} ${esc(p.hours)}` : LT("今日は休み")}<br><small>${LT("行く前に電話で確かめてください")}</small>`);
  pop("acc", (p) => `<strong>${esc(p.part)}</strong><br>${LT("3年で")} ${p.n} ${LT("件")}${Number(p.ped) ? `・${LT("歩行者")} ${p.ped}` : ""}${Number(p.bike) ? `・${LT("自転車")} ${p.bike}` : ""}`);
  pop("overlap", (p) => `<strong>${esc(p.name)}</strong><br>${p.n ? `${LT("重なり")} ${p.n}：${esc(p.hit)}` : LT("重なりはありません")}${hito?.parts?.[p.part] && (!LANG || LANG === "easy") ? `<p class="pop-hito">${esc(hito.parts[p.part].text)}<small>（${LT("AI のまとめ")}）</small></p>` : ""}`);
  pop("lore", (p) => `<strong>${esc(p.name)}</strong>${p.muniName ? `<br><small>${esc(p.muniName)}</small>` : ""}<br>${esc(p.disaster)}<p class="pop-hito">${esc(p.text)}<small>（${LT("国土地理院 自然災害伝承碑")}）</small></p>`);
  pop("aed", (p) => `<strong>${esc(p.name)}</strong>${p.place ? `<br>${esc(p.place)}` : ""}${p.hours ? `<br>${esc(p.hours)}` : ""}${p.address ? `<br><small>${esc(p.address)}</small>` : ""}`);
  pop("bus", (p) => {
    // この先の発車（平日の時刻表から5つまで）。土日・祝日はちがうことがある
    const now = new Date(), hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const next = JSON.parse(p.times || "[]").filter((x) => x.t >= hm).slice(0, 5);
    return `<strong>${esc(p.name)}</strong><br>${LT("平日")} ${p.n} ${LT("本")}`
      + (next.length ? `<ul class="pop-times">${next.map((x) => `<li><b>${esc(x.t)}</b> ${esc(x.r)}${x.h ? ` → ${esc(x.h)}` : ""}</li>`).join("")}</ul><small>${LT("平日の時刻表です。土日・祝日はちがうことがあります")}</small>` : `<br><small>${LT("きょうの平日の便は、もうありません")}</small>`);
  });
  for (const id of ["shelter", "lore", "aed", "iryo", "acc", "bus", "overlap"]) {
    map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
  }

  const on = new Set(LAYERS.filter((l) => l.on).map((l) => l.id));
  let openOnly = false;
  function setVis(id, v) {
    for (const lid of id === "dosha" ? ["dosha0", "dosha1", "dosha2"] : id === "bus" ? ["bus-route", "bus"] : [id]) if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", v ? "visible" : "none");
  }
  function draw() {
    const chips = document.getElementById("layer-chips");
    chips.innerHTML = LAYERS.map((l) => `<button type="button" data-id="${l.id}" aria-pressed="${on.has(l.id)}">${esc(LT(l.name))}</button>`).join("")
      + (on.has("iryo") ? `<label class="open-only"><input type="checkbox" id="open-only" ${openOnly ? "checked" : ""}> ${LT("いまやっている病院だけ")}</label>` : "");
    document.getElementById("layer-legend").innerHTML = LAYERS.filter((l) => on.has(l.id) && l.legend).map((l) => `<li><strong>${esc(LT(l.name))}</strong> ${l.legend}</li>`).join("");
    document.getElementById("open-only")?.addEventListener("change", (e) => {
      openOnly = e.target.checked;
      if (map.getLayer("iryo")) map.setFilter("iryo", openOnly ? ["==", ["get", "state"], 2] : null);
    });
  }
  document.getElementById("layer-chips").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (!b) return;
    const id = b.dataset.id;
    on.has(id) ? on.delete(id) : on.add(id);
    setVis(id, on.has(id));
    draw();
  });
  document.getElementById("layer-note").innerHTML = `${LT("出典")}：${LT("背景の地図は国土地理院の地理院地図 Vector、想定の地図はハザードマップポータルサイト、雨雲とキキクルは気象庁、病院は厚生労働省の医療情報ネット、避難場所は国土地理院の指定緊急避難場所データ、事故は警察庁のオープンデータ。想定は最大規模のもので、必ずこうなるという意味ではありません。")}`;
}
