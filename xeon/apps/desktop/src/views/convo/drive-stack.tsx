import { Button, Progress } from "@caustic/react";
import { ArrowUp, CircleDot, Compass, MessageCircleQuestion } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { PresenceItem, PresenceList } from "../../lib/motion-presets.tsx";
import { InfoTip } from "../craft/info-tip.tsx";
import type { DriveMeter, DriveStackView, DriveStep } from "./drive-stack-model.ts";

// Drive 스택 그림 둘(lcM6b, L4 desktop-ux §6.6.1). 둘은 같은 칸을 같은 말(`DriveStep.stateText`)로 말한다.
// - 띠(`DriveStackBand`): 입력창 윗변에 붙은 탭. 입력창보다 한 단계 낮은 면(neutral.soft)이 입력창 뒤로 들어가 한 몸으로 보이고,
//   안에는 덱(지금 Drive를 쥔 칸이 맨 앞 카드, 뒤로 아래 칸 모서리가 위로 비어져 나온다), 그 칸의 상태, 한도 막대, 멈추기, 정보 아이콘.
//   덱은 폭이 일정하다. 좁으면 한도 막대를 뺀다(@container).
// - 판(`DriveStackCards`): 런타임 탭·검사 탭. 맨 위 판이 지금 Drive를 쥔 플러그인이고(떠 있는 면, 한도 막대 전부, 멈추기), 아래 판일수록
//   안으로 8px씩 좁아지며 위 판 뒤로 8px 들어간다(쌓인 카드). 아래 판은 한 줄: 위 화살표(바로 위 판에 핸드오프), 이름, 첫 한도, 상태.
//   판이 쌓이고 빠질 때만 높이가 열리고 닫힌다(PresenceItem). 움직임 줄이기면 바로 바뀌고, 쉬는 동안은 프레임이 없다.
// 아이콘은 상태 하나에 하나다: Drive 중 나침반, 핸드오프하고 기다림 위 화살표(넘겨준 방향: 바로 위 판), 답을 기다림 물음 말풍선(경고색),
// 기본 루프 점(기다리면 위 화살표). 색은 경고에만 쓴다.

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
  if (step.state === "waiting") {
    return <ArrowUp aria-hidden className={`${base} text-text-tertiary`} />;
  }
  if (step.core) return <CircleDot aria-hidden className={`${base} text-text-tertiary`} />;
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

function StopButton(props: { readonly stop: DriveStopControl }): ReactNode {
  const { stop } = props;
  return (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      data-slot="drive-stop"
      disabled={stop.stopping || stop.blockedReason !== null}
      title={stop.blockedReason ?? t("desktop.drive.stopInfo")}
      aria-label={t("desktop.drive.stopLabel")}
      className="shrink-0 gap-1 px-1.5 font-normal text-text-secondary hover:text-text-primary"
      onClick={stop.onStop}
    >
      <span aria-hidden className="block size-2 rounded-[2px] bg-current" />
      {stop.stopping ? t("desktop.drive.stopping") : t("desktop.drive.stop")}
    </Button>
  );
}

/**
 * 띠의 덱: 지금 Drive를 쥔 칸(맨 앞 카드, 상태 아이콘과 이름, 그림자) 뒤로 아래 칸의 모서리가 위로 4px씩 비어져 나온다(쌓인 카드).
 * 모서리는 가까운 아래 칸 둘까지다. 아래 칸 이름은 덱의 툴팁(경로)과 판에 있다
 */
function BandDeck(props: {
  readonly view: DriveStackView;
  readonly top: DriveStep;
  readonly lower: readonly DriveStep[];
}): ReactNode {
  const { top } = props;
  // 가까운 칸이 마지막이다. 먼 칸(둘째)을 먼저 그려 뒤에 깐다
  const edges = props.lower.slice(-2);
  return (
    <span
      aria-hidden
      data-slot="drive-deck"
      data-edges={edges.length}
      title={props.view.path}
      className="relative inline-flex min-w-0 shrink"
    >
      {edges.map((step, index) => {
        const near = index === edges.length - 1;
        return (
          <span
            key={step.key}
            data-drive-step={step.state}
            className={`absolute h-6 rounded-md border bg-surface-base ${near ? "inset-x-1.5 -top-1 border-border-default" : "inset-x-3 -top-2 border-border-subtle"}`}
          />
        );
      })}
      <span
        data-drive-step={top.state}
        className="relative inline-flex h-6 min-w-0 items-center gap-1 rounded-md border border-border-default bg-surface-raised px-2 text-ui text-text-primary shadow-1"
      >
        <StateIcon step={top} />
        <span className="truncate">{top.name}</span>
      </span>
    </span>
  );
}

/** 입력창 위 탭의 높이: 보이는 줄 40(덱 위로 비어져 나온 모서리 8px 자리를 둔다) */
const BAND_ROW = "h-10";

/**
 * 입력창 윗변에 붙은 Drive 탭. 플러그인 프레임이 없으면(기본 루프만) 그리지 않는다.
 * 탭 면은 아래로 입력창 뒤까지 이어져(입력창이 z로 덮는다) 입력창과 한 몸으로 보인다. 나타나고 사라질 때는 줄 높이만 열리고 닫혀
 * 입력창은 제자리에 있다
 */
export function DriveStackBand(props: {
  readonly view: DriveStackView;
  readonly stop?: DriveStopControl | null;
}): ReactNode {
  const show = !props.view.alone && props.view.steps.length > 0;
  return (
    <PresenceList>
      {show ? (
        <PresenceItem key="drive-band" className="relative z-0">
          <BandBody view={props.view} stop={props.stop ?? null} />
        </PresenceItem>
      ) : null}
    </PresenceList>
  );
}

function BandBody(props: {
  readonly view: DriveStackView;
  readonly stop: DriveStopControl | null;
}): ReactNode {
  const { view } = props;
  const top = view.steps.at(-1);
  if (top === undefined) return null;
  const lower = view.steps.slice(0, -1);
  const meter = top.meters[0];
  return (
    <div
      role="status"
      aria-label={t("desktop.drive.aria", { path: view.path })}
      data-slot="drive-stack-band"
      data-drive-top={top.state}
      className={`@container relative ${BAND_ROW}`}
    >
      {/* 탭 면: 보이는 줄 아래로 입력창 뒤까지(줄 사이 6 + 입력창 모서리 18) 이어진다 */}
      <div
        aria-hidden
        data-slot="drive-band-surface"
        className="pointer-events-none absolute inset-x-3 top-0 -bottom-6 rounded-t-2xl border border-b-0 border-border-subtle bg-neutral-soft"
      />
      <div className="relative mx-3 flex h-full min-w-0 items-center gap-2 ps-2 pe-1.5 pt-2 text-ui">
        <BandDeck view={view} top={top} lower={lower} />
        <span
          data-slot="drive-band-state"
          className={`shrink-0 ${top.state === "asking" ? "text-warning-text" : "text-text-secondary"}`}
        >
          {top.stateText}
        </span>
        {meter === undefined ? null : (
          <span className="hidden min-w-0 @min-[20rem]:inline-flex">
            <Meter meter={meter} />
          </span>
        )}
        <span className="flex-1" />
        {props.stop === null ? null : <StopButton stop={props.stop} />}
        <InfoTip text={t("desktop.drive.info")} label={t("desktop.drive.infoLabel")} />
      </div>
    </div>
  );
}

/** 판의 안쪽 들임: 아래 판일수록 8px씩, 셋째부터 같다 */
const INSET = ["", "mx-2", "mx-4", "mx-6"] as const;

/**
 * 런타임 탭·검사 탭의 Drive 스택. 맨 위 판이 지금 Drive를 쥔 칸이고, 아래로 핸드오프하고 기다리는 판, 맨 아래가 "기본"이다.
 * 아래 판은 위 판 뒤로 8px 들어가고 양옆이 8px씩 좁아진다. 플러그인 프레임이 없으면 "기본 · Drive 없음" 판 하나다
 */
export function DriveStackCards(props: {
  readonly view: DriveStackView;
  readonly stop?: DriveStopControl | null;
}): ReactNode {
  const { view } = props;
  const fromTop = view.steps.toReversed();
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
            <StackCard
              step={step}
              level={level}
              alone={view.alone}
              depth={fromTop.length}
              stop={level === 0 ? (props.stop ?? null) : null}
            />
          </PresenceItem>
        ))}
      </PresenceList>
    </ol>
  );
}

function StackCard(props: {
  readonly step: DriveStep;
  readonly level: number;
  readonly depth: number;
  readonly alone: boolean;
  readonly stop: DriveStopControl | null;
}): ReactNode {
  const { step, level, alone } = props;
  const front = level === 0;
  const surface = alone
    ? "border-dashed border-border-default bg-transparent"
    : front
      ? "border-border-default bg-surface-raised shadow-2"
      : "border-border-subtle bg-surface-base";
  const meter = step.meters[0];
  return (
    <div
      data-drive-step={step.state}
      data-level={level}
      style={{ zIndex: props.depth - level }}
      className={`relative grid gap-2 rounded-xl border px-3 ${front ? "py-2.5" : "pt-3.5 pb-1.5"} ${surface}`}
    >
      <div className="flex min-w-0 items-center gap-2 text-ui">
        <StateIcon step={step} />
        <span
          className={`min-w-0 truncate ${front && !alone ? "text-ui-strong text-text-primary" : level <= 1 ? "text-text-secondary" : "text-text-tertiary"}`}
        >
          {step.name}
        </span>
        {front || meter === undefined ? null : <Meter meter={meter} bar="w-8" compact />}
        <span
          className={`ms-auto shrink-0 text-ui-sm ${step.state === "asking" ? "text-warning-text" : "text-text-tertiary"}`}
          {...(step.handedTo === null
            ? {}
            : { title: t("desktop.drive.handedTo", { name: step.handedTo }) })}
        >
          {step.stateText}
        </span>
      </div>
      {!front || (step.meters.length === 0 && props.stop === null) ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 ps-5.5">
          {step.meters.map((m) => (
            <Meter key={m.kind} meter={m} bar="w-12" />
          ))}
          {props.stop === null ? null : (
            <span className="ms-auto">
              <StopButton stop={props.stop} />
            </span>
          )}
        </div>
      )}
      {step.handedTo === null ? null : (
        <span data-slot="drive-handoff-to" className="sr-only">
          {t("desktop.drive.handedTo", { name: step.handedTo })}
        </span>
      )}
    </div>
  );
}
