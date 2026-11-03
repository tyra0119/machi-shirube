// 承認の台帳（local/ledger。公開しないので、この PC の中に1つしかない）の控えを、作品のフォルダの外に日付ごとに写す。
// 写す先：環境変数 BACKUP_DIR、なければ OneDrive の中の「まちしるべの控え」、OneDrive が無ければホームの machi-shirube-backup。
// 同じ日のうちは同じフォルダに上書きする（古い日の控えは消さない）。npm run backup で動かす。手元のサーバー（serve.mjs）も始めたときと6時間ごとに動かす
// （作者「全部やる」の D：台帳が消えると、どれを誰が確かめたかの記録が失われる）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function backupDir() {
  if (process.env.BACKUP_DIR) return process.env.BACKUP_DIR;
  const one = path.join(os.homedir(), "OneDrive");
  return fs.existsSync(one) ? path.join(one, "まちしるべの控え") : path.join(os.homedir(), "machi-shirube-backup");
}

export function backupLedger(log = console.log) {
  const src = "local/ledger";
  if (!fs.existsSync(src)) return null;
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // 2026-11-03
  const dest = path.join(backupDir(), day);
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(src)) {
    const from = path.join(src, f);
    if (!fs.statSync(from).isFile()) continue;
    fs.copyFileSync(from, path.join(dest, f));
    n++;
  }
  log(`承認の台帳の控えを写しました：${n} ファイル → ${dest}`);
  return { dest, n };
}

if (process.argv[1]?.endsWith("backup-ledger.mjs")) backupLedger();
