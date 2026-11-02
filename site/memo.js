// くらしのメモ（印刷用）：memo.html?town=11227-0130（町・字）か ?muni=39428（市区町村）。
// スマホを使わない人にも届くよう、A4 1枚・白黒で読める形にまとめる。中身は町のページと同じデータ（出典つき）
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const q = new URLSearchParams(location.search);
$("print").addEventListener("click", () => print());
main();

async function main() {
  const json = (p) => fetch(p).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const stats = await json("data/stats.json");
  let code, part, name, center;
  if (q.get("town")) {
    [code, part] = q.get("town").split("-");
    const topo = await json(`data/towns/${code}.json`);
    const f = topojson.feature(topo, topo.objects.towns).features.find((x) => x.properties.part === part);
    name = `${stats.towns[code].name.replace(/^.+?郡/, "")} ${f.properties.name}`;
    center = centerOf(f);
  } else {
    code = q.get("muni");
    name = stats.towns[code].name.replace(/^.+?郡/, "");
    const labels = await json("data/labels.json");
    center = labels.features.find((x) => x.properties.code === code)?.geometry.coordinates;
  }
  document.title = `${name}のくらしのメモ｜まちしるべ`;
  $("name").textContent = name;
  $("made").textContent = `${new Date().toLocaleDateString("ja-JP")} に作りました。まちしるべ（非公式）が公式の資料から集めたものです。変わることがあるので、町の案内でも確かめてください。`;
  const pageUrl = new URL(`town.html?${part ? `town=${code}-${part}` : `muni=${code}`}`, location.href.replace(/memo\.html.*$/, "")).href;
  $("url").textContent = pageUrl;
  const qr = qrcode(0, "M");
  qr.addData(pageUrl);
  qr.make();
  $("qr").innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0 });
  const src = [];

  // 近い避難場所（地震と津波を先に。まっすぐの距離）
  const sh = await json(`data/shelters/${code}.json`);
  if (sh && center) {
    const near = sh.features.map((f) => ({ f, m: meters(center, f.geometry.coordinates) })).sort((a, b) => a.m - b.m).slice(0, 4);
    $("hinan-list").innerHTML = near.map(({ f, m }) => `<li><strong>${esc(f.properties.name)}</strong>
      <span>${esc(f.properties.kinds.join("・"))}のとき　まっすぐ ${m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`}</span></li>`).join("");
    $("hinan-note").textContent = `${part ? "町・字のおおよその真ん中" : "町の中心のあたり"}から近い順。避難場所は災害の種類ごとに決まっています。いま開いているかは、町の放送や案内で確かめてください。`;
    src.push(sh.source.title);
  } else $("hinan").hidden = true;

  // ごみ：町・字の答え（T01）があればそれ、無ければ町の答え（Q05）
  const ans = [...(part ? (await json(`data/answers/${code}-${part}.json`))?.answers ?? [] : []), ...((await json(`data/answers/${code}.json`))?.answers ?? [])];
  const g = ans.find((a) => a.qid === "T01" && a.status !== "pending") ?? ans.find((a) => a.qid === "Q05");
  if (g && g.value !== "見つからなかった") {
    $("gomi-text").innerHTML = prettyText(g.value, esc);
    src.push(g.source?.title);
  } else $("gomi").hidden = true;

  // 近い病院・診療所（曜日ごとの時間をまとめて）
  const m = await loadMedical(code);
  if (m && center) {
    const near = m.list.filter((f) => f.p).map((f) => ({ f, d: meters(center, f.p) })).sort((a, b) => a.d - b.d).slice(0, 6);
    $("iryo-list").innerHTML = near.map(({ f }) => `<tr><th>${esc(f.n)}<small>${esc((f.s ?? []).slice(0, 3).join("・"))}</small></th><td>${esc(weekText(f))}</td></tr>`).join("");
    src.push(`${m.source.title}（${m.source.asOf}）`);
  } else $("iryo").hidden = true;
  $("src").textContent = `出典：${src.filter(Boolean).join("／")}`;
}

// 曜日ごとの時間を短く：「月火水金 9:00–12:00、14:00–18:00／土 9:00–12:00」
function weekText(f) {
  const days = ["月", "火", "水", "木", "金", "土", "日"];
  const groups = [];
  for (const [i, d] of days.entries()) {
    if (f.w[i] === "0" || !f.h[d]) continue;
    const t = f.h[d].map(([s, e]) => `${hhmm(s)}–${hhmm(e)}`).join("、");
    const last = groups.at(-1);
    if (last && last.t === t) last.d += d;
    else groups.push({ d, t });
  }
  return groups.map((x) => `${x.d} ${x.t}`).join("／") || "時間は届けられていません";
}
function centerOf(f) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) for (const [x, y] of p[0]) { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); }
  return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
}
