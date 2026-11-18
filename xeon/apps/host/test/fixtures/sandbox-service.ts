import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Logger, type Result } from "@fresnel/contracts";
import type { BinaryError, BinaryName, OsDirs, ResolvedBinary } from "@fresnel/contracts/services";
import {
  createSandboxService,
  readSandboxSettings,
  type SandboxServiceHandle,
} from "@fresnel/platform-sandbox";
import {
  systemClock,
  systemRandom,
  systemScheduler,
  type SystemScheduler,
} from "@fresnel/platform-os";

// 실제 샌드박스(srt)를 여는 시험 도우미. `mcp-sandbox.int.test.ts`와 `migration-scan-isolated.int.test.ts`, 가져오기 wire 시험이 쓴다.
// srt는 프로세스 전역 싱글턴이라 서비스를 만들기 전에 먼저 만든 것을 한 번 끄고(끌 때 srt를 초기화한다) 나서 만든다.
// 샌드박스를 쓸 수 없으면 격리를 쓰는 시험은 건너뛴다. `FRESNEL_REQUIRE_SANDBOX=1` 또는 CI이면 종료 코드 2(환경 문제)로 끝난다.

const ENVIRONMENT_EXIT_CODE = 2;

const SANDBOX_LOGGER: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => SANDBOX_LOGGER,
};

export interface OpenedSandbox {
  readonly service: SandboxServiceHandle;
  readonly scheduler: SystemScheduler;
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

/** 서비스 디렉터리를 `root` 아래에 만들고 실제 서비스를 연다(시험이 `root`를 지운다) */
export async function openSandboxService(root: string): Promise<OpenedSandbox> {
  const dirs: OsDirs = {
    home: join(root, "os-home"),
    data: join(root, "os-data"),
    config: join(root, "os-config"),
    cache: join(root, "os-cache"),
    state: join(root, "os-state"),
    runtime: join(root, "os-run"),
    resource: join(root, "os-resource"),
    tmp: join(root, "os-tmp"),
  };
  for (const dir of [
    dirs.home,
    dirs.data,
    dirs.config,
    dirs.cache,
    dirs.state,
    dirs.runtime,
    dirs.resource,
    dirs.tmp,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  const scheduler = systemScheduler();
  const settings = readSandboxSettings(() => undefined);
  const create = (): Promise<SandboxServiceHandle> =>
    createSandboxService(
      {
        os: {
          dirs,
          time: { clock: systemClock(), scheduler, random: systemRandom() },
          logger: () => SANDBOX_LOGGER,
          resolveBinary: (name) => resolveOnPath(name),
        },
        settings: () => settings,
      },
      new AbortController().signal,
    );
  const warmup = await create();
  await warmup.dispose();
  return { service: await create(), scheduler };
}

export async function closeSandboxService(opened: OpenedSandbox): Promise<void> {
  await opened.service.dispose();
  opened.scheduler.dispose();
}

export interface SandboxGate {
  readonly runnable: boolean;
  readonly reason: string;
}

/** 샌드박스 서비스가 쓸 수 있는지 한 번 본다. 임시 폴더는 만들고 지운다 */
export async function sandboxGate(tmpRoot: string): Promise<SandboxGate> {
  const root = join(tmpRoot, `fresnel-sandbox-gate-${process.pid}`);
  mkdirSync(root, { recursive: true });
  const opened = await openSandboxService(root);
  try {
    const status = opened.service.status();
    return {
      runnable: status.available,
      reason: status.reason ?? "the sandbox service is not available",
    };
  } finally {
    await closeSandboxService(opened);
  }
}

/**
 * 샌드박스를 쓸 수 없으면 격리 시험을 건너뛴다고 stderr에 한 줄 남긴다. 요구되는 환경(`FRESNEL_REQUIRE_SANDBOX=1`, CI)이면
 * 종료 코드 2로 끝난다. 쓸 수 있으면 아무것도 하지 않는다
 */
export function requireSandboxOrSkip(gate: SandboxGate, label: string): void {
  if (gate.runnable) return;
  if (Bun.env["FRESNEL_REQUIRE_SANDBOX"] === "1" || Bun.env["CI"] === "true") {
    process.stderr.write(`ENV ${label}: ${gate.reason}\n`);
    process.exit(ENVIRONMENT_EXIT_CODE);
  }
  process.stderr.write(`SKIPPED ${label}: sandbox not runnable here\n`);
}
