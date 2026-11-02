// 調べる画面：research.html?muni=39428、町・字は research.html?muni=11227&part=0130（町・字ごとの問いだけを調べる）
// 手元の画面（npm run serve:research）では「調べ始める」で Claude が物差しの問いを順に調べる。
// 公開のサイトでは、いまの答えの様子（ます目）だけを見せる
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const code = new URLSearchParams(location.search).get("muni");
const part = new URLSearchParams(location.search).get("part");
const scope = part ? `town:${code}-${part}` : `muni:${code}`;
let partFeature = null; // 町・字の形（地図で光らせる）
const hhmm = (iso) => new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

let questions = [];
let items = [];
let run = null;
let local = false;

main();
async function main() {
  const [stats, yard] = await Promise.all([fetch("data/stats.json").then((r) => r.json()), fetch("data/yardstick.json").then((r) => r.json())]);
  // 町・字ごとの問いは、町・字を調べるときだけ。「この町だけ」の問いはその町だけ
  const feats = (await fetch("data/features.json").then((r) => r.json()).catch(() => ({ towns: {} }))).towns[code] ?? [];
  questions = yard.questions.filter((q) => (q.level === "town") === Boolean(part) && (!q.only || q.only === code) && (!q.feature || feats.includes(q.feature)));
  const t = stats.towns[code];
  if (!t) { $("name").textContent = "町が見つかりません"; return; }
  const muniName = t.name.replace(/^.+?郡(?=.+[町村]$)/, "");
  if (part) {
    const topo = await fetch(`data/towns/${code}.json`).then((r) => r.json());
    partFeature = topojson.feature(topo, topo.objects.towns).features.find((f) => f.properties.part === part);
  }
  const name = partFeature ? `${muniName} ${partFeature.properties.name}` : muniName;
  document.title = `${name}を調べる｜まちしるべ`;
  $("name").textContent = `${name}を調べる`;
  $("where").textContent = `${t.pref}・市区町村コード ${code}${part ? `・町・字の番号 ${part}（町・字ごとの問い。市全体の答えは ${muniName}を調べる画面で）` : ""}・物差しの問い ${questions.length}（版 ${yard.version}）`;
  $("path").innerHTML = `<li><a href="./">日本</a></li><li><a href="./?pref=${encodeURIComponent(t.pref)}">${esc(t.pref)}</a></li><li><a href="town.html?muni=${code}">${esc(muniName)}</a></li>${partFeature ? `<li><a href="town.html?town=${code}-${part}">${esc(partFeature.properties.name)}</a></li>` : ""}<li><span>調べる</span></li>`;
  drawMap();

  local = await fetch("api/ping").then((r) => r.ok).catch(() => false);
  if (!local) {
    $("start").disabled = true;
    $("note").textContent = "調べるのは作者の手元の画面だけです。ここでは、いまの答えの様子を見られます。";
    $("review-link").hidden = true;
  } else {
    $("note").textContent = `見込み：問い1つ 約 $0.3・1分。まだ答えの無い問いだけを調べます。1回の調べの上限は $4、1日の上限は $40、合計の上限は $450。`;
  }
  $("start").addEventListener("click", start);
  $("stop").addEventListener("click", () => run && fetch(`api/runs/${run.id}/stop`, { method: "POST" }));
  await loadItems();
  renderGrid();
  await showProposals();
}

// いまの答え（手元なら台帳、公開なら公開の答えと確かめる一覧）
async function loadItems() {
  if (local) {
    items = (await (await fetch("api/review")).json()).items.filter((x) => x.scope === scope);
  } else {
    const ans = await fetch(`data/answers/${part ? `${code}-${part}` : code}.json`).then((r) => (r.ok ? r.json() : { answers: [] })).catch(() => ({ answers: [] }));
    const rev = await fetch("data/review.json").then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }));
    // 確かめる一覧の記録を先に、公開の答え（点数つき）を後に並べる（同じ問いでは後ろのものを使うため）
    items = [...rev.items.filter((x) => x.scope === scope), ...ans.answers];
  }
  $("pending").textContent = items.filter((x) => x.status === "pending").length;
}

function stateOf(q) {
  const its = items.filter((x) => (x.qid ?? "") === q.id || x.question === q.text);
  const it = its.at(-1);
  const doing = run?.status === "running" && run.log.findLast((l) => l.text.includes("調べ始めます"))?.text.includes(q.text);
  if (doing) return "doing";
  if (!it) return "";
  // 点数（0〜3）で濃さを変える。人の判断待ちは点を付けず「保留」
  if (it.status === "pending") return "pending";
  if (it.score != null) return `s${it.score}`;
  return "";
}
function renderGrid() {
  renderGrow();
  updateMap();
  const states = questions.map(stateOf);
  $("grid").innerHTML = questions.map((q, i) => `<li class="${states[i]}" title="${esc(q.text)}"><span class="id">${q.id}</span><span class="g">${esc(q.group)}</span>${/^s\d/.test(states[i]) ? `<span class="pt">${states[i].slice(1)}点</span>` : states[i] === "pending" ? `<span class="pt">保留</span>` : ""}</li>`).join("");
  const n = (s) => states.filter((x) => x === s).length;
  const scored = states.filter((x) => /^s\d/.test(x));
  const pass = scored.filter((x) => x >= "s2").length;
  $("grid-sum").textContent = `3点 ${n("s3")}・2点 ${n("s2")}・1点 ${n("s1")}・0点 ${n("s0")}・保留 ${n("pending")}・まだ ${n("")}。合格（2点以上）は 保留を除いた ${scored.length}問のうち ${pass}問`;
}

async function start() {
  $("start").disabled = true;
  const res = await fetch("api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, part: part ?? undefined }) });
  const body = await res.json();
  if (!res.ok) { $("note").textContent = `始められませんでした：${body.error}`; $("start").disabled = false; return; }
  run = body;
  $("stop").hidden = false;
  poll();
}

// Claude からの提案の帯：物差しにない問い［この町だけ］［ほかの町にも］［今はしない］、調べ方［スキルにする］［今はしない］
async function showProposals() {
  const { proposals } = await fetch(`api/proposals?code=${code}`).then((r) => r.json()).catch(() => ({ proposals: [] }));
  $("proposals").hidden = !proposals.length;
  if (!proposals.length) return;
  $("proposals").innerHTML = `<h2>Claude からの提案</h2>` + proposals.map((p) => p.kind === "question" ? `
    <div class="prop" data-id="${p.id}">
      <p class="what">物差しに無い問い：<strong>${esc(p.text)}</strong></p>
      <p class="why">${esc(p.why ?? "")}${p.reach === "rule" && p.rule ? `（Claude の見立て：${esc(p.rule)}に）` : p.reach === "all" ? "（Claude の見立て：どの町にも）" : ""}</p>
      <div class="decide"><button type="button" data-a="town">この町だけ<small>この町の物差しに足す</small></button>
        <button type="button" class="primary" data-a="all">ほかの町にも<small>どの町にも聞く問いにする</small></button>
        <button type="button" data-a="later">今はしない</button></div>
    </div>` : `
    <div class="prop" data-id="${p.id}">
      <p class="what">この調べ方をスキルにしますか？ <strong>${esc(p.name)}</strong></p>
      <ol class="steps">${(p.steps ?? []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      <p class="why">${esc(p.why ?? "")}（使える問い：${esc((p.forQids ?? []).join("・"))}）</p>
      <div class="decide"><button type="button" class="primary" data-a="skill">スキルにする<small>次の町で同じ問いを調べるときに使う</small></button>
        <button type="button" data-a="later">今はしない</button></div>
    </div>`).join("");
  for (const b of $("proposals").querySelectorAll("button[data-a]")) {
    b.addEventListener("click", async () => {
      const id = b.closest(".prop").dataset.id;
      const res = await fetch(`api/proposals/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: b.dataset.a }) });
      const body = await res.json();
      if (!res.ok) return ($("note").textContent = `できませんでした：${body.error}`);
      $("note").textContent = body.addedAs?.startsWith("Q") ? `物差しに ${body.addedAs} を足しました（${body.status === "all" ? "どの町にも" : "この町だけ"}）。` : body.addedAs ? `スキル ${body.addedAs} にしました。` : "今はしないにしました。";
      if (body.addedAs?.startsWith("Q")) { const yard = await fetch("data/yardstick.json", { cache: "no-store" }).then((r) => r.json()); questions = yard.questions.filter((q) => q.level !== "town" && (!q.only || q.only === code)); renderGrid(); }
      await showProposals();
    });
  }
}

async function poll() {
  run = await (await fetch(`api/runs/${run.id}`)).json();
  $("started").textContent = hhmm(run.startedAt);
  const end = run.endedAt ? new Date(run.endedAt) : new Date();
  const sec = Math.round((end - new Date(run.startedAt)) / 1000);
  $("elapsed").textContent = `${Math.floor(sec / 60)}分${sec % 60}秒`;
  $("usd").textContent = `$${run.usd.toFixed(2)}`;
  $("limit").textContent = `$${run.limit}`;
  $("flow").innerHTML = run.log.map((l) => `<li><time>${hhmm(l.at)}</time><span>${esc(l.text)}</span></li>`).join("");
  $("flow").scrollTop = $("flow").scrollHeight;
  await loadItems();
  renderGrid();
  if (run.status === "running") return setTimeout(poll, 1500);
  $("stop").hidden = true;
  $("start").disabled = false;
  const label = { done: "調べ終わり", stopped: "止めました", failed: "止まりました" }[run.status];
  $("note").textContent = `${label}（確かめ待ち ${$("pending").textContent}件）。見つからなかった問いは、町の人に聞くことの候補です。`;
  await showProposals();
}

// 地図が育つ：町の形から始まり、答えが出るたびに重なっていく（避難場所の答え → 避難場所の点、ハザードマップの答え → 浸水の想定）
let rmap = null;
let mapReady = false; // 重ねる層を全部足し終えたら true
const GROW_LAYERS = [
  { id: "towns", label: "町・字の境", always: true },
  { id: "iryo", label: "病院・診療所（国のデータ）", always: true },
  { id: "shelters", label: "避難場所", qid: "Q01" },
  { id: "hazard", label: "浸水の想定（津波）", qid: "Q02" },
];
function updateMap() {
  if (!mapReady) return;
  const has = (qid) => items.some((x) => x.qid === qid && x.value !== "見つからなかった");
  const shown = GROW_LAYERS.filter((l) => l.always || has(l.qid));
  for (const l of GROW_LAYERS) for (const id of [l.id, `${l.id}-line`]) if (rmap.getLayer(id)) rmap.setLayoutProperty(id, "visibility", shown.includes(l) ? "visible" : "none");
  $("r-layers").innerHTML = shown.map((l) => `<li>${l.qid ? `<span class="new">${esc(l.qid)} の答えから</span>` : ""}${esc(l.label)}</li>`).join("");
}
async function drawMap() {
  const map = (rmap = new maplibregl.Map({
    container: "r-map",
    style: await baseStyle(),
    interactive: false,
    attributionControl: { compact: false },
  }));
  map.on("load", async () => {
    const topo = await fetch("data/japan.topo.json").then((r) => r.json());
    const features = partFeature ? [partFeature] : topojson.feature(topo, topo.objects.municipalities).features.filter((f) => f.properties.code === code);
    map.addSource("town", { type: "geojson", data: { type: "FeatureCollection", features } });
    map.addLayer({ id: "fill", type: "fill", source: "town", paint: { "fill-color": color("--accent"), "fill-opacity": 0.2 } });
    map.addLayer({ id: "line", type: "line", source: "town", paint: { "line-color": color("--accent"), "line-width": 3 } });
    raiseLabels(map); // 地名の文字は町の色の上に
    const box = new maplibregl.LngLatBounds();
    for (const f of features) for (const poly of f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) for (const pt of poly[0]) box.extend(pt);
    if (!box.isEmpty()) map.fitBounds(box, { padding: 40, duration: 0 });
    // 重なっていくもの（はじめは隠しておき、答えが出たら出す）
    const towns = await fetch(`data/towns/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (towns) {
      map.addSource("towns", { type: "geojson", data: topojson.feature(towns, towns.objects.towns) });
      map.addLayer({ id: "towns-line", type: "line", source: "towns", paint: { "line-color": color("--accent"), "line-width": 0.8, "line-opacity": 0.6 } });
    }
    const t = HAZARD_TILES["津波"];
    map.addSource("hazard", { type: "raster", tiles: [t.url], tileSize: 256, minzoom: 2, maxzoom: 17 });
    map.addLayer({ id: "hazard", type: "raster", source: "hazard", paint: { "raster-opacity": 0.6 } });
    const iryo = await fetch(`data/iryo/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (iryo) {
      map.addSource("iryo", { type: "geojson", data: { type: "FeatureCollection", features: iryo.list.filter((f) => f.p).map((f) => ({ type: "Feature", geometry: { type: "Point", coordinates: f.p }, properties: {} })) } });
      map.addLayer({ id: "iryo", type: "circle", source: "iryo", paint: { "circle-radius": 3, "circle-color": "#5b7f95", "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
    }
    const sh = await fetch(`data/shelters/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (sh) {
      map.addSource("shelters", { type: "geojson", data: sh });
      map.addLayer({ id: "shelters", type: "circle", source: "shelters", paint: { "circle-radius": 4, "circle-color": color("--accent"), "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
    }
    mapReady = true;
    updateMap();
  });
}

// 育つ町のページ：町のページの場面ごとに、答えの点数の印を並べる（● 点のある答え・◌ 保留・○ まだ）
const GROW_PAGES = [["bousai", "防災・避難", "shield"], ["gomi", "ごみ", "trash"], ["iryo", "医療・健康", "hospital"], ["koutsuu", "バス・電車", "bus"],
  ["tetsuzuki", "手続き", "doc"], ["foreign", "外国の方へ", "globe"], ["kaigo", "お年寄り・介護", "heart"], ["kosodate", "子育て", "child"], ["shiru", "町を知る", "book"]];
function renderGrow() {
  $("grow").innerHTML = GROW_PAGES.map(([page, label, ic]) => {
    const qs = questions.filter((q) => q.page === page);
    if (!qs.length) return "";
    const marks = qs.map((q) => {
      const it = items.filter((x) => x.qid === q.id).at(-1);
      if (!it) return `<i class="m none" title="${esc(q.short ?? q.id)}：まだ"></i>`;
      if (it.status === "pending") return `<i class="m hold" title="${esc(q.short ?? q.id)}：保留"></i>`;
      return `<i class="m s${it.score ?? 2}" title="${esc(q.short ?? q.id)}：${it.score ?? 2}点"></i>`;
    }).join("");
    const done = qs.filter((q) => items.some((x) => x.qid === q.id && x.status !== "pending")).length;
    return `<li class="${done ? "on" : ""}">${icon(ic)}<span class="l">${esc(label)}</span><span class="ms">${marks}</span><span class="n">${done}/${qs.length}</span></li>`;
  }).join("");
}
