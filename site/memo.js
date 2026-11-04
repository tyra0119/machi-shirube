// くらしのメモ（印刷用）：memo.html?town=11227-0130（町・字）か ?muni=39428（市区町村）。
// スマホを使わない人にも届くよう、A4 1枚・白黒で読める形にまとめる。中身は町のページと同じデータ（出典つき）
// 住む人の目で見直した（作者「全部やる」）：A4 1枚に収まらなかった・電話が 119 と 110 だけだった・ごみと避難場所がその家に合っていなかった。
// → 町のページで選んで端末が覚えた町・字とごみの地区を使い（画面の上でも選べる）、確かめ済みの答えから役場や相談の電話を並べる
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const q = new URLSearchParams(location.search);
// 町のページと同じ覚え方（town.js の remember）
const remember = {
  get(k) { try { return localStorage.getItem(`machi-shirube:${k}`); } catch { return null; } },
  set(k, v) { try { if (v) localStorage.setItem(`machi-shirube:${k}`, v); else localStorage.removeItem(`machi-shirube:${k}`); } catch {} },
};
const json = (p) => fetch(p).then((r) => (r.ok ? r.json() : null)).catch(() => null);
$("print").addEventListener("click", () => print());
main();

async function main() {
  const stats = await json("data/stats.json");
  let code, fixedPart;
  if (q.get("town")) [code, fixedPart] = q.get("town").split("-");
  else code = q.get("muni");
  const muniName = stats.towns[code].name.replace(/^.+?郡/, "");
  const [topo, labels, sh, ansMuni, gd, m, yard] = await Promise.all([
    json(`data/towns/${code}.json`), json("data/labels.json"), json(`data/shelters/${code}.json`),
    json(`data/answers/${code}.json`), json(`data/gomi-days/${code}.json`), loadMedical(code), json("data/yardstick.json"),
  ]);
  const parts = topo ? topojson.feature(topo, topo.objects.towns).features : [];
  const gomiOk = gd && (gd.status === "ok" || gd.status === "auto") && gd.areas?.length;

  // 画面の上で選ぶ（印刷には出ない）：町・字（近い避難場所と病院の基準）と、ごみの地区
  const partSel = $("pick-part"), gomiSel = $("pick-gomi");
  partSel.innerHTML = `<option value="">（町の真ん中のあたり）</option>` + parts.map((f) => `<option value="${esc(f.properties.part)}">${esc(f.properties.name)}</option>`).join("");
  partSel.value = fixedPart ?? remember.get(`hinan:${code}`) ?? "";
  if (gomiOk) gomiSel.innerHTML = `<option value="">（選ぶ）</option>` + gd.areas.map((a, i) => `<option value="${i}">${esc(a.area)}${a.towns.length ? `（${esc(a.towns.slice(0, 3).join("・"))}${a.towns.length > 3 ? "ほか" : ""}）` : ""}</option>`).join("");
  else gomiSel.closest("label").hidden = true;
  gomiSel.value = remember.get(`gomi:${code}`) ?? "";
  partSel.addEventListener("change", () => { remember.set(`hinan:${code}`, partSel.value); draw(); });
  gomiSel.addEventListener("change", () => { remember.set(`gomi:${code}`, gomiSel.value); draw(); });

  const pageUrlOf = (part) => new URL(`town.html?${part ? `town=${code}-${part}` : `muni=${code}`}`, location.href.replace(/memo\.html.*$/, "")).href;
  const page = Object.fromEntries((yard?.questions ?? []).map((x) => [x.id, x]));
  const answers = (ansMuni?.answers ?? []).filter((a) => a.value !== "見つからなかった");

  async function draw() {
    const part = parts.find((f) => f.properties.part === partSel.value);
    const name = part ? `${muniName} ${part.properties.name}` : muniName;
    const center = part ? centerOf(part) : labels.features.find((x) => x.properties.code === code)?.geometry.coordinates;
    document.title = `${name}のくらしのメモ｜まちしるべ`;
    $("name").textContent = name;
    $("made").textContent = `${new Date().toLocaleDateString("ja-JP")} に作りました。まちしるべ（非公式）が公式の資料から集めたものです。変わることがあるので、町の案内でも確かめてください。`;
    const pageUrl = pageUrlOf(part?.properties.part);
    $("url").textContent = pageUrl;
    const qr = qrcode(0, "M");
    qr.addData(pageUrl);
    qr.make();
    $("qr").innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0 });
    const src = [];

    // まず電話：確かめ済みの答え（困ったときの窓口・夜間休日の医療・警察・水道）にある番号を、番号の前の言葉を名前にして並べる
    const tels = [];
    for (const qid of ["Q15", "Q16", "Q42", "Q56"]) {
      const a = answers.find((x) => x.qid === qid);
      if (!a) continue;
      // 警察と水道は、決まった名前にする（答えの文の言い方がまちまちなので）
      const fixed = { Q42: "警察署", Q56: "水道（水漏れ・水が出ない）" }[qid];
      tels.push(...telsOf(a.value, page[qid]?.short ?? "").slice(0, qid === "Q16" ? 3 : qid === "Q15" ? 2 : 1).map((t) => (fixed ? { ...t, label: fixed } : t)));
      src.push(a.source?.title);
    }
    const seen = new Set();
    $("tels").innerHTML = tels.filter((t) => !seen.has(t.num) && seen.add(t.num)).slice(0, 8)
      .map((t) => `<li><span>${esc(t.label)}</span><strong>${esc(t.num)}</strong></li>`).join("");
    $("tels").hidden = !tels.length;

    // 近い避難場所（町・字を選んでいれば、その町・字のおおよその真ん中から。まっすぐの距離）
    if (sh && center) {
      const near = sh.features.map((f) => ({ f, d: meters(center, f.geometry.coordinates) })).sort((a, b) => a.d - b.d).slice(0, 3);
      $("hinan-list").innerHTML = near.map(({ f, d }) => `<li><strong>${esc(f.properties.name)}</strong>
        <span>${esc(f.properties.kinds.join("・"))}のとき　まっすぐ ${d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${d}m`}</span></li>`).join("");
      $("hinan-note").textContent = `${part ? `${part.properties.name}のおおよその真ん中` : "町の真ん中のあたり（上で町・字を選ぶと、その近くになります）"}から近い順。避難場所は災害の種類ごとに決まっています。`;
      src.push(sh.source.title);
      $("hinan").hidden = false;
    } else $("hinan").hidden = true;

    // ごみ：選んだ地区の、出す曜日。選んでいなければ、確かめ済みの答え
    const area = gomiOk ? gd.areas[Number(gomiSel.value)] : null;
    if (area && gomiSel.value !== "") {
      $("gomi-text").innerHTML = `<span class="g-area">${esc(area.area)}</span><ul class="g-days">${area.days.map((x) => `<li><strong>${esc(x.kind)}</strong>${esc(x.when)}</li>`).join("")}</ul>`;
      src.push(gd.sources?.[0]?.title);
      $("gomi").hidden = false;
    } else {
      const g = answers.find((a) => a.qid === "Q05");
      if (g) { $("gomi-text").innerHTML = `${gomiOk ? `<span class="g-pick">上でごみの地区を選ぶと、出す曜日が入ります。</span>` : ""}${prettyText(g.value, esc)}`; src.push(g.source?.title); $("gomi").hidden = false; }
      else $("gomi").hidden = true;
    }

    // 近い病院・診療所（4か所。曜日ごとの時間をまとめて）
    if (m && center) {
      const near = m.list.filter((f) => f.p).map((f) => ({ f, d: meters(center, f.p) })).sort((a, b) => a.d - b.d).slice(0, 3);
      $("iryo-list").innerHTML = near.map(({ f }) => `<tr><th>${esc(f.n)}<small>${esc((f.s ?? []).slice(0, 3).join("・"))}</small></th><td>${esc(weekText(f))}</td></tr>`).join("");
      src.push(`${m.source.title}（${m.source.asOf}）`);
      $("iryo").hidden = false;
    } else $("iryo").hidden = true;
    $("src").textContent = `出典：${[...new Set(src.filter(Boolean))].join("／")}`;
  }
  await draw();
}

// 答えの文から、電話番号と、その前の言葉（名前）を取り出す。
// 例：「役場の代表電話は、本庁が0880-43-2111」→ 本庁、「【役場代表】 / 電話は 0276-63-3111 です。」→ 役場代表、「こうちこども救急ダイヤル（子どもの急病）：#8000」
const NUM = /#\d{4}|0\d{1,4}-\d{1,4}-\d{3,4}/g;
function telsOf(text, fallback) {
  const out = [];
  let head = "";
  for (const line of prettyText(text, (s) => s).split("<br>")) {
    const h = line.match(/^【(.+?)】/);
    if (h) head = h[1];
    let last = 0;
    for (const m of line.matchAll(NUM)) {
      // 番号の前の、いちばん近い区切り（。、）から番号までを名前に。「名前：住所（番号）」の形なら名前のほう。
      // 名前が「電話は」だけのときは、その前の文（「本庁 まちづくり課土木係です。電話は」→ 本庁 まちづくり課土木係）
      const clean = (s) => s.replace(/【.+?】/, "").replace(/^【|】$/g, "").replace(/^\s*(または|また|か|と)\s*/, "").replace(/[（(]\s*$/, "")
        .replace(/(の)?(電話番号|電話|代表電話)?(は|が)?\s*$/, "").replace(/です$/, "").trim();
      const segs = line.slice(last, m.index).split(/[。、，]/).map((s) => s.trim()).filter(Boolean);
      const pick = (seg) => { const [name, rest] = seg.split(/[：:]/); return rest !== undefined && (/\d/.test(rest) || !rest.trim()) ? clean(name) : clean(rest ?? name); };
      let label = segs.length ? pick(segs.at(-1)) : "";
      if (!label && segs.length > 1) label = pick(segs.at(-2));
      // 同じ行の2つめの番号で、名前が無いもの（「または 088-…」）は、同じ窓口の別の番号なので出さない
      if (!label && out.at(-1)?.line === line) { last = m.index + m[0].length; continue; }
      if (!label) label = head || fallback;
      out.push({ label: label.slice(0, 22), num: m[0], line });
      last = m.index + m[0].length;
    }
  }
  return out;
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
