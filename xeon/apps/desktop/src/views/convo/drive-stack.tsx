import { Button, Chip, Progress } from "@caustic/react";
import { ArrowUp, CircleDot, Compass, MessageCircleQuestion } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { PresenceItem, PresenceList } from "../../lib/motion-presets.tsx";
import { BeamBand, type BeamState } from "../effects/beam.tsx";
import { MetaParts } from "../meta-parts.tsx";
import { useInstalledEntries } from "../craft/installed-entries.ts";
import {
  driveBandShownOf,
  driveCardOf,
  driveDisplayNameOf,
  drivingByPartsOf,
  type DriveCardView,
  type DriveLeaseFacts,
  type DriveMeter,
  type DriveStackView,
  type DriveStep,
} from "./drive-stack-model.ts";

// Drive 스택 그림 둘(lcM6b~lcM6e, L4 desktop-ux §6.6.1). 둘은 같은 칸을 같은 말(`DriveStep.stateText`)로 말한다.
// - 띠(`DriveStackBand`): 입력창 윗변에 붙은 얇은 탭(보이는 줄 28). 셋만 있다(lcM6g, 사용자 2026-11-21): "Driving by <플러그인 이름>" 한 구절
//   ("Driving by"는 무채색 글이고 턴이 도는 동안 밝기 물결, 이름은 또렷하게), 오른쪽 끝 묶음의 턴 수("2/4턴", 막대 없음: lcM6i)와 멈추기 단추(xs soft).
//   기다리는 플러그인 수, 드래프트 표시, 도움말은
//   오른쪽 패널(런타임 탭의 Drive 카드와 쌓인 판, Drive 제목 옆 정보 아이콘)이 맡는다.
//   Drive가 턴을 돌리는 동안 입력창의 빛이 띠의 윗변으로 옮겨 온다(`BeamBand`, 입력창 빛은 꺼진다). 좁으면 턴 수를 뺀다(@container).
// - 판(`DriveStackCards`): 런타임 탭·검사 탭. 맨 위 판이 지금 Drive를 쥔 칸의 카드다(`DriveCard`: 머리 누가, 몸 지금 무엇을·한도,
//   발 끝나면 어디로·행동). 아래 판은 한 줄: 위 화살표(바로 위 판에 핸드오프), 이름, 첫 한도, 상태. 아래 판일수록
//   안으로 8px씩 좁아지며 위 판 뒤로 8px 들어간다(쌓인 카드). 판이 쌓이고 빠질 때만 높이가 열리고 닫힌다(PresenceItem).
// 아이콘은 뒤 판에만 상태 하나에 하나다: Driving 나침반, 핸드오프하고 기다림 위 화살표, 답을 기다림 물음 말풍선(경고색), 기본 루프 점.
// 색은 경고(답을 기다림, 한도 90%, 드래프트)에만 쓴다. "Driving" 글은 무채색이다(lcM6g, 물결은 띠에서만 밝기로 흐른다).

/** 입력창이 넘기는 멈추기. 도는 턴이 있을 때만 있다(`turn.interrupt`가 Drive 스택을 모두 내린다) */
export type DriveStopControl = {
  readonly stopping: boolean;
  /** 누를 수 없는 까닭(엔진이 없음). 없으면 null */
  readonly blockedReason: string | null;
  readonly onStop: () => void;
};

function StateIcon(props: { readonly step: DriveStep }): ReactNode {
  const { step } = props;
  const base = "size-3.5 shrink-0";
  if (step.state === "asking") {
    return <MessageCircleQuestion aria-hidden className={`${base} text-warning-text`} />;
  }
  // 기본 루프는 핸드오프하지 않으므로 기다릴 때도 점이다(위 화살표는 핸드오프한 플러그인 칸만)
  if (step.core) return <CircleDot aria-hidden className={`${base} text-text-tertiary`} />;
  if (step.state === "waiting") {
    return <ArrowUp aria-hidden className={`${base} text-text-tertiary`} />;
  }
  return <Compass aria-hidden className={`${base} text-text-secondary`} />;
}

/** 한도 하나: 짧은 막대 + "7/8턴". 90%부터 경고색 */
function Meter(props: {
  readonly meter: DriveMeter;
  readonly bar?: string;
  /** 막대만 보이고 글은 툴팁(뒤 판처럼 좁은 자리) */
  readonly compact?: boolean;
}): ReactNode {
  const { meter } = props;
  return (
    <span
      data-drive-meter={meter.kind}
      data-warn={meter.warn ? "" : undefined}
      title={props.compact === true ? meter.text : undefined}
      className={`inline-flex min-w-0 items-center gap-1.5 text-footnote tabular-nums ${meter.warn ? "text-warning-text" : "text-text-tertiary"}`}
    >
      <Progress
        decorative
        size="sm"
        tone={meter.warn ? "warning" : "neutral"}
        value={Math.round(meter.ratio * 100)}
        className={`shrink-0 ${props.bar ?? "w-10"}`}
      />
      <span className={props.compact === true ? "sr-only" : "truncate"}>{meter.text}</span>
    </span>
  );
}

/**
 * 멈추기 단추의 네모(14 칸 안의 8px, 모서리 1.5). 앱의 다른 xs 단추 아이콘(14)과 같은 칸이다. 칸 가운데보다 0.5px 위에 있다:
 * 곁의 한글 "멈추기"의 눈 가운데가 단추 가운데보다 0.44px 위라서(lcM6e 실측) 네모를 글에 맞춘다
 */
function StopGlyph(): ReactNode {
  return (
    <svg aria-hidden viewBox="0 0 14 14" fill="currentColor">
      <rect x="3" y="2.5" width="8" height="8" rx="1.5" />
    </svg>
  );
}

/**
 * 멈추기(lcM6f, 사용자 2026-11-20 "단추로 보이게, 칩은 롤백"). 테두리도 알약 모양도 없이 면이 한 단 찬 caustic Button xs soft다
 * (높이 24, 좌우 8, 반경 md, 아이콘 14와 글 사이 4, 글 12/500 primary): 앱의 xs 단추와 같은 틀이고 면만 깔려 있어 쉴 때도 단추로 읽힌다.
 * 면은 놓인 바탕에서 한 단 떨어진다. 띠(`neutral-soft` 면, `onSoft`)에서는 soft 사다리의 다음 단 `soft-hover` → 올림·누름 `soft-pressed`,
 * 카드(raised 면)에서는 그 면의 누름 단(`neutral-pressed`, caustic이 raised 안에서 raised용 값으로 바꾼다) → 올림·누름 `soft-pressed`다.
 * 누름은 올림과 같은 면에 caustic 단추의 누름 움직임(`press`)이 더해진다
 */
function StopButton(props: {
  readonly stop: DriveStopControl;
  readonly onSoft?: boolean;
}): ReactNode {
  const { stop } = props;
  return (
    <Button
      type="button"
      size="xs"
      variant="soft"
      data-slot="drive-stop"
      disabled={stop.stopping || stop.blockedReason !== null}
      title={stop.blockedReason ?? t("desktop.drive.stopInfo")}
      aria-label={t("desktop.drive.stopLabel")}
      iconStart={<StopGlyph />}
      className={
        props.onSoft === true
          ? "shrink-0 bg-neutral-soft-hover hover:bg-neutral-soft-pressed active:bg-neutral-soft-pressed"
          : "shrink-0 bg-neutral-pressed hover:bg-neutral-soft-pressed active:bg-neutral-soft-pressed"
      }
      onClick={stop.onStop}
    >
      {stop.stopping ? t("desktop.drive.stopping") : t("desktop.drive.stop")}
    </Button>
  );
}

/**
 * 상태 글(lcM6e: 칩을 없앴다). "Driving"은 어디서나 무채색 글이다(lcM6g, 사용자 2026-11-21 "무지개스럽고 과하다", convo.css `.drive-word`):
 * 쉴 때는 text-secondary 한 색, 입력창 위 띠에서 Drive가 턴을 돌리는 동안(`wave`)만 text-primary 빛이 지나간다(생각하는 중의 반짝임과 한 식구).
 * 흐르는 것은 한 화면에 한 곳이다. 답을 기다리면 경고색, 그 밖의 상태는 tertiary. 크기·굵기는 부르는 쪽이 정한다
 */
export function DriveWord(props: {
  /** driving 무채색 글(띠에서만 흐른다), warning 경고색 글(답을 기다림, 오류), quiet tertiary 글 */
  readonly look: DriveWordLook;
  /** Drive 칸 상태(띠·카드). 시험과 견줌 사진이 읽는다 */
  readonly state?: DriveStep["state"];
  readonly text: string;
  readonly slot: string;
  readonly wave: boolean;
  readonly className: string;
}): ReactNode {
  const driving = props.look === "driving";
  const wave = props.wave && driving;
  const tone = props.look === "warning" ? "text-warning-text" : "text-text-tertiary";
  return (
    <span
      data-slot={props.slot}
      data-look={props.look}
      data-drive-state={props.state}
      data-wave={wave ? "" : undefined}
      className={`shrink-0 whitespace-nowrap ${props.className} ${driving ? "drive-word" : tone}`}
    >
      {props.text}
    </span>
  );
}

export type DriveWordLook = "driving" | "warning" | "quiet";

/**
 * "Driving by <이름>"(lcM6g, 사용자 2026-11-21 "Driving by <plugin name>으로 고치면 두 개를 분리 안 해도 된다"). 한 구절이지만 무게가 둘이다:
 * "Driving by"는 무채색 글(`DriveWord`, 띠에서만 흐른다), 이름은 부르는 쪽이 정한 또렷한 글이라 "무엇이" Driving인지가 먼저 읽힌다.
 * 둘은 한 기준선에 서고 사이는 낱말 사이 빈칸만큼(4)이다. 좁으면 이름만 말줄임으로 줄고 전체 구절은 title로 본다
 */
export function DrivingBy(props: {
  readonly name: string;
  readonly wave: boolean;
  /** 구절 앞뒤 글("Driving by")의 자리 이름. 이름 뒤 글이 있는 언어면 `-after`가 붙는다 */
  readonly wordSlot: string;
  readonly nameSlot: string;
  readonly wordClassName: string;
  readonly nameClassName: string;
  readonly className?: string;
}): ReactNode {
  const entries = useInstalledEntries();
  const name = driveDisplayNameOf(props.name, entries);
  const parts = drivingByPartsOf(name);
  return (
    <span
      data-slot="drive-driving-by"
      title={t("desktop.drive.drivingBy", { name })}
      className={`flex min-w-0 items-baseline gap-1 ${props.className ?? ""}`}
    >
      {parts.before === "" ? null : (
        <DriveWord
          look="driving"
          state="driving"
          text={parts.before}
          slot={props.wordSlot}
          wave={props.wave}
          className={props.wordClassName}
        />
      )}
      {/* 빈칸은 글로 읽을 때(읽어 주기, 복사)의 낱말 사이다. flex 안의 빈칸만 있는 글은 그려지지 않아 간격은 gap이 정한다 */}
      {parts.before === "" ? null : " "}
      <span data-slot={props.nameSlot} className={`min-w-0 truncate ${props.nameClassName}`}>
        {parts.name}
      </span>
      {parts.after === "" ? null : " "}
      {parts.after === "" ? null : (
        <DriveWord
          look="driving"
          state="driving"
          text={parts.after}
          slot={`${props.wordSlot}-after`}
          wave={props.wave}
          className={props.wordClassName}
        />
      )}
    </span>
  );
}

/** 칸 상태의 글 모양: Driving은 그라데이션, 답을 기다림은 경고색, 나머지(기다림, 쉼)는 조용한 글 */
function wordLookOf(state: DriveStep["state"]): DriveWordLook {
  if (state === "driving") return "driving";
  return state === "asking" ? "warning" : "quiet";
}

/** 드래프트 Drive(테스트 런에서만 돈다)의 표시. 원샷 목록의 드래프트 칩과 같다 */
function DraftChip(): ReactNode {
  return (
    <Chip size="xs" variant="outline" tone="warning" data-slot="drive-draft">
      {t("desktop.oneShot.draft")}
    </Chip>
  );
}

/**
 * 입력창 윗변에 붙은 Drive 띠. 플러그인 프레임이 없으면(기본 루프만) 그리지 않는다.
 * 띠 면은 아래로 입력창 뒤까지 이어져(입력창이 z로 덮는다) 입력창과 한 몸으로 보인다. 나타나고 사라질 때는 줄 높이만 열리고 닫혀
 * 입력창은 제자리에 있다. `beam`은 띠 윗변의 빛이다(입력창이 정한다: Drive가 턴을 돌리면 run, 승인을 기다리면 wait, 아니면 off)
 */
export function DriveStackBand(props: {
  readonly view: DriveStackView;
  readonly stop?: DriveStopControl | null;
  readonly beam?: BeamState;
}): ReactNode {
  const show = driveBandShownOf(props.view);
  return (
    <PresenceList>
      {show ? (
        <PresenceItem key="drive-band" className="relative z-0">
          <BandBody view={props.view} stop={props.stop ?? null} beam={props.beam ?? "off"} />
        </PresenceItem>
      ) : null}
    </PresenceList>
  );
}

/** 띠의 보이는 줄 높이(28, 입력창 아래 줄의 칩과 같은 높이). 견줌 사진은 `--drive-band-h`로 바꿔 찍는다 */
const BAND_ROW = "h-[var(--drive-band-h,28px)]";

/**
 * 띠의 한 줄(lcM6g, 사용자 2026-11-21 "Driving by <plugin name>"). 왼쪽부터 한 구절 "Driving by authoring"("Driving by" 12/500 무채색,
 * 턴이 도는 동안 밝기 물결. 이름 13/600 primary), 남는 폭(24 이상)을 지나 오른쪽 끝 묶음에 "2/4턴"(12 tertiary)과
 * 그 뒤 12의 멈추기(xs soft, 띠 끝에서 6). 턴 막대는 없다(lcM6i, 사용자 2026-11-21 "턴 막대는 그냥 제거하자"). 가운뎃점은 쓰지 않는다(lcDot, 사용자
 * 2026-11-22 "가운뎃점 절대 쓰지마", desktop-ux §13.0 DP-226): 대화 기록의 Drive 머리 줄(왼쪽 구절, 오른쪽 끝 한도 칸)과 같은 문법으로 자리가 둘을 가른다.
 * 구절 뒤 12에 턴 수를 둔 안(B)과 "턴" 이름표를 나눈 안(C)은 버렸다(`_notes/design/lc/lcDot-shots/band-options-*.png`).
 * 맨 위 칸이 Driving이 아니면(답을 기다림 등) 구절 대신 상태 글과 이름을 8 떨어뜨려 둔다. 줄은 윗변 테두리(1px) 아래 27px의 가운데에 선다(`pt-px`).
 * 구절, 턴 수, 멈추기 단추는 한 세로 가운데(차 0px, lcDot 실측)에 서고, 네모는 "멈추기"의 한글 가운데에 맞췄다(8배 실측, §6.6.1)
 */
function BandBody(props: {
  readonly view: DriveStackView;
  readonly stop: DriveStopControl | null;
  readonly beam: BeamState;
}): ReactNode {
  const { view } = props;
  const top = view.steps.at(-1);
  if (top === undefined) return null;
  const turns = top.meters.find((meter) => meter.kind === "turns");
  return (
    <div
      role="status"
      aria-label={t("desktop.drive.aria", { path: view.path })}
      data-slot="drive-stack-band"
      data-drive-top={top.state}
      data-beam={props.beam}
      className={`@container relative ${BAND_ROW}`}
    >
      {/* 띠 면: 보이는 줄 아래로 입력창 뒤까지(입력창 모서리 20) 이어진다. 빛은 이 면의 윗변에 겹친다 */}
      <div
        aria-hidden
        data-slot="drive-band-surface"
        className="pointer-events-none absolute inset-x-3 top-0 -bottom-5 rounded-t-xl border border-b-0 border-border-subtle bg-neutral-soft"
      >
        <BeamBand state={props.beam} />
      </div>
      <div className="relative mx-3 flex h-full min-w-0 items-center ps-3.5 pe-1.5 pt-px">
        <span data-slot="drive-band-group" className="flex min-w-0 items-baseline">
          {top.state === "driving" ? (
            <DrivingBy
              name={top.name}
              wave={props.beam === "run"}
              wordSlot="drive-band-state"
              nameSlot="drive-band-name"
              wordClassName="text-ui-sm font-medium"
              nameClassName="text-ui-strong font-semibold text-text-primary"
            />
          ) : (
            <span className="flex min-w-0 items-baseline gap-2">
              <DriveWord
                look={wordLookOf(top.state)}
                state={top.state}
                text={top.stateText}
                slot="drive-band-state"
                wave={false}
                className="text-ui-sm font-medium"
              />
              <span
                data-slot="drive-band-name"
                className="min-w-0 truncate text-ui-strong font-semibold text-text-primary"
              >
                {top.name}
              </span>
            </span>
          )}
        </span>
        <span className="min-w-6 flex-1" />
        {/* 오른쪽 묶음: 턴 수와 멈추기. 턴 수는 멈추기 글과 같은 12이고 둘 사이는 12다. 멈추기가 없으면 턴 수가 8 더 들어와 끝 여백이 왼쪽 들임 14와 같다 */}
        <span data-slot="drive-band-end" className="flex shrink-0 items-center gap-3">
          {turns === undefined ? null : (
            <span
              data-slot="drive-band-turns"
              className={`hidden text-footnote tabular-nums @min-[26rem]:inline ${
                props.stop === null ? "pe-2" : ""
              } ${turns.warn ? "text-warning-text" : "text-text-tertiary"}`}
            >
              {turns.text}
            </span>
          )}
          {props.stop === null ? null : <StopButton stop={props.stop} onSoft />}
        </span>
      </div>
    </div>
  );
}

/** 판의 안쪽 들임: 아래 판일수록 8px씩, 셋째부터 같다 */
const INSET = ["", "mx-2", "mx-4", "mx-6"] as const;

/**
 * 런타임 탭·검사 탭의 Drive 스택. 맨 위 판이 지금 Drive를 쥔 칸의 카드이고, 아래로 핸드오프하고 기다리는 판, 맨 아래가 "기본"이다.
 * 아래 판은 위 판 뒤로 8px 들어가고 양옆이 8px씩 좁아진다. 플러그인 프레임이 없으면 "기본"과 "Drive 없음" 판 하나다.
 * `leases`는 거울의 임대 기록(어떻게 쥐었나, 언제부터, 갈래)이고 없으면 카드는 그 줄을 비운다. `running`은 이 대화에 도는 턴이 있는가
 */
export function DriveStackCards(props: {
  readonly view: DriveStackView;
  readonly stop?: DriveStopControl | null;
  readonly leases?: readonly DriveLeaseFacts[];
  readonly running?: boolean;
  /** 플러그인 상세의 기록으로 간다. 없으면 단추가 없다 */
  readonly onOpenRecords?: ((plugin: string) => void) | null;
}): ReactNode {
  const { view } = props;
  const fromTop = view.steps.toReversed();
  const card = driveCardOf(view, props.leases ?? [], props.running === true);
  return (
    <ol
      aria-label={t("desktop.drive.aria", { path: view.path })}
      data-slot="drive-stack"
      data-depth={view.steps.length}
      className="m-0 grid list-none p-0"
    >
      <PresenceList>
        {fromTop.map((step, level) => (
          <PresenceItem
            key={step.key}
            as="li"
            className={`relative ${INSET[Math.min(level, INSET.length - 1)] ?? ""} ${level === 0 ? "" : "-mt-2"}`}
          >
            {level === 0 && card !== null ? (
              <DriveCard
                card={card}
                depth={fromTop.length}
                stop={props.stop ?? null}
                onOpenRecords={props.onOpenRecords ?? null}
              />
            ) : (
              <StackPlate step={step} level={level} alone={view.alone} depth={fromTop.length} />
            )}
          </PresenceItem>
        ))}
      </PresenceList>
    </ol>
  );
}

/** 카드 몸 첫 줄: 지금 무엇을 하나 */
/** 몸 첫 줄의 조각: 지금 하는 일, 갈래가 있으면 갈래 수(따로 선 조각이고 사이는 간격 12. 가운뎃점을 쓰지 않는다: lcDot) */
function activityPartsOf(card: DriveCardView): readonly string[] {
  const base =
    card.activity === "turn"
      ? t("desktop.drive.card.turn")
      : card.activity === "asking"
        ? t("desktop.drive.card.asking")
        : t("desktop.drive.card.holding", { name: card.step.name });
  return card.branches === 0
    ? [base]
    : [base, t("desktop.drive.card.branches", { n: card.branches })];
}

/**
 * 지금 Drive를 쥔 칸의 카드(맨 위 판). 세 칸으로 나뉜다(lcM6d):
 * - 머리(누가): "Driving by <이름>"(lcM6g: 한 구절, 이름은 굵게. 물결은 띠만), 판(짧은 해시 또는 드래프트 칩). Driving이 아니면 이름과
 *   오른쪽 끝 상태 글("답을 기다림" 경고색).
 *   넘겨받은 입력이 있으면 그 한 줄을
 *   인용 선과 함께. 어떻게 쥐었나·언제부터의 줄은 없다.
 * - 몸(지금 무엇을): "턴을 돌리는 중"과 12 떨어진 "갈래 2개", 한도마다 한 줄(이름, 막대, "7/8"). 남은 양을 글로 풀지 않는다. 90%부터 경고색.
 * - 발(다음과 행동): "끝나면 helm 차례", 기록 보기, 멈추기(턴이 도는 동안). 기록 보기는 xs ghost, 멈추기는 면이 깔린 xs soft(lcM6f).
 */
function DriveCard(props: {
  readonly card: DriveCardView;
  readonly depth: number;
  readonly stop: DriveStopControl | null;
  readonly onOpenRecords: ((plugin: string) => void) | null;
}): ReactNode {
  const { card } = props;
  const { step } = card;
  const asking = card.activity === "asking";
  const driving = step.state === "driving";
  const plugin = step.core ? null : step.name;
  const records = props.onOpenRecords;
  return (
    <div
      data-slot="drive-card"
      data-drive-step={step.state}
      data-activity={card.activity}
      data-level={0}
      style={{ zIndex: props.depth }}
      className="relative grid overflow-hidden rounded-xl border border-border-default bg-surface-raised shadow-2"
    >
      <div className="grid gap-2 px-3.5 pt-3 pb-2.5">
        <div className="flex min-h-5 min-w-0 items-center gap-2">
          {driving ? (
            <DrivingBy
              name={step.name}
              wave={false}
              wordSlot="drive-card-state"
              nameSlot="drive-card-name"
              wordClassName="text-ui"
              nameClassName="text-ui-strong text-text-primary"
            />
          ) : (
            <span
              data-slot="drive-card-name"
              className="min-w-0 truncate text-ui-strong text-text-primary"
            >
              {step.name}
            </span>
          )}
          {step.version === null ? null : step.version.kind === "draft" ? (
            <DraftChip />
          ) : (
            <span
              data-slot="drive-version"
              title={t("desktop.drive.card.versionTip")}
              className="shrink-0 font-mono text-footnote text-text-tertiary"
            >
              {step.version.short}
            </span>
          )}
          {driving ? null : (
            <DriveWord
              look={wordLookOf(step.state)}
              state={step.state}
              text={step.stateText}
              slot="drive-card-state"
              wave={false}
              className="ms-auto text-ui-sm font-semibold"
            />
          )}
        </div>
        {card.input === null ? null : (
          <p
            data-slot="drive-input"
            title={card.input}
            className="m-0 truncate border-s-2 border-border-default ps-2 text-footnote text-text-secondary"
          >
            {card.input}
          </p>
        )}
      </div>
      <div className="grid gap-2.5 border-t border-border-subtle px-3.5 pt-2.5 pb-3">
        <p
          data-slot="drive-activity"
          className={`m-0 flex flex-wrap items-baseline gap-x-3 text-ui ${asking ? "text-warning-text" : "text-text-secondary"}`}
        >
          <MetaParts parts={activityPartsOf(card)} />
        </p>
        {step.meters.length === 0 ? (
          <p className="m-0 text-footnote text-text-tertiary">{t("desktop.drive.card.noLimits")}</p>
        ) : (
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
            {step.meters.map((meter) => (
              <LimitRow key={meter.kind} meter={meter} />
            ))}
          </div>
        )}
      </div>
      <div className="flex min-h-10 min-w-0 items-center gap-1 border-t border-border-subtle ps-3.5 pe-1.5 py-1.5">
        {card.next === null ? null : (
          <span
            data-slot="drive-next"
            className="min-w-0 truncate text-footnote text-text-tertiary"
          >
            {t("desktop.drive.card.next", { name: card.next })}
          </span>
        )}
        <span className="flex-1" />
        {records === null || plugin === null ? null : (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            data-slot="drive-records"
            onClick={() => {
              records(plugin);
            }}
          >
            {t("desktop.drive.card.records")}
          </Button>
        )}
        {props.stop === null ? null : <StopButton stop={props.stop} />}
      </div>
    </div>
  );
}

/** 카드 몸의 한도 한 줄: 이름 | 막대 | "7/8". 남은 양은 막대가 보인다 */
function LimitRow(props: { readonly meter: DriveMeter }): ReactNode {
  const { meter } = props;
  const tone = meter.warn ? "text-warning-text" : "text-text-tertiary";
  return (
    <>
      <span className={`text-footnote ${tone}`}>{t(LIMIT_NAME[meter.kind])}</span>
      <Progress
        decorative
        size="sm"
        tone={meter.warn ? "warning" : "neutral"}
        value={Math.round(meter.ratio * 100)}
      />
      <span
        data-drive-meter={meter.kind}
        data-warn={meter.warn ? "" : undefined}
        className={`text-end text-footnote tabular-nums ${tone}`}
      >
        {meter.amount}
      </span>
    </>
  );
}

const LIMIT_NAME = {
  turns: "desktop.drive.card.limit.turns",
  tokens: "desktop.drive.card.limit.tokens",
  spawns: "desktop.drive.card.limit.spawns",
} as const;

/** 아래 판(기다리는 칸) 한 줄, 또는 플러그인 프레임이 없을 때의 "기본"과 "Drive 없음" 점선 판 */
function StackPlate(props: {
  readonly step: DriveStep;
  readonly level: number;
  readonly depth: number;
  readonly alone: boolean;
}): ReactNode {
  const { step, level, alone } = props;
  const surface = alone
    ? "border-dashed border-border-default bg-transparent pt-2 pb-2"
    : "border-border-subtle bg-surface-base pt-3.5 pb-1.5";
  const meter = step.meters[0];
  return (
    <div
      data-drive-step={step.state}
      data-level={level}
      style={{ zIndex: props.depth - level }}
      className={`relative grid gap-2 rounded-xl border px-3 ${surface}`}
    >
      <div className="flex min-w-0 items-center gap-2 text-ui">
        <StateIcon step={step} />
        <span
          className={`min-w-0 truncate ${level <= 1 ? "text-text-secondary" : "text-text-tertiary"}`}
        >
          {step.name}
        </span>
        {meter === undefined ? null : <Meter meter={meter} bar="w-8" compact />}
        <span
          className={`ms-auto shrink-0 text-ui-sm ${step.state === "asking" ? "text-warning-text" : "text-text-tertiary"}`}
          {...(step.handedTo === null
            ? {}
            : { title: t("desktop.drive.handedTo", { name: step.handedTo }) })}
        >
          {step.stateText}
        </span>
      </div>
      {step.handedTo === null ? null : (
        <span data-slot="drive-handoff-to" className="sr-only">
          {t("desktop.drive.handedTo", { name: step.handedTo })}
        </span>
      )}
    </div>
  );
}
