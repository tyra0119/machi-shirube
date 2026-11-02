// 町のページ。どの町も同じ形（町・字1つ・まとまり・市区町村）。
// town.html?town=28109-0990 ／ ?town=28109-0990,0460（複数の町・字）／ ?area=28109-a1（まとまり）／ ?muni=39428
// 調べる機能ができるまでは、国の統計の数字だけを出し、ほかの欄は「まだ調べていません」と正直に出す
const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);

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

// 町のサイトのメニュー：URL の # で、どのページを見せるかを決める（#top・#sonae・#kurashi・#shiru・#source・#research）
const VIEWS = ["top", "sonae", "kurashi", "shiru", "source", "research"];
const maps = []; // 隠れていたページの地図は、見せたときに大きさを合わせ直す
function showView() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "top";
  for (const el of document.querySelectorAll(".view")) el.hidden = el.dataset.view !== v;
  for (const a of document.querySelectorAll(".town-tabs a")) a.toggleAttribute("aria-current", a.dataset.view === v);
  // 隠れていたあいだは大きさが 0 なので、見せたときに大きさを合わせ、覚えておいた範囲に寄せ直す
  for (const m of maps) { m.resize(); if (m.fitTo) m.fitBounds(m.fitTo.box, { ...m.fitTo.opts, duration: 0 }); }
  if (location.hash) window.scrollTo({ top: document.querySelector(".town-tabs").offsetTop - 4 });
}
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
  let kind = "津波";
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
        "circle-color": ["case", ["in", "津波", ["get", "kinds"]], color("--accent"), color("--pref-line")],
        "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5,
      },
    });
    map.addSource("here", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "near-line", type: "line", source: "here", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": color("--text"), "line-width": 2, "line-dasharray": [2, 1.5] } });
    map.addLayer({ id: "here", type: "circle", source: "here", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 8, "circle-color": color("--text"), "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
    const box = new maplibregl.LngLatBounds();
    for (const f of shelters.features) box.extend(f.geometry.coordinates);
    map.fitTo = { box, opts: { padding: 30 } };
    map.fitBounds(box, { padding: 30, duration: 0 });
    if (startPart) { sel.value = startPart; sel.dispatchEvent(new Event("change")); }
  });
  map.on("click", (e) => setHere([e.lngLat.lng, e.lngLat.lat], "地図で選んだ場所"));
  sel.addEventListener("change", () => {
    const f = townFeatures.find((x) => x.properties.part === sel.value);
    if (f) setHere(center(f), `${f.properties.name}（町・字のおおよその真ん中）`);
  });
  for (const b of document.querySelectorAll(".hinan-kind button")) {
    b.addEventListener("click", () => {
      kind = b.dataset.kind;
      document.querySelectorAll(".hinan-kind button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      if (here) setHere(here.at, here.label);
    });
  }
  return true;

  // まっすぐの距離（m）。歩くめやすは 1分 60m（お年寄りの歩く速さのめやす）
  const meters = ([a, b], [c, d]) => {
    const R = 6371000, rad = Math.PI / 180;
    const x = (c - a) * rad * Math.cos(((b + d) / 2) * rad), y = (d - b) * rad;
    return Math.round(Math.sqrt(x * x + y * y) * R);
  };
  function setHere(at, label) {
    here = { at, label };
    const cand = shelters.features.filter((f) => !kind || f.properties.kinds.includes(kind))
      .map((f) => ({ f, m: meters(at, f.geometry.coordinates) })).sort((x, y) => x.m - y.m).slice(0, 3);
    map.getSource("here").setData({ type: "FeatureCollection", features: [
      { type: "Feature", geometry: { type: "Point", coordinates: at }, properties: {} },
      ...cand.map((c) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [at, c.f.geometry.coordinates] }, properties: {} })),
    ] });
    const box = new maplibregl.LngLatBounds(at, at);
    for (const c of cand) box.extend(c.f.geometry.coordinates);
    map.fitTo = { box, opts: { padding: 50, maxZoom: 16 } };
    map.fitBounds(box, { padding: 50, maxZoom: 16, duration: 500 });
    $("hinan-list").innerHTML = cand.map((c) => `
      <li><span class="n">${esc(c.f.properties.name)}</span>
        <span class="d">まっすぐ ${c.m.toLocaleString("ja-JP")}m・歩いて約 ${Math.max(1, Math.round(c.m / 60))}分（めやす）</span>
        <span class="k">${esc(c.f.properties.address ?? "")}・${esc(c.f.properties.kinds.join("・"))}${c.f.properties.capacity ? `・${esc(c.f.properties.capacity)}` : ""}</span></li>`).join("");
    $("hinan-note").innerHTML = `${esc(label)}から、${kind ? "津波のときに使える" : ""}避難場所の近い順。距離はまっすぐ測ったもので、坂や道の曲がりは考えていません。歩く時間は1分60mのめやすです。避難の判断は町の案内に従ってください。<br>出典：${esc(shelters.source.title)}（${esc(shelters.source.license)}・${esc(shelters.source.fetchedAt)} に取得）`;
  }
}

// 確かめた答え（site/data/answers/{市区町村コード}.json。OK か自動で承認したものだけ）
// 物差しの問いのまとまり → 町のページのどのページに出すか
const GROUP_VIEW = { 備え: "sonae", 暮らしの基本: "kurashi", 届け方: "kurashi", 町を知る: "shiru" };
const viewOfAnswer = (a, yard) => GROUP_VIEW[yard.questions.find((x) => x.id === a.qid)?.group] ?? "shiru";
const answerCounts = { sonae: 0, kurashi: 0, shiru: 0 };
let shownAnswers = [];
let yardstick = { questions: [] };
async function showAnswers(code, scopeNote) {
  const res = await fetch(`data/answers/${code}.json`).catch(() => null);
  const answers = res?.ok ? (await res.json()).answers : [];
  const yard = await fetch("data/yardstick.json").then((r) => r.json()).catch(() => ({ questions: [] }));
  shownAnswers = answers;
  yardstick = yard;
  const viewOf = (a) => viewOfAnswer(a, yard);
  answers.sort((x, y) => String(x.qid ?? "").localeCompare(String(y.qid ?? "")));
  for (const el of document.querySelectorAll(".answers-scope")) el.textContent = scopeNote;
  for (const v of Object.keys(answerCounts)) {
    const list = answers.filter((a) => viewOf(a) === v);
    answerCounts[v] = list.length;
    $(`answers-${v}`).innerHTML = list.length ? answersHTML(list)
      : `<p class="note">まだありません。町を調べて、人が確かめた（または自動で承認した）答えがここに出ます。</p>`;
  }
}
function answersHTML(answers) {
  // 見つからなかった答えも隠さず出す（届いていないことの手がかり。町の人に聞きたいこと）
  const notFound = (a) => a.value === "見つからなかった";
  return `<ul class="answers">${answers.map((a) => `
    <li class="${notFound(a) ? "not-found" : ""}" id="a-${esc(a.qid ?? "")}">
      <h3 class="short">${esc(yardstick.questions.find((x) => x.id === a.qid)?.short ?? "")}</h3>
      <p class="q">${esc(a.question)}</p>
      ${notFound(a)
        ? `<p class="a">公開の資料では見つかりませんでした</p><p class="src">${a.checkedAt ? `${esc(a.checkedAt.slice(0, 10))} に調べた・` : ""}町の人に聞きたいことです</p>`
        : `<p class="a">${esc(a.value)}</p>
      <p class="src">出典：${a.source?.url ? `<a href="${esc(a.source.url)}" target="_blank" rel="noopener">${esc(a.source.title ?? a.source.url)}</a>` : esc(a.source?.title ?? "")}${a.source?.where ? `（${esc(a.source.where)}）` : ""}${a.asOf ? `・時点 ${esc(a.asOf)}` : ""}・${a.status === "auto" ? "自動で承認" : "人が確かめた"}</p>`}
    </li>`).join("")}</ul>`;
}

// すべてのページ：町のサイトの全部のページと中身を一覧にして、押すとそこへ飛ぶ（中を探すこともできる）
let allPages = [];
function buildAllPages(hasHinan, answers, yard, local) {
  const shortOf = (a) => yard.questions.find((x) => x.id === a.qid)?.short ?? a.question.slice(0, 16);
  const items = (v) => answers.filter((a) => viewOfAnswer(a, yard) === v).map((a) => ({ label: shortOf(a), view: v, target: `a-${a.qid}` }));
  allPages = [
    { title: "トップ", view: "top", desc: "町の形・この町のページ・町の特色・届きにくい人", items: [
      { label: "町の特色（全国と比べた数字）", view: "top", target: "sec-features" },
      { label: "この町で、暮らしの情報が届きにくいのは", view: "top", target: "sec-types" },
    ] },
    { title: "備え", view: "sonae", desc: "避難と防災", items: [
      ...(hasHinan ? [{ label: "わが家の避難（近い避難場所）", view: "sonae", target: "hinan-block" }] : []),
      ...items("sonae"),
    ] },
    { title: "暮らし", view: "kurashi", desc: "毎日の暮らしの入口", items: items("kurashi") },
    { title: "町を知る", view: "shiru", desc: "町のなりたちと、いま動いていること", items: items("shiru") },
    { title: "出典", view: "source", desc: "このページの数字の出どころと、しくみ", items: [] },
    ...(local ? [{ title: "調べる（手元の画面だけ）", view: "research", desc: "Claude にこの町を調べてもらう", items: [] }] : []),
  ];
}
function renderAllPages(filter = "") {
  const f = filter.replace(/\s/g, "");
  const hit = (s) => !f || s.replace(/\s/g, "").includes(f);
  $("all-list").innerHTML = allPages.map((p) => {
    const its = p.items.filter((i) => hit(i.label) || hit(p.title));
    if (f && !its.length && !hit(p.title) && !hit(p.desc)) return "";
    return `<section class="all-sec">
      <a class="all-page" href="#${p.view}" data-view="${p.view}"><span class="t">${esc(p.title)}</span><span class="d">${esc(p.desc)}</span></a>
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

// トップの「この町のページ」：各ページへの入口と、短い要約
function goCards(hasHinan) {
  fetch("api/ping").then((r) => r.ok).catch(() => false).then((local) => buildAllPages(hasHinan, shownAnswers, yardstick, local));
  const n = (v) => (answerCounts[v] ? `確かめた答え ${answerCounts[v]}` : "まだ調べていません");
  const cards = [
    ["sonae", "備え", `${hasHinan ? "わが家の避難（近い避難場所）・" : ""}${n("sonae")}`],
    ["kurashi", "暮らし", `ごみ・手続き・交通・外国の人向けの案内。${n("kurashi")}`],
    ["shiru", "町を知る", `町のなりたち・催し。${n("shiru")}`],
    ["source", "出典", "このページの数字の出どころと、しくみ"],
  ];
  $("go-cards").innerHTML = cards.map(([v, t, d]) => `<li><a href="#${v}"><span class="t">${t}</span><span class="d">${esc(d)}</span></a></li>`).join("");
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// 調べる（手元の画面だけ）。手元のサーバーが Claude を呼び、答えを確かめる一覧に入れる
async function researchBox(code) {
  if (!(await fetch("api/ping").then((r) => r.ok).catch(() => false))) return;
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
  await showAnswers(code, `${muniName}全体についての答えです。`);
  goCards(await showHinan(code, all, chosen.length === 1 ? chosen[0].properties.part : null));
  await researchBox(code);
  const index = await getJSON("data/towns/index.json");
  sources([`${index.source}（${index.asOf}）`, `${stats.source.name}（${stats.source.asOf}）を加工（届きにくい人の候補）`, BASEMAP], code);
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
  await showAnswers(code, "");
  const towns = await fetch(`data/towns/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  goCards(await showHinan(code, towns ? topojson.feature(towns, towns.objects.towns).features : [], null));
  await researchBox(code);
  sources([`${stats.source.name}（${stats.source.asOf}。増減は${stats.source.changePeriod}）を加工`, N03, BASEMAP], code);
  const topo = await getJSON("data/japan.topo.json");
  drawMap(topojson.feature(topo, topo.objects.municipalities).features.filter((f) => f.properties.code === code));
}

const N03 = "国土数値情報（行政区域データ、2026年1月1日）国土交通省 を加工して作成（CC BY 4.0）";
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
