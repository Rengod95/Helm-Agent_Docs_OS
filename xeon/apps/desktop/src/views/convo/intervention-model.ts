import { assertNever } from "@fresnel/contracts";
import { t } from "@fresnel/client/i18n";
import type { ApprovalTrail, Intervention } from "../../state/engine/convo.ts";

// 도구 줄에 붙는 개입 꼬리표(dzT2a 시안 5절). 순수 함수이고 화면 없이 시험한다.
// 훅·가드가 막은 것은 줄의 상태 칩이 이미 말하므로 꼬리표로 다시 적지 않는다. 고침, 샌드박스 밖 실행, 신뢰 안 된 읽기, 시크릿, 승인 기록만 붙인다.

export type TagIcon = "wand" | "shield" | "eye" | "key" | "approval";

export type InterventionTag = {
  readonly key: string;
  readonly icon: TagIcon;
  readonly tone: "warning" | "neutral";
  /** 꼬리표 글(짧게) */
  readonly label: string;
  /** 팝오버 제목 */
  readonly title: string;
  /** 팝오버 설명 */
  readonly body: string;
  /** 개입한 확장 이름("기록 보기"의 대상). 없으면 null */
  readonly extension: string | null;
};

function interventionTag(i: Intervention, index: number): InterventionTag | null {
  const key = `${i.kind}:${i.seq}:${index}`;
  const extension = i.extension;
  switch (i.kind) {
    case "hook_denied":
    case "guard_denied":
      return null;
    case "hook_patched":
      return {
        key,
        icon: "wand",
        tone: "neutral",
        label:
          extension === null
            ? t("desktop.convo.tag.patched")
            : t("desktop.convo.tag.patchedBy", { extension }),
        title: t("desktop.convo.tag.patched.title"),
        body: t("desktop.convo.tag.patched.body", { extensions: i.detail ?? extension ?? "" }),
        extension,
      };
    case "sandbox_bypassed":
      return {
        key,
        icon: "shield",
        tone: "warning",
        label: t("desktop.convo.tag.unsandboxed"),
        title: t("desktop.convo.tag.unsandboxed.title"),
        body: i.reason ?? i.detail ?? t("desktop.convo.tag.unsandboxed.body"),
        extension,
      };
    case "untrusted_read":
      return {
        key,
        icon: "eye",
        tone: "warning",
        label: t("desktop.convo.tag.untrusted"),
        title: t("desktop.convo.tag.untrusted.title"),
        body: i.reason ?? i.detail ?? t("desktop.convo.tag.untrusted.body"),
        extension,
      };
    case "secret_used":
    case "secret_approved":
    case "secret_masked":
      return {
        key,
        icon: "key",
        tone: "neutral",
        label:
          i.detail === null
            ? t("desktop.convo.tag.secret")
            : t("desktop.convo.tag.secretNamed", { name: i.detail }),
        title: t(
          i.kind === "secret_masked"
            ? "desktop.convo.tag.secretMasked.title"
            : "desktop.convo.tag.secret.title",
        ),
        body: i.reason ?? t("desktop.convo.tag.secret.body"),
        extension,
      };
    case "secret_denied":
      return {
        key,
        icon: "key",
        tone: "warning",
        label: t("desktop.convo.tag.secretDenied"),
        title: t("desktop.convo.tag.secretDenied"),
        body: i.reason ?? i.detail ?? "",
        extension,
      };
    default:
      return assertNever(i.kind, "InterventionKind");
  }
}

/** 승인 기록 꼬리표 글: "허용함 · 이번만" */
function approvalLabelOf(trail: ApprovalTrail): string {
  if (trail.decision === "deny") return t("desktop.convo.tag.approval.denied");
  const scope =
    trail.remember === "always"
      ? t("desktop.convo.tag.approval.always")
      : trail.remember === "thread"
        ? t("desktop.convo.tag.approval.thread")
        : t("desktop.convo.tag.approval.once");
  return t("desktop.convo.tag.approval.allowed", { scope });
}

function approvalTag(trail: ApprovalTrail): InterventionTag | null {
  // 사람이 고른 것만 기록으로 남긴다(취소·만료·대체는 줄의 상태가 말한다)
  if (trail.resolvedBy !== "user" && trail.resolvedBy !== "noninteractive") return null;
  const by =
    trail.resolvedBy === "noninteractive"
      ? t("desktop.convo.tag.approval.byRule")
      : t("desktop.convo.tag.approval.byUser");
  return {
    key: `approval:${trail.approvalId}`,
    icon: "approval",
    tone: "neutral",
    label: approvalLabelOf(trail),
    title: trail.title === "" ? t("desktop.convo.tag.approval.title") : trail.title,
    body: by,
    extension: trail.caller.startsWith("ext:") ? trail.caller.slice(4) : null,
  };
}

/** 줄 하나의 꼬리표. 승인 기록이 앞, 개입이 뒤(받은 순서) */
export function interventionTagsOf(
  interventions: readonly Intervention[],
  approvals: readonly ApprovalTrail[],
): readonly InterventionTag[] {
  return [
    ...approvals.flatMap((a) => {
      const tag = approvalTag(a);
      return tag === null ? [] : [tag];
    }),
    ...interventions.flatMap((i, index) => {
      const tag = interventionTag(i, index);
      return tag === null ? [] : [tag];
    }),
  ];
}
