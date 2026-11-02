// Claude Code のフック（コミットの前）：公開リポジトリに入れてはいけないものが、コミットに入っていないかを確かめる。
// 入っていたらコミットを止め（終わりのコード 2）、何が引っかかったかを Claude に返す。
// 見るもの：鍵の文字列・.env・local/ の中のもの・PC の中の道筋（ドライブ名つきの利用者フォルダ）
// 設定は .claude/settings.json の hooks（PreToolUse）。手で試すとき：node scripts/hooks/check-commit.mjs --staged
import fs from "node:fs";
import { execFileSync } from "node:child_process";

let command = "";
if (!process.argv.includes("--staged")) {
  const input = await new Promise((ok) => { let s = ""; process.stdin.on("data", (d) => (s += d)); process.stdin.on("end", () => ok(s)); });
  command = JSON.parse(input || "{}").tool_input?.command ?? "";
  if (!/\bgit\b[^|;&]*\bcommit\b/.test(command)) process.exit(0); // コミットでなければ何もしない
}

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
// 「git add -A && git commit」のように同じコマンドで足すときは、まだ足す前なので、足したあとに入るもの全部を見る（多めに見る）
const adding = /\bgit\b[^|;&]*\badd\b/.test(command);
const files = adding
  ? git("add", "-A", "-n").split("\n").map((l) => l.match(/^add '(.+)'$/)?.[1]).filter(Boolean)
  : git("diff", "--cached", "--name-only").split("\n").filter(Boolean);
const problems = [];
for (const f of files) {
  if (/^local\//.test(f)) problems.push(`local/ の中のもの：${f}`);
  if (/(^|\/)\.env(\.|$)/.test(f) && !/\.example$/.test(f)) problems.push(`鍵の置き場所のファイル：${f}`);
}
const RULES = [
  [/sk-ant-[A-Za-z0-9_-]{10,}/, "Anthropic の鍵の文字列"],
  [/ANTHROPIC_API_KEY\s*=\s*['"]?[A-Za-z0-9]/, "鍵を書いた行"],
  [/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/, "PC の中の道筋（利用者のフォルダ）"],
];
let diff = git("diff", adding ? "HEAD" : "--cached", "-U0", "--no-color");
// まだ git が知らない新しいファイルは、中身をそのまま見る
if (adding) for (const f of git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean)) {
  try { diff += `\n+++ b/${f}\n` + fs.readFileSync(f, "utf8").split("\n").map((l) => `+${l}`).join("\n"); } catch {}
}
let file = "";
for (const line of diff.split("\n")) {
  if (line.startsWith("+++ ")) { file = line.slice(6); continue; }
  if (!line.startsWith("+")) continue;
  for (const [re, what] of RULES) if (re.test(line)) problems.push(`${what}：${file}`);
}
if (problems.length) {
  console.error(`コミットを止めました。公開リポジトリに入れてはいけないものがあります：\n- ${[...new Set(problems)].join("\n- ")}\n取り除いてから、もう一度コミットしてください。`);
  process.exit(2);
}
