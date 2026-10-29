import { err, ok } from "@xeon/contracts";
import {
  WorkspaceFiles,
  WorkspaceFilesKey,
  WorkspaceShell,
  WorkspaceImagesKey,
  WorkspaceShellKey,
} from "@xeon/contracts/capabilities";
import type { ExtensionEntry, PortKey } from "@xeon/contracts/extensions";
import type { SessionService } from "@xeon/contracts/records";
import {
  ExecPortKey,
  OsPortKey,
  SandboxServiceName,
  SessionPortKey,
  StoreServicePortKey,
  ToolServiceName,
  type ExecService,
  type OsService,
  type SandboxService,
  type ToolRegistration,
  type ToolService,
} from "@xeon/contracts/services";
import { hostOf, PrimitiveError, type ExtensionUnit, type ScopeHostApi } from "@xeon/ext-host";
import type { RgResolver, WorkspaceDeps } from "./deps.ts";
import { envAtCwd } from "./env.ts";
import { workspaceManifest } from "./manifest.ts";
import type { ThreadWorkspaces } from "./ports/threads.ts";
import { defaultRoots, type RootsDeps } from "./roots.ts";
import { createWorkspaceService } from "./service.ts";
import { readWorkspaceSettings, type WorkspaceSettingsSource } from "./settings.ts";

// L2.workspace.plan W4. 구현 패키지(platform-exec, platform-sandbox, core-tools)를 import하지 않고 F 서비스 인터페이스를
// 포트(xeon.exec, xeon.sandbox, xeon.os, xeon.tools)로만 받는다. Cordis는 import하지 않는다(DR-11).

const SandboxPortKey: PortKey<SandboxService> = { name: SandboxServiceName };
const ToolsPortKey: PortKey<ToolService> = { name: ToolServiceName };

export interface WorkspacePluginOptions {
  /** 설정 층. 파일 범위와 세션 범위를 합친 스택을 호출마다 돌려준다 */
  readonly settings: WorkspaceSettingsSource;
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

/**
 * 대화별 작업 폴더. `xeon.session`이 대화 투영 행의 `workspace`를 주고, `xeon.exec`의 `withCwd`로 그 폴더의 env를 만든다.
 * 행이 없거나 읽기에 실패하면 null이다(엔진의 cwd로 간다). 읽기 실패는 다음 호출이 다시 시도하므로 여기서 던지지 않는다.
 */
function threadWorkspaces(
  session: Pick<SessionService, "query">,
  exec: Pick<ExecService, "withCwd" | "truncateHeadOf">,
): ThreadWorkspaces {
  return {
    workspaceOf: (threadId) => {
      const row = session.query.thread(threadId);
      return row.ok ? (row.value?.workspace ?? null) : null;
    },
    envAt: (cwd) => envAtCwd(exec, cwd),
  };
}

/**
 * ripgrep 경로를 고른다(spec §6 grep.rgPath). 설정에 경로가 있으면 그대로 쓰고, 없으면 `xeon.os`가 번들 바이너리를 찾는다.
 * 설정 경로는 managed·user 범위에서만 온다(settings.ts), 그래서 저장소를 여는 것만으로 바이너리가 바뀌지 않는다.
 */
function rgResolver(os: OsService): RgResolver {
  return async (rgPath, signal) => {
    if (rgPath !== "") return ok(rgPath);
    const resolved = await os.resolveBinary("rg", {}, signal ?? new AbortController().signal);
    if (resolved.ok) return ok(resolved.value.path);
    const kind = resolved.error.kind === "cancelled" ? "cancelled" : "missing";
    return err({ kind, message: `rg binary: ${resolved.error.kind}` });
  };
}

/** 내장 확장 단위. 조립 루트가 ExtHost.install로 올린다 */
export function workspacePlugin(options: WorkspacePluginOptions): ExtensionUnit {
  const manifest = workspaceManifest();
  const entry: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      const exec = host.port(ExecPortKey);
      const os = host.port(OsPortKey);
      const sandbox = optionalPort(host, SandboxPortKey);
      const tools = optionalPort(host, ToolsPortKey);
      const session = optionalPort(host, SessionPortKey);
      const store = optionalPort(host, StoreServicePortKey);
      const logger = os.logger("workspace");

      const roots: RootsDeps = {
        env: exec,
        roots: (context) => defaultRoots(exec, context),
        protectedPaths: () => sandbox?.protectedPaths() ?? [],
      };
      const deps: WorkspaceDeps = {
        env: exec,
        roots,
        sandbox,
        tempDir: os.dirs.tmp,
        clock: os.time.clock,
        settings: (threadId) => readWorkspaceSettings(options.settings.layers(threadId)),
        ...(store === undefined ? {} : { blobs: store }),
        ...(session === undefined ? {} : { threads: threadWorkspaces(session, exec) }),
        rg: rgResolver(os),
      };
      const service = createWorkspaceService(deps);
      host.provide(WorkspaceFilesKey, service.files);
      host.provide(WorkspaceShellKey, service.shell);

      host.provide(WorkspaceImagesKey, service.images);

      if (sandbox === undefined) {
        logger.warn("workspace.sandbox_missing", { effect: "bash is rejected as unavailable" });
      }
      if (store === undefined) {
        logger.warn("workspace.store_missing", {
          effect: "workspace.images is unavailable and read treats images as binary files",
        });
      }
      if (session === undefined) {
        logger.warn("workspace.session_missing", {
          effect: "every thread uses the engine working directory",
        });
      }
      if (tools === undefined) {
        logger.warn("workspace.tools_missing", { effect: "no tool is advertised" });
        return ok(undefined);
      }
      const registrations: readonly ToolRegistration[] = [
        {
          kind: "capability",
          def: WorkspaceFiles,
          key: WorkspaceFilesKey,
          policy: {
            read: { risk: "read" },
            write: { risk: "write" },
            edit: { risk: "write" },
            ls: { risk: "read" },
            grep: { risk: "read" },
            find: { risk: "read" },
          },
        },
        {
          kind: "capability",
          def: WorkspaceShell,
          key: WorkspaceShellKey,
          policy: { bash: { risk: "exec" } },
        },
      ];
      // 이름 충돌은 확장 조합이 낼 수 있는 시작 실패다. 먼저 넣은 등록을 거두고 setup이 값으로 알린다
      const unregisters: (() => void)[] = [];
      for (const registration of registrations) {
        const registered = tools.register(registration);
        if (!registered.ok) {
          for (const unregister of unregisters.toReversed()) unregister();
          return err({ reason: registered.error.kind, cause: registered.error });
        }
        unregisters.push(registered.value);
      }
      g.onDispose(() => {
        for (const unregister of unregisters) unregister();
      });
      return ok(undefined);
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex ?? 0, builtin: true };
}
