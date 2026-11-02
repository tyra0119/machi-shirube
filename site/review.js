// 確かめる一覧。手元の画面では決められる（OK・直して・出さない・分からない、元に戻す）。
// 公開のサイトでは、件数と、人が見たものの理由・出典の URL だけを見せる（引用した元の文は出さない）
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const LABEL = { pending: "確かめ待ち", auto: "自動で承認", ok: "OK（出した）", fix: "直して（調べ直し待ち）", rejected: "出さない", unknown: "分からない（町の人に聞く）", void: "無効（しくみの不具合）" };
const ACTION = { ok: "OK にしました", fix: "直してに回しました。Claude が調べ直しています（1分ほどで確かめる一覧に新しい答えが入ります）", reject: "出さないにしました", unknown: "分からないにしました", undo: "元に戻しました" };

let local = false;
let data = { items: [] };
let all = []; // いまの全部の件
let tab = "pending"; // 確かめ待ち・決めたもの・自動で承認
let town = ""; // 町で絞る（scope）
let openId = null; // いま開いている1件

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
  const list = all.filter((x) => inTab(x) && (!town || x.scope === town));
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
    </details>`).join("");
  for (const d of document.querySelectorAll(".r-row")) {
    d.addEventListener("toggle", () => {
      if (!d.open) return;
      openId = d.dataset.id;
      document.querySelectorAll(".r-row").forEach((o) => o !== d && (o.open = false));
    });
  }
  if (local) wire();
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
    li.querySelector('[data-site="ok"]').addEventListener("click", () => decideSite(x, "ok", ""));
    li.querySelector('[data-site="reject"]').addEventListener("click", () => { form.hidden = false; form.reason.focus(); });
    form.addEventListener("submit", (e) => { e.preventDefault(); decideSite(x, "reject", form.reason.value); });
  }
}
async function decideSite(x, action, reason) {
  const res = await fetch("api/sites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: x.scope, host: x.host, action, reason }) });
  const body = await res.json();
  if (!res.ok) return toast(`できませんでした：${body.error}`);
  const auto = body.items.filter((i) => i.status === "auto").length;
  await reload();
  toast(action === "ok" ? `${x.host} を使ってよいにしました。${auto} 件が自動で承認、${body.items.length - auto} 件はほかの所を見てください` : `${x.host} を使わないにしました（${body.items.length} 件を出さない）`);
}

// 1行に出す短い札（はじめてのサイトは上でまとめて聞くので、札にしない）
function tags(it) {
  if (it.status !== "pending") return [LABEL[it.status] ?? it.status];
  const rs = (it.why ?? "").split("／").filter((r) => r && !/^Claude のメモ/.test(r) && !firstUseHost(r));
  if (!rs.length) return ["サイトを決めれば出せる"];
  return rs.map((r) =>
    /^はじめて使う情報源/.test(r) ? "はじめてのサイト" : /^確かめ役/.test(r) ? "確かめ役が気にした所" : /元の文/.test(r) ? "元の文が見つからない"
      : /町の人に聞く/.test(r) ? "見つからなかった" : /^数が合わない/.test(r) ? "数が合わない" : /公式のサイトでない/.test(r) ? "公式でない" : /^古いデータ/.test(r) ? "古いデータ" : /^訳し戻す/.test(r) ? "訳のずれ" : "そのほか");
}
document.querySelectorAll(".r-tabs button").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; openId = null; render(); }));
$("town-filter").addEventListener("change", (e) => { town = e.target.value; openId = null; render(); });

// 人が見る理由（しくみの言葉）を、「何を見て、どう決めればよいか」に言いかえる
function guide(reason, it) {
  const r = reason;
  if (/^はじめて使う情報源/.test(r)) {
    const host = r.match(/（(.+?)）/)?.[1] ?? "このサイト";
    return { title: "このサイトの情報を、まちしるべに出してよいか",
      todo: `${host} をはじめて使います。サイトの「このサイトについて」「著作権」「リンク・転載」の書き方を見てください。
        決まりが書いていないか、「事実を使う・リンクする」のがよい書き方なら OK。転載を禁じていても、日付や数字などの事実とリンクだけなら出せます。
        OK すると、このサイトは次から自動で使えるようになります。` };
  }
  if (/^確かめ役/.test(r)) {
    const detail = r.replace(/^確かめ役：資料と合わない所がある（/, "").replace(/）$/, "");
    return { title: "答えに、資料に書かれていないことが入っていないか",
      todo: `別の Claude（確かめ役）が気にした所：「${detail}」。出典を開いて、答えの文が正しいか見てください。
        正しい（言いかえの範囲）なら OK。まちがい・言いすぎがあれば「直して」に、どこを直すかを書いてください。` };
  }
  if (/元の文が.*見つからなかった/.test(r)) {
    return { title: "答えが、出典のページに本当に書かれているか",
      todo: `Claude が引いた元の文が、出典のページの中で見つかりませんでした。出典を開いて、答えがそのページ（か、そこから行けるページ）に書かれているか見てください。
        書かれていれば OK。違うページのことなら「直して」に、そう書いてください。` };
  }
  if (/見つからなかった（町の人に聞く/.test(r)) {
    return { title: "町の人に聞くことにするか",
      todo: `公開の資料では答えが見つかりませんでした。町のサイトに本当に無いと思えば「分からない」を押してください（町の人に聞きたいことの一覧に入ります）。
        どこかにありそうなら「直して」に、探してほしい場所を書いてください。` };
  }
  if (/^数が合わない/.test(r)) {
    return { title: "数はどちらが正しいか", todo: `${r}。出典の一覧を開いて数を見て、正しい数を「直して」に書くか、Claude の数で合っていれば OK。` };
  }
  if (/^出典が公式のサイトでない/.test(r)) {
    return { title: "公式でないサイトを出典にしてよいか", todo: `${r}。まちしるべは公式の出典だけを使う決まりです。ふつうは「出さない」か、公式の出典で「直して」。` };
  }
  if (/^訳し戻すとずれがある/.test(r)) {
    return { title: "訳の意味が、もとの日本語と同じか",
      todo: `別の Claude が訳を日本語に訳し戻したら、ずれが見つかりました：${(r.match(/（(.+?)）/)?.[1] ?? "")}。
        もとの日本語：${it.original ?? ""}
        訳し戻し：${it.back ?? ""}
        ずれが小さく、意味が同じなら OK（ページに訳が出ます）。意味が変わっていれば「出さない」（もとの日本語が出たままになります）。` };
  }
  if (/^古いデータの見込み/.test(r)) {
    const o = it.outdated;
    return { title: "古いデータを見抜いた：どちらを町のページに出すか",
      todo: `Claude が、公式の資料どうしで古いものと新しいものがあることに気づきました。${o ? `古い：${o.old?.asOf ?? "?"}（${o.old?.url ?? ""}）。新しい：${o.new?.asOf ?? "?"}（${o.new?.url ?? ""}）。` : r}
        両方を開いて時点を見てください。答えが新しいほうを元にしていて、古いほうがあることも書けていれば OK。古いほうだけを元にしていれば「直して」に「新しいほうで」と書いてください。` };
  }
  return { title: "ほかに気になる所", todo: r };
}

function itemHTML(it) {
  const srcLink = it.source?.url ? `<a class="open-src" href="${esc(it.source.url)}" target="_blank" rel="noopener">出典を開く ↗</a>` : "";
  const src = it.source ? `<p class="src">出典：${esc(it.source.title ?? it.source.url)}${it.source.where ? `（${esc(it.source.where)}）` : ""}${it.asOf ? `・時点 ${esc(it.asOf)}` : ""}</p>` : "";
  const firstUse = (it.why ?? "").split("／").map(firstUseHost).find(Boolean);
  const reasons = (it.why ?? "").split("／").filter((r) => r && !/^Claude のメモ/.test(r) && !firstUseHost(r));
  const siteNote = it.status === "pending" && firstUse ? `<p class="note">${esc(firstUse)} を使ってよいかは、上の「はじめて使うサイト」で決めてください。${reasons.length ? "" : "ほかに気になる所はありません。サイトを使ってよいにすると、この答えは自動で承認されます。"}</p>` : "";
  const todo = it.status === "pending" && reasons.length ? `
    <div class="todo-box">
      <p class="todo-head">判断してほしいこと</p>
      <ol>${reasons.map((r) => { const g = guide(r, it); return `<li><strong>${esc(g.title)}</strong><span>${esc(g.todo).replace(/\s*\n\s*/g, "<br>")}</span></li>`; }).join("")}</ol>
    </div>` : "";
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
  return `
    <article class="item">
      ${it.value != null ? `<p class="value">${prettyText(it.value, esc)}</p>` : ""}
      ${src}${srcLink}
      ${siteNote}${todo}
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
        if (a === "ok" || a === "undo") return decide(id, a, "");
        pendingAction = a; // 直して・出さない・分からないは理由を1行
        form.hidden = false;
        form.reason.focus();
      });
    }
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      decide(id, pendingAction, form.reason.value);
    });
  }
}

async function decide(id, action, reason) {
  const res = await fetch(`api/review/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
  const body = await res.json();
  if (!res.ok) return toast(`できませんでした：${body.error}`);
  // 決めたら、同じ一覧の次の確かめ待ちを開く
  if (action !== "undo") {
    const list = all.filter((x) => inTab(x) && (!town || x.scope === town));
    const i = list.findIndex((x) => x.id === id);
    openId = list[i + 1]?.id ?? list[i - 1]?.id ?? null;
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
