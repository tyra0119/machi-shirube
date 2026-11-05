// 録る日の点検（npm run preflight）：デモを録る前に確かめることを、1回でまとめて調べる。Claude は使わない（費用はかからない）
// （作者「全部やる」の E）
import fs from "node:fs";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { spent, japanDay, DAILY_LIMIT_USD, TOTAL_LIMIT_USD } from "../src/cost.mjs";
import { backupDir } from "./backup-ledger.mjs";

const PAGES = "https://tyra0119.github.io/machi-shirube/";
const CANDIDATES = { 15385: "阿賀町", 19365: "身延町" }; // その場で押す町の候補（録る前に試さない）
const rows = [];
const say = (ok, what, detail) => rows.push(`${ok ? "よい　　" : "要確認　"}${what}${detail ? `：${detail}` : ""}`);

// 1. 手元のサーバーと、1回の調べの上限
const ping = await fetch("http://127.0.0.1:8080/api/ping").then((r) => r.json()).catch(() => null);
if (!ping) say(false, "手元のサーバー", "動いていません（npm run serve:research）");
else {
  say(true, "手元のサーバー", "動いています");
  say(ping.runLimit >= 8, "1回の調べの上限", `$${ping.runLimit}${ping.runLimit >= 8 ? "" : "（録る日は .env に RUN_LIMIT_USD=8 を足して、サーバーを動かし直す）"}`);
}

// 2. 費用
const today = spent(japanDay(new Date().toISOString()));
const total = spent();
say(DAILY_LIMIT_USD - today >= 15, "今日あと使える額", `$${(DAILY_LIMIT_USD - today).toFixed(2)}（今日 $${today.toFixed(2)} / 上限 $${DAILY_LIMIT_USD}）`);
say(TOTAL_LIMIT_USD - total >= 30, "合計であと使える額", `$${(TOTAL_LIMIT_USD - total).toFixed(2)}（合計 $${total.toFixed(2)} / 上限 $${TOTAL_LIMIT_USD}）`);

// 3. 確かめ待ちと判断待ちの提案
const items = JSON.parse(fs.readFileSync("local/ledger/items.json", "utf8"));
const pending = (Array.isArray(items) ? items : items.items).filter((x) => x.status === "pending").length;
const props = JSON.parse(fs.readFileSync("local/ledger/proposals.json", "utf8"));
const open = (props.proposals ?? props).filter((p) => p.status === "open").length;
say(true, "確かめ待ち", `${pending} 件（録る場面では、その場で押した町の確かめ待ちを1件 OK する）`);
say(true, "判断待ちの提案", `${open} 件`);

// 4. その場で押す町の候補が、まだ調べていないままか
for (const [code, name] of Object.entries(CANDIDATES)) {
  const done = fs.existsSync(`site/data/answers/${code}.json`) || fs.existsSync(`site/data/mitate/${code}.json`);
  say(!done, `その場で押す町の候補 ${name}`, done ? "もう調べた町になっています（別の町を選ぶ）" : "まだ調べていません");
}

// 5. コミットと公開
const dirty = execSync("git status --porcelain").toString().trim();
say(!dirty, "まだコミットしていない変更", dirty ? `${dirty.split("\n").length} ファイル` : "ありません");
const ahead = execSync("git rev-list --count origin/main..HEAD").toString().trim();
say(ahead === "0", "まだ送っていないコミット", ahead === "0" ? "ありません" : `${ahead} 件（git push）`);
const sha = (b) => crypto.createHash("sha1").update(b).digest("hex");
const live = await fetch(`${PAGES}town.js`, { headers: { "Cache-Control": "no-cache" } }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
const same = live != null && sha(live) === sha(fs.readFileSync("site/town.js", "utf8"));
say(same, "公開のサイト", live == null ? "開けませんでした" : same ? "手元と同じ（最新）" : "手元と違う（送ったばかりなら数分待つ）");

// 5b. 点検（npm run check）：前に起きた不具合が戻っていないか
let checkOut = "";
try { checkOut = execSync("node scripts/check.mjs", { stdio: "pipe" }).toString(); say(true, "点検（npm run check）", checkOut.trim().split("\n").find((l) => /^○ \d/.test(l)) ?? ""); }
catch (e) { checkOut = String(e.stdout ?? ""); say(false, "点検（npm run check）", `${checkOut.split("\n").filter((l) => l.startsWith("×")).join(" / ")}（くわしくは npm run check）`); }

// 6. 台帳の控え
const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
say(fs.existsSync(`${backupDir()}/${day}/items.json`), "今日の台帳の控え", fs.existsSync(`${backupDir()}/${day}/items.json`) ? "あります" : "ありません（npm run backup）");

console.log(["録る日の点検", ...rows, "", "録る前に：Chrome を 1920×1080 の全画面（F11）・おやすみモード・ゲームバーのマウスカーソルはオフ・調べる画面の「終わったら通知を出す」を押して許しておく（録画の最中に確かめの窓が出ないように）"].join("\n"));
