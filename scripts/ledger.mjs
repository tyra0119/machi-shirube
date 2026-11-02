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
// 情報源カードは市区町村ごと（町・字の答えも、その市区町村のカードを使う）
export const muniScope = (scope) => `muni:${scope.match(/(\d{5})/)?.[1]}`;
function ensureCard(it, user) {
  const host = it.source?.url ? new URL(it.source.url).hostname : null;
  if (!host || cardFor(muniScope(it.scope), host)) return null;
  return addCard({ scope: muniScope(it.scope), scopeName: it.scopeName, host, origin: new URL(it.source.url).origin, user, fromItem: it.id });
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
  const items = data.items.filter((x) => x.status === "pending" && muniScope(x.scope) === muniScope(scope) && (x.why ?? "").split("／").some((r) => r.match(FIRST_USE)?.[1] === host));
  if (!items.length) throw Object.assign(new Error("そのサイトの確かめ待ちはありません"), { status: 404 });
  const sample = items.find((x) => x.source?.url && new URL(x.source.url).hostname === host) ?? items[0];
  const card = cardFor(muniScope(scope), host) ?? addCard({ scope: muniScope(scope), scopeName: sample.scopeName, host, origin: `https://${host}`, user, fromItem: sample.id, status: action === "ok" ? "ok" : "rejected", reason: reason.trim() });
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
const PUBLIC_FIELDS = ["id", "qid", "scope", "question", "value", "asOf", "source", "method", "status", "outdated", "detail", "items"];
const pick = (it) => ({ ...Object.fromEntries(PUBLIC_FIELDS.filter((k) => it[k] !== undefined).map((k) => [k, it[k]])), checkedAt: it.createdAt, score: scoreOf(it) });

// 物差しの点数（1つの答えごと、0〜3。人の判断待ちは点を付けず null＝保留）。Claude を呼ばず、台帳の確かめの結果から決める
//   0：見つからなかった・出典が公式でない・出さないと決めた
//   1：答えはあるが、元の文を出典の中で確かめられなかった（照らせない）か、確かめ役が合わないと言った
//   2：公式の出典があり、元の文か数え直しで確かめられた（確かめた日つき）
//   3：2 に加えて、町丁目・地区ごと、年ごとの移り変わり、重ね合わせ のどれかがある（町・字の範囲の答えは地区ごとに当たる）
export function scoreOf(it) {
  if (it.status === "pending" || it.status === "fix") return null;
  if (it.status === "rejected" || it.status === "void" || it.value === "見つからなかった" || !it.source?.url) return 0;
  if (/公式のサイトでない/.test(it.why ?? "")) return 0;
  const checked = (it.verified || it.counted != null || it.method?.startsWith("数えた")) && it.check?.supported !== false;
  if (!checked && it.status !== "ok") return 1;
  const deep = it.scope?.startsWith("town:") || (it.detail?.length ?? 0) > 0 || /丁目|地区ごと|地区別|年ごと|推移/.test(it.value ?? "");
  return deep ? 3 : 2;
}
// 日本地図の「灯り」と数える欄（site/data/progress.json）：町ごとの公開した答えの数と、全体の数
// 読んだページは調査の記録（local/runs/）の「読んでいます：URL」を重ねずに数え、費用は local/costs.jsonl の合計（見積もり）
export function exportProgress(data = load()) {
  const towns = {};
  for (const it of data.items) {
    const code = it.scope.match(/(\d{5})/)?.[1];
    if (!code || it.kind !== "answer") continue;
    const t = (towns[code] ??= { answers: 0, pending: 0, scopeName: it.scopeName });
    if (it.status === "ok" || it.status === "auto") t.answers++;
    if (it.status === "pending") t.pending++;
  }
  const pages = new Set();
  if (fs.existsSync("local/runs")) {
    for (const f of fs.readdirSync("local/runs").filter((x) => /^run-.*\d\.json$/.test(x))) {
      try {
        for (const s of JSON.parse(fs.readFileSync(`local/runs/${f}`, "utf8")).steps ?? []) {
          const u = s.text.match(/^読んでいます：(https?:\/\/\S+)/)?.[1];
          if (u) pages.add(u);
        }
      } catch {}
    }
  }
  const usd = fs.existsSync("local/costs.jsonl")
    ? fs.readFileSync("local/costs.jsonl", "utf8").split("\n").filter(Boolean).reduce((s, x) => s + (JSON.parse(x).usd ?? 0), 0) : 0;
  const lit = Object.values(towns).filter((t) => t.answers).length;
  const skills = fs.existsSync("site/data/skills.json") ? JSON.parse(fs.readFileSync("site/data/skills.json", "utf8")).skills.length : 0;
  fs.writeFileSync("site/data/progress.json", JSON.stringify({
    updatedAt: new Date().toISOString(),
    totals: { towns: lit, answers: Object.values(towns).reduce((s, t) => s + t.answers, 0), pages: pages.size, usd: Math.round(usd * 100) / 100, skills, questions: JSON.parse(fs.readFileSync("site/data/yardstick.json", "utf8")).questions.length },
    towns: Object.fromEntries(Object.entries(towns).filter(([, t]) => t.answers).map(([c, t]) => [c, { answers: t.answers }])),
  }, null, 1));
}

export function exportPublic(data = load()) {
  const byMuni = new Map();
  for (const it of data.items) {
    if (it.status !== "ok" && it.status !== "auto") continue;
    if (it.kind === "translation") continue; // 訳は site/data/translations/ に（下で状態だけ合わせる）
    // 市区町村の答えは {コード}.json、町・字の答えは {コード}-{番号}.json
    const code = it.scope.startsWith("town:") ? it.scope.slice(5) : it.scope.match(/(\d{5})/)?.[1];
    if (!code) continue;
    if (!byMuni.has(code)) byMuni.set(code, []);
    byMuni.get(code).push(pick(it));
  }
  // 訳：確かめ待ちに入れた訳の状態（人が OK・出さない）を、訳のファイルに写す
  const tdir = "site/data/translations";
  if (fs.existsSync(tdir)) {
    for (const f of fs.readdirSync(tdir).filter((x) => /^\d{5}\.json$/.test(x))) {
      const t = JSON.parse(fs.readFileSync(`${tdir}/${f}`, "utf8"));
      let changed = false;
      for (const l of Object.values(t.langs)) for (const x of l.items) {
        const it = x.ledgerId && data.items.find((i) => i.id === x.ledgerId);
        if (it && x.status !== it.status) { x.status = it.status; changed = true; }
      }
      if (changed) fs.writeFileSync(`${tdir}/${f}`, JSON.stringify(t, null, 1));
    }
  }
  const dir = "site/data/answers";
  fs.mkdirSync(dir, { recursive: true });
  // いまある答えのファイルは作り直す（取り消したものがページから消えるように）
  for (const f of fs.readdirSync(dir)) if (/^\d{5}(-\d{4})?\.json$/.test(f) && !byMuni.has(f.replace(".json", ""))) fs.rmSync(path.join(dir, f));
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
  exportProgress(data);
}
