// その町ならではのページ：町の特徴（site/data/features.json。国の数字から決めたもの）ごとに、ページを足す。
// 中身は2種類：見る人のブラウザがその場で国のデータから出すもの（widget）と、Claude が公式サイトから探す答え（物差しの問いの feature）
const FEATURES = {
  nougyou: { title: "農業をしている方へ", desc: "霜・低温・高温の先読み・病害虫・鳥獣の被害", h: 95, main: "tree", sub: "sun", widget: "frost", later: "県の病害虫の発生予察と、鳥獣の被害の対策（町の窓口・柵や罠の補助）" },
  gyogyou: { title: "漁業をしている方へ", desc: "波と風の先読み・漁業者向けの窓口と支援", h: 200, main: "umbrella", sub: "map", widget: "sea", later: "漁業をしている人向けの町の窓口と、いま申し込める支援" },
  yuki: { title: "雪の暮らし", desc: "雪の先読み・除雪と雪下ろしの支援", h: 210, main: "snow", sub: "phone", widget: "snow", later: "除雪や屋根の雪下ろしの支援と、除雪の連絡先" },
  kazan: { title: "火山のそばの暮らし", desc: "噴火のときの避難の決まり・知らせの受け取り方", h: 25, main: "alert", sub: "map", later: "噴火したときの避難の決まりと、知らせの受け取り方" },
  shima: { title: "島の暮らし", desc: "船の便・島の医療と買い物の支え", h: 190, main: "map", sub: "bus", later: "船の便と、島の医療・買い物の支え" },
};
for (const [id, f] of Object.entries(FEATURES)) ILLUST[`feat-${id}`] = { h: f.h, main: f.main, sub: f.sub };

// 予報の値が空の日は「–」（Math.round(null) が 0 になり、0℃ と出てしまう）
const rnd = (v) => (v == null ? "–" : Math.round(v));
// これから2週間の気温（Open-Meteo）から、霜・凍結・高温の日を拾う（めやす）
async function frostWidget(at) {
  const d = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${at[1].toFixed(3)}&longitude=${at[0].toFixed(3)}&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FTokyo&forecast_days=16`).then((r) => r.json()).catch(() => null);
  if (!d?.daily) return `<p class="note">${T("気温の予報を読み込めませんでした。")}</p>`;
  const days = d.daily.time.map((t, i) => ({ t, max: d.daily.temperature_2m_max[i], min: d.daily.temperature_2m_min[i] }));
  // 予報の値が空の日は印を付けない（null <= 0 が真になり、「凍結のおそれ」と出てしまう）
  const tag = (x) => (x.min == null || x.max == null ? null : x.min <= 0 ?["frost", T("凍結のおそれ")] : x.min <= 3 ? ["frost", T("霜のおそれ")] : x.max >= 35 ? ["hot", T("猛暑")] : x.max >= 30 ? ["hot", T("高温")] : null);
  const md = (t) => `${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))}`;
  const marks = days.filter(tag);
  return `<p class="feat-sum">${marks.length ? `${T("これから2週間で気をつけたい日")}：<strong>${marks.length}</strong>` : T("これから2週間、霜や高温のおそれは小さい見込みです")}</p>
    <ol class="temp-strip">${days.map((x) => { const g = tag(x); return `<li class="${g?.[0] ?? ""}"><span class="d">${md(x.t)}</span><span class="hi">${rnd(x.max)}</span><span class="lo">${rnd(x.min)}</span>${g ? `<span class="g">${esc(g[1])}</span>` : ""}</li>`; }).join("")}</ol>
    <p class="cite">${T("最高・最低気温の予報：Open-Meteo.com（CC BY 4.0）を加工。霜は最低3℃以下・凍結は0℃以下・高温は最高30℃以上を、めやすとして印にしています。長い先の予報ほど外れやすいので、気象庁の早期天候情報も確かめてください。")}
      <a href="https://www.data.jma.go.jp/cpd/souten/" target="_blank" rel="noopener">${T("気象庁 早期天候情報")}</a></p>`;
}
// 波と風（Open-Meteo の海の予報）。岸から離れた海の上の値なので、めやす
async function seaWidget(at) {
  const [m, w] = await Promise.all([
    fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${at[1].toFixed(3)}&longitude=${at[0].toFixed(3)}&daily=wave_height_max&timezone=Asia%2FTokyo&forecast_days=5`).then((r) => r.json()).catch(() => null),
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${at[1].toFixed(3)}&longitude=${at[0].toFixed(3)}&daily=wind_speed_10m_max&wind_speed_unit=ms&timezone=Asia%2FTokyo&forecast_days=5`).then((r) => r.json()).catch(() => null),
  ]);
  if (!m?.daily?.wave_height_max?.some((v) => v != null)) return `<p class="note">${T("この場所の波の予報はありません（海から離れている場合など）。")}</p>`;
  const md = (t) => `${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))}`;
  return `<ol class="temp-strip sea">${m.daily.time.map((t, i) => { const h = m.daily.wave_height_max[i], v = w?.daily?.wind_speed_10m_max?.[i]; const rough = h >= 2.5 || v >= 12; return `<li class="${rough ? "hot" : ""}"><span class="d">${md(t)}</span><span class="hi">${h != null ? `${h.toFixed(1)}m` : "-"}</span><span class="lo">${v != null ? `${Math.round(v)}m/s` : ""}</span>${rough ? `<span class="g">${T("しけ")}</span>` : ""}</li>`; }).join("")}</ol>
    <p class="cite">${T("波の高さ（いちばん高い波）と風の強さの予報：Open-Meteo.com（CC BY 4.0）を加工。沖の値のめやすです。出漁の判断は、気象庁の波浪警報・注意報と漁協の案内で。")}</p>`;
}
// 雪（Open-Meteo）：これから1週間の降雪
async function snowWidget(at) {
  const d = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${at[1].toFixed(3)}&longitude=${at[0].toFixed(3)}&daily=snowfall_sum,temperature_2m_min&timezone=Asia%2FTokyo&forecast_days=7`).then((r) => r.json()).catch(() => null);
  if (!d?.daily) return `<p class="note">${T("雪の予報を読み込めませんでした。")}</p>`;
  const md = (t) => `${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))}`;
  return `<ol class="temp-strip">${d.daily.time.map((t, i) => { const s = d.daily.snowfall_sum[i]; return `<li class="${s >= 5 ? "frost" : ""}"><span class="d">${md(t)}</span><span class="hi">${s ? `${Math.round(s)}cm` : "-"}</span><span class="lo">${d.daily.temperature_2m_min[i] == null ? "–" : `${Math.round(d.daily.temperature_2m_min[i])}℃`}</span>${s >= 5 ? `<span class="g">${T("雪")}</span>` : ""}</li>`; }).join("")}</ol>
    <p class="cite">${T("降雪の量と最低気温の予報：Open-Meteo.com（CC BY 4.0）を加工。めやすです。大雪の警報・注意報は気象庁の発表で。")}</p>`;
}
const WIDGETS = { frost: frostWidget, sea: seaWidget, snow: snowWidget };

// 町の特徴のページを作る：PAGES に足し、ページの枠を作り、国のデータの部品を描く
async function showFeatures(code, at) {
  const d = await getData("data/features.json");
  const mine = d?.towns?.[code] ?? [];
  const indAll = mine.some((f) => f === "nougyou" || f === "gyogyou") ? (await fetch("data/industry.json").then((r) => r.json()).catch(() => null))?.towns : null;
  const ind = indAll?.[code] ?? null;
  const allInd = Object.values(indAll ?? {});
  const rankIn = (k) => allInd.filter((x) => x[k] > ind[k]).length + 1;
  // 全国の真ん中の値も添える（10番目まで・1割までに入らないときは、真ん中の値だけ）
  const midOf = (k) => { const v = allInd.map((x) => x[k]).filter((x) => typeof x === "number").sort((a, b) => a - b); const m = v[Math.floor(v.length / 2)]; return m ? `${m}%` : null; };
  for (const id of mine) {
    const f = FEATURES[id];
    if (!f) continue;
    const view = `feat-${id}`;
    const why = id === "nougyou" && ind ? `${T("働く人のうち農業・林業")} ${ind.agri}%、${placeWords(rankIn("agri"), allInd.length, midOf("agri"))}`
      : id === "gyogyou" && ind ? `${T("働く人のうち漁業")} ${ind.fish}%、${placeWords(rankIn("fish"), allInd.length, midOf("fish"))}`
      : id === "yuki" ? T("豪雪地帯") : id === "kazan" ? T("火山災害警戒地域") : id === "shima" ? T("離島がある") : "";
    PAGES.splice(1, 0, { view, title: f.title, desc: f.desc, feature: true, why, later: f.later });
    const el = document.createElement("div");
    el.className = "view";
    el.dataset.view = view;
    el.hidden = true;
    el.innerHTML = `<section class="block"><h2>${icon(f.main)}${esc(T(f.title))}</h2>
      <p class="feat-why"><span class="feat-badge">${T("この町ならでは")}</span>${esc(why)}（${T("国の数字から決めたもの")}）</p>
      ${f.widget ? `<div class="feat-widget" id="w-${id}"><p class="note">${T("読み込んでいます…")}</p></div>` : ""}</section>
      <section class="block"><h2>${T("町の公式のサイトから探したこと")}</h2><div class="answers-box" data-page="${view}"></div></section>`;
    document.querySelector(".town-main").append(el);
    if (f.widget && at) WIDGETS[f.widget](at).then((html) => ($(`w-${id}`).innerHTML = html));
  }
  // 雪の町は、冬（12〜3月）のあいだ、「今日」のページの上のほうにも雪の先読みを出す
  if (mine.includes("yuki") && [12, 1, 2, 3].includes(jpNow().getMonth() + 1) && at) {
    const sec = document.createElement("section");
    sec.className = "block winter-first";
    sec.innerHTML = `<h2>${icon("snow")}${T("雪の先読み（冬のあいだは、ここにも出します）")}</h2><div id="w-yuki-top"><p class="note">${T("読み込んでいます…")}</p></div><a class="go" href="#feat-yuki">${icon("snow")}${T("雪の暮らしのページへ")}</a>`;
    document.getElementById("sec-today")?.before(sec);
    snowWidget(at).then((html) => ($("w-yuki-top").innerHTML = html));
  }
  return mine;
}
