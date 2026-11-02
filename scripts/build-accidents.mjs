// 道の安全（交通事故）：警察庁の交通事故統計オープンデータ（本票。人身事故の1件ごとの地点・年齢・当事者）から、
// 町の中で起きた事故を、町・字ごとと「事故が重なる地点」に数える。Claude は使わない（PC の計算だけ）
// 動かし方: npm run build:accidents -- 39428 10524 11227
// 元のデータ（local/cache/npa/honhyo_{年}.csv）は手元にだけ置く。https://www.npa.go.jp/publications/statistics/koutsuu/opendata/index_opendata.html から取る
import fs from "node:fs";
import readline from "node:readline";
import { polygonsOf, inPoly } from "./build-flood-pop.mjs";

const YEARS = [2022, 2023, 2024];
const NATION_POP = 126146099; // 国勢調査 2020年の全国の人口（全国と比べるめやすに使う）
// 列の位置（ファイル定義書の順。0 から）
const C = { kind: 4, dead: 5, hurt: 6, year: 10, hour: 13, dayNight: 15, ageA: 36, ageB: 37, typeA: 38, typeB: 39, lat: 60, lon: 61 };
const OLD = new Set(["65", "75"]); // 年齢の区分：65〜74歳・75歳以上
const PED = "61", BIKE = "51"; // 当事者種別：歩行者・自転車
// 地点の「度・分・秒」（緯度 9 桁・経度 10 桁、秒は 1/1000 まで）→ 度
const dms = (s, d) => Number(s.slice(0, d)) + Number(s.slice(d, d + 2)) / 60 + Number(s.slice(d + 2)) / 1000 / 3600;

export async function buildAccidents(codes, log = console.log) {
  const towns = codes.map((code) => {
    const parts = polygonsOf(JSON.parse(fs.readFileSync(`site/data/towns/${code}.json`, "utf8")));
    const pts = parts.flatMap((p) => p.polys.flat(2));
    const box = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    const pop = parts.reduce((s, p) => s + (p.props.population ?? 0), 0);
    return { code, parts, box, pop, list: [] };
  });
  const nation = { all: 0, ped: 0, oldPed: 0 };
  for (const y of YEARS) {
    const rl = readline.createInterface({ input: fs.createReadStream(`local/cache/npa/honhyo_${y}.csv`, { encoding: "latin1" }) });
    let first = true;
    for await (const line of rl) {
      if (first) { first = false; continue; } // 見出しの行
      const r = line.split(",");
      const ped = r[C.typeA] === PED || r[C.typeB] === PED;
      const oldPed = (r[C.typeA] === PED && OLD.has(r[C.ageA])) || (r[C.typeB] === PED && OLD.has(r[C.ageB]));
      nation.all++; if (ped) nation.ped++; if (oldPed) nation.oldPed++;
      const lat = dms(r[C.lat], 2), lon = dms(r[C.lon], 3);
      for (const t of towns) {
        if (lon < t.box[0] || lon > t.box[2] || lat < t.box[1] || lat > t.box[3]) continue;
        const part = t.parts.find((p) => inPoly(lon, lat, p.polys));
        if (!part) continue;
        t.list.push({
          lat, lon, part: part.props.part, year: y, dead: r[C.kind] === "1", ped, oldPed,
          bike: r[C.typeA] === BIKE || r[C.typeB] === BIKE,
          dusk: r[C.dayNight] === "13" || r[C.dayNight] === "21", // 日の入りの前後1時間
        });
      }
    }
    log(`${y}年：全国 ${nation.all.toLocaleString("ja-JP")} 件まで読んだ`);
  }
  const perYear = (n) => n / YEARS.length;
  const per1000 = (n, pop) => Math.round((perYear(n) / pop) * 1000 * 100) / 100;
  for (const t of towns) {
    const count = (f) => t.list.filter(f).length;
    const oldPed = t.list.filter((a) => a.oldPed);
    // 事故が重なる地点：およそ 50m の升目に集め、3年で3件以上の所を多い順に
    const cells = new Map();
    for (const a of t.list) {
      const k = `${Math.round(a.lat / 0.00045)}/${Math.round(a.lon / 0.00055)}`;
      const c = cells.get(k) ?? { n: 0, ped: 0, oldPed: 0, bike: 0, dead: 0, lat: 0, lon: 0, parts: {} };
      c.n++; c.ped += a.ped; c.oldPed += a.oldPed; c.bike += a.bike; c.dead += a.dead; c.lat += a.lat; c.lon += a.lon;
      c.parts[a.part] = (c.parts[a.part] ?? 0) + 1;
      cells.set(k, c);
    }
    const name = (part) => t.parts.find((p) => p.props.part === part)?.props.name;
    const spots = [...cells.values()].filter((c) => c.n >= 3).sort((a, b) => b.n - a.n || b.ped - a.ped).slice(0, 10).map((c) => ({
      lat: Math.round((c.lat / c.n) * 1e5) / 1e5, lon: Math.round((c.lon / c.n) * 1e5) / 1e5, n: c.n, ped: c.ped, oldPed: c.oldPed, bike: c.bike, dead: c.dead,
      part: name(Object.entries(c.parts).sort((a, b) => b[1] - a[1])[0][0]),
    }));
    const parts = {};
    for (const a of t.list) (parts[a.part] ??= { n: 0, ped: 0, oldPed: 0 }), parts[a.part].n++, (parts[a.part].ped += a.ped), (parts[a.part].oldPed += a.oldPed);
    const out = {
      code: t.code, years: YEARS, createdAt: new Date().toISOString(), population: t.pop,
      total: t.list.length, dead: count((a) => a.dead), ped: count((a) => a.ped), oldPed: oldPed.length, bike: count((a) => a.bike),
      per1000: per1000(t.list.length, t.pop), nationPer1000: per1000(nation.all, NATION_POP),
      oldPedShare: t.list.length ? Math.round((oldPed.length / t.list.length) * 1000) / 10 : 0,
      nationOldPedShare: Math.round((nation.oldPed / nation.all) * 1000) / 10,
      oldPedDusk: oldPed.length ? Math.round((oldPed.filter((a) => a.dusk).length / oldPed.length) * 1000) / 10 : null,
      parts, spots,
      note: "警察庁の交通事故統計オープンデータ（人身事故。物損事故は入らない）のうち、町の中の地点で起きたものを数えたもの。年齢は事故のときの年齢の区分（65歳以上＝65〜74歳と75歳以上）。地点は升目（およそ50m）に集めた、めやすです",
      sources: [{ title: "警察庁 交通事故統計情報のオープンデータ（本票 2022〜2024年）を加工して作成", url: "https://www.npa.go.jp/publications/statistics/koutsuu/opendata/index_opendata.html" }],
    };
    fs.mkdirSync("site/data/accidents", { recursive: true });
    fs.writeFileSync(`site/data/accidents/${t.code}.json`, JSON.stringify(out, null, 1));
    log(`${t.code}：3年で ${out.total} 件（死亡 ${out.dead}・歩行者 ${out.ped}・お年寄りの歩行者 ${out.oldPed}・自転車 ${out.bike}）。人1000人あたり年 ${out.per1000} 件（全国 ${out.nationPer1000}）。重なる地点 ${spots.length}`);
  }
}

if (process.argv[1]?.endsWith("build-accidents.mjs")) await buildAccidents(process.argv.slice(2));
