import {
  assertNever,
  detach,
  err,
  ok,
  parseJson,
  type Logger,
  type Result,
  type Scheduler,
  type TimerHandle,
} from "@fresnel/contracts";
import type {
  IsolatedChild,
  IsolationProcessPort,
  IsolationSpawnSpec,
} from "@fresnel/contracts/extensions";
import type { SandboxService } from "@fresnel/contracts/services";
import {
  decodeScanItem,
  parseScanChildLine,
  type ScanDiagnostic,
  type ScanRoot,
  type SourceItem,
} from "@fresnel/plugin-migration";
import type { MigrationScanFailureReason } from "../../handlers/m5/migration.ts";
import { sourceWorkspaceOf } from "../../plugin-host/launch.ts";
import { selfEntryPrefix, type SelfRunTarget } from "../../self-command.ts";

// 훑기를 엔진 밖의 샌드박스 자식 프로세스에서 돌리는 쪽(migration.md §7.4 [제안], host-service §4.25). 자식은 `migration-scan --stdio`로
// 다시 뜬다(`migration-scan/run.ts`). 띄우기는 기존 `IsolationProcessPort.spawn`이다: 새 격리 방식을 만들지 않는다.
// 엔진은 자식의 줄을 `parseScanChildLine`으로만 받는다. 원본 파일 내용을 엔진이 읽거나 파싱하지 않는다.
// 기한과 응답 상한을 넘으면 자식 트리를 죽이고 값으로 실패한다. 격리를 쓸 수 없으면 띄우지 않는다(`unavailable`).

/** 자식 하나의 기한(ms) [제안]. 넘으면 자식 트리를 죽이고 `timeout`이다 */
export const SCAN_DEADLINE_MS: number = 120_000;

/** 자식의 응답 전체 상한(바이트) [제안]. 넘으면 자식을 죽이고 `bad_reply`다 */
export const SCAN_REPLY_MAX_BYTES: number = 64 * 1024 * 1024;

const ENCODER: TextEncoder = new TextEncoder();

/** 자식을 띄우는 원천. 모두 지연 조회다: 샌드박스와 띄우기 포트는 엔진 조립 뒤에 올라온다 */
export interface MigrationScanSource {
  /** 띄우기 포트(`fresnel.process`). 플랫폼 프로세스가 없으면 undefined다 */
  readonly process: () => IsolationProcessPort | undefined;
  /** 샌드박스 서비스. 격리를 쓸 수 없으면(`status().available`이 거짓) 훑지 않는다 */
  readonly sandbox: () => Pick<SandboxService, "status"> | undefined;
  /** 이 실행 파일. 소스 실행이면 진입 파일을 앞에 붙인다(`selfEntryPrefix`) */
  readonly self: SelfRunTarget;
  readonly scheduler: Scheduler;
}

/** 시험이 기한과 상한을 줄이려고 넘기는 값. 운영은 생략해 위 기본값을 쓴다 */
export interface MigrationScanTuning {
  readonly deadlineMs?: number;
  readonly replyMaxBytes?: number;
}

/** 자식의 끝 응답을 엔진 값으로 옮긴 것. 항목의 바이트는 `Uint8Array`로 되돌렸다 */
interface ScanChildReply {
  readonly limitReached: boolean;
  readonly scanned: readonly string[];
  readonly items: readonly SourceItem[];
  readonly diagnostics: readonly ScanDiagnostic[];
}

export interface ScanRunInput {
  /** 띄우기 라벨(`migration-scan:<scanId>`)과 진행 알림에 쓴다 */
  readonly scanId: string;
  /** 정규 경로로 바뀐 루트. 첫 루트가 자식의 작업 폴더이고 나머지는 읽기 허용 목록에 더한다 */
  readonly roots: readonly ScanRoot[];
  readonly homeDir: string;
  /** 루트 하나가 끝날 때마다 부른다(자식의 진행 줄) */
  readonly onProgress: (done: number, total: number) => void;
}

interface MigrationScanner {
  run(input: ScanRunInput): Promise<Result<ScanChildReply, MigrationScanFailureReason>>;
}

const EMPTY_REPLY: ScanChildReply = {
  limitReached: false,
  scanned: [],
  items: [],
  diagnostics: [],
};

/** 바이트 덩어리. 바이트 배열이 아니면 `undefined`다(엔진 쪽 경계) */
function bytesOf(chunk: unknown): Uint8Array | undefined {
  if (chunk instanceof Uint8Array) return chunk;
  if (typeof chunk === "string") return ENCODER.encode(chunk);
  return undefined;
}

export function createMigrationScanner(
  source: MigrationScanSource,
  log: Logger,
  tuning: MigrationScanTuning = {},
): MigrationScanner {
  const deadlineMs = tuning.deadlineMs ?? SCAN_DEADLINE_MS;
  const replyMaxBytes = tuning.replyMaxBytes ?? SCAN_REPLY_MAX_BYTES;

  /** 자식을 띄운다. 포트가 없거나 격리를 쓸 수 없거나 띄우지 못하면 `unavailable`이다 */
  async function launch(
    input: ScanRunInput,
    first: ScanRoot,
  ): Promise<Result<IsolatedChild, MigrationScanFailureReason>> {
    const port = source.process();
    if (port === undefined) {
      log.warn("migration.scan.unavailable", { reason: "no_process_port" });
      return err("unavailable");
    }
    const sandbox = source.sandbox();
    if (sandbox === undefined) {
      log.warn("migration.scan.unavailable", { reason: "no_sandbox" });
      return err("unavailable");
    }
    const status = sandbox.status();
    if (!status.available) {
      log.warn("migration.scan.unavailable", { reason: status.reason ?? "unknown" });
      return err("unavailable");
    }
    const prefix = selfEntryPrefix(source.self);
    const spec: IsolationSpawnSpec = {
      command: source.self.execPath,
      args: [...prefix, "migration-scan", "--stdio"],
      readRoot: first.path,
      // 나머지 루트는 읽기 허용 목록에 더한다. 소스 실행이면 소스 작업 공간도 읽는다(`pluginHostLaunch`와 같다)
      runtimeReadRoots: [
        ...input.roots.slice(1).map((root) => root.path),
        ...(prefix.length === 0 ? [] : [sourceWorkspaceOf(source.self.entry)]),
      ],
      env: {},
      label: `migration-scan:${input.scanId}`,
    };
    const spawned = await port.spawn(spec);
    if (!spawned.ok) {
      log.warn("migration.scan.unavailable", { reason: spawned.error.kind });
      return err("unavailable");
    }
    return ok(spawned.value);
  }

  /** 자식의 표준 출력을 줄로 읽고 끝 응답을 기다린다. 기한, 응답 상한, 종료를 값으로 판정한다 */
  function drive(
    child: IsolatedChild,
    input: ScanRunInput,
  ): Promise<Result<ScanChildReply, MigrationScanFailureReason>> {
    return new Promise((resolve) => {
      let settled = false;
      let exited = false;
      let received = 0;
      let pending = "";
      const decoder = new TextDecoder("utf-8");

      // 기한은 자식을 띄운 뒤 바로 건다. 끝나면 `finish`가 지운다
      const timer: TimerHandle = source.scheduler.setTimeout(() => {
        finish(err("timeout"));
      }, deadlineMs);

      /** 결과는 한 번만 낸다. 끝나지 않은 자식은 트리째 죽인다 */
      function finish(result: Result<ScanChildReply, MigrationScanFailureReason>): void {
        if (isSettled()) return;
        settled = true;
        source.scheduler.clearTimeout(timer);
        if (!exited) child.kill("SIGKILL");
        resolve(result);
      }

      /** 결과를 냈는가. 함수로 읽어 호출 사이의 좁히기에 기대지 않는다 */
      function isSettled(): boolean {
        return settled;
      }

      function handleLine(text: string): void {
        const json = parseJson(text);
        if (!json.ok) {
          finish(err("bad_reply"));
          return;
        }
        const checked = parseScanChildLine(json.value);
        if (!checked.ok) {
          finish(err("bad_reply"));
          return;
        }
        const line = checked.value;
        switch (line.kind) {
          case "progress":
            input.onProgress(line.done, line.total);
            return;
          case "ok":
            finish(
              ok({
                limitReached: line.limitReached,
                scanned: line.scan.scanned,
                items: line.scan.items.map(decodeScanItem),
                diagnostics: line.scan.diagnostics,
              }),
            );
            return;
          case "error":
            log.error("migration.scan.child_failed", { code: line.code });
            finish(err("crashed"));
            return;
          default:
            return assertNever(line, "ScanChildLine");
        }
      }

      child.stdout.on("data", (chunk: unknown) => {
        if (isSettled()) return;
        const bytes = bytesOf(chunk);
        if (bytes === undefined) {
          finish(err("bad_reply"));
          return;
        }
        received += bytes.byteLength;
        if (received > replyMaxBytes) {
          finish(err("bad_reply"));
          return;
        }
        pending += decoder.decode(bytes, { stream: true });
        for (;;) {
          if (isSettled()) return;
          const end = pending.indexOf("\n");
          if (end === -1) return;
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          handleLine(line);
        }
      });
      child.stdout.on("end", () => {
        if (isSettled()) return;
        const rest = pending + decoder.decode();
        pending = "";
        if (rest.length > 0) handleLine(rest);
      });
      // 표준 오류는 읽어서 버린다. 내용을 기록하지 않는다(원문과 경로가 섞일 수 있다)
      child.stderr.on("data", () => undefined);
      child.stdin.on("error", () => {
        log.warn("migration.scan.stdin_failed", {});
      });

      function onExit({
        code,
        signal,
      }: {
        readonly code: number | null;
        readonly signal: string | null;
      }): void {
        exited = true;
        // 응답 없이 정상 종료했으면 응답이 잘못된 것이고, 아니면 자식이 죽은 것이다
        finish(err(code === 0 && signal === null ? "bad_reply" : "crashed"));
      }
      detach(child.exited.then(onExit), () => {
        finish(err("crashed"));
      });

      const request = {
        roots: input.roots.map((root) => ({
          path: root.path,
          scope: root.scope,
          label: root.label,
        })),
        homeDir: input.homeDir,
      };
      child.stdin.end(`${JSON.stringify(request)}\n`);
    });
  }

  return {
    async run(input) {
      const [first] = input.roots;
      // 훑을 루트가 없으면 자식을 띄우지 않는다
      if (first === undefined) return ok(EMPTY_REPLY);
      const launched = await launch(input, first);
      if (!launched.ok) return err(launched.error);
      return drive(launched.value, input);
    },
  };
}
