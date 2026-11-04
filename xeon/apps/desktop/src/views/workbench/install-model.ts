import { assertNever } from "@fresnel/contracts";
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
  | { readonly step: "done"; readonly result: ExtInstallResult };

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
  | { readonly type: "installed"; readonly result: ExtInstallResult }
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
      return flow.step === "installing" ? { step: "done", result: action.result } : flow;
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
