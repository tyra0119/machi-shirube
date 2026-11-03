// 確かめる一覧。手元の画面では決められる（OK・直して・出さない・分からない、元に戻す）。
// 公開のサイトでは、件数と、人が見たものの理由・出典の URL だけを見せる（引用した元の文は出さない）
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const LABEL = { revoked: "取り消した（サイトごと）", pending: "確かめ待ち", auto: "自動で承認", ok: "OK（出した）", fix: "直して（調べ直し待ち）", rejected: "出さない", unknown: "分からない（町の人に聞く）", void: "無効（しくみの不具合）" };
const ACTION = { ok: "OK にしました", fix: "直してに回しました。Claude が調べ直しています（1分ほどで確かめる一覧に新しい答えが入ります）", reject: "出さないにしました", unknown: "分からないにしました", undo: "元に戻しました" };

let local = false;
let data = { items: [] };
let all = []; // いまの全部の件
let tab = "pending"; // 確かめ待ち・決めたもの・自動で承認
let town = ""; // 町で絞る（scope）
let openId = null; // いま開いている1件
let kind = ""; // 札で絞る
let limit = 30; // 決めたもの・自動で承認は、新しい順にこの数まで（「もっと見る」で増やす）
let scrollToOpen = false; // 決めたあと、次に開いた1件まで画面を動かす

main();
async function main() {
  local = await fetch("api/ping").then((r) => r.ok).catch(() => false);
  $("mode").innerHTML = local
    ? `使い方：① 1件ずつ「判断してほしいこと」を読む　② 「出典を開く」で元のページを見る　③ 下の4つのボタンから選ぶ。<br>
       OK すると、次の公開（push）で町のページに出ます。押したあと6秒は元に戻せます。`
    : "公開のサイト：見るだけです。引用した元の文は出していません";
  await reload();
}

async function reload() {
  if (local) {
    data = await (await fetch("api/review")).json();
    all = data.items;
  } else {
    const pub = await fetch("data/review.json").then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }));
    all = pub.items; // 公開の一覧には、人が見たもの・見ているものだけが入る
    autoCount = pub.counts?.auto ?? 0;
  }
  render();
}
let autoCount = 0;

const inTab = (x) => (tab === "pending" ? x.status === "pending" : tab === "auto" ? x.status === "auto" : !["pending", "auto"].includes(x.status));
function render() {
  // 町で絞る（件数つき）
  const towns = [...new Map(all.map((x) => [x.scope, x.scopeName ?? x.scope])).entries()];
  const sel = $("town-filter");
  sel.innerHTML = `<option value="">全部の町</option>` + towns.map(([s, n]) => `<option value="${esc(s)}">${esc(n)}（${all.filter((x) => x.scope === s && inTab(x)).length}）</option>`).join("");
  sel.value = town;
  $("n-pending").textContent = all.filter((x) => x.status === "pending").length;
  $("n-decided").textContent = all.filter((x) => !["pending", "auto"].includes(x.status)).length;
  $("n-auto").textContent = local ? all.filter((x) => x.status === "auto").length : autoCount;
  document.querySelectorAll(".r-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));

  renderSites();
  renderCards();
  const inScope = all.filter((x) => inTab(x) && (!town || x.scope === town));
  // 札で絞る（件数つき）。数が多いときにスクロールしないで済むように
  const counts = new Map();
  for (const x of inScope) for (const t of new Set(tags(x))) counts.set(t, (counts.get(t) ?? 0) + 1);
  if (kind && !counts.has(kind)) kind = "";
  let kinds = $("kinds");
  if (!kinds) { kinds = document.createElement("div"); kinds.id = "kinds"; kinds.className = "r-kinds"; $("list").before(kinds); }
  kinds.innerHTML = counts.size > 1 ? [["", inScope.length], ...[...counts].sort((a, b) => b[1] - a[1])].map(([t, n]) => `<button type="button" data-kind="${esc(t)}" aria-pressed="${t === kind}">${t ? esc(t) : "すべて"}<b>${n}</b></button>`).join("") : "";
  kinds.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { kind = b.dataset.kind; openId = null; limit = 30; render(); }));
  const lastAt = (x) => x.decisions?.at(-1)?.at ?? x.createdAt ?? "";
  let list = inScope.filter((x) => !kind || tags(x).includes(kind));
  if (tab !== "pending") list = [...list].sort((a, b) => lastAt(b).localeCompare(lastAt(a)));
  const more = tab !== "pending" && list.length > limit ? list.length - limit : 0;
  if (more) list = list.slice(0, limit);
  $("summary").textContent = !local && tab === "auto" ? "自動で承認したものは、町のページの「確かめた答え」に出ています。" : "";
  if (!list.length) {
    $("list").innerHTML = `<p class="note">${tab === "pending" ? "確かめ待ちはありません。" : "まだありません。"}</p>`;
    return;
  }
  // 1件は1行。押すとその1件だけが開く
  $("list").innerHTML = list.map((it) => `
    <details class="r-row" data-id="${it.id}" ${it.id === openId ? "open" : ""}>
      <summary>
        <span class="r-where">${esc(it.scopeName ?? it.scope)}${it.qid ? `・${esc(it.qid)}` : ""}</span>
        <span class="r-q">${esc(it.question)}</span>
        <span class="r-tags">${tags(it).map((t) => `<span>${esc(t)}</span>`).join("")}</span>
      </summary>
      ${itemHTML(it)}
    </details>`).join("") + (more ? `<button type="button" class="r-more" id="more">もっと見る（あと ${more} 件）</button>` : "");
  $("more")?.addEventListener("click", () => { limit += 30; render(); });
  if (scrollToOpen && openId) { scrollToOpen = false; document.querySelector(`.r-row[data-id="${openId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  for (const d of document.querySelectorAll(".r-row")) {
    d.addEventListener("toggle", () => {
      if (!d.open) return;
      openId = d.dataset.id;
      document.querySelectorAll(".r-row").forEach((o) => o !== d && (o.open = false));
    });
  }
  if (local) wire();
}
// 使ってよいとしたサイト（情報源カード）：「決めたもの」のタブで一覧にし、カードごとに取り消せる（そのサイトの答えを全部ページから下げる）
async function renderCards() {
  const show = local && tab === "decided";
  $("cards").hidden = !show;
  if (!show) return;
  const { cards } = await fetch("api/cards").then((r) => r.json()).catch(() => ({ cards: [] }));
  const list = cards.filter((c) => c.status === "ok" && (!town || c.scope === town.replace(/^town:(\d{5}).*/, "muni:$1")));
  if (!list.length) { $("cards").hidden = true; return; }
  // 長くなるので、押すと開く形にまとめる（いつも開いていると、決めたものの一覧までのスクロールが長い）
  $("cards").innerHTML = `<details class="cards-box">
    <summary><h2>使ってよいとしたサイト（${list.length}）</h2></summary>
    <p class="note">取り消すと、そのサイトから出した答え（OK・自動で承認）が全部、町のページから下がります。次からそのサイトの答えは自動になりません。理由は記録に残ります。</p>
    <ul class="site-list">${list.map((c) => `
      <li data-id="${esc(c.id)}">
        <p class="site-name"><strong>${esc(c.host)}</strong>・${esc(c.scopeName ?? c.scope)}・${esc(c.approvedAt?.slice(0, 10) ?? "")} に使ってよいとした（${esc(c.id)}）</p>
        <div class="decide">
          <button type="button" data-revoke>取り消す<small>このサイトの答えを全部下げる</small></button>
          <form class="why-form" hidden><label class="field">理由を1行<input name="reason" maxlength="100" required></label><button type="submit">取り消す</button></form>
        </div>
      </li>`).join("")}</ul></details>`;
  for (const li of $("cards").querySelectorAll("li[data-id]")) {
    const form = li.querySelector(".why-form");
    li.querySelector("[data-revoke]").addEventListener("click", () => { form.hidden = false; form.reason.focus(); });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const done = busy(form.querySelector("button[type=submit]"), "取り消しています…");
      const res = await fetch(`api/cards/${li.dataset.id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: form.reason.value }) });
      const body = await res.json();
      if (!res.ok) { done(); return toast(`できませんでした：${body.error}`); }
      await reload();
      toast(`${body.card.host} を取り消しました。答え ${body.revoked.length} 件を町のページから下げました（次の公開で反映）`);
    });
  }
}

// はじめて使うサイト：町ごとに1回だけ聞く（答えごとには聞かない）。決めると、そのサイトの答え全部に効く
const FIRST_USE = /^はじめて使う情報源（(.+?)）/;
const firstUseHost = (r) => r.match(FIRST_USE)?.[1];
function pendingSites() {
  const m = new Map();
  for (const it of all.filter((x) => x.status === "pending" && (!town || x.scope === town))) {
    for (const r of (it.why ?? "").split("／")) {
      const host = firstUseHost(r);
      if (!host) continue;
      const k = `${it.scope} ${host}`;
      if (!m.has(k)) m.set(k, { scope: it.scope, scopeName: it.scopeName ?? it.scope, host, items: [] });
      m.get(k).items.push(it);
    }
  }
  return [...m.values()];
}
function renderSites() {
  const sites = local && tab === "pending" ? pendingSites() : [];
  $("sites").hidden = !sites.length;
  if (!sites.length) return;
  $("sites").innerHTML = `
    <h2>はじめて使うサイト（${sites.length}）</h2>
    <p class="note">サイトごとに1回だけ決めます。「使ってよい」にすると、そのサイトから出した答え全部から、この判断が外れます（ほかに気になる所が無い答えは、そのまま自動で承認）。</p>
    <ul class="site-list">${sites.map((x, i) => `
      <li data-i="${i}">
        <p class="site-name"><strong>${esc(x.host)}</strong>・${esc(x.scopeName)}・この町の答え ${x.items.length} 件で使っています</p>
        <p class="site-todo">サイトの「このサイトについて」「著作権」「リンク・転載」の書き方を見てください。決まりが書いていないか、事実を使ってリンクするのがよい書き方なら「使ってよい」。転載を禁じていても、日付や数字などの事実とリンクだけなら出せます。</p>
        <a class="open-src" href="https://${esc(x.host)}/" target="_blank" rel="noopener">サイトを開く ↗</a>
        <div class="decide">
          <button type="button" class="primary" data-site="ok">使ってよい<small>このサイトの答え ${x.items.length} 件に効く</small></button>
          <button type="button" data-site="reject">使わない<small>理由を書いて、答えを出さない</small></button>
          <form class="why-form" hidden><label class="field">理由を1行<input name="reason" maxlength="100" required></label><button type="submit">決める</button></form>
        </div>
      </li>`).join("")}</ul>`;
  for (const li of $("sites").querySelectorAll("li[data-i]")) {
    const x = sites[Number(li.dataset.i)];
    const form = li.querySelector(".why-form");
    li.querySelector('[data-site="ok"]').addEventListener("click", (e) => decideSite(x, "ok", "", e.currentTarget));
    li.querySelector('[data-site="reject"]').addEventListener("click", () => { form.hidden = false; form.reason.focus(); });
    form.addEventListener("submit", (e) => { e.preventDefault(); decideSite(x, "reject", form.reason.value, form.querySelector("button[type=submit]")); });
  }
}
async function decideSite(x, action, reason, btn) {
  const done = busy(btn, action === "ok" ? "答えをまとめて決めています…" : "決めています…");
  const res = await fetch("api/sites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: x.scope, host: x.host, action, reason }) });
  const body = await res.json();
  if (!res.ok) { done(); return toast(`できませんでした：${body.error}`); }
  const auto = body.items.filter((i) => i.status === "auto").length;
  await reload();
  toast(action === "ok" ? `${x.host} を使ってよいにしました。${auto} 件が自動で承認、${body.items.length - auto} 件はほかの所を見てください` : `${x.host} を使わないにしました（${body.items.length} 件を出さない）`);
}

// 答えでない確かめ（種類ごと）：札・決めること・こうならこのボタン・答えのカードの見出し
const KINDS = {
  dekiru: { tag: "数から、できることへ", label: "Claude のつなぎ方", title: "町の数と、町の案内のつなぎ方が合っているか",
    ok: "その数の人に、その案内が合っている（町のページのいちばん上に出る）", fix: "合わないつなぎがある → 何番かと理由を書く" },
  "local-site": { tag: "町の外部のサイト", label: "Claude が見つけたサイト", title: "このサイトを、公式ではない町の情報サイトとして使ってよいか",
    ok: "運営者と利用の条件に問題が無い（町を知るページにリンクが出る）", other: ["出さない", "運営がはっきりしない・使ってよいか分からない"] },
  "plan-excerpt": { tag: "防災計画の抜き出し", label: "Claude の抜き出し", title: "防災計画の、町・字ごとの抜き出しが、元のページと合っているか",
    ok: "いくつかの町・字で、引用のページと合っていた", fix: "合わない所がある → 町・字の名前と理由を書く" },
  "gomi-days": { tag: "ごみを出す日", label: "Claude が読み取った表", title: "地区ごとのごみの曜日が、町の収集日の表と合っているか",
    ok: "いくつかの地区で、町の表と合っていた", fix: "違う曜日がある → 地区とごみの種類を書く" },
};

// 1行に出す短い札（はじめてのサイトは上でまとめて聞くので、札にしない）
function tags(it) {
  if (it.status !== "pending") return [LABEL[it.status] ?? it.status];
  if (KINDS[it.kind]) return [KINDS[it.kind].tag];
  const rs = (it.why ?? "").split("／").filter((r) => r && !/^Claude のメモ/.test(r) && !firstUseHost(r));
  if (!rs.length) return ["サイトを決めれば出せる"];
  return rs.map((r) =>
    /^はじめて使う情報源/.test(r) ? "はじめてのサイト" : /^確かめ役/.test(r) ? "確かめ役が気にした所" : /元の文/.test(r) ? "元の文が見つからない"
      : /町の人に聞く/.test(r) ? "見つからなかった" : /^数が合わない/.test(r) ? "数が合わない" : /公式のサイトでない/.test(r) ? "公式でない" : /^古いデータ/.test(r) ? "古いデータ" : /^訳し戻す/.test(r) ? "訳のずれ" : /^見張り/.test(r) ? "見張り：出典が切れた" : "そのほか");
}
document.querySelectorAll(".r-tabs button").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; openId = null; kind = ""; limit = 30; render(); }));
$("town-filter").addEventListener("change", (e) => { town = e.target.value; openId = null; render(); });

// 人が見る理由（しくみの言葉）を、「何を見て、どう決めればよいか」に言いかえる。
// 1つの長い文にせず、分けて返す：title（決めること）・said（Claude が気づいたこと、1〜2行）・links（開いて見る資料）・ok／fix／other（こうならこのボタン）
function guide(reason, it) {
  const r = reason;
  const src = it.source?.url ? [{ label: "出典を開く", url: it.source.url }] : [];
  const k = KINDS[it.kind];
  if (k) return { title: k.title, said: r, links: src, ok: k.ok, fix: k.fix, other: k.other };
  if (/^確かめ役/.test(r)) {
    const detail = r.replace(/^確かめ役：資料と合わない所がある（/, "").replace(/）$/, "");
    return { title: "答えに、資料に書かれていないことが入っていないか", said: `別の Claude（確かめ役）が気にした所：${detail}`, links: src,
      ok: "資料に書いてある（言いかえの範囲）", fix: "まちがい・言いすぎがある → どこを直すかを書く" };
  }
  if (/元の文が.*見つからなかった/.test(r)) {
    return { title: "答えが、出典のページに本当に書かれているか", said: "Claude が引いた元の文が、出典のページの中で見つかりませんでした", links: src,
      ok: "そのページ（か、そこから行けるページ）に書いてある", fix: "違うページのことだった → そう書く" };
  }
  if (/見つからなかった（町の人に聞く/.test(r)) {
    return { title: "町の人に聞くことにするか", said: "公開の資料では、答えが見つかりませんでした", links: [],
      other: ["分からない", "町のサイトに本当に無い（町の人に聞きたいことの一覧に入る）"], fix: "どこかにありそう → 探してほしい場所を書く" };
  }
  if (/^数が合わない/.test(r)) {
    return { title: "数はどちらが正しいか", said: r, links: src, ok: "Claude の数で合っている", fix: "違う → 正しい数を書く" };
  }
  if (/^出典が公式のサイトでない/.test(r)) {
    return { title: "公式でないサイトを出典にしてよいか", said: `${r}。まちしるべは公式の出典だけを使う決まりです`, links: src,
      other: ["出さない", "ふつうはこちら"], fix: "公式の出典がある → その場所を書く" };
  }
  if (/^見張り：/.test(r)) {
    return { title: "出典のページが切れた：調べ直すか", said: r.replace(/^見張り：/, "").replace(/。「直して」で.*$/, ""), links: src,
      ok: "ページが見られた（一時的だった）→ 知らせを閉じる", fix: "見られない → 「新しいページを探して」と書くと、Claude が調べ直す" };
  }
  if (/^訳し戻すとずれがある/.test(r)) {
    return { title: "訳の意味が、もとの日本語と同じか", said: `訳を日本語に訳し戻したら、ずれがありました：${r.match(/（(.+?)）/)?.[1] ?? ""}`,
      compare: [["もとの日本語", it.original], ["訳し戻し", it.back]], links: [],
      ok: "ずれが小さく、意味は同じ（ページに訳が出る）", other: ["出さない", "意味が変わっている（もとの日本語が出たまま）"] };
  }
  if (/^古いデータの見込み/.test(r)) {
    const o = it.outdated;
    return { title: "古いデータを見抜いた：どちらを町のページに出すか", said: `公式の資料どうしで、古いものと新しいものがあります${o?.what ? `（${o.what}）` : ""}`,
      links: o ? [{ label: `古い資料（${o.old?.asOf ?? "?"}）`, url: o.old?.url }, { label: `新しい資料（${o.new?.asOf ?? "?"}）`, url: o.new?.url }].filter((x) => x.url) : src,
      ok: "答えが新しいほうを元にしていて、古いほうがあることも書けている", fix: "古いほうだけを元にしている → 「新しいほうで」と書く" };
  }
  return { title: "ほかに気になる所", said: r, links: src };
}
function todoHTML(g) {
  const btn = (x) => `<a class="open-src" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a>`;
  return `<li>
    <h3 class="todo-q">${esc(g.title)}</h3>
    ${g.said ? `<p class="todo-said">${esc(g.said)}</p>` : ""}
    ${g.compare ? `<dl class="todo-compare">${g.compare.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v ?? "")}</dd></div>`).join("")}</dl>` : ""}
    ${g.links?.length ? `<p class="todo-links">${g.links.map(btn).join("")}</p>` : ""}
    <ul class="todo-how">
      ${g.ok ? `<li><span class="b ok">OK</span>${esc(g.ok)}</li>` : ""}
      ${g.fix ? `<li><span class="b">直して</span>${esc(g.fix)}</li>` : ""}
      ${g.other ? `<li><span class="b">${esc(g.other[0])}</span>${esc(g.other[1])}</li>` : ""}
    </ul>
  </li>`;
}

function itemHTML(it) {
  const src = it.source ? `<p class="src">出典：${esc(it.source.title ?? it.source.url)}${it.source.where ? `（${esc(it.source.where)}）` : ""}${it.asOf ? `・時点 ${esc(it.asOf)}` : ""}</p>` : "";
  const firstUse = (it.why ?? "").split("／").map(firstUseHost).find(Boolean);
  const reasons = (it.why ?? "").split("／").filter((r) => r && !/^Claude のメモ/.test(r) && !firstUseHost(r));
  const siteNote = it.status === "pending" && firstUse ? `<p class="note">${esc(firstUse)} を使ってよいかは、上の「はじめて使うサイト」で決めてください。${reasons.length ? "" : "ほかに気になる所はありません。サイトを使ってよいにすると、この答えは自動で承認されます。"}</p>` : "";
  const todo = it.status === "pending" && reasons.length ? `
    <div class="todo-box">
      <p class="todo-head">判断してほしいこと</p>
      <ol class="todo-list">${reasons.map((r) => todoHTML(guide(r, it))).join("")}</ol>
    </div>` : "";
  // 出典を開くボタン：判断の説明に出典のボタンが無いときだけ
  const srcLink = it.source?.url && !todo.includes(esc(it.source.url)) ? `<a class="open-src" href="${esc(it.source.url)}" target="_blank" rel="noopener">出典を開く</a>` : "";
  const details = [
    it.quote ? `<p class="note">Claude が引いた元の文（手元だけ。公開しません）</p><blockquote class="quote">${esc(it.quote)}</blockquote>` : "",
    it.note ? `<p class="note">Claude のメモ</p><p>${esc(it.note)}</p>` : "",
    it.check ? `<p class="note">確かめ役（${esc(it.check.model)}）：${it.check.supported ? "資料と合っている" : "合わない所がある"}</p>` : "",
  ].join("");
  const last = it.decided ?? (it.decisions?.length ? it.decisions.at(-1) : null);
  const decided = last && it.status !== "pending" ? `<p class="note">${esc(LABEL[it.status] ?? it.status)}：${esc(last.at?.slice(0, 16).replace("T", " "))}${last.by ? `・${last.by === "auto" ? "自動" : esc(last.by)}` : ""}${last.reason && last.action !== "reassess" ? `・理由「${esc(last.reason)}」` : ""}</p>` : "";
  const buttons = local && it.status === "pending" ? `
    <div class="decide" data-id="${it.id}">
      <button type="button" class="primary" data-action="ok">OK<small>このまま町のページに出す</small></button>
      <button type="button" data-action="fix">直して<small>直す所を書いて調べ直す</small></button>
      <button type="button" data-action="reject">出さない<small>理由を書いて出さない</small></button>
      <button type="button" data-action="unknown">分からない<small>町の人に聞くことにする</small></button>
      <form class="why-form" hidden><label class="field">理由を1行（何が違うか・どこを探すか）<input name="reason" maxlength="100" required></label><button type="submit">決める</button></form>
    </div>` : local && it.status !== "auto" ? `<div class="decide" data-id="${it.id}"><button type="button" data-action="undo">元に戻す（確かめ待ちへ）</button></div>` : "";
  // 並び：判断してほしいこと → Claude の答え（カード）→ くわしく → ボタン
  return `
    <article class="item">
      ${siteNote}${todo}
      ${it.value != null ? `<div class="answer-card"><p class="answer-label">${it.kind === "translation" ? "Claude の訳" : KINDS[it.kind]?.label ?? "Claude の答え"}</p><p class="value">${prettyText(it.value, esc)}</p>${src}${srcLink}</div>` : ""}
      ${details ? `<details class="more"><summary>くわしく（元の文・Claude のメモ）</summary>${details}</details>` : ""}
      ${decided}${buttons}
    </article>`;
}

function wire() {
  for (const box of document.querySelectorAll(".decide")) {
    const id = box.dataset.id;
    const form = box.querySelector(".why-form");
    let pendingAction = null;
    for (const b of box.querySelectorAll("button[data-action]")) {
      b.addEventListener("click", () => {
        const a = b.dataset.action;
        if (a === "ok" || a === "undo") return decide(id, a, "", b);
        pendingAction = a; // 直して・出さない・分からないは理由を1行
        form.hidden = false;
        form.reason.focus();
      });
    }
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      decide(id, pendingAction, form.reason.value, form.querySelector("button[type=submit]"));
    });
  }
}

// 処理中を見せる：押したボタンに回る印と「…しています」、同じまとまりのボタンは押せなくする（二度押しを防ぐ）
function busy(btn, text = "決めています…") {
  const box = btn?.closest(".decide");
  if (!box) return () => {};
  const buttons = [...box.querySelectorAll("button")];
  const was = btn.innerHTML;
  buttons.forEach((b) => (b.disabled = true));
  box.classList.add("busy");
  btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${text}`;
  btn.setAttribute("aria-busy", "true");
  return () => { buttons.forEach((b) => (b.disabled = false)); box.classList.remove("busy"); btn.innerHTML = was; btn.removeAttribute("aria-busy"); };
}

async function decide(id, action, reason, btn) {
  const done = busy(btn);
  const res = await fetch(`api/review/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
  const body = await res.json();
  if (!res.ok) { done(); return toast(`できませんでした：${body.error}`); }
  // 決めたら、同じ一覧の次の確かめ待ちを開く
  if (action !== "undo") {
    const list = all.filter((x) => inTab(x) && (!town || x.scope === town) && (!kind || tags(x).includes(kind)));
    const i = list.findIndex((x) => x.id === id);
    openId = list[i + 1]?.id ?? list[i - 1]?.id ?? null;
    scrollToOpen = true;
  }
  await reload();
  // 押したあと数秒は元に戻せる
  toast(ACTION[action], action === "undo" ? null : () => decide(id, "undo", ""));
}

let timer = null;
function toast(text, undo) {
  const t = $("toast");
  t.innerHTML = `<span>${esc(text)}</span>${undo ? `<button type="button">元に戻す</button>` : ""}`;
  t.hidden = false;
  t.querySelector("button")?.addEventListener("click", () => { t.hidden = true; undo(); });
  clearTimeout(timer);
  timer = setTimeout(() => (t.hidden = true), 6000);
}
