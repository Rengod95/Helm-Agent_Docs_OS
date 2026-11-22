// 최근 턴: 턴 하나를 골라 트레이스를 여는 길. 줄을 누르면 그 턴의 트레이스로 간다.
// 넷째 판(AGE-36): 엔진의 모든 대화 목록(`turnRecord.recent`)을 쪽 단위로 읽는다. 목록은 높이가 정해진 칸 안에서 스크롤하고,
// 바닥에 닿으면 다음 쪽을 읽는다(그림 열 전체가 끝없이 늘지 않게). 거르기 셋:
//   - 기간 전체(플러그인을 좁혀 보면 그 플러그인의 Hook이 결정을 낸 턴만): 첫 쪽은 화면 원천이 이미 읽은 것(`data.recent`)을 쓴다
//   - 날: 날별 흐름의 기둥을 누르면 그 UTC 하루만 읽는다
//   - 근거: 인사이트 카드의 "근거 턴 n개"를 누르면 그 인사이트의 근거 턴만 보인다. 엔진은 근거를 턴 id로 주고(`findings.evidence`),
//     턴 id로 거르는 목록은 없어서 보이는 줄마다 턴 기록을 하나씩 읽어 시각·결정을 채운다
import { activeLocale, t } from "@fresnel/client/i18n";
import { detach, ok, rethrow, type Result } from "@fresnel/contracts";
import type { Finding } from "@fresnel/contracts/wire";
import { Button, ListNavigation, ListNavigationItem, Skeleton } from "@caustic/react";
import { X } from "@caustic/react/icons";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CommandError } from "../../commands.ts";
import { countText } from "./format.ts";
import { DecisionGlyph, type Decision } from "./glyphs.tsx";
import { ruleTitleOf } from "./insights.tsx";
import {
  evidenceTurnsOf,
  isPartialTurn,
  mergeFirstPage,
  turnKeyOf,
  type RecentTurn,
  type TurnBrief,
} from "./model.ts";
import { Gate, LoadProblem, LoadingBlock, Section } from "./parts.tsx";
import { dayLongText } from "./sections.tsx";
import type { MetricsData, RecentTurns } from "./source.ts";

/** "최근 턴"의 거르기 */
export type RecentFilter =
  | { readonly kind: "all" }
  | { readonly kind: "day"; readonly day: string }
  | { readonly kind: "evidence"; readonly finding: Finding };

/** 근거 줄을 한 번에 더 보이는 수(줄마다 턴 기록 하나를 읽으므로 조금씩) */
const EVIDENCE_STEP = 16;

function whenText(epochMs: number): string {
  return new Intl.DateTimeFormat(activeLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(epochMs);
}

/** 턴 요약의 결정 표: 0이 아닌 것만 점 구슬과 수로. 고장(고장으로 막음·시간 초과·실패)은 하나로 묶는다 */
function TurnDecisions(props: { readonly turn: TurnBrief }): ReactNode {
  const f = props.turn.flags;
  const items: readonly { readonly kind: Decision; readonly n: number; readonly word: string }[] = [
    { kind: "blocked", n: f.blockedIntent, word: t("desktop.craft.metrics.daily.blocked") },
    { kind: "asked", n: f.asked, word: t("desktop.craft.metrics.daily.asked") },
    { kind: "modified", n: f.modified, word: t("desktop.craft.metrics.daily.modified") },
    {
      kind: "error",
      n: f.blockedFault + f.timedOut + f.failed,
      word: t("desktop.craft.metrics.recent.fault"),
    },
  ];
  const shown = items.filter((i) => i.n > 0);
  if (shown.length === 0) return <span aria-hidden="true" />;
  return (
    <span className="flex items-center gap-2.5">
      {shown.map((i) => (
        <span
          key={i.kind}
          title={i.word}
          className={`inline-flex items-center gap-1 text-ui-sm ${i.kind === "error" ? "text-danger-text" : "text-text-secondary"}`}
        >
          <DecisionGlyph decision={i.kind} size={11} />
          <span className="sr-only">{i.word}</span>
          {countText(i.n)}
        </span>
      ))}
    </span>
  );
}

function StatusChip(props: { readonly turn: TurnBrief }): ReactNode {
  const turn = props.turn;
  const word =
    turn.status === "open"
      ? t("desktop.craft.trace.status.open")
      : isPartialTurn(turn)
        ? t("desktop.craft.trace.status.partial")
        : turn.status === "completed"
          ? null
          : turn.status === "failed" || turn.status === "lost"
            ? t("desktop.craft.trace.status.failed")
            : t("desktop.craft.trace.status.interrupted");
  if (word === null) return <span aria-hidden="true" />;
  const warn = turn.status !== "open";
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-ui-sm ${warn ? "border-warning-border text-text-secondary" : "border-border-default text-text-secondary"}`}
    >
      {turn.status === "open" ? <span className="viz-live">{word}</span> : word}
    </span>
  );
}

/**
 * 줄 하나: 대화 목록의 줄과 같은 부품(`ListNavigationItem`, 높이 32). 앞에 시각, 가운데 대화 제목, 뒤에 결정과 상태.
 * 근거 줄은 턴 기록을 읽는 동안 시각 자리에 빈 막대를 둔다(`turn` null)
 */
function TurnLine(props: {
  readonly turn: TurnBrief | null;
  readonly title: string | null;
  readonly onOpen: () => void;
}): ReactNode {
  const turn = props.turn;
  const name = props.title ?? t("desktop.craft.metrics.recent.untitled");
  return (
    <ListNavigationItem
      leading={
        turn === null ? (
          <span className="flex w-36 shrink-0 items-center">
            <Skeleton width={88} height={10} />
          </span>
        ) : (
          <time
            className="viz-figure w-36 shrink-0 truncate text-ui-sm text-text-tertiary"
            dateTime={new Date(turn.startedAt).toISOString()}
          >
            {whenText(turn.startedAt)}
          </time>
        )
      }
      meta={
        turn === null ? undefined : (
          <span className="flex items-center gap-3">
            <span className="viz-figure hidden items-baseline gap-2 text-ui-sm text-text-tertiary @[40rem]/metrics:inline-flex">
              <span>
                {t("desktop.craft.trace.rail.steps", { steps: countText(turn.stepCount) })}
              </span>{" "}
              <span>
                {t("desktop.craft.trace.rail.calls", { calls: countText(turn.callCount) })}
              </span>
            </span>
            <TurnDecisions turn={turn} />
            <StatusChip turn={turn} />
          </span>
        )
      }
      onSelect={props.onOpen}
    >
      <span className="truncate">{name}</span>
    </ListNavigationItem>
  );
}

type Read<T> = (
  cursor: string | null,
) => Promise<Result<{ readonly items: readonly T[]; readonly next: string | null }, CommandError>>;

interface PageState<T> {
  readonly key: string;
  /** 이 목록이 읽은 쪽들(씨앗이 있으면 씨앗 뒤의 쪽들) */
  readonly items: readonly T[];
  readonly next: string | null;
  /** 한 쪽이라도 읽었나 */
  readonly read: boolean;
  readonly busy: boolean;
  readonly error: CommandError | null;
  readonly nonce: number;
}

interface Pages<T> {
  readonly items: readonly T[];
  readonly next: string | null;
  readonly status: "loading" | "ready" | "more" | "error";
  readonly error: CommandError | null;
  readonly more: () => void;
  readonly retry: () => void;
}

function freshPages<T>(key: string, nonce: number): PageState<T> {
  return { key, items: [], next: null, read: false, busy: false, error: null, nonce };
}

/**
 * 쪽 단위 목록. `key`가 바뀌면 처음부터다(이전 키의 상태는 그리는 동안 버린다).
 * `seed`가 있으면 첫 쪽을 읽지 않고 그것으로 시작해 그 뒤 쪽만 읽고, 씨앗이 바뀌면(새 턴) 새 씨앗 + 이어 읽은 줄로 합친다(`merge`)
 */
function usePages<T>(
  key: string,
  read: Read<T>,
  seed: { readonly items: readonly T[]; readonly next: string | null } | null,
  merge: (fresh: readonly T[], old: readonly T[]) => readonly T[],
): Pages<T> {
  const [state, setState] = useState<PageState<T>>(() => freshPages(key, 0));
  const s = state.key === key ? state : freshPages<T>(key, state.nonce);
  const reader = useRef(read);
  useEffect(() => {
    reader.current = read;
  });
  const needFirst = seed === null && !s.read && s.error === null;
  useEffect(() => {
    if (!needFirst) return undefined;
    let active = true;
    detach(
      reader.current(null).then((got) => {
        if (!active) return undefined;
        setState(
          got.ok
            ? {
                ...freshPages<T>(key, s.nonce),
                items: got.value.items,
                next: got.value.next,
                read: true,
              }
            : { ...freshPages<T>(key, s.nonce), error: got.error },
        );
        return undefined;
      }),
      rethrow,
    );
    return () => {
      active = false;
    };
  }, [key, needFirst, s.nonce]);
  const items = seed === null ? s.items : merge(seed.items, s.items);
  const next = s.read ? s.next : (seed?.next ?? null);
  const status: Pages<T>["status"] =
    s.error !== null ? "error" : seed === null && !s.read ? "loading" : s.busy ? "more" : "ready";
  return {
    items,
    next,
    status,
    error: s.error,
    more: () => {
      if (status !== "ready" || next === null) return;
      setState({ ...s, busy: true });
      detach(
        reader.current(next).then((got) => {
          setState((cur) => {
            if (cur.key !== key) return cur;
            return got.ok
              ? {
                  ...cur,
                  // 이어 붙인다: 앞의 줄이 먼저, 새 쪽에서 이미 있는 줄은 뺀다
                  items: merge(cur.items, got.value.items),
                  next: got.value.next,
                  read: true,
                  busy: false,
                }
              : { ...cur, busy: false, error: got.error };
          });
          return undefined;
        }),
        rethrow,
      );
    },
    retry: () => {
      setState({ ...s, busy: false, error: null, nonce: s.nonce + 1 });
    },
  };
}

function keepNewTurns(fresh: readonly RecentTurn[], old: readonly RecentTurn[]): RecentTurn[] {
  return mergeFirstPage(fresh, old);
}

/** 바닥에서 이만큼(px) 안이면 다음 쪽을 읽는다 */
const BOTTOM_SLACK = 96;

/**
 * 목록 칸: 높이가 정해진 스크롤 칸(줄 12개쯤). 바닥 가까이 내리면 `onBottom`. 칸이 덜 차 스크롤할 수 없을 때를 위해
 * 더 있으면 바닥에 "더 보기"를 둔다
 */
function ListBox(props: {
  readonly label: string;
  readonly onBottom: () => void;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div
      className="-mx-2 max-h-[25.5rem] overflow-y-auto overscroll-contain"
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_SLACK) props.onBottom();
      }}
    >
      <ListNavigation size="sm" aria-label={props.label}>
        {props.children}
      </ListNavigation>
      {props.loadingMore ? (
        <div role="status" className="flex h-8 items-center px-2 text-ui-sm text-text-tertiary">
          {t("desktop.craft.metrics.recent.loadingMore")}
        </div>
      ) : props.failed ? (
        <div className="flex h-8 items-center gap-2 px-2 text-ui-sm text-text-secondary">
          {t("desktop.craft.metrics.state.error")}
          <Button size="xs" variant="ghost" onClick={props.onRetry}>
            {t("desktop.craft.metrics.state.retry")}
          </Button>
        </div>
      ) : props.hasMore ? (
        <Button
          size="sm"
          variant="ghost"
          className="ms-0.5 w-fit font-normal text-text-tertiary"
          onClick={props.onBottom}
        >
          {t("desktop.craft.metrics.recent.showMore")}
        </Button>
      ) : null}
    </div>
  );
}

function EmptyLine(props: { readonly text: string }): ReactNode {
  return (
    <div className="flex min-h-12 items-center rounded-2xl border border-dashed border-border-default px-4 text-ui text-text-secondary">
      {props.text}
    </div>
  );
}

/** 기간 전체·날의 턴 목록 */
function TurnList(props: {
  readonly data: MetricsData;
  readonly day: string | null;
  readonly seed: RecentTurns | null;
}): ReactNode {
  const d = props.data;
  const key = `${JSON.stringify(d.filter)}:${props.day ?? ""}`;
  // 첫 쪽은 원천이 읽은 값 그대로(같은 값이면 같은 물체라 다시 합치지 않는다)
  const seed = useMemo(
    () => (props.seed === null ? null : { items: props.seed.turns, next: props.seed.next }),
    [props.seed],
  );
  const pages = usePages<RecentTurn>(
    key,
    (cursor) => d.actions.recentPage(props.day, cursor),
    seed,
    keepNewTurns,
  );
  if (pages.status === "loading") {
    return <LoadingBlock height={160} label={t("desktop.craft.metrics.recent.title")} />;
  }
  if (pages.status === "error" && pages.items.length === 0) {
    return (
      <LoadProblem
        kind={pages.error?.kind === "unsupported" ? "unsupported" : "error"}
        onRetry={pages.retry}
      />
    );
  }
  if (pages.items.length === 0) {
    return (
      <EmptyLine
        text={
          props.day === null
            ? t("desktop.craft.metrics.recent.none")
            : t("desktop.craft.metrics.recent.dayNone")
        }
      />
    );
  }
  return (
    <ListBox
      label={t("desktop.craft.metrics.recent.title")}
      onBottom={pages.more}
      hasMore={pages.next !== null}
      loadingMore={pages.status === "more"}
      failed={pages.status === "error"}
      onRetry={pages.retry}
    >
      {pages.items.map((item) => (
        <TurnLine
          key={turnKeyOf(item.turn)}
          turn={item.turn}
          title={item.title}
          onOpen={() => {
            d.actions.openTurn({
              kind: "turn",
              threadId: item.turn.threadId,
              turnId: item.turn.turnId,
            });
          }}
        />
      ))}
    </ListBox>
  );
}

type EvidenceTurn = { readonly threadId: string; readonly turnId: string };

/** 근거 줄 하나: 붙을 때 턴 기록을 읽어 시각과 결정을 채운다(목록이 줄을 늘리기만 하므로 한 줄은 한 번 읽는다) */
function EvidenceLine(props: {
  readonly data: MetricsData;
  readonly turn: EvidenceTurn;
}): ReactNode {
  const { threadId, turnId } = props.turn;
  const { turnBrief, openTurn } = props.data.actions;
  const [brief, setBrief] = useState<TurnBrief | null>(null);
  useEffect(() => {
    let active = true;
    detach(
      turnBrief(threadId, turnId).then((got) => {
        if (active && got.ok) setBrief(got.value);
        return undefined;
      }),
      rethrow,
    );
    return () => {
      active = false;
    };
  }, [turnBrief, threadId, turnId]);
  return (
    <TurnLine
      turn={brief}
      title={props.data.threadTitle(threadId)}
      onOpen={() => {
        openTurn({ kind: "turn", threadId, turnId });
      }}
    />
  );
}

function keepEvidence(
  fresh: readonly EvidenceTurn[],
  old: readonly EvidenceTurn[],
): EvidenceTurn[] {
  const seen = new Set(fresh.map(turnKeyOf));
  return [...fresh, ...old.filter((x) => !seen.has(turnKeyOf(x)))];
}

/** 인사이트 근거 턴의 목록 */
function EvidenceList(props: { readonly data: MetricsData; readonly finding: Finding }): ReactNode {
  const d = props.data;
  const f = props.finding;
  const pages = usePages<EvidenceTurn>(
    `evidence:${f.id}`,
    async (cursor) => {
      const got = await d.actions.evidence(f.id, cursor);
      return got.ok ? ok({ items: evidenceTurnsOf(got.value.items), next: got.value.next }) : got;
    },
    null,
    keepEvidence,
  );
  const [shown, setShown] = useState(EVIDENCE_STEP);
  // 쪽 사이에 같은 턴이 다시 나올 수 있어 한 번만 둔다
  const unique = keepEvidence([], pages.items);
  if (pages.status === "loading") {
    return <LoadingBlock height={160} label={t("desktop.craft.metrics.recent.title")} />;
  }
  if (pages.status === "error" && unique.length === 0) {
    return (
      <LoadProblem
        kind={pages.error?.kind === "unsupported" ? "unsupported" : "error"}
        onRetry={pages.retry}
      />
    );
  }
  if (unique.length === 0) {
    return <EmptyLine text={t("desktop.craft.metrics.recent.evidenceNone")} />;
  }
  const visible = unique.slice(0, shown);
  return (
    <ListBox
      label={t("desktop.craft.metrics.recent.title")}
      onBottom={() => {
        if (shown < unique.length) setShown(shown + EVIDENCE_STEP);
        else pages.more();
      }}
      hasMore={shown < unique.length || pages.next !== null}
      loadingMore={pages.status === "more"}
      failed={pages.status === "error"}
      onRetry={pages.retry}
    >
      {visible.map((turn) => (
        <EvidenceLine key={turnKeyOf(turn)} data={d} turn={turn} />
      ))}
    </ListBox>
  );
}

export function RecentTurnsSection(props: {
  readonly data: MetricsData;
  readonly filter: RecentFilter;
  readonly onClear: () => void;
}): ReactNode {
  const d = props.data;
  const filter = props.filter;
  const clear =
    filter.kind === "all" ? undefined : (
      <Button size="xs" variant="outline" onClick={props.onClear}>
        <span className="max-w-64 truncate">
          {filter.kind === "day"
            ? t("desktop.craft.metrics.recent.dayUtc", { day: dayLongText(filter.day) })
            : t("desktop.craft.metrics.recent.evidenceOf", {
                title: ruleTitleOf(filter.finding.ruleId),
                plugin: filter.finding.subject.plugin,
              })}
        </span>
        <X
          size={12}
          aria-label={
            filter.kind === "day"
              ? t("desktop.craft.metrics.recent.clearDay")
              : t("desktop.craft.metrics.recent.clearEvidence")
          }
        />
      </Button>
    );
  return (
    <Section
      id="cm-recent"
      title={t("desktop.craft.metrics.recent.title")}
      info={t("desktop.craft.metrics.recent.info")}
      {...(clear === undefined ? {} : { actions: clear })}
    >
      {filter.kind === "evidence" ? (
        <EvidenceList key={filter.finding.id} data={d} finding={filter.finding} />
      ) : filter.kind === "day" || d.filter.plugin !== null ? (
        <TurnList
          key={filter.kind === "day" ? filter.day : "focus"}
          data={d}
          day={filter.kind === "day" ? filter.day : null}
          seed={null}
        />
      ) : (
        <Gate
          load={d.recent}
          height={160}
          label={t("desktop.craft.metrics.recent.title")}
          onRetry={d.actions.reload}
        >
          {(recent) => <TurnList key="all" data={d} day={null} seed={recent} />}
        </Gate>
      )}
    </Section>
  );
}
