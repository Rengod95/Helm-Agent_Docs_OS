// 훑기 자식의 띄우기 대역. `IsolationProcessPort.spawn`을 흉내 낸다: 표준 입력에 쓴 요청 줄을 받고, 표준 출력에 줄을 쓰고, 끝나면 종료를 알린다.
// 기본 행동은 실제 자식 본체(`runMigrationScanStdio`)를 같은 프로세스에서 돌리는 것이다. 실패 시험은 행동을 바꿔 끼운다.
// 실제 격리(샌드박스 아래의 자식 프로세스)는 `test/int/migration-scan-isolated.int.test.ts`가 본다.
import { PassThrough, Writable } from "node:stream";
import { detach, type Result } from "@fresnel/contracts";
import type {
  IsolatedChild,
  IsolationProcessPort,
  IsolationSpawnError,
  IsolationSpawnSpec,
} from "@fresnel/contracts/extensions";
import type { SandboxService, SandboxStatus } from "@fresnel/contracts/services";
import type { MigrationScanSource } from "../../../src/assembly/plugins/migration-scan-child.ts";
import { runMigrationScanStdio } from "../../../src/migration-scan/run.ts";
import { partial } from "../../fixtures/unsafe.ts";
import { createManualScheduler, type ManualScheduler } from "../../fixtures/manual-scheduler.ts";

/** 자식 하나가 하는 일의 도구. 행동은 요청 줄을 받은 뒤 이것으로 답한다 */
export interface ChildContext {
  /** 엔진이 표준 입력에 쓴 전체 텍스트(요청 줄 하나) */
  readonly request: string;
  /** 표준 출력에 텍스트를 쓴다. 끝난 뒤에는 아무 일도 없다 */
  write(text: string): void;
  /** 표준 출력을 닫고 종료를 알린다. 두 번째 호출은 무시한다 */
  exit(code: number | null, signal: string | null): void;
}

type ChildBehavior = (child: ChildContext) => void;

/** 실제 자식 본체를 같은 프로세스에서 돌린다. 줄은 자식이 쓴 그대로 엔진에 간다 */
const runsRealChild: ChildBehavior = (child) => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stdin = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(child.request));
      controller.close();
    },
  });
  const stdout = new WritableStream<Uint8Array>({
    write(chunk) {
      child.write(decoder.decode(chunk));
    },
  });
  const stderr = new WritableStream<Uint8Array>();
  detach(
    runMigrationScanStdio({ stdin, stdout, stderr }).then((code) => child.exit(code, null)),
    () => {
      child.exit(1, null);
    },
  );
};

interface SpawnRecord {
  readonly spec: IsolationSpawnSpec;
  /** 엔진이 죽이라고 부른 신호들 */
  readonly kills: string[];
}

export interface FakeScanSource {
  readonly source: MigrationScanSource;
  readonly spawns: SpawnRecord[];
  /** 기한 시험이 시간을 흘리는 스케줄러. 기본은 흘리지 않는 수동 스케줄러다 */
  readonly scheduler: ManualScheduler;
}

export interface FakeScanOptions {
  /** 자식의 행동. 기본은 실제 자식 본체다 */
  readonly behavior?: ChildBehavior;
  /** 샌드박스 상태. `missing`은 서비스가 없는 것이다. 기본은 쓸 수 있는 상태다 */
  readonly sandbox?: "available" | "unavailable" | "missing";
  /** 띄우기 포트가 없으면 `false`다. 기본은 있다 */
  readonly withPort?: boolean;
  /** 띄우기 자체가 실패하는 사유. 있으면 자식을 만들지 않는다 */
  readonly spawnError?: IsolationSpawnError;
}

/** 띄우기 대역과 샌드박스 대역을 만든다. 자기 실행 값은 가짜 경로다(대역은 그것을 읽지 않는다) */
export function fakeScanSource(options: FakeScanOptions = {}): FakeScanSource {
  const behavior = options.behavior ?? runsRealChild;
  const spawns: SpawnRecord[] = [];
  const scheduler = createManualScheduler();
  const port: IsolationProcessPort = {
    spawn(spec: IsolationSpawnSpec): Promise<Result<IsolatedChild, IsolationSpawnError>> {
      if (options.spawnError !== undefined)
        return Promise.resolve({ ok: false, error: options.spawnError });
      const kills: string[] = [];
      spawns.push({ spec, kills });
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const exited = Promise.withResolvers<{
        readonly code: number | null;
        readonly signal: string | null;
      }>();
      const received: string[] = [];
      const decoder = new TextDecoder();
      let closed = false;
      const exit = (code: number | null, signal: string | null): void => {
        if (closed) return;
        closed = true;
        stdout.end();
        stderr.end();
        exited.resolve({ code, signal });
      };
      const context: ChildContext = {
        request: "",
        write(text) {
          if (!closed) stdout.write(text);
        },
        exit,
      };
      const stdin = new Writable({
        decodeStrings: false,
        write(chunk: unknown, _encoding, callback) {
          if (typeof chunk === "string") received.push(chunk);
          else if (chunk instanceof Uint8Array) received.push(decoder.decode(chunk));
          callback();
        },
        final(callback) {
          callback();
          behavior({ ...context, request: received.join("") });
        },
      });
      const child: IsolatedChild = {
        pid: 4242,
        stdin,
        stdout,
        stderr,
        exited: exited.promise,
        kill(signal) {
          kills.push(signal);
          exit(null, signal);
        },
      };
      return Promise.resolve({ ok: true, value: child });
    },
  };
  const sandboxState = options.sandbox ?? "available";
  const sandbox: Pick<SandboxService, "status"> | undefined =
    sandboxState === "missing"
      ? undefined
      : {
          status: (): SandboxStatus =>
            partial<SandboxStatus>(
              sandboxState === "available"
                ? { available: true, level: "srt" }
                : { available: false, level: "none", reason: "disabled" },
            ),
        };
  const source: MigrationScanSource = {
    process: () => (options.withPort === false ? undefined : port),
    sandbox: () => sandbox,
    self: { execPath: "/usr/bin/false", entry: "/fake/main.ts" },
    scheduler,
  };
  return { source, spawns, scheduler };
}
