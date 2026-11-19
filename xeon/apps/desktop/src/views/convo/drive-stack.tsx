import { Chip, Progress } from "@caustic/react";
import { ArrowUp, CircleDot, Compass, MessageCircleQuestion } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { PresenceItem, PresenceList } from "../../lib/motion-presets.tsx";
import { BeamBand, type BeamState } from "../effects/beam.tsx";
import {
  driveCardOf,
  type DriveCardView,
  type DriveLeaseFacts,
  type DriveMeter,
  type DriveStackView,
  type DriveStep,
} from "./drive-stack-model.ts";

// Drive 스택 그림 둘(lcM6b·lcM6c·lcM6d, L4 desktop-ux §6.6.1). 둘은 같은 칸을 같은 말(`DriveStep.stateText`)로 말한다.
// - 띠(`DriveStackBand`): 입력창 윗변에 붙은 얇은 탭(보이는 줄 28). 넷만 있다(lcM6d, 사용자 2026-11-20): 플러그인 이름,
//   상태 칩(테두리만 있는 칩 "Driving"), 턴 수(막대와 "0/4턴"), 멈추기 칩 단추. 기다리는 플러그인 수, 드래프트 표시, 도움말은
//   오른쪽 패널(런타임 탭의 Drive 카드와 쌓인 판, Drive 제목 옆 정보 아이콘)이 맡는다.
//   Drive가 턴을 돌리는 동안 입력창의 빛이 띠의 윗변으로 옮겨 온다(`BeamBand`, 입력창 빛은 꺼진다). 좁으면 턴 수를 뺀다(@container).
// - 판(`DriveStackCards`): 런타임 탭·검사 탭. 맨 위 판이 지금 Drive를 쥔 칸의 카드다(`DriveCard`: 머리 누가, 몸 지금 무엇을·한도,
//   발 끝나면 어디로·행동). 아래 판은 한 줄: 위 화살표(바로 위 판에 핸드오프), 이름, 첫 한도, 상태. 아래 판일수록
//   안으로 8px씩 좁아지며 위 판 뒤로 8px 들어간다(쌓인 카드). 판이 쌓이고 빠질 때만 높이가 열리고 닫힌다(PresenceItem).
// 아이콘은 뒤 판에만 상태 하나에 하나다: Driving 나침반, 핸드오프하고 기다림 위 화살표, 답을 기다림 물음 말풍선(경고색), 기본 루프 점.
// 색은 경고(답을 기다림, 한도 90%, 드래프트)에만 쓴다.

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

/** 멈추기 칩 속의 네모(8px, 모서리 1.5). 12px 칸 가운데에 있어 글의 x-높이 가운데와 맞는다 */
function StopGlyph(): ReactNode {
  return (
    <svg aria-hidden viewBox="0 0 12 12" fill="currentColor">
      <rect x="2" y="2" width="8" height="8" rx="1.5" />
    </svg>
  );
}

/**
 * 멈추기: 눌리는 칩 단추(lcM6d). 테두리 칩(높이 20)에 네모와 글, 그 사이 8px(칩 간격 6 + 아이콘 뒤 2).
 * 올리면 바탕이 한 단 차고(띠 면 `neutral-soft` 위라 soft-hover) 테두리가 짙어지며, 누르면 soft-pressed로 한 단 더 차고 살짝 눌린다
 */
function StopChip(props: { readonly stop: DriveStopControl }): ReactNode {
  const { stop } = props;
  return (
    <Chip
      size="sm"
      variant="outline"
      data-slot="drive-stop"
      disabled={stop.stopping || stop.blockedReason !== null}
      title={stop.blockedReason ?? t("desktop.drive.stopInfo")}
      aria-label={t("desktop.drive.stopLabel")}
      icon={<StopGlyph />}
      className="gap-1.5 ps-2 pe-2.5 hover:bg-neutral-soft-hover active:bg-neutral-soft-pressed"
      onClick={stop.onStop}
    >
      {stop.stopping ? t("desktop.drive.stopping") : t("desktop.drive.stop")}
    </Chip>
  );
}

/** 상태 칩: 테두리만 있는 칩(lcM6d). "Driving"은 무채색, 답을 기다리면 경고색. 띠와 카드가 같은 칩을 쓴다 */
function StateChip(props: { readonly step: DriveStep; readonly slot: string }): ReactNode {
  const asking = props.step.state === "asking";
  return (
    <Chip
      size="sm"
      variant="outline"
      tone={asking ? "warning" : "neutral"}
      data-slot={props.slot}
      data-drive-state={props.step.state}
      // "Driving"(라틴 글자)의 잉크 가운데는 칩 가운데보다 1.4px 위라(실측, lcM6d) 글만 1px 내린다
      className={asking ? "" : "text-text-secondary [&_[data-slot=chip-label]]:translate-y-px"}
    >
      {props.step.stateText}
    </Chip>
  );
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
  const show = !props.view.alone && props.view.steps.length > 0;
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
 * 띠의 한 줄. 왼쪽부터 이름, 상태 칩, 턴 수(부분 사이 14px), 오른쪽 끝 멈추기 칩. 줄은 윗변 테두리(1px) 아래의 27px 안에서
 * 가운데에 선다(`pt-px`): 칩(20)의 위아래 여백이 3.5px씩 같고, 글의 x-높이 가운데가 칩 가운데와 맞는다
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
      <div className="relative mx-3 flex h-full min-w-0 items-center gap-3.5 ps-3.5 pe-1 pt-px">
        <span
          data-slot="drive-band-name"
          className="min-w-0 truncate text-ui-sm font-medium text-text-primary"
        >
          {top.name}
        </span>
        <StateChip step={top} slot="drive-band-state" />
        {turns === undefined ? null : (
          <span data-slot="drive-band-turns" className="hidden min-w-0 @min-[22rem]:inline-flex">
            <Meter meter={turns} bar="w-8" />
          </span>
        )}
        <span className="flex-1" />
        {props.stop === null ? null : <StopChip stop={props.stop} />}
      </div>
    </div>
  );
}

/** 판의 안쪽 들임: 아래 판일수록 8px씩, 셋째부터 같다 */
const INSET = ["", "mx-2", "mx-4", "mx-6"] as const;

/**
 * 런타임 탭·검사 탭의 Drive 스택. 맨 위 판이 지금 Drive를 쥔 칸의 카드이고, 아래로 핸드오프하고 기다리는 판, 맨 아래가 "기본"이다.
 * 아래 판은 위 판 뒤로 8px 들어가고 양옆이 8px씩 좁아진다. 플러그인 프레임이 없으면 "기본 · Drive 없음" 판 하나다.
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
function activityTextOf(card: DriveCardView): string {
  const base =
    card.activity === "turn"
      ? t("desktop.drive.card.turn")
      : card.activity === "asking"
        ? t("desktop.drive.card.asking")
        : t("desktop.drive.card.holding", { name: card.step.name });
  return card.branches === 0
    ? base
    : `${base} · ${t("desktop.drive.card.branches", { n: card.branches })}`;
}

/**
 * 지금 Drive를 쥔 칸의 카드(맨 위 판). 세 칸으로 나뉜다(lcM6d):
 * - 머리(누가): 플러그인 이름(굵게), 판(짧은 해시 또는 드래프트 칩), 오른쪽 끝 상태 칩("Driving"). 넘겨받은 입력이 있으면 그 한 줄을
 *   인용 선과 함께. 어떻게 쥐었나·언제부터의 줄은 없다.
 * - 몸(지금 무엇을): "턴을 돌리는 중 · 갈래 2개", 한도마다 한 줄(이름, 막대, "7/8"). 남은 양을 글로 풀지 않는다. 90%부터 경고색.
 * - 발(다음과 행동): "끝나면 helm 차례", 기록 보기, 멈추기 칩(턴이 도는 동안).
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
          <span className="min-w-0 truncate text-ui-strong text-text-primary">{step.name}</span>
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
          <span className="ms-auto flex shrink-0">
            <StateChip step={step} slot="drive-card-state" />
          </span>
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
          className={`m-0 text-ui ${asking ? "text-warning-text" : "text-text-secondary"}`}
        >
          {activityTextOf(card)}
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
      <div className="flex min-h-10 min-w-0 items-center gap-2 border-t border-border-subtle ps-3.5 pe-2 py-1.5">
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
          <Chip
            size="sm"
            variant="ghost"
            data-slot="drive-records"
            className="text-text-secondary hover:text-text-primary"
            onClick={() => {
              records(plugin);
            }}
          >
            {t("desktop.drive.card.records")}
          </Chip>
        )}
        {props.stop === null ? null : <StopChip stop={props.stop} />}
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

/** 아래 판(기다리는 칸) 한 줄, 또는 플러그인 프레임이 없을 때의 "기본 · Drive 없음" 점선 판 */
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
