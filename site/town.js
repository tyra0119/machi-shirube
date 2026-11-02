// 町のページ。どの町も同じ形（町・字1つ・まとまり・市区町村）。
// town.html?town=28109-0990 ／ ?town=28109-0990,0460（複数の町・字）／ ?area=28109-a1（まとまり）／ ?muni=39428
// 調べる機能ができるまでは、国の統計の数字だけを出し、ほかの欄は「まだ調べていません」と正直に出す
const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function getJSON(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch (e) {
    $("problems").insertAdjacentHTML("beforeend", `<li>${path} が読み込めませんでした（${e.message}）</li>`);
    $("problems-box").hidden = false;
    throw e;
  }
}
const shortName = (n) => n.replace(/^.+?郡(?=.+[町村]$)/, "");
const pct = (v) => `${v.toFixed(1)}%`;

const TOWN_ROWS = [
  ["over65Rate", "65歳以上の人の割合", "population"],
  ["over75Rate", "75歳以上の人の割合", "population"],
  ["under15Rate", "15歳未満の子どもの割合", "population"],
  ["foreignRate", "外国の住民の割合", "population"],
  ["elderlySingleRate", "65歳以上の一人暮らしの世帯の割合", "households"],
  ["singleRate", "一人暮らしの世帯の割合", "households"],
  ["ownedRate", "持ち家の世帯の割合", "households"],
  ["apartmentRate", "共同住宅（マンション・アパート）の世帯の割合", "households"],
];

// 町のサイトのページ。URL の # で、どのページを見せるかを決める（#today・#bousai・#gomi …）
// later：まだ答えがないページに「これから何が出るか」を書く（Claude が公式のサイトから探して出す予定のもの）
const PAGES = [
  { view: "today", title: "今日", desc: "今日と明日の天気・洗濯・服装・警報・地震", tab: true },
  { view: "bousai", title: "防災・避難", desc: "わが家の避難・避難場所・災害のときの行動", tab: true, later: "災害のときにどう動くか（町の防災の手引き）" },
  { view: "gomi", title: "ごみ", desc: "収集日・このごみは何ごみか", tab: true, later: "収集日のカレンダーと、このごみは何ごみかを引ける表" },
  { view: "iryo", title: "医療・健康", desc: "今日やっている病院・夜間と休日の窓口", tab: true, later: "夜間・休日に困ったときの窓口（休日の当番医・子どもの急病の相談など）" },
  { view: "komatta", title: "困ったとき", desc: "どこに電話・メールすればよいか", tab: true, later: "困りごとごとの、電話・メールの窓口" },
  { view: "kosodate", title: "子育て", desc: "子育ての窓口・手当", later: "子育ての窓口と、手当・助成" },
  { view: "kaigo", title: "お年寄り・介護", desc: "介護の窓口・見守り", later: "介護の相談の窓口と、見守り・配食などの助け" },
  { view: "koutsuu", title: "バス・電車", desc: "町の中の移動", later: "コミュニティバスや電車の時刻・乗り場" },
  { view: "tetsuzuki", title: "手続き", desc: "引っ越し・住民票など", later: "引っ越しや住民票などの手続きの窓口" },
  { view: "foreign", title: "外国の方へ", desc: "やさしい日本語・母語の案内", later: "やさしい日本語や母語での案内" },
  { view: "okane", title: "お金・補助金", desc: "補助金・給付・ガソリンなど", later: "いま申し込める補助金・給付と、締め切り" },
  { view: "shisetsu", title: "公園・図書館", desc: "近くの施設", later: "公園・図書館などの場所と開いている時間" },
  { view: "shiru", title: "町を知る", desc: "町の形・歴史・催し・町のデータ", tab: true },
  { view: "mitate", title: "まちしるべの見立て", desc: "この町で暮らしの情報が届きにくい人" },
  { view: "source", title: "出典", desc: "このページの情報の出どころと、しくみ" },
  { view: "research", title: "調べる（手元の画面だけ）", desc: "Claude にこの町を調べてもらう", local: true },
];
const OLD_VIEW = { top: "today", sonae: "bousai", kurashi: "gomi" }; // 前の形の URL
const maps = []; // 隠れていたページの地図は、見せたときに大きさを合わせ直す
function currentView() {
  const h = location.hash.slice(1);
  return PAGES.some((p) => p.view === h) ? h : OLD_VIEW[h] ?? "today";
}
function showView() {
  const v = currentView();
  for (const el of document.querySelectorAll(".view")) el.hidden = el.dataset.view !== v;
  for (const a of document.querySelectorAll(".town-tabs a")) a.toggleAttribute("aria-current", a.dataset.view === v);
  // 隠れていたあいだは大きさが 0 なので、見せたときに大きさを合わせ、覚えておいた範囲に寄せ直す
  for (const m of maps) { m.resize(); if (m.fitTo) m.fitBounds(m.fitTo.box, { ...m.fitTo.opts, duration: 0 }); }
  // タブの帯を動かさない：下のほうまで読んでいたときだけ、新しいページの先頭（タブの帯のすぐ下）を出す。
  // 上のほう（町の名前が見えている所）にいたときは、そのまま
  const head = document.querySelector(".town-head");
  const top = head.offsetTop + head.offsetHeight;
  if (window.scrollY > top) window.scrollTo({ top });
}
// 上のメニュー：よく使うページと「すべてのページ」
$("tabs").innerHTML = `<li class="all-pages"><button type="button" id="open-all" aria-haspopup="dialog">☰ すべてのページ</button></li>`
  + PAGES.filter((p) => p.tab || p.local).map((p) =>
  `<li${p.local ? " class=\"local-only\" hidden" : ""}><a href="#${p.view}" data-view="${p.view}">${icon(ILLUST[p.view]?.main)}${esc(p.local ? "調べる" : p.title)}</a></li>`).join("");
// 各ページのいちばん上の見出しに、場面の印を付ける
for (const v of document.querySelectorAll(".view")) v.querySelector(".block > h2")?.insertAdjacentHTML("afterbegin", icon(ILLUST[v.dataset.view]?.main));
addEventListener("hashchange", showView);
showView();

main().catch((e) => console.error(e));

// 届きにくい人の候補（types.js）。町・字やまとまりのページでは、その市区町村の数字で出す
async function showTypes(code, stats, scopeNote) {
  const flags = (await getJSON("data/flags.json")).flags;
  const t = stats.towns[code];
  if (!t) return;
  let f = flags[code] ?? {};
  if (!flags[code] && !t.ward) {
    // 政令市まるごとは、どれかの区に付いていれば付ける
    for (const [c, w] of Object.entries(stats.towns)) if (w.ward && w.pref === t.pref && w.name.startsWith(t.name)) f = { ...f, ...flags[c] };
  }
  $("types-scope").textContent = scopeNote;
  $("types").innerHTML = typeCandidatesHTML(t, f, stats.summary);
}

// わが家の避難（いちばん細い段）：場所（町・字・地図を押す・現在地）から、近い避難場所をまっすぐの距離で出す。
// 場所はブラウザの中だけで使い、送らず残さない。坂・道・浸水の深さは、計算の部品ができてから足す
async function showHinan(code, townFeatures, startPart) {
  const res = await fetch(`data/shelters/${code}.json`).catch(() => null);
  if (!res?.ok) return false;
  const shelters = await res.json();
  $("hinan-block").hidden = false;
  // 災害の種類のボタンは、この町のデータにある種類から作る（津波の避難場所がない町もある）
  const ORDER = ["津波", "洪水", "土砂", "高潮", "地震", "火事", "内水", "火山"];
  const count = (k) => shelters.features.filter((f) => f.properties.kinds.includes(k)).length;
  const kinds = ORDER.filter((k) => count(k));
  let kind = kinds.includes("津波") ? "津波" : kinds.includes("地震") ? "地震" : kinds[0] ?? "";
  $("hinan-kinds").innerHTML = [...kinds, ""].map((k) =>
    `<button type="button" data-kind="${k}" aria-pressed="${k === kind}">${k ? `${k}` : "すべて"}<small>${k ? count(k) : shelters.features.length}</small></button>`).join("");
  let here = null; // [経度, 緯度]

  // 町・字を選ぶ（形のおおよその真ん中を、その町・字の場所のめやすにする）
  const center = (f) => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const ring = polys.reduce((a, b) => (b[0].length > a[0].length ? b : a))[0];
    return ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
  };
  const sel = $("hinan-town");
  sel.innerHTML = `<option value="">（選ぶ）</option>` + townFeatures.map((f) => `<option value="${f.properties.part}">${esc(f.properties.name)}</option>`).join("");

  const map = new maplibregl.Map({
    container: "hinan-map",
    style: {
      version: 8,
      sources: { pale: { type: "raster", tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 18 } },
      layers: [{ id: "pale", type: "raster", source: "pale" }],
    },
    attributionControl: false,
    dragRotate: true,
  });
  maps.push(map);
  // 地図のボタン：右下に縦に（方角・現在地・＋・−）。現在地はその場所から近い避難場所を出す
  const buttons = new MapButtons({ onNoLocation: (t) => ($("hinan-note").textContent = t) });
  buttons.locate = () => {
    if (!navigator.geolocation) return ($("hinan-note").textContent = "この端末では現在地が使えません");
    navigator.geolocation.getCurrentPosition(
      (pos) => setHere([pos.coords.longitude, pos.coords.latitude], "現在地"),
      () => ($("hinan-note").textContent = "現在地が取れませんでした"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  map.addControl(buttons, "bottom-right");

  map.on("load", () => {
    map.addSource("shelters", { type: "geojson", data: shelters });
    map.addLayer({
      id: "shelters", type: "circle", source: "shelters",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 7],
        "circle-color": color("--accent"),
        "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5,
      },
    });
    showKind();
    map.addSource("here", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "near-line", type: "line", source: "here", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": color("--text"), "line-width": 2, "line-dasharray": [2, 1.5] } });
    map.addLayer({ id: "here", type: "circle", source: "here", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 8, "circle-color": color("--text"), "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
    const box = new maplibregl.LngLatBounds();
    for (const f of shelters.features) box.extend(f.geometry.coordinates);
    map.fitTo = { box, opts: { padding: 30 } };
    map.fitBounds(box, { padding: 30, duration: 0 });
    if (startPart) { sel.value = startPart; sel.dispatchEvent(new Event("change")); }
  });
  // 地図を押す：避難場所の点なら名前を出す。それ以外の所なら、そこから近い避難場所を出す
  map.on("click", (e) => {
    const f = map.getLayer("shelters") && map.queryRenderedFeatures(e.point, { layers: ["shelters"] })[0];
    if (f) return popup(f.geometry.coordinates, f.properties.name, JSON.parse(f.properties.kinds ?? "[]"));
    setHere([e.lngLat.lng, e.lngLat.lat], "地図で選んだ場所");
  });
  map.on("mouseenter", "shelters", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "shelters", () => (map.getCanvas().style.cursor = ""));
  let pop = null;
  function popup(at, name, kinds) {
    pop?.remove();
    pop = new maplibregl.Popup({ offset: 16, maxWidth: "240px" }).setLngLat(at)
      .setHTML(`<strong>${esc(name)}</strong><br><small>${esc(kinds.join("・"))}のときに使える</small>`).addTo(map);
  }
  sel.addEventListener("change", () => {
    const f = townFeatures.find((x) => x.properties.part === sel.value);
    if (f) setHere(center(f), `${f.properties.name}（町・字のおおよその真ん中）`);
  });
  for (const b of document.querySelectorAll("#hinan-block .hinan-kind button")) {
    b.addEventListener("click", () => {
      kind = b.dataset.kind;
      document.querySelectorAll("#hinan-block .hinan-kind button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      showKind();
      if (here) setHere(here.at, here.label);
    });
  }

  // 選んだ災害のときに使える所だけを地図に出す。津波・洪水は、浸水の深さの想定を下に重ねる
  function showKind() {
    if (!map.getLayer("shelters")) return;
    map.setFilter("shelters", kind ? ["in", kind, ["get", "kinds"]] : null);
    if (map.getLayer("hazard")) map.removeLayer("hazard");
    if (map.getSource("hazard")) map.removeSource("hazard");
    const t = HAZARD_TILES[kind];
    $("hazard-legend").hidden = !t;
    if (!t) return;
    map.addSource("hazard", { type: "raster", tiles: [t.url], tileSize: 256, minzoom: 2, maxzoom: 17 });
    map.addLayer({ id: "hazard", type: "raster", source: "hazard", paint: { "raster-opacity": 0.65 } }, "shelters");
    $("hazard-legend").innerHTML = `<span class="t">${esc(t.name)}（浸水の深さ）</span>`
      + DEPTH_COLORS.map(([c, label]) => `<span class="c"><i style="background:rgb(${c.join(",")})"></i>${label}</span>`).join("")
      + `<span class="src">出典：「ハザードマップポータルサイト」を加工して作成。くわしくは町のハザードマップで</span>`;
  }
  // 海抜・浸水の想定・坂を考えた歩く時間（hazard.js）。あとから出る（地図の絵を読むので少し待つ）
  async function calc(at, token) {
    const hz = HAZARD_TILES[kind] ? kind : null;
    $("hinan-here").hidden = false;
    $("hinan-here").textContent = "海抜と浸水の想定を計算しています…";
    const [h0, d0] = await Promise.all([elevationAt(...at), hz ? depthAt(hz, ...at) : null]);
    if (token !== setHere.token) return;
    $("hinan-here").innerHTML = `選んだ場所：海抜 約 ${h0 != null ? `${Math.round(h0)}m` : "（分からない）"}${hz ? `・${hz}の浸水の想定 <strong>${d0?.label ?? "区域の外（想定なし）"}</strong>` : ""}`;
    await Promise.all(cand.map(async (c, i) => {
      const p = c.f.geometry.coordinates;
      const [h, d, w] = await Promise.all([elevationAt(...p), hz ? depthAt(hz, ...p) : null, walkMinutes(at, p, c.m)]);
      if (token !== setHere.token) return;
      const li = document.querySelector(`#hinan-list li[data-i="${i}"] .d`);
      if (!li) return;
      li.innerHTML = `まっすぐ ${c.m.toLocaleString("ja-JP")}m・歩いて約 ${Math.max(1, Math.round(c.m / 60))}分`
        + (w.hasElevation ? `・<strong>坂を考えると約 ${w.min}分</strong>（上り ${w.up}m・下り ${w.down}m）` : "")
        + `<br>避難場所の海抜 約 ${h != null ? `${Math.round(h)}m` : "（分からない）"}`
        + (hz ? `・${hz}の浸水の想定 ${d?.label ? `<strong class="warn">${d.label}</strong>` : "区域の外"}` : "");
    }));
  }
  // まっすぐの距離（m）。歩くめやすは 1分 60m（お年寄りの歩く速さのめやす）
  const meters = ([a, b], [c, d]) => {
    const R = 6371000, rad = Math.PI / 180;
    const x = (c - a) * rad * Math.cos(((b + d) / 2) * rad), y = (d - b) * rad;
    return Math.round(Math.sqrt(x * x + y * y) * R);
  };
  // 近い順の 1・2・3 を、一覧と同じ番号の印で地図に立てる。一覧や印を押すと、その場所に寄って名前を出す
  let pins = [];
  let cand = [];
  function select(i) {
    const c = cand[i];
    if (!c) return;
    pins.forEach((p, k) => p.getElement().classList.toggle("on", k === i));
    document.querySelectorAll("#hinan-list li").forEach((li, k) => li.classList.toggle("on", k === i));
    map.flyTo({ center: c.f.geometry.coordinates, zoom: Math.max(map.getZoom(), 16), duration: 600 });
    popup(c.f.geometry.coordinates, `${i + 1}. ${c.f.properties.name}`, c.f.properties.kinds);
    const r = $("hinan-map").getBoundingClientRect();
    if (r.top < 60 || r.bottom > innerHeight) $("hinan-map").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function setHere(at, label) {
    here = { at, label };
    pop?.remove();
    cand = shelters.features.filter((f) => !kind || f.properties.kinds.includes(kind))
      .map((f) => ({ f, m: meters(at, f.geometry.coordinates) })).sort((x, y) => x.m - y.m).slice(0, 3);
    pins.forEach((p) => p.remove());
    pins = cand.map((c, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "hinan-pin";
      el.textContent = String(i + 1);
      el.setAttribute("aria-label", `${i + 1}番目に近い ${c.f.properties.name}`);
      el.addEventListener("click", (e) => { e.stopPropagation(); select(i); });
      return new maplibregl.Marker({ element: el }).setLngLat(c.f.geometry.coordinates).addTo(map);
    });
    map.getSource("here").setData({ type: "FeatureCollection", features: [
      { type: "Feature", geometry: { type: "Point", coordinates: at }, properties: {} },
      ...cand.map((c) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [at, c.f.geometry.coordinates] }, properties: {} })),
    ] });
    const box = new maplibregl.LngLatBounds(at, at);
    for (const c of cand) box.extend(c.f.geometry.coordinates);
    map.fitTo = { box, opts: { padding: 50, maxZoom: 16 } };
    map.fitBounds(box, { padding: 50, maxZoom: 16, duration: 500 });
    $("hinan-list").innerHTML = cand.map((c, i) => `
      <li data-i="${i}" tabindex="0" role="button" aria-label="地図で ${esc(c.f.properties.name)} を見る"><span class="pin" aria-hidden="true">${i + 1}</span><span class="n">${esc(c.f.properties.name)}</span>
        <span class="d">まっすぐ ${c.m.toLocaleString("ja-JP")}m・歩いて約 ${Math.max(1, Math.round(c.m / 60))}分（めやす）</span>
        <span class="k">${esc(c.f.properties.address ?? "")}・${esc(c.f.properties.kinds.join("・"))}${c.f.properties.capacity ? `・${esc(c.f.properties.capacity)}` : ""}${c.f.properties.note ? `・${esc(c.f.properties.note)}` : ""}</span></li>`).join("");
    for (const li of document.querySelectorAll("#hinan-list li")) {
      li.addEventListener("click", () => select(Number(li.dataset.i)));
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(Number(li.dataset.i)); } });
    }
    const token = (setHere.token = (setHere.token ?? 0) + 1);
    calc(at, token);
    $("hinan-note").innerHTML = `${esc(label)}から、${kind ? `${kind}のときに使える指定緊急避難場所` : "すべての指定緊急避難場所"}の近い順。距離はまっすぐ測ったもので、坂や道の曲がりは考えていません。歩く時間は1分60m（お年寄りの歩く速さ）のめやすで、坂はまっすぐの線の上の上り下りから見積もったものです（道の坂とは違います）。海抜は地理院タイル（標高タイル）、浸水の深さは想定の地図の色から読んだめやすです。避難の判断は町の案内に従ってください。<br>出典：${esc(shelters.source.title)}（${esc(shelters.source.license)}・${shelters.source.updated ? `${esc(shelters.source.updated)} 更新のものを ` : ""}${esc(shelters.source.fetchedAt)} に取得）を加工`;
  }
  return true;
}

// 確かめた答え（site/data/answers/{市区町村コード}.json。OK か自動で承認したものだけ）。
// 物差しの問いの page で、町のサイトのどのページに出すかを決める
let yardstick = { questions: [] };
let answersByPage = {};
// 町・字のページ（partKey＝{コード}-{番号}）では、その町・字について調べた答えを先に、市区町村全体の答えをあとに出す
async function showAnswers(code, scopeNote, partKey, partName) {
  const load = (k) => fetch(`data/answers/${k}.json`).then((r) => (r.ok ? r.json() : { answers: [] })).then((d) => d.answers).catch(() => []);
  const [muniAnswers, partAnswers] = await Promise.all([load(code), partKey ? load(partKey) : []]);
  for (const a of partAnswers) a.level = partName;
  const answers = [...partAnswers, ...muniAnswers];
  yardstick = await fetch("data/yardstick.json").then((r) => r.json()).catch(() => ({ questions: [] }));
  answers.sort((x, y) => Boolean(y.level) - Boolean(x.level) || String(x.qid ?? "").localeCompare(String(y.qid ?? "")));
  answersByPage = {};
  for (const a of answers) {
    const page = yardstick.questions.find((x) => x.id === a.qid)?.page ?? "shiru";
    (answersByPage[page] ??= []).push(a);
  }
  for (const box of document.querySelectorAll(".answers-box")) {
    const list = answersByPage[box.dataset.page] ?? [];
    const p = PAGES.find((x) => x.view === box.dataset.page);
    box.innerHTML = (list.length && scopeNote && !list.some((a) => a.level) ? `<p class="note">${esc(scopeNote)}</p>` : "")
      + (list.length ? answersHTML(list) : "")
      + (p?.later ? `<p class="later"><span>これから</span>${esc(p.later)}を、Claude が町の公式のサイトから探して、出典つきでここに出します。</p>` : "")
      + (!list.length && !p?.later ? `<p class="note">まだありません。</p>` : "");
  }
}
function answersHTML(answers) {
  // 見つからなかった答えも隠さず出す（届いていないことの手がかり。町の人に聞きたいこと）
  const notFound = (a) => a.value === "見つからなかった";
  return `<ul class="answers">${answers.map((a) => `
    <li class="${notFound(a) ? "not-found" : ""}" id="a-${esc(a.qid ?? "")}">
      <h3 class="short">${esc(yardstick.questions.find((x) => x.id === a.qid)?.short ?? "")}${a.level ? `<span class="lvl">${esc(a.level)}の答え</span>` : ""}</h3>
      <p class="q">${esc(a.question)}</p>
      ${notFound(a)
        ? `<p class="a">公開の資料では見つかりませんでした</p><p class="src">${a.checkedAt ? `${esc(a.checkedAt.slice(0, 10))} に調べた・` : ""}町の人に聞きたいことです</p>`
        : `<p class="a">${esc(a.value)}</p>
      <p class="src">出典：${a.source?.url ? `<a href="${esc(a.source.url)}" target="_blank" rel="noopener">${esc(a.source.title ?? a.source.url)}</a>` : esc(a.source?.title ?? "")}${a.source?.where ? `（${esc(a.source.where)}）` : ""}${a.asOf ? `・時点 ${esc(a.asOf)}` : ""}・${a.status === "auto" ? "自動で承認" : "人が確かめた"}</p>
      ${a.outdated ? `<p class="outdated"><strong>古いデータに気づきました</strong>：${esc(a.outdated.what)}。古い：${a.outdated.old?.url ? `<a href="${esc(a.outdated.old.url)}" target="_blank" rel="noopener">${esc(a.outdated.old.asOf ?? "")}</a>` : esc(a.outdated.old?.asOf ?? "")}／新しい：${a.outdated.new?.url ? `<a href="${esc(a.outdated.new.url)}" target="_blank" rel="noopener">${esc(a.outdated.new.asOf ?? "")}</a>` : esc(a.outdated.new?.asOf ?? "")}</p>` : ""}`}
    </li>`).join("")}</ul>`;
}

// 今日のページ：天気・洗濯・服装・警報・地震（見る人のブラウザが気象庁と Open-Meteo をその場で読む）
async function showToday(code, at) {
  try {
    $("today-box").innerHTML = todayHTML(await loadToday(code, at[1], at[0]), esc);
  } catch (e) {
    $("today-box").innerHTML = `<p class="note">天気を読み込めませんでした。時間をおいて開き直してください。</p>`;
    console.error(e);
  }
}
// 医療・健康：今日・明日やっている病院と診療所（medical.js）。center は近い順に並べる場所
async function showMedical(code, center) {
  const m = await loadMedical(code);
  if (!m) {
    const text = /0$/.test(code) && !(await fetch(`data/towns/${code}.json`).then((r) => r.ok).catch(() => false)) ? "区ごとのページで見られます" : "この市区町村の病院のデータはまだありません";
    $("med").innerHTML = `<p class="note">${text}。</p>`;
    medicalRow = `<li><a href="#iryo"><span class="k">${icon("hospital")}病院</span><span class="v later">${text}</span></a></li>`;
    return;
  }
  let day = 0;
  let limit = 5;
  const draw = () => {
    $("med").innerHTML = medicalHTML(m, day, center, esc, $("med-filter").value, limit);
    $("med").querySelector("[data-more]")?.addEventListener("click", () => { limit += 10; draw(); });
  };
  for (const b of document.querySelectorAll("#med-block .hinan-kind button")) {
    b.addEventListener("click", () => {
      day = Number(b.dataset.day);
      limit = 5;
      document.querySelectorAll("#med-block .hinan-kind button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      draw();
    });
  }
  $("med-filter").addEventListener("input", () => { limit = 5; draw(); });
  draw();
  $("med-cite").innerHTML = `出典：<a href="${esc(m.source.url)}" target="_blank" rel="noopener">${esc(m.source.title)}</a>（${esc(m.source.asOf)}・${esc(m.source.license)}）を加工。祝日：${esc(m.holidaySource?.title ?? "")}。${center ? "距離は町・字のおおよその真ん中からまっすぐ測ったものです。" : ""}`;
  const today = medicalList(m, 0, center);
  const open = today.list.filter((x) => x.openNow).length;
  medicalRow = `<li><a href="#iryo"><span class="k">${icon("hospital")}病院</span><span class="v">${today.holiday ? `今日は${esc(today.holiday)}。` : ""}今日やっている所 ${today.list.length} か所（いま開いている ${open}）</span></a></li>`;
}

// 今日の暮らし（今日すること・困ったときの入口）と、暮らしの場面のタイル
let medicalRow = null;
function todayLife(hasHinan) {
  const has = (v) => (answersByPage[v] ?? []).filter((a) => a.value !== "見つからなかった").length;
  const row = (view, k, v, ready) => `<li><a href="#${view}"><span class="k">${icon(ILLUST[view]?.main)}${k}</span><span class="v${ready ? "" : " later"}">${esc(v)}</span></a></li>`;
  $("today-life").innerHTML = [
    row("gomi", "ごみ", has("gomi") ? "ごみの出し方を見る" : "今日の収集は、これから出します", has("gomi")),
    medicalRow ?? row("iryo", "病院", "この町の病院のデータはまだありません", false),
    row("bousai", "避難", hasHinan ? "わが家から近い避難場所を出す" : has("bousai") ? "避難場所の案内を見る" : "避難場所は、これから出します", hasHinan || has("bousai")),
    row("komatta", "困ったとき", "電話・メールの窓口は、これから出します", false),
  ].join("");
  $("tiles").innerHTML = PAGES.filter((p) => !["today", "source", "research", "mitate"].includes(p.view)).map((p) => {
    // 中身があるか：Claude の答え・わが家の避難・病院のデータ・町のデータ
    const n = has(p.view) + (p.view === "bousai" && hasHinan ? 1 : 0) + (p.view === "shiru" ? 1 : 0) + (p.view === "iryo" && medicalRow && !medicalRow.includes("later") ? 1 : 0) + (p.view === "foreign" && !$("tr-block").hidden ? 1 : 0);
    return `<li><a href="#${p.view}">${illust(p.view)}<span class="t">${esc(p.title)}</span><span class="d">${esc(p.desc)}</span>${n ? "" : `<span class="later">これから</span>`}</a></li>`;
  }).join("");
}

// すべてのページ：町のサイトの全部のページと中身を一覧にして、押すとそこへ飛ぶ（中を探すこともできる）
let allPages = [];
function buildAllPages(hasHinan, local) {
  const shortOf = (a) => yardstick.questions.find((x) => x.id === a.qid)?.short ?? a.question.slice(0, 16);
  const extra = {
    today: [["今日と明日（天気・洗濯・服装）", "sec-today"], ["今日の暮らし", "sec-today-life"]],
    bousai: hasHinan ? [["わが家の避難（近い避難場所）", "hinan-block"]] : [],
    shiru: [["町のデータ（全国と比べた数字）", "sec-features"]],
  };
  allPages = PAGES.filter((p) => !p.local || local).map((p) => ({
    ...p,
    items: [
      ...(extra[p.view] ?? []).map(([label, target]) => ({ label, view: p.view, target })),
      ...(answersByPage[p.view] ?? []).map((a) => ({ label: shortOf(a), view: p.view, target: `a-${a.qid}` })),
    ],
  }));
}
function renderAllPages(filter = "") {
  const f = filter.replace(/\s/g, "");
  const hit = (s) => !f || s.replace(/\s/g, "").includes(f);
  $("all-list").innerHTML = allPages.map((p) => {
    const its = p.items.filter((i) => hit(i.label) || hit(p.title));
    if (f && !its.length && !hit(p.title) && !hit(p.desc)) return "";
    return `<section class="all-sec">
      <a class="all-page" href="#${p.view}" data-view="${p.view}"><span class="t">${icon(ILLUST[p.view]?.main)}${esc(p.title)}</span><span class="d">${esc(p.desc)}</span></a>
      ${its.length ? `<ul>${its.map((i) => `<li><a href="#${i.view}" data-view="${i.view}" data-target="${i.target}">${esc(i.label)}</a></li>`).join("")}</ul>` : ""}
    </section>`;
  }).join("") || `<p class="note">見つかりません。</p>`;
}
function wireAllPages() {
  const dlg = $("all-pages");
  $("open-all").addEventListener("click", () => { renderAllPages($("all-search").value); dlg.showModal(); $("all-search").focus(); });
  $("close-all").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // 外を押すと閉じる
  $("all-search").addEventListener("input", (e) => renderAllPages(e.target.value));
  $("all-list").addEventListener("click", (e) => {
    const a = e.target.closest("a[data-view]");
    if (!a) return;
    e.preventDefault();
    dlg.close();
    location.hash = a.dataset.view;
    showView();
    if (a.dataset.target) setTimeout(() => $(a.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  });
}
wireAllPages();

// 母語で防災：Claude が訳し、別の Claude が訳し戻して確かめた訳（site/data/translations/{コード}.json）。
// 確かめで意味がずれた訳は、人が OK するまで出さず、もとの日本語を出す
const TR_NOTE = {
  pt: "Tradução feita por IA (Claude). Outra IA traduziu de volta para o japonês para conferir o sentido. Confirme as informações oficiais no site da cidade.",
  es: "Traducción hecha por IA (Claude). Otra IA la tradujo de nuevo al japonés para comprobar el sentido. Confirme la información oficial en el sitio del municipio.",
  en: "Translated by AI (Claude). Another AI translated it back into Japanese to check the meaning. Please check the official information on the town's website.",
  easy: "AI（Claude）が やさしい にほんごに しました。べつの AI が もとの ことばと おなじ いみか たしかめました。ただしい ことは まちの ホームページで たしかめて ください。",
};
const TR_PENDING = { pt: "Tradução em verificação. Original em japonês:", es: "Traducción en verificación. Original en japonés:", en: "Translation being checked. Original Japanese:", easy: "いま たしかめて います。もとの にほんご：" };
async function showTranslations(code) {
  const t = await fetch(`data/translations/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!t) return;
  const langs = Object.keys(t.langs);
  let lang = new URLSearchParams(location.search).get("lang");
  if (!langs.includes(lang)) lang = langs[0];
  $("tr-block").hidden = false;
  $("lang-bar").hidden = false;
  $("lang-bar").innerHTML = langs.map((l) => `<a href="#foreign" data-lang="${l}">${esc(t.langs[l].name)}</a>`).join("") + `<span>（AI による訳）</span>`;
  const draw = () => {
    const L = t.langs[lang];
    $("tr-langs").innerHTML = langs.map((l) => `<button type="button" data-lang="${l}" aria-pressed="${l === lang}">${esc(t.langs[l].name)}</button>`).join("");
    $("tr-note").textContent = TR_NOTE[lang] ?? "";
    $("tr-list").innerHTML = L.items.map((x) => {
      const ok = x.status === "auto" || x.status === "ok";
      return `<li lang="${lang === "easy" ? "ja" : lang}">
        <h3>${esc(ok ? x.short : x.qid)}</h3>
        ${ok ? `<p class="tx">${esc(x.text)}</p>` : `<p class="tx pending">${esc(TR_PENDING[lang] ?? "")} ${esc(x.original)}</p>`}
        <details><summary>もとの日本語・出典</summary><p lang="ja">${esc(x.original)}</p>
          ${x.source?.url ? `<p>出典：<a href="${esc(x.source.url)}" target="_blank" rel="noopener">${esc(x.source.title ?? x.source.url)}</a></p>` : ""}</details>
      </li>`;
    }).join("");
    for (const b of $("tr-langs").querySelectorAll("button")) b.addEventListener("click", () => { lang = b.dataset.lang; draw(); });
  };
  for (const a of $("lang-bar").querySelectorAll("a")) a.addEventListener("click", () => { lang = a.dataset.lang; draw(); });
  draw();
}

// どの町のページも最後に同じことをする：答え・わが家の避難・今日の暮らし・すべてのページ・調べる
async function finishPage(code, townFeatures, startPart, scopeNote) {
  const part = startPart && townFeatures.find((f) => f.properties.part === startPart);
  await showAnswers(code, scopeNote, part ? `${code}-${startPart}` : null, part?.properties.name);
  // 町の色（町の花・木から。地図を描く前に決める）
  const sym = applyTownColor(Object.values(answersByPage).flat().find((x) => x.qid === "Q11"));
  if (sym) {
    $("town-color-note").hidden = false;
    $("town-color-note").innerHTML = `<span class="swatch" aria-hidden="true"></span>ページの上の帯の色は、町が定めた「${esc(sym.name)}」の色から作りました（町の公式の色ではありません）。<a href="#shiru" id="color-src">出典</a>`;
    $("color-src").addEventListener("click", () => setTimeout(() => $("a-Q11")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50));
  }
  const hasHinan = await showHinan(code, townFeatures, startPart);
  await showTranslations(code);
  todayLife(hasHinan);
  const local = await fetch("api/ping").then((r) => r.ok).catch(() => false);
  buildAllPages(hasHinan, local);
  if (local) await researchBox(code);
}

// 天気を読む場所：町・字は形のおおよその真ん中、市区町村は地図の名前の位置（政令市まるごとは最初の区）
function centerOf(features) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of polys) for (const [x, y] of p[0]) { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); }
  }
  return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
}
async function muniPoint(code) {
  const labels = (await getJSON("data/labels.json")).features;
  const f = labels.find((x) => x.properties.code === code) ?? labels.find((x) => x.properties.code.startsWith(code.slice(0, 4)));
  return f.geometry.coordinates;
}

// 調べる（手元の画面だけ）。手元のサーバーが Claude を呼び、答えを確かめる一覧に入れる
async function researchBox(code) {
  $("research-block").hidden = false;
  for (const el of document.querySelectorAll(".town-tabs .local-only")) el.hidden = false;
  $("research-link").href = `research.html?muni=${code}`;
  const form = $("research-form");
  form.question.value = "この町の指定緊急避難場所の一覧は、どこで見られるか（公式のページか資料）。全部でいくつあるか";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "調べています…（1分ほど）";
    $("research-steps").innerHTML = `<li>${new Date().toLocaleTimeString("ja-JP")} 始めました</li>`;
    const res = await fetch("api/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, question: form.question.value }) });
    const body = await res.json();
    $("research-steps").innerHTML = res.ok
      ? body.steps.map((s) => `<li>${esc(s)}</li>`).join("") + `<li>答え：${esc(body.value)}（$${body.usd.toFixed(3)}）</li><li>${body.status === "auto" ? "自動で承認しました" : `確かめる一覧に入りました：<a href="review.html">確かめる一覧へ</a>`}</li>`
      : `<li>できませんでした：${esc(body.error)}</li>`;
    button.disabled = false;
    button.textContent = "この問いを調べる";
  });
}

async function main() {
  const stats = await getJSON("data/stats.json");
  if (q.get("muni")) return muniPage(q.get("muni"), stats);

  // 町・字（1つか複数）かまとまり
  let code, parts, title, kind;
  if (q.get("area")) {
    const area = (await getJSON("data/areas.json")).areas.find((a) => a.id === q.get("area"));
    if (!area) return notFound("このまとまりは見つかりませんでした");
    ({ muni: code, parts, name: title } = area);
    kind = `まとまり（${parts.length}の町・字）`;
  } else if (q.get("town")) {
    const [c, list] = q.get("town").split("-");
    code = c;
    parts = (list ?? "").split(",").filter(Boolean);
  } else return notFound("町が指定されていません");

  const topo = await getJSON(`data/towns/${code}.json`);
  const all = topojson.feature(topo, topo.objects.towns).features;
  const chosen = parts.map((p) => all.find((f) => f.properties.part === p)).filter(Boolean);
  if (!chosen.length) return notFound("町・字が見つかりませんでした");
  title ??= chosen.length === 1 ? chosen[0].properties.name : chosen.map((f) => f.properties.name).join("・");
  kind ??= chosen.length === 1 ? `町・字（番号 ${chosen[0].properties.part}）` : `${chosen.length}の町・字を合わせて`;

  const muni = stats.towns[code];
  const muniName = muni ? shortName(muni.name) : code;
  header(title, `${muni?.pref ?? ""} ${muniName}・${kind}`, [
    ["日本", "./"],
    [muni?.pref ?? "", muni ? `./?pref=${encodeURIComponent(muni.pref)}` : null],
    [muniName, `./?muni=${code}&towns`],
    [title, null],
  ]);
  if (chosen.length > 1) $("parts").textContent = `合わせた町・字：${chosen.map((f) => f.properties.name).join("、")}`;

  // 数字：人口と世帯は足し算、割合は人数（世帯の数）で重みをつけて合わせる（めやす）
  const list = chosen.map((f) => f.properties);
  const sum = (k) => list.reduce((s, p) => s + (p[k] ?? 0), 0);
  $("pop").textContent = sum("population") ? `人口 ${sum("population").toLocaleString("ja-JP")}人・${sum("households").toLocaleString("ja-JP")}世帯` : "人の住んでいない町・字です";
  const rows = [];
  for (const [m, label, w] of TOWN_ROWS) {
    const have = list.filter((p) => p[m] != null && p[w]);
    const weight = have.reduce((s, p) => s + p[w], 0);
    if (!weight) continue;
    const v = have.reduce((s, p) => s + p[m] * p[w], 0) / weight;
    const others = all.map((f) => f.properties[m]).filter((x) => typeof x === "number");
    const place = list.length === 1 ? `${muniName}の ${others.length} の町・字で高いほうから ${others.filter((x) => x > v).length + 1} 番目` : "";
    rows.push(`<li><span class="label">${label}</span><span class="value">${pct(v)}</span>${place ? `<span class="place">${place}</span>` : ""}</li>`);
  }
  $("features").innerHTML = rows.join("");
  $("feature-note").textContent = (list.length > 1 ? "割合は、町・字ごとの割合に人数（世帯の割合は世帯の数）で重みをつけて合わせた、めやすです。" : "")
    + (list.some((p) => p.ageHidden || p.foreignHidden || p.householdHidden) ? "一部の数字は、住む人が少ないため国勢調査で隠されています。" : "");

  await showTypes(code, stats, `いまは${muniName}全体の数字から選んだ候補です。この町・字の深い調べは、町を調べるときに。`);
  showToday(code, centerOf(chosen));
  await showMedical(code, centerOf(chosen));
  await finishPage(code, all, chosen.length === 1 ? chosen[0].properties.part : null, `${muniName}全体についての答えです。`);
  const index = await getJSON("data/towns/index.json");
  sources([`${index.source}（${index.asOf}）`, `${stats.source.name}（${stats.source.asOf}）を加工（届きにくい人の候補）`, WEATHER, MEDICAL, BASEMAP], code);
  drawMap(chosen);
}

async function muniPage(code, stats) {
  const t = stats.towns[code];
  if (!t) return notFound("この市区町村は見つかりませんでした");
  const name = shortName(t.name);
  header(name, `${t.pref}・市区町村コード ${code}`, [["日本", "./"], [t.pref, `./?pref=${encodeURIComponent(t.pref)}`], [name, null]]);
  $("pop").textContent = `人口 ${t.population.toLocaleString("ja-JP")}人`;
  const rows = [
    ["over65Rate", "65歳以上の人の割合"], ["under15Rate", "15歳未満の子どもの割合"], ["foreignRate", "外国の住民の割合"],
    ["changeRate", "1年の人口の増減"], ["socialChangeRate", "引っ越しによる1年の増減"],
  ];
  $("features").innerHTML = rows.map(([m, label]) => {
    const top = t.top[m];
    const place = t.rank[m] <= 10 ? `全国で ${t.rank[m]} 番目に高い` : top <= 50 ? `全国で高いほうから ${Math.max(top, 0.1).toFixed(1)}%` : `全国で低いほうから ${Math.max(100 - top, 0.1).toFixed(1)}%`;
    const v = t[m];
    return `<li><span class="label">${label}</span><span class="value">${/change/i.test(m) && v > 0 ? "+" : ""}${pct(v)}</span><span class="place">${place}</span></li>`;
  }).join("");
  $("feature-note").textContent = `全国の市区町村 ${stats.peers.toLocaleString("ja-JP")} と比べています。`;
  await showTypes(code, stats, "");
  const at = await muniPoint(code);
  showToday(code, at);
  await showMedical(code, null); // 市区町村まるごとは、近い順にしない（真ん中が決められないため）
  const towns = await fetch(`data/towns/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  await finishPage(code, towns ? topojson.feature(towns, towns.objects.towns).features : [], null, "");
  sources([`${stats.source.name}（${stats.source.asOf}。増減は${stats.source.changePeriod}）を加工`, N03, WEATHER, MEDICAL, BASEMAP], code);
  const topo = await getJSON("data/japan.topo.json");
  drawMap(topojson.feature(topo, topo.objects.municipalities).features.filter((f) => f.properties.code === code));
}

const N03 = "国土数値情報（行政区域データ、2026年1月1日）国土交通省 を加工して作成（CC BY 4.0）";
const MEDICAL = "病院・診療所：厚生労働省「医療情報ネット」のオープンデータ（2026年6月1日時点、公共データ利用規約 第1.0版）を加工。祝日：内閣府「国民の祝日」（公共データ利用規約 第1.0版）";
const WEATHER = "今日と明日の天気・警報・注意報・地震：気象庁ホームページ（その場で読む）。気温・湿度・風・日の照る時間：Open-Meteo.com（CC BY 4.0）を加工。洗濯・服装はまちしるべの決まりで出しためやす";
const BASEMAP = "背景の地図：地理院タイル（淡色地図）https://maps.gsi.go.jp/development/ichiran.html";

function header(name, where, path) {
  document.title = `${name}｜まちしるべ`;
  $("name").textContent = name;
  $("where").textContent = where;
  $("path").innerHTML = path.filter(([l]) => l).map(([l, href]) => `<li>${href ? `<a href="${href}">${l}</a>` : `<span>${l}</span>`}</li>`).join("");
}
function sources(list, code) {
  $("sources").innerHTML = list.map((s) => `<li>${s}</li>`).join("");
  // 情報源カード（作者が使ってよいと確かめたサイト）
  if (!code) return;
  // 避難場所のデータ（わが家の避難で使ったもの）
  fetch(`data/shelters/${code}.json`).then((r) => (r.ok ? r.json() : null)).then((d) => d && $("sources").insertAdjacentHTML("beforeend",
    `<li><a href="${esc(d.source.url)}" target="_blank" rel="noopener">${esc(d.source.title)}</a>（${esc(d.source.license)}・${esc(d.source.fetchedAt)} に取得）を加工（わが家の避難）</li>`)).catch(() => {});
  fetch(`data/sources/${code}.json`).then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d?.cards?.length) return;
    $("sources").insertAdjacentHTML("beforeend", d.cards.map((c) =>
      `<li><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a>（情報源カード ${esc(c.id)}・${esc(c.approvedAt.slice(0, 10))} に確かめた・${esc(c.license)}）</li>`).join(""));
  }).catch(() => {});
}
function notFound(text) {
  $("name").textContent = text;
  $("path").innerHTML = `<li><a href="./">日本</a></li>`;
}

// 町の形の小さな地図（見るだけ。動かさない）。背景は地理院の淡色地図
function drawMap(features) {
  const data = { type: "FeatureCollection", features };
  const map = new maplibregl.Map({
    container: "town-map",
    style: {
      version: 8,
      sources: { pale: { type: "raster", tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 18 } },
      layers: [{ id: "pale", type: "raster", source: "pale" }],
    },
    interactive: false,
    attributionControl: false,
  });
  maps.push(map);
  map.on("load", () => {
    map.addSource("town", { type: "geojson", data });
    map.addLayer({ id: "fill", type: "fill", source: "town", paint: { "fill-color": color("--accent"), "fill-opacity": 0.3 } });
    map.addLayer({ id: "line", type: "line", source: "town", paint: { "line-color": color("--accent"), "line-width": 2.5 } });
    const box = new maplibregl.LngLatBounds();
    for (const f of features) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const p of polys) for (const pt of p[0]) box.extend(pt);
    }
    map.fitTo = { box, opts: { padding: 24, maxZoom: 15 } };
    map.fitBounds(box, { padding: 24, duration: 0, maxZoom: 15 });
  });
}
