import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attempt, parseJson } from "@xeon/contracts";
import { WIRE_PROTOCOL_VERSION } from "@xeon/contracts/wire";

// 엔진 프로세스를 stdio JSON-RPC로 모는 시험 도구(G4-03). 컴파일한 사이드카 바이너리와 소스 진입(`bun apps/cli/src/main.ts host --stdio`)을
// 같은 모양으로 다뤄서 같은 요청열의 응답과 이벤트열을 견줄 수 있게 한다. 앱(Tauri 셸)은 거치지 않는다: 셸의 몫(릴레이, 종료 순서)은
// Rust 시험이 맡고, 여기서는 엔진 쪽 바이트 계약과 종료 뒤 잔존 프로세스를 본다.
// Bun.spawn은 DR-07의 desktop-test-spawn 허용(test 범위)이다.

export type Message = Readonly<Record<string, unknown>>;

export interface EngineProcess {
  readonly home: string;
  /** 요청을 보내고 같은 id의 응답(result 또는 error 프레임)을 기다린다 */
  request(method: string, params: unknown): Promise<Message>;
  /** 지금까지 받은 알림(id 없는 메시지) */
  readonly notifications: readonly Message[];
  /** 조건을 만족하는 알림이 올 때까지 기다린다. 시간이 아니라 조건으로 기다린다 */
  waitFor(label: string, done: (notifications: readonly Message[]) => boolean): Promise<void>;
  /** stdout에서 JSON 줄이 아닌 것이 나왔는가(계약 위반) */
  readonly strayStdout: readonly string[];
  /** 종료 요청(선택) 뒤 stdin을 닫고 종료를 기다린다 */
  shutdown(options: {
    readonly message: boolean;
  }): Promise<{ readonly code: number | null; readonly ms: number }>;
  readonly stderr: () => string;
  /** 정리. 남아 있으면 죽이고 홈 폴더를 지운다 */
  dispose(): Promise<void>;
}

export type EngineCommand = readonly string[];

const HELLO: {
  readonly protocolVersion: typeof WIRE_PROTOCOL_VERSION;
  readonly client: { readonly name: string; readonly version: string; readonly kind: string };
} = {
  protocolVersion: WIRE_PROTOCOL_VERSION,
  client: { name: "xeon-e2e", version: "0.0.0", kind: "other" },
};

function newHome(): string {
  const root = mkdtempSync(join(tmpdir(), "xeon-e2e-"));
  chmodSync(root, 0o700);
  mkdirSync(join(root, "config"), { mode: 0o700 });
  return root;
}

function isMessage(value: unknown): value is Message {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function startEngine(
  command: EngineCommand,
  options: { readonly timeoutMs?: number } = {},
): Promise<EngineProcess> {
  const home = newHome();
  const timeoutMs = options.timeoutMs ?? 20_000;
  const proc = Bun.spawn([...command], {
    // XEON_DEV는 비운다: 소스 진입은 스스로 개발 검사를 켜고 컴파일 바이너리는 켜지 않는다. 차이가 wire에 나오지 않아야 한다
    env: { ...process.env, XEON_HOME: home, XEON_DEV: "" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const pending = new Map<string, (message: Message) => void>();
  const notifications: Message[] = [];
  const strayStdout: string[] = [];
  const watchers = new Set<() => void>();
  let stderrText = "";
  let nextId = 0;

  const pump = (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line.trim() === "") continue;
        const parsed = parseJson(line);
        if (!parsed.ok || !isMessage(parsed.value)) {
          strayStdout.push(line);
          continue;
        }
        const message = parsed.value;
        const id = message["id"];
        if (typeof id === "string" && pending.has(id)) {
          pending.get(id)?.(message);
          pending.delete(id);
        } else {
          notifications.push(message);
          for (const watcher of watchers) watcher();
        }
      }
    }
  })();
  const pumpErr = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) stderrText += decoder.decode(chunk, { stream: true });
  })();

  const withDeadline = <T>(label: string, work: Promise<T>): Promise<T> =>
    Promise.race([
      work,
      new Promise<T>((_resolve, reject) =>
        setTimeout(() => {
          reject(
            new Error(`engine e2e: timed out waiting for ${label}\n${stderrText.slice(-2000)}`),
          );
        }, timeoutMs),
      ),
    ]);

  const engine: EngineProcess = {
    home,
    request(method, params) {
      nextId += 1;
      const id = `e2e-${String(nextId)}`;
      const reply = new Promise<Message>((resolve) => pending.set(id, resolve));
      void proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      void proc.stdin.flush();
      return withDeadline(method, reply);
    },
    notifications,
    waitFor(label, done) {
      const ready = new Promise<void>((resolve) => {
        const check = (): void => {
          if (done(notifications)) {
            watchers.delete(check);
            resolve();
          }
        };
        watchers.add(check);
        check();
      });
      return withDeadline(label, ready);
    },
    strayStdout,
    async shutdown({ message }) {
      const started = performance.now();
      if (message) await engine.request("host.shutdown", { reason: "client_exit" });
      await proc.stdin.end();
      const code = await withDeadline("exit", proc.exited);
      await Promise.all([pump, pumpErr]);
      return { code, ms: Math.round(performance.now() - started) };
    },
    stderr: () => stderrText,
    async dispose() {
      if (proc.exitCode === null) proc.kill("SIGKILL");
      await proc.exited;
      rmSync(home, { recursive: true, force: true });
    },
  };
  // hello는 모든 시험의 첫 요청이다. 호출자가 응답을 보게 하려고 여기서 보내지 않는다
  return engine;
}

export { HELLO };

/**
 * 엔진 홈(`XEON_HOME`)을 환경에 가진 프로세스가 남아 있는가. 종료한 사이드카의 손자(셸 도구, MCP 서버)가 남았는지 본다.
 * Linux의 /proc을 읽는다. 다른 OS에서는 null(확인하지 못함)이다.
 */
export function processesWithHome(home: string): number[] | null {
  const listed = attempt(() => readdirSync("/proc"));
  if (!listed.ok) return null;
  const needle = `XEON_HOME=${home}`;
  const found: number[] = [];
  for (const entry of listed.value) {
    if (!/^\d+$/.test(entry)) continue;
    // 사라졌거나 읽을 수 없는 프로세스는 우리 것이 아니다
    const environ = attempt(() => readFileSync(`/proc/${entry}/environ`, "utf8"));
    if (environ.ok && environ.value.split("\0").includes(needle)) found.push(Number(entry));
  }
  return found;
}
