import { assertNever, err, type Result } from "@fresnel/contracts";
import {
  CapabilityError,
  WorkspaceProtection,
  type CallOptions,
  type CapabilityApi,
  type ProtectedListOutput,
  type ProtectOutput,
} from "@fresnel/contracts/capabilities";
import type { JsonValue } from "@fresnel/contracts/conversation";
import type { ProtectedPathEntry, SandboxService } from "@fresnel/contracts/services";

// [제안, AGE-63] 기능 `workspace.protection`의 구현. 설정 파일은 이 패키지가 쓰지 않는다. 사용자 범위 extra의 쓰기는 조립 루트가
// 넘기는 `ProtectPathsStore`가 한다(설정 저장소). 여기서는 검사, 중복 거르기, 목록 만들기만 한다.
// 기대한 실패는 `CapabilityError`로 던진다(기능 API의 규칙, cap-schedule의 `createScheduleApi`와 같다). 안쪽 함수는 `Result`를 쓴다.

/** 사용자 범위 `l0.sandbox.protectedPaths.extra`의 읽기와 더하기 포트. 조립 루트가 설정 저장소로 구현해 넘긴다 */
export interface ProtectPathsStore {
  /** 지금 사용자 범위의 extra 값(저장된 그대로). 없거나 목록 모양이 아니면 빈 목록이다 */
  current(): readonly string[];
  /** 사용자 범위 extra 뒤에 `values`를 붙여 쓴다. 성공하면 쓴 뒤의 전체 목록을 돌려준다 */
  add(values: readonly string[]): Promise<Result<readonly string[], ProtectPathsWriteFailure>>;
}

/** 더하기가 실패한 이유. 값은 싣지 않는다 */
export type ProtectPathsWriteFailure =
  /** 설정 저장소가 없다(조립이 아직 올라오지 않았다) */
  | { readonly kind: "unavailable" }
  /** managed 정책이 이 설정을 정했다. 사용자 범위 값은 적용되지 않으므로 쓰지 않는다 */
  | { readonly kind: "locked" }
  /** 쓰면 설정 검사를 통과하지 못한다(개수 한도 등), 또는 저장된 값이 목록 모양이 아니다 */
  | { readonly kind: "invalid_value" }
  /** 설정 파일을 쓰지 못했다. `code`는 OS 오류 코드 또는 저장소 실패 종류다 */
  | { readonly kind: "store_failed"; readonly code: string };

/** 저장소가 없을 때의 포트. 목록은 비고 더하기는 unavailable이다 */
export const UNAVAILABLE_PROTECT_STORE: ProtectPathsStore = {
  current: () => [],
  add: () => Promise.resolve(err({ kind: "unavailable" })),
};

export type ProtectSandbox = Pick<
  SandboxService,
  "protectedPathKey" | "protectedPaths" | "suggestedProtectedPaths"
>;

export interface ProtectApiDeps {
  /** 샌드박스. 없으면 두 메서드 모두 unavailable이다(경로 비교와 목록을 만들 수 없다) */
  readonly sandbox: ProtectSandbox | undefined;
  readonly store: ProtectPathsStore;
}

const CAPABILITY = WorkspaceProtection.id;
type Method = "protect" | "list";

function reject(
  method: Method,
  code: string,
  message: string,
  detail?: JsonValue,
): CapabilityError {
  return new CapabilityError({
    capability: CAPABILITY,
    method,
    code,
    message,
    retryable: false,
    ...(detail === undefined ? {} : { detail }),
  });
}

function abortIf(method: Method, signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw reject(method, "aborted", "The call was aborted.");
}

/** 입력 한 줄이 어디서 거부됐는지. 경로 값은 싣지 않고 위치와 이유만 싣는다 */
type PathReason = "relative" | "root" | "home" | "contains_home";

interface PathIssue {
  readonly index: number;
  readonly reason: PathReason;
}

interface CheckedPath {
  /** 저장할 모양. 끝의 `/`만 뗀 입력이다(마디는 그대로 둔다) */
  readonly stored: string;
  /** 같은 경로인지 견주는 정규 절대 경로(샌드박스의 `protectedPathKey`) */
  readonly key: string;
}

/** 저장할 모양: 끝의 `/`를 뗀다(루트는 그대로). 같은 경로인지는 비교 키가 정하므로 마디는 건드리지 않는다 */
function storedFormOf(raw: string): string {
  return raw.length > 1 && raw.endsWith("/") ? raw.replace(/\/+$/, "") || "/" : raw;
}

function isPathShape(raw: string): boolean {
  return raw.startsWith("/") || raw === "~" || raw.startsWith("~/");
}

/**
 * 입력 모든 줄을 먼저 검사한다. 한 줄이라도 거부되면 아무것도 쓰지 않도록 전체를 거부한다.
 * `/`, 홈 폴더, 홈을 품은 상위 폴더(예: `/Users`)는 "이 폴더를 보호"가 아니라 사실상 전체를 막는 요청이라 거부한다.
 */
function checkPaths(
  sandbox: ProtectSandbox,
  paths: readonly string[],
):
  | { readonly ok: true; readonly items: readonly CheckedPath[] }
  | { readonly ok: false; readonly issues: readonly PathIssue[] } {
  const rootKey = sandbox.protectedPathKey("/");
  const homeKey = sandbox.protectedPathKey("~");
  const issues: PathIssue[] = [];
  const items: CheckedPath[] = [];
  paths.forEach((raw, index) => {
    const key = isPathShape(raw) ? sandbox.protectedPathKey(raw) : undefined;
    if (key === undefined) {
      issues.push({ index, reason: "relative" });
      return;
    }
    if (key === rootKey) {
      issues.push({ index, reason: "root" });
      return;
    }
    if (key === homeKey) {
      issues.push({ index, reason: "home" });
      return;
    }
    if (homeKey !== undefined && homeKey.startsWith(key.endsWith("/") ? key : `${key}/`)) {
      issues.push({ index, reason: "contains_home" });
      return;
    }
    items.push({ stored: storedFormOf(raw), key });
  });
  return issues.length === 0 ? { ok: true, items } : { ok: false, issues };
}

function messageOf(issues: readonly PathIssue[]): string {
  const reasons = new Set(issues.map((issue) => issue.reason));
  const parts: string[] = [];
  if (reasons.has("relative")) {
    parts.push("each path must be absolute or start with ~/");
  }
  if (reasons.has("root")) {
    parts.push("/ would block the whole file system; name the folder to protect");
  }
  if (reasons.has("home")) {
    parts.push("the home folder itself would block everything in it; name a folder inside it");
  }
  if (reasons.has("contains_home")) {
    parts.push("a folder that contains the home folder would block it; name the folder itself");
  }
  return `Nothing was protected: ${parts.join("; ")}.`;
}

/** 표시용 경로. 홈 아래는 `~/`로 줄인다. 홈 키가 없으면 그대로 둔다 */
function displayOf(path: string, home: string | undefined): string {
  if (home === undefined) return path;
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function writeRejection(failure: ProtectPathsWriteFailure): CapabilityError {
  switch (failure.kind) {
    case "unavailable":
      return reject(
        "protect",
        "unavailable",
        "The settings store is not available, so the protected paths cannot be saved.",
      );
    case "locked":
      return reject(
        "protect",
        "locked",
        "The protected path setting is locked by a managed policy, so nothing was added.",
      );
    case "invalid_value":
      return reject(
        "protect",
        "invalid_input",
        "The protected path list cannot take these paths (it holds at most 256 entries).",
      );
    case "store_failed":
      return reject("protect", "store_failed", "Could not write the user settings file.", {
        code: failure.code.slice(0, 64),
      });
    default:
      return assertNever(failure, "ProtectPathsWriteFailure");
  }
}

/** 목록을 만든다. 실패는 `CapabilityError`로 던지고, 기능 API가 이것을 거부 값으로 옮긴다 */
function listNow(deps: ProtectApiDeps, options: CallOptions | undefined): ProtectedListOutput {
  abortIf("list", options?.signal);
  const sandbox = deps.sandbox;
  if (sandbox === undefined) {
    throw reject("list", "unavailable", "The sandbox is not available.");
  }
  const home = sandbox.protectedPathKey("~");
  const entries: readonly ProtectedPathEntry[] = sandbox.protectedPaths();
  // 지금 막힌 것: 사용자가 더한 경로와 Fresnel 자신의 고정 시크릿·데이터(읽기와 쓰기 모두 막힌 항목만)
  const blockedByDisplay = new Map<string, { path: string; origin: "user" | "fixed" }>();
  for (const entry of entries) {
    const origin = entry.reason === "user_extra" ? "user" : "fixed";
    const isBlocked =
      entry.access === "read_write" &&
      (entry.reason === "user_extra" ||
        entry.reason === "secret_key" ||
        entry.reason === "fresnel_data");
    if (!isBlocked) continue;
    const path = displayOf(entry.path, home);
    blockedByDisplay.set(`${origin}|${path}`, { path, origin });
  }
  const userPaths = new Set(
    entries.flatMap((entry) => (entry.reason === "user_extra" ? [entry.path] : [])),
  );
  return {
    blocked: [...blockedByDisplay.values()],
    suggested: sandbox.suggestedProtectedPaths().map((row) => ({
      path: row.path,
      label: row.label,
      blocked: userPaths.has(row.key),
    })),
  };
}

/** 기능 `workspace.protection`의 API. `sandbox`와 `store`는 조립이 넘긴다 */
export function createProtectApi(deps: ProtectApiDeps): CapabilityApi<typeof WorkspaceProtection> {
  return {
    async protect(input, options?: CallOptions): Promise<ProtectOutput> {
      abortIf("protect", options?.signal);
      const sandbox = deps.sandbox;
      if (sandbox === undefined) {
        throw reject("protect", "unavailable", "The sandbox is not available.");
      }
      const checked = checkPaths(sandbox, input.paths);
      if (!checked.ok) {
        throw reject("protect", "invalid_input", messageOf(checked.issues), {
          issues: checked.issues.map((issue) => ({ index: issue.index, reason: issue.reason })),
        });
      }
      const current = deps.store.current();
      const known = new Set<string>();
      for (const value of current) {
        const key = sandbox.protectedPathKey(value);
        if (key !== undefined) known.add(key);
      }
      // 이미 보호 중인 경로는 그대로 둔다. 같은 호출 안의 중복도 한 번만 더한다
      const added: string[] = [];
      const alreadyProtected: string[] = [];
      for (const item of checked.items) {
        if (known.has(item.key)) {
          alreadyProtected.push(item.stored);
        } else {
          known.add(item.key);
          added.push(item.stored);
        }
      }
      let protectedNow: readonly string[] = current;
      if (added.length > 0) {
        const written = await deps.store.add(added);
        if (!written.ok) throw writeRejection(written.error);
        protectedNow = written.value;
      }
      return {
        added,
        alreadyProtected,
        protected: [...protectedNow],
        effective: "next_shell_or_file_call",
      };
    },

    list(_input, options?: CallOptions): Promise<ProtectedListOutput> {
      return Promise.resolve().then(() => listNow(deps, options));
    },
  };
}
