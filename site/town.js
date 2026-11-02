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
  { view: "chizu", title: "地図", desc: "避難場所・病院・浸水の想定・雨雲などを重ねて見る", tab: true },
  { view: "bousai", title: "防災・避難", desc: "わが家の避難・避難場所・災害のときの行動", tab: true, later: "災害のときにどう動くか（町の防災の手引き）" },
  { view: "gomi", title: "ごみ", desc: "収集日・このごみは何ごみか", tab: true, later: "収集日のカレンダーと、このごみは何ごみかを引ける表" },
  { view: "iryo", title: "医療・健康", desc: "今日やっている病院・夜間と休日の窓口", tab: true, later: "夜間・休日に困ったときの窓口（休日の当番医・子どもの急病の相談など）" },
  { view: "komatta", title: "困ったとき", desc: "どこに電話・メールすればよいか", tab: true, later: "困りごとごとの、電話・メールの窓口" },
  { view: "kosodate", title: "子育て", desc: "子育ての窓口・手当", later: "子育ての窓口と、手当・助成" },
  { view: "kaigo", title: "お年寄り・介護", desc: "介護の窓口・見守り", later: "介護の相談の窓口と、見守り・配食などの助け" },
  { view: "koutsuu", title: "交通と道の安全", desc: "バス・電車・事故が重なる所", later: "コミュニティバスや電車の時刻・乗り場" },
  { view: "tetsuzuki", title: "手続き", desc: "引っ越し・住民票など", later: "引っ越しや住民票などの手続きの窓口" },
  { view: "foreign", title: "外国の方へ", desc: "やさしい日本語・母語の案内", later: "やさしい日本語や母語での案内" },
  { view: "okane", title: "お金・補助金", desc: "補助金・給付・ガソリンなど", later: "いま申し込める補助金・給付と、締め切り" },
  { view: "shisetsu", title: "公園・図書館", desc: "近くの施設", later: "公園・図書館などの場所と開いている時間" },
  { view: "keikaku", title: "町の計画と話題", desc: "町が何をしようとしているか・いま動いていること", tab: true, later: "町の大きな計画と、いま動いている話題" },
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
function renderTabs() {
  $("tabs").innerHTML = `<li class="all-pages"><button type="button" id="open-all" aria-haspopup="dialog">☰ ${T("すべてのページ")}</button></li>`
    + PAGES.filter((p) => p.tab || p.local).map((p) =>
    `<li${p.local ? " class=\"local-only\" hidden" : ""}><a href="#${p.view}" data-view="${p.view}">${icon(ILLUST[p.view]?.main)}${esc(p.local ? T("調べる") : T(p.title))}</a></li>`).join("");
}
renderTabs();
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
  // 町のページのいちばん上に：この町で届きにくい人と、その人のためのページ
  const list = typeCandidates(t, f, stats.summary);
  const sh = await fetch(`data/shelters/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const tsunami = sh?.features.filter((x) => x.properties.kinds.includes("津波")).length ?? 0;
  const fp = (await floodPop(code))?.kinds ?? {};
  const n = (v) => v.toLocaleString("ja-JP");
  if ((fp.津波 || tsunami) && t.over65Rate >= stats.summary.over65Rate.top10) {
    list.unshift({ type: "お年寄り × 津波", who: "津波から坂を上って逃げる、足の弱いお年寄り", reason: fp.津波
      ? `65歳以上が ${t.over65Rate.toFixed(1)}%（全国の上から10%に入る）。津波で浸かる想定の所に、約 ${n(fp.津波.people)} 人（町の ${fp.津波.rate}%）が住み、うち65歳以上が約 ${n(fp.津波.over65)} 人（めやす）`
      : `65歳以上が ${t.over65Rate.toFixed(1)}%（全国の上から10%に入る）で、津波の避難場所が ${tsunami} か所ある町` });
  }
  const lang = list.find((c) => c.type === "母語で防災");
  if (lang && fp.洪水) lang.reason += `。洪水で浸かる想定の所に、町の人の約 ${fp.洪水.rate}% が住む（めやす）`;
  if (!list.length) return;
  // ほかの言葉では、理由の文の代わりに、数字を見出しつきで並べる
  const pc = (v) => `${v.toFixed(1)}%`;
  const FACTS = {
    "お年寄り × 津波": [["65歳以上の人の割合", pc(t.over65Rate)], ...(fp.津波 ? [["津波で浸かる想定の所に住む人", `${fp.津波.rate}%`]] : [])],
    "母語で防災": [["外国の住民の割合", pc(t.foreignRate)], ...(fp.洪水 ? [["洪水で浸かる想定の所に住む人", `${fp.洪水.rate}%`]] : [])],
    "はじめての町": [["引っ越しによる1年の増減", `${t.socialChangeRate > 0 ? "+" : ""}${pc(t.socialChangeRate)}`], ["65歳以上の人の割合", pc(t.over65Rate)]],
    "人が減る町の暮らし": [["1年の人口の増減", pc(t.changeRate)], ["65歳以上の人の割合", pc(t.over65Rate)]],
    "一人暮らしのお年寄り": t.elderlySingleRate != null ? [["65歳以上の一人暮らしの世帯", pc(t.elderlySingleRate)]] : [],
  };
  const reasonOf = (c) => (LANG ? (FACTS[c.type] ?? []).map(([l, v]) => `${T(l)} ${v}`).join(" · ") : c.reason);
  const page = (type) => { const v = TYPE_PAGE[type], f = v?.startsWith("feat-") && FEATURES[v.slice(5)]; return PAGES.find((p) => p.view === v) ?? (f ? { view: v, title: f.title } : null); };
  $("mitate-top").hidden = false;
  // Claude の見立て（scripts/mitate.mjs）があれば、それを出す（日本語とやさしい日本語のとき。ほかの言葉は下の決まりによる見立て）
  const cm = !LANG || LANG === "easy" ? await fetch(`data/mitate/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
  if (cm?.who?.length) {
    const pg = (v) => PAGES.find((p) => p.view === v);
    $("mitate-top").innerHTML = `<h2>${T("この町で、暮らしの情報が届きにくいのは")}</h2>
      <ul class="mitate-list">${cm.who.map((w) => { const p = pg(w.page); return `<li><strong>${esc(w.person)}</strong><span class="wall">${icon("alert")} ${esc(w.wall)}</span><span class="why">${esc(w.why)}</span>${p ? `<a class="go" href="#${p.view}">${icon(ILLUST[p.view]?.main ?? "map")}${esc(p.title)}へ</a>` : ""}</li>`; }).join("")}</ul>
      <p class="note">${esc(cm.note)}。<a href="#mitate">${T("くわしく")}</a></p>`;
    return;
  }
  $("mitate-top").innerHTML = `<h2>${T("この町で、暮らしの情報が届きにくいのは")}</h2>
    <ul class="mitate-list">${list.slice(0, 2).map((c) => { const p = page(c.type); return `<li><strong>${esc(T(c.who))}</strong><span class="why">${esc(reasonOf(c))}</span>${p ? `<a class="go" href="#${p.view}">${icon(ILLUST[p.view]?.main ?? "map")}${LANG ? esc(T(p.title)) : `${esc(p.title)}へ`}</a>` : ""}</li>`; }).join("")}</ul>
    <p class="note">${T("全国の市区町村と国の数字で比べた、まちしるべの見立てです（町の評価ではありません）。")} <a href="#mitate">${T("くわしく")}</a></p>`;
}
// 浸水が想定される所に住む人（めやす。scripts/build-flood-pop.mjs が作る）
let floodPopCache;
function floodPop(code) {
  return (floodPopCache ??= fetch(`data/flood-pop/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
}
async function showFloodPop(code, part) {
  const d = await floodPop(code);
  const kinds = Object.entries(d?.kinds ?? {});
  if (!kinds.length) return;
  const n = (v) => v.toLocaleString("ja-JP");
  $("floodpop-block").hidden = false;
  $("floodpop").innerHTML = kinds.map(([kind, k]) => {
    const max = Math.max(...Object.values(k.byDepth));
    const here = part && k.parts[part.properties.part];
    return `<div class="fp-kind">
      <h3 class="sub">${esc(T(kind === "土砂" ? "土砂災害警戒区域" : kind))}</h3>
      <p class="fp-head"><strong>${T("約")} ${n(k.people)} ${T("人")}</strong>（${T("町の人の")} ${k.rate}%）${k.over65 ? `<span>${T("うち65歳以上")} ${T("約")} ${n(k.over65)} ${T("人")}</span>` : ""}</p>
      ${part ? `<p class="fp-here">${esc(part.properties.name)}：${here ? `${T("約")} ${here.rate}%（${T("約")} ${n(here.people)} ${T("人")}）` : T("想定の区域に住む人は、ほとんどいません")}</p>` : ""}
      <ul class="fp-depth">${Object.entries(k.byDepth).map(([label, v]) => `<li><span class="l">${esc(label)}</span><span class="bar"><i style="width:${(v / max) * 100}%;background:${depthColor(label)}"></i></span><span class="v">${n(v)}</span></li>`).join("")}</ul>
    </div>`;
  }).join("");
  $("floodpop-note").innerHTML = `${esc(T(d.note))}。${T("想定は最大の規模のもので、必ずこうなるという意味ではありません。")}${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("・")}`;
}
const depthColor = (label) => { const c = DEPTH_COLORS.find(([, l]) => l === label)?.[0] ?? (label === "警戒区域" ? [214, 170, 110] : [200, 200, 200]); return `rgb(${c.join(",")})`; };

// 防災計画の、町・字に関係する所（scripts/plan-excerpts.mjs。Claude が引用つきで抜き出し、人が確かめてから出す）
async function showPlan(code, part) {
  const d = await fetch(`data/plan/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!d) return;
  $("plan-block").hidden = false;
  const src = d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("・");
  if (d.status !== "ok" && d.status !== "auto") {
    $("plan-pick").hidden = true;
    $("plan").innerHTML = `<p class="gomi-today">${icon("eye")} ${T("防災計画から町・字ごとに抜き出したものを、いま人が確かめています（元のページと合っているか）。それまでは町の防災計画をご覧ください。")}</p>`;
    $("plan-note").innerHTML = src;
    return;
  }
  const keys = Object.keys(d.parts);
  const sel = $("plan-part");
  $("plan-pick").hidden = false;
  sel.innerHTML = keys.map((k) => `<option value="${k}">${esc(d.parts[k].name)}（${d.parts[k].points.length}）</option>`).join("");
  if (part && d.parts[part.properties.part]) { sel.value = part.properties.part; $("plan-pick").hidden = true; }
  const draw = () => {
    const p = d.parts[sel.value];
    $("plan").innerHTML = p ? `<ol class="plan-points">${p.points.map((x) => `<li><p>${esc(x.text)}</p>${x.cites.map((c) => `<a class="cite" href="${esc(c.url)}#page=${c.page}" target="_blank" rel="noopener" title="${esc(c.quote)}">${esc(c.doc.replace(/^.*?（.*?）/, ""))} ${c.page}${T("ページ")}</a>`).join("")}</li>`).join("")}</ol>`
      : `<p>${T("この町・字の名前が出てくる所は、防災計画に見つかりませんでした。")}</p>`;
  };
  sel.addEventListener("change", draw);
  draw();
  $("plan-note").innerHTML = `${esc(T(d.note))}。${src}`;
}

// 大きな地震の揺れの確率（J-SHIS × 250m 四方の人口。scripts/build-quake-pop.mjs が作る）
async function showQuake(code, part) {
  const d = await fetch(`data/quake-pop/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!d) return;
  $("quake-block").hidden = false;
  const n = (v) => v.toLocaleString("ja-JP");
  const here = part && d.parts[part.properties.part];
  const max = Math.max(...Object.values(d.bands));
  $("quake").innerHTML = `<ul class="acc-stats">
      <li><span class="l">${T("震度6弱以上")}</span><strong>${d.p55}%</strong><span class="s">${T("町の中で")} ${d.min55}〜${d.max55}%</span></li>
      <li><span class="l">${T("震度6強以上")}</span><strong>${d.p60}%</strong><span class="s">${T("住む人で重みをつけた平均")}</span></li>
      ${here ? `<li><span class="l">${esc(here.name)}</span><strong>${here.p55}%</strong><span class="s">${T("震度6強以上")} ${here.p60}%</span></li>` : ""}
    </ul>
    <h3 class="sub">${T("震度6弱以上の確率の高さごとの、住む人")}</h3>
    <ul class="fp-depth q">${Object.entries(d.bands).map(([l, v]) => `<li><span class="l">${esc(T(l))}</span><span class="bar"><i style="width:${(v / max) * 100}%"></i></span><span class="v">${n(v)}</span></li>`).join("")}</ul>`;
  $("quake-note").innerHTML = `${esc(T(d.note))}。${T("確率 26% はおよそ100年に1回、6% はおよそ500年に1回、3% はおよそ1000年に1回の揺れにあたります。")}${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("・")}`;
}

// 買い物に困っているお年寄り（農林水産政策研究所の推計を引用。scripts/build-shop-access.mjs）
async function showShopAccess(code) {
  const d = await fetch(`data/shop-access/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!d) return;
  $("shop-block").hidden = false;
  const n = (v) => v.toLocaleString("ja-JP");
  const cmp = (v, nat) => (v > nat + 1 ? T("全国より高い") : v < nat - 1 ? T("全国より低い") : T("全国と同じくらい"));
  $("shop").innerHTML = `<ul class="acc-stats">
      <li><span class="l">${T("65歳以上")}</span><strong>${d.rate}%</strong><span class="s">${T("約")} ${n(d.people)} ${T("人")}・${T("全国")} ${d.nationRate}%（${cmp(d.rate, d.nationRate)}）</span></li>
      <li><span class="l">${T("75歳以上")}</span><strong>${d.rate75}%</strong><span class="s">${T("約")} ${n(d.over75)} ${T("人")}・${T("全国")} ${d.nationRate75}%（${cmp(d.rate75, d.nationRate75)}）</span></li>
    </ul>
    <p class="fp-here">${T("店まで 500m 以上あり、車を使うのが難しい65歳以上の人の割合です（2020年の推計）。")}</p>`;
  $("shop-note").innerHTML = `${esc(T(d.note))}。${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("")}`;
}

// これからの町の人口（社人研の推計。scripts/build-future.mjs）。政令市の区はその区、町・字のページは市区町村の数
async function showFuture(code) {
  const d = await getJSON("data/future.json").catch(() => null);
  const t = d?.towns[code];
  if (!t) return;
  $("future-block").hidden = false;
  const n = (v) => v.toLocaleString("ja-JP");
  const idx = (p) => Math.round((p.at(-1) / p[0]) * 100);
  const max = Math.max(...t.pop);
  // 明るい話題：2050年まで人口が減りにくい町（全国の上から1割）は、それを添える。町に順位は付けない（「上から ○%」と言う）
  const ratio = (p) => p.at(-1) / p[0];
  const rank = Object.values(d.towns).filter((x) => ratio(x.pop) > ratio(t.pop)).length + 1;
  const total = Object.keys(d.towns).length;
  const bright = rank <= total / 10 ? `<span class="bright">${icon("sun")} ${ratio(t.pop) > 1 ? T("2050年まで人口が増えると推計される町です。") : ""}${T("人口の減りにくさは、全国の市区町村の上から")} ${Math.max(1, Math.ceil((rank / total) * 100))}% ${T("に入ります")}</span>` : "";
  $("future-head").innerHTML = `${T("2050年の人口は、2020年の")} <strong>${idx(t.pop)}%</strong>（${T("約")} ${n(Math.round(t.pop.at(-1) / 10) * 10)} ${T("人")}）<span>${T("全国")} ${idx(d.nation.pop)}%${t.old ? `・${T("65歳以上の割合")} ${t.old[0]}% → ${t.old.at(-1)}%（${T("全国")} ${d.nation.old.at(-1)}%）` : ""}</span>${bright}`;
  $("future").innerHTML = d.years.map((y, i) => `<li><span class="y">${y}</span><span class="bar"><i style="height:${(t.pop[i] / max) * 100}%"></i></span><span class="v">${n(Math.round(t.pop[i] / 100) * 100)}</span>${t.old ? `<span class="o">${t.old[i]}%</span>` : ""}</li>`).join("");
  $("future-note").innerHTML = `${T("棒は総人口、下の % は65歳以上の割合です。")}${esc(T(d.note))}。<a href="${esc(d.source.url)}" target="_blank" rel="noopener">${esc(d.source.title)}</a>`;
}

// バスの便利さ（公開されている時刻表データ × 250m 四方の65歳以上。scripts/build-bus.mjs）
async function showBus(code, part) {
  const d = await fetch(`data/bus/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!d) return;
  $("bus-block").hidden = false;
  const n = (v) => v.toLocaleString("ja-JP");
  const here = part && d.parts[part.properties.part];
  $("bus-stats").innerHTML = [
    [T("町とその近くの、平日に便のあるバス停"), `${d.stops.length}`, d.routes.map((r) => esc(T(r))).join("・")],
    [T("バス停まで 500m 以上の所に住む65歳以上"), `${d.farRate}%`, `${T("約")} ${n(d.far)} ${T("人")}`],
    [T("近いバス停が1日10本未満の所に住む65歳以上"), `${d.fewRate}%`, `${T("約")} ${n(d.few)} ${T("人")}`],
    ...(here ? [[esc(here.name), `${here.farRate}%`, `${T("バス停まで 500m 以上")}・${T("1日10本未満")} ${here.fewRate}%`]] : []),
  ].map(([l, v, s]) => `<li><span class="l">${l}</span><strong>${v}</strong><span class="s">${s}</span></li>`).join("");
  $("bus-stops").innerHTML = d.stops.slice(0, 8).map((s) => `<li><span class="no">${s.n}</span><span>${esc(s.name)}</span></li>`).join("");
  $("bus-note").innerHTML = `${esc(T(d.note))}。${T("丸の中の数は、平日1日に出る便の数です。")}${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("・")}`;
}

// 道の安全（交通事故。scripts/build-accidents.mjs が警察庁のオープンデータから作る）
async function showAccidents(code, part) {
  const d = await fetch(`data/accidents/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!d?.total) return;
  $("acc-block").hidden = false;
  const n = (v) => v.toLocaleString("ja-JP");
  const yrs = `${d.years[0]}〜${d.years.at(-1)}${T("年")}`;
  const here = part && d.parts[part.properties.part];
  $("acc-stats").innerHTML = [
    [T("人身事故"), `${n(d.total)} ${T("件")}`, `${yrs}・${T("死亡事故")} ${d.dead}`],
    [T("町の人1000人あたり（1年）"), `${d.per1000} ${T("件")}`, `${T("全国")} ${d.nationPer1000} ${T("件")}`],
    [T("歩行者が関わる事故"), `${n(d.ped)} ${T("件")}`, `${T("うち65歳以上の歩行者")} ${d.oldPed}`],
    [T("自転車が関わる事故"), `${n(d.bike)} ${T("件")}`, `${Math.round((d.bike / d.total) * 100)}%`],
    ...(here ? [[esc(part.properties.name), `${here.n} ${T("件")}`, `${T("歩行者が関わる事故")} ${here.ped}`]] : []),
  ].map(([l, v, s]) => `<li><span class="l">${l}</span><strong>${v}</strong><span class="s">${s}</span></li>`).join("");
  $("acc-spots-head").hidden = $("acc-map").hidden = !d.spots.length;
  $("acc-spots").innerHTML = d.spots.map((s, i) => `<li data-i="${i}"><span class="no">${i + 1}</span><span><strong>${esc(s.part)}</strong> ${s.n} ${T("件")}${s.ped ? `・${T("歩行者")} ${s.ped}` : ""}${s.bike ? `・${T("自転車")} ${s.bike}` : ""}${s.dead ? `・${T("死亡")} ${s.dead}` : ""}</span></li>`).join("");
  $("acc-note").innerHTML = `${esc(T(d.note))}。${T("町の外から通る車の事故も入るので、人の数で割った値はめやすです。")}${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("")}`;
  if (!d.spots.length) return;
  const map = new maplibregl.Map({
    container: "acc-map",
    style: await baseStyle(),
    attributionControl: false,
  });
  maps.push(map);
  map.addControl(new MapButtons({}), "bottom-right");
  // 番号つきの丸（大きさは件数）。背景の地図は文字の部品を持たないので、印は HTML で置く
  d.spots.forEach((s, i) => {
    const el = document.createElement("div");
    el.className = "acc-pin";
    el.textContent = String(i + 1);
    el.style.setProperty("--s", `${18 + Math.min(s.n, 12) * 1.5}px`);
    new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map);
  });
  map.on("load", () => {
    const lons = d.spots.map((s) => s.lon), lats = d.spots.map((s) => s.lat);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 40, maxZoom: 15, duration: 0 });
  });
  $("acc-spots").addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (li) { const s = d.spots[Number(li.dataset.i)]; map.flyTo({ center: [s.lon, s.lat], zoom: 16 }); $("acc-map").scrollIntoView({ behavior: "smooth", block: "center" }); }
  });
}

// 届きにくい人の型 → その人のためのページ
const TYPE_PAGE = {
  "お年寄り × 津波": "bousai", "母語で防災": "bousai", "はじめての町": "tetsuzuki", "人が減る町の暮らし": "kaigo",
  "一人暮らしのお年寄り": "kaigo", "雪の暮らし": "feat-yuki", "火山と暮らす": "feat-kazan", "島の暮らし": "feat-shima",
};

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
    `<button type="button" data-kind="${k}" aria-pressed="${k === kind}">${k ? T(k) : T("すべて")}<small>${k ? count(k) : shelters.features.length}</small></button>`).join("");
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
    style: await baseStyle(),
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
  // ほかの言葉のときは、訳があり確かめられた答えをその言葉で出す（無いものは日本語のまま）
  if (LANG) {
    const tr = await fetch(`data/translations/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    for (const a of answers) {
      const x = tr?.langs?.[LANG]?.items.find((i) => i.qid === a.qid && (i.status === "auto" || i.status === "ok") && i.original === a.value);
      if (x) Object.assign(a, { valueJa: a.value, value: x.text, translated: true, shortT: x.short });
    }
  }
  yardstick = await fetch("data/yardstick.json").then((r) => r.json()).catch(() => ({ questions: [] }));
  health = await fetch("data/health.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  answers.sort((x, y) => Boolean(y.level) - Boolean(x.level) || String(x.qid ?? "").localeCompare(String(y.qid ?? "")));
  answersByPage = {};
  for (const a of answers) {
    const page = yardstick.questions.find((x) => x.id === a.qid)?.page ?? "shiru";
    (answersByPage[page] ??= []).push(a);
  }
  for (const box of document.querySelectorAll(".answers-box")) {
    const list = answersByPage[box.dataset.page] ?? [];
    const p = PAGES.find((x) => x.view === box.dataset.page);
    // 場面の帯：イラストと、この場面で分かること
    box.innerHTML = (p ? `<div class="page-banner" style="--h:${ILLUST[p.view]?.h ?? 200}">${illust(p.view)}<p><strong>${esc(T(p.title))}</strong>${esc(T(p.desc))}${list.length ? `<span>${T("Claude が公式のサイトから確かめた答え")} ${list.length}</span>` : ""}</p></div>` : "")
      + (list.length && scopeNote && !list.some((a) => a.level) ? `<p class="note">${esc(scopeNote)}</p>` : "")
      + (list.length ? answersHTML(list) : "")
      + (p?.later && !list.length ? `<p class="later"><span>${T("準備中")}</span>${LANG ? `${esc(T(p.later))} — ${T("Claude が町の公式のサイトから探して、出典つきでここに出します。")}` : `${esc(p.later)}を、Claude が町の公式のサイトから探して、出典つきでここに出します。`}</p>` : "")
      + (!list.length && !p?.later ? `<p class="note">まだありません。</p>` : "");
  }
}
// 答えのカード：左に問いごとの絵、はじめの1文を要点として大きく、残りは箇条に。数（327 か所など）は目立たせる。出典は小さな札に
const ANSWER_ICON = {
  Q01: "pin", Q02: "map", Q03: "book", Q04: "speaker", Q05: "trash", Q06: "doc", Q07: "bus", Q08: "globe", Q09: "book",
  Q10: "calendar", Q11: "tree", Q12: "alert", Q13: "pin", T01: "trash", T02: "school", T03: "child", T04: "pin",
};
const PAGE_OF = (qid) => yardstick.questions.find((x) => x.id === qid)?.page;
// 数と単位を太く（中身は変えない）
// 時刻（8時30分・9:00）や電話番号の中の数は太くしない（前が「時」「:」「-」や数のときは除く）
const numbers = (html) => html.replace(/(?<![0-9０-９時:：\-－])([0-9０-９][0-9０-９,，.]*)(\s*)(か所|ヶ所|カ所|件|人|世帯|分|時間|m|km|メートル|校|台|便|回|%|％)/g, '<b class="num">$1$2$3</b>');
function answerBody(a) {
  const lines = prettyText(a.value, esc).split("<br>").filter(Boolean);
  const [lead, ...rest] = lines;
  return `<p class="lead">${numbers(lead ?? "")}</p>${rest.length ? `<ul class="pts">${rest.map((l) => `<li>${numbers(l)}</li>`).join("")}</ul>` : ""}`;
}
function answersHTML(answers) {
  // 見つからなかった答えも隠さず出す（届いていないことの手がかり。町の人に聞きたいこと）
  const notFound = (a) => a.value === "見つからなかった";
  return `<ul class="answers">${answers.map((a) => {
    const ill = ILLUST[PAGE_OF(a.qid)] ?? ILLUST.shiru;
    return `
    <li class="${notFound(a) ? "not-found" : ""}" id="a-${esc(a.qid ?? "")}" style="--h:${ill.h}">
      <span class="badge" aria-hidden="true">${icon(ANSWER_ICON[a.qid] ?? ill.main)}</span>
      <div class="body">
      <h3 class="short">${esc(a.shortT ?? T(yardstick.questions.find((x) => x.id === a.qid)?.short ?? ""))}${a.level ? `<span class="lvl">${esc(a.level)}${T("の答え")}</span>${a.translated ? `<span class="lvl ai">${T("AI による訳")}</span>` : ""}` : ""}</h3>
      ${notFound(a)
        ? `<p class="lead">${T("公開の資料では見つかりませんでした")}</p><p class="src">${a.checkedAt ? `${esc(a.checkedAt.slice(0, 10))}・` : ""}${T("町の人に聞きたいことです")}</p>`
        : `${a.items ? "" : answerBody(a)}
      ${a.items ? `<ul class="topics">${a.items.map((x) => `<li><span class="tx">${esc(x.text)}</span>
        <span class="src">${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title ?? x.url)}</a>` : esc(x.title ?? "")}${x.asOf ? `・${esc(x.asOf)}` : ""}</span></li>`).join("")}</ul>` : ""}
      ${health?.links?.[a.source?.url]?.kind === "gone" ? `<p class="gone">出典のページが見つからなくなっています（${esc(health.links[a.source.url].checkedAt.slice(0, 10))} に見張りで確かめた）。町の公式のサイトで新しいページを探して確かめてください。</p>` : ""}
      ${a.outdated ? `<p class="outdated"><strong>古いデータに気づきました</strong>：${esc(a.outdated.what)}。古い：${a.outdated.old?.url ? `<a href="${esc(a.outdated.old.url)}" target="_blank" rel="noopener">${esc(a.outdated.old.asOf ?? "")}</a>` : esc(a.outdated.old?.asOf ?? "")}／新しい：${a.outdated.new?.url ? `<a href="${esc(a.outdated.new.url)}" target="_blank" rel="noopener">${esc(a.outdated.new.asOf ?? "")}</a>` : esc(a.outdated.new?.asOf ?? "")}</p>` : ""}
      <p class="src chip">${icon("link")} ${a.source?.url ? `<a href="${esc(a.source.url)}" target="_blank" rel="noopener"${a.source.where ? ` title="${esc(T("出典の中の場所"))}：${esc(a.source.where)}"` : ""}>${esc(a.source.title ?? a.source.url)}</a>` : esc(a.source?.title ?? "")}${a.asOf ? `・時点 ${esc(a.asOf)}` : ""}・${T(a.status === "auto" ? "自動で承認" : "人が確かめた")}</p>`}
      </div>
    </li>`;
  }).join("")}</ul>`;
}

// 今日のページ：天気・洗濯・服装・警報・地震（見る人のブラウザが気象庁と Open-Meteo をその場で読む）
async function showToday(code, at) {
  try {
    const t = await loadToday(code, at[1], at[0]);
    $("today-box").innerHTML = todayHTML(t, esc);
    // 危ないことはいちばん上に：警報（赤）・注意報（橙）が出ていれば、どのページを見ていてもタブの下に帯で出す
    const w = t.warnings?.list ?? [];
    if (w.length) {
      const danger = w.some((x) => /警報/.test(x));
      const band = $("alert-band");
      band.hidden = false;
      band.classList.toggle("danger", danger);
      band.innerHTML = `${icon("alert")}<strong>${T(danger ? "警報が出ています" : "注意報が出ています")}</strong><span>${w.map((x) => esc(T(x))).join("・")}</span><small>${T("気象庁の発表")} ›</small>`;
    }
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
    medicalRow = `<li><a href="#iryo"><span class="k">${icon("hospital")}${T("病院")}</span><span class="v later">${text}</span></a></li>`;
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
  medicalRow = `<li><a href="#iryo"><span class="k">${icon("hospital")}${T("病院")}</span><span class="v">${LANG ? `${T("今日やっている所")} ${today.list.length}（${T("いま開いている")} ${open}）` : `${today.holiday ? `今日は${esc(today.holiday)}。` : ""}今日やっている所 ${today.list.length} か所（いま開いている ${open}）`}</span></a></li>`;
}

// 今日の暮らし（今日すること・困ったときの入口）と、暮らしの場面のタイル
let medicalRow = null;
let gomiToday = null; // 町・字のページで、今日出せるごみ（ごみを出す日の表から）
function todayLife(hasHinan) {
  const has = (v) => (answersByPage[v] ?? []).filter((a) => a.value !== "見つからなかった").length;
  const row = (view, k, v, ready) => `<li><a href="#${view}"><span class="k">${icon(ILLUST[view]?.main)}${T(k)}</span><span class="v${ready ? "" : " later"}">${esc(T(v))}</span></a></li>`;
  $("today-life").innerHTML = [
    row("gomi", "ごみ", gomiToday ? (gomiToday.length ? `今日は ${gomiToday.join("・")} の日` : "今日はごみの収集はありません") : has("gomi") ? "ごみの出し方を見る" : "今日の収集は、これから出します", has("gomi") || !!gomiToday),
    medicalRow ?? row("iryo", "病院", "この町の病院のデータはまだありません", false),
    row("bousai", "避難", hasHinan ? "わが家から近い避難場所を出す" : has("bousai") ? "避難場所の案内を見る" : "避難場所は、これから出します", hasHinan || has("bousai")),
    row("komatta", "困ったとき", has("komatta") ? "電話・メールの窓口を見る" : "電話・メールの窓口は、これから出します", has("komatta")),
  ].join("");
  $("tiles").innerHTML = PAGES.filter((p) => !["today", "source", "research", "mitate"].includes(p.view)).map((p) => {
    // 中身があるか：Claude の答え・わが家の避難・病院のデータ・町のデータ
    const n = (p.feature ? 1 : 0) + has(p.view) + (p.view === "bousai" && hasHinan ? 1 : 0) + (p.view === "shiru" ? 1 : 0) + (p.view === "iryo" && medicalRow && !medicalRow.includes("later") ? 1 : 0) + (p.view === "foreign" && !$("tr-block").hidden ? 1 : 0);
    return `<li${p.feature ? " class=\"feat\"" : ""}><a href="#${p.view}">${p.feature ? `<span class="feat-badge">${T("この町ならでは")}</span>` : ""}${illust(p.view)}<span class="t">${esc(T(p.title))}</span><span class="d">${esc(T(p.desc))}</span>${n ? "" : `<span class="later">${T("準備中")}</span>`}</a></li>`;
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
      <a class="all-page" href="#${p.view}" data-view="${p.view}"><span class="t">${icon(ILLUST[p.view]?.main)}${esc(T(p.title))}</span><span class="d">${esc(T(p.desc))}</span></a>
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
  let lang = LANG ?? new URLSearchParams(location.search).get("lang");
  if (!langs.includes(lang)) lang = langs[0];
  $("tr-block").hidden = false;
  $("lang-bar").hidden = false;
  const href = (l) => { const u = new URL(location.href); if (l) u.searchParams.set("lang", l); else u.searchParams.delete("lang"); return u.pathname.split("/").pop() + u.search + u.hash; };
  $("lang-bar").innerHTML = [["", "日本語"], ...langs.map((l) => [l, t.langs[l].name])].map(([l, n]) => `<a href="${href(l)}"${(LANG ?? "") === l ? " aria-current=\"true\"" : ""}>${esc(n)}</a>`).join("") + `<span>${T("（AI による訳）")}</span>`;
  const draw = () => {
    const L = t.langs[lang];
    $("tr-langs").innerHTML = langs.map((l) => `<button type="button" data-lang="${l}" aria-pressed="${l === lang}">${esc(t.langs[l].name)}</button>`).join("");
    $("tr-note").textContent = TR_NOTE[lang] ?? "";
    // 日本語の答えと同じカードの形（左に絵・要点・箇条）。訳が確かめ中のものは、もとの日本語を出す
    $("tr-list").className = "answers tr-list";
    // 元の答えが町のページから下がった訳は出さない（元の答えと同じ文の訳だけ）
    const live = new Set(Object.values(answersByPage).flat().map((a) => a.valueJa ?? a.value));
    $("tr-list").innerHTML = L.items.filter((x) => live.has(x.original)).map((x) => {
      const ok = x.status === "auto" || x.status === "ok";
      const ill = ILLUST[PAGE_OF(x.qid)] ?? ILLUST.foreign;
      const lines = prettyText(ok ? x.text : x.original, esc).split("<br>").filter(Boolean);
      return `<li lang="${ok && lang !== "easy" ? lang : "ja"}" style="--h:${ill.h}">
        <span class="badge" aria-hidden="true">${icon(ANSWER_ICON[x.qid] ?? ill.main)}</span>
        <div class="body">
          <h3 class="short">${esc(ok ? x.short : (yardstick.questions.find((q) => q.id === x.qid)?.short ?? x.qid))}</h3>
          ${ok ? "" : `<p class="pending-note">${esc(TR_PENDING[lang] ?? "")}</p>`}
          <p class="lead">${numbers(lines[0] ?? "")}</p>
          ${lines.length > 1 ? `<ul class="pts">${lines.slice(1).map((l) => `<li>${numbers(l)}</li>`).join("")}</ul>` : ""}
          ${x.source?.url ? `<p class="src chip">${icon("link")} <a href="${esc(x.source.url)}" target="_blank" rel="noopener">${esc(x.source.title ?? x.source.url)}</a></p>` : ""}
          ${ok ? `<details class="q"><summary>もとの日本語</summary><span lang="ja">${prettyText(x.original, esc)}</span></details>` : ""}
        </div>
      </li>`;
    }).join("");
    for (const b of $("tr-langs").querySelectorAll("button")) b.addEventListener("click", () => { lang = b.dataset.lang; draw(); });
  };
  draw();
}

// このごみは何ごみ？：町の公式の一覧表から作った辞書（site/data/gomi/{コード}.json）を、入力した言葉で引く。
// ひらがな・カタカナ・全角半角の違いは吸収する。見つからなければ、町の表へ案内する
const kana = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s　・･]/g, "");
async function showGomi(code) {
  const d = await fetch(`data/gomi/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!d) return;
  $("gomi-block").hidden = false;
  const hue = (k) => [140, 205, 45, 275, 185, 320, 100, 235, 30, 165][d.kinds.indexOf(k) % 10];
  const items = d.items.map((x) => ({ ...x, key: kana(x.n), ykey: kana(x.y) }));
  const examples = ["ペットボトル", "乾電池", "スプレー缶", "フライパン", "蛍光灯", "傘"].filter((w) => items.some((x) => x.key.includes(kana(w)))).slice(0, 5);
  $("gomi-ex").innerHTML = examples.length ? `${T("例：")}${examples.map((w) => `<button type="button" data-w="${esc(w)}">${esc(w)}</button>`).join("")}` : "";
  const draw = () => {
    const q = kana($("gomi-q").value);
    if (!q) { $("gomi-hits").innerHTML = ""; return; }
    const hits = items.map((x) => ({ x, s: x.key === q || x.ykey === q ? 0 : x.key.startsWith(q) || x.ykey?.startsWith(q) ? 1 : x.key.includes(q) || x.ykey?.includes(q) ? 2 : 9 }))
      .filter((h) => h.s < 9).sort((a, b) => a.s - b.s || a.x.n.length - b.x.n.length).slice(0, 8);
    $("gomi-hits").innerHTML = hits.length ? hits.map(({ x }) => `<li style="--h:${hue(x.k)}">
        <span class="n">${esc(x.n)}</span>
        <span class="k">${esc(x.k)}</span>
        ${x.also ? `<span class="also">${T("場合によって：")}${x.also.map((k) => `<b style="--h:${hue(k)}">${esc(k)}</b>`).join("")}</span>` : ""}
        ${x.note ? `<span class="nt">${esc(x.note)}</span>` : ""}
      </li>`).join("")
      : `<li class="none">「${esc($("gomi-q").value)}」${T("は、町の表に見つかりませんでした。言いかえて探すか、町の一覧表で確かめてください。")}</li>`;
  };
  $("gomi-q").addEventListener("input", draw);
  for (const b of $("gomi-ex").querySelectorAll("button")) b.addEventListener("click", () => { $("gomi-q").value = b.dataset.w; draw(); $("gomi-q").focus(); });
  $("gomi-note").innerHTML = `${esc(d.note)}（${d.items.length} 品目）。出典：${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title ?? s.url)}</a>`).join("・")}`;
}

// 町の人に聞きたいこと：公開の資料では見つからなかった問い（答えが「見つからなかった」）と、作者が「分からない（町の人に聞く）」とした問い
async function showAsk(code, partKey) {
  const rev = await fetch("data/review.json").then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }));
  const scopes = [`muni:${code}`, ...(partKey ? [`town:${partKey}`] : [])];
  const fromAnswers = Object.values(answersByPage).flat().filter((a) => a.value === "見つからなかった");
  // 「分からない」と決めたものと、見つからなかったので「出さない」と決めたもの
  const unknown = rev.items.filter((x) => scopes.includes(x.scope) && (x.status === "unknown" || (x.status === "rejected" && /見つからなかった/.test(`${x.why ?? ""} ${x.decided?.reason ?? ""}`))));
  const list = [...fromAnswers.map((a) => ({ qid: a.qid, q: a.question, at: a.checkedAt })), ...unknown.map((x) => ({ qid: x.qid, q: x.question, at: x.decided?.at, why: x.decided?.reason }))];
  const seen = new Set();
  const uniq = list.filter((x) => (seen.has(x.q) ? false : seen.add(x.q)));
  if (!uniq.length) return;
  $("ask-block").hidden = false;
  $("ask-list").innerHTML = uniq.map((x) => `<li>${icon("search")}<span><strong>${esc(T(yardstick.questions.find((y) => y.id === x.qid)?.short ?? x.q.slice(0, 20)))}</strong>${x.why ? `<small>${esc(x.why)}</small>` : ""}${x.at ? `<small>${esc(x.at.slice(0, 10))} に調べた</small>` : ""}</span></li>`).join("");
}

// ごみを出す日：町の公式の収集日の表から読み取った地区ごとの曜日（site/data/gomi-days/{コード}.json）。
// 人が確かめるまで（status が ok・auto でないあいだ）は曜日を出さず、そう書く。出し方の要点はいつも出す
const WD = "日月火水木金土";
// 「毎週火・金曜日」「第1・3水曜日」から、その日に当たるか
function onDay(when, date) {
  const w = WD[date.getDay()];
  const days = (when.match(/[月火水木金土日](?=[・、曜]|$)/g) ?? []);
  if (!days.includes(w)) return false;
  const nth = when.match(/第([0-9０-９・、]+)/);
  if (!nth) return /毎週|曜/.test(when);
  const n = Math.ceil(date.getDate() / 7);
  return nth[1].normalize("NFKC").split(/[・、]/).map(Number).includes(n);
}
async function showGomiDays(code, partName) {
  const g = await fetch(`data/gomi-days/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!g) return null;
  $("gomi-days-block").hidden = false;
  $("gomi-area-label").textContent = T("地区を選ぶ");
  $("gomi-rules-head").textContent = T("出し方の要点");
  const ok = g.status === "ok" || g.status === "auto";
  $("gomi-rules").innerHTML = g.rules.map((r) => `<li><strong>${esc(r.kind)}</strong><span>${esc(r.how)}${r.time ? `<small>${esc(r.time)}</small>` : ""}</span></li>`).join("");
  $("gomi-days-note").innerHTML = `${esc(T(g.note))}。${T("出典")}：${g.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title ?? s.url)}</a>`).join("・")}`;
  if (!ok) {
    $("gomi-area").closest("label").hidden = true;
    $("gomi-today").innerHTML = `${icon("eye")} ${T("地区ごとの曜日は、いま人が確かめています（公式の表から読み取ったものが、町のカレンダーと合っているか）。それまでは町の収集日の表をご覧ください。")}`;
    return null;
  }
  const sel = $("gomi-area");
  sel.innerHTML = `<option value="">（選ぶ）</option>` + g.areas.map((a, i) => `<option value="${i}">${esc(a.area)}${a.towns.length ? `（${esc(a.towns.slice(0, 3).join("・"))}${a.towns.length > 3 ? "…" : ""}）` : ""}</option>`).join("");
  // 町・字のページなら、その名前の地区を選んでおく
  const guess = partName ? g.areas.findIndex((a) => a.area.includes(partName) || a.towns.some((t) => t.includes(partName))) : -1;
  let todayKinds = null;
  const draw = () => {
    const a = g.areas[Number(sel.value)];
    if (!a) { $("gomi-days").innerHTML = ""; $("gomi-today").textContent = T("地区を選ぶと、今日と明日に出せるごみが分かります。"); return; }
    const now = new Date(), tmr = new Date(now.getTime() + 86400000);
    const t0 = a.days.filter((x) => onDay(x.when, now)).map((x) => x.kind), t1 = a.days.filter((x) => onDay(x.when, tmr)).map((x) => x.kind);
    todayKinds = t0;
    $("gomi-today").innerHTML = `${icon("calendar")} ${T("今日")}：<strong>${t0.length ? esc(t0.join("・")) : T("収集なし")}</strong>　${T("明日")}：<strong>${t1.length ? esc(t1.join("・")) : T("収集なし")}</strong>`;
    $("gomi-days").innerHTML = a.days.map((x) => `<li class="${onDay(x.when, now) ? "today" : ""}"><span class="k">${esc(x.kind)}</span><span class="w">${esc(x.when)}</span></li>`).join("");
  };
  sel.addEventListener("change", draw);
  if (guess >= 0) sel.value = String(guess);
  draw();
  return guess >= 0 ? todayKinds : null;
}

// どの町のページも最後に同じことをする：答え・わが家の避難・今日の暮らし・すべてのページ・調べる
async function finishPage(code, townFeatures, startPart, scopeNote, at) {
  // その町ならではのページ（町の特徴から）を先に作る（答えの箱・タイル・すべてのページに入るように）
  await showFeatures(code, at);
  showView();
  const part = startPart && townFeatures.find((f) => f.properties.part === startPart);
  $("memo-link").href = part ? `memo.html?town=${code}-${startPart}` : `memo.html?muni=${code}`;
  await showAnswers(code, scopeNote, part ? `${code}-${startPart}` : null, part?.properties.name);
  // 町の色（町の花・木から。地図を描く前に決める）
  const sym = applyTownColor(Object.values(answersByPage).flat().find((x) => x.qid === "Q11"));
  if (sym) {
    $("town-color-note").hidden = false;
    $("town-color-note").innerHTML = `<span class="swatch" aria-hidden="true"></span>${LANG ? `${T("ページの上の帯の色は、町が定めた花・木の色から作りました（町の公式の色ではありません）。")}（${esc(sym.name)}）` : `ページの上の帯の色は、町が定めた「${esc(sym.name)}」の色から作りました（町の公式の色ではありません）。`}<a href="#shiru" id="color-src">${T("出典")}</a>`;
    $("color-src").addEventListener("click", () => setTimeout(() => $("a-Q11")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50));
  }
  showLayerMap(code, townFeatures, at, esc);
  await showFloodPop(code, part);
  await showPlan(code, part);
  await showQuake(code, part);
  await showBus(code, part);
  await showAccidents(code, part);
  await showShopAccess(code);
  await showFuture(code);
  const hasHinan = await showHinan(code, townFeatures, startPart);
  await showTranslations(code);
  await showGomi(code);
  gomiToday = await showGomiDays(code, part?.properties.name);
  await showAsk(code, part ? `${code}-${startPart}` : null);
  todayLife(hasHinan);
  const local = await fetch("api/ping").then((r) => r.ok).catch(() => false);
  buildAllPages(hasHinan, local);
  if (local) await researchBox(code, part ? startPart : null, part?.properties.name);
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
async function researchBox(code, part, partName) {
  $("research-block").hidden = false;
  for (const el of document.querySelectorAll(".town-tabs .local-only")) el.hidden = false;
  $("research-link").href = part ? `research.html?muni=${code}&part=${part}` : `research.html?muni=${code}`;
  if (part) $("research-link").textContent = `${partName}の問い（ごみの曜日・校区・自治会・近くの計画）をまとめて調べる（調べる画面）`;
  const form = $("research-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "問いに直して、調べています…（1分ほど）";
    $("research-steps").innerHTML = `<li>${new Date().toLocaleTimeString("ja-JP")} 始めました</li>`;
    const res = await fetch("api/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, part: part ?? undefined, text: form.question.value }) });
    const body = await res.json();
    $("research-steps").innerHTML = !res.ok ? `<li>できませんでした：${esc(body.error)}</li>`
      : !body.ok ? `<li>この頼みは、まちしるべの決まりに合わないので調べませんでした：${esc(body.reason)}（${body.usd.toFixed(3)}）</li>`
      : `<li>${body.same ? `物差しにある問い ${esc(body.qid)} と同じでした` : `物差しに ${esc(body.qid)} を足しました（この町だけ）`}：${esc(body.question)}</li>`
        + body.steps.map((x) => `<li>${esc(x)}</li>`).join("") + `<li>答え：${esc(body.value)}（${body.usd.toFixed(3)}）</li><li>${body.status === "auto" ? "自動で承認しました" : `確かめる一覧に入りました：<a href="review.html">確かめる一覧へ</a>`}</li>`;
    button.disabled = false;
    button.textContent = "頼む";
  });
}

async function main() {
  // 言葉の切り替え（?lang=pt など）：辞書があれば、タブとページの決まった文字を置きかえる
  if (await setLang(q.get("lang"))) { renderTabs(); translateDom(); }
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
  await finishPage(code, all, chosen.length === 1 ? chosen[0].properties.part : null, `${muniName}全体についての答えです。`, centerOf(chosen));
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
  await finishPage(code, towns ? topojson.feature(towns, towns.objects.towns).features : [], null, "", at);
  sources([`${stats.source.name}（${stats.source.asOf}。増減は${stats.source.changePeriod}）を加工`, N03, WEATHER, MEDICAL, BASEMAP], code);
  const topo = await getJSON("data/japan.topo.json");
  drawMap(topojson.feature(topo, topo.objects.municipalities).features.filter((f) => f.properties.code === code));
}

const N03 = "国土数値情報（行政区域データ、2026年1月1日）国土交通省 を加工して作成（CC BY 4.0）";
const MEDICAL = "病院・診療所：厚生労働省「医療情報ネット」のオープンデータ（2026年6月1日時点、公共データ利用規約 第1.0版）を加工。祝日：内閣府「国民の祝日」（公共データ利用規約 第1.0版）";
const WEATHER = "今日と明日の天気・警報・注意報・地震：気象庁ホームページ（その場で読む）。気温・湿度・風・日の照る時間：Open-Meteo.com（CC BY 4.0）を加工。洗濯・服装はまちしるべの決まりで出しためやす";
const BASEMAP = "背景の地図：地理院地図 Vector（国土地理院）https://maps.gsi.go.jp/development/vt.html";

function header(name, where, path) {
  document.title = `${name}｜まちしるべ`;
  $("name").textContent = name;
  $("where").textContent = where;
  $("path").innerHTML = path.filter(([l]) => l).map(([l, href]) => `<li>${href ? `<a href="${href}">${l}</a>` : `<span>${l}</span>`}</li>`).join("");
}
// 見張り（scripts/watch.mjs）の結果：出典のページがまだあるか
let health = null;
function sources(list, code) {
  $("sources").innerHTML = list.map((s) => `<li>${s}</li>`).join("");
  if (health && code) {
    const mine = Object.entries(health.links).filter(([, l]) => l.used.some((u) => u.page.startsWith(code)));
    const gone = mine.filter(([, l]) => l.kind === "gone").length;
    if (mine.length) $("sources").insertAdjacentHTML("beforebegin", `<p class="watch">${icon("eye")} 見張り：このページの出典 ${mine.length} 件を ${esc(health.checkedAt.slice(0, 10))} に確かめました。${gone ? `<strong>${gone} 件のページが見つからなくなっています</strong>（その答えに印を付けています）。` : "どれもページがありました。"}</p>`);
  }
  // 情報源カード（作者が使ってよいと確かめたサイト）
  if (!code) return;
  // 避難場所のデータ（わが家の避難で使ったもの）
  fetch(`data/shelters/${code}.json`).then((r) => (r.ok ? r.json() : null)).then((d) => d && $("sources").insertAdjacentHTML("beforeend",
    `<li><a href="${esc(d.source.url)}" target="_blank" rel="noopener">${esc(d.source.title)}</a>（${esc(d.source.license)}・${esc(d.source.fetchedAt)} に取得）を加工（わが家の避難）</li>`)).catch(() => {});
  fetch(`data/sources/${code}.json`).then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d?.cards?.length) return;
    // 取り消したカードは出さない
    $("sources").insertAdjacentHTML("beforeend", d.cards.filter((c) => c.status === "ok").map((c) =>
      `<li><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a>（情報源カード ${esc(c.id)}・${esc(c.approvedAt.slice(0, 10))} に確かめた・${esc(c.license)}）</li>`).join(""));
  }).catch(() => {});
}
function notFound(text) {
  $("name").textContent = text;
  $("path").innerHTML = `<li><a href="./">日本</a></li>`;
}

// 町の形の小さな地図（見るだけ。動かさない）。背景は地理院地図 Vector（色をうすくしたもの）
async function drawMap(features) {
  const data = { type: "FeatureCollection", features };
  const map = new maplibregl.Map({
    container: "town-map",
    style: await baseStyle(),
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
