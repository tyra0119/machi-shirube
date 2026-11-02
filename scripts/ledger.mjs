// 承認の台帳（docs/approval-ledger.md）。手元の PC だけで動く。
// - local/ledger/items.json：確かめる一覧の1件ずつ（引用した元の文など、公開しないものも入る）
// - local/ledger/log.jsonl：決めた記録（いつ・誰が・何を・なぜ）。消さずに足していく
// - site/data/answers/{市区町村コード}.json：公開してよい答えだけ（町のページが読む）
// - site/data/review.json：公開の確かめる一覧（件数・理由・出典の URL だけ。元の文は入れない）
import fs from "node:fs";
import path from "node:path";

const DIR = "local/ledger";
const ITEMS = `${DIR}/items.json`;
const LOG = `${DIR}/log.jsonl`;

// 権限の判定（docs/decisions.md「3つの段ごとに管理者」）。いまは作者（owner）ならすべての範囲でよい。
// 将来は、割り当ての表（利用者・段・コード・できること）を見るように変える
export const ACTIONS = ["view", "investigate", "fix", "approve", "request"];
export function can(user, action, scope) {
  if (!ACTIONS.includes(action)) return false;
  return user === "owner" && typeof scope === "string";
}

// 情報源カード：町（市区町村）ごとに、サイト（ホスト）を1回 OK すれば、次からそのサイトの答えは自動の候補になる
const CARDS = `${DIR}/cards.json`;
export function loadCards() {
  return fs.existsSync(CARDS) ? JSON.parse(fs.readFileSync(CARDS, "utf8")) : { cards: [] };
}
export function cardFor(scope, host) {
  return loadCards().cards.find((c) => c.scope === scope && c.host === host && c.status === "ok");
}
function ensureCard(it, user) {
  const host = it.source?.url ? new URL(it.source.url).hostname : null;
  if (!host || cardFor(it.scope, host)) return null;
  return addCard({ scope: it.scope, scopeName: it.scopeName, host, origin: new URL(it.source.url).origin, user, fromItem: it.id });
}
function addCard({ scope, scopeName, host, origin, user, fromItem, status = "ok", reason }) {
  const data = loadCards();
  const card = {
    id: `c${String(data.cards.length + 1).padStart(4, "0")}`,
    scope,
    scopeName,
    host,
    title: `${scopeName ?? ""}の公式サイト`,
    url: origin + "/",
    license: status === "ok" ? "作者が使ってよいと確かめた（事実と出典のリンクを出す。文はそのまま写さない）" : `使わない（${reason}）`,
    status,
    approvedBy: user,
    approvedAt: new Date().toISOString(),
    fromItem,
  };
  data.cards.push(card);
  fs.writeFileSync(CARDS, JSON.stringify(data, null, 1));
  return card;
}

// サイトごとに決める：はじめて使うサイトを、町（範囲）ごとに1回だけ「使ってよい」「使わない」と決める。
// 使ってよい → そのサイトの確かめ待ちの答えから「はじめて使う情報源」の理由を外し、ほかに理由が無ければ自動で承認にする
// 使わない → そのサイトの確かめ待ちの答えを、理由をつけて「出さない」にする（あとで1件ずつ元に戻せる）
const FIRST_USE = /^はじめて使う情報源（(.+?)）/;
export function decideSite(scope, host, action, { user = "owner", reason = "" } = {}) {
  if (!can(user, "approve", scope)) throw Object.assign(new Error("この範囲を扱う権限がありません"), { status: 403 });
  if (action !== "ok" && action !== "reject") throw Object.assign(new Error("分からない操作です"), { status: 400 });
  if (action === "reject" && !reason.trim()) throw Object.assign(new Error("理由を1行書いてください"), { status: 400 });
  const data = load();
  const items = data.items.filter((x) => x.status === "pending" && x.scope === scope && (x.why ?? "").split("／").some((r) => r.match(FIRST_USE)?.[1] === host));
  if (!items.length) throw Object.assign(new Error("そのサイトの確かめ待ちはありません"), { status: 404 });
  const sample = items.find((x) => x.source?.url && new URL(x.source.url).hostname === host) ?? items[0];
  const card = cardFor(scope, host) ?? addCard({ scope, scopeName: sample.scopeName, host, origin: `https://${host}`, user, fromItem: sample.id, status: action === "ok" ? "ok" : "rejected", reason: reason.trim() });
  const at = new Date().toISOString();
  for (const it of items) {
    const from = it.status;
    if (action === "ok") {
      const rest = it.why.split("／").filter((r) => r.match(FIRST_USE)?.[1] !== host);
      it.why = rest.length ? rest.join("／") : undefined;
      // 残っているのが Claude のメモだけなら、人が見る理由は無い
      it.status = rest.some((r) => !/^Claude のメモ/.test(r)) ? "pending" : "auto";
      it.cardId = card.id;
    } else {
      it.status = "rejected";
    }
    const rec = { at, by: user, action: `site-${action}`, reason: action === "ok" ? `${host} を使ってよいと決めた（情報源カード ${card.id}）` : reason.trim(), from };
    it.decisions.push(rec);
    fs.appendFileSync(LOG, JSON.stringify({ id: it.id, scope: it.scope, ...rec }) + "\n");
  }
  save(data);
  exportPublic(data);
  return { card, items: items.map((x) => ({ id: x.id, status: x.status })) };
}

export function load() {
  return fs.existsSync(ITEMS) ? JSON.parse(fs.readFileSync(ITEMS, "utf8")) : { items: [] };
}
function save(data) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(ITEMS, JSON.stringify(data, null, 1));
}

// 確かめる一覧に足す（調べる機能から呼ぶ）。自動で承認できるものは status: "auto" で入れる
export function add(item) {
  const data = load();
  const id = `r${String(data.items.length + 1).padStart(5, "0")}`;
  const rec = { id, status: "pending", createdAt: new Date().toISOString(), decisions: [], ...item };
  data.items.push(rec);
  save(data);
  if (rec.status === "auto") exportPublic(data);
  return rec;
}

// 判断し直す（しくみを直したあと、確かめ待ちの答えを調べ直さずにもう一度判断する）。人が決めたものは変えない
export function reassess(id, fields) {
  const data = load();
  const it = data.items.find((x) => x.id === id);
  if (!it || it.status !== "pending") return it;
  const prev = it.status;
  Object.assign(it, fields);
  it.status = fields.why ? "pending" : "auto";
  const rec = { at: new Date().toISOString(), by: "auto", action: "reassess", reason: fields.why ?? "自動の条件がそろった", from: prev };
  it.decisions.push(rec);
  save(data);
  fs.appendFileSync(LOG, JSON.stringify({ id, scope: it.scope, ...rec }) + "\n");
  exportPublic(data);
  return it;
}

// 無効にする：しくみの不具合でできた答え（例：町の公式サイトを読めなかった・CSV の読み違い）。消さずに、理由を残して一覧から外す。
// 人が決めたもの（OK・直して など）は変えない。確かめ待ちと、自動で承認したものだけ
export function voidItem(id, reason) {
  const data = load();
  const it = data.items.find((x) => x.id === id);
  if (!it || (it.status !== "pending" && it.status !== "auto")) return it;
  const rec = { at: new Date().toISOString(), by: "auto", action: "void", reason, from: it.status };
  it.status = "void";
  it.decisions.push(rec);
  save(data);
  fs.appendFileSync(LOG, JSON.stringify({ id, scope: it.scope, ...rec }) + "\n");
  exportPublic(data);
  return it;
}

// 決める：ok（出す）・fix（直して）・reject（出さない）・unknown（分からない）・undo（元に戻す）
const STATUS = { ok: "ok", fix: "fix", reject: "rejected", unknown: "unknown" };
export function decide(id, action, { user = "owner", reason = "" } = {}) {
  const data = load();
  const it = data.items.find((x) => x.id === id);
  if (!it) throw Object.assign(new Error("見つかりません"), { status: 404 });
  if (!can(user, "approve", it.scope)) throw Object.assign(new Error("この範囲を扱う権限がありません"), { status: 403 });
  const prev = it.status;
  if (action === "undo") {
    const last = it.decisions.at(-1);
    if (!last) throw Object.assign(new Error("戻すものがありません"), { status: 400 });
    it.status = last.from;
  } else {
    if (!STATUS[action]) throw Object.assign(new Error("分からない操作です"), { status: 400 });
    if ((action === "reject" || action === "unknown" || action === "fix") && !reason.trim()) {
      throw Object.assign(new Error("理由を1行書いてください"), { status: 400 });
    }
  }
  const rec = { at: new Date().toISOString(), by: user, action, reason: reason.trim(), from: prev };
  if (action !== "undo") it.status = STATUS[action];
  // OK したら、その出典のサイトの情報源カードも OK にする（まだ無ければ）
  if (action === "ok") {
    const card = ensureCard(it, user);
    if (card) { rec.card = card.id; it.cardId = card.id; }
  }
  it.decisions.push(rec);
  save(data);
  fs.appendFileSync(LOG, JSON.stringify({ id, scope: it.scope, ...rec }) + "\n");
  exportPublic(data);
  return it;
}

// 公開してよいものだけを書き出す
const PUBLIC_FIELDS = ["id", "qid", "scope", "question", "value", "asOf", "source", "method", "status", "outdated"];
const pick = (it) => ({ ...Object.fromEntries(PUBLIC_FIELDS.filter((k) => it[k] !== undefined).map((k) => [k, it[k]])), checkedAt: it.createdAt });
export function exportPublic(data = load()) {
  const byMuni = new Map();
  for (const it of data.items) {
    if (it.status !== "ok" && it.status !== "auto") continue;
    const code = it.scope.match(/(\d{5})/)?.[1];
    if (!code) continue;
    if (!byMuni.has(code)) byMuni.set(code, []);
    byMuni.get(code).push(pick(it));
  }
  const dir = "site/data/answers";
  fs.mkdirSync(dir, { recursive: true });
  // いまある答えのファイルは作り直す（取り消したものがページから消えるように）
  for (const f of fs.readdirSync(dir)) if (/^\d{5}\.json$/.test(f) && !byMuni.has(f.slice(0, 5))) fs.rmSync(path.join(dir, f));
  for (const [code, answers] of byMuni) fs.writeFileSync(`${dir}/${code}.json`, JSON.stringify({ answers }, null, 1));

  // 情報源カード（公開してよい項目だけ）→ 町のページの「出典」
  const sdir = "site/data/sources";
  fs.mkdirSync(sdir, { recursive: true });
  const cardsByMuni = new Map();
  for (const c of loadCards().cards) {
    const code = c.scope.match(/(\d{5})/)?.[1];
    if (!code) continue;
    if (!cardsByMuni.has(code)) cardsByMuni.set(code, []);
    cardsByMuni.get(code).push({ id: c.id, host: c.host, title: c.title, url: c.url, license: c.license, status: c.status, approvedAt: c.approvedAt });
  }
  for (const [code, cards] of cardsByMuni) fs.writeFileSync(`${sdir}/${code}.json`, JSON.stringify({ cards }, null, 1));

  const count = (s) => data.items.filter((x) => x.status === s).length;
  fs.writeFileSync("site/data/review.json", JSON.stringify({
    updatedAt: new Date().toISOString(),
    counts: { auto: count("auto"), ok: count("ok"), pending: count("pending"), fix: count("fix"), rejected: count("rejected"), unknown: count("unknown") },
    // 公開の一覧：人が見たもの・見ているものの、理由と出典の URL だけ
    items: data.items.filter((x) => x.status !== "auto").map((x) => ({
      id: x.id, scope: x.scope, question: x.question, why: x.why, status: x.status,
      source: x.source ? { title: x.source.title, url: x.source.url } : undefined,
      decided: x.decisions.at(-1) ? { at: x.decisions.at(-1).at, action: x.decisions.at(-1).action, reason: x.decisions.at(-1).reason } : undefined,
    })),
  }, null, 1));
}
