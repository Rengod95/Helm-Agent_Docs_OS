import { t } from "@fresnel/client/i18n";
import { extNameOf } from "@fresnel/client/workbench";
import type { DriveFrameView } from "@fresnel/contracts/extensions";
import type { BeamState } from "../effects/beam.tsx";
import { tokenCountText } from "../model-usage.ts";

// Drive 스택 그림(lcM6a·lcM6b, L4 desktop-ux §6.6.1): `drive.frames`의 프레임(아래 → 위)을 누가 Drive하고 누가 기다리는지로 바꾼다.
// 맨 아래는 기본 루프(플러그인 null)다. 위 프레임에 핸드오프한 프레임은 `waiting`이다. 순수 함수만 있다.
// 띠와 패널은 같은 값(`stateText`)을 쓴다: 둘 다 "맨 위 칸이 무엇을 하는가"를 같은 말로 말한다(lcM6b).

/** 한도 칸 하나: "3/8턴". 90%부터 경고. 남은 양은 글로 풀지 않고 숫자와 막대로만 보인다(lcM6d) */
export type DriveMeter = {
  readonly kind: "turns" | "tokens" | "spawns";
  readonly text: string;
  /** 이름 없는 양("3/8", "9,000/20만"). 카드의 한도 줄은 이름 칸이 따로 있어 이것을 쓴다 */
  readonly amount: string;
  /** 0..1, 막대의 채움 */
  readonly ratio: number;
  readonly warn: boolean;
};

/** 칸 플러그인의 판. 리뷰된 판이면 짧은 해시(7자), 드래프트(테스트 런에서만 돈다)면 draft, 모르면 null */
export type DriveVersion =
  | { readonly kind: "approved"; readonly short: string }
  | { readonly kind: "draft" };

/** 스택의 한 칸 */
export type DriveStep = {
  readonly key: string;
  /** 임대 id. 기본 루프면 null */
  readonly leaseId: string | null;
  readonly version: DriveVersion | null;
  /** 플러그인 이름. 기본 루프면 "기본" */
  readonly name: string;
  readonly core: boolean;
  readonly state: DriveFrameView["state"];
  /** 띠·패널이 같이 쓰는 상태 글: "Driving", "핸드오프하고 기다림", "답을 기다림", 기본 루프만 돌면 "Drive 없음" */
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
  const amount =
    kind === "tokens"
      ? `${tokenCountText(used)}/${tokenCountText(max)}`
      : `${String(used)}/${String(max)}`;
  return { kind, text, amount, ratio, warn: max <= 0 || used / max >= WARN_RATIO };
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
    // 엔진은 코어 루프 칸을 늘 driving으로 보낸다(ext-host lease.ts framesOf). 위에 플러그인 칸이 있으면 코어는 그 칸이 끝나기를
    // 기다리는 자리라 화면은 waiting으로 읽는다(띠와 판에 "Driving"이 둘 나오지 않게)
    const state = frame.plugin === null && above !== undefined ? "waiting" : frame.state;
    return {
      key: frame.leaseId ?? `depth:${frame.depth}`,
      leaseId: frame.leaseId,
      version: driveVersionOf(frame.versionId),
      name: stepNameOf(frame),
      core: frame.plugin === null,
      state,
      stateText: alone
        ? t("desktop.drive.alone")
        : frame.plugin === null && state === "waiting"
          ? t("desktop.drive.coreWaiting")
          : driveStateTextOf(state),
      // 기본 루프는 핸드오프하지 않는다(플러그인 Drive가 그 위에 얹힌다)
      handedTo:
        frame.plugin !== null && state === "waiting" && above !== undefined
          ? stepNameOf(above)
          : null,
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

/** `versionId`(`sha256:<hex>`, `draft:<draftId>:<해시 앞 8자>`)를 판 표시로. 모르는 모양이면 null */
export function driveVersionOf(versionId: string | null): DriveVersion | null {
  if (versionId === null) return null;
  if (versionId.startsWith("draft:")) return { kind: "draft" };
  const hex = /^sha256:([0-9a-f]{7,})$/i.exec(versionId)?.[1];
  return hex === undefined ? null : { kind: "approved", short: hex.slice(0, 7).toLowerCase() };
}

// ── 지금 Drive를 쥔 칸의 카드(lcM6c·lcM6d) ────────────────────────

/** 지금 무엇을 하나: 턴을 돌림, 턴 없이 쥐고 있음(다음 말을 받음), 사람의 답을 기다림 */
type DriveActivity = "turn" | "holding" | "asking";

/**
 * 맨 위 판(지금 Drive를 쥔 칸)이 보이는 값. 어떻게 쥐었나와 시작 시각의 줄은 없앴다(lcM6d, 사용자 2026-11-20 "불필요").
 * 넘겨받은 입력(핸드오프나 명령이 건넨 한 줄)은 이 칸이 무엇을 하는지라 남긴다
 */
export type DriveCardView = {
  readonly step: DriveStep;
  /** 넘겨받은 입력의 한 줄. 스타트 Drive이거나 임대 사건을 못 봤으면 null */
  readonly input: string | null;
  readonly activity: DriveActivity;
  /** 도는 하위 에이전트(병렬 갈래) 수 */
  readonly branches: number;
  /** 끝나면 돌아갈 칸의 이름(바로 아래 칸). 아래가 없으면 null */
  readonly next: string | null;
};

/** 카드가 읽는 임대 기록 한 건(거울의 Drive 구간에서 필요한 것만) */
export type DriveLeaseFacts = {
  readonly leaseId: string;
  readonly parent: string | null;
  readonly requestId: string | null;
  readonly inputLine: string | null;
  readonly branchesRunning: number;
};

/**
 * 맨 위 칸의 카드 값. 플러그인 프레임이 없으면 null(카드 대신 "기본 · Drive 없음" 판).
 * `running`은 이 대화에 도는 턴이 있는가다. 맨 위 칸이 답을 기다리면 asking, 턴이 돌면 turn, 아니면 holding.
 * 입력 줄은 핸드오프(`parent`)나 사용자 명령(`requestId`)으로 쥔 임대에만 있다(스타트 Drive는 넘겨받은 입력이 없다)
 */
export function driveCardOf(
  view: DriveStackView,
  leases: readonly DriveLeaseFacts[],
  running: boolean,
): DriveCardView | null {
  const top = view.steps.at(-1);
  if (view.alone || top === undefined) return null;
  const below = view.steps.at(-2);
  const lease = top.leaseId === null ? undefined : leases.find((l) => l.leaseId === top.leaseId);
  const handed = lease !== undefined && (lease.parent !== null || lease.requestId !== null);
  return {
    step: top,
    input: handed ? lease.inputLine : null,
    activity: top.state === "asking" ? "asking" : running ? "turn" : "holding",
    branches: lease?.branchesRunning ?? 0,
    next: below?.name ?? null,
  };
}

/** 칸 상태의 글 */
function driveStateTextOf(state: DriveFrameView["state"]): string {
  if (state === "driving") return t("desktop.drive.driving");
  if (state === "waiting") return t("desktop.drive.waiting");
  return t("desktop.drive.asking");
}

/**
 * 띠의 빛(lcM6c). 띠가 보이면(플러그인 프레임이 있으면) 입력창 빛을 띠가 맡는다(`band: true`). 빛의 상태는 입력창과 같은 규칙이다:
 * 승인을 기다리는 요청이 있으면 wait(경고 색 정지 선, 답을 기다리는 Drive가 여기다), 맨 위 칸이 Drive 중이고 턴이 돌면 run, 아니면 off.
 * 띠가 없으면 `band: false`, `state: "off"`이고 입력창이 전처럼 빛을 낸다
 */
export function driveBandBeamOf(input: {
  readonly view: DriveStackView | null;
  readonly running: boolean;
  readonly approvals: number;
}): { readonly band: boolean; readonly state: BeamState } {
  const { view } = input;
  const top = view?.steps.at(-1);
  if (view === null || view.alone || top === undefined) return { band: false, state: "off" };
  if (input.approvals > 0) return { band: true, state: "wait" };
  return { band: true, state: input.running && top.state === "driving" ? "run" : "off" };
}

/** 입력창 위 Drive 띠를 그리는가: 플러그인 프레임이 하나라도 있으면 그린다(기본 루프만 돌면 그리지 않는다) */
export function driveBandShownOf(view: DriveStackView): boolean {
  return !view.alone && view.steps.length > 0;
}

/** "Driving by {name}"을 이름 앞 글, 이름, 이름 뒤 글로 나눈 것. 앞뒤 글의 이름 쪽 빈칸은 떼어 낸다(그리는 쪽이 간격을 둔다) */
export type DrivingByParts = {
  readonly before: string;
  readonly name: string;
  readonly after: string;
};

/** 이름 자리 표시. 번역 글에 나올 수 없는 제어 문자다 */
/**
 * Drive 칸의 플러그인 이름(Registration id, `이름` 또는 `이름/멤버`)을 사람이 읽는 이름으로(m6Mb, AGE-33). 설치 목록의 보이는 이름을 쓰고,
 * 멤버면 "<플러그인>의 <멤버>"다. 목록에 없는 이름(코어 칸의 "기본" 포함)은 그대로다
 */
export function driveDisplayNameOf(
  id: string,
  entries: readonly { readonly name: string; readonly displayName: string }[],
): string {
  const slash = id.indexOf("/");
  const plugin = slash < 0 ? id : id.slice(0, slash);
  const entry = entries.find((e) => e.name === plugin);
  if (entry === undefined) return id;
  if (slash < 0) return extNameOf(entry);
  return t("desktop.drive.memberName", { plugin: extNameOf(entry), member: id.slice(slash + 1) });
}

const NAME_MARK = "\u0001";

/**
 * "Driving by {name}"(lcM6g, 사용자 2026-11-21 "Driving by <plugin name>으로 고치면 두 개를 분리 안 해도 된다")을 나눈다.
 * 화면 글은 m6Mb(AGE-33)부터 사람 말이다: ko "{name} 플러그인이 주도하는 중", en "{name} is leading"(용어 driver의 ui 말 "주도", "Lead").
 * 한 구절이지만 그릴 때 무게가 둘이라(앞 글은 무채색 물결, 이름은 또렷하게) 번역 글을 이름 자리에서 자른다. 이름이 앞에 오는 언어도 된다.
 * 번역 글에 이름 자리가 없으면 다 앞 글이다
 */
export function drivingByPartsOf(name: string): DrivingByParts {
  const marked = t("desktop.drive.drivingBy", { name: NAME_MARK });
  const at = marked.indexOf(NAME_MARK);
  if (at < 0) return { before: t("desktop.drive.drivingBy", { name }), name: "", after: "" };
  return {
    before: marked.slice(0, at).trimEnd(),
    name,
    after: marked.slice(at + NAME_MARK.length).trimStart(),
  };
}
