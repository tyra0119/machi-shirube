// 確かめ待ちの答えを、調べ直さずに判断し直す（しくみを直したとき用）。手元の PC だけ。
// 動かし方: npm run recheck（調査の記録 local/runs/ に残っている、Claude が読んだページの中身を使う。確かめ役は呼ぶ）
import fs from "node:fs";
import * as ledger from "./ledger.mjs";
import { assess } from "./research.mjs";

for (const it of ledger.load().items.filter((x) => x.status === "pending" && x.kind === "answer" && x.runId)) {
  const file = `local/runs/${it.runId}.json`;
  if (!fs.existsSync(file)) { console.log(`${it.id}：調査の記録が無いので飛ばす`); continue; }
  const run = JSON.parse(fs.readFileSync(file, "utf8"));
  const text = run.raw.filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/<answer>([\s\S]*?)<\/answer>/);
  if (!m) continue;
  const a = JSON.parse(m[1]);
  const code = it.scope.match(/(\d{5})/)[1];
  const r = await assess({ a, content: run.raw, code, question: it.question, step: () => {} });
  const after = ledger.reassess(it.id, {
    why: r.why.join("／") || undefined,
    verified: r.verified,
    quoteUrl: r.quoteUrl,
    counted: r.counted ?? undefined,
    check: r.check,
    note: a.note || undefined,
    cardId: r.card?.id,
  });
  console.log(`${it.id} ${it.qid ?? ""} → ${after.status}${after.why ? `（${after.why.slice(0, 80)}）` : ""}`);
}
