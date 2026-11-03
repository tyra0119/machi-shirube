// まちがいの知らせ方。町のページから ?muni=コード（や town=コード-番号）&page=見ていたページ&lang=言葉 で開くと、
// 町の名前と見ていたページを入れた GitHub の書く画面（issues/new?title=&body=）へのボタンを出す。個人のことは URL に入れない
// 言葉は町のページと同じ辞書（site/data/i18n/{言葉}.json。scripts/i18n.mjs が訳し、訳し戻して確かめたもの）
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const NEW = "https://github.com/tyra0119/machi-shirube/issues/new";
const PAGES = { today: "今日", chizu: "地図", bousai: "防災・避難", gomi: "ごみ", iryo: "医療・健康", komatta: "困ったとき", kosodate: "子育て", kaigo: "お年寄り・介護", koutsuu: "交通と道の安全", tetsuzuki: "手続き", foreign: "外国の方へ", okane: "お金", shisetsu: "施設", shiru: "町を知る", keikaku: "町の計画と話題" };
// 決まった文字の置きかえる場所
const REPORT_SEL = ".report h1, .report .lead, .report .warn li, .report h2, .report .note, .report .steps .t, .report .steps p, .report .faq dt, .report .faq dd";
const LANGS = [["", "日本語"], ["pt", "Português"], ["es", "Español"], ["en", "English"], ["easy", "やさしい にほんご"], ["id", "Bahasa Indonesia"], ["ne", "नेपाली"], ["vi", "Tiếng Việt"], ["tl", "Filipino"]];

const q = new URLSearchParams(location.search);
const lang = q.get("lang");
const page = PAGES[q.get("page")] ?? "";
let place = "";

const body = () => [
  `■ ${T("町の名前")}`,
  place || `□（${T("例：高知県 黒潮町")}）`,
  "",
  `■ ${T("まちしるべのどのページか")}`,
  page ? T(page) : `□（${T("例：ごみ・防災・避難 など")}）`,
  "",
  `■ ${T("どこがちがうか（いまの書き方）")}`,
  "□",
  "",
  `■ ${T("正しいと思うこと")}`,
  "□",
  "",
  `■ ${T("どこで見たか（分かれば。町のページの URL・お知らせの紙など）")}`,
  "□",
  "",
  `（${T("住所・電話番号・名前など、自分のことは書かないでください。この知らせは公開されます")}）`,
].join("\n");

async function main() {
  if (await setLang(lang)) { translateDom(document, REPORT_SEL); document.title = `${T("まちがいの知らせ方")}｜まちしるべ`; }
  $("warn-head").innerHTML = `${icon("alert")} ${T("書く前に")}`;
  for (const p of document.querySelectorAll(".steps .t[data-ic]")) p.insertAdjacentHTML("afterbegin", icon(p.dataset.ic));
  // 言葉のボタン（町のページと同じ7つ）
  const href = (l) => { const u = new URLSearchParams(location.search); if (l) u.set("lang", l); else u.delete("lang"); return `report.html?${u}`; };
  $("lang-bar").innerHTML = LANGS.map(([l, n]) => `<a href="${href(l)}"${(lang ?? "") === l ? ' aria-current="true"' : ""}>${esc(n)}</a>`).join("") + (LANG ? `<span>${T("（AI による訳）")}</span>` : "");

  const code = (q.get("town") ?? q.get("muni") ?? "").match(/^\d{5}/)?.[0];
  if (code) {
    const stats = await fetch("data/stats.json").then((r) => r.json()).catch(() => null);
    const t = stats?.towns?.[code];
    if (t) {
      let part = "";
      const pc = q.get("town")?.split("-")[1];
      if (pc) {
        const topo = await fetch(`data/towns/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const g = topo && Object.values(topo.objects)[0]?.geometries?.find((x) => x.properties?.part === pc);
        part = g?.properties?.name ? ` ${g.properties.name}` : "";
      }
      place = `${t.pref} ${t.name.replace(/^.+?郡(?=.+[町村]$)/, "")}${part}`;
      const back = `town.html?${q.get("town") ? `town=${q.get("town")}` : `muni=${code}`}${LANG ? `&lang=${LANG}` : ""}${q.get("page") ? `#${q.get("page")}` : ""}`;
      $("back").innerHTML = ` › <a href="${esc(back)}">${esc(place)}</a>`;
      $("town-box").hidden = false;
      $("town-what").textContent = `${place}${page ? `・${T(page)}` : ""}：${T("このページについて知らせます。")}`;
      const title = `${place}${page ? ` ${T(page)}` : ""}：`;
      $("go-new").href = `${NEW}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body())}`;
      $("go-new").innerHTML = `${icon("link")} ${T("GitHub で知らせる")}`;
    }
  }
  $("tmpl").textContent = body();
  $("copy").textContent = T("写す");
}
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("tmpl").textContent); $("copy").textContent = T("写しました"); }
  catch { $("copy").textContent = T("写せませんでした。長押しで選んで写してください"); }
  setTimeout(() => ($("copy").textContent = T("写す")), 2500);
});
main();
