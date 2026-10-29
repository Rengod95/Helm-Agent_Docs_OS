import type { Locale } from "@xeon/client/i18n";
import type { Clock, Scheduler } from "@xeon/contracts";
import { createHostConnection } from "@xeon/client";
import { createStdioTransport } from "@xeon/client/stdio";
import { createFrameClock, createJournal, watch } from "../state/shared/index.ts";
import { createEngineStore, type ApplyNote, type EngineStore } from "../state/engine/index.ts";
import { createUiStore, type UiStore } from "../state/ui/index.ts";
import type { DesktopIpc } from "../transport/ipc.ts";
import { createCommands } from "./commands.ts";
import { BUILD_CHECKS } from "./build.ts";
import { startLocale } from "./locale.ts";
import { createWebViewLogger, type LogLine, type LogRing } from "./logger.ts";
import { startSession, type Session } from "./session.ts";
import type { Commands } from "../views/commands.ts";

// 부트스트랩(FS-05): 스토어는 여기서 한 번 만들고 Context로 넘긴다. 모듈 최상위에는 싱글턴이 없다.

export type AppEnv = {
  readonly ipc: DesktopIpc;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly frames: Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame">;
  readonly monotonic: () => number;
  readonly clipboard: { writeText(text: string): Promise<void> };
  readonly appVersion: string;
  /** 프레임 커밋 상한(ms). 숨겨진 창에서 rAF가 멈춰도 이 안에 큐를 비운다 */
  readonly frameFallbackMs: number;
  /** 로그 줄을 밖으로 보낼 곳(warn 이상). 기본은 개발자 도구 콘솔이다 */
  readonly logSink?: (line: LogLine) => void;
  /** WebView 언어 단서(`navigator.languages`). 주면 첫 렌더 전에 로케일을 정하고 설정을 따른다. 없으면 로케일을 건드리지 않는다 */
  readonly languages?: readonly string[];
  /** 연결 뒤 `l4.ui.locale`로 로케일이 바뀌었을 때 부른다. 호출자가 다시 그린다 */
  readonly onLocaleChange?: (locale: Locale) => void;
};

export type App = {
  readonly engine: EngineStore;
  readonly ui: UiStore;
  readonly commands: Commands;
  readonly session: Session;
  readonly log: LogRing;
  stop(): Promise<void>;
};

const CLIENT_NAME = "xeon-desktop";

export function createApp(env: AppEnv): App {
  const log = createWebViewLogger(200, env.logSink);
  const journal = createJournal<ApplyNote>(1000);
  const engine = createEngineStore({
    clock: env.clock,
    frames: createFrameClock(env.frames, env.scheduler, env.frameFallbackMs),
    logger: log.logger,
    journal,
    checks: BUILD_CHECKS,
    monotonic: env.monotonic,
  });
  const ui = createUiStore();
  // 첫 렌더 전에 언어 단서로 로케일을 정한다. 연결되면 `l4.ui.locale` 값으로 바로잡고 무효화 알림을 따른다
  const languages = env.languages;
  const locale =
    languages === undefined ? null : startLocale(languages, (next) => env.onLocaleChange?.(next));
  const session = startSession({
    ipc: env.ipc,
    engine,
    ui,
    logger: log.logger,
    onConnection: (connection) =>
      locale?.follow(connection, (cause) => {
        log.logger.error("desktop.locale.read_failed", {
          error: cause instanceof Error ? cause.name : "unknown",
        });
      }) ?? (() => {}),
    transport: {
      stdioTransport: createStdioTransport,
      connect: (transport) => createHostConnection(transport),
      client: { name: CLIENT_NAME, version: env.appVersion },
    },
  });
  // 거울에서 사라진 승인의 UI 표시를 지운다(design 9절)
  const stopCleanup = watch(
    engine.read,
    (s) => s.approvals.ids,
    (ids) => {
      ui.actions.pruneApprovalSends(ids);
    },
    (cause) => {
      log.logger.error("desktop.ui.approval_cleanup_failed", {
        error: cause instanceof Error ? cause.name : "unknown",
      });
    },
  );
  const commands = createCommands({
    session,
    ipc: env.ipc,
    engine,
    ui,
    journal,
    versions: () => ({ app: env.appVersion, engine: session.engineVersion() }),
    clipboard: env.clipboard,
  });
  return {
    engine,
    ui,
    commands,
    session,
    log,
    async stop() {
      stopCleanup();
      await session.stop();
    },
  };
}
