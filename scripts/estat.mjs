// e-Stat から国勢調査2020 の県ごとの表を取って読む部品（取ったものは data/raw/estat/、公開しない）。
// 取るときは名乗って1秒以上あけ、もう手元にあれば取らない。
import fs from "node:fs";
import JSZip from "jszip";

const UA = "machi-shirube/0.1 (+https://github.com/tyra0119/machi-shirube)";
const RAW = "data/raw/estat";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function get(url, file) {
  if (fs.existsSync(file)) return fs.readFileSync(file);
  fs.mkdirSync(file.replace(/\/[^/]+$/, ""), { recursive: true });
  await sleep(1100);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} が取れませんでした（${res.status}）`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

// 小地域集計（統計表ファイル）：県の一覧のページから表の名前で番号を読み取り、CSV を取る。いちばん左の行番号の列は外す
const listCache = new Map();
export async function smallAreaTable(pref, title, name) {
  const file = `${RAW}/kokusei/${name}-${pref}.csv`;
  if (!fs.existsSync(file)) {
    if (!listCache.has(pref)) {
      const tclass2 = String(1159873 + Number(pref)).padStart(12, "0"); // 県の一覧（01 北海道 = 000001159874 から県の番号順）
      const html = (await get(
        `https://www.e-stat.go.jp/stat-search/files?page=1&layout=datalist&toukei=00200521&tstat=000001136464&cycle=0&tclass1=000001136472&tclass2=${tclass2}&tclass3val=0`,
        `${RAW}/kokusei/list-${pref}.html`,
      )).toString("utf8");
      if (!html.includes(`${pref}：`)) throw new Error(`e-Stat の県の一覧（${pref}）が見つかりません`);
      listCache.set(pref, html);
    }
    const id = listCache.get(pref).match(new RegExp(`stat_infid=(\\d+)"[^>]*>\\s*${title}`))?.[1];
    if (!id) throw new Error(`「${title}」（${pref}）の場所が読み取れません`);
    await get(`https://www.e-stat.go.jp/stat-search/file-download?statInfId=${id}&fileKind=1`, file);
  }
  return new TextDecoder("shift_jis").decode(fs.readFileSync(file)).split(/\r?\n/)
    .map((line) => line.split(",").map((s) => s.replace(/^"|"$/g, "")).slice(1));
}

// 地図用の統計データ（GIS の T00108x）：KEY_CODE・段（HYOSYO）・秘匿の処理つき
export async function gisTable(pref, statsId) {
  const buf = await get(
    `https://www.e-stat.go.jp/gis/statmap-search/data?statsId=${statsId}&code=${pref}&downloadType=2`,
    `${RAW}/stats/${statsId}-${pref}.zip`,
  );
  const files = (await JSZip.loadAsync(buf)).files;
  const txt = new TextDecoder("shift_jis").decode(await files[Object.keys(files).find((n) => n.endsWith(".txt"))].async("uint8array"));
  return txt.split(/\r?\n/).map((line) => line.split(","));
}

// 国勢調査2020 小地域の境界データ（県ごと。人口・世帯つき）
export async function boundaryZip(pref) {
  const file = `${RAW}/A002005212020-${pref}.zip`;
  await get(`https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=${pref}&coordSys=1&format=shape&downloadType=5&datum=2011`, file);
  return file;
}

// 数として読む。「-」は 0、「*」「X」などは隠されている（null）
export const num = (s) => (/^\d+(\.\d+)?$/.test(s) ? Number(s) : s === "-" ? 0 : null);

// 世帯と住まい：市区町村（5けた）と町・字（9けた）ごとの数
// - 第6-1表：一般世帯の数・一人暮らしの世帯・65歳以上の一人暮らしの世帯
// - T001085：住宅に住む一般世帯・持ち家／T001086：主世帯・共同住宅
export async function householdCounts(pref) {
  const out = new Map();
  const put = (key, vals) => out.set(key, { ...out.get(key), ...vals });
  const t61 = await smallAreaTable(pref, "世帯の家族類型，世帯員の年齢による世帯の種類別一般世帯数", "t6-1");
  for (const r of t61) {
    // 列：0 種類・1 市区町村コード・2 町丁字コード・3 段・4 秘匿・11 総数・18 単独世帯・22 65歳以上の単独世帯
    if (r[0] !== "総数" || !/^\d{5}$/.test(r[1])) continue;
    const key = r[3] === "1" ? r[1] : (r[3] === "2" || r[3] === "3") && /^\d{4}$/.test(r[2]) ? r[1] + r[2] : null;
    if (!key) continue;
    if (r[4]) { put(key, { householdHidden: true }); continue; }
    put(key, { households: num(r[11]), single: num(r[18]), elderlySingle: num(r[22]) });
  }
  for (const [id, a, b] of [["T001085", "housed", "owned"], ["T001086", "mainHouseholds", "apartments"]]) {
    for (const r of await gisTable(pref, id)) {
      // 列：0 KEY_CODE・1 段（1 市区町村、2・3 町・字）・4 秘匿・7 以降が数
      if (!/^\d+$/.test(r[0]) || !["1", "2", "3"].includes(r[1])) continue;
      if (r[4] === "1" || r[4] === "2") continue;
      const col = id === "T001085" ? [7, 8] : [7, 10];
      put(r[0], { [a]: num(r[col[0]]), [b]: num(r[col[1]]) });
    }
  }
  return out;
}

// 数から割合（%）へ。分母が無い・0・隠されているときは出さない
export function householdRates(c) {
  const pct = (n, d) => (n == null || !d ? null : Math.round((n / d) * 1000) / 10);
  return {
    singleRate: pct(c.single, c.households),
    elderlySingleRate: pct(c.elderlySingle, c.households),
    ownedRate: pct(c.owned, c.housed),
    apartmentRate: pct(c.apartments, c.mainHouseholds),
  };
}
