import { ok } from "@xeon/contracts";
import {
  DialogAskKey,
  DialogAttachmentsKey,
  DialogCommandsKey,
  DialogStatusKey,
  WorkspaceImagesKey,
  type CallContext,
} from "@xeon/contracts/capabilities";
import type { IdFactory } from "@xeon/contracts/conversation";
import type { ExtensionEntry, PortKey } from "@xeon/contracts/extensions";
import {
  ExecPortKey,
  OsPortKey,
  SessionPortKey,
  StoreServicePortKey,
} from "@xeon/contracts/services";
import { hostOf, PrimitiveError, type ExtensionUnit, type ScopeHostApi } from "@xeon/ext-host";
import type { DialogDeps } from "./deps.ts";
import { dialogManifest } from "./manifest.ts";
import type { ApprovalsPortFactory } from "./ports/approvals.ts";
import type { ImagesPort } from "./ports/images.ts";
import type { ShellPort } from "./ports/shell.ts";
import { createDialogRuntime } from "./service.ts";
import { sessionFeed, sessionStatusPublisher } from "./session-adapter.ts";
import { readDialogSettings, type DialogSettingsSource } from "./settings.ts";

// L2.dialog.plan §2. 구현 패키지를 import하지 않고 F 서비스 인터페이스를 포트(xeon.exec, xeon.os, xeon.store, xeon.session)로만 받는다.
// Cordis는 import하지 않는다(DR-11). 승인 팩토리와 사용자 셸 포트는 조립 루트(HOST)가 만들어 옵션으로 넘긴다:
// 둘 다 도구 호출 맥락(ToolRunContext)이 필요해 포트 키 하나로 받을 수 없다.

export interface DialogPluginOptions {
  /** 설정 층. 파일 범위와 세션 범위를 합친 스택을 호출마다 돌려준다 */
  readonly settings: DialogSettingsSource;
  /** 휘발 이벤트 id를 만든다 */
  readonly ids: IdFactory;
  /** `xeon.approvals`를 L2 포트로 감싼 팩토리. 없으면 `ask`는 unavailable이다 */
  readonly approvals?: ApprovalsPortFactory;
  /** 사용자 개시 셸 실행. 없으면 셸 주입 명령은 unavailable이다 */
  readonly shell?: ShellPort;
  /** 사람이 답할 수 있는 호출인가. 생략하면 모든 호출이 대화형이다 */
  readonly interactive?: (context: CallContext) => boolean;
  readonly loadIndex?: number;
}

/** 아직 제공되지 않은 포트는 undefined. 그 밖의 오류는 그대로 던진다 */
function optionalPort<Api>(host: ScopeHostApi, key: PortKey<Api>): Api | undefined {
  try {
    return host.port(key);
  } catch (caught) {
    if (caught instanceof PrimitiveError && caught.code === "port_unavailable") return undefined;
    throw caught;
  }
}

/** `workspace.images`가 아직 없으면 undefined다(첨부는 원본을 직접 등록한다. L2.dialog.spec §10 D-9) */
function optionalImages(capability: () => ImagesPort): ImagesPort | undefined {
  try {
    return capability();
  } catch (caught) {
    if (caught instanceof PrimitiveError && caught.code === "capability_unavailable")
      return undefined;
    throw caught;
  }
}

/** 내장 확장 단위. 조립 루트가 ExtHost.install로 올린다 */
export function dialogPlugin(options: DialogPluginOptions): ExtensionUnit {
  const manifest = dialogManifest();
  const entry: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      const exec = host.port(ExecPortKey);
      const os = host.port(OsPortKey);
      const store = optionalPort(host, StoreServicePortKey);
      const session = optionalPort(host, SessionPortKey);
      const logger = os.logger("dialog");
      const images = optionalImages(() => g.capability(WorkspaceImagesKey));

      const deps: DialogDeps = {
        logger,
        timers: os.time,
        settings: (threadId) => readDialogSettings(options.settings.layers(threadId)),
        approvals: options.approvals,
        interactive: options.interactive ?? (() => true),
        shell: options.shell,
        commandFiles: exec,
        commandRoots: {
          userDir: `${os.dirs.home}/.xeon/commands`,
          home: os.dirs.home,
          projectRoot: (threadId) => {
            if (session === undefined || threadId === undefined) return exec.cwd;
            const row = session.query.thread(threadId);
            return (row.ok ? row.value?.workspace : null) ?? exec.cwd;
          },
        },
        files: exec,
        images,
        blobs: store,
        status:
          session === undefined
            ? undefined
            : sessionStatusPublisher(session, options.ids, os.time, logger),
        feed: session === undefined ? undefined : sessionFeed(session, logger),
      };
      const runtime = createDialogRuntime(deps);
      host.provide(DialogAskKey, runtime.apis.ask);
      host.provide(DialogCommandsKey, runtime.apis.commands);
      host.provide(DialogStatusKey, runtime.apis.status);
      host.provide(DialogAttachmentsKey, runtime.apis.attachments);

      if (options.approvals === undefined) {
        logger.warn("dialog.approvals_missing", { effect: "ask is rejected as unavailable" });
      }
      if (options.shell === undefined) {
        logger.warn("dialog.shell_missing", {
          effect: "commands with shell injection are rejected",
        });
      }
      if (store === undefined) {
        logger.warn("dialog.store_missing", { effect: "attachments are rejected as unavailable" });
      }
      if (session === undefined) {
        logger.warn("dialog.session_missing", { effect: "the status line has no events" });
      }

      // 입력 지점: 셸 주입이 없는 템플릿 명령만 치환한다(질의와 치환만 하고 효과를 내지 않는다)
      g.on("input", async (_payload, current, ctx) => {
        if (current.handled) return undefined;
        const text = await runtime.commands.transformInput(current.text, ctx.threadId, ctx.signal);
        return text === undefined ? undefined : { action: "transform", text };
      });
      g.on("tool_execution_start", (payload, ctx) => {
        runtime.status.onToolStart(ctx.threadId, payload.toolCallId, payload.toolName);
      });
      g.on("tool_execution_end", (payload, ctx) => {
        runtime.status.onToolEnd(ctx.threadId, payload.toolCallId);
      });
      g.on("before_agent_start", async (_payload, current, ctx) => {
        const fragment = await runtime.commands.advertisement(ctx.threadId, ctx.signal);
        if (fragment === undefined) return undefined;
        const base = current.systemPrompt;
        return { systemPrompt: base === "" ? fragment : `${base}\n\n${fragment}` };
      });

      const unsubscribe = deps.feed?.subscribe((event) => {
        runtime.status.onEvent(event);
      });
      g.onDispose(() => {
        unsubscribe?.();
        runtime.dispose();
      });
      return ok(undefined);
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex ?? 0, builtin: true };
}
