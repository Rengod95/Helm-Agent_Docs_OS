#!/usr/bin/env bun
// 브라우저 E2E(`just web-e2e`, L4.remote.spec §12)용 서비스 실행기. 실제 엔진과 서비스 소켓을 세우되 모델만 테이프(가짜 제공자)다.
// 실제 키와 실제 홈은 쓰지 않는다: `FRESNEL_HOME`(임시 폴더, 절대 경로)과 `--runtime-dir`(짧은 임시 폴더)가 꼭 있어야 한다.
//
// 사용: FRESNEL_HOME=<abs> bun scripts/web-e2e/service.ts --runtime-dir <abs>
// 표준 출력: 시작하면 한 줄 {"event":"ready","socketPath":"..."}. 표준 입력이 끝나거나 `stop` 줄이 오면 서비스를 내리고 종료코드 0.
// 종료코드: 0 정상, 1 서비스가 서지 못함, 2 사용법·환경 문제.
// 테이프 차례(모델 역할 main, 호출 순서대로): 1) 한 줄 답 2) bash 도구 호출(승인 필요) 3) 도구 결과 뒤 답. 나머지는 넘겨도 된다(allowLeftover).
import { isAbsolute, join } from "node:path";
import {
  t,
  tape,
  tapeBuildModels,
  tapePlayer,
  tapeProvider,
} from "../../packages/core-models/src/testing/index.ts";
import { startService } from "../../apps/host/src/index.ts";

export const REPLY_TEXT = "tape-reply: hello from the fake model";
export const APPROVAL_COMMAND = "echo web-e2e-approved";
export const FINAL_TEXT = "tape-final: the command finished";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function usage(message: string): never {
  process.stderr.write(`web-e2e/service: ${message}\n`);
  process.exit(2);
}

const home = process.env["FRESNEL_HOME"] ?? "";
const runtimeDir = arg("--runtime-dir") ?? "";
if (!isAbsolute(home)) usage("FRESNEL_HOME must be an absolute temporary folder");
if (!isAbsolute(runtimeDir)) usage("--runtime-dir must be an absolute folder");
if (!home.includes("fresnel-web-e2e-"))
  usage("FRESNEL_HOME must be a fresnel-web-e2e-* temporary folder");

// 설정 파일(테이프 제공자, 파일 키 저장)과 더미 시크릿은 부르는 쪽(`apps/desktop/test/web-e2e/stack.ts`)이 임시 홈에 미리 만든다.

function turn(label: string, content: ReturnType<typeof t.text>[], stopReason: "stop" | "toolUse") {
  return {
    role: "main" as const,
    label,
    response: { type: "message" as const, content, stopReason },
  };
}

const timers = new Map<number, ReturnType<typeof setTimeout>>();
const tapeClock = {
  now: () => Date.now(),
  setTimeout(fn: () => void, ms: number): number {
    const handle = timers.size + 1 + Math.floor(Math.random() * 1e9);
    timers.set(handle, setTimeout(fn, ms));
    return handle;
  },
  clearTimeout(handle: number): void {
    const timer = timers.get(handle);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(handle);
  },
};

const started = await startService({
  runtimeDir,
  handleSignals: true,
  idleGraceMs: 3_600_000,
  assemble: {
    buildModels: tapeBuildModels(
      tapeProvider(
        tapePlayer(
          tape(
            "web-e2e",
            [
              turn("plain reply", [t.text(REPLY_TEXT)], "stop"),
              // 첫 turn 뒤에 엔진이 모델을 한 번 더 부른다(같은 main 큐에서 꺼낸다). 그 호출이 승인 turn을 가져가지 않게 자리를 비워 둔다
              turn("follow-up call after the first turn", [t.text("web e2e")], "stop"),
              {
                role: "main" as const,
                label: "asks to run a command",
                response: {
                  type: "message" as const,
                  content: [t.toolCall("bash", { command: APPROVAL_COMMAND }, "call_1")],
                  stopReason: "toolUse" as const,
                },
              },
              turn("final", [t.text(FINAL_TEXT)], "stop"),
            ],
            { allowLeftover: true },
          ),
          { clock: tapeClock },
        ),
      ),
    ),
  },
});
if (!started.started) {
  process.stderr.write(
    `web-e2e/service: the service did not start: ${started.reason === "failed" ? started.message : started.reason}\n`,
  );
  process.exit(started.reason === "in_use" ? 2 : 1);
}
const handle = started.handle;
process.stdout.write(
  `${JSON.stringify({ event: "ready", socketPath: join(runtimeDir, "fresnel.sock") })}\n`,
);

async function stop(): Promise<never> {
  await handle.shutdown("stop");
  process.exit(0);
}
handle.exited.then(
  () => process.exit(0),
  () => process.exit(1),
);
// 표준 입력에 `stop`이 오거나 입력이 끝나면(부모가 죽음) 서비스를 내린다
process.stdin.setEncoding("utf8");
const seen = { text: "" };
process.stdin.on("data", (chunk) => {
  seen.text += String(chunk);
  if (seen.text.includes("stop")) stop().catch(() => process.exit(1));
});
process.stdin.on("end", () => {
  stop().catch(() => process.exit(1));
});
