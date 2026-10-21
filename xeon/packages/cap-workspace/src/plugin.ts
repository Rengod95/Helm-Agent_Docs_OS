import {
  WorkspaceFiles,
  WorkspaceFilesKey,
  WorkspaceShell,
  WorkspaceShellKey,
  type AnyCapabilityDef,
} from "@xeon/contracts/capabilities";
import type { ExtensionEntry, PortKey } from "@xeon/contracts/extensions";
import {
  ExecServiceName,
  OsServiceName,
  SandboxServiceName,
  ToolServiceName,
  type ExecService,
  type OsService,
  type SandboxService,
  type ToolService,
} from "@xeon/contracts/services";
import { hostOf, PrimitiveError, type ExtensionUnit, type ScopeHostApi } from "@xeon/ext-host";
import type { WorkspaceDeps } from "./deps.ts";
import { workspaceManifest } from "./manifest.ts";
import { defaultRoots, type RootsDeps } from "./roots.ts";
import { createWorkspaceService } from "./service.ts";
import { readWorkspaceSettings, type WorkspaceSettingsSource } from "./settings.ts";

// L2.workspace.plan W4. 구현 패키지(platform-exec, platform-sandbox, core-tools)를 import하지 않고 F 서비스 인터페이스를
// 포트(xeon.exec, xeon.sandbox, xeon.os, xeon.tools)로만 받는다. Cordis는 import하지 않는다(DR-11).

const ExecPortKey: PortKey<ExecService> = { name: ExecServiceName };
const OsPortKey: PortKey<OsService> = { name: OsServiceName };
const SandboxPortKey: PortKey<SandboxService> = { name: SandboxServiceName };
const ToolsPortKey: PortKey<ToolService> = { name: ToolServiceName };

/**
 * M1에서 L1.tools에 올리는 `workspace.files` 도구 이름. 아직 구현하지 않은 도구(write, edit, grep, find)는
 * 광고하지 않는다(plan W4 "미구현 도구는 노출하지 않는지 확인"). M3(W5, W6)에서 이 목록을 늘린다.
 */
export const IMPLEMENTED_FILES_TOOLS: readonly string[] = ["read", "ls"];

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

/** 구현된 도구만 남긴 `workspace.files` 정의. 서비스 메서드와 키는 그대로다 */
export function advertisedFilesDef(): AnyCapabilityDef {
  return {
    ...WorkspaceFiles,
    tools: WorkspaceFiles.tools.filter((tool) => IMPLEMENTED_FILES_TOOLS.includes(tool.name)),
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
      };
      const service = createWorkspaceService(deps);
      host.provide(WorkspaceFilesKey, service.files);
      host.provide(WorkspaceShellKey, service.shell);

      if (sandbox === undefined) {
        logger.warn("workspace.sandbox_missing", { effect: "bash is rejected as unavailable" });
      }
      if (tools === undefined) {
        logger.warn("workspace.tools_missing", { effect: "no tool is advertised" });
        return;
      }
      const registrations = [
        tools.register({
          kind: "capability",
          def: advertisedFilesDef(),
          key: WorkspaceFilesKey,
          policy: { read: { risk: "read" }, ls: { risk: "read" } },
        }),
        tools.register({
          kind: "capability",
          def: WorkspaceShell,
          key: WorkspaceShellKey,
          policy: { bash: { risk: "exec" } },
        }),
      ];
      g.onDispose(() => {
        for (const unregister of registrations) unregister();
      });
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex ?? 0, builtin: true };
}
