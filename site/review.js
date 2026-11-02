// 確かめる一覧。手元の画面では決められる（OK・直して・出さない・分からない、元に戻す）。
// 公開のサイトでは、件数と、人が見たものの理由・出典の URL だけを見せる（引用した元の文は出さない）
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const LABEL = { pending: "確かめ待ち", auto: "自動で承認", ok: "OK（出した）", fix: "直して（調べ直し待ち）", rejected: "出さない", unknown: "分からない（町の人に聞く）" };
const ACTION = { ok: "OK にしました", fix: "直してに回しました", reject: "出さないにしました", unknown: "分からないにしました", undo: "元に戻しました" };

let local = false;
let data = { items: [] };

main();
async function main() {
  local = await fetch("api/ping").then((r) => r.ok).catch(() => false);
  $("mode").textContent = local
    ? "手元の画面：OK すると、次の公開（push）で町のページに出ます。押したあと数秒は元に戻せます"
    : "公開のサイト：見るだけです。引用した元の文は出していません";
  await reload();
}

async function reload() {
  if (local) {
    data = await (await fetch("api/review")).json();
    const c = (s) => data.items.filter((x) => x.status === s).length;
    render({ auto: c("auto"), ok: c("ok"), pending: c("pending"), fix: c("fix"), rejected: c("rejected"), unknown: c("unknown") }, data.items);
  } else {
    const pub = await fetch("data/review.json").then((r) => (r.ok ? r.json() : { counts: {}, items: [] })).catch(() => ({ counts: {}, items: [] }));
    render(pub.counts, pub.items);
  }
}

function render(counts, items) {
  $("counts").innerHTML = Object.entries(LABEL).map(([k, l]) => `<li><span>${l}</span><strong>${(counts[k] ?? 0).toLocaleString("ja-JP")}件</strong></li>`).join("");
  const pending = items.filter((x) => x.status === "pending");
  $("pending-title").textContent = `確かめ待ち（${pending.length}件）`;
  $("pending").innerHTML = pending.length ? pending.map(itemHTML).join("") : `<p class="note">確かめ待ちはありません。</p>`;
  const decided = items.filter((x) => x.status !== "pending" && x.status !== "auto");
  $("decided").innerHTML = decided.length ? decided.map(itemHTML).join("") : `<p class="note">まだありません。</p>`;
  if (local) wire();
}

function itemHTML(it) {
  const src = it.source ? `<p class="src">出典：${it.source.url ? `<a href="${esc(it.source.url)}" target="_blank" rel="noopener">${esc(it.source.title ?? it.source.url)}</a>` : esc(it.source.title)}${it.source.where ? `（${esc(it.source.where)}）` : ""}${it.asOf ? `・時点 ${esc(it.asOf)}` : ""}</p>` : "";
  const quote = it.quote ? `<blockquote class="quote">${esc(it.quote)}</blockquote><p class="note">引用した元の文（手元だけ。公開しません）</p>` : "";
  const last = it.decided ?? (it.decisions?.length ? it.decisions.at(-1) : null);
  const decided = last ? `<p class="note">${esc(LABEL[it.status] ?? it.status)}：${esc(last.at?.slice(0, 16).replace("T", " "))}${last.by ? `・${esc(last.by)}` : ""}${last.reason ? `・理由「${esc(last.reason)}」` : ""}</p>` : "";
  const buttons = local && it.status === "pending" ? `
    <div class="decide" data-id="${it.id}">
      <button type="button" class="primary" data-action="ok">OK（出す）</button>
      <button type="button" data-action="fix">直して</button>
      <button type="button" data-action="reject">出さない</button>
      <button type="button" data-action="unknown">分からない</button>
      <form class="why-form" hidden><label class="field">理由を1行<input name="reason" maxlength="100" required></label><button type="submit">決める</button></form>
    </div>` : local && it.status !== "auto" ? `<div class="decide" data-id="${it.id}"><button type="button" data-action="undo">元に戻す（確かめ待ちへ）</button></div>` : "";
  return `
    <article class="item">
      <p class="scope">${esc(it.scopeName ?? it.scope)}</p>
      <h3>${esc(it.question)}</h3>
      ${it.value != null ? `<p class="value">${esc(it.value)}</p>` : ""}
      ${src}${quote}
      ${it.why ? `<p class="why">人が見る理由：${esc(it.why)}</p>` : ""}
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
