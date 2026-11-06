// 調べる画面：research.html?muni=39428、町・字は research.html?muni=11227&part=0130（町・字ごとの問いだけを調べる）
// 手元の画面（npm run serve:research）では「調べ始める」で Claude が物差しの問いを順に調べる。
// 公開のサイトでは、いまの答えの様子（ます目）だけを見せる
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const code = new URLSearchParams(location.search).get("muni");
const part = new URLSearchParams(location.search).get("part");
const scope = part ? `town:${code}-${part}` : `muni:${code}`;
let partFeature = null; // 町・字の形（地図で光らせる）
const hhmm = (iso) => new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

let questions = [];
let pickQs = (y) => y.questions; // この町のます目に出す問いを選ぶ（main で決まる）
let skipWhy = new Map(); // この町には聞かない問い（決まりに合わない）と、その理由
let items = [];
let run = null;
let local = false;
let STATS = null;
let queued = null; // 予約の番号（ほかの町を調べている最中に「調べ始める」を押したとき）
const townName = (c, p) => { const t = STATS?.towns?.[c]; return t ? `${t.name.replace(/^.+?郡(?=.+[町村]$)/, "")}${p ? `（町・字 ${p}）` : ""}` : c; };

main();
async function main() {
  const [stats, yard] = await Promise.all([fetch("data/stats.json").then((r) => r.json()), fetch("data/yardstick.json").then((r) => r.json())]);
  // 町・字ごとの問いは、町・字を調べるときだけ。「この町だけ」の問いはその町だけ
  const featData = await fetch("data/features.json").then((r) => r.json()).catch(() => ({ towns: {} }));
  const feats = featData.towns[code] ?? [], featRules = featData.rules;
  STATS = stats;
  const t = stats.towns[code];
  // 決まりつきの問い（rule：「外国の住民の割合が 5% 以上の町だけ」など）は、その決まりに合う町だけ（調べる側 research.mjs の townQuestions、町のページ scenes.js と同じ）。
  // 前はます目だけ決まりを見ず、朝霞市（外国の住民 3.74%）で Q76 が「まだ」と出て、押しても何も調べなかった（作者「朝霞市の76,78は『まだ』になっているが合ってる？」11/6）
  const ruleOk = (q) => {
    const fr = q.rule?.match(/外国の住民.*?(\d+(?:\.\d+)?)\s*%/), old = q.rule?.match(/65歳以上.*?(\d+(?:\.\d+)?)\s*%/);
    return (!fr || (t?.foreignRate ?? 0) >= Number(fr[1])) && (!old || (t?.over65Rate ?? 0) >= Number(old[1]));
  };
  // 決まりに合わない問いも、カードは出す（「聞かない」の印と理由つき）。作者「聞かない問いのカード自体は表示していい。表示していたほうがわかりやすい（なんで表示されないの？となるため）」
  // ほかの町だけの問い（only）・町の特徴の問い（feature）も同じ（作者「Q14はなぜ表示されない？」：Q14 は黒潮町だけの問い）
  const FEAT = { nougyou: "農業・林業の多い町", gyogyou: "漁業の多い町", yuki: "豪雪地帯の町", kazan: "火山災害警戒地域の町", shima: "離島がある町" };
  const FEAT_RULE = Object.fromEntries(String(featRules ?? "").split("／").map((s) => s.split("：")).filter((x) => x.length === 2).map(([k, v]) => [k, v]));
  const FEAT_KEY = { nougyou: "農業", gyogyou: "漁業", yuki: "雪", kazan: "火山", shima: "島" };
  const nameOf = (c) => stats.towns[c]?.name.replace(/^.+?郡(?=.+[町村]$)/, "") ?? c;
  const whyNot = (q) => {
    if (q.only && q.only !== code) return `${nameOf(q.only)}だけの問いです（${esc(q.group ?? "その町のために足した問い")}）。この町には聞きません`;
    if (q.feature && !feats.includes(q.feature)) return `${FEAT[q.feature] ?? q.feature}だけに聞く問いです${FEAT_RULE[FEAT_KEY[q.feature]] ? `（決まり：${FEAT_RULE[FEAT_KEY[q.feature]]}）` : ""}。この町は当てはまらないので聞きません`;
    if (!ruleOk(q)) {
      const fr = /外国の住民/.test(q.rule), now = fr ? t?.foreignRate : t?.over65Rate;
      return `問いの決まり「${q.rule}」に合わないので、この町には聞きません（この町の${fr ? "外国の住民の割合" : "65歳以上の割合"}は ${now ?? "?"}%）`;
    }
    return null;
  };
  // ます目に出す問い（町・字のときは町・字の問い）と、この町には聞かない問いの理由
  pickQs = (y) => {
    // 番号の順に並べる（物差しの順だと Q14 が Q28 のうしろに来て、Q13 と Q15 のあいだを見ても見つからない）
    const num = (q) => Number(q.id.slice(1)) || 0;
    const qs = y.questions.filter((q) => (q.level === "town") === Boolean(part)).sort((a, b) => num(a) - num(b));
    skipWhy = new Map(qs.map((q) => [q.id, whyNot(q)]).filter(([, w]) => w));
    return qs;
  };
  questions = pickQs(yard);
  if (!t) { $("name").textContent = "町が見つかりません"; return; }
  const muniName = t.name.replace(/^.+?郡(?=.+[町村]$)/, "");
  if (part) {
    const topo = await fetch(`data/towns/${code}.json`).then((r) => r.json());
    partFeature = topojson.feature(topo, topo.objects.towns).features.find((f) => f.properties.part === part);
  }
  const name = partFeature ? `${muniName} ${partFeature.properties.name}` : muniName;
  document.title = `${name}を調べる｜まちしるべ`;
  $("name").textContent = `${name}を調べる`;
  $("where").textContent = `${t.pref}・市区町村コード ${code}${part ? `・町・字の番号 ${part}（町・字ごとの問い。市全体の答えは ${muniName}を調べる画面で）` : ""}・物差しの問い ${questions.length - skipWhy.size}${skipWhy.size ? `（ほかに、この町には聞かない問い ${skipWhy.size}）` : ""}（版 ${yard.version}）`;
  $("path").innerHTML = `<li><a href="./">日本</a></li><li><a href="./?pref=${encodeURIComponent(t.pref)}">${esc(t.pref)}</a></li><li><a href="town.html?muni=${code}">${esc(muniName)}</a></li>${partFeature ? `<li><a href="town.html?town=${code}-${part}">${esc(partFeature.properties.name)}</a></li>` : ""}<li><span>調べる</span></li>`;
  drawMap();

  const ping = await fetch("api/ping").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  local = !!ping;
  if (!local) {
    $("start").disabled = true;
    $("note").textContent = "調べるのは作者の手元の画面だけです。ここでは、いまの答えの様子を見られます。";
    $("review-link").hidden = true;
  } else {
    $("limit").textContent = `$${ping.runLimit ?? 4}`; // 調べ始める前から本当の上限を（画面の初めの字は $4 のままだった）
    $("note").textContent = `見込み：問い1つ 約 $${ping.estimate?.usd ?? 0.3}・${ping.estimate?.min ?? 1}分${ping.estimate ? `（これまでの調べ ${ping.estimate.n} 件の中ほどの値。採点と探し直しは別）` : ""}。まだ答えの無い問いだけを調べます。1回の調べの上限は $${ping.runLimit ?? 4}、1日の上限は $80、合計の上限は $550。`;
  }
  $("start").addEventListener("click", () => start());
  // ます目のカードを押すと、その問いの答えと「この問いだけ調べ直す」を出す（作者「あるカード（例えばQ76）だけを再度調べることはできる？」11/6）
  $("grid").addEventListener("click", (e) => {
    if (e.target.closest(".p-close")) return showPick(picked);
    if (e.target.closest("#redo")) { e.target.disabled = true; return start({ qids: [picked], redo: true }); }
    const li = e.target.closest("li[data-q]");
    if (li) showPick(li.dataset.q);
  });
  $("grid").addEventListener("keydown", (e) => { const li = e.target.closest("li[data-q]"); if (li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); showPick(li.dataset.q); } });
  // 終わりの通知の許しは、調べ始める前に別のボタンで聞く（「調べ始める」で聞くと、録画の最中に確かめの窓が出る。断られても音とタブの名前で知らせる）
  if ("Notification" in window && Notification.permission === "default") {
    $("start").insertAdjacentHTML("afterend", `<button type="button" id="notify-ok" class="secondary r-notify">終わったら通知を出す</button>`);
    $("notify-ok").addEventListener("click", async () => { await Notification.requestPermission(); $("notify-ok").remove(); });
  }
  $("stop").addEventListener("click", () => run && fetch(`api/runs/${run.id}/stop`, { method: "POST" }));
  // この町をもう調べている・予約しているときは、開き直してもその様子を出す
  if (local) {
    const st = await fetch("api/runs").then((r) => r.json()).catch(() => null);
    const mine = st?.running?.find((x) => x.code === code && (x.part ?? null) === (part ?? null));
    const q = st?.queue?.find((x) => x.code === code && (x.part ?? null) === (part ?? null));
    if (mine) { run = { id: mine.id }; $("start").disabled = true; $("stop").hidden = false; poll(); }
    else if (q) { queued = q.id; $("start").disabled = true; showQueued(st.queue.indexOf(q) + 1, st.running[0]); waitTurn(); }
  }
  await loadItems();
  renderGrid();
  await showProposals();
  if (local) showHistory();
}

// 前の調べの記録（作者「作業ログについて、過去の分も表示することはできない？」11/6）：新しい回から。押すと、その回の作業の流れが開く
async function showHistory() {
  const d = await fetch(`api/history?code=${code}${part ? `&part=${part}` : ""}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const list = (d?.list ?? []).filter((h) => h.id !== run?.id);
  $("hist-block").hidden = !list.length;
  if (!list.length) return;
  const day = (iso) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const tm = (iso) => new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  const label = { done: "調べ終わり", stopped: "止めました", failed: "止まりました", running: "途中で終わった" };
  $("hist").innerHTML = list.map((h, i) => `<details data-i="${i}"><summary>
    <span class="h-when">${day(h.startedAt)}〜${tm(h.endedAt ?? h.startedAt)}</span>
    <span class="h-what">${h.kind === "run" ? `${label[h.status] ?? esc(h.status)}・答え ${h.answers}` : `コマンドから調べた分・問い ${h.questions}`}・&#36;${(h.usd ?? 0).toFixed(2)}・${h.log.length} 行</span>
  </summary><ol class="r-flow"></ol></details>`).join("");
  // 作業の流れは、開いたときに入れる（数百行の回がいくつもあるので）
  for (const el of $("hist").querySelectorAll("details")) el.addEventListener("toggle", () => {
    const ol = el.querySelector("ol");
    if (!el.open || ol.childElementCount) return;
    ol.innerHTML = list[Number(el.dataset.i)].log.map((l) => `<li><time>${hhmm(l.at)}</time><span>${esc(l.text)}</span></li>`).join("");
  });
}

// いまの答え（手元なら台帳、公開なら公開の答えと確かめる一覧）
async function loadItems() {
  if (local) {
    items = (await (await fetch("api/review")).json()).items.filter((x) => x.scope === scope);
  } else {
    const ans = await fetch(`data/answers/${part ? `${code}-${part}` : code}.json`).then((r) => (r.ok ? r.json() : { answers: [] })).catch(() => ({ answers: [] }));
    const rev = await fetch("data/review.json").then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }));
    // 確かめる一覧の記録を先に、公開の答え（点数つき）を後に並べる（同じ問いでは後ろのものを使うため）
    items = [...rev.items.filter((x) => x.scope === scope), ...ans.answers];
  }
  $("pending").textContent = items.filter((x) => x.status === "pending").length;
}

// いまの答え：消した答え・出さないにした答えより、出している答え・確かめ待ちを先に見る
// （前は最後の記録を見ていたので、探し直して前の答えを消したあとの問いが「0点」と出ていた。美濃加茂市の Q76）
const live = (x) => !x.status || ["pending", "ok", "auto"].includes(x.status);
function latest(q) {
  const its = items.filter((x) => (x.qid ?? "") === q.id || x.question === q.text);
  return its.filter(live).at(-1) ?? its.at(-1);
}
function stateOf(q) {
  if (skipWhy.has(q.id)) return "skip";
  const doing = run?.status === "running" && run.log.findLast((l) => l.text.includes("調べ始めます"))?.text.includes(q.text);
  return doing ? "doing" : answerState(q);
}
// 答えの状態だけ（いま調べているかは見ない）：まだ "" ・保留 "pending"・点数 "s0"〜"s3"・聞かない "skip"
function answerState(q) {
  if (skipWhy.has(q.id)) return "skip";
  const it = latest(q);
  if (!it) return "";
  // 点数（0〜3）で濃さを変える。人の判断待ちは点を付けず「保留」
  if (it.status === "pending") return "pending";
  if (it.score != null) return `s${it.score}`;
  return "";
}
// 押したカードの問い：押したカードのすぐ下の行に、いまの答え・点数と「この問いだけ調べ直す」を開く
// （作者「あるカード（例えばQ76）だけを再度調べることはできる？」11/6。ます目の上に出すと、カードから遠くて見つけにくかった）
let picked = null;
function showPick(id) {
  picked = picked === id ? null : id;
  renderGrid();
  if (picked) document.getElementById("pick")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function pickHTML(q, st) {
  const it = latest(q);
  const has = it && live(it) && it.value !== "見つからなかった";
  const label = st === "skip" ? "この町には聞かない" : st === "doing" ? "いま調べています" : st === "pending" ? "保留（確かめ待ち）" : /^s\d/.test(st) ? `${st.slice(1)}点` : it ? "見つからなかった" : "まだ調べていません";
  const busy = run?.status === "running" || !!queued;
  const v = String(it?.value ?? "");
  return `<li class="r-pick" id="pick" aria-live="polite">
    <p class="p-head"><strong>${q.id}</strong><span class="p-short">${esc(q.short ?? q.group)}</span><span class="p-state">${label}</span>
      <button type="button" class="p-close secondary">閉じる</button></p>
    <p class="p-text">${esc(q.text)}</p>
    ${it ? `<div class="p-ans"><span>いまの答え${it.status === "pending" ? "（確かめ待ち）" : ""}</span>${esc(v.slice(0, 200))}${v.length > 200 ? "…" : ""}${it.source?.url ? `<a href="${esc(it.source.url)}" target="_blank" rel="noopener">出典</a>` : ""}</div>` : ""}
    ${st === "skip" ? `<p class="p-skip">${esc(skipWhy.get(q.id))}</p>` : local ? `<button type="button" id="redo" class="primary" ${busy ? "disabled" : ""}>${has ? "この問いだけ調べ直す" : "この問いだけ調べる"}</button>
    <p class="p-note">${busy ? "いまの調べ（予約）が終わってから押せます。" : `${has ? "新しい答えは自動では出さず、確かめる一覧に入ります。OK すると、前の答えと入れかわります（それまでは前の答えのまま）。" : "見つかった答えは、確かめる一覧に入ります。"}見込み 約 $0.3〜1・数分。町全体の見立てや提案はしません。`}</p>` : ""}
  </li>`;
}
function showNow(q) {
  const el = $("now");
  if (run?.status !== "running") { el.hidden = true; return; }
  const last = run.log.at(-1)?.text ?? "";
  const step = esc(last.length > 120 ? last.slice(0, 120) + "…" : last);
  el.hidden = false;
  if (!q) {
    el.innerHTML = `<p class="n-head"><span class="d-dot" aria-hidden="true"></span><span class="n-badge">仕上げ</span><strong>問いを調べ終わり、全体をまとめています</strong></p>
    <p class="n-step"><span>いまの作業</span>${step}</p>`;
    return;
  }
  const began = run.log.findLast((l) => l.text.includes("調べ始めます") && l.text.includes(q.text))?.at;
  const sec = began ? Math.max(0, Math.round((Date.now() - new Date(began)) / 1000)) : 0;
  el.innerHTML = `<p class="n-head"><span class="d-dot" aria-hidden="true"></span><span class="n-badge">いま調べている問い</span><strong>${q.id}</strong><span class="n-short">${esc(q.short ?? q.group)}</span></p>
    <p class="n-text">${esc(q.text)}</p>
    <p class="n-step"><span>いまの作業（この問いを調べ始めて ${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, "0")}秒）</span>${step}</p>
    <a href="#doing-tile" class="n-jump">ます目で見る（${questions.indexOf(q) + 1} 番目）</a>`;
}
function renderGrid() {
  renderGrow();
  updateMap();
  const states = questions.map(stateOf);
  // いま調べている問い：ます目の上に、問いの見出しと中身・いまの作業を大きく出す。ます目のカードにも「調べています」と見出しを入れる
  // （作者「Q76 を調べているとして、カードの周りが点滅する感じだが、とても分かりにくい」11/6）
  const tile = (q, i) => states[i] === "doing"
    ? `<li class="doing${picked === q.id ? " picked" : ""}" id="doing-tile" data-q="${q.id}" tabindex="0" role="button" aria-expanded="${picked === q.id}" title="${esc(q.text)}"><span class="id">${q.id}</span><span class="d-label"><span class="d-dot" aria-hidden="true"></span>調べています</span><span class="d-short">${esc(q.short ?? q.group)}</span></li>`
    : `<li class="${states[i]}${picked === q.id ? " picked" : ""}" data-q="${q.id}" tabindex="0" role="button" aria-expanded="${picked === q.id}" title="${esc(q.text)}"><span class="id">${q.id}</span><span class="g">${esc(q.group)}</span>${/^s\d/.test(states[i]) ? `<span class="pt">${states[i].slice(1)}点</span>` : states[i] === "pending" ? `<span class="pt">保留</span>` : states[i] === "skip" ? `<span class="pt">聞かない</span>` : ""}</li>`;
  // 押したカードの行の終わりに、横いっぱいの欄を入れる（列の数は画面の幅で 5 か 3）
  const cols = getComputedStyle($("grid")).gridTemplateColumns.split(" ").filter(Boolean).length || 5;
  const pi = questions.findIndex((q) => q.id === picked);
  const at = pi < 0 ? -1 : Math.min(questions.length - 1, Math.floor(pi / cols) * cols + cols - 1);
  const keepFocus = document.activeElement?.closest?.("#grid") ? document.activeElement.dataset.q ?? document.activeElement.id : null;
  $("grid").innerHTML = questions.map((q, i) => tile(q, i) + (i === at ? pickHTML(questions[pi], states[pi]) : "")).join("");
  if (keepFocus) ($("grid").querySelector(`[data-q="${keepFocus}"]`) ?? document.getElementById(keepFocus))?.focus({ preventScroll: true });
  showNow(questions[states.indexOf("doing")]);
  const n = (s) => states.filter((x) => x === s).length;
  const scored = states.filter((x) => /^s\d/.test(x));
  const pass = scored.filter((x) => x >= "s2").length;
  $("grid-sum").textContent = `3点 ${n("s3")}・2点 ${n("s2")}・1点 ${n("s1")}・0点 ${n("s0")}・保留 ${n("pending")}・まだ ${n("")}${n("skip") ? `・この町には聞かない ${n("skip")}` : ""}。合格（2点以上）は 保留を除いた ${scored.length}問のうち ${pass}問`;
}

// extra：1問だけ調べ直すとき { qids: ["Q76"], redo: true }
async function start(extra = {}) {
  $("start").disabled = true;
  const res = await fetch("api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, part: part ?? undefined, ...(extra.qids ? extra : {}) }) });
  const body = await res.json();
  if (!res.ok) { $("note").textContent = `始められませんでした：${body.error}`; $("start").disabled = false; return; }
  // ほかの町を調べている最中なら、予約になる（作者「予約できるようにして。…調査中の町が終わったら自動実行」）
  if (body.queued) { queued = body.id; showQueued(body.position, body.current); waitTurn(); return; }
  run = body;
  $("stop").hidden = false;
  poll();
}

// 予約したこと・何番目か・取り消し
function showQueued(pos, cur) {
  $("note").innerHTML = `予約しました（${pos} 番目）。いま調べている${cur ? esc(townName(cur.code, cur.part)) : "町"}が終わったら、自動でこの町を始めます。この画面は閉じてもかまいません（手元のサーバーが動いているあいだ）。 <button type="button" id="unqueue" class="secondary">予約を取り消す</button>`;
  $("unqueue").addEventListener("click", async () => {
    const res = await fetch(`api/queue/${queued}/cancel`, { method: "POST" });
    queued = null;
    $("note").textContent = res.ok ? "予約を取り消しました。" : "予約は、もう始まったか、無くなっていました。";
    $("start").disabled = false;
  });
}
// 自分の番を待つ：この町の調べが始まったら、その様子を出す
async function waitTurn() {
  if (!queued) return;
  const st = await fetch("api/runs").then((r) => r.json()).catch(() => null);
  const mine = st?.running?.find((x) => x.code === code && (x.part ?? null) === (part ?? null));
  if (mine) { queued = null; run = { id: mine.id }; $("stop").hidden = false; $("note").textContent = "予約していたこの町の調べが始まりました。"; return poll(); }
  const i = st?.queue?.findIndex((x) => x.id === queued) ?? -1;
  if (i < 0) { queued = null; $("start").disabled = false; $("note").textContent = "予約が見つからなくなりました（手元のサーバーを動かし直したときなど）。もう一度押してください。"; return; }
  const pos = $("note").textContent.match(/（(\d+) 番目）/)?.[1];
  if (pos && Number(pos) !== i + 1) showQueued(i + 1, st.running[0]);
  setTimeout(waitTurn, 3000);
}

// Claude からの提案の帯：物差しにない問い［物差しに足す］［今はしない］（町だけの問いは作らない。作者「町限定にしないこと」11/6）、調べ方［スキルにする］［今はしない］
async function showProposals() {
  const { proposals } = await fetch(`api/proposals?code=${code}`).then((r) => r.json()).catch(() => ({ proposals: [] }));
  $("proposals").hidden = !proposals.length;
  if (!proposals.length) return;
  $("proposals").innerHTML = `<h2>Claude からの提案</h2>` + proposals.map((p) => p.kind === "question" ? `
    <div class="prop" data-id="${p.id}">
      <p class="what">物差しに無い問い：<strong>${esc(p.text)}</strong></p>
      <p class="why">${esc(p.why ?? "")}${p.reach === "rule" && p.rule ? `（Claude の見立て：${esc(p.rule)}に）` : p.reach === "all" ? "（Claude の見立て：どの町にも）" : ""}</p>
      <div class="decide"><button type="button" class="primary" data-a="all">物差しに足す<small>${p.reach === "rule" && p.rule ? `決まりに合う町に聞く（${esc(p.rule)}）` : "どの町にも聞く問いにする"}</small></button>
        <button type="button" data-a="later">今はしない</button></div>
    </div>` : `
    <div class="prop" data-id="${p.id}">
      <p class="what">この調べ方をスキルにしますか？ <strong>${esc(p.name)}</strong></p>
      <ol class="steps">${(p.steps ?? []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      <p class="why">${esc(p.why ?? "")}（使える問い：${esc((p.forQids ?? []).join("・"))}）</p>
      <div class="decide"><button type="button" class="primary" data-a="skill">スキルにする<small>次の町で同じ問いを調べるときに使う</small></button>
        <button type="button" data-a="later">今はしない</button></div>
    </div>`).join("");
  for (const b of $("proposals").querySelectorAll("button[data-a]")) {
    b.addEventListener("click", async () => {
      const id = b.closest(".prop").dataset.id;
      const res = await fetch(`api/proposals/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: b.dataset.a }) });
      const body = await res.json();
      if (!res.ok) return ($("note").textContent = `できませんでした：${body.error}`);
      $("note").textContent = body.addedAs?.startsWith("Q") ? `物差しに ${body.addedAs} を足しました（${body.rule ? "決まりに合う町に聞く" : "どの町にも聞く"}）。` : body.addedAs ? `スキル ${body.addedAs} にしました。` : "今はしないにしました。";
      if (body.addedAs?.startsWith("Q")) { const yard = await fetch("data/yardstick.json", { cache: "no-store" }).then((r) => r.json()); questions = pickQs(yard); renderGrid(); }
      await showProposals();
    });
  }
}

async function poll() {
  run = await (await fetch(`api/runs/${run.id}`)).json();
  $("started").textContent = hhmm(run.startedAt);
  const end = run.endedAt ? new Date(run.endedAt) : new Date();
  const sec = Math.round((end - new Date(run.startedAt)) / 1000);
  $("elapsed").textContent = `${Math.floor(sec / 60)}分${sec % 60}秒`;
  $("usd").textContent = `$${run.usd.toFixed(2)}`;
  $("limit").textContent = `$${run.limit}`;
  $("flow").innerHTML = run.log.map((l) => `<li><time>${hhmm(l.at)}</time><span>${esc(l.text)}</span></li>`).join("");
  $("flow").scrollTop = $("flow").scrollHeight;
  await loadItems();
  renderGrid();
  if (run.status === "running") return setTimeout(poll, 1500);
  $("stop").hidden = true;
  $("start").disabled = false;
  const label = { done: "調べ終わり", stopped: "止めました", failed: "止まりました" }[run.status];
  $("note").textContent = `${label}（確かめ待ち ${$("pending").textContent}件）。見つからなかった問いは、町の人に聞くことの候補です。`;
  await showProposals();
  showHistory();
  doneNotice(label);
}

// 調べ終わったら知らせる：タブの名前を変え、短い音を鳴らし、許されていれば Windows の通知も出す
// （作者「全部やる」の F：その場で押す町は20〜45分かかるので、待つあいだ別のことができるように。音はファイルを使わず、その場で作る）
function doneNotice(label) {
  const baseTitle = document.title.replace(/^【[^】]*】/, ""); // 町の名前の入ったいまの名前
  document.title = `【${label}】${baseTitle}`;
  addEventListener("focus", () => { document.title = baseTitle; }, { once: true });
  try {
    const ac = new AudioContext();
    for (const [i, f] of [660, 880].entries()) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = f; g.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + i * 0.25 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.25 + 0.22);
      o.connect(g).connect(ac.destination); o.start(ac.currentTime + i * 0.25); o.stop(ac.currentTime + i * 0.25 + 0.25);
    }
  } catch {}
  if ("Notification" in window && Notification.permission === "granted") new Notification(`まちしるべ：${label}`, { body: document.querySelector("h1")?.textContent ?? "" });
}

// 地図が育つ：町の形から始まり、答えが出るたびに重なっていく（避難場所の答え → 避難場所の点、ハザードマップの答え → 浸水の想定）
let rmap = null;
let mapReady = false; // 重ねる層を全部足し終えたら true
const GROW_LAYERS = [
  { id: "towns", label: "町・字の境", always: true },
  { id: "iryo", label: "病院・診療所（国のデータ）", always: true },
  { id: "shelters", label: "避難場所", qid: "Q01" },
  { id: "hazard", label: "浸水の想定（津波）", qid: "Q02" },
];
function updateMap() {
  if (!mapReady) return;
  const has = (qid) => items.some((x) => x.qid === qid && x.value !== "見つからなかった");
  const shown = GROW_LAYERS.filter((l) => l.always || has(l.qid));
  for (const l of GROW_LAYERS) for (const id of [l.id, `${l.id}-line`]) if (rmap.getLayer(id)) rmap.setLayoutProperty(id, "visibility", shown.includes(l) ? "visible" : "none");
  $("r-layers").innerHTML = shown.map((l) => `<li>${l.qid ? `<span class="new">${esc(l.qid)} の答えから</span>` : ""}${esc(l.label)}</li>`).join("");
}
async function drawMap() {
  const map = (rmap = new maplibregl.Map({
    container: "r-map",
    style: await baseStyle(),
    interactive: false,
    attributionControl: { compact: false },
  }));
  map.on("load", async () => {
    const topo = await fetch("data/japan.topo.json").then((r) => r.json());
    const features = partFeature ? [partFeature] : topojson.feature(topo, topo.objects.municipalities).features.filter((f) => f.properties.code === code);
    map.addSource("town", { type: "geojson", data: { type: "FeatureCollection", features } });
    map.addLayer({ id: "fill", type: "fill", source: "town", paint: { "fill-color": color("--accent"), "fill-opacity": 0.2 } });
    map.addLayer({ id: "line", type: "line", source: "town", paint: { "line-color": color("--accent"), "line-width": 3 } });
    raiseLabels(map); // 地名の文字は町の色の上に
    const box = new maplibregl.LngLatBounds();
    for (const f of features) for (const poly of f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) for (const pt of poly[0]) box.extend(pt);
    if (!box.isEmpty()) map.fitBounds(box, { padding: 40, duration: 0 });
    // 重なっていくもの（はじめは隠しておき、答えが出たら出す）
    const towns = await fetch(`data/towns/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (towns) {
      map.addSource("towns", { type: "geojson", data: topojson.feature(towns, towns.objects.towns) });
      map.addLayer({ id: "towns-line", type: "line", source: "towns", paint: { "line-color": color("--accent"), "line-width": 0.8, "line-opacity": 0.6 } });
    }
    const t = HAZARD_TILES["津波"];
    map.addSource("hazard", { type: "raster", tiles: [t.url], tileSize: 256, minzoom: 2, maxzoom: 17 });
    map.addLayer({ id: "hazard", type: "raster", source: "hazard", paint: { "raster-opacity": 0.6 } });
    const iryo = await fetch(`data/iryo/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (iryo) {
      map.addSource("iryo", { type: "geojson", data: { type: "FeatureCollection", features: iryo.list.filter((f) => f.p).map((f) => ({ type: "Feature", geometry: { type: "Point", coordinates: f.p }, properties: {} })) } });
      map.addLayer({ id: "iryo", type: "circle", source: "iryo", paint: { "circle-radius": 3, "circle-color": "#5b7f95", "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
    }
    const sh = await fetch(`data/shelters/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (sh) {
      map.addSource("shelters", { type: "geojson", data: sh });
      map.addLayer({ id: "shelters", type: "circle", source: "shelters", paint: { "circle-radius": 4, "circle-color": color("--accent"), "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
    }
    mapReady = true;
    updateMap();
  });
}

// 育つ町のページ：町のページの場面ごとに、答えの点数の印を並べる（● 点のある答え・◌ 保留・○ まだ）
const GROW_PAGES = [["bousai", "防災・避難", "shield"], ["gomi", "ごみ", "trash"], ["iryo", "医療・健康", "hospital"], ["koutsuu", "バス・電車", "bus"],
  ["tetsuzuki", "手続き", "doc"], ["foreign", "外国の方へ", "globe"], ["kaigo", "お年寄り・介護", "heart"], ["kosodate", "子育て", "child"], ["shiru", "町を知る", "book"]];
function renderGrow() {
  $("grow").innerHTML = GROW_PAGES.map(([page, label, ic]) => {
    // この町には聞かない問いは数えない。点はます目と同じ見方（出している答え・確かめ待ちを先に見る）
    const qs = questions.filter((q) => q.page === page && !skipWhy.has(q.id));
    if (!qs.length) return "";
    const st = qs.map(answerState);
    const marks = qs.map((q, i) => {
      const s = st[i];
      if (!s) return `<i class="m none" title="${esc(q.short ?? q.id)}：まだ"></i>`;
      if (s === "pending") return `<i class="m hold" title="${esc(q.short ?? q.id)}：保留"></i>`;
      return `<i class="m ${s}" title="${esc(q.short ?? q.id)}：${s.slice(1)}点"></i>`;
    }).join("");
    const done = st.filter((s) => /^s\d/.test(s)).length;
    return `<li class="${done ? "on" : ""}">${icon(ic)}<span class="l">${esc(label)}</span><span class="ms">${marks}</span><span class="n">${done}/${qs.length}</span></li>`;
  }).join("");
}
