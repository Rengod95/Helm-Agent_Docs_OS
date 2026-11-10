import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { attemptAsync, parseJson } from "@fresnel/contracts";

// 브라우저 E2E의 서버 쪽 묶음(L4.remote.spec §12): 실제 서비스(임시 FRESNEL_HOME, 모델만 테이프) + 웹 게이트웨이(루프백 HTTP, TLS 리스너) 프로세스.
// 띄운 프로세스는 `dispose()`가 모두 끈다. 시험은 finally에서 부른다. Bun.spawn은 DR-07의 desktop-test-spawn 허용(test 범위)이다.

const XEON = resolve(import.meta.dir, "../../../..");
const SERVICE_SCRIPT = join(XEON, "scripts/web-e2e/service.ts");
const GATEWAY_MAIN = join(XEON, "apps/desktop-shell/src/web/main.ts");
export const UI_DIR: string = join(XEON, "apps/desktop/dist/ui");
const TIMEOUT_MS = 60_000;

interface Ready {
  readonly loopbackPort: number;
  readonly tlsPort: number | null;
  readonly fingerprint: string | null;
}

/** 자식 표준 출력을 줄 단위로 읽는다. 줄을 기다릴 때 마감이 있다 */
class LineReader {
  private readonly lines: string[] = [];
  private waiter: (() => void) | null = null;
  private done = false;
  constructor(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder();
    const state = { buffer: "" };
    void (async () => {
      for await (const chunk of stream) {
        state.buffer += decoder.decode(chunk, { stream: true });
        for (let i = state.buffer.indexOf("\n"); i >= 0; i = state.buffer.indexOf("\n")) {
          this.lines.push(state.buffer.slice(0, i));
          state.buffer = state.buffer.slice(i + 1);
          this.waiter?.();
        }
      }
      this.done = true;
      this.waiter?.();
    })();
  }
  /** 조건에 맞는 다음 줄. 맞지 않는 줄은 버린다 */
  async next(accept: (line: string) => boolean, label: string): Promise<string> {
    const deadline = Date.now() + TIMEOUT_MS;
    for (;;) {
      const line = this.lines.shift();
      if (line !== undefined) {
        if (accept(line)) return line;
        continue;
      }
      if (this.done) throw new Error(`${label}: the process output ended`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`${label}: no matching line within ${String(TIMEOUT_MS)} ms`);
      // oxlint-disable-next-line no-await-in-loop -- 마감이 있는 줄 기다리기라 한 번에 하나씩 차례로 한다 (L4.remote.spec §12)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiter = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.waiter = null;
    }
  }
}

function field(text: string, key: string): unknown {
  const parsed = parseJson(text);
  if (!parsed.ok) return undefined;
  const value: unknown = parsed.value;
  if (typeof value !== "object" || value === null) return undefined;
  return new Map(Object.entries(value)).get(key);
}

function readyOf(line: string): Ready {
  const parsed = parseJson(line);
  if (!parsed.ok) throw new Error(`gateway ready line is not JSON: ${line}`);
  const port = field(line, "loopbackPort");
  const tls = field(line, "tlsPort");
  const fingerprint = field(line, "fingerprint");
  if (typeof port !== "number") throw new Error(`gateway ready line has no loopback port: ${line}`);
  return {
    loopbackPort: port,
    tlsPort: typeof tls === "number" ? tls : null,
    fingerprint: typeof fingerprint === "string" ? fingerprint : null,
  };
}

export interface Gateway {
  readonly ready: Ready;
  readonly origin: string;
  /** 페어링 코드를 새로 받는다(게이트웨이 표준 입력 제어) */
  pairingCode(): Promise<string>;
  /** 등록된 기기 id 목록 */
  deviceIds(): Promise<readonly string[]>;
  /** 기기를 폐기한다(열린 연결은 게이트웨이가 닫는다) */
  revoke(id: string): Promise<void>;
  /** 정상 종료 요청 뒤 끝나기를 기다린다. 끝나지 않으면 죽인다 */
  stop(): Promise<void>;
}

export interface Stack {
  readonly home: string;
  readonly socketPath: string;
  readonly stateDir: string;
  /** 게이트웨이를 (다시) 띄운다. 같은 상태 폴더와 같은 포트를 쓰므로 기기 등록과 쿠키가 그대로 유효하다 */
  startGateway(ports?: { readonly loopback: number; readonly tls: number }): Promise<Gateway>;
  dispose(): Promise<void>;
}

async function freePort(): Promise<number> {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = probe.port;
  probe.stop(true);
  return port;
}

export async function startStack(): Promise<Stack> {
  const base = mkdtempSync(join(tmpdir(), "fresnel-web-e2e-"));
  const home = join(base, "home");
  const runtimeDir = join(home, "run");
  const stateDir = join(base, "state");
  for (const dir of [home, runtimeDir, stateDir]) mkdirSync(dir, { mode: 0o700 });
  mkdirSync(join(base, "user-home", "work"), { recursive: true });
  const socketPath = join(runtimeDir, "fresnel.sock");
  mkdirSync(join(home, "config"), { mode: 0o700 });
  // 플러그인 프레임 시험(§6.3)용: 저장소 예제 확장 viewdemo를 임시 홈의 사용자 확장 폴더에 복사해 둔다
  const extensionsDir = join(home, "config", "extensions");
  mkdirSync(extensionsDir, { mode: 0o700 });
  cpSync(join(XEON, "examples/viewdemo"), join(extensionsDir, "viewdemo"), { recursive: true });
  writeFileSync(
    join(home, "config", "settings.json"),
    JSON.stringify({
      "l1.models.default": "tape/tape-1",
      "l1.models.providers": [
        { id: "tape", enabled: true, apiKeyRef: "secret://tape-api-key", baseUrl: null },
      ],
      // 임시 홈 밖(OS 키체인)에 아무것도 쓰지 않도록 시크릿 키를 파일로 둔다
      "l0.secrets.ageKey.source": "file",
      // 샌드박스가 켜져 있으면 bash가 승인 없이 돈다. 승인 시험을 위해 끈다(approval-restart.int.test.ts와 같다)
      "l0.sandbox.enabled": false,
    }),
  );

  const children: Bun.Subprocess[] = [];
  const gateways: Gateway[] = [];

  const service = Bun.spawn(["bun", SERVICE_SCRIPT, "--runtime-dir", runtimeDir], {
    env: { ...process.env, FRESNEL_HOME: home },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  children.push(service);
  const serviceLines = new LineReader(service.stdout);

  async function dispose(): Promise<void> {
    for (const gateway of gateways) {
      // oxlint-disable-next-line no-await-in-loop -- 마감이 있는 정리라 한 번에 하나씩 차례로 한다 (L4.remote.spec §12)
      await attemptAsync(() => gateway.stop());
    }
    await attemptAsync(async () => {
      await service.stdin.write("stop\n");
      await service.stdin.flush();
    });
    const exited = await Promise.race([service.exited, Bun.sleep(8_000).then(() => null)]);
    for (const child of children) if (exited === null || child !== service) child.kill("SIGKILL");
    // 실패를 들여다볼 때만 임시 폴더를 남긴다(FRESNEL_WEB_E2E_KEEP=1). 기본은 지운다
    if (process.env["FRESNEL_WEB_E2E_KEEP"] === "1")
      process.stderr.write(`web-e2e: kept ${base}\n`);
    else rmSync(base, { recursive: true, force: true });
  }

  try {
    await serviceLines.next((line) => field(line, "event") === "ready", "service");
  } catch (error) {
    await dispose();
    throw error;
  }

  async function startGateway(ports?: {
    readonly loopback: number;
    readonly tls: number;
  }): Promise<Gateway> {
    const loopback = ports?.loopback ?? (await freePort());
    const tls = ports?.tls ?? (await freePort());
    const child = Bun.spawn(
      [
        "bun",
        GATEWAY_MAIN,
        "--socket",
        socketPath,
        "--state-dir",
        stateDir,
        "--listen",
        `127.0.0.1:${String(loopback)}`,
        "--listen-tls",
        `127.0.0.1:${String(tls)}`,
        "--ui",
        UI_DIR,
      ],
      {
        // 게이트웨이의 시크릿 등록(사이드카)은 이 임시 홈에 쓴다. 실제 홈으로 새지 않게 FRESNEL_HOME을 서비스와 같이 준다
        env: { ...process.env, HOME: join(base, "user-home"), FRESNEL_HOME: home },
        stdin: "pipe",
        stdout: "pipe",
        stderr: process.env["FRESNEL_WEB_E2E_VERBOSE"] === "1" ? "inherit" : "ignore",
      },
    );
    children.push(child);
    const lines = new LineReader(child.stdout);
    const sendLine = async (message: object): Promise<void> => {
      await child.stdin.write(`${JSON.stringify(message)}\n`);
      await child.stdin.flush();
    };
    const send = (cmd: string): Promise<void> => sendLine({ cmd });
    const ready = readyOf(await lines.next((l) => field(l, "event") === "ready", "gateway"));
    const gateway: Gateway = {
      ready,
      origin: `http://127.0.0.1:${String(ready.loopbackPort)}`,
      async pairingCode() {
        await send("pair");
        const line = await lines.next((l) => field(l, "event") === "pairing-code", "pair");
        const code = field(line, "code");
        if (typeof code !== "string") throw new Error("the gateway gave no pairing code");
        return code;
      },
      async deviceIds() {
        await send("devices");
        const line = await lines.next((l) => field(l, "event") === "devices", "devices");
        const devices = field(line, "devices");
        if (!Array.isArray(devices)) return [];
        const list: readonly unknown[] = devices;
        const ids: string[] = [];
        for (const device of list) {
          const id: unknown =
            typeof device === "object" && device !== null
              ? new Map(Object.entries(device)).get("id")
              : undefined;
          if (typeof id === "string") ids.push(id);
        }
        return ids;
      },
      async revoke(id) {
        await sendLine({ cmd: "revoke", id });
        await lines.next((l) => field(l, "event") === "revoked", "revoke");
      },
      async stop() {
        if (child.exitCode !== null) return;
        await send("stop");
        const exited = await Promise.race([child.exited, Bun.sleep(5_000).then(() => null)]);
        if (exited === null) child.kill("SIGKILL");
        await child.exited;
      },
    };
    gateways.push(gateway);
    return gateway;
  }

  return { home, socketPath, stateDir, startGateway, dispose };
}
