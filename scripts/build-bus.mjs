// バスの便利さ（めやす）：公開されているバスの時刻表データ（GTFS。GTFS データリポジトリに載っているもの）から、
// 平日1日のバス停ごとの発車の本数を数え、250m 四方ごとの65歳以上の人口（国勢調査 2020年）と重ねて、
// 「バス停まで 500m 以上」「近いバス停の本数が1日 10 本未満」の所に住む65歳以上を、町・字ごとに数える。Claude は使わない
// 動かし方: npm run build:bus -- 10524 39428
// GTFS の zip は local/cache/gtfs/ にだけ置く。リポジトリには、町の中のバス停の名前・位置・本数と、足した数だけを入れる
import fs from "node:fs";
import AdmZip from "adm-zip";
import { townMeshes, cached } from "./build-flood-pop.mjs";
import { rows as csvRows } from "./csv.mjs";

// 町ごとに使う時刻表（GTFS データリポジトリ https://gtfs-data.jp/ で町の名前・事業者で探したもの）
const FEEDS = {
  10524: [{ name: "大泉町 広域公共バス「あおぞら」", url: "https://api.gtfs-data.jp/v2/organizations/oizumitown/feeds/kouikikoukyoubasuaozora/files/feed.zip", page: "https://gtfs-data.jp/search?target_feed=oizumitown/kouikikoukyoubasuaozora" }],
  // 朝霞市：市が「オープンデータとして公開」（ライセンスの名前は書かれていない）。作者が使ってよいとしたサイト（情報源カード c0002：事実と出典のリンクを出す）
  11227: [{ name: "朝霞市 市内循環バス（わくわく号）", url: "https://www.city.asaka.lg.jp/uploaded/attachment/110771.zip", page: "https://www.city.asaka.lg.jp/soshiki/26/gtfs.html" }],
  39428: [{ name: "高知西南交通 路線バス", url: "https://api-public.odpt.org/api/v4/files/odpt/KochiSeinanTraffic/Localbus.zip?date=current", page: "https://gtfs-data.jp/search?target_feed=kochi-seinan-kotsu/GTFS-Seinantraffic_Localbus" }],
};
const FAR = 500, FEW = 10;
const dist = (a, b) => { const r = Math.PI / 180, x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r), y = (b[1] - a[1]) * r; return Math.hypot(x, y) * 6371000; };
const table = (zip, name) => {
  const e = zip.getEntries().find((x) => x.entryName.endsWith(name));
  if (!e) return [];
  const [head, ...body] = csvRows(e.getData().toString("utf8").replace(/^﻿/, ""));
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]])));
};

// 次の平日（今日から見て）に走る便の service_id
function weekdayServices(zip) {
  const d = new Date();
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const wd = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][d.getDay()];
  const on = new Set(table(zip, "calendar.txt").filter((c) => c[wd] === "1" && c.start_date <= ymd && ymd <= c.end_date).map((c) => c.service_id));
  for (const c of table(zip, "calendar_dates.txt")) if (c.date === ymd) (c.exception_type === "1" ? on.add(c.service_id) : on.delete(c.service_id));
  return { on, ymd };
}

export async function buildBus(code, log = console.log) {
  const feeds = FEEDS[code];
  if (!feeds) throw new Error(`${code} の時刻表データはまだ決めていません`);
  const { parts, inTown } = await townMeshes(code, log);
  const lons = inTown.map((m) => m.b.lon), lats = inTown.map((m) => m.b.lat);
  const box = [Math.min(...lons) - 0.01, Math.min(...lats) - 0.01, Math.max(...lons) + 0.01, Math.max(...lats) + 0.01];
  const stops = new Map(); // 名前ごと（のりばが分かれていても1つに）
  let ymd = "";
  for (const f of feeds) {
    const buf = await cached(f.url, `local/cache/gtfs/${code}-${feeds.indexOf(f)}.zip`);
    if (!buf) throw new Error(`時刻表を取れませんでした：${f.name}`);
    let zip = new AdmZip(buf);
    // zip の中に zip が入っている形（朝霞市など）は、中の zip を開く
    const inner = !zip.getEntries().some((e) => e.entryName.endsWith("stops.txt")) && zip.getEntries().find((e) => e.entryName.endsWith(".zip"));
    if (inner) zip = new AdmZip(inner.getData());
    const sv = weekdayServices(zip);
    ymd = sv.ymd;
    const trips = new Set(table(zip, "trips.txt").filter((t) => sv.on.has(t.service_id)).map((t) => t.trip_id));
    const count = new Map();
    for (const st of table(zip, "stop_times.txt")) if (trips.has(st.trip_id)) count.set(st.stop_id, (count.get(st.stop_id) ?? 0) + 1);
    for (const s of table(zip, "stops.txt")) {
      const p = [Number(s.stop_lon), Number(s.stop_lat)];
      if (!(p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3])) continue;
      const k = s.stop_name;
      const cur = stops.get(k) ?? { name: k, lon: p[0], lat: p[1], n: 0 };
      cur.n += count.get(s.stop_id) ?? 0;
      stops.set(k, cur);
    }
  }
  const list = [...stops.values()].filter((s) => s.n > 0);
  log(`平日（${ymd}）に便のあるバス停 ${list.length}`);

  let old = 0, far = 0, few = 0;
  const byPart = {};
  for (const m of inTown) {
    if (m.old == null) continue;
    const c = [m.b.lon + m.b.w / 2, m.b.lat + m.b.h / 2];
    const near = list.filter((s) => dist(c, [s.lon, s.lat]) < FAR);
    const bp = (byPart[m.part] ??= { old: 0, far: 0, few: 0 });
    old += m.old; bp.old += m.old;
    if (!near.length) { far += m.old; bp.far += m.old; }
    else if (Math.max(...near.map((s) => s.n)) < FEW) { few += m.old; bp.few += m.old; }
  }
  const r10 = (v) => Math.round(v / 10) * 10, pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const out = {
    code, date: ymd, createdAt: new Date().toISOString(),
    routes: feeds.map((f) => f.name),
    stops: list.sort((a, b) => b.n - a.n).map((s) => ({ name: s.name, lon: Math.round(s.lon * 1e5) / 1e5, lat: Math.round(s.lat * 1e5) / 1e5, n: s.n })),
    over65: r10(old), far: r10(far), farRate: pct(far, old), few: r10(few), fewRate: pct(few, old),
    parts: Object.fromEntries(Object.entries(byPart).filter(([, v]) => v.old >= 20).map(([k, v]) => [k, { name: parts.find((p) => p.props.part === k)?.props.name, farRate: pct(v.far, v.old), fewRate: pct(v.few, v.old) }])),
    note: `公開されているバスの時刻表データ（GTFS）にあるバスだけで数えた、めやすです（${feeds.map((f) => f.name).join("・")}）。デマンド交通・スクールバス・時刻表データが公開されていないバスは入っていません。本数は平日1日の、そのバス停を出る便の数（行き・帰りの両方）。250m 四方の真ん中からバス停までのまっすぐの距離で見ています`,
    sources: [
      ...feeds.map((f) => ({ title: `${f.name}（GTFS、CC BY 4.0）`, url: f.page })),
      { title: "国勢調査 2020年 地域メッシュ統計（250m）人口（総務省統計局 e-Stat）", url: "https://www.e-stat.go.jp/gis/statmap-search?page=1&type=1&toukeiCode=00200521&toukeiYear=2020&aggregateUnit=Q" },
    ],
  };
  fs.mkdirSync("site/data/bus", { recursive: true });
  fs.writeFileSync(`site/data/bus/${code}.json`, JSON.stringify(out, null, 1));
  log(`${code}：バス停まで500m以上の65歳以上 ${out.farRate}%・近いバス停が1日${FEW}本未満 ${out.fewRate}%`);
  return out;
}

if (process.argv[1]?.endsWith("build-bus.mjs")) for (const c of process.argv.slice(2)) await buildBus(c);
