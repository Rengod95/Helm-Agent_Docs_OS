// 탭 하나의 `ShellContext`를 electron 없이 만든다(L4.remote.spec §5.1, §6, §7).
// - 명령은 표(`commands-table.ts`)가 허용한 것만 이 탭의 레지스트리에 든다. 나머지는 등록하지 않아 `unknown-command`로 답한다.
// - 엔진은 `registerEngine`(src/main/engine.ts)으로 붙인다. `relayOf`가 ctx마다 WeakMap이라 탭마다 릴레이와 감독자가 따로 생긴다.
// - 채널과 이벤트는 이 탭의 `send`로 간다. 다른 탭의 표와는 섞이지 않는다.
// - 창, 트레이, 스킴, 대화 상자는 웹에 없다. 정리(`onQuit`)는 탭이 닫힐 때 등록 역순으로 돈다.
import { join } from "node:path";
import { attemptAsync } from "@fresnel/contracts";
import { createCommandRegistry, ShellError, type ShellReply } from "../../main/commands.ts";
import type {
  CommandHandler,
  IpcCaller,
  ShellChannel,
  ShellContext,
  ShellPaths,
} from "../../main/context.ts";
import { createDbToolsModule } from "../../main/db-tools.ts";
import { registerEngine } from "../../main/engine.ts";
import { pipedLauncher, type Launcher } from "../../main/engine/launcher.ts";
import type { EngineConfig } from "../../main/engine/policy.ts";
import type { EngineClock } from "../../main/engine/wait.ts";
import { registerFolderAccess } from "../../main/folder-access.ts";
import { createIntentQueue, type IntentQueue } from "../../main/intents.ts";
import type { AppLog } from "../../main/lib/applog.ts";
import { ownField } from "../../main/lib/narrow.ts";
import {
  createSecretEntry,
  ENTRY_TIMEOUT_MS,
  pipedEntryLauncher,
  planEntryCommand,
  registerSecretEntry,
} from "../../main/secret-entry.ts";
import { createServiceModule } from "../../main/service-mode.ts";
import { viewSchemeModule } from "../../main/view-scheme.ts";
import { CHANNEL_KEY } from "../../shared/channels.ts";
import { dispositionOf, isServedByGateway } from "./commands-table.ts";
import type { ServerFrame } from "./protocol.ts";
import { createSocketLauncher } from "./socket-launcher.ts";

export interface WebContextOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  /** 게이트웨이의 상태 폴더. 로그와 설정 경로의 뿌리다 */
  readonly stateDir: string;
  /** 사이드카를 찾는 폴더(`ctx.paths.resources`와 같다) */
  readonly resources: string;
  /** 사용자 홈 디렉터리(절대 경로) */
  readonly home: string;
  /** 서비스 Unix 소켓의 절대 경로 */
  readonly socketPath: string;
  readonly clock: EngineClock;
  readonly config: EngineConfig;
  readonly log: AppLog;
  /** 이 탭의 연결로 프레임 하나를 보낸다. 연결이 닫혔으면 아무 일도 없어야 한다(tab-session이 맡는다) */
  readonly send: (frame: ServerFrame) => void;
}

export interface WebContext {
  readonly ctx: ShellContext;
  /** 모듈이 `handle`로 요청한 명령 이름 전부. 허용 목록 밖도 든다(표 완전성 시험이 본다) */
  readonly requested: readonly string[];
  /** 이 탭의 레지스트리에 실제로 등록된 명령 이름 */
  readonly served: readonly string[];
  /** 이 탭의 셸 의도 큐(`shell_take_intents`가 비운다). 다른 탭과 섞이지 않는다 */
  readonly intents: IntentQueue;
  /** 명령을 부른다. 탭이 닫힌 뒤에는 `unknown-command`다 */
  dispatch(command: unknown, args: unknown): Promise<ShellReply>;
  /** 브라우저가 `close-channel`로 닫은 채널이다. 닫힌 뒤의 메시지는 버린다 */
  closeChannel(id: number): void;
  /** 탭이 닫힐 때 한 번만 실제로 돈다. 등록된 정리를 등록 역순으로 하나씩 기다린다. 실패는 로그에 한 줄 남긴다 */
  close(): Promise<void>;
}

/** 대화 상자는 웹에 없다. 취소와 같은 `null`을 준다 */
const noDialog = (): Promise<null> => Promise.resolve(null);

/** `{ $channel: n }`의 `n`. 아니면 null이다 */
function channelIdOf(value: unknown): number | null {
  const id = ownField(value, CHANNEL_KEY);
  return typeof id === "number" && Number.isSafeInteger(id) ? id : null;
}

export function createWebContext(options: WebContextOptions): WebContext {
  const registry = createCommandRegistry();
  // 탭마다 발신자 객체가 하나다. folder-access의 핸들 표가 이 객체를 키로 삼으므로 핸들도 탭마다 따로다
  const caller: IpcCaller = { sender: { kind: "web-tab" } };
  const requested: string[] = [];
  const served: string[] = [];
  const cleanups: (() => void | Promise<void>)[] = [];
  const openChannels = new Set<number>();
  const intents = createIntentQueue();
  const state = { closed: false };
  const { clock, log } = options;

  const serve = (command: string, handler: CommandHandler): void => {
    registry.handle(command, handler);
    served.push(command);
  };

  const paths: ShellPaths = {
    userData: options.stateDir,
    configDir: join(options.stateDir, "config"),
    logs: join(options.stateDir, "logs"),
    resources: options.resources,
    ui: "",
  };

  const ctx: ShellContext = {
    env: options.env,
    platform: options.platform,
    paths,
    dialogs: { openFolder: noDialog, openFile: noDialog, saveFile: noDialog },
    openExternal: () => Promise.reject(new ShellError("unsupported-on-web")),
    handle(command: string, handler: CommandHandler) {
      requested.push(command);
      if (dispositionOf(command) === undefined) {
        log.line(`web: command not in the table, not served: ${command}`);
      }
      if (isServedByGateway(command)) serve(command, handler);
    },
    channel(_caller, value): ShellChannel | null {
      const id = channelIdOf(value);
      if (id === null) return null;
      openChannels.add(id);
      return {
        send(message) {
          if (openChannels.has(id)) options.send({ t: "channel", id, message });
        },
      };
    },
    emit(name) {
      options.send({ t: "event", name });
    },
    showMainWindow: () => undefined,
    onQuit(cleanup) {
      // 등록 역순으로 돈다. `close`가 앞에서부터 하나씩 부른다(main.ts의 `quit.unshift`와 같다)
      cleanups.unshift(cleanup);
    },
    handleScheme: () => undefined,
    windows: () => [],
    windowOptions: () => undefined,
    onWindow: () => undefined,
  };

  // 엔진: 서비스 소켓 연결(`socketLauncher`)과 한 번 돌리기(사이드카 CLI)를 합친 launcher다.
  // 한 번 돌리기는 백업, 복원, 서비스 명령이 쓴다. 데스크톱도 같은 사이드카로 한다(§6.1, §8.6)
  const socket = createSocketLauncher({ socketPath: options.socketPath });
  const once = pipedLauncher({
    env: options.env,
    platform: options.platform,
    arch: options.arch,
    resources: options.resources,
    home: options.home,
    log,
    scheduler: clock.scheduler,
  });
  const launcher: Launcher = {
    launch: (target, safeMode) => socket.launch(target, safeMode),
    runOnce: (args) => once.runOnce(args),
  };
  registerEngine(ctx, { launcher, clock, config: options.config, log });

  registerFolderAccess(ctx);
  registerSecretEntry(
    ctx,
    createSecretEntry({
      plan: (args) =>
        planEntryCommand(
          {
            env: options.env,
            platform: options.platform,
            arch: options.arch,
            resources: options.resources,
            home: options.home,
          },
          args,
        ),
      launcher: pipedEntryLauncher(log),
      log,
      scheduler: clock.scheduler,
      timeoutMs: ENTRY_TIMEOUT_MS,
    }),
  );
  createDbToolsModule({
    launcherOf: () => launcher,
    // `open_data_dir`은 웹에서 숨긴다. 이 함수는 호출되지 않는다
    open: () => Promise.reject(new Error("opening a folder is not available on the web")),
    now: () => new Date(clock.now()),
  }).register(ctx);
  createServiceModule({ launcherOf: () => launcher }).register(ctx);
  viewSchemeModule.register(ctx);
  ctx.handle("shell_take_intents", () => intents.take(clock.now()));
  ctx.handle("notify_take_target", () => null);

  // 기능 감지. 데스크톱은 이 명령을 아직 두지 않는다(§6.1 [제안]). 웹은 이 값으로 버튼을 숨긴다
  serve("shell_capabilities", () => ({ kind: "web" }));

  return {
    ctx,
    requested,
    served,
    intents,
    dispatch(command, args) {
      if (state.closed) return Promise.resolve<ShellReply>({ ok: false, error: "unknown-command" });
      return registry.dispatch(caller, command, args);
    },
    closeChannel(id) {
      openChannels.delete(id);
    },
    async close() {
      if (state.closed) return;
      state.closed = true;
      openChannels.clear();
      // 하나씩 차례로 기다린다(main.ts의 runCleanups와 같다). 실패는 로그에 한 줄 남기고 다음 정리를 계속한다
      await cleanups.splice(0).reduce<Promise<void>>(async (previous, cleanup) => {
        await previous;
        const done = await attemptAsync(async () => {
          await cleanup();
        });
        if (!done.ok) log.line("web tab: a cleanup failed");
      }, Promise.resolve());
    },
  };
}
