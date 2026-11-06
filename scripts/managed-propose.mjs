// 提案を Managed Agents で作る（作者「Managed Agentsを小さく使うところを作って」）。
// 町を調べ終えたあとの「物差しに無い問い（多くて2つ）と、調べ方のスキル（1つ）」を、Anthropic が動かすエージェント（Managed Agents）に作らせる。
// outcomes：決めた物差し（ルーブリック）に合うまで、別の採点役が見て、足りなければやり直させる。出力は /mnt/session/outputs/proposal.json
// 町の数字・物差しの問い・答えは、ファイル（town.json）にしてセッションに渡す。ウェブは使わせない（渡したものだけで考える）。
// エージェントと環境は一度だけ作り、番号を local/ledger/managed-agents.json に残して使い回す（鍵ではないが、作者の手元のもの）
// 使い方：scripts/propose.mjs から呼ぶ。うまくいかないときは、これまでの作り（ふつうの Claude の呼び出し）に戻る
import fs from "node:fs";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { record } from "../src/cost.mjs";

const MODEL = "claude-sonnet-5-5";
const IDS = "local/ledger/managed-agents.json";
const BETAS = ["managed-agents-2026-04-01"];

const SYSTEM = `あなたは、町の暮らしの情報を集める仕組み「まちしるべ」の相談役です。
/workspace/town.json に、ある町の数字（町の数字）と、どの町にも聞く問いの一覧（物差し）と、Claude が町の公式のサイトから調べた答え（答え）が入っています。
読んだうえで、次の2つを作り、/mnt/session/outputs/proposal.json に JSON で書いてください。ウェブは使えません。渡したものだけで考えます。
1. この町で、暮らしの情報が届きにくい人（お年寄り・外国の住民・子育て・引っ越してきた人など）のために大事なのに、物差しに無い問いを、多くても2つ。
   公式のサイトで調べられること。うわさや個人のこと、町の評価は問いにしない。どの町にも聞く（all）か、決まりつきの町だけ（rule）か。この町だけの問いは作らない。問いの文に町の名前は入れず「この町」と書く。
2. 答えに使った公式のページの種類を見て、次に別の町で同じことを調べるときに役に立つ「調べ方」を、スキルとして1つ（役に立たなければ null）。町の名前や URL は書かない。
形：{"questions": [{"text": "問い", "short": "15字までの見出し", "why": "なぜこの町で大事か（町の数字をそのまま使う）", "reach": "all|rule", "rule": "決まり（rule のとき）", "page": "bousai|gomi|iryo|komatta|kosodate|kaigo|koutsuu|tetsuzuki|foreign|okane|shisetsu|shiru"}], "skill": {"name": "名前", "forQids": ["物差しの番号"], "steps": ["手順"], "why": "なぜ役に立つか"} または null}
やさしい日本語で書きます。`;

// 採点役が見る物差し（ルーブリック）。どれも1つずつ合否を決められる形
const RUBRIC = `# 提案の物差し
- /mnt/session/outputs/proposal.json がある。JSON として読める。形は {"questions": [...], "skill": {...} または null}
- questions は 0〜2 個。どの問いにも text・short（15字まで）・why・reach（all / rule のどちらか）・page（bousai, gomi, iryo, komatta, kosodate, kaigo, koutsuu, tetsuzuki, foreign, okane, shisetsu, shiru のどれか）がある。reach が rule なら rule もある
- どの問いも、/workspace/town.json の「物差し」にある問いと同じことを聞いていない（言い方がちがっても、聞いている中身が同じなら不合格）
- どの問いの text にも、町の名前（市区町村の名前）が入っていない
- どの問いの why にも、/workspace/town.json の「町の数字」にある数が1つ以上、そのまま書かれている
- どの問いも、町の公式のサイトを調べれば答えられる。うわさ・個人のこと・町の良し悪しを聞いていない
- skill が null でないとき：name・steps（2〜6個）・forQids・why がある。forQids は「物差し」にある番号だけ。町の名前や URL を書いていない
- 文はやさしい日本語で、空の欄や仮の文（TODO など）が無い`;

async function ids(client, log) {
  const saved = fs.existsSync(IDS) ? JSON.parse(fs.readFileSync(IDS, "utf8")) : {};
  if (saved.agentId && saved.environmentId) return saved;
  log("Managed Agents のエージェントと環境を作っています（はじめの1回だけ）");
  const environment = await client.beta.environments.create({ name: "machi-shirube", config: { type: "cloud", networking: { type: "limited", allow_package_managers: false, allow_mcp_servers: false } } });
  const agent = await client.beta.agents.create({
    name: "machi-shirube 提案役", model: MODEL, system: SYSTEM,
    tools: [{ type: "agent_toolset_20260401", default_config: { enabled: true, permission_policy: { type: "auto" } }, configs: [{ name: "web_fetch", enabled: false }, { name: "web_search", enabled: false }] }],
  });
  const out = { environmentId: environment.id, agentId: agent.id, agentVersion: agent.version, createdAt: new Date().toISOString() };
  fs.mkdirSync("local/ledger", { recursive: true });
  fs.writeFileSync(IDS, JSON.stringify(out, null, 1));
  return out;
}

// payload：town.json に入れるもの。返すのは proposal.json の中身と、費用（ドル）・セッションの番号・採点の回数
export async function proposeWithAgent({ title, payload, log = console.log, timeoutMs = 8 * 60 * 1000 }) {
  const client = new Anthropic();
  const { environmentId, agentId, agentVersion } = await ids(client, log);
  const file = await client.beta.files.upload({ file: await toFile(Buffer.from(JSON.stringify(payload, null, 1)), "town.json", { type: "application/json" }) });
  const session = await client.beta.sessions.create({
    agent: { type: "agent", id: agentId, version: agentVersion }, environment_id: environmentId, title,
    resources: [{ type: "file", file_id: file.id, mount_path: "/workspace/town.json" }],
  });
  log(`Managed Agents のセッションを始めました（${session.id}）。採点役が物差しに合うまで見ます`);
  let usd = 0, rounds = 0, result = "";
  const stream = await client.beta.sessions.events.stream(session.id);
  await client.beta.sessions.events.send(session.id, { events: [{ type: "user.define_outcome", description: "town.json を読み、この町の届きにくい人のための、物差しに無い問い（多くて2つ）と、調べ方のスキル（1つか null）を proposal.json に書く", rubric: { type: "text", content: RUBRIC }, max_iterations: 3 }] });
  const timer = setTimeout(() => client.beta.sessions.events.send(session.id, { events: [{ type: "user.interrupt" }] }).catch(() => {}), timeoutMs);
  try {
    for await (const ev of stream) {
      if (ev.type === "span.outcome_evaluation_end") {
        rounds = ev.iteration + 1; result = ev.result;
        if (ev.usage?.input_tokens != null) usd += record(MODEL, ev.usage, `Managed Agents の採点役：${title}`);
        log(`採点役（${rounds}回目）：${ev.result === "satisfied" ? "物差しに合った" : ev.result === "needs_revision" ? "足りない所がある → やり直し" : ev.result}${ev.explanation ? `（${String(ev.explanation).slice(0, 80)}）` : ""}`);
      } else if ((ev.type === "agent.tool_use" || ev.type === "agent.mcp_tool_use") && ev.evaluated_permission === "ask") {
        // 人が見ていないので、確かめが要る道具は使わせない
        await client.beta.sessions.events.send(session.id, { events: [{ type: "user.tool_confirmation", tool_use_id: ev.id, result: "deny" }] });
      } else if (ev.type === "session.status_idle" && ev.stop_reason?.type !== "requires_action") break;
      else if (ev.type === "session.status_terminated") break;
    }
  } finally { clearTimeout(timer); }
  // エージェントの分の費用（セッションの使った量）
  const s = await client.beta.sessions.retrieve(session.id);
  if (s.usage?.input_tokens != null) usd += record(MODEL, s.usage, `Managed Agents の提案役：${title}`);
  // 出力のファイルを受け取る（並ぶまで少し遅れることがある）
  let text = null;
  for (let k = 0; k < 4 && text == null; k++) {
    for await (const f of client.beta.files.list({ scope_id: session.id, betas: BETAS })) {
      if (f.filename?.endsWith("proposal.json")) text = await (await client.beta.files.download(f.id)).text();
    }
    if (text == null) await new Promise((r) => setTimeout(r, 1500));
  }
  if (text == null) throw new Error(`proposal.json が受け取れませんでした（採点：${result || "なし"}）`);
  return { p: JSON.parse(text), usd, sessionId: session.id, rounds, result };
}
