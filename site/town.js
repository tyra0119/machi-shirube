// 町のページ。どの町も同じ形（町・字1つ・まとまり・市区町村）。
// town.html?town=28109-0990 ／ ?town=28109-0990,0460（複数の町・字）／ ?area=28109-a1（まとまり）／ ?muni=39428
// 調べる機能ができるまでは、国の統計の数字だけを出し、ほかの欄は「まだ調べていません」と正直に出す
const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// データのファイルを読む（同じファイルは1回だけ読み、使うたびに写しを渡す。読んだあとに書きかえる所があるので、写しにして混ざらないように）
const dataCache = new Map();
const getData = (url) => {
  if (!dataCache.has(url)) dataCache.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return dataCache.get(url).then((d) => (d == null ? null : structuredClone(d)));
};
// 避難場所の想定収容人数：町の表の人数は屋内と屋外（校庭や広場）の合計のことがある。建物の中の人数が分かれば添える（scripts/build-shelter-inside.mjs）
const KIND_LABEL = { 内水: "内水（下水があふれる）" };
const capText = (p) => `${T("受け入れの人数")} ${esc(String(p.capacity ?? "").replace(/\d{4,}/g, (n) => Number(n).toLocaleString("ja-JP")))}${p.inside != null ? `（${T("建物の中")} ${Number(p.inside).toLocaleString("ja-JP")}${T("人")}）` : `（${T("屋外の広場などを含むことがあります")}）`}`;
// Google マップで、選んだ場所から避難場所までの歩く道を開く（画面と同じ出発地にするため、選んだ場所も渡す。
// ボタンを押したときだけ Google マップに渡る、と画面に書いている。作者「場所は送りたいな。じゃないと画面と違う経路になってしまう」）
const gmapWalk = ([lon, lat], from) => `https://www.google.com/maps/dir/?api=1${from ? `&origin=${from[1].toFixed(5)},${from[0].toFixed(5)}` : ""}&destination=${lat},${lon}&travelmode=walking`;
// 文をつなぐ句点：ほかの言葉では「. 」（日本語とやさしい日本語は「。」）
const KU = () => (LANG && LANG !== "easy" ? ". " : "。");

async function getJSON(path) {
  try {
    const d = await getData(path); // 同じファイルは1回だけ読む
    if (d == null) throw new Error(T("読めませんでした"));
    return d;
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
// タブを押したときの動き：右のタブへ移るときは右から、左のタブへ移るときは左から、中身がすっと入る（作者「タブを押した時、アニメーションにできる？」）
let lastView = null;
function showView() {
  const v = currentView();
  const order = (x) => PAGES.findIndex((p) => p.view === x);
  for (const el of document.querySelectorAll(".view")) {
    el.hidden = el.dataset.view !== v;
    if (!el.hidden && lastView && lastView !== v) {
      el.classList.remove("enter-r", "enter-l");
      void el.offsetWidth; // 同じ向きが続いても動き直すように
      el.classList.add(order(v) >= order(lastView) ? "enter-r" : "enter-l");
    }
  }
  lastView = v;
  for (const a of document.querySelectorAll(".town-tabs a, .town-bottom a")) a.toggleAttribute("aria-current", a.dataset.view === v);
  // 下のメニューにないページを見ているときは「ほか」を選んでいる印にする
  document.querySelector(".town-bottom .open-all")?.classList.toggle("current", !BOTTOM.some(([b]) => b === v));
  // まちがいの知らせ方のページへ、町と見ているページを渡す（言葉は渡さない）
  // 隠れていたあいだは大きさが 0 なので、見せたときに大きさを合わせ、覚えておいた範囲に寄せ直す
  for (const m of maps) { m.resize(); if (m.fitTo) m.fitBounds(m.fitTo.box, { ...m.fitTo.opts, duration: 0 }); }
  // タブの帯を動かさない：下のほうまで読んでいたときだけ、新しいページの先頭（タブの帯のすぐ下）を出す。
  // 上のほう（町の名前が見えている所）にいたときは、そのまま
  const head = document.querySelector(".town-head");
  const top = head.offsetTop + head.offsetHeight;
  if (window.scrollY > top) window.scrollTo({ top });
}
// 選んだことを端末に覚えておく（ごみの地区・わが家の避難の町・字・言葉）。毎日開く人が、開くたびに選び直さなくてよいように。
// 覚えられない端末（プライベートの窓など）でも、ふつうに動く
const remember = {
  get(k) { try { return localStorage.getItem(`machi-shirube:${k}`); } catch { return null; } },
  set(k, v) { try { if (v) localStorage.setItem(`machi-shirube:${k}`, v); else localStorage.removeItem(`machi-shirube:${k}`); } catch {} },
};
// 上のメニュー（パソコン）：よく使うページと、右の端に「すべてのページ」
// 下のメニュー（スマホ）：親指の届く所に、よく使う4つと「ほか」（すべてのページ）だけを並べる。横に動かさなくても全部が見える
// （作者「上部の『今日』『地図』などのボタンがただ並んでいるだけで本当に使いやすいのか？」→ 案A）
const BOTTOM = [["today", "今日"], ["chizu", "地図"], ["bousai", "防災"], ["gomi", "ごみ"]];
function renderTabs() {
  $("tabs").innerHTML = PAGES.filter((p) => p.tab || p.local).map((p) =>
    `<li${p.local ? " class=\"local-only\" hidden" : ""}><a href="#${p.view}" data-view="${p.view}">${icon(ILLUST[p.view]?.main)}${esc(p.local ? T("調べる") : T(p.title))}</a></li>`).join("")
    + `<li class="all-pages"><button type="button" class="open-all" aria-haspopup="dialog">☰ ${T("すべてのページ")}</button></li>`;
  $("bottom-tabs").innerHTML = BOTTOM.map(([v, label]) =>
    `<li><a href="#${v}" data-view="${v}">${icon(ILLUST[v]?.main)}<span>${esc(T(label))}</span></a></li>`).join("")
    + `<li><button type="button" class="open-all" aria-haspopup="dialog" aria-label="${esc(T("すべてのページ"))}">${icon("list")}<span>${esc(T("ほか"))}</span></button></li>`;
}
renderTabs();
// 各ページのいちばん上の見出しに、場面の印を付ける
for (const v of document.querySelectorAll(".view")) v.querySelector(".block > h2")?.insertAdjacentHTML("afterbegin", icon(ILLUST[v.dataset.view]?.main));
addEventListener("hashchange", showView);
// まちがいの知らせ方のページへ、町と見ているページと言葉を渡す（訳でリンクが書きかわっても効くよう、押したときに決める）
document.addEventListener("click", (e) => {
  const r = e.target.closest(".about-site a[href^=\"report.html\"]");
  if (!r) return;
  const rp = new URLSearchParams(location.search); rp.set("page", currentView());
  r.href = `report.html?${rp}`;
});
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
  const sh = await getData(`data/shelters/${code}.json`);
  const tsunami = sh?.features.filter((x) => x.properties.kinds.includes("津波")).length ?? 0;
  const fp = (await floodPop(code))?.kinds ?? {};
  const n = (v) => v.toLocaleString("ja-JP");
  if ((fp.津波 || tsunami) && t.over65Rate >= stats.summary.over65Rate.top10) {
    list.unshift({ type: "お年寄り × 津波", who: "津波から坂を上って逃げる、足の弱いお年寄り", reason: fp.津波
      ? `65歳以上が ${t.over65Rate.toFixed(1)}%（全国でも高いほう）。津波で浸かる想定の所に、約 ${n(fp.津波.people)} 人（町の ${fp.津波.rate}%）が住み、うち65歳以上が約 ${n(fp.津波.over65)} 人（めやす）`
      : `65歳以上が ${t.over65Rate.toFixed(1)}%（全国でも高いほう）で、津波の避難場所が ${tsunami} か所ある町` });
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
  // Claude の見立て（scripts/mitate.mjs）があれば、それを出す。ほかの言葉は、確かめの通った訳があるときだけ（無ければ下の決まりによる見立て）
  let cm = await getData(`data/mitate/${code}.json`);
  const tr = cm && (await aiTr(code, "mitate", cm.createdAt));
  if (cm && LANG && LANG !== "easy" && !tr) cm = null;
  if (cm?.who?.length) {
    const pg = (v) => PAGES.find((p) => p.view === v);
    const t = tr ?? ((id, ja) => ja);
    // 見立てを手がかりに調べた答え（scripts/mitate-ask.mjs が人ごとに問いを結ぶ）。見つかった答えがあれば、そこへ飛ぶ
    const ans = (await getData(`data/answers/${code}.json`))?.answers ?? [];
    const yard = (await getJSON("data/yardstick.json")).questions;
    const found = (qid) => { const a = ans.find((x) => x.qid === qid && x.value !== "見つからなかった"); const q = yard.find((x) => x.id === qid); return a && q ? q : null; };
    // ほかの言葉では、答えの訳の見出しを使う（訳が無ければ見出しを付けない）
    const trItems = LANG ? (await getData(`data/translations/${code}.json`))?.langs?.[LANG]?.items ?? [] : [];
    const askShort = (q) => (LANG ? trItems.find((x) => x.qid === q.id && (x.status === "auto" || x.status === "ok"))?.short : q.short);
    // 住む人の目線で：見出しは「この町の、こんな人へ」。先に人と「町の支援を見る」、壁と数を使った理由は「くわしく」の中
    // （作者「今日のページに『この町で、暮らしの情報が届きにくいのは』を表示するのは自然？」→「その案で直して。町のページを見るのは住民なので、その想定で」）
    $("mitate-top").innerHTML = `<h2>${T("この町の、こんな人へ")}</h2>
      <ul class="mitate-list">${cm.who.map((w, i) => { const p = pg(w.page); const q = w.ask && found(w.ask); return `<li><strong>${esc(t(`m${i}.person`, w.person))}</strong><span class="gos">${q ? `<a class="go ask" href="#${q.page}" data-target="a-${q.id}">${icon("search")}${T("町の支援を見る")}${askShort(q) ? `：${esc(askShort(q))}` : ""}</a>` : ""}${p ? `<a class="go" href="#${p.view}">${icon(ILLUST[p.view]?.main ?? "map")}${LANG ? esc(T(p.title)) : `${esc(p.title)}${p.title.endsWith("へ") ? "" : "へ"}`}</a>` : ""}</span><details class="why-more"><summary>${T("くわしく")}</summary><span class="wall">${icon("alert")} ${esc(t(`m${i}.wall`, w.wall))}</span><span class="why">${esc(t(`m${i}.why`, w.why))}</span></details></li>`; }).join("")}</ul>
      <p class="note">${T("国の数字をもとに、AI が見立てたものです。町の評価ではありません。")}${tr ? ` ${T("（AI による訳）")}` : ""} <a href="#mitate">${T("くわしく")}</a></p>`;
    for (const a of $("mitate-top").querySelectorAll("a.ask")) a.addEventListener("click", () => setTimeout(() => $(a.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50));
    return;
  }
  $("mitate-top").innerHTML = `<h2>${T("この町の、こんな人へ")}</h2>
    <ul class="mitate-list">${list.slice(0, 2).map((c) => { const p = page(c.type); return `<li><strong>${esc(T(c.who))}</strong><details class="why-more"><summary>${T("くわしく")}</summary><span class="why">${esc(reasonOf(c))}</span></details>${p ? `<a class="go" href="#${p.view}">${icon(ILLUST[p.view]?.main ?? "map")}${LANG ? esc(T(p.title)) : `${esc(p.title)}${p.title.endsWith("へ") ? "" : "へ"}`}</a>` : ""}</li>`; }).join("")}</ul>
    <p class="note">${T("全国の市区町村と国の数字で比べた、まちしるべの見立てです（町の評価ではありません）。")} <a href="#mitate">${T("くわしく")}</a></p>`;
}
// 浸水が想定される所に住む人（めやす。scripts/build-flood-pop.mjs が作る）
let floodPopCache;
function floodPop(code) {
  return (floodPopCache ??= getData(`data/flood-pop/${code}.json`));
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
  $("floodpop-note").innerHTML = `${esc(T(d.note))}${KU()}${T("想定は最大の規模のもので、必ずこうなるという意味ではありません。")}${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("・")}`;
}
const depthColor = (label) => { const c = DEPTH_COLORS.find(([, l]) => l === label)?.[0] ?? (label === "警戒区域" ? [214, 170, 110] : [200, 200, 200]); return `rgb(${c.join(",")})`; };

// AI が作った文の訳（scripts/translate-ai.mjs。訳し戻して確かめの通ったものだけ）。もとの文を作り直したあとの古い訳は使わない
let aiTrCache;
async function aiTr(code, kind, createdAt) {
  if (!LANG) return null;
  aiTrCache ??= getData(`data/translations/${code}-ai.json`);
  const t = await aiTrCache;
  const x = t?.made?.[kind] === createdAt && t.langs?.[LANG]?.texts;
  return x ? (id, ja) => (x[id] ? seireki(x[id], LANG) : ja) : null;
}
// ごみを出す日の文の訳（もとの文 → 訳。確かめの通ったものだけ）
async function aiTrGomi(code, createdAt) {
  if (!LANG) return null;
  aiTrCache ??= getData(`data/translations/${code}-ai.json`);
  const t = await aiTrCache;
  return t?.made?.gomi === createdAt ? t.langs?.[LANG]?.gomi ?? null : null;
}

// 町・字ごとの「わが町のひとこと」（scripts/hitokoto.mjs。AI が町・字の数だけでまとめ、数は PC で照らしたもの）。町・字のページのいちばん上に
// ほかの言葉は、確かめの通った訳があるときだけ
async function showHitokoto(code, part) {
  if (!part) return;
  const d = await getData(`data/hitokoto/${code}.json`);
  const h = d?.parts?.[part.properties.part];
  if (!h) return;
  const tr = await aiTr(code, "hitokoto", d.createdAt);
  const id = `h${part.properties.part}`;
  if (LANG && LANG !== "easy" && !tr?.(id, null)) return;
  const t = tr ?? ((i, ja) => ja);
  $("hitokoto-block").hidden = false;
  $("hitokoto-head").innerHTML = `${icon("pin")}${LANG ? `${T("この地区のひとこと")}（${esc(h.name)}）` : `${esc(h.name)}のひとこと`}`;
  $("hitokoto").textContent = t(id, h.text);
  $("hitokoto-note").innerHTML = `${esc(t("n.hitokoto", d.note))}${tr?.(id, null) ? ` ${T("（AI による訳）")}` : "。"}<details class="facts"><summary>${T("もとにした数")}</summary>${h.facts.map((f) => esc(f)).join("・")}</details>`;
}

// 数から、できることへ（scripts/dekiru.mjs。町の数と、確かめ済みの町の案内を AI がつなぎ、引用と数は PC で照らしたもの）。
// 人が確かめてから出す。町のページ（市区町村）のいちばん上、見立ての下に
async function showDekiru(code, part) {
  if (part) return;
  const d = await getData(`data/dekiru/${code}.json`);
  if (!d || (d.status !== "ok" && d.status !== "auto") || !d.links?.length) return;
  // ほかの言葉は、確かめの通った訳があるときだけ（訳の無い文は日本語のまま）
  const tr = await aiTr(code, "dekiru", d.createdAt);
  if (LANG && LANG !== "easy" && !tr) return;
  const t = tr ?? ((i, ja) => ja);
  const ic = (f) => (/津波|洪水|土砂/.test(f) ? "umbrella" : /震度/.test(f) ? "quake" : /バス/.test(f) ? "bus" : /店まで/.test(f) ? "shop" : /外国/.test(f) ? "globe" : /65歳|一人暮らし/.test(f) ? "heart" : "pin");
  $("dekiru-block").hidden = false;
  $("dekiru").innerHTML = d.links.map((l, i) => `<li>
    <p class="who">${icon(ic(l.fact))}<span>${esc(t(`d${i}.who`, l.who))}</span></p>
    <p class="num"><strong>${esc(t(`d${i}.num`, l.num))}</strong><small>${esc(T(l.factSrc))}${/時刻表データのあるバスだけ/.test(l.fact) && !/時刻表/.test(l.num) ? `・${T("時刻表データのあるバスだけで数えたもの")}` : ""}</small></p>
    <p class="todo">${icon("link")}<span>${esc(t(`d${i}.todo`, l.todo))}</span></p>
    <blockquote>「${esc(t(`d${i}.quote`, l.quote))}」<a href="${esc(l.source.url)}" target="_blank" rel="noopener">${esc(l.source.title)}</a></blockquote>
  </li>`).join("");
  $("dekiru-note").textContent = `${t("n.dekiru", d.note)}${tr ? ` ${T("（AI による訳）")} ` : "。"}${T("人が確かめてから出しています。")}`;
}

// このページで新しくなったこと（scripts/ledger.mjs の exportChanges。町のページに出るようになった日ごと）。押すとその答えへ
async function showChanges(code, part) {
  if (part) return;
  const d = await getData(`data/changes/${code}.json`);
  if (!d?.changes?.length) return;
  const yard = (await getJSON("data/yardstick.json")).questions;
  const pageOf = (c) => ({ "gomi-days": "gomi", "plan-excerpt": "bousai", dekiru: "today" })[c.kind] ?? yard.find((q) => q.id === c.qid)?.page ?? "today";
  const day = (iso) => new Date(iso).toLocaleDateString(LANG && LANG !== "easy" ? LANG : "ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric" });
  const list = d.changes.slice(0, 8);
  const days = [...new Set(list.map((c) => day(c.at)))];
  $("changes-block").hidden = false;
  $("changes").innerHTML = days.map((dd) => `<h3 class="ch-day">${icon("calendar")}${esc(dd)}</h3><ul class="ch-list">${list.filter((c) => day(c.at) === dd).map((c) =>
    `<li><a href="#${pageOf(c)}" data-target="${c.qid ? `a-${c.qid}` : ""}"><span class="ch-what ${c.what === "新しくしました" ? "up" : ""}">${esc(T(c.what))}</span>${esc(T(c.label))}</a></li>`).join("")}</ul>`).join("")
    + (d.changes.length > list.length ? `<p class="note">${T("ほかに")} ${d.changes.length - list.length} ${T("件")}</p>` : "");
  for (const a of $("changes").querySelectorAll("a[data-target]")) if (a.dataset.target) a.addEventListener("click", () => setTimeout(() => $(a.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50));
}

// 町のことが分かるほかのサイト（公式ではない。scripts/local-sites.mjs で AI が探し、作者が使ってよいとしたものだけ）。リンクと短い紹介
async function showLocalSites(code) {
  const d = await getData(`data/local-sites/${code}.json`);
  if (!d?.sites?.length) return;
  $("local-block").hidden = false;
  const short = (x) => String(x ?? "").replace(/[（(][^）)]*[）)]/g, "").trim(); // AI が添えた「〜の記載による」などの注記は外す
  $("local-sites").innerHTML = d.sites.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener"><strong>${icon("link")}${esc(s.name)}</strong><span class="k">${esc(short(s.kind))}${s.operator && !/分からない/.test(s.operator) ? `・${esc(short(s.operator))}` : ""}</span><span class="u">${esc(s.use)}</span></a></li>`).join("");
  $("local-note").textContent = `${T(d.note)}${KU()}${T("公式の情報ではありません。")}`;
}

// 町のクイズ（scripts/quiz.mjs。確かめた町の答えと国のデータから AI が作り、正しい答えが材料にあるかを PC で照らしたもの）。1問ずつ。答えの並びは毎回まぜる
async function showQuiz(code) {
  const d = await getData(`data/quiz/${code}.json`);
  if (!d?.questions?.length) return;
  const tr = await aiTr(code, "quiz", d.createdAt);
  if (LANG && LANG !== "easy" && !tr) return; // ほかの言葉は訳があるときだけ
  const t = tr ?? ((id, ja) => ja);
  $("quiz-block").hidden = false;
  let i = 0, right = 0;
  const draw = () => {
    if (i >= d.questions.length) {
      $("quiz").innerHTML = `<p class="quiz-end">${TN("{n} 問のうち {r} 問 正解でした", { n: d.questions.length, r: right })}</p><button type="button" class="quiz-next" id="quiz-again">${T("もう一度")}</button>`;
      $("quiz-again").addEventListener("click", () => { i = 0; right = 0; draw(); });
      return;
    }
    const q = d.questions[i];
    const opts = [["a", q.a], ["b", q.b], ["c", q.c]].sort(() => Math.random() - 0.5);
    $("quiz").innerHTML = `<p class="quiz-n">${i + 1} / ${d.questions.length}</p><p class="quiz-q">${esc(t(`q${i}.q`, q.q))}</p>
      <div class="quiz-opts">${opts.map(([k, v]) => `<button type="button" data-k="${k}">${esc(t(`q${i}.${k}`, v))}</button>`).join("")}</div><div class="quiz-ans" hidden></div>`;
    for (const b of $("quiz").querySelectorAll(".quiz-opts button")) b.addEventListener("click", () => {
      const ok = b.dataset.k === "a";
      if (ok) right++;
      for (const x of $("quiz").querySelectorAll(".quiz-opts button")) { x.disabled = true; x.classList.toggle("right", x.dataset.k === "a"); x.classList.toggle("wrong", x === b && !ok); }
      const ans = $("quiz").querySelector(".quiz-ans");
      ans.hidden = false;
      ans.innerHTML = `<p><strong>${ok ? T("正解") : T("ざんねん")}</strong> ${esc(t(`q${i}.why`, q.why))}</p>${q.source?.url ? `<a href="${esc(q.source.url)}" target="_blank" rel="noopener">${esc(q.source.title)}</a>` : `<small>${esc(q.source?.title ?? "")}</small>`}
        <button type="button" class="quiz-next">${i + 1 < d.questions.length ? T("つぎの問題") : T("けっかを見る")}</button>`;
      ans.querySelector(".quiz-next").addEventListener("click", () => { i++; draw(); });
    });
  };
  draw();
  $("quiz-note").textContent = `${t("n.quiz", d.note)}${tr ? ` ${T("（AI による訳）")}` : ""}`;
}

// 昔の災害を伝える碑（国土地理院 自然災害伝承碑。scripts/build-lore.mjs）。碑の文は公開のまま出す。町の碑がなければ近くの町の碑
async function showLore(code) {
  const d = await getData(`data/lore/${code}.json`);
  if (!d) return;
  $("lore-block").hidden = false;
  const card = (x) => `<li>
    <p class="lore-name">${icon("doc")}<strong>${esc(x.name)}</strong></p>
    <p class="lore-dis">${esc(x.disaster)}${x.kind ? `<span class="tag">${esc(x.kind)}</span>` : ""}</p>
    ${x.text ? `<p class="lore-text">${esc(x.text)}</p>` : ""}
    <p class="lore-at">${icon("pin")}${x.muniName ? `${esc(x.muniName)}（${T("町の真ん中から約")} ${x.km} km）・` : ""}${esc(x.address)}${x.image ? `・<a href="${esc(x.image)}" target="_blank" rel="noopener">${T("碑の写真")}</a>` : ""}</p>
  </li>`;
  $("lore").innerHTML = (d.own.length ? `<p class="fp-head">${T("この町には、昔の災害を伝える碑が")} <strong>${d.own.length}</strong> ${T("基あります。")}</p><ul class="lore-list">${d.own.map(card).join("")}</ul>` : `<p class="fp-head">${T("この町として届けられた碑は、まだありません。近くの町の碑です。")}</p>`)
    + (d.near.length ? `${d.own.length ? `<h3 class="lore-sub">${T("近くの町の碑")}</h3>` : ""}<ul class="lore-list">${d.near.map(card).join("")}</ul>` : "");
  $("lore-note").innerHTML = `${esc(T(d.note))}${LANG ? `（${T("日本語のまま")}）` : ""}${KU()}${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("・")}`;
}

// 町の気候（平年値メッシュ × 住む人。scripts/build-climate.mjs）。東京都心と並べ、良い所は明るい話題として添える
async function showClimate(code) {
  const d = await getData(`data/climate/${code}.json`);
  if (!d) return;
  $("climate-block").hidden = false;
  const n = (v) => Math.round(v).toLocaleString("ja-JP");
  const rows = [
    [T("日の当たる時間（1年）"), `${n(d.town.sun)} ${T("時間")}`, d.tokyo.sun],
    [T("1月の平均気温"), `${d.town.jan}℃`, `${d.tokyo.jan}℃`],
    [T("8月の平均気温"), `${d.town.aug}℃`, `${d.tokyo.aug}℃`],
    [T("1年の雨の量"), `${n(d.town.rain)} mm`, `${n(d.tokyo.rain)} mm`],
    ...(d.town.snow ? [[T("いちばん深い雪"), `${d.town.snow} cm`, `${d.tokyo.snow ?? 0} cm`]] : []),
  ];
  $("climate").innerHTML = (d.bright.length ? `<p class="fp-head"><span class="bright">${icon("sun")} ${d.bright.map((b) => esc(T(b))).join("。")}</span></p>` : "")
    + `<ul class="acc-stats">${rows.map(([l, v, t]) => `<li><span class="l">${l}</span><strong>${v}</strong><span class="s">${T("東京都心")} ${typeof t === "number" ? `${n(t)} ${T("時間")}` : t}</span></li>`).join("")}</ul>`;
  $("climate-note").innerHTML = `${esc(T(d.note))}${KU()}${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("・")}`;
}

// 坂の多い所に住む人（国土地理院の標高 × 250m 四方の人口。scripts/build-slope.mjs）
async function showSlope(code, part) {
  const d = await getData(`data/slope/${code}.json`);
  if (!d || d.slope.people < 10 || d.slope.rate < 1) return; // 平らな町（住む人の1%未満）は出さない
  $("slope-block").hidden = false;
  const n = (v) => v.toLocaleString("ja-JP");
  const here = part && d.parts[part.properties.part];
  $("slope").innerHTML = [
    [T("坂が多い所に住む人"), `${T("約")} ${n(d.slope.people)} ${T("人")}`, `${T("町の人の")} ${d.slope.rate}%`],
    [T("そのうち65歳以上"), `${T("約")} ${n(d.slope.over65)} ${T("人")}`, `${T("65歳以上の")} ${d.slope.over65Rate}%`],
    [T("急な坂が多い所に住む人"), `${T("約")} ${n(d.steep.people)} ${T("人")}`, `${T("町の人の")} ${d.steep.rate}%`],
    ...(here ? [[esc(here.name), `${here.rate}%`, T("坂が多い所に住む人の割合")]] : []),
  ].map(([l, v, s]) => `<li><span class="l">${l}</span><strong>${v}</strong><span class="s">${s}</span></li>`).join("");
  $("slope-note").innerHTML = `${esc(T(d.note))}${KU()}${T("避難の道や、毎日の買い物・通院の道のりが、お年寄りには重くなります。")}${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("・")}`;
}

// 防災計画の、町・字に関係する所（scripts/plan-excerpts.mjs。Claude が引用つきで抜き出し、人が確かめてから出す）
async function showPlan(code, part) {
  const d = await getData(`data/plan/${code}.json`);
  if (!d) return;
  $("plan-block").hidden = false;
  const src = d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("・");
  if (d.status !== "ok" && d.status !== "auto") {
    $("plan-pick").hidden = true;
    $("plan").innerHTML = `<p class="gomi-today">${icon("eye")} ${T("防災計画から町・字ごとに抜き出したものは、まだ確認中です。それまでは町の防災計画をご覧ください。")}</p>`;
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
    $("plan").innerHTML = p ? `<ol class="plan-points">${p.points.map((x) => `<li><p>${esc(x.text).replace(/\d{4,}(?=人)/g, (n) => Number(n).toLocaleString("ja-JP"))}</p>${x.cites.map((c) => `<a class="cite" href="${esc(c.url)}#page=${c.page}" target="_blank" rel="noopener" title="${esc(c.quote)}">${esc(c.doc.replace(/^.*?（.*?）/, ""))} ${c.page}${T("ページ")}</a>`).join("")}</li>`).join("")}</ol>`
      : `<p>${T("この町・字の名前が出てくる所は、防災計画に見つかりませんでした。")}</p>`;
  };
  sel.addEventListener("change", draw);
  draw();
  $("plan-note").innerHTML = `${esc(T(d.note))}${KU()}${src}`;
}

// 大きな地震の揺れの確率（J-SHIS × 250m 四方の人口。scripts/build-quake-pop.mjs が作る）
async function showQuake(code, part) {
  const d = await getData(`data/quake-pop/${code}.json`);
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
  $("quake-note").innerHTML = `${esc(T(d.note))}${KU()}${T("確率 26% はおよそ100年に1回、6% はおよそ500年に1回、3% はおよそ1000年に1回の揺れにあたります。")}${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("・")}`;
}

// 買い物に困っているお年寄り（農林水産政策研究所の推計を引用。scripts/build-shop-access.mjs）
async function showShopAccess(code) {
  const d = await getData(`data/shop-access/${code}.json`);
  if (!d) return;
  $("shop-block").hidden = false;
  const n = (v) => v.toLocaleString("ja-JP");
  const cmp = (v, nat) => (v > nat + 1 ? T("全国より高い") : v < nat - 1 ? T("全国より低い") : T("全国と同じくらい"));
  $("shop").innerHTML = `<ul class="acc-stats">
      <li><span class="l">${T("65歳以上")}</span><strong>${d.rate}%</strong><span class="s">${T("約")} ${n(d.people)} ${T("人")}・${T("全国")} ${d.nationRate}%（${cmp(d.rate, d.nationRate)}）</span></li>
      <li><span class="l">${T("75歳以上")}</span><strong>${d.rate75}%</strong><span class="s">${T("約")} ${n(d.over75)} ${T("人")}・${T("全国")} ${d.nationRate75}%（${cmp(d.rate75, d.nationRate75)}）</span></li>
    </ul>
    <p class="fp-here">${T("店まで 500m 以上あり、車を使うのが難しい65歳以上の人の割合です（2020年の推計）。")}</p>`;
  $("shop-note").innerHTML = `${esc(T(d.note))}${KU()}${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("")}`;
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
  // 明るい話題：2050年まで人口が減りにくい町（全国の上から1割）は、それを添える（10番目までは順番で、それより下は「全国でも減りにくいほう」）
  const ratio = (p) => p.at(-1) / p[0];
  const rank = Object.values(d.towns).filter((x) => ratio(x.pop) > ratio(t.pop)).length + 1;
  const total = Object.keys(d.towns).length;
  const bright = rank <= total / 10 ? `<span class="bright">${icon("sun")} ${ratio(t.pop) > 1 ? T("2050年まで人口が増えると推計される町です。") : ""}${rank <= 10 ? TN("人口の減りにくさは、全国 {n} の市区町村で {r} 番目です", { n: total.toLocaleString("ja-JP"), r: rank }) : T("人口の減りにくさは、全国でも高いほうです")}</span>` : "";
  $("future-head").innerHTML = `${T("2050年の人口は、2020年の")} <strong>${idx(t.pop)}%</strong>（${T("約")} ${n(Math.round(t.pop.at(-1) / 10) * 10)} ${T("人")}）<span>${T("全国")} ${idx(d.nation.pop)}%${t.old ? `・${T("65歳以上の割合")} ${t.old[0]}% → ${t.old.at(-1)}%（${T("全国")} ${d.nation.old.at(-1)}%）` : ""}</span>${bright}`;
  $("future").innerHTML = d.years.map((y, i) => `<li><span class="y">${y}</span><span class="bar"><i style="height:${(t.pop[i] / max) * 100}%"></i></span><span class="v">${n(Math.round(t.pop[i] / 100) * 100)}</span>${t.old ? `<span class="o">${t.old[i]}%</span>` : ""}</li>`).join("");
  $("future-note").innerHTML = `${T("棒は総人口、下の % は65歳以上の割合です。")}${esc(T(d.note))}。<a href="${esc(d.source.url)}" target="_blank" rel="noopener">${esc(d.source.title)}</a>`;
}

// バスの便利さ（公開されている時刻表データ × 250m 四方の65歳以上。scripts/build-bus.mjs）
async function showBus(code, part) {
  const d = await getData(`data/bus/${code}.json`);
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
  // 平日の時刻表（作者「余裕があったら、バスのルートを地図に表示、もしくは、時刻表を表示ができるといいな」）。バス停を選ぶと、路線と行き先ごとに、時間ごとの分を並べる
  const withTimes = d.stops.filter((s) => s.times?.length).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  if (withTimes.length) {
    $("bus-tt-box").hidden = false;
    const sel = $("bus-stop");
    sel.innerHTML = withTimes.map((s, i) => `<option value="${i}">${esc(s.name)}（${s.times.length}）</option>`).join("");
    const draw = () => {
      const st = withTimes[Number(sel.value)];
      const groups = new Map();
      for (const x of st.times) { const k = `${x.r}${x.h ? ` → ${x.h}` : ""}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x.t); }
      $("bus-tt").innerHTML = [...groups].map(([k, ts]) => {
        const byH = new Map();
        for (const t of ts) { const [hh, mm] = t.split(":"); if (!byH.has(hh)) byH.set(hh, []); byH.get(hh).push(mm); }
        // 平日なら、今日このあとの便をいちばん上に出す
        const now = new Date(), wd = now.getDay() >= 1 && now.getDay() <= 5;
        const hm = now.getHours() * 60 + now.getMinutes();
        const next = wd ? [...ts].sort().find((t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m >= hm; }) : null;
        return `<div class="tt"><p class="tt-head">${icon("bus")}${esc(k)}</p>${wd ? `<p class="tt-next">${next ? `${T("次の便")} <strong>${Number(next.split(":")[0])}:${next.split(":")[1]}</strong>` : T("平日の時刻表では、今日このあとの便はありません")}</p>` : ""}<table>${[...byH].map(([hh, ms]) => `<tr><th>${Number(hh)}</th><td>${ms.join(" ")}</td></tr>`).join("")}</table></div>`;
      }).join("") + `<p class="note">${T("平日の時刻表です。土日・祝日はちがうことがあります。乗る前に、バス会社や町の時刻表で確かめてください。")}</p>`;
    };
    sel.addEventListener("change", () => { remember.set(`bus:${code}`, withTimes[Number(sel.value)]?.name ?? ""); draw(); });
    // 前に選んだバス停、なければいちばん本数の多いバス停を、はじめに選んでおく
    const saved = withTimes.findIndex((s) => s.name === remember.get(`bus:${code}`));
    sel.value = String(saved >= 0 ? saved : withTimes.indexOf(withTimes.reduce((a, b) => (b.n > a.n ? b : a))));
    draw();
  }
  $("bus-stops").innerHTML = d.stops.slice(0, 8).map((s) => `<li><span class="no">${s.n}</span><span>${esc(s.name)}</span></li>`).join("");
  $("bus-note").innerHTML = `${esc(T(d.note))}${KU()}${T("丸の中の数は、平日1日に出る便の数です。")}${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("・")}`;
}

// 道の安全（交通事故。scripts/build-accidents.mjs が警察庁のオープンデータから作る）
async function showAccidents(code, part) {
  const d = await getData(`data/accidents/${code}.json`);
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
  $("acc-note").innerHTML = `${esc(T(d.note))}${KU()}${T("町の外から通る車の事故も入るので、人の数で割った値はめやすです。")}${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("")}`;
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
  const shelters = await getData(`data/shelters/${code}.json`);
  if (!shelters) return false;
  $("hinan-block").hidden = false;
  // 災害の種類のボタンは、この町のデータにある種類から作る（津波の避難場所がない町もある）
  const ORDER = ["津波", "洪水", "土砂", "高潮", "地震", "火事", "内水", "火山"];
  // 札に出す言葉（データの種類の名前はそのまま）。「内水」は住む人に分かりにくいので添える
  const count = (k) => shelters.features.filter((f) => f.properties.kinds.includes(k)).length;
  const kinds = ORDER.filter((k) => count(k));
  let kind = kinds.includes("津波") ? "津波" : kinds.includes("地震") ? "地震" : kinds[0] ?? "";
  $("hinan-kinds").innerHTML = [...kinds, ""].map((k) =>
    `<button type="button" data-kind="${k}" aria-pressed="${k === kind}">${k ? T(KIND_LABEL[k] ?? k) : T("すべて")}<small>${k ? count(k) : shelters.features.length}</small></button>`).join("");
  let here = null; // [経度, 緯度]

  // 町・字を選ぶ（形のおおよその真ん中を、その町・字の場所のめやすにする）
  const center = (f) => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const ring = polys.reduce((a, b) => (b[0].length > a[0].length ? b : a))[0];
    return ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
  };
  const sel = $("hinan-town");
  sel.innerHTML = `<option value="">${T("（選ぶ）")}</option>` + townFeatures.map((f) => `<option value="${f.properties.part}">${esc(f.properties.name)}</option>`).join("");

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
  $("hinan-here").addEventListener("click", () => buttons.locate());

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
    const pick = startPart || remember.get(`hinan:${code}`);
    if (pick && [...sel.options].some((o) => o.value === pick)) { sel.value = pick; sel.dispatchEvent(new Event("change")); }
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
    remember.set(`hinan:${code}`, sel.value);
    const f = townFeatures.find((x) => x.properties.part === sel.value);
    if (f) setHere(center(f), `${f.properties.name}（町・字のおおよその真ん中）`);
    // 防災計画の欄も同じ町・字に合わせる（別々に選び直さなくてよいように）
    const plan = $("plan-part");
    if (f && plan && [...plan.options].some((o) => o.value === sel.value)) { plan.value = sel.value; plan.dispatchEvent(new Event("change")); }
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
    // 数の入る文は {m} などの印つきで訳す（TT。i18n.js）
    const flood = (k, label) => TN("{kind}の浸水の想定", { kind: T(k) }) + " " + label;
    $("hinan-here").innerHTML = TN("選んだ場所：海抜 約 {h}", { h: h0 != null ? `${Math.round(h0)}m` : T("（分からない）") })
      + (hz ? `・${flood(hz, `<strong>${esc(T(d0?.label ?? "区域の外（想定なし）"))}</strong>`)}` : "");
    const walks = [];
    $("hinan-walk").hidden = true;
    await Promise.all(cand.map(async (c, i) => {
      const p = c.f.geometry.coordinates;
      const [h, d, w] = await Promise.all([elevationAt(...p), hz ? depthAt(hz, ...p) : null, walkMinutes(at, p, c.m)]);
      if (token !== setHere.token) return;
      if (w.hasElevation) walks.push({ i, name: c.f.properties.name, m: c.m, up: w.up, min: w.min });
      const li = document.querySelector(`#hinan-list li[data-i="${i}"] .d`);
      if (!li) return;
      li.innerHTML = TN("まっすぐ {m}m・歩いて約 {min}分", { m: c.m.toLocaleString("ja-JP"), min: Math.max(1, Math.round(c.m / 60)) })
        + (w.hasElevation ? `・<strong>${TN("坂を考えると約 {min}分", { min: w.min })}</strong>（${TN("上り {up}m・下り {down}m", { up: w.up, down: w.down })}）` : "")
        + `<br>${TN("避難場所の海抜 約 {h}", { h: h != null ? `${Math.round(h)}m` : T("（分からない）") })}`
        + (hz ? `・${flood(hz, d?.label ? `<strong class="warn">${esc(T(d.label))}</strong>` : T("区域の外"))}` : "");
    }));
    // 防災散歩：近い3つのうち、上りがいちばん少ない避難場所まで、ふだんの散歩で一度歩いてみる。道は持っていないので、まっすぐの線のめやすだと書く
    if (token !== setHere.token || !walks.length) return;
    const w = walks.sort((a, b) => a.up - b.up || a.m - b.m)[0];
    $("hinan-walk").hidden = false;
    const wc = cand[w.i].f.geometry.coordinates;
    $("hinan-walk").innerHTML = `<p class="t">${icon("heart")}${T("防災散歩")}</p>`
      + `<p>${TN("ふだんの散歩で、一度 {name}（{i}）まで歩いてみませんか。往復 約 {m}m・約 {min}分（行きの上り {up}m）。近い {n} つの中で、上りがいちばん少ない所です。", { name: `<strong>${esc(w.name)}</strong>`, i: w.i + 1, m: (w.m * 2).toLocaleString("ja-JP"), min: w.min * 2, up: w.up, n: walks.length })}</p>`
      + `<p class="note">${T("長さと上りは、まっすぐの線で測っためやすです。歩く道は、町の地図や現地で選んでください。夜や雨の日の道も、明るいうちに一度見ておくと安心です。")}</p>`
      + `<a class="gmap" href="${gmapWalk(wc, at)}" target="_blank" rel="noopener">${icon("map")}${T("Google マップで歩く道を見る")}</a>`;
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
    // 地図の読み込みが終わる前に町・字を選んだときは、読み込みのあとにする（印を置く所がまだ無い）
    if (!map.getSource("here")) { setTimeout(() => setHere(at, label), 300); return; }
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
        <span class="d">${TN("まっすぐ {m}m・歩いて約 {min}分", { m: c.m.toLocaleString("ja-JP"), min: Math.max(1, Math.round(c.m / 60)) })}（${T("めやす")}）</span>
        <span class="k">${esc(String(c.f.properties.address ?? "").replace(/(\S{2,}?[郡市区町村])\1/g, "$1"))}・${esc(c.f.properties.kinds.map((k) => T(k)).join("・"))}${c.f.properties.capacity ? `・${capText(c.f.properties)}` : ""}${c.f.properties.note ? `・${esc(c.f.properties.note)}` : ""}</span>
        <a class="gmap" href="${gmapWalk(c.f.geometry.coordinates, at)}" target="_blank" rel="noopener">${icon("map")}${T("Google マップで歩く道を見る")}</a></li>`).join("");
    for (const li of document.querySelectorAll("#hinan-list li")) {
      li.addEventListener("click", (e) => { if (!e.target.closest("a")) select(Number(li.dataset.i)); }); // Google マップのボタンは地図を動かさない
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(Number(li.dataset.i)); } });
    }
    const token = (setHere.token = (setHere.token ?? 0) + 1);
    calc(at, token);
    $("hinan-note").innerHTML = TN("{from}から、{what}の近い順。", { from: esc(label), what: kind ? TN("{kind}のときに使える指定緊急避難場所", { kind: T(kind) }) : T("すべての指定緊急避難場所") })
      + T("距離はまっすぐ測ったもので、坂や道の曲がりは考えていません。歩く時間は1分60m（お年寄りの歩く速さ）のめやすで、坂はまっすぐの線の上の上り下りから見積もったものです（道の坂とは違います）。海抜は地理院タイル（標高タイル）、浸水の深さは想定の地図の色から読んだめやすです。避難の判断は町の案内に従ってください。") + `<br>${T("出典")}：${esc(shelters.source.title)}（${esc(shelters.source.license)}・${shelters.source.updated ? `${esc(shelters.source.updated)} 更新のものを ` : ""}${esc(shelters.source.fetchedAt)} に取得）を加工`;
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
    const tr = await getData(`data/translations/${code}.json`);
    for (const a of answers) {
      const x = tr?.langs?.[LANG]?.items.find((i) => i.qid === a.qid && (i.status === "auto" || i.status === "ok") && i.original === a.value);
      if (x) Object.assign(a, { valueJa: a.value, value: seireki(x.text, LANG), translated: true, shortT: x.short });
    }
  }
  yardstick = (await getData("data/yardstick.json")) ?? { questions: [] };
  health = await getData("data/health.json");
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
    box.innerHTML = (p ? `<div class="page-banner" style="--h:${ILLUST[p.view]?.h ?? 200}">${illust(p.view)}<p><strong>${esc(T(p.title))}</strong>${esc(T(p.desc))}${list.length ? `<span>${T("公式のサイトから確かめた答え")} ${list.length}</span>` : ""}</p></div>` : "")
      + (list.length && scopeNote && !list.some((a) => a.level) ? `<p class="note">${esc(scopeNote)}</p>` : "")
      + (list.length ? answersHTML(list) : "")
      + (p?.later && !list.length ? `<p class="later"><span>${T("準備中")}</span>${LANG ? `${esc(T(p.later))} — ${T("町の公式のサイトから探して、出典つきでここに出します。")}` : `${esc(p.later)}を、町の公式のサイトから探して、出典つきでここに出します。`}</p>` : "")
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
// 電話番号は押してかけられるように（住む人の目で見ると、答えの中の番号が押せない文字のままだった）
const TEL = /(?<![\d-])(0\d{1,4}-\d{1,4}-\d{3,4})(?![\d-])/g;
const telLinks = (html) => html.replace(TEL, (m) => `<a class="tel" href="tel:${m.replace(/-/g, "")}">${m}</a>`);
// 急ぐときの番号（119・110・#7119・#8000 など）も、ページのどこに書いてあっても押してかけられるように。
// 文字のあとから書き足すので、答えのカード・注意書き・訳のどれにも効く（「110人」「119か所」のような数は除く）
const URGENT = /(#\d{4})(?![\d-])|(?<![\d０-９\-.,#:])(119|110)(?=\s*(?:へ|番|に|、|。|・|）|】|か|$))/g;
function linkUrgent(root) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest("a, button, select, option, script, style, textarea, summary") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const hits = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) { URGENT.lastIndex = 0; if (URGENT.test(n.nodeValue)) hits.push(n); }
  for (const n of hits) {
    const span = document.createElement("span");
    span.innerHTML = esc(n.nodeValue).replace(URGENT, (m) => `<a class="tel" href="tel:${m.replace("#", "%23")}">${m}</a>`);
    n.replaceWith(...span.childNodes);
  }
}
// 中身はあとから少しずつ描かれるので、変わるたびに（まとめて）書き足す
{
  let t = null;
  const run = () => { t = null; for (const el of document.querySelectorAll(".town-main, .about-site")) linkUrgent(el); };
  new MutationObserver(() => { t ??= setTimeout(run, 300); }).observe(document.body, { childList: true, subtree: true });
}
// 調べた側の言い方を、住む人向けに（「今回調べた範囲では」「今回は」など。日本語の答えだけ）
const residentText = (s) => String(s ?? "").replace(/今回(調べた範囲|の調べ)では、?/g, "町の公式サイトでは、").replace(/見た公式ページには/g, "町の公式サイトには").replace(/今回は/g, "");
function answerParts(a) {
  const lines = prettyText(a.translated ? a.value : residentText(a.value), esc).split("<br>").filter(Boolean);
  const [lead, ...rest] = lines;
  return { lead: `<p class="lead">${telLinks(numbers(lead ?? ""))}</p>`, rest: rest.length ? `<ul class="pts">${rest.map((l) => `<li>${telLinks(numbers(l))}</li>`).join("")}</ul>` : "", leadText: lead ?? "" };
}
function answerBody(a) {
  const p = answerParts(a);
  return p.lead + p.rest;
}
function answersHTML(answers) {
  // 見つからなかった答えも隠さず出す（届いていないことの手がかり。町の人に聞きたいこと）
  const notFound = (a) => a.value === "見つからなかった";
  // 答えが4つ以上あるページは、各カードを「見出し＋要点（＋最初の電話）」にし、残りは「くわしく」にたたむ（困ったとき・手続き・子育てが6〜7画面あった）
  const fold = answers.length >= 4;
  return `<ul class="answers${fold ? " folded-cards" : ""}">${answers.map((a) => {
    const ill = ILLUST[PAGE_OF(a.qid)] ?? ILLUST.shiru;
    const p = !notFound(a) && !(a.items && !a.translated) ? answerParts(a) : null;
    const tel = p && fold && !TEL.test(p.leadText) ? String(a.value).match(TEL)?.[0] : null;
    TEL.lastIndex = 0;
    const more = (inner) => (fold && p ? `${tel ? `<a class="tel-quick" href="tel:${tel.replace(/-/g, "")}">${icon("phone")}${tel}</a>` : ""}<details class="a-more"><summary>${T("くわしく")}</summary>${inner}</details>` : inner);
    return `
    <li class="${notFound(a) ? "not-found" : ""}" id="a-${esc(a.qid ?? "")}" style="--h:${ill.h}">
      <span class="badge" aria-hidden="true">${icon(ANSWER_ICON[a.qid] ?? ill.main)}</span>
      <div class="body">
      <h3 class="short">${esc(a.shortT ?? T(yardstick.questions.find((x) => x.id === a.qid)?.short ?? ""))}${a.level ? `<span class="lvl">${esc(a.level)}${T("の答え")}</span>${a.translated ? `<span class="lvl ai">${T("AI による訳")}</span>` : ""}` : ""}</h3>
      ${notFound(a)
        ? `<p class="lead">${T("公開の資料では見つかりませんでした")}</p><p class="src">${a.checkedAt ? `${esc(a.checkedAt.slice(0, 10))}・` : ""}${T("町の人に聞きたいことです")}</p>`
        : `${p ? p.lead : ""}${more(`${p ? p.rest : ""}
      ${a.items ? `<ul class="topics${a.translated ? " src-only" : ""}">${a.items.map((x) => `<li>${a.translated ? "" : `<span class="tx">${esc(x.text)}</span>`}
        <span class="src">${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title ?? x.url)}</a>` : esc(x.title ?? "")}${x.asOf ? `・${esc(x.asOf)}` : ""}</span></li>`).join("")}</ul>` : ""}
      ${a.recheckedAt ? `<p class="src rechecked">${icon("eye")}${T("公式のページが変わったので、確かめ直しました")}（${esc(a.recheckedAt.slice(0, 10))}）</p>` : ""}
      ${health?.links?.[a.source?.url]?.kind === "gone" ? `<p class="gone">${T("出典のページが見つからなくなっています")}（${esc(health.links[a.source.url].checkedAt.slice(0, 10))}）。${T("町の公式のサイトで新しいページを探して確かめてください。")}</p>` : ""}
      ${a.outdated ? `<p class="outdated"><strong>${T("もっと新しい資料があります")}</strong>：${esc(a.outdated.what)}。${T("古い")}：${a.outdated.old?.url ? `<a href="${esc(a.outdated.old.url)}" target="_blank" rel="noopener">${esc(a.outdated.old.asOf ?? "")}</a>` : esc(a.outdated.old?.asOf ?? "")}／${T("新しい")}：${a.outdated.new?.url ? `<a href="${esc(a.outdated.new.url)}" target="_blank" rel="noopener">${esc(a.outdated.new.asOf ?? "")}</a>` : esc(a.outdated.new?.asOf ?? "")}</p>` : ""}
      <p class="src chip">${icon("link")} ${a.source?.url ? `<a href="${esc(a.source.url)}" target="_blank" rel="noopener"${a.source.where ? ` title="${esc(T("出典のどこに書いてあるか"))}：${esc(a.source.where)}"` : ""}>${esc(a.source.title ?? a.source.url)}</a>` : esc(a.source?.title ?? "")}${a.asOf ? `・${T("時点")} ${esc(a.asOf)}` : ""}${a.status === "auto" ? "" : `・${T("人が確かめた")}`}</p>`)}`}
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
  $("med-cite").innerHTML = `出典：<a href="${esc(m.source.url)}" target="_blank" rel="noopener">${esc(m.source.title)}</a>（${esc(m.source.asOf)}・${esc(m.source.license)}）を加工。祝日：${esc(m.holidaySource?.title ?? "")}${KU()}${center ? "距離は町・字のおおよその真ん中からまっすぐ測ったものです。" : ""}`;
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
    row("gomi", T("ごみ"), gomiToday ? (gomiToday.length ? TN("今日は {k} の日", { k: gomiToday.join("・") }) : T("今日はごみの収集はありません")) : has("gomi") ? T("ごみの出し方を見る") : T("地区ごとの収集日は準備中です"), has("gomi") || !!gomiToday),
    medicalRow ?? row("iryo", T("病院"), T("この町の病院のデータはまだありません"), false),
    row("bousai", T("避難"), hasHinan ? T("わが家から近い避難場所を出す") : has("bousai") ? T("避難場所の案内を見る") : T("避難場所は準備中です"), hasHinan || has("bousai")),
    row("komatta", T("困ったとき"), has("komatta") ? T("電話・メールの窓口を見る") : T("電話・メールの窓口は準備中です"), has("komatta")),
  ].join("");
  $("tiles").innerHTML = PAGES.filter((p) => !["today", "source", "research", "mitate"].includes(p.view)).map((p) => {
    // 中身があるか：Claude の答え・わが家の避難・病院のデータ・町のデータ
    // 答えが無くても、国のデータの欄（重ねて見る地図・バス・事故・買い物など）が出ていれば中身がある
    // （作者「大泉町、暮らしの場面、地図が準備中になっているのは正しい？」：地図のページは答えが無く、地図だけなので準備中と出ていた）
    const blocks = [...document.querySelectorAll(`.view[data-view="${p.view}"] > section.block`)].filter((s) => !s.hidden && !s.querySelector(".answers-box")).length;
    const n = (p.feature ? 1 : 0) + has(p.view) + blocks + (p.view === "bousai" && hasHinan ? 1 : 0) + (p.view === "shiru" ? 1 : 0) + (p.view === "iryo" && medicalRow && !medicalRow.includes("later") ? 1 : 0) + (p.view === "foreign" && !$("tr-block").hidden ? 1 : 0);
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
// いま見ているページの欄（見出しのある欄）。すべてのページのいちばん上に「このページの中」として出す
// （右下の「目次」のボタンをやめて、ここにまとめた。作者「目次は他の一覧にまとめて」）
let hereSecs = [];
function renderAllPages(filter = "") {
  const f = filter.replace(/\s/g, "");
  const hit = (s) => !f || s.replace(/\s/g, "").includes(f);
  const view = document.querySelector(`.view[data-view="${currentView()}"]`);
  hereSecs = view ? [...view.querySelectorAll(":scope > section.block")].filter((s) => !s.hidden && s.querySelector(":scope > h2")) : [];
  const page = PAGES.find((p) => p.view === currentView());
  const here = hereSecs.map((s, i) => [s.querySelector(":scope > h2").textContent.trim(), i]).filter(([t]) => hit(t));
  $("all-list").innerHTML = (hereSecs.length >= 2 && here.length ? `<section class="all-sec all-here">
      <p class="all-page"><span class="t">${icon(ILLUST[page?.view]?.main)}${esc(T("このページの中"))}</span><span class="d">${esc(page?.local ? T("調べる") : T(page?.title ?? ""))}</span></p>
      <ul>${here.map(([t, i]) => `<li><button type="button" data-sec="${i}">${esc(t)}</button></li>`).join("")}</ul>
    </section>` : "") + allPages.map((p) => {
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
  // タブの並びはほかの言葉のときに作り直す（renderTabs）ので、ボタンそのものではなく並び全体で受け取る（作り直すと処理が消え、日本語以外で押しても開かなかった）
  // 上のメニューと下のメニューの両方から開く
  document.addEventListener("click", (e) => { if (!e.target.closest(".open-all")) return; $("all-search").value = ""; renderAllPages(); dlg.showModal(); });
  $("close-all").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // 外を押すと閉じる
  $("all-search").addEventListener("input", (e) => renderAllPages(e.target.value));
  $("all-list").addEventListener("click", (e) => {
    // このページの中：たたんである欄は開いてから、そこへ動く
    const b = e.target.closest("button[data-sec]");
    if (b) {
      const s = hereSecs[Number(b.dataset.sec)];
      dlg.close();
      if (s.classList.contains("folded")) s.querySelector(":scope > h2").click();
      s.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
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

// 近くの介護の事業所（厚生労働省の介護サービス情報公表システムのオープンデータ。scripts/build-kaigo.mjs）。
// 相談・通う・家に来る・泊まる／住む の4つに分け、名前・種類・電話・住所を出す。重ねて見る地図にも点が出る
const KAIGO_GROUPS = [["相談", "まず相談するなら（ケアマネジャーのいる事業所）"], ["通う", "日中に通う"], ["家に来る", "家に来てもらう"], ["泊まる・住む", "泊まる・住む"]];
async function showKaigo(code) {
  const d = await getData(`data/kaigo/${code}.json`);
  if (!d?.items?.length) return;
  $("kaigo-block").hidden = false;
  $("kaigo-list").innerHTML = KAIGO_GROUPS.map(([g, label], gi) => {
    const list = d.items.filter((x) => x.group === g);
    if (!list.length) return "";
    return `<details class="kaigo-group"${gi === 0 ? " open" : ""}><summary><strong>${esc(T(label))}</strong> <span class="n">${list.length}</span></summary>
      <ul class="kaigo-items">${list.map((x) => `<li><span class="kn">${esc(x.name)}</span><small>${esc(T(x.kind))}</small>${x.tel ? `<a class="tel" href="tel:${esc(x.tel)}">${icon("phone")}${esc(x.tel)}</a>` : ""}<small class="ad">${esc(x.addr)}</small></li>`).join("")}</ul></details>`;
  }).join("");
  $("kaigo-note").innerHTML = `${esc(T(d.note))}${KU()}${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(T(s.title))}</a>`).join("")}`;
}

// 母語で読める人：確かめ済みの答え「国籍ごとの人数」と「防災マップの外国語版」を並べ、国籍ごとに
// 町の防災マップに母語の版があるか・このページで母語で読めるかを出す（台本の大泉町の場面「マップの言葉と国籍の割合を並べる」）。
// 母語は国籍から推し量ったものなので「めやす」と書く
const MOTHER_TONGUE = {
  ブラジル: "pt", ポルトガル: "pt", ペルー: "es", ボリビア: "es", アルゼンチン: "es", パラグアイ: "es", コロンビア: "es", メキシコ: "es", スペイン: "es",
  インドネシア: "id", ネパール: "ne", ベトナム: "vi", フィリピン: "tl", 中国: "zh", 台湾: "zh", 韓国: "ko", ミャンマー: "my",
  バングラデシュ: "bn", バングラディシュ: "bn", スリランカ: "si", タイ: "th", 米国: "en", アメリカ: "en", 英国: "en", イギリス: "en",
};
const TONGUE_JA = { pt: "ポルトガル語", es: "スペイン語", id: "インドネシア語", ne: "ネパール語", vi: "ベトナム語", tl: "フィリピノ語", zh: "中国語", ko: "韓国語", my: "ミャンマー語", bn: "ベンガル語", si: "シンハラ語", th: "タイ語", en: "英語" };
async function showLangGap(code) {
  const all = Object.values(answersByPage).flat();
  const shortOf = (a) => yardstick.questions.find((q) => q.id === a.qid)?.short ?? "";
  const nat = all.find((a) => shortOf(a) === "国籍ごとの人数");
  const map = all.find((a) => shortOf(a) === "防災マップの外国語版");
  if (!nat || !map) return;
  const natText = nat.valueJa ?? nat.value;
  const mapText = (map.valueJa ?? map.value).split("\n")[0];
  const rows = [...natText.matchAll(/([^\s\d位]+?) ([\d,]+)人（([\d.]+)%）/g)]
    .map(([, name, n, rate]) => ({ name, n, rate: Number(rate), tongue: MOTHER_TONGUE[name] }))
    .filter((r) => r.name !== "その他" && r.name !== "合計");
  if (rows.length < 3) return;
  // 町のマップの言葉：答えの1行目に出てくる言葉の名前
  const onMap = new Set(Object.entries(TONGUE_JA).filter(([, ja]) => mapText.includes(ja)).map(([k]) => k));
  const tr = await getData(`data/translations/${code}.json`);
  const here = new Set(Object.keys(tr?.langs ?? {}));
  const sum = (f) => rows.filter(f).reduce((s, r) => s + r.rate, 0).toFixed(1);
  const mark = (ok) => (ok ? `<span class="lg-yes">${T("あり")}</span>` : `<span class="lg-no">${T("なし")}</span>`);
  const max = Math.max(...rows.map((r) => r.rate));
  $("langgap-block").hidden = false;
  $("langgap-lead").innerHTML = TN("外国の住民のうち、町の防災マップを母語で読める人は約 <strong>{map}%</strong>。このページの訳を足すと約 <strong>{here}%</strong>（めやす）", { map: sum((r) => onMap.has(r.tongue)), here: sum((r) => onMap.has(r.tongue) || here.has(r.tongue)) });
  $("langgap").innerHTML = `<li class="lg-head"><span>${T("国籍")}</span><span>${T("母語（めやす）")}</span><span>${T("町の防災マップ")}</span><span>${T("このページ")}</span></li>`
    + rows.map((r) => `<li><span class="lg-nat">${esc(T(r.name))}<small>${r.n}${LANG ? " " : ""}${T("人")}・${r.rate}%</small><i class="lg-bar" style="width:${(r.rate / max) * 100}%"></i></span><span>${esc(T(TONGUE_JA[r.tongue] ?? "—"))}</span><span>${mark(onMap.has(r.tongue))}</span><span>${mark(here.has(r.tongue))}</span></li>`).join("");
  $("langgap-note").innerHTML = `${T("母語は国籍から推し量ったものです（ブラジル＝ポルトガル語、ペルー・ボリビア＝スペイン語など）。英語やほかの言葉が読める人もいます。")}${KU()}${[nat, map].map((a) => a.source?.url ? `<a href="${esc(a.source.url)}" target="_blank" rel="noopener">${esc(a.source.title ?? a.source.url)}</a>` : "").filter(Boolean).join("・")}`;
}

// 母語で防災：Claude が訳し、別の Claude が訳し戻して確かめた訳（site/data/translations/{コード}.json）。
// 確かめで意味がずれた訳は、人が OK するまで出さず、もとの日本語を出す
const TR_NOTE = {
  pt: "Tradução feita por IA. Outra IA traduziu de volta para o japonês para conferir o sentido. Confirme as informações oficiais no site da cidade.",
  es: "Traducción hecha por IA. Otra IA la tradujo de nuevo al japonés para comprobar el sentido. Confirme la información oficial en el sitio del municipio.",
  en: "Translated by AI. Another AI translated it back into Japanese to check the meaning. Please check the official information on the town's website.",
  easy: "AI が やさしい にほんごに しました。べつの AI が もとの ことばと おなじ いみか たしかめました。ただしい ことは まちの ホームページで たしかめて ください。",
  id: "Diterjemahkan oleh AI. AI lain menerjemahkannya kembali ke bahasa Jepang untuk memeriksa artinya. Silakan periksa informasi resmi di situs web kota.",
  ne: "AI ले अनुवाद गरेको। अर्को AI ले अर्थ जाँच्न फेरि जापानीमा अनुवाद गर्‍यो। आधिकारिक जानकारी नगरको वेबसाइटमा जाँच गर्नुहोस्।",
  vi: "Bản dịch do AI thực hiện. Một AI khác đã dịch ngược lại sang tiếng Nhật để kiểm tra ý nghĩa. Vui lòng xem thông tin chính thức trên trang web của thành phố.",
  tl: "Isinalin ng AI. Isinalin muli ito ng isa pang AI sa wikang Hapon para suriin ang kahulugan. Pakitingnan ang opisyal na impormasyon sa website ng lungsod.",
};
const TR_PENDING = { pt: "Tradução em verificação. Original em japonês:", es: "Traducción en verificación. Original en japonés:", en: "Translation being checked. Original Japanese:", easy: "いま たしかめて います。もとの にほんご：", id: "Terjemahan sedang diperiksa. Teks asli bahasa Jepang:", ne: "अनुवाद जाँच हुँदैछ। मूल जापानी:", vi: "Bản dịch đang được kiểm tra. Bản gốc tiếng Nhật:", tl: "Sinusuri pa ang salin. Orihinal na Hapon:" };
async function showTranslations(code) {
  const t = await getData(`data/translations/${code}.json`);
  if (!t) { $("foreign-guide").hidden = false; return; } // 訳の無い町だけ、いくつかの言葉で「ブラウザの翻訳を」と案内する
  const langs = Object.keys(t.langs);
  let lang = LANG ?? new URLSearchParams(location.search).get("lang");
  if (!langs.includes(lang)) lang = langs[0];
  $("tr-block").hidden = false;
  $("foreign-guide").hidden = true;
  $("lang-bar").hidden = false;
  const href = (l) => { const u = new URL(location.href); u.searchParams.set("lang", l || "ja"); return u.pathname.split("/").pop() + u.search + u.hash; };
  // 言葉の選び方（作者「言語選択が横に並んでるのも気になる」→ 案B）：地球の印と今の言葉のボタンを1つ置き、押すと全部の言葉の一覧が開く。
  // 横には、すぐ選べる言葉を2つだけ出す（訳はその町に多い国籍の言葉から並べているので、その先頭から。日本語以外を見ているときは日本語を先に）
  const all = [["", "日本語"], ...langs.map((l) => [l, t.langs[l].name])];
  const cur = LANG ?? "";
  const quick = [...(cur ? [all[0]] : []), ...all.slice(1)].filter(([l]) => l !== cur).slice(0, 2);
  const curName = all.find(([l]) => l === cur)?.[1] ?? "日本語";
  $("lang-bar").innerHTML = `<button type="button" class="lang-btn" aria-haspopup="dialog" aria-label="Language / 言語：${esc(curName)}">${icon("globe")}<span>${esc(curName)}</span><span aria-hidden="true">▾</span></button>`
    + quick.map(([l, n]) => `<a href="${href(l)}" lang="${l || "ja"}">${esc(n)}</a>`).join("") + `<span>${T("（AI による訳）")}</span>`;
  $("lang-list").innerHTML = all.map(([l, n]) => `<li><a href="${href(l)}" lang="${l || "ja"}"${cur === l ? " aria-current=\"true\"" : ""}>${esc(n)}</a></li>`).join("");
  const dlg = $("lang-dialog");
  $("lang-bar").querySelector(".lang-btn").addEventListener("click", () => dlg.showModal());
  $("close-lang").onclick = () => dlg.close();
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  // 言葉は上の地球の印のボタンで選んだものだけに合わせる（前は欄の中にも札があり、上と別の言葉が選ばれていて迷った）。
  // 日本語で見ているときは、欄を読む言葉を選ぶボタンだけを出す
  $("tr-langs").innerHTML = LANG ? "" : `<p>${T("読む言葉を選ぶと、町のページ全体とこの欄がその言葉になります。")}</p>` + langs.map((l) => `<a href="${href(l)}" lang="${l}">${esc(t.langs[l].name)}</a>`).join("");
  $("tr-langs").hidden = !!LANG;
  if (!langs.includes(LANG)) { $("tr-note").textContent = ""; $("tr-list").innerHTML = ""; return; }
  lang = LANG;
  const draw = () => {
    const L = t.langs[lang];
    $("tr-note").textContent = TR_NOTE[lang] ?? "";
    // 日本語の答えと同じカードの形（左に絵・要点・箇条）。訳が確かめ中のものは、もとの日本語を出す
    $("tr-list").className = "tr-groups";
    // 元の答えが町のページから下がった訳は出さない（元の答えと同じ文の訳だけ）
    const live = new Set(Object.values(answersByPage).flat().map((a) => a.valueJa ?? a.value));
    const card = (x) => {
      const ok = x.status === "auto" || x.status === "ok";
      const ill = ILLUST[PAGE_OF(x.qid)] ?? ILLUST.foreign;
      const lines = prettyText(ok ? seireki(x.text, lang) : x.original, esc).split("<br>").filter(Boolean);
      return `<li lang="${ok && lang !== "easy" ? lang : "ja"}" style="--h:${ill.h}">
        <span class="badge" aria-hidden="true">${icon(ANSWER_ICON[x.qid] ?? ill.main)}</span>
        <div class="body">
          <h3 class="short">${esc(ok ? x.short : (yardstick.questions.find((q) => q.id === x.qid)?.short ?? x.qid))}</h3>
          ${ok ? "" : `<p class="pending-note">${esc(TR_PENDING[lang] ?? "")}</p>`}
          <p class="lead">${telLinks(numbers(lines[0] ?? ""))}</p>
          ${lines.length > 1 ? `<ul class="pts">${lines.slice(1).map((l) => `<li>${telLinks(numbers(l))}</li>`).join("")}</ul>` : ""}
          ${x.source?.url ? `<p class="src chip">${icon("link")} <a href="${esc(x.source.url)}" target="_blank" rel="noopener">${esc(x.source.title ?? x.source.url)}</a></p>` : ""}
          ${ok ? `<details class="q"><summary>もとの日本語</summary><span lang="ja">${prettyText(x.original, esc)}</span></details>` : ""}
        </div>
      </li>`;
    };
    // 町のページの場面ごとにまとめてたたむ（前は約60画面ぶんが1列に並んでいた）。読みたい場面を押して開く
    const groups = new Map();
    for (const x of L.items.filter((i) => live.has(i.original))) {
      const page = PAGE_OF(x.qid) ?? "shiru";
      if (!groups.has(page)) groups.set(page, []);
      groups.get(page).push(x);
    }
    const order = (v) => { const i = PAGES.findIndex((p) => p.view === v); return i < 0 ? 99 : i; };
    $("tr-list").innerHTML = [...groups].sort((a, b) => order(a[0]) - order(b[0])).map(([page, xs]) => {
      const p = PAGES.find((q) => q.view === page);
      return `<details class="tr-group"><summary>${icon(ILLUST[page]?.main)}<strong>${esc(T(p?.title ?? page))}</strong><span class="n">${xs.length}</span></summary><ol class="answers tr-list">${xs.map(card).join("")}</ol></details>`;
    }).join("");
  };
  draw();
}

// このごみは何ごみ？：町の公式の一覧表から作った辞書（site/data/gomi/{コード}.json）を、入力した言葉で引く。
// ひらがな・カタカナ・全角半角の違いは吸収する。見つからなければ、町の表へ案内する
const kana = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s　・･]/g, "");
async function showGomi(code) {
  const d = await getData(`data/gomi/${code}.json`);
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
  const g = await getData(`data/gomi-days/${code}.json`);
  if (!g) return null;
  $("gomi-days-block").hidden = false;
  // ほかの言葉では、確かめの通った訳で出す（無い文は日本語のまま）
  const gtr = await aiTrGomi(code, g.createdAt);
  const gt = (x) => gtr?.[x] ?? x;
  $("gomi-area-label").textContent = T("地区を選ぶ");
  $("gomi-rules-head").textContent = T("出し方の要点");
  const ok = g.status === "ok" || g.status === "auto";
  $("gomi-rules").innerHTML = g.rules.map((r) => `<li><strong>${esc(gt(r.kind))}</strong><span>${esc(gt(r.how))}${r.time ? `<small>${esc(gt(r.time))}</small>` : ""}</span></li>`).join("");
  $("gomi-days-note").innerHTML = `${esc(T(g.note))}${KU()}${T("出典")}：${g.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title ?? s.url)}</a>`).join("・")}`;
  if (!ok) {
    $("gomi-area").closest("label").hidden = true;
    $("gomi-today").innerHTML = `${icon("eye")} ${T("地区ごとの曜日は、まだ確認中です。それまでは町の収集日の表をご覧ください。")}`;
    return null;
  }
  const sel = $("gomi-area");
  sel.innerHTML = `<option value="">${T("（選ぶ）")}</option>` + g.areas.map((a, i) => `<option value="${i}">${esc(gt(a.area))}${a.towns.length ? `（${esc(a.towns.slice(0, 3).join("・"))}${a.towns.length > 3 ? "…" : ""}）` : ""}</option>`).join("");
  // 町・字のページなら、その名前の地区を選んでおく
  const guess = partName ? g.areas.findIndex((a) => a.area.includes(partName) || a.towns.some((t) => t.includes(partName))) : -1;
  let todayKinds = null;
  const draw = () => {
    const a = g.areas[Number(sel.value)];
    if (!a) { $("gomi-days").innerHTML = ""; $("gomi-today").textContent = T("地区を選ぶと、今日と明日に出せるごみが分かります。"); return; }
    const now = new Date(), tmr = new Date(now.getTime() + 86400000);
    const t0 = a.days.filter((x) => onDay(x.when, now)).map((x) => gt(x.kind)), t1 = a.days.filter((x) => onDay(x.when, tmr)).map((x) => gt(x.kind));
    todayKinds = t0;
    $("gomi-today").innerHTML = `${icon("calendar")} ${T("今日")}：<strong>${t0.length ? esc(t0.join("・")) : T("収集なし")}</strong>　${T("明日")}：<strong>${t1.length ? esc(t1.join("・")) : T("収集なし")}</strong>`;
    $("gomi-days").innerHTML = a.days.map((x) => `<li class="${onDay(x.when, now) ? "today" : ""}"><span class="k">${esc(gt(x.kind))}</span><span class="w">${esc(gt(x.when))}</span></li>`).join("");
  };
  sel.addEventListener("change", () => { remember.set(`gomi:${code}`, sel.value); draw(); });
  const saved = remember.get(`gomi:${code}`);
  if (guess >= 0) sel.value = String(guess);
  else if (saved && g.areas[Number(saved)]) sel.value = saved;
  draw();
  return sel.value ? todayKinds : null;
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
  // 帯の色の説明（「帯の色について」）は出さない：住む人には要らない（作者「全部やる」）。色のもとは README と町を知るの答えにある
  void sym;
  showLayerMap(code, townFeatures, at, esc, part);
  await showHitokoto(code, part);
  await showDekiru(code, part);
  await showChanges(code, part);
  await showFloodPop(code, part);
  await showSlope(code, part);
  await showPlan(code, part);
  await showQuake(code, part);
  await showLore(code);
  await showBus(code, part);
  await showAccidents(code, part);
  await showShopAccess(code);
  await showKaigo(code);
  await showFuture(code);
  await showClimate(code);
  await showLocalSites(code);
  await showQuiz(code);
  const hasHinan = await showHinan(code, townFeatures, startPart);
  await showTranslations(code);
  await showLangGap(code);
  await showGomi(code);
  gomiToday = await showGomiDays(code, part?.properties.name);
  await showAsk(code, part ? `${code}-${startPart}` : null);
  todayLife(hasHinan);
  const local = await fetch("api/ping").then((r) => r.ok).catch(() => false);
  buildAllPages(hasHinan, local);
  if (local) await researchBox(code, part ? startPart : null, part?.properties.name);
  foldPages();
}

// 縦に長いページを短く：各欄を「見出し＋いちばん大事な数の1行」にたたみ、見出しを押すと開く。ページの上に目次の札。
// 最初から開いておくのは、わが家の避難・今日のページの見立てと数から、できることへ・今日と明日と、各ページの最初の1つ
// （作者「やたらと縦が長くなってしまうと、読むのが大変。何か工夫できないかな？」→「たたむ＋目次」）
// 暮らしの場面（ほかのページへの入口の札）も開いておく（作者「『暮らしの場面』は開いていてもいいと思う」）
const FOLD_OPEN = new Set(["hinan-block", "mitate-top", "sec-today", "hitokoto-block", "sec-scenes", "sec-today-life", "gomi-block"]);
function foldSummary(sec) {
  // 確かめた答えの欄は、答えの数
  const answers = sec.querySelectorAll(".answers-box [id^=\"a-\"]").length;
  if (answers) return `${T("確かめた答え")} ${answers} ${T("件")}`;
  // いちばん大事な数：最初の太字の行（中の部品ごとに空白で区切る）。選ぶ欄や注意書きは使わない
  const strong = [...sec.querySelectorAll("strong")].find((x) => !x.closest(".fold-sum, label, select, .note, h2, h3"));
  const el = strong?.closest("p, li") ?? [...sec.querySelectorAll("p, li")].find((x) => !x.closest(".fold-sum, label, .note") && x.textContent.trim());
  if (!el) return "";
  // 文字のかたまりごとに空白で区切り、最初の3つまで（「…」で切らず、最初の1文だけにする）
  const words = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walk.nextNode() && words.length < 3) { const t = walk.currentNode.textContent.replace(/\s+/g, " ").trim(); if (t) words.push(t); }
  return words.join(" ").split("。")[0];
}
function foldPages() {
  for (const view of document.querySelectorAll(".view")) {
    const secs = [...view.querySelectorAll(":scope > section.block")].filter((s) => s.querySelector(":scope > h2"));
    if (secs.length < 3) continue; // 欄が少ないページはたたまない
    secs.forEach((sec, i) => {
      const h = sec.querySelector(":scope > h2");
      if (!sec.dataset.fold) {
        sec.dataset.fold = "1";
        if (!FOLD_OPEN.has(sec.id) && i > 0) sec.classList.add("folded");
        h.setAttribute("role", "button");
        h.tabIndex = 0;
        const toggle = () => { slide(sec, () => sec.classList.toggle("folded")); h.setAttribute("aria-expanded", String(!sec.classList.contains("folded"))); if (!sec.classList.contains("folded")) for (const m of maps) { m.resize(); if (m.fitTo && sec.contains(m.getContainer())) m.fitBounds(m.fitTo.box, { ...m.fitTo.opts, duration: 0 }); } };
        h.addEventListener("click", toggle);
        h.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
        h.insertAdjacentHTML("afterend", `<p class="fold-sum"></p>`);
      }
      h.setAttribute("aria-expanded", String(!sec.classList.contains("folded")));
      sec.querySelector(":scope > .fold-sum").textContent = foldSummary(sec);
    });
  }
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
  if (q.has("lang")) remember.set("lang", q.get("lang") === "ja" ? "" : q.get("lang"));
  if (await setLang(q.get("lang") ?? remember.get("lang"))) { renderTabs(); translateDom(); }
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
  kind ??= chosen.length === 1 ? "町・字" : `${chosen.length}の町・字を合わせて`;

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
  $("pop").textContent = sum("population") ? TN("人口 {n}人・{h}世帯", { n: sum("population").toLocaleString("ja-JP"), h: sum("households").toLocaleString("ja-JP") }) : "人の住んでいない町・字です";
  const rows = [];
  for (const [m, label, w] of TOWN_ROWS) {
    const have = list.filter((p) => p[m] != null && p[w]);
    const weight = have.reduce((s, p) => s + p[w], 0);
    if (!weight) continue;
    const v = have.reduce((s, p) => s + p[m] * p[w], 0) / weight;
    const others = all.map((f) => f.properties[m]).filter((x) => typeof x === "number");
    // 市の町・字の中でどのあたりか（types.js の placeWords）
    const mid = [...others].sort((a, b) => a - b)[Math.floor(others.length / 2)];
    const place = list.length === 1 ? placeWords(others.filter((x) => x > v).length + 1, others.length, mid == null ? null : pct(mid), muniName) : "";
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
  header(name, t.pref, [["日本", "./"], [t.pref, `./?pref=${encodeURIComponent(t.pref)}`], [name, null]]);
  $("pop").textContent = TN("人口 {n}人", { n: t.population.toLocaleString("ja-JP") });
  const rows = [
    ["over65Rate", "65歳以上の人の割合"], ["under15Rate", "15歳未満の子どもの割合"], ["foreignRate", "外国の住民の割合"],
    ["changeRate", "1年の人口の増減"], ["socialChangeRate", "引っ越しによる1年の増減"],
  ];
  $("features").innerHTML = rows.map(([m, label]) => {
    const mid = stats.summary[m]?.median;
    const place = placeWords(t.rank[m], Object.values(stats.towns).filter((x) => !x.ward).length, mid == null ? null : `${mid.toFixed(1)}%`);
    const v = t[m];
    return `<li><span class="label">${label}</span><span class="value">${/change/i.test(m) && v > 0 ? "+" : ""}${pct(v)}</span><span class="place">${place}</span></li>`;
  }).join("");
  $("feature-note").textContent = `全国の市区町村 ${stats.peers.toLocaleString("ja-JP")} と比べています。`;
  await showTypes(code, stats, "");
  const at = await muniPoint(code);
  showToday(code, at);
  await showMedical(code, null); // 市区町村まるごとは、近い順にしない（真ん中が決められないため）
  const towns = await getData(`data/towns/${code}.json`);
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
  getData(`data/shelters/${code}.json`).then((d) => d && $("sources").insertAdjacentHTML("beforeend",
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

// タブの帯：右にまだタブが隠れているあいだだけ、右端に「›」を出す（スマホで横に動かせることが分かりにくかった）
function tabsHint() {
  const nav = document.querySelector(".town-tabs");
  const ul = $("tabs");
  if (!nav || !ul) return;
  nav.classList.toggle("more-right", ul.scrollLeft + ul.clientWidth < ul.scrollWidth - 4);
}
$("tabs").addEventListener("scroll", tabsHint, { passive: true });
addEventListener("resize", tabsHint);
new MutationObserver(tabsHint).observe($("tabs"), { childList: true, subtree: true, attributes: true });
setTimeout(tabsHint, 0);

// カードの開け閉めの動き（作者「カードの開く・閉じるもアニメーションにしてみたい」）：変える前と後の高さを測り、その間をなめらかにつなぐ。
// 開くときは中身もうすく現れる。動きを減らす設定の人には動かさない
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
function slide(el, change) {
  const h0 = el.offsetHeight;
  change();
  const h1 = el.offsetHeight;
  if (reduceMotion.matches || h0 === h1 || !el.animate) return;
  el.style.overflow = "hidden";
  const a = el.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: Math.min(360, 160 + Math.abs(h1 - h0) / 6), easing: "cubic-bezier(.2,.7,.2,1)" });
  if (h1 > h0) for (const c of el.children) if (c.tagName !== "H2" && c.tagName !== "SUMMARY") c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
  a.onfinish = a.oncancel = () => { el.style.overflow = ""; };
}
// たたむ札（くわしく・介護の事業所のまとまり・はじめかたなど、details の開け閉め）にも同じ動き
document.addEventListener("click", (e) => {
  const sum = e.target.closest("details > summary");
  if (!sum || reduceMotion.matches) return;
  const d = sum.parentElement;
  e.preventDefault();
  slide(d, () => { d.open = !d.open; });
});
