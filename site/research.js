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
  questions = yard.questions.filter((q) => q.level !== "town"); // 町・字ごとの問いは、町・字を調べるときだけ
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
  if (it.value === "見つからなかった") return "none";
  if (it.status === "ok" || it.status === "auto") return "done";
  if (it.status === "pending") return "pending";
  return "";
}
function renderGrid() {
  const states = questions.map(stateOf);
  $("grid").innerHTML = questions.map((q, i) => `<li class="${states[i]}" title="${esc(q.text)}"><span class="id">${q.id}</span><span class="g">${esc(q.group)}</span></li>`).join("");
  const n = (s) => states.filter((x) => x === s).length;
  $("grid-sum").textContent = `出せる ${n("done")}・確かめ待ち ${n("pending")}・見つからない ${n("none")}・まだ ${n("")}`;
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
