// 調べる画面：research.html?muni=39428
// 手元の画面（npm run serve:research）では「調べ始める」で Claude が物差しの問いを順に調べる。
// 公開のサイトでは、いまの答えの様子（ます目）だけを見せる
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const code = new URLSearchParams(location.search).get("muni");
const hhmm = (iso) => new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

let questions = [];
let items = [];
let run = null;
let local = false;

main();
async function main() {
  const [stats, yard] = await Promise.all([fetch("data/stats.json").then((r) => r.json()), fetch("data/yardstick.json").then((r) => r.json())]);
  questions = yard.questions.filter((q) => q.level !== "town" && (!q.only || q.only === code)); // 町・字ごとの問いは、町・字を調べるときだけ。「この町だけ」の問いはその町だけ
  const t = stats.towns[code];
  if (!t) { $("name").textContent = "町が見つかりません"; return; }
  const name = t.name.replace(/^.+?郡(?=.+[町村]$)/, "");
  document.title = `${name}を調べる｜まちしるべ`;
  $("name").textContent = `${name}を調べる`;
  $("where").textContent = `${t.pref}・市区町村コード ${code}・物差しの問い ${questions.length}（版 ${yard.version}）`;
  $("path").innerHTML = `<li><a href="./">日本</a></li><li><a href="./?pref=${encodeURIComponent(t.pref)}">${esc(t.pref)}</a></li><li><a href="town.html?muni=${code}">${esc(name)}</a></li><li><span>調べる</span></li>`;
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
    items = (await (await fetch("api/review")).json()).items.filter((x) => x.scope === `muni:${code}`);
  } else {
    const ans = await fetch(`data/answers/${code}.json`).then((r) => (r.ok ? r.json() : { answers: [] })).catch(() => ({ answers: [] }));
    const rev = await fetch("data/review.json").then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }));
    items = [...ans.answers, ...rev.items.filter((x) => x.scope === `muni:${code}`)];
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
  const states = questions.map(stateOf);
  $("grid").innerHTML = questions.map((q, i) => `<li class="${states[i]}" title="${esc(q.text)}"><span class="id">${q.id}</span><span class="g">${esc(q.group)}</span>${/^s\d/.test(states[i]) ? `<span class="pt">${states[i].slice(1)}点</span>` : states[i] === "pending" ? `<span class="pt">保留</span>` : ""}</li>`).join("");
  const n = (s) => states.filter((x) => x === s).length;
  const scored = states.filter((x) => /^s\d/.test(x));
  const pass = scored.filter((x) => x >= "s2").length;
  $("grid-sum").textContent = `3点 ${n("s3")}・2点 ${n("s2")}・1点 ${n("s1")}・0点 ${n("s0")}・保留 ${n("pending")}・まだ ${n("")}。合格（2点以上）は 保留を除いた ${scored.length}問のうち ${pass}問`;
}

async function start() {
  $("start").disabled = true;
  const res = await fetch("api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
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

function drawMap() {
  const map = new maplibregl.Map({
    container: "r-map",
    style: {
      version: 8,
      sources: { pale: { type: "raster", tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 18, attribution: "<a href=\"https://maps.gsi.go.jp/development/ichiran.html\" target=\"_blank\">地理院タイル</a>" } },
      layers: [{ id: "pale", type: "raster", source: "pale" }],
    },
    interactive: false,
    attributionControl: { compact: false },
  });
  map.on("load", async () => {
    const topo = await fetch("data/japan.topo.json").then((r) => r.json());
    const features = topojson.feature(topo, topo.objects.municipalities).features.filter((f) => f.properties.code === code);
    map.addSource("town", { type: "geojson", data: { type: "FeatureCollection", features } });
    map.addLayer({ id: "fill", type: "fill", source: "town", paint: { "fill-color": color("--accent"), "fill-opacity": 0.2 } });
    map.addLayer({ id: "line", type: "line", source: "town", paint: { "line-color": color("--accent"), "line-width": 3 } });
    const box = new maplibregl.LngLatBounds();
    for (const f of features) for (const poly of f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) for (const pt of poly[0]) box.extend(pt);
    if (!box.isEmpty()) map.fitBounds(box, { padding: 40, duration: 0 });
  });
}
