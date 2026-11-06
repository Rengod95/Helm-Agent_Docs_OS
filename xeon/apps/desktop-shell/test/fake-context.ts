// 시험용 ShellContext. 명령은 실제 등록부(commands.ts)로 돌려서 main.ts와 같은 거절 규칙을 본다.
import { createCommandRegistry, type ShellReply } from "../src/main/commands.ts";
import type { IpcCaller, ShellContext } from "../src/main/context.ts";

/** 시험용 발신자. commands.test.ts와 같다 */
const caller: IpcCaller = { sender: Object.create(null) };

export interface FakeContext {
  readonly ctx: ShellContext;
  /** 등록된 명령을 부른다. 없는 명령과 거절은 main.ts와 같은 값이 된다 */
  dispatch(command: string, args: unknown): Promise<ShellReply>;
  /** showMainWindow를 부른 횟수 */
  readonly shown: { count: number };
  /** emit된 이벤트 이름을 부른 순서대로 */
  readonly emitted: string[];
  /** onQuit으로 등록된 정리 함수를 등록 순서대로 */
  readonly cleanups: (() => void | Promise<void>)[];
}

export function createFakeContext(): FakeContext {
  const registry = createCommandRegistry();
  const shown = { count: 0 };
  const emitted: string[] = [];
  const cleanups: (() => void | Promise<void>)[] = [];
  const ctx: ShellContext = {
    env: {},
    platform: "darwin",
    paths: { userData: "", configDir: "", logs: "", resources: "", ui: "" },
    dialogs: {
      openFolder: () => Promise.resolve(null),
      openFile: () => Promise.resolve(null),
      saveFile: () => Promise.resolve(null),
    },
    openExternal: () => Promise.resolve(),
    handle: (command, handler) => {
      registry.handle(command, handler);
    },
    channel: () => null,
    emit: (name) => {
      emitted.push(name);
    },
    showMainWindow: () => {
      shown.count += 1;
    },
    onQuit: (cleanup) => {
      cleanups.push(cleanup);
    },
    handleScheme: () => {},
    windows: () => [],
    windowOptions: () => {},
    onWindow: () => {},
  };
  return {
    ctx,
    dispatch: (command, args) => registry.dispatch(caller, command, args),
    shown,
    emitted,
    cleanups,
  };
}
