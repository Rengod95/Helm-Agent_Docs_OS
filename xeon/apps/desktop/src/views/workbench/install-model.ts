import { assertNever, type Result, type Thrown } from "@fresnel/contracts";
import { hookFold } from "@fresnel/client/workbench/canvas";
import type { DevkitReason, InstallPreview } from "@fresnel/contracts/services";
import { WIRE_ERRORS } from "@fresnel/contracts/wire";
import type { CommandError } from "../commands.ts";

// 앱 안 설치의 순수 부분: 단계 전이, 실패 갈래, 거절 사유 목록, 미리 보기를 화면이 그릴 경고 목록으로 바꾸기. 화면은 `install-dialog.tsx`다.
// 설치는 검토함을 거친다: 미리 보기는 `plugin.draft.create`, 설치는 `pluginReview.submitDraft`다. 설치 요청이 들어가면 상자를 닫고
// 컨트롤러가 "검토함으로 보냈다"를 알린다. 결과 화면(설치 완료)은 없다.

/** 설치 흐름의 단계. 출처 입력 → 읽는 중 → 권한 확인 → 설치하는 중 → 결과 */
export type InstallFlow =
  | {
      readonly step: "source";
      readonly source: string;
      readonly failure: InstallFailure | null;
      /** 거절된 입력의 사유 목록. 실패가 없거나 사유가 없으면 빈 목록이다 */
      readonly reasons: readonly InstallReason[];
    }
  | { readonly step: "previewing"; readonly source: string }
  | {
      readonly step: "confirm";
      readonly preview: InstallPreview;
      readonly failure: InstallFailure | null;
      /** 설치가 거절된 사유 목록. 실패가 없거나 사유가 없으면 빈 목록이다 */
      readonly reasons: readonly InstallReason[];
    }
  | { readonly step: "installing"; readonly preview: InstallPreview };

export type InstallFailure =
  | "safe_mode"
  | "managed_locked"
  | "source_changed"
  | "invalid_input"
  | "not_absolute"
  | "no_manifest"
  | "not_found"
  | "denied"
  | "offline"
  | "unsupported"
  /** 이 앱이 보내지 않는 명령(`not_available`). 호스트가 거절한 것이 아니다 */
  | "not_available"
  | "other";

export const INITIAL_INSTALL_FLOW: InstallFlow = {
  step: "source",
  source: "",
  failure: null,
  reasons: [],
};

const SAFE_MODE_CODE = WIRE_ERRORS["extension.safeModeActive"].code;
const ISSUE_KINDS: Readonly<Record<string, InstallFailure>> = {
  invalid_input: "invalid_input",
  not_absolute: "not_absolute",
  no_manifest: "no_manifest",
  not_found: "not_found",
  denied: "denied",
  source_changed: "source_changed",
  managed_locked: "managed_locked",
};

/** 명령 오류를 화면이 문구를 고르는 갈래로 바꾼다. 알 수 없는 것은 `other`다 */
export function installFailureOf(error: CommandError): InstallFailure {
  if (error.kind === "offline") return "offline";
  if (error.kind === "unsupported") return "unsupported";
  if (error.kind === "not_available") return "not_available";
  if (error.kind !== "rejected") return "other";
  if (error.code === SAFE_MODE_CODE) return "safe_mode";
  const head = error.issue?.split(":")[0];
  return (head === undefined ? undefined : ISSUE_KINDS[head]) ?? "other";
}

/** 실패 문장 갈래. 일반 거절(`invalid_input`·`other`)에 사유 목록이 있으면 경로를 의심하는 일반 문장 대신 "검사에서 걸렸다"(`checked`)를 쓴다. 사유가 원인을 말하기 때문이다 */
export type InstallFailureHead = InstallFailure | "checked";

export function installFailureHeadOf(
  failure: InstallFailure,
  reasons: readonly InstallReason[],
): InstallFailureHead {
  if (reasons.length === 0) return failure;
  return failure === "invalid_input" || failure === "other" ? "checked" : failure;
}

/** 화면이 문장을 고르는 거절 사유 코드. 엔진이 보내는 코드 가운데 문장을 가진 것만 든다. 그 밖의 코드는 `other`다 */
const INSTALL_REASON_CODES = [
  "not_absolute",
  "folder_missing",
  "no_manifest",
  "manifest_json",
  "unknown_key",
  "missing_field",
  "invalid_value",
  "entry_format",
  "entry_missing",
  "builtin_trust",
  "name_invalid",
  "name_reserved",
] as const;
export type InstallReasonKey = (typeof INSTALL_REASON_CODES)[number] | "other";

/** 화면이 그릴 거절 사유 한 건. `key`는 문장을 고르는 코드다. `field`(플러그인 파일 안 경로)와 `line`(원문 줄)은 알 때만 있다 */
export interface InstallReason {
  readonly key: InstallReasonKey;
  readonly field?: string;
  readonly line?: number;
}

/** 엔진 사유 한 건을 화면 사유로 바꾼다. 검사기 원문 `message`는 버린다(영어 내부 문장이라 보이지 않는다). 모르는 코드는 `other`다 */
export function installReasonOf(reason: DevkitReason): InstallReason {
  const key = INSTALL_REASON_CODES.find((known) => known === reason.code) ?? "other";
  return {
    key,
    ...(reason.field === undefined ? {} : { field: reason.field }),
    ...(reason.line === undefined ? {} : { line: reason.line }),
  };
}

/** 명령 오류가 싣는 거절 사유를 화면 사유로 바꾼다. 거절이 아니거나 사유가 없으면 빈 목록이다. 화면에서 같아 보이는 사유는 한 번만 둔다 */
export function installReasonsOf(error: CommandError): readonly InstallReason[] {
  if (error.kind !== "rejected") return [];
  const seen = new Set<string>();
  const out: InstallReason[] = [];
  for (const reason of (error.reasons ?? []).map(installReasonOf)) {
    const key = installReasonKeyOf(reason);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(reason);
  }
  return out;
}

/** 목록에서 사유 하나를 가르는 키. 화면에 보이는 것(문장 코드, 자리)만 쓴다 */
export function installReasonKeyOf(reason: InstallReason): string {
  return `${reason.key}|${reason.field ?? ""}|${reason.line ?? ""}`;
}

export type InstallAction =
  | { readonly type: "source"; readonly source: string }
  | { readonly type: "previewStart" }
  | { readonly type: "previewed"; readonly preview: InstallPreview }
  | {
      readonly type: "previewFailed";
      readonly failure: InstallFailure;
      readonly reasons: readonly InstallReason[];
    }
  | { readonly type: "installStart" }
  | {
      readonly type: "installFailed";
      readonly failure: InstallFailure;
      readonly reasons: readonly InstallReason[];
    }
  | { readonly type: "back" };

/** 단계 전이. 맞지 않는 단계에서 온 동작은 흐름을 그대로 둔다 */
export function installReduce(flow: InstallFlow, action: InstallAction): InstallFlow {
  switch (action.type) {
    // 출처를 바꾸거나 뒤로 가면 지난 거절과 그 사유는 남기지 않는다
    case "source":
      return flow.step === "source"
        ? { step: "source", source: action.source, failure: null, reasons: [] }
        : flow;
    case "previewStart":
      return flow.step === "source" && flow.source.trim() !== ""
        ? { step: "previewing", source: flow.source.trim() }
        : flow;
    case "previewed":
      return flow.step === "previewing"
        ? { step: "confirm", preview: action.preview, failure: null, reasons: [] }
        : flow;
    case "previewFailed":
      return flow.step === "previewing"
        ? {
            step: "source",
            source: flow.source,
            failure: action.failure,
            reasons: action.reasons,
          }
        : flow;
    case "installStart":
      return flow.step === "confirm" ? { step: "installing", preview: flow.preview } : flow;
    case "installFailed":
      return flow.step === "installing"
        ? {
            step: "confirm",
            preview: flow.preview,
            failure: action.failure,
            reasons: action.reasons,
          }
        : flow;
    case "back":
      return flow.step === "confirm"
        ? { step: "source", source: flow.preview.source, failure: null, reasons: [] }
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
  /** 도구 호출을 막을 수 있는 훅(`tool.call.before`, `guard.tool.before`). `hooks`는 훅 이름이다 */
  | { readonly kind: "toolHooks"; readonly hooks: readonly string[] }
  | { readonly kind: "checks"; readonly count: number };

/** 훅이 할 수 있는 일. 훅 선언의 fold가 정한다: first는 막기, chain·collect는 고치기, tap은 보기만 */
export type InstallHookPower = "block" | "modify" | "observe" | "unknown";

/** 확인 화면이 그릴 훅 한 줄. `id`는 훅 이름이고 화면이 그 이름의 사람 말 사건 이름을 고른다 */
export interface InstallHook {
  readonly id: string;
  readonly power: InstallHookPower;
  /** 도구 호출을 막을 수 있는가(눈에 띄게 보인다) */
  readonly blocksTools: boolean;
}

const TOOL_BLOCKING_HOOKS: ReadonlySet<string> = new Set(["tool.call.before", "guard.tool.before"]);

/** 미리 보기가 든 훅을 줄로 바꾼다. 막을 수 있는 것이 먼저고, 같은 힘 안에서는 선언 순서를 지킨다 */
export function hooksOf(preview: InstallPreview): readonly InstallHook[] {
  const rank: Readonly<Record<InstallHookPower, number>> = {
    block: 0,
    modify: 1,
    observe: 2,
    unknown: 3,
  };
  const rows = preview.hooks.map((id): InstallHook => {
    const fold = hookFold(id);
    const power: InstallHookPower =
      fold === undefined
        ? "unknown"
        : fold === "first"
          ? "block"
          : fold === "tap"
            ? "observe"
            : "modify";
    return { id, power, blocksTools: TOOL_BLOCKING_HOOKS.has(id) };
  });
  return rows
    .map((row, index) => ({ row, index }))
    .toSorted((a, b) => rank[a.row.power] - rank[b.row.power] || a.index - b.index)
    .map((entry) => entry.row);
}

export function warningsOf(preview: InstallPreview): readonly InstallWarning[] {
  const found: InstallWarning[] = [];
  if (preview.shell.length > 0) found.push({ kind: "shell" });
  if (preview.network.length > 0) found.push({ kind: "network" });
  if (preview.files.length > 0) found.push({ kind: "files" });
  if (preview.tools.length > 0) found.push({ kind: "tools", tools: preview.tools });
  if (preview.trustRequest === "untrusted") found.push({ kind: "untrusted" });
  const toolHooks = hooksOf(preview).filter((hook) => hook.blocksTools);
  if (toolHooks.length > 0) found.push({ kind: "toolHooks", hooks: toolHooks.map((h) => h.id) });
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

/** 폴더 선택 창의 답이 입력란에 하는 일. 취소는 입력란을 그대로 두고, 창을 못 연 실패는 한 줄로 알린다 */
export type PickOutcome =
  | { readonly kind: "source"; readonly source: string }
  | { readonly kind: "keep" }
  | { readonly kind: "failed" };

export function pickOutcomeOf(picked: Result<string | undefined, Thrown>): PickOutcome {
  if (!picked.ok) return { kind: "failed" };
  return picked.value === undefined ? { kind: "keep" } : { kind: "source", source: picked.value };
}
