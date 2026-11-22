import type { IdByPrefix, IdFactory, IdPrefix } from "@fresnel/contracts/conversation";
import {
  validateManifest,
  type ExtensionManifest,
  type ManifestIssue,
  pluginDeclsOf,
  pluginsOf,
} from "@fresnel/contracts/extensions";
import { createExtHost, PrimitiveError } from "@fresnel/ext-host";
import type { OrchestrationDefIssue, OrchestrationModule } from "../types.ts";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BODY_LENGTH = 26;

/** 호출 순서대로 `<접두>_<26자>`를 만든다. 첫 글자가 0-7이라 F의 ID 패턴을 지킨다 */
function counterIds(): IdFactory {
  let counter = 0;
  return {
    next<P extends IdPrefix>(prefix: P): IdByPrefix[P] {
      counter += 1;
      let rest = counter;
      let body = "";
      while (rest > 0) {
        body = `${ALPHABET[rest % 32] ?? "0"}${body}`;
        rest = Math.floor(rest / 32);
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A2 브랜드 생성: 시험 지원 코드의 ID 발급기 (eng.typescript.guide TY-06)
      return `${prefix}_${body.padStart(BODY_LENGTH, "0")}` as IdByPrefix[P];
    },
  };
}

/**
 * 기록용 호스트에서 entry를 실행해 setup의 실제 등록을 모으고 F validateUsage와 대조한다
 * (L3.group-sdk.spec §3.3, plan G-06). X가 setup 직후 부르는 validateUsage 결과를 그대로 돌려준다.
 * 호스트는 포트가 하나도 없는 ext-host라서 임대와 turn은 일어나지 않고, 등록만 본다.
 * setup이 던지면 `setup_threw` 오류 하나를 더한다. 이슈의 severity로 거른다(오류 0개가 통과다).
 */
export async function checkOrchestration(
  module: OrchestrationModule,
): Promise<readonly (OrchestrationDefIssue | ManifestIssue)[]> {
  const issues: (OrchestrationDefIssue | ManifestIssue)[] = [
    ...validateManifest(module.manifest).issues,
  ];
  const manifest = membersEnabledOf(module.manifest);
  const rootIndex = Math.max(
    0,
    pluginDeclsOf(module.manifest).findIndex((plugin) => plugin.id === undefined),
  );
  const host = createExtHost({
    ids: counterIds(),
    now: () => 0,
    setTimer: () => () => {},
    settings: {
      driveDefaultLimits: () => ({}),
      driveLimits: () => ({}),
      driveMaxDepth: () => 8,
      driveRequiresOrchestration: () => true,
      capabilityProviders: () => ({}),
    },
    report: () => {},
    strict: true,
  });
  try {
    const installed = await host.install({
      manifest,
      entry: module.entry,
      loadIndex: 0,
      builtin: true,
    });
    issues.push(...installed.issues);
    if (installed.entryError !== undefined) {
      issues.push({
        severity: "error",
        code: "setup_threw",
        path: "/entry",
        message: `entry threw: ${describe(installed.entryError)}`,
      });
    }
    const plugins = pluginsOf(module.manifest);
    for (const setup of installed.setups) {
      if (setup.status !== "failed") continue;
      // 뿌리와 구성원 모두 자기 plugins[] 위치를 가리킨다
      const index =
        plugins.find((entry) => entry.registrationId === setup.scopeId)?.index ?? rootIndex;
      issues.push(
        usageIssueOf(setup.failure?.error, index) ?? {
          severity: "error",
          code: "setup_threw",
          path: `/scopes/${setup.scopeId}`,
          message: `setup of ${setup.scopeId} failed (${setup.failure?.code ?? setup.failure?.kind ?? "unknown"}): ${describe(setup.failure?.error)}`,
        },
      );
    }
  } finally {
    await host.dispose();
  }
  return issues;
}

/**
 * 검사 호스트에서 구성원도 켜 둔 매니페스트. 구성원은 기본으로 꺼져 있어 setup이 돌지 않으므로, 그대로 두면 구성원의 선언 오류를
 * 못 본다. 뿌리는 바꾸지 않는다(뿌리는 기본으로 켜진다)
 */
function membersEnabledOf(manifest: ExtensionManifest): ExtensionManifest {
  if (manifest.plugins === undefined) return manifest;
  return {
    ...manifest,
    plugins: manifest.plugins.map((decl) =>
      decl.id === undefined ? decl : { ...decl, defaultEnabled: decl.defaultEnabled ?? true },
    ),
  };
}

/** X는 선언하지 않은 등록을 그 자리에서 던진다. 던진 코드가 validateUsage 코드와 같으면 같은 이슈로 돌려준다 */
const USAGE_PATHS: Readonly<Partial<Record<string, readonly [ManifestIssue["code"], string]>>> = {
  hook_undeclared: ["hook_undeclared", "hooks"],
  post_undeclared: ["post_undeclared", "usesPost"],
  drive_undeclared: ["drive_undeclared", "drives"],
  capability_undeclared: ["capability_undeclared", "requires"],
  record_kind_undeclared: ["record_kind_undeclared", "recordKinds"],
  read_kind_undeclared: ["read_kind_undeclared", "readsRecordKinds"],
};

/** `pluginIndex`는 실패한 Registration의 플러그인 위치(뿌리 또는 구성원)다. 경로는 `/plugins/<pluginIndex>/<필드>`다 */
function usageIssueOf(error: unknown, pluginIndex: number): ManifestIssue | undefined {
  if (!(error instanceof PrimitiveError)) return undefined;
  const found = USAGE_PATHS[error.code];
  if (found === undefined) return undefined;
  return {
    severity: "error",
    code: found[0],
    path: `/plugins/${pluginIndex}/${found[1]}`,
    message: error.message,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
