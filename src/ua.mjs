// 町のサイトや国の機関のサイトを取るときの名札（User-Agent）。どの台本もここから使う。
// 自分で動かす人は、このフォルダの .env に MACHI_SHIRUBE_UA=アプリの名前/版 (+自分の連絡先の URL) を書いて、自分の名札に変える
// （相手のサイトからは、取りに来たのが誰かがこの名札で見える。作者の名札のまま取りに行かないように）。
// GitHub Actions では、リポジトリの Variables の MACHI_SHIRUBE_UA を使う（.github/workflows/news.yml）
import fs from "node:fs";

const AUTHOR = "machi-shirube/0.1 (+https://github.com/tyra0119/machi-shirube)";

// .env からは名札の1行だけを読む（ほかの行は読み込まない）
function fromEnvFile() {
  try {
    const line = fs.readFileSync(".env", "utf8").split(/\r?\n/).find((l) => /^\s*MACHI_SHIRUBE_UA\s*=/.test(l));
    return line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") || undefined;
  } catch {
    return undefined;
  }
}

export const UA = process.env.MACHI_SHIRUBE_UA || fromEnvFile() || AUTHOR;
