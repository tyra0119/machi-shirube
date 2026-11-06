// 審査の方への体験：本物の調べの記録（site/data/replay/15385.json。scripts/build-replay.mjs）を速めて再生し、確かめる所を試してもらう。何も保存しない
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const mmss = (s) => `${Math.floor(s / 60)}分${Math.floor(s % 60)}秒`;
let D = null, t = 0, idx = 0, timer = null, usd = 0, pages = 0, reviewed = false;
// いま調べている問い（作者「調べ中の点滅など、審査員向けのページも修正してある？」11/6）：記録の「…を調べ始めます：問いの文」から、物差しの問いの番号を引く
let cur = null, curAt = 0, lastStep = "", finishing = false;
const byText = new Map();
const scores = {};

main();
async function main() {
  D = await fetch("data/replay/15385.json").then((r) => r.json());
  const yard = await fetch("data/yardstick.json").then((r) => r.json()).catch(() => ({ questions: [] }));
  for (const q of yard.questions) byText.set(q.text, q);
  const [y, m, d] = D.date.split("-").map(Number);
  $("when").textContent = `${y}年${m}月${d}日`;
  $("len").textContent = `${Math.round(D.seconds / 60)} 分・$${D.usd.toFixed(2)}`;
  $("limit").textContent = `$${D.limit}`;
  $("foot").textContent = D.note;
  drawGrid();
  drawReview();
  $("done").textContent = `0 / ${D.items.length}`;
  $("play").addEventListener("click", () => (timer ? pause() : play()));
  $("skip").addEventListener("click", () => { pause(); t = D.seconds; tick(0); });
}

// 操作の案内：いまの段（1〜3）に「いまここ」、次に押す所を光らせる
function stage(n) {
  for (const li of document.querySelectorAll(".try-flow li")) {
    const s = Number(li.dataset.step);
    li.classList.toggle("now", s === n);
    li.classList.toggle("done", s < n);
  }
  $("hint-play").hidden = n !== 1 || t > 0;
  $("play").classList.toggle("glow", n === 1 && t === 0);
  $("next-review").hidden = n !== 2;
  $("hint-review").hidden = n !== 2;
  for (const b of document.querySelectorAll("#review .try-item:first-child .ri-btns button")) b.classList.toggle("glow", n === 2);
  $("hint-pub").hidden = n !== 3;
  $("to-town").classList.toggle("glow", n === 3);
}

function play() {
  if (t >= D.seconds) reset();
  stage(1);
  $("hint-play").hidden = true;
  $("play").classList.remove("glow");
  $("play").textContent = "止める";
  timer = setInterval(() => tick(0.1 * Number($("speed").value)), 100);
}
function pause() { clearInterval(timer); timer = null; $("play").textContent = t >= D.seconds ? "もう一度再生する" : "続きを再生する"; }
function reset() { t = 0; idx = 0; usd = 0; pages = 0; cur = null; lastStep = ""; finishing = false; for (const k of Object.keys(scores)) delete scores[k]; $("log").innerHTML = ""; drawGrid(); }

function tick(dt) {
  t = Math.min(D.seconds, t + dt);
  const add = [];
  while (idx < D.steps.length && D.steps[idx].s <= t) {
    const st = D.steps[idx++];
    const c = st.t.match(/^Claude の答えが返りました（\$(\d+\.\d+)/);
    if (c) usd += Number(c[1]);
    if (/^読んでいます：/.test(st.t)) pages++;
    const sc = st.t.match(/^採点：(\w+) は (\d) 点/);
    if (sc) scores[sc[1]] = Number(sc[2]);
    const b = st.t.match(/を調べ始めます：(.+)$/);
    if (b) { cur = byText.get(b[1].trim())?.id ?? D.items.find((x) => b[1].includes(x.short))?.qid ?? null; curAt = st.s; finishing = false; }
    else if (/^(国のデータを重ねた数から|見立てた人ごとに|町・字ごとの数から|町の数と、確かめ済み|調べ終わりました|物差しを止めている)/.test(st.t)) { cur = null; finishing = true; }
    lastStep = st.t;
    add.push(st);
  }
  if (add.length) {
    $("log").insertAdjacentHTML("beforeend", add.map((st) => `<li class="${kind(st.t)}"><time>${mmss(st.s)}</time><span>${linkify(st.t)}</span></li>`).join(""));
    const lis = $("log").children;
    while (lis.length > 80) lis[0].remove(); // 長くなりすぎないように、新しい 80 行だけ
    $("log").scrollTop = $("log").scrollHeight;
    drawGrid();
  }
  $("clock").textContent = mmss(t);
  $("usd").textContent = `$${(t >= D.seconds ? D.usd : usd).toFixed(2)}`;
  $("pages").textContent = pages;
  $("done").textContent = `${Object.keys(scores).length} / ${D.items.length}`;
  drawNow();
  if (t >= D.seconds) { pause(); $("review-sec").classList.add("ready"); if (!reviewed) stage(2); }
}
// 行の種類（色分けの印）
const kind = (s) => (/^採点：/.test(s) ? "k-score" : /^確かめ/.test(s) ? "k-check" : /^読んでいます/.test(s) ? "k-read" : /^国のデータ|^(浸水|大きな地震|坂の多い所|町の気候|近くの介護|買い物に困って)/.test(s) ? "k-data" : /上限/.test(s) ? "k-limit" : "");
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s）)]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\//, "").slice(0, 60)}${u.length > 68 ? "…" : ""}</a>`);

function drawGrid() {
  $("grid").innerHTML = D.items.map((it) => {
    const s = scores[it.qid];
    const doing = it.qid === cur && t < D.seconds;
    return `<li class="${doing ? "doing" : s == null ? "" : `s${s}`}"><span class="q">${esc(it.qid)}</span><span class="t">${esc(it.short)}</span><span class="p">${doing ? `<span class="d-dot" aria-hidden="true"></span>調べています` : s == null ? "まだ" : s === 0 ? "見つからず" : `${s} 点`}</span></li>`;
  }).join("");
}
// ます目の上の帯：いま調べている問いの番号・見出し・問いの文・いまの作業（記録の最後の行）
function drawNow() {
  const el = $("now");
  const it = D.items.find((x) => x.qid === cur);
  if (t <= 0 || t >= D.seconds || (!it && !finishing)) { el.hidden = true; return; }
  el.hidden = false;
  const step = esc(lastStep.length > 110 ? lastStep.slice(0, 110) + "…" : lastStep);
  const q = it && [...byText.values()].find((x) => x.id === it.qid);
  el.innerHTML = it
    ? `<p class="n-head"><span class="d-dot" aria-hidden="true"></span><span class="n-badge">いま調べている問い</span><strong>${esc(it.qid)}</strong><span class="n-short">${esc(it.short)}</span></p>
      ${q ? `<p class="n-text">${esc(q.text)}</p>` : ""}
      <p class="n-step"><span>いまの作業（この問いを調べ始めて ${mmss(t - curAt)}）</span>${step}</p>`
    : `<p class="n-head"><span class="d-dot" aria-hidden="true"></span><span class="n-badge">仕上げ</span><strong>問いを調べ終わり、Claude が町全体をまとめています</strong></p>
      <p class="n-step"><span>いまの作業</span>${step}</p>`;
}

// 確かめる体験：押すと、本物ならどうなるかと、作者の実際の判断を出す（保存しない）
const WHAT = {
  ok: "本物なら：台帳に「OK・いつ・誰が」が記録され、「公開に送る」で町のページに出ます。はじめて使うサイトなら、そのサイトを使ってよいかも一緒に決まります。",
  fix: "本物なら：あなたの指摘（理由の1行）を添えて、Claude がこの問いだけを調べ直します。新しい答えは、また確かめる一覧に入ります。",
  no: "本物なら：町のページには出しません。「町の人に聞きたいこと」に入り、知っている人に教えてもらう入口になります。",
};
function drawReview() {
  $("review").innerHTML = D.review.map((r, i) => `<article class="try-item" data-i="${i}">
    <p class="ri-q"><span class="q">${esc(r.qid)}</span>${esc(r.short)}</p>
    <p class="ri-why"><strong>確かめ待ちになったわけ</strong>${esc(r.why)}</p>
    <details class="ri-val"><summary>答え（いま公開している中身）</summary><p>${esc(r.value).replace(/\n/g, "<br>")}</p>${r.source ? `<p class="ri-src">出典：<a href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.title)}</a></p>` : ""}</details>
    <div class="ri-btns"><button type="button" class="primary" data-a="ok">OK</button><button type="button" data-a="fix">直して</button><button type="button" data-a="no">出さない</button></div>
    <p class="ri-out" hidden></p>
  </article>`).join("");
  for (const b of $("review").querySelectorAll("button[data-a]")) b.addEventListener("click", () => {
    const art = b.closest(".try-item"), r = D.review[Number(art.dataset.i)];
    for (const x of art.querySelectorAll("button")) x.classList.toggle("picked", x === b);
    const out = art.querySelector(".ri-out");
    out.hidden = false;
    out.innerHTML = `${esc(WHAT[b.dataset.a])}<br><span class="real">作者の実際の判断：${esc(r.decided)}</span>（この体験では何も保存しません）`;
    // 1つ押したら、次の段（町のページ）へ案内する
    if (!reviewed) { reviewed = true; stage(3); $("next-review").hidden = false; $("next-review").querySelector("a").classList.remove("glow"); }
  });
}
