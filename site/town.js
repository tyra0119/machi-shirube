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

// 確かめた答え（site/data/answers/{市区町村コード}.json。OK か自動で承認したものだけ）
async function showAnswers(code, scopeNote) {
  const res = await fetch(`data/answers/${code}.json`).catch(() => null);
  if (!res?.ok) return;
  const { answers } = await res.json();
  if (!answers.length) return;
  answers.sort((x, y) => String(x.qid ?? "").localeCompare(String(y.qid ?? "")));
  $("answers-scope").textContent = scopeNote;
  // 見つからなかった答えも隠さず出す（届いていないことの手がかり。町の人に聞きたいこと）
  const notFound = (a) => a.value === "見つからなかった";
  $("answers").innerHTML = `<ul class="answers">${answers.map((a) => `
    <li class="${notFound(a) ? "not-found" : ""}">
      <p class="q">${esc(a.question)}</p>
      ${notFound(a)
        ? `<p class="a">公開の資料では見つかりませんでした</p><p class="src">${a.checkedAt ? `${esc(a.checkedAt.slice(0, 10))} に調べた・` : ""}町の人に聞きたいことです</p>`
        : `<p class="a">${esc(a.value)}</p>
      <p class="src">出典：${a.source?.url ? `<a href="${esc(a.source.url)}" target="_blank" rel="noopener">${esc(a.source.title ?? a.source.url)}</a>` : esc(a.source?.title ?? "")}${a.source?.where ? `（${esc(a.source.where)}）` : ""}${a.asOf ? `・時点 ${esc(a.asOf)}` : ""}・${a.status === "auto" ? "自動で承認" : "人が確かめた"}</p>`}
    </li>`).join("")}</ul>`;
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// 調べる（手元の画面だけ）。手元のサーバーが Claude を呼び、答えを確かめる一覧に入れる
async function researchBox(code) {
  if (!(await fetch("api/ping").then((r) => r.ok).catch(() => false))) return;
  $("research-block").hidden = false;
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
  map.on("load", () => {
    map.addSource("town", { type: "geojson", data });
    map.addLayer({ id: "fill", type: "fill", source: "town", paint: { "fill-color": color("--accent"), "fill-opacity": 0.3 } });
    map.addLayer({ id: "line", type: "line", source: "town", paint: { "line-color": color("--accent"), "line-width": 2.5 } });
    const box = new maplibregl.LngLatBounds();
    for (const f of features) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const p of polys) for (const pt of p[0]) box.extend(pt);
    }
    map.fitBounds(box, { padding: 24, duration: 0, maxZoom: 15 });
  });
}
