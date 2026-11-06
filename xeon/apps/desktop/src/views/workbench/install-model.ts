import { assertNever, type Result, type Thrown } from "@fresnel/contracts";
import type { InstallPreview } from "@fresnel/contracts/services";
import { WIRE_ERRORS, type ExtInstallResult } from "@fresnel/contracts/wire";
import type { CommandError } from "../commands.ts";

// 앱 안 설치(Q9)의 순수 부분: 단계 전이, 실패 갈래, 미리 보기를 화면이 그릴 경고 목록으로 바꾸기. 화면은 `install-dialog.tsx`다.

/** 설치 흐름의 단계. 출처 입력 → 읽는 중 → 권한 확인 → 설치하는 중 → 결과 */
export type InstallFlow =
  | { readonly step: "source"; readonly source: string; readonly failure: InstallFailure | null }
  | { readonly step: "previewing"; readonly source: string }
  | {
      readonly step: "confirm";
      readonly preview: InstallPreview;
      readonly failure: InstallFailure | null;
    }
  | { readonly step: "installing"; readonly preview: InstallPreview }
  | {
      readonly step: "done";
      readonly result: ExtInstallResult;
      /** 실행 중인 판을 바꾸는 `ext.reload`가 거절됐을 때의 갈래. 바꿀 일이 없었거나 바꿨으면 `null` */
      readonly reloadFailure: InstallFailure | null;
    };

export type InstallFailure =
  | "safe_mode"
  | "managed_locked"
  | "source_changed"
  | "invalid_input"
  | "not_found"
  | "denied"
  | "offline"
  | "unsupported"
  | "other";

export const INITIAL_INSTALL_FLOW: InstallFlow = { step: "source", source: "", failure: null };

const SAFE_MODE_CODE = WIRE_ERRORS["extension.safeModeActive"].code;
const ISSUE_KINDS: Readonly<Record<string, InstallFailure>> = {
  invalid_input: "invalid_input",
  not_found: "not_found",
  denied: "denied",
  source_changed: "source_changed",
  managed_locked: "managed_locked",
};

/** 명령 오류를 화면이 문구를 고르는 갈래로 바꾼다. 알 수 없는 것은 `other`다 */
export function installFailureOf(error: CommandError): InstallFailure {
  if (error.kind === "offline") return "offline";
  if (error.kind === "unsupported") return "unsupported";
  if (error.kind !== "rejected") return "other";
  if (error.code === SAFE_MODE_CODE) return "safe_mode";
  const head = error.issue?.split(":")[0];
  return (head === undefined ? undefined : ISSUE_KINDS[head]) ?? "other";
}

export type InstallAction =
  | { readonly type: "source"; readonly source: string }
  | { readonly type: "previewStart" }
  | { readonly type: "previewed"; readonly preview: InstallPreview }
  | { readonly type: "previewFailed"; readonly failure: InstallFailure }
  | { readonly type: "installStart" }
  | {
      readonly type: "installed";
      readonly result: ExtInstallResult;
      readonly reloadFailure: InstallFailure | null;
    }
  | { readonly type: "installFailed"; readonly failure: InstallFailure }
  | { readonly type: "back" };

/** 단계 전이. 맞지 않는 단계에서 온 동작은 흐름을 그대로 둔다 */
export function installReduce(flow: InstallFlow, action: InstallAction): InstallFlow {
  switch (action.type) {
    case "source":
      return flow.step === "source"
        ? { step: "source", source: action.source, failure: null }
        : flow;
    case "previewStart":
      return flow.step === "source" && flow.source.trim() !== ""
        ? { step: "previewing", source: flow.source.trim() }
        : flow;
    case "previewed":
      return flow.step === "previewing"
        ? { step: "confirm", preview: action.preview, failure: null }
        : flow;
    case "previewFailed":
      return flow.step === "previewing"
        ? { step: "source", source: flow.source, failure: action.failure }
        : flow;
    case "installStart":
      return flow.step === "confirm" ? { step: "installing", preview: flow.preview } : flow;
    case "installed":
      return flow.step === "installing"
        ? { step: "done", result: action.result, reloadFailure: action.reloadFailure }
        : flow;
    case "installFailed":
      return flow.step === "installing"
        ? { step: "confirm", preview: flow.preview, failure: action.failure }
        : flow;
    case "back":
      return flow.step === "confirm"
        ? { step: "source", source: flow.preview.source, failure: null }
        : flow;
    default:
      return assertNever(action, "InstallAction");
  }
}

/** 확인 화면에서 눈에 띄게 보일 위험 경고. 설명은 화면이 정보 아이콘 뒤에 둔다 */
export type InstallWarning =
  | { readonly kind: "shell" }
  | { readonly kind: "network" }
  | { readonly kind: "files" }
  | { readonly kind: "tools"; readonly tools: readonly string[] }
  | { readonly kind: "untrusted" }
  | { readonly kind: "checks"; readonly count: number };

export function warningsOf(preview: InstallPreview): readonly InstallWarning[] {
  const found: InstallWarning[] = [];
  if (preview.shell.length > 0) found.push({ kind: "shell" });
  if (preview.network.length > 0) found.push({ kind: "network" });
  if (preview.files.length > 0) found.push({ kind: "files" });
  if (preview.tools.length > 0) found.push({ kind: "tools", tools: preview.tools });
  if (preview.trustRequest === "untrusted") found.push({ kind: "untrusted" });
  const checks = preview.warnings.filter((issue) => issue.severity === "warning").length;
  if (checks > 0) found.push({ kind: "checks", count: checks });
  return found;
}

/** 화면(프레임)이 선언한 셸 기능 권한. 비밀 키 등록·설정 쓰기·파일 고르기와 저장은 `strong`이라 경고 색으로 보인다 */
export type BridgeAccess = {
  readonly capability: "files" | "notify" | "settingsWrite" | "secrets";
  readonly strong: boolean;
  /** 그 권한을 선언한 화면의 제목 */
  readonly screens: readonly string[];
};

/** 선언한 다리 권한을 권한마다 한 줄로 모은다. 순서는 `files`, `settingsWrite`, `secrets`, `notify`(강조가 먼저)다 */
export function bridgeAccessOf(preview: InstallPreview): readonly BridgeAccess[] {
  const order = ["secrets", "settingsWrite", "files", "notify"] as const;
  return order.flatMap((capability) => {
    const screens = preview.screens
      .filter((screen) => screen.capabilities.includes(capability))
      .map((screen) => screen.title);
    return screens.length === 0
      ? []
      : [{ capability, strong: capability !== "notify", screens } satisfies BridgeAccess];
  });
}

/** 확인 화면이 "요청하는 권한"에 보일 것이 하나도 없는가 */
export function accessIsEmpty(preview: InstallPreview): boolean {
  return warningsOf(preview).length === 0 && bridgeAccessOf(preview).length === 0;
}

/**
 * 설치가 끝난 뒤 실행 중인 판을 바꾼다. 같은 이름이 이미 돌아 호스트가 `needsReload`를 알릴 때만 `ext.reload`를 부른다.
 * 새 이름은 호스트가 설치 뒤 곧바로 싣는다(`now`, 켜기가 미뤄지면 `nextStepBoundary`이지만 `needsReload`는 없다).
 * 거절은 삼키지 않고 갈래로 돌려줘 화면이 보인다.
 */
export async function applyInstalled(
  reload: (name: string) => Promise<Result<null, CommandError>>,
  result: ExtInstallResult,
): Promise<InstallFailure | null> {
  if (result.needsReload !== true) return null;
  const done = await reload(result.name);
  return done.ok ? null : installFailureOf(done.error);
}

/** 설치 결과를 화면이 말하는 갈래. 파일은 복사됐는데 싣지 못한 상태(`notLoaded`)를 따로 보인다 */
export type InstallDone =
  /** 재시작 없이 목록에 올랐다 */
  | { readonly kind: "listed" }
  /** 실행 중인 turn이 있어 다음 단계 경계에서 켜지거나, 같은 이름의 판이 바뀐다 */
  | { readonly kind: "boundary" }
  /** 로더가 없어 다음 시작에 불러온다 */
  | { readonly kind: "restart" }
  /** 복사는 됐지만 싣지 못했다. `detail`은 첫 오류 진단의 문장이고 없으면 `null` */
  | {
      readonly kind: "notLoaded";
      readonly reason: "safe_mode" | "disabled" | "error";
      readonly detail: string | null;
    };

export function installDoneOf(result: ExtInstallResult): InstallDone {
  const failure = result.loadFailure;
  if (failure !== undefined) {
    if (failure.reason === "loader_unavailable") return { kind: "restart" };
    const reason =
      failure.reason === "safe_mode" || failure.reason === "disabled" ? failure.reason : "error";
    const first =
      failure.diagnostics.find((entry) => entry.severity === "error") ?? failure.diagnostics[0];
    return { kind: "notLoaded", reason, detail: first?.message ?? null };
  }
  if (result.appliesAt === "now") return { kind: "listed" };
  return result.appliesAt === "restart" ? { kind: "restart" } : { kind: "boundary" };
}

/** 폴더 선택 창의 답이 입력란에 하는 일. 취소는 입력란을 그대로 두고, 창을 못 연 실패는 한 줄로 알린다 */
export type PickOutcome =
  | { readonly kind: "source"; readonly source: string }
  | { readonly kind: "keep" }
  | { readonly kind: "failed" };

export function pickOutcomeOf(picked: Result<string | undefined, Thrown>): PickOutcome {
  if (!picked.ok) return { kind: "failed" };
  return picked.value === undefined ? { kind: "keep" } : { kind: "source", source: picked.value };
}
