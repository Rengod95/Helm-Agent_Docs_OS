import type { IdByPrefix, IdFactory, IdPrefix } from "@xeon/contracts/conversation";
import { validateManifest, type ManifestIssue } from "@xeon/contracts/extensions";
import { createExtHost, PrimitiveError } from "@xeon/ext-host";
import type { GroupDefIssue, GroupModule } from "../types.ts";

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
 * (L3.group-kit.spec §3.3, plan G-06). X가 setup 직후 부르는 validateUsage 결과를 그대로 돌려준다.
 * 호스트는 포트가 하나도 없는 ext-host라서 임대와 turn은 일어나지 않고, 등록만 본다.
 * setup이 던지면 `setup_threw` 오류 하나를 더한다. 이슈의 severity로 거른다(오류 0개가 통과다).
 */
export async function checkGroup(
  module: GroupModule,
): Promise<readonly (GroupDefIssue | ManifestIssue)[]> {
  const issues: (GroupDefIssue | ManifestIssue)[] = [...validateManifest(module.manifest).issues];
  const host = createExtHost({
    ids: counterIds(),
    now: () => 0,
    setTimer: () => () => {},
    settings: {
      driveDefaultLimits: () => ({}),
      driveLimits: () => ({}),
      activeDriveGroup: () => null,
      capabilityProviders: () => ({}),
    },
    report: () => {},
    strict: true,
  });
  try {
    const installed = await host.install({
      manifest: module.manifest,
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
    for (const setup of installed.setups) {
      if (setup.status !== "failed") continue;
      issues.push(
        usageIssueOf(setup.failure?.error) ?? {
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

/** X는 선언하지 않은 등록을 그 자리에서 던진다. 던진 코드가 validateUsage 코드와 같으면 같은 이슈로 돌려준다 */
const USAGE_PATHS: Readonly<Partial<Record<string, readonly [ManifestIssue["code"], string]>>> = {
  point_undeclared: ["point_undeclared", "/points"],
  post_undeclared: ["post_undeclared", "/usesPost"],
  drive_undeclared: ["drive_undeclared", "/usesDrive"],
  capability_undeclared: ["capability_undeclared", "/requires"],
  record_kind_undeclared: ["record_kind_undeclared", "/recordKinds"],
  read_kind_undeclared: ["read_kind_undeclared", "/readsRecordKinds"],
};

function usageIssueOf(error: unknown): ManifestIssue | undefined {
  if (!(error instanceof PrimitiveError)) return undefined;
  const found = USAGE_PATHS[error.code];
  if (found === undefined) return undefined;
  return { severity: "error", code: found[0], path: found[1], message: error.message };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
