// 医療・健康のページ：今日（明日）やっている病院・診療所。見る人のブラウザで、曜日・祝日・第何週の休みから決める。
// 元は厚生労働省「医療情報ネット」のオープンデータ（医療機関から届けられた内容）。変わっていることがあるので、行く前に電話で確かめてもらう
const TT = (s) => (typeof T === "function" ? T(s) : s);
// 病院の電話：国の医療情報ネットのオープンデータには電話番号の列が無いので、名前と住所で Google マップを開く（電話番号と道が見られる）。
// 押したときだけ、名前と住所を Google に渡す（わが家の避難の「Google マップで歩く道を見る」と同じ）
const gmapPlace = (name, addr) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${addr ?? ""}`.trim())}`;
const DAY_KEYS = ["日", "月", "火", "水", "木", "金", "土"];
const MONDAY_FIRST = ["月", "火", "水", "木", "金", "土", "日"];

async function loadMedical(code) {
  const [res, hol] = await Promise.all([
    fetch(`data/iryo/${code}.json`).catch(() => null),
    fetch("data/holidays.json").then((r) => r.json()).catch(() => ({ holidays: {} })),
  ]);
  if (!res?.ok) return null;
  return { ...(await res.json()), holidays: hol.holidays, holidaySource: hol.source };
}

// その日にやっているか、やっている時間（[[900,1200],[1400,1800]]）。休みなら null
function hoursOn(f, date, holidays) {
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const holiday = holidays[ymd];
  const dow = DAY_KEYS[date.getDay()];
  const idx = MONDAY_FIRST.indexOf(dow);
  if (holiday) return f.hol ? f.h["祝"] ?? f.h[dow] ?? null : null;
  if (f.w[idx] === "0") return null;
  const week = Math.ceil(date.getDate() / 7);
  if (f.nth?.[week]?.includes(idx)) return null;
  return f.h[dow] ?? null;
}

const hhmm = (n) => `${Math.floor(n / 100)}:${String(n % 100).padStart(2, "0")}`;
const meters = ([a, b], [c, d]) => {
  const rad = Math.PI / 180, x = (c - a) * rad * Math.cos(((b + d) / 2) * rad), y = (d - b) * rad;
  return Math.round(Math.sqrt(x * x + y * y) * 6371000);
};

// 今日・明日の一覧。center があれば近い順、なければ名前の順（病院が先）
function medicalList(m, offset, center, now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const t = now.getHours() * 100 + now.getMinutes();
  const out = [];
  for (const f of m.list) {
    const h = hoursOn(f, date, m.holidays);
    if (!h) continue;
    out.push({ f, h, openNow: offset === 0 && h.some(([s, e]) => s <= t && t < e), m: center && f.p ? meters(center, f.p) : null });
  }
  out.sort((a, b) => (b.openNow - a.openNow) || (a.m != null && b.m != null ? a.m - b.m : 0));
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { date, holiday: m.holidays[ymd], list: out };
}

function medicalHTML(m, offset, center, esc, filter = "", limit = 5) {
  const day = medicalList(m, offset, center);
  const other = typeof LANG !== "undefined" && LANG && LANG !== "easy";
  const label = other
    ? `${TT(offset === 0 ? "今日" : "明日")}（${day.date.toLocaleDateString(LANG, { weekday: "short", month: "short", day: "numeric" })}${day.holiday ? `・${TT("祝日")}` : ""}）`
    : `${TT(offset === 0 ? "今日" : "明日")}（${day.date.getMonth() + 1}月${day.date.getDate()}日 ${DAY_KEYS[day.date.getDay()]}曜${day.holiday ? `・${day.holiday}` : ""}）`;
  const f = filter.replace(/\s/g, "");
  const list = day.list.filter((x) => !f || (x.f.n + (x.f.s ?? []).join("")).replace(/\s/g, "").includes(f));
  const shown = list.slice(0, limit);
  return `
    <p class="med-sum">${other
      ? `<strong>${esc(label)}</strong>：${TT("やっている所")} <strong>${day.list.length}</strong> / ${m.list.length}${offset === 0 ? `・${TT("いま開いている")} ${day.list.filter((x) => x.openNow).length}` : ""}`
      : `<strong>${esc(label)}</strong>にやっているのは、この市区町村の ${m.list.length} か所のうち <strong>${day.list.length} か所</strong>${offset === 0 ? `（いま開いている ${day.list.filter((x) => x.openNow).length} か所）` : ""}`}</p>
    ${f ? `<p class="note">「${esc(filter)}」で絞ると ${list.length} か所</p>` : ""}
    <ul class="med-list">${shown.map((x) => `
      <li${x.openNow ? ` class="open"` : ""}>
        <span class="n">${icon(x.f.k === "病院" ? "hospital" : "medical")}${x.f.u ? `<a href="${esc(x.f.u)}" target="_blank" rel="noopener">${esc(x.f.n)}</a>` : esc(x.f.n)}<small>${esc(x.f.k)}</small>${x.openNow ? `<em>${TT("いま開いている")}</em>` : ""}</span>
        <span class="h">${x.h.map(([s, e]) => `${hhmm(s)}–${hhmm(e)}`).join("、")}${x.m != null ? `・まっすぐ ${x.m >= 1000 ? `${(x.m / 1000).toFixed(1)}km` : `${x.m}m`}` : ""}</span>
        ${x.f.s ? `<span class="s">${esc(x.f.s.slice(0, 6).join("・"))}${x.f.s.length > 6 ? ` ほか ${x.f.s.length - 6}` : ""}</span>` : ""}
        <span class="a">${esc(x.f.a)}${x.f.other ? `・休み：${esc(x.f.other.slice(0, 60))}` : ""}</span>
        <a class="med-gmap" href="${esc(gmapPlace(x.f.n, x.f.a))}" target="_blank" rel="noopener">${icon("phone")}${TT("電話番号と道を Google マップで見る")}</a>
      </li>`).join("")}</ul>
    ${list.length > shown.length ? `<button type="button" class="more-btn" data-more>${TT("続きを見る")}（${list.length - shown.length}）</button>` : ""}
    ${!day.list.length ? `<p class="note">${TT("届けられた診療時間では、この日にやっている所はありません。急ぐときは、下の窓口へ。")}</p>` : ""}`;
}
