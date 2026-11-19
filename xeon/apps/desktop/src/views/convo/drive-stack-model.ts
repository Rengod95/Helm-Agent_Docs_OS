import { t } from "@fresnel/client/i18n";
import type { DriveFrameView } from "@fresnel/contracts/extensions";
import { tokenCountText } from "../model-usage.ts";

// Drive 스택 그림(lcM6a·lcM6b, L4 desktop-ux §6.6.1): `drive.frames`의 프레임(아래 → 위)을 누가 Drive하고 누가 기다리는지로 바꾼다.
// 맨 아래는 기본 루프(플러그인 null)다. 위 프레임에 핸드오프한 프레임은 `waiting`이다. 순수 함수만 있다.
// 띠와 패널은 같은 값(`stateText`)을 쓴다: 둘 다 "맨 위 칸이 무엇을 하는가"를 같은 말로 말한다(lcM6b).

/** 한도 칸 하나: "3/8턴". 90%부터 경고 */
export type DriveMeter = {
  readonly kind: "turns" | "tokens" | "spawns";
  readonly text: string;
  /** 0..1, 막대의 채움 */
  readonly ratio: number;
  readonly warn: boolean;
};

/** 스택의 한 칸 */
export type DriveStep = {
  readonly key: string;
  /** 플러그인 이름. 기본 루프면 "기본" */
  readonly name: string;
  readonly core: boolean;
  readonly state: DriveFrameView["state"];
  /** 띠·패널이 같이 쓰는 상태 글: "Drive 중", "핸드오프하고 기다림", "답을 기다림", 기본 루프만 돌면 "Drive 없음" */
  readonly stateText: string;
  /** 핸드오프한 칸이면 넘겨받은 바로 위 칸의 이름 */
  readonly handedTo: string | null;
  readonly meters: readonly DriveMeter[];
};

export type DriveStackView = {
  /** 아래 → 위. 마지막이 지금 Drive를 쥔 칸이다 */
  readonly steps: readonly DriveStep[];
  /** 플러그인 프레임이 없다(기본 루프만 돈다) */
  readonly alone: boolean;
  /** 핸드오프하고 기다리는 플러그인 프레임이 있다 */
  readonly handoff: boolean;
  /** "기본 › helm › verifier" */
  readonly path: string;
};

const WARN_RATIO = 0.9;

function meterOf(kind: DriveMeter["kind"], used: number, max: number, text: string): DriveMeter {
  const ratio = max > 0 ? Math.min(1, used / max) : 1;
  return { kind, text, ratio, warn: max <= 0 || used / max >= WARN_RATIO };
}

/** 한도가 있는 칸만: 턴, 토큰, 위임 */
function driveMetersOf(frame: DriveFrameView): readonly DriveMeter[] {
  const out: DriveMeter[] = [];
  const { used, limits } = frame;
  if (limits.turns !== undefined) {
    out.push(
      meterOf(
        "turns",
        used.turns,
        limits.turns,
        t("desktop.convo.lead.turns", { used: used.turns, max: limits.turns }),
      ),
    );
  }
  if (limits.tokens !== undefined) {
    out.push(
      meterOf(
        "tokens",
        used.tokens,
        limits.tokens,
        t("desktop.convo.lead.tokens", {
          used: tokenCountText(used.tokens),
          max: tokenCountText(limits.tokens),
        }),
      ),
    );
  }
  if (limits.spawns !== undefined) {
    out.push(
      meterOf(
        "spawns",
        used.spawns,
        limits.spawns,
        t("desktop.convo.lead.spawns", { used: used.spawns, max: limits.spawns }),
      ),
    );
  }
  return out;
}

/** 칸 이름: 플러그인 이름, 기본 루프면 "기본" */
function stepNameOf(frame: DriveFrameView): string {
  return frame.plugin ?? t("desktop.drive.core");
}

/** 프레임 목록을 그림 값으로. 깊이 순서로 다시 줄 세운다(호스트 순서를 믿지 않는다) */
export function driveStackOf(frames: readonly DriveFrameView[]): DriveStackView {
  const ordered = frames.toSorted((a, b) => a.depth - b.depth);
  const alone = ordered.every((frame) => frame.plugin === null);
  const steps = ordered.map((frame, index): DriveStep => {
    const above = ordered[index + 1];
    return {
      key: frame.leaseId ?? `depth:${frame.depth}`,
      name: stepNameOf(frame),
      core: frame.plugin === null,
      state: frame.state,
      stateText: alone ? t("desktop.drive.alone") : driveStateTextOf(frame.state),
      handedTo: frame.state === "waiting" && above !== undefined ? stepNameOf(above) : null,
      meters: frame.plugin === null ? [] : driveMetersOf(frame),
    };
  });
  return {
    steps,
    alone,
    handoff: steps.some((step) => !step.core && step.state === "waiting"),
    path: steps.map((step) => step.name).join(" › "),
  };
}

/** 칸 상태의 글 */
function driveStateTextOf(state: DriveFrameView["state"]): string {
  if (state === "driving") return t("desktop.drive.driving");
  if (state === "waiting") return t("desktop.drive.waiting");
  return t("desktop.drive.asking");
}
