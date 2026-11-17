import { assertNever } from "@fresnel/contracts";
import { t, type MessageId } from "@fresnel/client/i18n";
import type { PermissionMode } from "@fresnel/contracts/services";
import type { ConvoMarker } from "../../state/engine/convo.ts";
import type { LeadSegment, TurnSummary } from "../../state/engine/index.ts";
import { prettyModelId, tokenCountText } from "../model-usage.ts";
import { permissionModeOf } from "../permission-mode-model.ts";
import { durationText } from "./tool-view-model.ts";

// 턴 발 줄·멈춘 사유·변화 표지·주도 구간 머리의 글(dzT2a 시안 7, 8, 10절). 순수 함수이고 화면 없이 시험한다.

/** 모델 참조를 화면 이름으로 바꾸는 함수. 화면은 카탈로그 이름(`useModelNameOf`)을 넘기고, 넘기지 않으면 id를 다듬은 이름이다 */
export type ModelNameOf = (ref: string) => string;

/**
 * 이번 턴이 새로 쓴 토큰: 출력 + 캐시를 거치지 않은 입력. 모델 사용량의 `input`은 이미 캐시 읽기·쓰기를 뺀 값이다
 * (`totalTokens = input + output + cacheRead + cacheWrite`). 캐시 쓰기(처음 보낸 시스템 프롬프트 등)와 캐시 읽기는 전체 내역에만 둔다
 */
export function newTokensOf(usage: NonNullable<TurnSummary["usage"]>): number {
  return usage.input + usage.output;
}

/** 턴 발 줄 오른쪽 메타: "12단계 · 1분 4초 · 새로 412 토큰 · Claude Opus 5" */
export function turnMetaOf(turn: TurnSummary, nameOf: ModelNameOf = prettyModelId): string {
  const parts: string[] = [];
  if (turn.steps > 0) parts.push(t("desktop.convo.foot.steps", { count: turn.steps }));
  if (turn.durationMs !== null) parts.push(durationText(turn.durationMs));
  if (turn.usage !== null && newTokensOf(turn.usage) > 0) {
    parts.push(
      t("desktop.convo.foot.newTokens", { tokens: tokenCountText(newTokensOf(turn.usage)) }),
    );
  }
  if (turn.model !== null) parts.push(nameOf(turn.model));
  return parts.join(" · ");
}

/** 메타 툴팁의 상세 줄: 전체(캐시 포함), 입력, 출력, 캐시, 비용, 모델 id */
export function turnDetailLinesOf(turn: TurnSummary): readonly string[] {
  const usage = turn.usage;
  if (usage === null) return turn.model === null ? [] : [turn.model];
  const lines = [
    t("desktop.convo.foot.total", { n: usage.totalTokens }),
    t("desktop.convo.foot.input", { n: usage.input }),
    t("desktop.convo.foot.output", { n: usage.output }),
  ];
  if (usage.cacheRead + usage.cacheWrite > 0) {
    lines.push(t("desktop.convo.foot.cache", { read: usage.cacheRead, write: usage.cacheWrite }));
  }
  if (usage.cost !== null && usage.cost > 0)
    lines.push(t("desktop.convo.foot.cost", { cost: usage.cost }));
  if (turn.model !== null) lines.push(turn.model);
  return lines;
}

/** 멈춘 사유 안내. 계속할 수 있으면 `canContinue` */
export type StopNotice = {
  readonly text: string;
  readonly canContinue: boolean;
  readonly tone: "warning" | "quiet";
};

export function stopNoticeOf(turn: TurnSummary): StopNotice | null {
  const end = turn.end;
  if (end?.kind === "limit") {
    return {
      text:
        end.limit === "step_limit"
          ? t("desktop.convo.stop.stepLimit", { steps: turn.steps })
          : t("desktop.convo.stop.childLimit"),
      canContinue: true,
      tone: "warning",
    };
  }
  // 알림은 되풀이와 검사 한도 두 가지다. 먼저 온 것을 보인다
  const notice = turn.notices[0];
  if (notice !== undefined) {
    if (notice.code === "repeat_detected") {
      return {
        text:
          notice.count === null
            ? t("desktop.convo.stop.repeat")
            : t("desktop.convo.stop.repeatCount", { count: notice.count }),
        canContinue: true,
        tone: "warning",
      };
    }
    return {
      text:
        notice.limit === null
          ? t("desktop.convo.stop.gate")
          : t("desktop.convo.stop.gateCount", { limit: notice.limit }),
      canContinue: true,
      tone: "warning",
    };
  }
  if (end?.kind === "interrupted") {
    return {
      text:
        end.code === "user" || end.code === null
          ? t("desktop.convo.stop.user")
          : t("desktop.convo.stop.interrupted"),
      canContinue: false,
      tone: "quiet",
    };
  }
  return null;
}

/** 권한 모드의 화면 이름. 입력창 칩과 같은 키다 */
const PERMISSION_MODE_NAME: Readonly<Record<PermissionMode, MessageId>> = {
  default: "desktop.composer.mode.default",
  acceptEdits: "desktop.composer.mode.acceptEdits",
  bypass: "desktop.composer.mode.bypass",
};

/** 표지에 보일 권한 모드 이름. 세 모드가 아닌 값(옛 기록·확장 값)은 그대로 둔다 */
function permissionModeNameOf(value: string): string {
  const mode = permissionModeOf(value);
  return mode === null ? value : t(PERMISSION_MODE_NAME[mode]);
}

/** 변화 표지 한 줄. 모델은 화면 이름(`nameOf`)으로, 권한 모드는 칩과 같은 이름으로 적는다(DP-144) */
export function markerTextOf(marker: ConvoMarker, nameOf: ModelNameOf = prettyModelId): string {
  const change = marker.change;
  switch (change.kind) {
    case "model":
      return t("desktop.convo.marker.model", { model: nameOf(change.model) });
    case "permission_mode":
      return change.value === null
        ? t("desktop.convo.marker.permissionReset")
        : t("desktop.convo.marker.permission", { mode: permissionModeNameOf(change.value) });
    case "resumed":
      return change.mode === "auto"
        ? t("desktop.convo.marker.resumedAuto", { attempt: change.attempt })
        : t("desktop.convo.marker.resumed");
    case "scheduled_start":
      return t("desktop.convo.marker.scheduled");
    case "leaf_moved":
      return change.reason === "branch"
        ? t("desktop.convo.marker.branched")
        : change.reason === "restore"
          ? t("desktop.convo.marker.restored")
          : t("desktop.convo.marker.rewound");
    case "branch_summarized":
      return t("desktop.convo.marker.branchSummarized");
    default:
      return assertNever(change, "ConvoMarker");
  }
}

/** 시각 "14:02" */
export function clockOf(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  return t("desktop.convo.clock", { at: new Date(at) });
}

export type LeadMeter = { readonly text: string; readonly warn: boolean };

/** 주도 구간 한도 칸: "턴 3/8", "토큰 1.2만/5만", "위임 1/3". 한도가 없는 칸은 뺀다. 90%를 넘으면 경고 */
export function leadMetersOf(lead: LeadSegment): readonly LeadMeter[] {
  const out: LeadMeter[] = [];
  const meter = (
    used: number,
    max: number | undefined,
    id: "turns" | "tokens" | "spawns",
  ): void => {
    if (max === undefined) return;
    const warn = max > 0 && used / max >= 0.9;
    if (id === "turns") out.push({ text: t("desktop.convo.lead.turns", { used, max }), warn });
    if (id === "tokens") {
      out.push({
        text: t("desktop.convo.lead.tokens", {
          used: tokenCountText(used),
          max: tokenCountText(max),
        }),
        warn,
      });
    }
    if (id === "spawns") out.push({ text: t("desktop.convo.lead.spawns", { used, max }), warn });
  };
  meter(lead.used.turns, lead.limits.maxTurns, "turns");
  meter(lead.used.tokens, lead.limits.maxTokens, "tokens");
  meter(lead.used.spawns, lead.limits.maxSpawns, "spawns");
  return out;
}

/** 주도자 이름. scope id의 접두(`ext:`)를 뗀다 */
export function leaderNameOf(scopeId: string): string {
  return scopeId.replace(/^ext:/, "");
}

export function releaseTextOf(lead: LeadSegment): string {
  const name = leaderNameOf(lead.scopeId);
  switch (lead.releaseReason) {
    case "budget":
      return t("desktop.convo.lead.release.budget", { name });
    case "idle":
      return t("desktop.convo.lead.release.idle", { name });
    case "waiting":
      return t("desktop.convo.lead.release.waiting", { name });
    case "error":
      return t("desktop.convo.lead.release.error", { name });
    case "disabled":
    case "revoked":
      return t("desktop.convo.lead.release.revoked", { name });
    case "restart":
      return t("desktop.convo.lead.release.restart", { name });
    case "done":
    case null:
      return t("desktop.convo.lead.release.done", { name });
    default:
      return assertNever(lead.releaseReason, "LeaseReleaseReason");
  }
}
