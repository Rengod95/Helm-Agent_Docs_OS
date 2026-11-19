import { t } from "@fresnel/client/i18n";
import type { DriveFrameView } from "@fresnel/contracts/extensions";
import { tokenCountText } from "../model-usage.ts";

// Drive 스택 그림(lcM6a, L4 desktop-ux §6.6.1): `drive.frames`의 프레임(아래 → 위)을 누가 이끌고 누가 기다리는지로 바꾼다.
// 맨 아래는 기본 루프(플러그인 null)다. 위 프레임에 핸드오프한 프레임은 `waiting`이다. 순수 함수만 있다.

/** 한도 칸 하나: "3/8턴". 90%를 넘으면 경고 */
export type DriveMeter = { readonly text: string; readonly warn: boolean };

/** 스택의 한 칸 */
export type DriveStep = {
  readonly key: string;
  /** 플러그인 이름. 기본 루프면 "기본" */
  readonly name: string;
  readonly core: boolean;
  readonly state: DriveFrameView["state"];
  readonly meters: readonly DriveMeter[];
};

export type DriveStackView = {
  /** 아래 → 위. 마지막이 지금 이끄는 칸이다 */
  readonly steps: readonly DriveStep[];
  /** 플러그인 프레임이 없다(기본 루프만 돈다) */
  readonly alone: boolean;
  /** 핸드오프하고 기다리는 플러그인 프레임이 있다 */
  readonly handoff: boolean;
  /** "기본 › helm › verifier" */
  readonly path: string;
};

const WARN_RATIO = 0.9;

function warn(used: number, max: number): boolean {
  return max > 0 && used / max >= WARN_RATIO;
}

/** 한도가 있는 칸만: 턴, 토큰, 위임 */
function driveMetersOf(frame: DriveFrameView): readonly DriveMeter[] {
  const out: DriveMeter[] = [];
  const { used, limits } = frame;
  if (limits.turns !== undefined) {
    out.push({
      text: t("desktop.convo.lead.turns", { used: used.turns, max: limits.turns }),
      warn: warn(used.turns, limits.turns),
    });
  }
  if (limits.tokens !== undefined) {
    out.push({
      text: t("desktop.convo.lead.tokens", {
        used: tokenCountText(used.tokens),
        max: tokenCountText(limits.tokens),
      }),
      warn: warn(used.tokens, limits.tokens),
    });
  }
  if (limits.spawns !== undefined) {
    out.push({
      text: t("desktop.convo.lead.spawns", { used: used.spawns, max: limits.spawns }),
      warn: warn(used.spawns, limits.spawns),
    });
  }
  return out;
}

/** 프레임 목록을 그림 값으로. 깊이 순서로 다시 줄 세운다(호스트 순서를 믿지 않는다) */
export function driveStackOf(frames: readonly DriveFrameView[]): DriveStackView {
  const ordered = frames.toSorted((a, b) => a.depth - b.depth);
  const steps = ordered.map((frame): DriveStep => ({
    key: frame.leaseId ?? `depth:${frame.depth}`,
    name: frame.plugin ?? t("desktop.drive.core"),
    core: frame.plugin === null,
    state: frame.state,
    meters: frame.plugin === null ? [] : driveMetersOf(frame),
  }));
  const plugins = steps.filter((step) => !step.core);
  return {
    steps,
    alone: plugins.length === 0,
    handoff: plugins.some((step) => step.state === "waiting"),
    path: steps.map((step) => step.name).join(" › "),
  };
}

/** 칸 상태의 글 */
export function driveStateTextOf(state: DriveFrameView["state"]): string {
  if (state === "driving") return t("desktop.drive.driving");
  if (state === "waiting") return t("desktop.drive.waiting");
  return t("desktop.drive.asking");
}
