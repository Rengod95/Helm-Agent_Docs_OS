import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, parseJson, type Logger, type Result } from "@xeon/contracts";
import type {
  BinaryError,
  BinaryName,
  OsDirs,
  ProcessService,
  ResolvedBinary,
  SandboxService,
  SecretService,
} from "@xeon/contracts/services";
import { ProcessServiceName, SandboxServiceName } from "@xeon/contracts/services";
import type { ExtHost } from "@xeon/ext-host";
import {
  createSandboxService,
  readSandboxSettings,
  type SandboxServiceHandle,
  type SandboxSettings,
} from "@xeon/platform-sandbox";
import { createBackgroundRegistry } from "@xeon/platform-process";
import {
  createLocalIdFactory,
  systemClock,
  systemRandom,
  systemScheduler,
  type SystemScheduler,
} from "@xeon/platform-os";
import { createHostMcpProcessPort } from "../../src/assembly/mcp-process.ts";
import { partial } from "../fixtures/unsafe.ts";

// P-15, M3b B3-SEC 끝 시험: stdio MCP 서버를 샌드박스(srt, bwrap)에 넣어 띄우면 보호 디렉터리 읽기, 작업 폴더 밖 쓰기, 차단 도메인 접속이
// 실제로 막힌다. 같은 서버를 샌드박스 없이 띄우면 셋 다 된다(대조). 조립 루트의 `createHostMcpProcessPort`를 그대로 쓴다.
// srt는 프로세스 전역 싱글턴이라 시험마다 서비스를 하나 만들고 끝에 `dispose()`한다.
// 필수 바이너리(bwrap, socat, rg)가 없거나 서비스 상태가 쓸 수 없으면 건너뛰고 stderr에 한 줄 남긴다.
// XEON_REQUIRE_SANDBOX=1 또는 CI이면 건너뛰지 않고 종료 코드 2(환경 문제)로 끝난다(sandbox-network.int.test.ts와 같다).

const PROBE = join(import.meta.dir, "..", "fixtures", "mcp-sandbox-probe.ts");
const REQUIRED_BINARIES = ["bwrap", "socat", "rg"] as const;
const ENVIRONMENT_EXIT_CODE = 2;
const VAULT_SECRET = "vault-value-for-mcp-sandbox-test";
const BLOCKED_HOST = "127.0.0.1";
const TEST_TIMEOUT_MS = 30_000;
/** 디스크의 임시 디렉터리. 작업 폴더와 srt 프록시 소켓(`tmpdir()` 아래)이 여기 있어야 bwrap 안에서 보인다 */
const DISK_TMP = "/tmp";

const LOGGER: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => LOGGER,
};

/** 조회할 서비스. xeon.process와 xeon.sandbox만 채운다 */
function extWith(services: {
  readonly process: ProcessService;
  readonly sandbox: SandboxService;
}): Pick<ExtHost, "ports"> {
  return partial<Pick<ExtHost, "ports">>({
    ports: partial<ExtHost["ports"]>({
      get: partial<ExtHost["ports"]["get"]>((key: { readonly name: string }) => {
        if (key.name === ProcessServiceName) return services.process;
        if (key.name === SandboxServiceName) return services.sandbox;
        return undefined;
      }),
    }),
  });
}

/** PATH에서 찾는 resolveBinary. 버전은 시험이 보지 않으므로 고정 문자열이다 */
function resolveOnPath(name: BinaryName): Promise<Result<ResolvedBinary, BinaryError>> {
  const found = Bun.which(name);
  return Promise.resolve(
    found === null
      ? err({ kind: "not_found", name, searched: [], hint: "" })
      : ok({ name, path: found, version: "99.0.0", source: "system" }),
  );
}

interface Box {
  readonly root: string;
  /** `protectedPaths.extra`로 보호한 디렉터리. 안에 secret.txt가 있다 */
  readonly vault: string;
  /** 서버의 작업 폴더(cwd). 정책의 쓰기 루트다 */
  readonly workspace: string;
  /** 정책 쓰기 루트 밖의 디렉터리 */
  readonly outside: string;
  /** 임시 루트. 정책의 쓰기 루트다 */
  readonly tmp: string;
  readonly scheduler: SystemScheduler;
  readonly service: SandboxServiceHandle;
}

/** 실제 srt 서비스를 만든다. 보호 경로와 차단 도메인은 `settings`가 정한다 */
async function createService(
  dirs: OsDirs,
  settings: SandboxSettings,
  scheduler: SystemScheduler,
): Promise<SandboxServiceHandle> {
  return createSandboxService(
    {
      os: {
        dirs,
        time: { clock: systemClock(), scheduler, random: systemRandom() },
        logger: () => LOGGER,
        resolveBinary: (name) => resolveOnPath(name),
      },
      settings: () => settings,
    },
    new AbortController().signal,
  );
}

/** 임시 디렉터리와 서비스를 만든다. 차단 도메인으로 루프백을 넣어 프록시 거부를 본다 */
async function openBox(): Promise<Box> {
  const root = realpathSync(mkdtempSync(join(DISK_TMP, "xeon-mcp-sandbox-")));
  const dirs = {
    home: join(root, "home"),
    data: join(root, "data"),
    config: join(root, "config"),
    cache: join(root, "cache"),
    state: join(root, "state"),
    runtime: join(root, "run"),
    resource: join(root, "resource"),
    tmp: join(root, "tmp"),
  };
  const vault = join(root, "vault");
  const workspace = join(root, "workspace");
  const outside = join(root, "outside");
  for (const dir of [...Object.values(dirs), vault, workspace, outside]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(vault, "secret.txt"), VAULT_SECRET);
  const scheduler = systemScheduler();
  const settings: SandboxSettings = {
    ...readSandboxSettings(() => undefined),
    protectedPathsExtra: [vault],
    blockedDomains: [BLOCKED_HOST],
  };
  // srt는 프로세스 전역 싱글턴이고 `initialize`는 이미 켜져 있으면 설정을 무시한다. 같은 `bun test` 프로세스에서 먼저 돈 시험이
  // `dispose` 없이 남긴 서비스가 있으면 이 시험의 보호 경로와 쓰기 루트가 적용되지 않는다(확인: 남은 서비스 뒤의 실행이 쓰기와 프록시에서 어긋난다).
  // 그래서 서비스를 하나 만들어 끄고(끌 때 srt를 reset한다) 나서 시험 서비스를 만든다.
  const warmup = await createService(dirs, settings, scheduler);
  await warmup.dispose();
  const service = await createService(dirs, settings, scheduler);
  return { root, vault, workspace, outside, tmp: dirs.tmp, scheduler, service };
}

async function closeBox(box: Box): Promise<void> {
  await box.service.dispose();
  box.scheduler.dispose();
  rmSync(box.root, { recursive: true, force: true });
}

/** 상태가 쓸 수 있으면 참. 필수 바이너리가 없으면 서비스를 만들지 않는다 */
async function sandboxRunnable(): Promise<{ readonly runnable: boolean; readonly reason: string }> {
  const missing = REQUIRED_BINARIES.filter((name) => Bun.which(name) === null);
  if (missing.length > 0) return { runnable: false, reason: `missing ${missing.join(", ")}` };
  const box = await openBox();
  try {
    const status = box.service.status();
    return {
      runnable: status.available,
      reason: status.reason ?? "the sandbox service is not available",
    };
  } finally {
    await closeBox(box);
  }
}

const environment = await sandboxRunnable();
const runnable = environment.runnable;
if (!runnable) {
  if (Bun.env["XEON_REQUIRE_SANDBOX"] === "1" || Bun.env["CI"] === "true") {
    process.stderr.write(`ENV mcp-sandbox.int: ${environment.reason}\n`);
    process.exit(ENVIRONMENT_EXIT_CODE);
  }
  process.stderr.write("SKIPPED mcp-sandbox.int: sandbox not runnable here\n");
}
const suite = runnable ? describe : describe.skip;

/** 서버 대역의 표준 출력에서 첫 줄을 받는다 */
function firstLine(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    const onData = (chunk: string | Uint8Array): void => {
      text += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      const end = text.indexOf("\n");
      if (end === -1) return;
      stream.off("data", onData);
      resolve(text.slice(0, end));
    };
    stream.on("data", onData);
    stream.once("end", () => {
      reject(new Error("stdout closed before the probe line"));
    });
  });
}

/** 루프백 서버. 연결이 올 때마다 기록하고 200 응답을 준다 */
function listenLoopback(): { readonly port: number; readonly seen: string[]; stop(): void } {
  const seen: string[] = [];
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        seen.push("open");
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        socket.end();
      },
      data() {},
    },
  });
  return { port: listener.port, seen, stop: () => listener.stop(true) };
}

/** 대역의 연결이 기록될 시간을 준다. 프로브가 줄을 쓴 뒤 연결은 이미 끝났다 */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
}

/** 같은 서버를 `sandbox` 요청대로 띄워 프로브 줄을 받는다 */
async function runProbe(box: Box, loopbackPort: number, sandbox: boolean): Promise<unknown> {
  const background = createBackgroundRegistry({
    clock: systemClock(),
    scheduler: box.scheduler,
    ids: createLocalIdFactory(systemClock(), systemRandom()),
    logger: LOGGER,
  });
  const port = createHostMcpProcessPort({
    ext: extWith({
      process: partial<ProcessService>({ background }),
      sandbox: box.service,
    }),
    secrets: partial<SecretService>({}),
    tempDir: box.tmp,
    scheduler: box.scheduler,
    parentEnv: { PATH: Bun.env["PATH"], HOME: Bun.env["HOME"] },
    logger: LOGGER,
  });
  if (port === undefined) throw new Error("expected a port");
  const spawned = await port.spawn(
    {
      command: process.execPath,
      args: [
        PROBE,
        join(box.vault, "secret.txt"),
        join(box.outside, "written.txt"),
        String(loopbackPort),
      ],
      cwd: box.workspace,
      secretEnv: {},
      sandbox,
      label: "mcp sandbox probe",
      server: "probe",
    },
    new AbortController().signal,
  );
  if (!spawned.ok) throw new Error(`spawn failed: ${spawned.error.kind}`);
  try {
    const parsed = parseJson(await firstLine(spawned.value.stdout));
    if (!parsed.ok) throw new Error("the probe line is not JSON");
    return parsed.value;
  } finally {
    spawned.value.stdin.end();
    await spawned.value.exited;
    await background.close({ graceMs: 100 });
  }
}

suite("stdio MCP server under the real sandbox (srt, bwrap)", () => {
  // scripts/test-preload.ts(apps/host bunfig)는 TMPDIR을 /dev/shm 아래로 옮긴다. bwrap 안에서는 /dev/shm이 보이지 않아 프록시 소켓과
  // 작업 폴더가 닿지 않는다(확인: cwd가 홈으로 떨어지고 프록시 연결이 000). 이 파일의 시험만 디스크 임시 디렉터리를 쓴다
  let previousTmpdir: string | undefined;
  beforeAll(() => {
    previousTmpdir = Bun.env["TMPDIR"];
    Bun.env["TMPDIR"] = DISK_TMP;
  });
  afterAll(() => {
    if (previousTmpdir === undefined) delete Bun.env["TMPDIR"];
    else Bun.env["TMPDIR"] = previousTmpdir;
  });

  test(
    "a sandboxed server cannot read the vault, write outside its folder, or reach a blocked domain",
    async () => {
      const box = await openBox();
      const loopback = listenLoopback();
      try {
        const outcome = await runProbe(box, loopback.port, true);
        await settle();
        expect(outcome).toEqual({
          read: "denied",
          write: "denied",
          write_inside: "ok",
          net: "403",
          net_direct: "denied",
        });
        expect(existsSync(join(box.outside, "written.txt"))).toBe(false);
        expect(loopback.seen).toEqual([]);
      } finally {
        loopback.stop();
        await closeBox(box);
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a sandboxed server can still write inside its working folder (the policy is not deny-all)",
    async () => {
      const box = await openBox();
      const loopback = listenLoopback();
      try {
        const outcome = await runProbe(box, loopback.port, true);
        // 같은 실행에서 밖 쓰기는 막힌다. 격리가 빠졌다면 밖 쓰기도 되므로 이 검사가 실패한다
        expect(outcome).toMatchObject({ write: "denied", write_inside: "ok" });
        expect(existsSync(join(box.workspace, "inside.txt"))).toBe(true);
      } finally {
        loopback.stop();
        await closeBox(box);
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the same server without the sandbox reads, writes and connects (control)",
    async () => {
      const box = await openBox();
      const loopback = listenLoopback();
      try {
        const outcome = await runProbe(box, loopback.port, false);
        await settle();
        expect(outcome).toEqual({
          read: "ok",
          write: "ok",
          write_inside: "ok",
          net: "200",
          net_direct: "connected",
        });
        expect(existsSync(join(box.outside, "written.txt"))).toBe(true);
        expect(loopback.seen.length).toBeGreaterThan(0);
      } finally {
        loopback.stop();
        await closeBox(box);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
