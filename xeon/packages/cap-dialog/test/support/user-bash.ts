// `LoopService.runUserBash`의 시험용 얇은 껍데기. core-loop의 `runUserBash`는 아직 오류 값을 돌려주는 자리표시라(F.8, L1.loop 작업)
// 그 아래 실제 경로를 확인할 수 없다. 이 껍데기는 loop가 할 일 가운데 turn 문맥 만들기와 결과 옮기기만 하고, 정책 평가, `tool.call.before` 지점,
// 효과 3단 기록, 도구 실행은 core-tools의 실제 `ToolService.runUserShell`이 한다. 셸 능력(`workspace.shell`)만 대역 프로브다.
import { Bug, ok } from "@xeon/contracts";
import { WorkspaceShell, WorkspaceShellKey, type CallOptions } from "@xeon/contracts/capabilities";
import type { ScopeStack } from "@xeon/contracts/settings";
import type { LoopService, UserBashOutcome } from "@xeon/contracts/services";
import {
  fakeRunContext,
  fakeSession,
  realTools,
  sequentialIds,
  type FakeSession,
  type RealTools,
} from "@xeon/core-tools/testing";

const NOW = 1_767_571_200_000;

export interface RealUserBash {
  readonly loop: Pick<LoopService, "runUserBash">;
  readonly session: FakeSession;
  readonly l1: RealTools;
  /** 셸 능력이 받은 명령 */
  readonly commands: string[];
  /** 다음 실행의 출력과 종료 코드 */
  reply(output: string, exitCode?: number): void;
  setLayers(layers: ScopeStack): void;
}

function commandOf(input: unknown): string {
  if (typeof input === "object" && input !== null && "command" in input) {
    return typeof input.command === "string" ? input.command : "";
  }
  return "";
}

export async function realUserBash(): Promise<RealUserBash> {
  const ids = sequentialIds(11_000);
  const clock = { now: () => NOW };
  const session = fakeSession({ clock, ids });
  const apis = new Map<string, unknown>();
  let layers: ScopeStack = [];
  const l1 = await realTools({
    session,
    clock,
    ids,
    layers: () => layers,
    resolveCapability: (key) => apis.get(key.capability),
  });
  const commands: string[] = [];
  let output = "";
  let exitCode = 0;
  apis.set(WorkspaceShell.id, {
    run: (input: unknown, _options?: CallOptions) => {
      commands.push(commandOf(input));
      return Promise.resolve({
        exitCode,
        output,
        truncated: false,
        durationMs: 1,
        sandboxed: false,
      });
    },
  });
  const registered = l1.tools.register({
    kind: "capability",
    def: WorkspaceShell,
    key: WorkspaceShellKey,
  });
  if (!registered.ok)
    throw new Bug("user bash: bash registration failed", { cause: registered.error });
  const loop: Pick<LoopService, "runUserBash"> = {
    async runUserBash(request) {
      await l1.openThread(request.threadId);
      const run = fakeRunContext({
        session,
        ids,
        threadId: request.threadId,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      const before = commands.length;
      const record = await l1.tools.runUserShell(
        { command: request.command, includeInContext: !request.excludeFromContext },
        run,
      );
      const text = record.content.map((part) => (part.type === "text" ? part.text : "")).join("");
      // 실행 전에 막힌 호출(정책 deny, tool_call 지점의 거부, 도구 없음)은 `details.code`나 거부 사유만 있고 도구가 돌지 않았다
      const notRun = record.isError && commands.length === before;
      const outcome: UserBashOutcome = notRun
        ? { status: "denied", reason: text }
        : {
            status: "completed",
            replaced: false,
            result: {
              output: text,
              exitCode: record.isError ? exitCode || 1 : 0,
              cancelled: false,
              truncated: false,
            },
          };
      return ok(outcome);
    },
  };
  return {
    loop,
    session,
    l1,
    commands,
    reply(nextOutput, nextExit = 0) {
      output = nextOutput;
      exitCode = nextExit;
    },
    setLayers(next) {
      layers = next;
    },
  };
}
