// 回覧板のお知らせ（印刷用）：kairan.html?muni=39428（市区町村）か ?town=11227-0130（町・字）。
// 紙の回覧板を使う町で、スマホで見られる町のページがあることを、家ごとに知らせる。このサイトの説明・見られること・町のページの QR コード・
// 見た家の印の欄・切り取って残せる小さな QR の札（作者「町によっては、紙の回覧板を使っているところがありそう。そういう世帯に向けて、印刷できるページが欲しい」）
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const q = new URLSearchParams(location.search);
$("print").addEventListener("click", () => print());
main();

async function main() {
  const json = (p) => fetch(p).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const stats = await json("data/stats.json");
  let code, part, name;
  if (q.get("town")) {
    [code, part] = q.get("town").split("-");
    const topo = await json(`data/towns/${code}.json`);
    const f = topo && topojson.feature(topo, topo.objects.towns).features.find((x) => x.properties.part === part);
    name = `${stats.towns[code].name.replace(/^.+?郡/, "")}${f ? ` ${f.properties.name}` : ""}`;
  } else {
    code = q.get("muni");
    name = stats?.towns?.[code]?.name.replace(/^.+?郡/, "");
  }
  if (!name) { $("lead").textContent = "町が見つかりませんでした。町のページから開き直してください。"; return; }
  document.title = `${name}の回覧板のお知らせ｜まちしるべ`;
  $("name").textContent = name;
  $("lead").textContent = `「まちしるべ」は、${name}の公式のサイトや国の公開データから、くらしに要る情報を集めて、1つのページにまとめたものです。スマホで、いつでも見られます。`;

  // 見られること：その町にあるものだけを書く
  const [gomiDays, shelters, iryo, ans, tr] = await Promise.all([
    json(`data/gomi-days/${code}.json`), json(`data/shelters/${code}.json`), json(`data/iryo/${code}.json`),
    json(`data/answers/${code}.json`), json(`data/translations/${code}.json`),
  ]);
  const has = (qid) => ans?.answers?.some((a) => a.qid === qid && a.value !== "見つからなかった");
  const langs = Object.values(tr?.langs ?? {}).map((l) => l.ja ?? l.name);
  const can = [
    ["今日と明日の天気・警報・地震", "洗濯や服装のめやすも"],
    shelters && ["近い避難場所", "今いる所や町・字から、災害の種類ごとに"],
    iryo && ["今日やっている病院・診療所", "曜日と時間から。いま開いている所も"],
    (gomiDays || has("Q05")) && ["ごみを出す日", gomiDays ? "地区を選ぶと、今日と明日に出せるごみ" : "収集日と出し方"],
    ["困ったときの電話の窓口", "押すと電話をかけられます"],
    langs.length && [`${langs.join("・")}でも読めます`, "AI による訳。訳し戻して確かめています"],
  ].filter(Boolean);
  $("can").innerHTML = can.map(([t, d]) => `<li><strong>${esc(t)}</strong><span>${esc(d)}</span></li>`).join("");

  // 町のページの QR コード（大きいもの1つと、切り取れる小さいもの3つ）
  const pageUrl = new URL(`town.html?${part ? `town=${code}-${part}` : `muni=${code}`}`, location.href.replace(/kairan\.html.*$/, "")).href;
  const qrSvg = (cell) => { const qr = qrcode(0, "M"); qr.addData(pageUrl); qr.make(); return qr.createSvgTag({ cellSize: cell, margin: 0 }); };
  $("qr").innerHTML = qrSvg(4);
  $("url").textContent = pageUrl;
  $("slips").innerHTML = [0, 1, 2].map(() => `<div class="slip">${qrSvg(2)}<p><strong>${esc(name)}のくらしの案内</strong>まちしるべ（非公式）<br>スマホのカメラで読むと開きます</p></div>`).join("");
  $("made").textContent = `${new Date().toLocaleDateString("ja-JP")} に印刷用に作りました。まちしるべ（非公式）。中身は変わることがあります。`;
}
