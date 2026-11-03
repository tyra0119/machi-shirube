// まちがいの知らせ方。町のページから ?muni=コード（や town=コード-番号）&page=見ていたページ で開くと、
// 町の名前と見ていたページを入れた GitHub の書く画面（issues/new?title=&body=）へのボタンを出す。個人のことは URL に入れない
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const NEW = "https://github.com/tyra0119/machi-shirube/issues/new";
const PAGES = { today: "今日", chizu: "地図", bousai: "防災・避難", gomi: "ごみ", iryo: "医療・健康", komatta: "困ったとき", kosodate: "子育て", kaigo: "お年寄り・介護", koutsuu: "交通と道の安全", tetsuzuki: "手続き", foreign: "外国の方へ", okane: "お金", shisetsu: "施設", shiru: "町を知る", keikaku: "町の計画と話題" };

const q = new URLSearchParams(location.search);
const page = PAGES[q.get("page")] ?? "";
let place = "";

const body = () => [
  "■ 町の名前",
  place || "□（例：高知県 黒潮町）",
  "",
  "■ まちしるべのどのページか",
  page || "□（例：ごみ・防災・避難 など）",
  "",
  "■ どこがちがうか（いまの書き方）",
  "□",
  "",
  "■ 正しいと思うこと",
  "□",
  "",
  "■ どこで見たか（分かれば。町のページの URL・お知らせの紙など）",
  "□",
  "",
  "（住所・電話番号・名前など、自分のことは書かないでください。この知らせは公開されます）",
].join("\n");

$("warn-head").innerHTML = `${icon("alert")} 書く前に`;
for (const p of document.querySelectorAll(".steps .t[data-ic]")) p.insertAdjacentHTML("afterbegin", icon(p.dataset.ic));

async function main() {
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
      const back = `town.html?${q.get("town") ? `town=${q.get("town")}` : `muni=${code}`}${q.get("page") ? `#${q.get("page")}` : ""}`;
      $("back").innerHTML = ` › <a href="${esc(back)}">${esc(place)}</a>`;
      $("town-box").hidden = false;
      $("town-what").textContent = `${place}${page ? ` の「${page}」` : ""}のページについて知らせます。`;
      const title = `${place}${page ? ` ${page}` : ""}：`;
      $("go-new").href = `${NEW}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body())}`;
      $("go-new").innerHTML = `${icon("link")} GitHub で知らせる`;
    }
  }
  $("tmpl").textContent = body();
}
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("tmpl").textContent); $("copy").textContent = "写しました"; }
  catch { $("copy").textContent = "写せませんでした。長押しで選んで写してください"; }
  setTimeout(() => ($("copy").textContent = "写す"), 2500);
});
main();
