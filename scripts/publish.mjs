// 公開に送る（確かめる一覧の「公開に送る」ボタンから。手元のサーバーだけ）
// 作者「画面でボタンを押したら公開まで動く」。送るのは site/data（公開してよいものだけを書き出した所）だけ。
// 順に：送れる時かを見る → 点検（npm run check）→ site/data だけを足す → 鍵・local/・PC の道筋が入っていないか
//       （コミットの前のフックと同じ確かめ）→ コミット → GitHub に送る（push で GitHub Pages が公開を作り直す）
// どこかで止まったら、足したものを外して、止まった理由を返す。手で試すとき：node scripts/publish.mjs（見るだけ）
import { execFileSync } from "node:child_process";

// 審査のあいだは送らない（11/8 20:00 から）。審査が終わったら、この行を外す
const FREEZE_FROM = Date.parse("2026-11-08T20:00:00+09:00");
const DIR = "site/data";

const git = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const lines = (s) => s.split("\n").filter(Boolean);

// 送る前に見せる中身：site/data の変わったファイルと、送らない変更の数
export function preview() {
  const all = lines(git("status", "--porcelain")).map((l) => l.slice(3).replace(/^"|"$/g, ""));
  const files = all.filter((f) => f.startsWith(`${DIR}/`));
  const ahead = Number(git("rev-list", "--count", "origin/main..HEAD") || 0);
  return { files, other: all.length - files.length, ahead, frozen: Date.now() >= FREEZE_FROM };
}

let busy = false;
export async function publish() {
  if (busy) return { ok: false, step: "送っている途中", message: "いま送っています。終わるまで待ってください" };
  busy = true;
  const steps = [];
  try {
    if (Date.now() >= FREEZE_FROM) return { ok: false, step: "送れる時", message: "審査のあいだ（11/8 20:00 から）は送りません", steps };
    if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") return { ok: false, step: "送れる時", message: "いまの枝が main ではありません", steps };
    const staged = lines(git("diff", "--cached", "--name-only"));
    if (staged.some((f) => !f.startsWith(`${DIR}/`))) return { ok: false, step: "送れる時", message: `site/data の外のものが、コミットに足されたままです（${staged.length} ファイル）。Claude に頼んでください`, steps };
    git("fetch", "-q", "origin", "main");
    if (Number(git("rev-list", "--count", "HEAD..origin/main")) > 0) return { ok: false, step: "送れる時", message: "GitHub の方に新しいコミットがあります（お知らせの自動の取り直しなど）。Claude に頼んでください", steps };
    steps.push("送れる時：よい");

    // 点検。× が 1 つでもあれば止める
    try {
      const out = execFileSync(process.execPath, ["scripts/check.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      steps.push(`点検：${out.match(/○ \d+　△ \d+　× \d+/)?.[0] ?? "よい"}`);
    } catch (e) {
      const ng = String(e.stdout ?? "").split("\n").filter((l) => l.startsWith("×")).slice(0, 5).join(" / ");
      return { ok: false, step: "点検", message: `点検で × がありました：${ng || "（npm run check で見てください）"}`, steps };
    }

    git("add", "--", DIR);
    const files = lines(git("diff", "--cached", "--name-only"));
    if (!files.length) {
      const ahead = Number(git("rev-list", "--count", "origin/main..HEAD") || 0);
      if (!ahead) return { ok: false, step: "送るもの", message: "送るものがありません（公開と同じです）", steps };
    } else {
      // コミットの前のフックと同じ確かめ（鍵の文字列・.env・local/・PC の中の道筋）
      try {
        execFileSync(process.execPath, ["scripts/hooks/check-commit.mjs", "--staged"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        git("reset", "-q", "--", DIR);
        return { ok: false, step: "鍵と local/ の確かめ", message: String(e.stderr ?? "").trim() || "入れてはいけないものがありました", steps };
      }
      steps.push(`鍵と local/ の確かめ：よい（${files.length} ファイル）`);
      const msg = `確かめる一覧から公開（作者が「公開に送る」を押した）：site/data の ${files.length} ファイル\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
      execFileSync("git", ["commit", "-q", "-F", "-"], { input: msg, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      steps.push(`コミット：${git("log", "-1", "--format=%h")}`);
    }
    try {
      git("push", "-q", "origin", "main");
    } catch (e) {
      return { ok: false, step: "GitHub に送る", message: `送れませんでした（コミットは手元に残っています）：${String(e.stderr ?? e.message).trim().split("\n")[0]}`, steps };
    }
    steps.push("GitHub に送る：よい");
    return { ok: true, message: "送りました。数分で公開のサイトに出ます", steps };
  } catch (e) {
    return { ok: false, step: "途中", message: String(e.stderr ?? e.message).trim().split("\n")[0], steps };
  } finally {
    busy = false;
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) console.log(preview());
