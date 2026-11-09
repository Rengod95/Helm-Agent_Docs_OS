// 웹 게이트웨이(W2)의 실행 진입점: `bun run apps/desktop-shell/src/web/main.ts --socket <서비스 소켓> --state-dir <상태 폴더> [옵션]`.
// 서비스의 Unix 소켓에 붙고, 루프백 HTTP(기본 127.0.0.1:8480)와 선택한 외부 HTTPS를 연다. 인자와 시작 순서는 `src/web/main/`이 맡는다.
//
// 종료코드: 0 정상 종료(`stop` 명령, 표준 입력 끝, SIGTERM·SIGINT), 2 사용법이나 환경 문제(소켓, 상태 폴더, UI, 인증서, 포트 사용 중),
// 1 예상하지 못한 오류.
//
// 표준 출력은 제어 프로토콜의 JSON 줄만 쓴다. 표준 오류는 운영 로그(JSON 줄)와 시작 실패 한 줄이다. 토큰, 세션 값, 시크릿은 어디에도 나오지 않는다.
//
// 시작에 성공하면 첫 줄:
//   {"event":"ready","loopbackPort":N|null,"tlsPort":N|null,"fingerprint":"<소문자 16진>"|null,"pid":N}
// 표준 입력은 명령 한 줄에 JSON 객체 하나다. 답은 이벤트 줄이다(요청이 있을 때만 쓴다):
//   {"cmd":"pair"}                  → {"event":"pairing-code","code":"ABCDE-12345","expiresAt":ms}
//                                     (페어링 코드가 나오는 유일한 곳이다. 요청할 때만 낸다)
//   {"cmd":"status"}                → {"event":"status","pairing":{active,expiresAt,lockedUntil},"devices":[...],
//                                       "loopbackPort":N|null,"tlsPort":N|null,"fingerprint":"..."|null}
//   {"cmd":"devices"}               → {"event":"devices","devices":[...]}
//   {"cmd":"revoke","id":"dev_..."} → {"event":"revoked","count":1} 또는 {"event":"error","error":"not_found"}
//   {"cmd":"revoke-all"}            → {"event":"revoked","count":N}
//   {"cmd":"stop"}                  → {"event":"stopped"}, 이어서 종료코드 0
// 기기 항목은 {id,name,kind,createdAt,lastSeenAt,lastAddress}다.
// 해석할 수 없는 줄이나 모르는 명령은 {"event":"error","error":"bad_command"}을 내고 계속한다.
// 표준 입력이 끝나면(감독하는 서비스가 죽었다) 정상 종료한다. 폐기는 `auth.revokeDevice`로 하므로 열린 연결은 게이트웨이가 닫고 푸시 구독은 지운다.
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { attemptAsync, detach, type Logger } from "@fresnel/contracts";
import { createWebApp, type WebApp } from "./main/app.ts";
import { parseArgs, USAGE_TEXT } from "./main/args.ts";
import { controlHandler, type ControlEvent, type ControlReply } from "./main/control.ts";
import { describeError } from "./main/errors.ts";
import { createStderrLogger } from "./main/log.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 빌드된 UI 번들 폴더(데스크톱 화면과 같다). `--ui`로 바꾼다 */
const DEFAULT_UI_DIR = path.resolve(HERE, "../../../desktop/dist/ui");
/** 로그인 화면 파일 폴더 */
const STATIC_DIR = path.resolve(HERE, "static");
/** 사이드카 찾기의 기준 폴더(데스크톱 셸 패키지 폴더) */
const RESOURCES_DIR = path.resolve(HERE, "../..");

interface ReadyEvent {
  readonly event: "ready";
  readonly loopbackPort: number | null;
  readonly tlsPort: number | null;
  readonly fingerprint: string | null;
  readonly pid: number;
}

type OutEvent = ControlEvent | ReadyEvent | { readonly event: "stopped" };

function emit(event: OutEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

/** 두 표준 출력이 다 비워진 뒤에 끝낸다(파이프에 쓴 줄이 잘리지 않도록) */
function exitWith(code: number): void {
  let pending = 2;
  const done = (): void => {
    pending -= 1;
    if (pending === 0) process.exit(code);
  };
  process.stdout.write("", done);
  process.stderr.write("", done);
}

/** 게이트웨이를 멈추고 `stopped` 줄을 낸다. 멈추지 못하면 종료코드 1이다 */
async function shutDown(app: WebApp, logger: Logger): Promise<number> {
  const stopped = await attemptAsync(() => app.stop());
  if (!stopped.ok) {
    logger.error("web.stop_failed", { reason: reasonOf(stopped.error.cause) });
    return 1;
  }
  emit({ event: "stopped" });
  return 0;
}

/** 표준 입력의 명령을 읽는다. 멈추면(명령, 입력 끝, 신호) 게이트웨이를 끄고 0으로 끝난다 */
function serveControl(
  app: WebApp,
  handle: (line: string) => ControlReply,
  logger: Logger,
): Promise<number> {
  return new Promise((resolve) => {
    const input = createInterface({ input: process.stdin });
    const state = { stopping: false };
    const stop = (): void => {
      if (state.stopping) return;
      state.stopping = true;
      input.close();
      detach(shutDown(app, logger).then(resolve), (caught) => {
        logger.error("web.stop_failed", { reason: reasonOf(caught) });
        resolve(1);
      });
    };
    input.on("line", (line) => {
      if (state.stopping) return;
      const reply = handle(line);
      for (const event of reply.events) emit(event);
      if (reply.stop) stop();
    });
    input.on("close", stop);
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  });
}

function reasonOf(caught: unknown): string {
  return caught instanceof Error ? caught.name : "non_error";
}

async function run(argv: readonly string[]): Promise<number> {
  const logger = createStderrLogger({
    write: (line) => {
      process.stderr.write(line);
    },
    now: () => Date.now(),
  });
  const parsed = parseArgs(argv, { uiDir: DEFAULT_UI_DIR });
  if (!parsed.ok) {
    process.stderr.write(`error: ${parsed.error.message}\n\n${USAGE_TEXT}`);
    return 2;
  }
  if (parsed.value.kind === "help") {
    process.stdout.write(USAGE_TEXT);
    return 0;
  }
  const started = await createWebApp({
    options: parsed.value.options,
    staticDir: STATIC_DIR,
    resources: RESOURCES_DIR,
    home: homedir(),
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    clock: { now: () => Date.now() },
    logger,
  });
  if (!started.ok) {
    const described = describeError(started.error);
    process.stderr.write(`error: ${described.message}\n`);
    return described.exitCode;
  }
  const app = started.value;
  const handle = controlHandler({ auth: app.auth, ports: () => app.info });
  emit({
    event: "ready",
    loopbackPort: app.info.loopbackPort,
    tlsPort: app.info.tlsPort,
    fingerprint: app.info.fingerprint,
    pid: process.pid,
  });
  return serveControl(app, handle, logger);
}

// 최상위 await를 쓰지 않는다(`bun build --compile`과 맞춘다). 시험은 이 파일을 가져오지 않고 `main/` 아래 함수를 부른다
if (import.meta.main) {
  detach(run(process.argv.slice(2)).then(exitWith), (caught) => {
    process.stderr.write(`error: unexpected failure (${reasonOf(caught)})\n`);
    exitWith(1);
  });
}
