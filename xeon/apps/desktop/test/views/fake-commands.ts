import { err, ok } from "@xeon/contracts";
import type { Commands } from "../../src/views/commands.ts";

/** 화면 시험이 쓰는 명령 대역. 기본은 모두 성공하고 신뢰 메서드는 host에 없는 것(unsupported)처럼 답한다 */
export function fakeCommands(overrides: Partial<Commands> = {}): Commands {
  return {
    selectThread: () => {},
    createThread: () => Promise.resolve(ok(null)),
    sendTurn: () => Promise.resolve(ok(null)),
    interrupt: () => Promise.resolve(ok(null)),
    confirmShell: () => Promise.resolve(ok(null)),
    cancelShell: () => {},
    dismissCommandOutput: () => {},
    commandList: () => Promise.resolve(ok([])),
    respondApproval: () => Promise.resolve(),
    trust: {
      status: () => Promise.resolve(err({ kind: "unsupported" })),
      decide: () => Promise.resolve(err({ kind: "unsupported" })),
    },
    setup: {
      load: () => Promise.resolve(err({ kind: "unsupported" })),
      beginKeyEntry: () => Promise.resolve(ok(false)),
      registerKey: () => Promise.resolve(ok(null)),
      connectProviderKey: () => Promise.resolve(ok(null)),
      setDefaultModel: () => Promise.resolve(ok(null)),
      onInvalidated: () => () => {},
    },
    observeThread: () => Promise.resolve(ok(null)),
    forkThread: () => Promise.resolve(ok(null)),
    dismissLocked: () => {},
    retryWrite: () => {},
    showScreen: () => {},
    reloadThreads: () => {},
    retryTranscript: () => {},
    reconnect: () => {},
    restartEngine: () => Promise.resolve(),
    copyDiagnostics: () => Promise.resolve(true),
    ...overrides,
  };
}
