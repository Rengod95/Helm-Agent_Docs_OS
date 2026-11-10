import { WIRE_PROTOCOL_VERSION } from "@fresnel/contracts/wire";
import { startStack } from "./stack.ts";
import { Tab } from "./tab.ts";
import { killStragglers } from "./stragglers.ts";

// L4.remote.plan §2.8 속도 기준선. 웹 게이트웨이와 브라우저가 낀 두 가지를 잰다.
//   web_login_first_screen_ms  페어링 코드를 보낸 시점부터 UI 첫 화면(사이드바 "새 대화"와 연결됨 표시)까지
//   web_reload_first_screen_ms 로그인된 탭을 다시 열어 UI 첫 화면까지(번들 시작 시간: 쿠키 있음, HTTP 캐시는 브라우저 기본)
//   web_wire_roundtrip_ms      브라우저 탭 안에서 `/wire` WebSocket으로 `thread.list` 요청을 보내 답을 받기까지(게이트웨이 → 서비스 소켓 왕복)
// 실제 모델 호출 없음(테이프). 부하 중인 기기에서는 값이 흔들린다.
// 실행(xeon/에서): bash scripts/guard.sh run -- bun apps/desktop/test/web-e2e/web.benchmark.ts [--runs <n>] [--rounds <n>]
// 출력: stdout에 JSON 한 줄씩(metric, unit, value, note). 판정은 하지 않는다. `just web-e2e --bench`, `just benchmark --web`이 부른다.

function numberFlag(name: string, fallback: number): number {
  const at = process.argv.indexOf(name);
  const value = at < 0 ? fallback : Number(process.argv[at + 1]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
const RUNS = numberFlag("--runs", 5);
const ROUNDS = numberFlag("--rounds", 200);

function pick(sorted: readonly number[], p: number): number {
  return (
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? Number.NaN
  );
}
const round1 = (value: number): number => Math.round(value * 10) / 10;

function emit(metric: string, samples: readonly number[], note: string): void {
  const sorted = samples.toSorted((a, b) => a - b);
  for (const [suffix, value] of [
    ["min", sorted[0] ?? Number.NaN],
    ["p50", pick(sorted, 0.5)],
    ["p90", pick(sorted, 0.9)],
    ["max", sorted.at(-1) ?? Number.NaN],
  ] as const) {
    process.stdout.write(
      `${JSON.stringify({ metric: `${metric}_${suffix}`, unit: "ms", value: round1(value), note })}\n`,
    );
  }
}

const stack = await startStack();
const tabs: Tab[] = [];
let failed = false;
try {
  const gateway = await stack.startGateway();
  const loginSamples: number[] = [];
  const reloadSamples: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const tab = new Tab(`bench-${String(run)}`);
    tabs.push(tab);
    // oxlint-disable-next-line no-await-in-loop -- 측정은 한 번에 하나씩 차례로 한다(겹치면 서로의 시간을 늘린다) (L4.remote.spec §12)
    loginSamples.push((await tab.login(gateway, `bench-${String(run)}`)).firstScreenMs);
    const started = performance.now();
    // oxlint-disable-next-line no-await-in-loop -- 측정은 한 번에 하나씩 차례로 한다(겹치면 서로의 시간을 늘린다) (L4.remote.spec §12)
    await tab.navigate(`${gateway.origin}/`);
    // oxlint-disable-next-line no-await-in-loop -- 측정은 한 번에 하나씩 차례로 한다(겹치면 서로의 시간을 늘린다) (L4.remote.spec §12)
    await tab.waitFor(
      "the UI first screen",
      "document.body.innerText.includes('새 대화') && document.body.innerText.includes('연결됨')",
    );
    reloadSamples.push(performance.now() - started);
    if (run < RUNS - 1) {
      tab.close();
      tabs.pop();
    }
  }
  emit(
    "web_login_first_screen",
    loginSamples,
    `${String(RUNS)} runs, loopback HTTP, headless Chrome, tape model`,
  );
  emit(
    "web_reload_first_screen",
    reloadSamples,
    `${String(RUNS)} runs, logged-in tab reopened, loopback HTTP`,
  );

  const last = tabs.at(-1);
  if (last === undefined) throw new Error("benchmark: no tab");
  const wireSamples = await last.eval(`new Promise((resolve, reject) => {
    const socket = new WebSocket(location.origin.replace('http', 'ws') + '/wire');
    const samples = [];
    let count = 0;
    let sentAt = 0;
    const send = (id, method, params) => { sentAt = performance.now(); socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n'); };
    setTimeout(() => reject(new Error('wire round trips timed out after ' + samples.length + ' samples')), 20000);
    socket.onerror = () => reject(new Error('wire socket error'));
    socket.onopen = () => send('hello', 'host.hello', { protocolVersion: ${JSON.stringify(WIRE_PROTOCOL_VERSION)}, client: { name: 'web-bench', version: '0.0.0', kind: 'other' } });
    socket.onmessage = async (event) => {
      const text = typeof event.data === 'string' ? event.data : await event.data.text();
      const message = JSON.parse(text.split('\\n')[0]);
      if (message.id === undefined) return;
      if (message.error) { reject(new Error(JSON.stringify(message.error))); return; }
      if (message.id !== 'hello') samples.push(performance.now() - sentAt);
      if (samples.length >= ${String(ROUNDS)}) { socket.close(); resolve(JSON.stringify(samples)); return; }
      count += 1;
      send('r' + count, 'thread.list', {});
    };
  })`);
  const parsed: unknown = JSON.parse(wireSamples);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "number"))
    throw new Error("benchmark: bad wire samples");
  const wire = parsed.filter((item): item is number => typeof item === "number");
  emit(
    "web_wire_roundtrip",
    wire.slice(Math.min(20, wire.length - 1)),
    `${String(wire.length)} thread.list round trips over /wire after 20 warm-up, empty thread list`,
  );
} catch (error) {
  failed = true;
  process.stderr.write(
    `web benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
} finally {
  for (const tab of tabs) tab.close();
  await stack.dispose();
  const left = killStragglers();
  if (left.length > 0) {
    failed = true;
    process.stderr.write(`web benchmark left processes: ${left.join("; ")}\n`);
  }
}
process.exit(failed ? 2 : 0);
