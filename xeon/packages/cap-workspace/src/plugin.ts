import { err, ok } from "@fresnel/contracts";
import {
  WorkspaceFiles,
  WorkspaceFilesKey,
  WorkspaceShell,
  WorkspaceImagesKey,
  WorkspaceShellKey,
} from "@fresnel/contracts/capabilities";
import type { ExtensionEntry, PortKey } from "@fresnel/contracts/extensions";
import { join } from "node:path";
import type { SessionService } from "@fresnel/contracts/records";
import {
  ApprovalServicePortKey,
  ExecPortKey,
  OsPortKey,
  SandboxServiceName,
  SessionPortKey,
  StoreServicePortKey,
  ToolServiceName,
  type ApprovalService,
  type ExecService,
  type L2ApprovalsPort,
  type OsService,
  type ToolOutputFiles,
  type SandboxService,
  type RgResolver,
  type RootsDeps,
  type ThreadWorkspaces,
  type ToolRegistration,
  type ToolService,
  type WorkspaceCore,
} from "@fresnel/contracts/services";
import {
  hostOf,
  PrimitiveError,
  type ExtensionUnit,
  type RegistrationHostApi,
} from "@fresnel/ext-host";
import type { WorkspaceDeps } from "./deps.ts";
import { workspaceManifest } from "./manifest.ts";
import { createWorkspaceService } from "./service.ts";
import { readWorkspaceSettings, type WorkspaceSettingsSource } from "./settings.ts";

// L2.workspace.plan W4. 구현 패키지(platform-exec, platform-sandbox, core-tools)를 import하지 않고 F 서비스 인터페이스를
// 포트(fresnel.exec, fresnel.sandbox, fresnel.os, fresnel.tools)로만 받는다. Cordis는 import하지 않는다(DR-11).

const SandboxPortKey: PortKey<SandboxService> = { name: SandboxServiceName };
const ToolsPortKey: PortKey<ToolService> = { name: ToolServiceName };

export interface WorkspacePluginOptions {
  /**
   * 경로 검사, 샌드박스 셸, 쓰기 허용 승인, 파일 변경 줄 세우기의 구현 묶음. 조립 루트가 코어 패키지의 `workspaceCore`를 넘긴다.
   * 이 패키지는 구현을 import하지 않는다(DR-15).
   */
  readonly core: WorkspaceCore;
  /** 설정 층. 파일 범위와 세션 범위를 합친 스택을 호출마다 돌려준다 */
  readonly settings: WorkspaceSettingsSource;
  /** 무인 호출의 셸 제한 시간 상한(ms). 조립 루트가 `l0.exec.unattendedTimeoutMs`를 읽어 넘긴다. 없으면 상한을 걸지 않는다 */
  readonly unattendedTimeoutMs?: () => number;
  /** `fresnel.approvals`를 작업 폴더 밖 쓰기 허용 승인(kind tool)을 내는 포트로 감싸는 함수. 조립 루트가 넘긴다. 없으면 묻지 않고 막는다 */
  readonly approvals?: (service: ApprovalService) => L2ApprovalsPort;
  /** 잘린 도구 출력의 파일 사본. 조립 루트가 넘긴다. 있으면 그 폴더를 `read`·`grep`의 읽기 루트에 더한다 */
  readonly outputFiles?: ToolOutputFiles;
  readonly loadIndex?: number;
}

/** 아직 제공되지 않은 포트는 undefined. 그 밖의 오류는 그대로 던진다 */
function optionalPort<Api>(host: RegistrationHostApi, key: PortKey<Api>): Api | undefined {
  try {
    return host.port(key);
  } catch (caught) {
    if (caught instanceof PrimitiveError && caught.code === "port_unavailable") return undefined;
    throw caught;
  }
}

/**
 * 대화별 작업 폴더. `fresnel.session`이 대화 투영 행의 `workspace`를 주고, `fresnel.exec`의 `withCwd`로 그 폴더의 env를 만든다.
 * 행이 없거나 읽기에 실패하면 null이다(엔진의 cwd로 간다). 읽기 실패는 다음 호출이 다시 시도하므로 여기서 던지지 않는다.
 */
function threadWorkspaces(
  core: Pick<WorkspaceCore, "envAtCwd">,
  session: Pick<SessionService, "query">,
  exec: Pick<ExecService, "withCwd" | "truncateHeadOf">,
  configDir: string,
): ThreadWorkspaces {
  return {
    workspaceOf: (threadId) => {
      const row = session.query.thread(threadId);
      return row.ok ? (row.value?.workspace ?? null) : null;
    },
    envAt: (cwd) => core.envAtCwd(exec, cwd),
    // 테스트 대화(M5c §4.8.7)의 쓰기 범위. 묶인 플러그인의 원본 폴더는 사용자 플러그인 폴더(`<설정>/plugins/<이름>`)다
    craftScopeOf: (threadId) => {
      const row = session.query.thread(threadId);
      if (!row.ok || row.value?.craftChat === undefined) return undefined;
      const plugin = row.value.craftChat.plugin;
      return { folder: plugin === null ? null : join(configDir, "plugins", plugin) };
    },
  };
}

/**
 * ripgrep 경로를 고른다(spec §6 grep.rgPath). 설정에 경로가 있으면 그대로 쓰고, 없으면 `fresnel.os`가 번들 바이너리를 찾는다.
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
  const entry: ExtensionEntry = ({ manifest: loaded, register }) => {
    register(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      const exec = host.port(ExecPortKey);
      const os = host.port(OsPortKey);
      const sandbox = optionalPort(host, SandboxPortKey);
      const tools = optionalPort(host, ToolsPortKey);
      const session = optionalPort(host, SessionPortKey);
      const store = optionalPort(host, StoreServicePortKey);
      const logger = os.logger("workspace");
      const approvalService = optionalPort(host, ApprovalServicePortKey);
      const writeAccess =
        options.approvals === undefined || approvalService === undefined
          ? undefined
          : options.core.createWriteAccessAdapter(options.approvals(approvalService));

      const roots: RootsDeps = {
        env: exec,
        roots: (context) => options.core.defaultRoots(exec, context, options.outputFiles),
        protectedPaths: (allowed) => sandbox?.protectedPaths(allowed) ?? [],
        ...(options.outputFiles === undefined ? {} : { outputs: options.outputFiles }),
      };
      const deps: WorkspaceDeps = {
        env: exec,
        roots,
        sandbox,
        tempDir: os.dirs.tmp,
        clock: os.time.clock,
        settings: (threadId) => readWorkspaceSettings(options.settings.layers(threadId)),
        ...(store === undefined ? {} : { blobs: store }),
        ...(session === undefined
          ? {}
          : { threads: threadWorkspaces(options.core, session, exec, os.dirs.config) }),
        rg: rgResolver(os),
        homeDir: os.dirs.home,
        core: options.core,
        ...(writeAccess === undefined ? {} : { writeAccess }),
        ...(options.unattendedTimeoutMs === undefined
          ? {}
          : { unattendedTimeoutMs: options.unattendedTimeoutMs }),
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
            grep: { risk: "read" },
          },
        },
        {
          kind: "capability",
          def: WorkspaceShell,
          key: WorkspaceShellKey,
          policy: { bash: { risk: "exec", riskUnderReadOnlySandbox: "read" } },
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
