// 動画の場面（録画用）。数と文は作品の本物のデータから読む（作り物の数は出さない）。
// （作者「作成したアプリは実際に動かしている画面は結構地味。どう動画で人の目を引くものに仕上げるか」→ Claude の働きと、大事な数を、動きで見せる）
//  ?scene=card&code=39428&hit=早咲地区津波避難タワー … 町の防災計画（PDF）の表の1行が光り、線が伸びて、町のページの答えのカードになる
//  ?scene=grid&code=39428 … 物差しの問いのます目が、出典つきの答えで埋まっていく
//  ?scene=num&code=39428&kind=津波 … 浸かる想定の所に住む人の数が数え上がる（?v=&unit=&who=&src= でほかの数も）
//  ?scene=pages … 町の防災計画のページ（黒潮町 本編 298・資料編 156）が積み上がり、住む人に要る所だけの1枚に縮まる
//  ?scene=end … 終わりの札（まちしるべ・あなたの町も。・サイトの URL）
//  ?scene=bar&a=52.1&b=86.1 … 大泉町の「母語で読める人」の棒が伸びる（数は録る日に町のページの「母語で読める人」と合わせる）
//  押すか ?auto で始まる。R でやり直す。?nobadge で右上の札を消す
const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const json = (p) => fetch(p).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SCENE = q.get("scene") ?? "card";
const CODE = q.get("code") ?? (SCENE === "bar" ? "10524" : "39428");
if (q.has("nobadge")) $("badge").hidden = true;

async function caption(s, l) {
  const cap = $("cap");
  cap.classList.remove("on");
  await wait(500);
  $("cap-s").textContent = s;
  $("cap-l").textContent = l;
  if (s || l) cap.classList.add("on");
}
async function townName() {
  const m = await json(`data/muni/${CODE}.json`);
  return m?.stats?.towns?.[CODE]?.name.replace(/^.+?郡/, "") ?? "";
}

// 公式の資料の表の1行 → 答えのカード
async function sceneCard() {
  const plan = await json(`data/plan/${CODE}.json`);
  const hitName = q.get("hit") ?? "早咲地区津波避難タワー";
  // 光らせる1行と同じページを引用している答えを、表の行として並べる（名前・所在・人数は答えの文から）
  const points = Object.values(plan.parts).flatMap((p) => p.points.map((x) => ({ ...x, part: p.name })));
  const hit = points.find((x) => x.text.includes(hitName));
  const cite = hit.cites[0];
  // 「名前（ところ）は、…N人」の形の答えだけを行にする。同じページの行が足りないところは、中身を見せない灰色の帯（作り物の文字は出さない）
  const RE = /^(.+?)（(.+?)）は、.*?(\d[\d,]*)人/;
  const rowOf = (x) => { const m = x.text.match(RE); return m ? { name: m[1], addr: m[2], people: m[3] } : null; };
  const same = [...new Map(points.filter((x) => x !== hit && rowOf(x) && x.cites.some((c) => c.page === cite.page && c.doc === cite.doc)).map((x) => [rowOf(x).name, x])).values()].slice(0, 6);
  const filled = [...same.slice(0, 3).map(rowOf), { ...rowOf(hit), hit: true }, ...same.slice(3).map(rowOf)];
  const rows = [...filled];
  while (rows.length < 7) rows.splice(rows.length % 2 ? 0 : rows.length, 0, { blank: true });
  $("stage").innerHTML = `
    <div class="doc" id="doc"><p class="dt">${esc(cite.doc)}</p><p class="dp">${cite.page} ページ（町の公式サイトの PDF）</p>
      <table><tr><th>避難場所の名前</th><th>ところ</th><th>人数</th></tr>
      ${rows.map((r) => (r.blank ? `<tr class="row blank"><td><i style="width:${8 + ((r.w = (r.w ?? Math.random())) * 6)}vw"></i></td><td><i style="width:6vw"></i></td><td><i style="width:3vw"></i></td></tr>`
        : `<tr class="row${r.hit ? " hit" : ""}"><td>${esc(r.name)}</td><td>${esc(r.addr)}</td><td>${esc(r.people)}人</td></tr>`)).join("")}</table></div>
    <svg class="wire" id="wire"><path id="wpath" pathLength="1"></path></svg>
    <div class="ans" id="ans"><p class="ak">${esc(hit.part)}の避難（町のページ）</p>
      <p class="at">${esc(hit.text).replace(/(\d[\d,]*)(人)/g, "<b>$1</b>$2")}</p>
      <span class="src">出典：${esc(cite.doc)} ${cite.page}ページ</span></div>`;
  // 隅の札は「演出（イメージ）」（作者「出す」）。数と文は本物のデータ
  await wait(300);
  $("doc").classList.add("on");
  caption("公式の資料", `${cite.doc.replace(/（.+?）/, "")}　${cite.page}ページ`);
  await wait(1900);
  $("doc").classList.add("dim");
  document.querySelector("tr.hit").classList.add("lit");
  await wait(1100);
  // 光った行の右の端から、答えのカードの左の端へ線を引く
  const a = document.querySelector("tr.hit").getBoundingClientRect(), b = $("ans").getBoundingClientRect();
  const x1 = a.right + 8, y1 = a.top + a.height / 2, x2 = b.left - 8, y2 = b.top + b.height * 0.45;
  $("wpath").setAttribute("d", `M${x1},${y1} C${x1 + (x2 - x1) * 0.5},${y1} ${x1 + (x2 - x1) * 0.5},${y2} ${x2},${y2}`);
  $("wpath").classList.add("on");
  await wait(1000);
  $("ans").classList.add("on");
  caption("出典つきで、1枚のカードに", "AI が読み、数を照らして、町のページへ");
}

// 物差しのます目が埋まっていく
async function sceneGrid() {
  const [yard, ans, name, feats, muni] = await Promise.all([json("data/yardstick.json"), json(`data/answers/${CODE}.json`), townName(), json("data/features.json"), json(`data/muni/${CODE}.json`)]);
  // その町に当てはまる問いだけ（町を調べるときと同じ決まり：町・字の問い・ほかの町だけの問い・その町に無い特徴の問い・数の条件に合わない問いは除く。scripts/research.mjs の researchTown）
  const f = feats?.towns?.[CODE] ?? [];
  const t = muni?.stats?.towns?.[CODE];
  const ruleOk = (x) => {
    const fr = x.rule?.match(/外国の住民.*?(\d+(?:\.\d+)?)\s*%/), old = x.rule?.match(/65歳以上.*?(\d+(?:\.\d+)?)\s*%/);
    return (!fr || (t?.foreignRate ?? 0) >= Number(fr[1])) && (!old || (t?.over65Rate ?? 0) >= Number(old[1]));
  };
  const qs = yard.questions.filter((x) => x.level !== "town" && (!x.only || x.only === CODE) && (!x.feature || f.includes(x.feature)) && ruleOk(x));
  const st = new Map();
  for (const a of ans?.answers ?? []) st.set(a.qid, a.value === "見つからなかった" ? "none" : "ok");
  const okN = qs.filter((x) => st.get(x.id) === "ok").length;
  $("stage").innerHTML = `<div class="gwrap"><div class="ghead"><span class="gt">${esc(name)}：物差しの ${qs.length} 問</span><span class="gc"><b id="gn">0</b> 問に、出典つきで答えた</span></div>
    <div class="grid">${qs.map((x) => `<div class="cell" data-q="${x.id}">${esc(x.short ?? "")}</div>`).join("")}</div>
    <div class="glegend"><span><i></i>出典つきで答えた</span><span><i class="n"></i>公式の資料に見つからなかった（町の人に聞きたいこと）</span></div></div>`;

  caption("物差しで、町を調べる", `Claude が公式の資料を読み、${qs.length}の問いに答えていく`);
  await wait(1200);
  // 埋まる順は毎回同じ（録り直しても同じ絵に）
  const cells = [...document.querySelectorAll(".cell")].filter((c) => st.has(c.dataset.q));
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  cells.sort(() => rnd() - 0.5);
  let n = 0;
  for (const c of cells) {
    c.classList.add(st.get(c.dataset.q));
    if (st.get(c.dataset.q) === "ok") $("gn").textContent = ++n;
    await wait(6500 / cells.length);
  }
  $("gn").textContent = okN;
}

// 大きな数が数え上がる
async function sceneNum() {
  let v = Number(q.get("v")), unit = q.get("unit") ?? "人", who = q.get("who"), src = q.get("src");
  if (!v) {
    const kind = q.get("kind") ?? "津波";
    const fp = await json(`data/flood-pop/${CODE}.json`);
    const k = fp?.kinds?.[kind];
    v = k?.people ?? 0;
    who ??= `${await townName()}で、${kind === "土砂" ? "土砂災害警戒区域" : `${kind}で浸かる想定の所`}に住む人`;
    src ??= `町の人の ${k?.rate}%。国勢調査の 250m 四方の人口 × ${kind}の想定から出した、めやすです`;
  }
  $("stage").innerHTML = `<div class="big" id="big"><div class="who">${esc(who ?? "")}</div><div class="v"><span id="vn">0</span><small>${esc(unit)}</small></div><div class="src">${esc(src ?? "")}</div></div>`;

  await wait(300);
  $("big").classList.add("on");
  await wait(600);
  const t0 = performance.now(), dur = 1800;
  await new Promise((done) => {
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - (1 - p) ** 3;
      $("vn").textContent = Math.round(v * e).toLocaleString("ja-JP");
      if (p < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
}

// 棒が伸びる（大泉町の「母語で読める人」）
async function sceneBar() {
  const a = Number(q.get("a") ?? 52.1), b = Number(q.get("b") ?? 86.1);
  const name = await townName();
  $("stage").innerHTML = `<div class="bars"><p class="bt">${esc(q.get("title") ?? `${name}の外国の住民のうち、母語で読める人`)}</p>
    <div class="bar"><i id="ba"></i><span>${esc(q.get("la") ?? "町の防災マップ")}</span><b id="na">0%</b></div>
    <div class="bar b"><i id="bb"></i><span>${esc(q.get("lb") ?? "まちしるべの訳を足すと")}</span><b id="nb">0%</b></div>
    <p class="src">${esc(q.get("src") ?? "母語は国籍から推し量ったもの（めやす）。町の国籍ごとの人数と、防災マップの言葉から")}</p></div>`;

  const grow = async (bar, num, v) => {
    await wait(200);
    $(bar).style.width = `${v}%`;
    const t0 = performance.now();
    await new Promise((done) => { const step = (t) => { const p = Math.min(1, (t - t0) / 2200), e = 1 - (1 - p) ** 3; $(num).textContent = `${(v * e).toFixed(1)}%`; if (p < 1) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
  };
  await wait(500);
  await grow("ba", "na", a);
  await wait(700);
  await grow("bb", "nb", b);
}

// 町の防災計画のページが積み上がり、住む人に要る所だけの1枚に縮まる（台本 0:24「届いていない」。数は本物の PDF のページ数）
//  ?scene=pages&a=298&b=156&doc=黒潮町地域防災計画（令和8年3月）
async function scenePages() {
  const a = Number(q.get("a") ?? 298), b = Number(q.get("b") ?? 156), total = a + b;
  const doc = q.get("doc") ?? "黒潮町地域防災計画（令和8年3月）";
  const plan = await json(`data/plan/${CODE}.json`);
  const hit = Object.values(plan?.parts ?? {}).flatMap((p) => p.points.map((x) => ({ ...x, part: p.name }))).find((x) => x.text.includes(q.get("hit") ?? "早咲地区津波避難タワー"));
  const SHEETS = 46; // 画面に描く紙の枚数（数は total まで数え上がる）
  $("stage").innerHTML = `<div class="pile" id="pile">${Array.from({ length: SHEETS }, (_, i) => `<i style="--i:${i};--r:${((i * 37) % 9) - 4}deg;--x:${((i * 53) % 13) - 6}px"></i>`).join("")}</div>
    <div class="pcount" id="pcount"><b id="pn">0</b><small>ページ</small><span>${esc(doc)}　本編 ${a}・資料編 ${b}</span></div>
    <div class="ans one" id="one"><p class="ak">${esc(hit?.part ?? "")}の避難（町のページ）</p><p class="at">${esc(hit?.text ?? "").replace(/(\d[\d,]*)(人)/g, "<b>$1</b>$2")}</p><span class="src">出典：${esc(hit?.cites?.[0]?.doc ?? doc)} ${hit?.cites?.[0]?.page ?? ""}ページ</span></div>`;
  caption("町の防災計画", `${total} ページ`);
  await wait(500);
  // 紙が積み上がる。数は紙に合わせて total まで
  const sheets = [...document.querySelectorAll("#pile i")];
  const t0 = performance.now(), dur = 3600;
  await new Promise((done) => {
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - (1 - p) ** 2;
      const k = Math.round(SHEETS * e);
      sheets.forEach((s, i) => s.classList.toggle("on", i < k));
      $("pn").textContent = Math.round(total * e).toLocaleString("ja-JP");
      if (p < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  await wait(1200);
  caption("住む人に要る所だけ", "1枚のカードに");
  $("pile").classList.add("shrink");
  $("pcount").classList.add("shrink");
  await wait(900);
  $("one").classList.add("on");
}

// 終わりの札：作品の名前・「あなたの町も」・サイトの URL（作者「1~3直して」）
//  ?scene=end
async function sceneEnd() {
  $("badge").hidden = true;
  $("stage").innerHTML = `<div class="end" id="end"><p class="en-t">まちしるべ</p><p class="en-s">あなたの町も。</p><p class="en-u">tyra0119.github.io/machi-shirube</p></div>`;
  await wait(300);
  $("end").classList.add("on");
}

const SCENES = { card: sceneCard, grid: sceneGrid, num: sceneNum, bar: sceneBar, pages: scenePages, end: sceneEnd };
async function run() {
  $("start").hidden = true;
  $("cap").classList.remove("on");
  await (SCENES[SCENE] ?? sceneCard)();
}
$("go").addEventListener("click", run);
addEventListener("keydown", (e) => { if (e.key === "r" || e.key === "R") run(); });
if (q.has("auto")) run();
