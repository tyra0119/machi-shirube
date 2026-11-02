// 今日のまとめ：見る人のブラウザが、その場で気象庁と Open-Meteo を読む（公開のサイトでも動く。Claude は使わない）。
// - 天気の文・降水確率・警報・地震：気象庁ホームページ（公共データ利用規約。出典を書く）
// - 気温・湿度・風・日の照る時間：Open-Meteo（営利でない使い方は無料。CC BY 4.0）。町の位置で
// - 洗濯・服装は、上の数字に決まりを当てはめた「めやす」（まちしるべの決まり）
const WARNINGS = {
  "02": "暴風雪警報", "03": "大雨警報", "04": "洪水警報", "05": "暴風警報", "06": "大雪警報", "07": "波浪警報", "08": "高潮警報",
  "10": "大雨注意報", "12": "大雪注意報", "13": "風雪注意報", "14": "雷注意報", "15": "強風注意報", "16": "波浪注意報", "17": "融雪注意報",
  "18": "洪水注意報", "19": "高潮注意報", "20": "濃霧注意報", "21": "乾燥注意報", "22": "なだれ注意報", "23": "低温注意報", "24": "霜注意報",
  "25": "着氷注意報", "26": "着雪注意報", "32": "暴風雪特別警報", "33": "大雨特別警報", "35": "暴風特別警報", "36": "大雪特別警報",
  "37": "波浪特別警報", "38": "高潮特別警報",
};
const JMA = "https://www.jma.go.jp/bosai";

async function loadToday(code, lat, lon) {
  // 政令市まるごと（例 14100）は表にないので、最初の区で代表させる。地震は区のどれかで観測したもの
  const table = await fetch("data/jma.json").then((r) => r.json()).catch(() => ({}));
  const whole = !table[code];
  const jma = table[code] ?? table[Object.keys(table).find((k) => k > code && k < String(Number(code) + 30).padStart(5, "0"))];
  const [fc, warn, quakes, om] = await Promise.all([
    jma ? fetch(`${JMA}/forecast/data/forecast/${jma.office}.json`).then((r) => r.json()).catch(() => null) : null,
    jma ? fetch(`${JMA}/warning/data/warning/${jma.office}.json`).then((r) => r.json()).catch(() => null) : null,
    fetch(`${JMA}/quake/data/list.json`).then((r) => r.json()).catch(() => null),
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,relative_humidity_2m_mean,wind_speed_10m_max,sunshine_duration,uv_index_max&timezone=Asia%2FTokyo&forecast_days=2&wind_speed_unit=ms`)
      .then((r) => r.json()).catch(() => null),
  ]);
  return { jma, days: days(jma, fc, om), warnings: warnings(jma, warn), quakes: myQuakes(code, whole, quakes) };
}

// 今日・明日：気象庁の天気の文と降水確率、Open-Meteo の気温など
function days(jma, fc, om) {
  const out = [];
  const series = fc?.[0]?.timeSeries;
  const area = series?.[0]?.areas.find((a) => a.area.code === jma?.class10);
  const pops = series?.[1]?.areas.find((a) => a.area.code === jma?.class10);
  for (let i = 0; i < 2; i++) {
    const d = om?.daily;
    const day = {
      label: i === 0 ? "今日" : "明日",
      date: d?.time?.[i],
      weather: area?.weathers?.[i]?.replace(/　/g, " "),
      weatherCode: area?.weatherCodes?.[i],
      max: d?.temperature_2m_max?.[i], min: d?.temperature_2m_min?.[i],
      pop: d?.precipitation_probability_max?.[i],
      humidity: d?.relative_humidity_2m_mean?.[i],
      wind: d?.wind_speed_10m_max?.[i],
      sunHours: d?.sunshine_duration?.[i] != null ? d.sunshine_duration[i] / 3600 : null,
      uv: d?.uv_index_max?.[i],
    };
    // 気象庁の降水確率（6時間ごと）があれば、その日のいちばん高い値を使う
    if (pops && series[1].timeDefines) {
      const ps = series[1].timeDefines.map((t, k) => [t.slice(0, 10), Number(pops.pops[k])]).filter(([t]) => t === day.date).map(([, p]) => p);
      if (ps.length) day.pop = Math.max(...ps);
    }
    day.laundry = laundry(day);
    day.clothes = clothes(day);
    out.push(day);
  }
  return out;
}

// 洗濯のめやす（まちしるべの決まり）：雨の降りやすさ・湿度・日の照る時間・風で4段に
function laundry(d) {
  if (d.pop == null) return null;
  if (d.pop >= 60) return { level: 0, text: "部屋干しがよい", why: `雨の確率 ${d.pop}%` };
  let score = 0;
  if (d.pop < 20) score += 2; else if (d.pop < 40) score += 1;
  if (d.humidity != null) score += d.humidity < 60 ? 2 : d.humidity < 75 ? 1 : 0;
  if (d.sunHours != null) score += d.sunHours >= 6 ? 2 : d.sunHours >= 3 ? 1 : 0;
  if (d.wind != null && d.wind >= 2 && d.wind < 9) score += 1;
  if (d.wind != null && d.wind >= 12) score -= 2;
  const level = score >= 6 ? 3 : score >= 4 ? 2 : score >= 2 ? 1 : 0;
  return { level, text: ["部屋干しがよい", "乾きにくい", "乾く", "よく乾く"][level], why: `雨 ${d.pop}%${d.humidity != null ? `・湿度 ${Math.round(d.humidity)}%` : ""}${d.sunHours != null ? `・日の照る時間 ${d.sunHours.toFixed(1)}時間` : ""}` };
}

// 服装のめやす（まちしるべの決まり）：いちばん高い気温で決め、朝と昼の差・雨・紫外線を添える
function clothes(d) {
  if (d.max == null) return null;
  const t = d.max;
  const base = t >= 28 ? "半袖で過ごせる暑さ" : t >= 23 ? "半袖か、うすい長袖" : t >= 18 ? "長袖のシャツ。うすい上着があると安心"
    : t >= 13 ? "上着（カーディガン・うすいジャケット）" : t >= 8 ? "コート" : "冬のコート・手袋・マフラー";
  const notes = [];
  if (d.min != null && t - d.min >= 10) notes.push(`朝晩は ${Math.round(d.min)}℃まで下がるので、羽織るものを`);
  if (d.pop != null && d.pop >= 50) notes.push("雨の用意を");
  if (d.uv != null && d.uv >= 6) notes.push("日差しが強いので帽子を");
  if (t >= 31) notes.push("熱中症に気をつけて");
  return { text: base, notes };
}

// 警報・注意報：この市町村（気象庁の市町村の区切り）に出ているもの
function warnings(jma, warn) {
  if (!jma || !warn) return null;
  const area = warn.areaTypes?.[1]?.areas?.find((a) => a.code === jma.class20);
  const list = (area?.warnings ?? []).filter((w) => w.status !== "解除" && w.status !== "発表警報・注意報はなし" && WARNINGS[w.code]).map((w) => WARNINGS[w.code]);
  return { list: [...new Set(list)], at: warn.reportDatetime, headline: warn.headlineText };
}

// 地震：この1週間で、この市町村で震度を観測したもの
function myQuakes(code, whole, list) {
  if (!Array.isArray(list)) return null;
  const since = Date.now() - 7 * 24 * 3600 * 1000;
  const out = [];
  for (const q of list) {
    if (new Date(q.at).getTime() < since) continue;
    for (const p of q.int ?? []) {
      const mine = (x) => (whole ? Number(String(x.code).slice(0, 5)) - Number(code) : String(x.code).startsWith(code) ? 0 : -1);
      const c = (p.city ?? []).find((x) => mine(x) >= 0 && mine(x) < 30);
      if (c && !out.some((o) => o.eid === q.eid)) out.push({ eid: q.eid, at: q.at, place: q.anm, mag: q.mag, maxi: c.maxi });
    }
  }
  return out.slice(0, 3);
}

// 天気の印（気象庁の天気のコードの先頭：1 晴れ・2 くもり・3 雨・4 雪）。線の絵で
const WEATHER_ICON = (code) => (!code ? "" : icon(code.startsWith("1") ? "sun" : code.startsWith("2") ? "cloud" : code.startsWith("3") ? "umbrella" : code.startsWith("4") ? "snow" : ""));

function todayHTML(t, esc) {
  const dayCard = (d) => `
    <article class="day">
      <h3>${d.label}<small>${d.date ? ` ${Number(d.date.slice(5, 7))}月${Number(d.date.slice(8, 10))}日` : ""}</small></h3>
      <p class="w"><span class="icon" aria-hidden="true">${WEATHER_ICON(d.weatherCode)}</span>${d.weather ? `${esc(d.weather)}<small class="by">気象庁の予報</small>` : "気象庁の予報を読み込めませんでした"}</p>
      <p class="t">${d.max != null ? `<strong>${Math.round(d.max)}℃</strong> / ${Math.round(d.min)}℃` : ""}${d.pop != null ? `<span>雨 ${d.pop}%</span>` : ""}</p>
      ${d.laundry ? `<p class="row"><span class="k">${icon("laundry")}洗濯</span><span class="v lv${d.laundry.level}">${d.laundry.text}</span></p>` : ""}
      ${d.clothes ? `<p class="row"><span class="k">${icon("shirt")}服装</span><span class="v">${esc(d.clothes.text)}${d.clothes.notes.length ? `<small>${esc(d.clothes.notes.join("。"))}</small>` : ""}</span></p>` : ""}
    </article>`;
  const w = t.warnings;
  const warnHTML = !w ? `<p class="note">警報・注意報を読み込めませんでした（出ていないという意味ではありません）。気象庁のページで確かめてください。</p>`
    : w.list.length ? `<p class="warn-on">${w.list.map((x) => `<span class="${/警報/.test(x) ? "kw" : ""}">${esc(x)}</span>`).join("")}</p>`
    : `<p class="warn-off">いま、この町に警報・注意報は出ていません</p>`;
  const q = t.quakes;
  const quakeHTML = !q ? `<p class="note">地震の情報を読み込めませんでした（地震が無かったという意味ではありません）。</p>` : q.length
    ? `<ul class="quakes">${q.map((x) => `<li>${esc(new Date(x.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }))} ${esc(x.place)}・M${esc(x.mag)}・この町で震度 ${esc(x.maxi)}</li>`).join("")}</ul>`
    : `<p class="note">この1週間、この町で震度を観測した地震はありません。</p>`;
  return `
    <div class="days">${t.days.map(dayCard).join("")}</div>
    <h3 class="sub">${icon("alert")} 警報・注意報</h3>${warnHTML}
    <h3 class="sub">${icon("quake")} 地震</h3>${quakeHTML}
    <p class="cite">出典：気象庁ホームページ（天気予報・警報・注意報・地震情報。${esc(t.jma?.officeName ?? "")}${esc(t.jma?.class10Name ?? "")}）、天気の数値：Open-Meteo.com（CC BY 4.0）を加工。洗濯・服装は、まちしるべの決まりで出しためやすです。</p>`;
}
