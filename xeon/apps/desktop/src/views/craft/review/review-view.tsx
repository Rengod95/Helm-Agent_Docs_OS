// 리뷰 화면(C5, AGE-34). 왼쪽 목록(대화 목록과 같은 줄) + 오른쪽 자세히(콘텐츠 영역 전체, `review-detail.tsx`).
// 키: j·k(↑·↓) 목록 이동, a 승인, r 거절, [ ] 파일 넘기기. 글을 넣는 칸 안에서는 먹지 않는다.
// 개발 빌드는 `dev` 칸으로 표본 메뉴를 머리 오른쪽 끝에 얹고, 빈 화면에 "표본 장면 보기"를 둔다(셋째 판: 창 왼쪽 아래 구석에서 옮겼다).
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  Alert,
  cn,
  EmptyState,
  listNavigationHeading,
  listNavigationLabel,
  listNavigationLink,
  listNavigationMeta,
  Skeleton,
} from "@caustic/react";
import { FlaskConical, Inbox } from "@caustic/react/icons";
import { assertNever } from "@fresnel/contracts";
import type { Profile, ReviewItem } from "@fresnel/contracts/wire";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useThreadSummaries } from "../../../state/engine/index.ts";
import { useRailAvoid } from "../../shell/rail-avoid.ts";
import { ScreenHeader } from "../../shell/screen-header.tsx";
import { SIDE_ROW } from "../../side-row.ts";
import { InfoTip } from "../info-tip.tsx";
import {
  ReviewDetail,
  type Decided,
  type DecisionHandle,
  type DetailArrange,
  type FileHandle,
} from "./review-detail.tsx";
import { KindTile, ToneGlyph } from "./review-glyphs.tsx";
import { agoText, ENTRY_WORD } from "./review-parts.tsx";
import {
  entryKindOf,
  nextAfter,
  pendingOf,
  primaryKindOf,
  reviewKeyOf,
  stepItem,
  versionsOf,
  type EntryKind,
} from "./review-model.ts";
import type { ReviewData } from "./review-source.ts";

const GROUP_ORDER: readonly EntryKind[] = ["install", "update", "draft", "remove"];

interface Group {
  readonly key: EntryKind | "decided";
  readonly label: MessageId;
  readonly items: readonly ReviewItem[];
}

/** 목록 무리: 할 일 종류 넷(빈 무리는 뺀다), 그다음 이 화면에서 방금 결정한 것 */
function groupsOf(
  pending: readonly ReviewItem[],
  decided: readonly ReviewItem[],
): readonly Group[] {
  const groups: Group[] = GROUP_ORDER.flatMap((kind): Group[] => {
    const items = pending.filter((item) => entryKindOf(item) === kind);
    return items.length === 0 ? [] : [{ key: kind, label: ENTRY_WORD[kind], items }];
  });
  if (decided.length > 0) {
    groups.push({ key: "decided", label: "desktop.craft.review.group.decided", items: decided });
  }
  return groups;
}

/** 글을 넣는 자리에 초점이 있으면 화면 키를 먹지 않는다 */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest("input, textarea, select, [role='textbox'], [role='listbox']") !== null
  );
}

function useThreadTitles(): (threadId: string | null) => string | null {
  const threads = useThreadSummaries();
  return useCallback(
    (threadId) => {
      if (threadId === null) return null;
      return threads.find((thread) => thread.threadId === threadId)?.title ?? null;
    },
    [threads],
  );
}

interface Ready {
  readonly items: readonly ReviewItem[];
  readonly profiles: readonly Profile[];
  readonly managedOff: ReadonlySet<string>;
  readonly missing: ReadonlyMap<string, readonly string[]>;
  readonly offline: boolean;
}

/** 개발 빌드만: 머리 오른쪽 끝의 표본 메뉴와, 빈 화면에서 표본 장면으로 가는 길(`review-dev.tsx`) */
export interface ReviewDevSlot {
  readonly menu: ReactNode;
  readonly showSample: () => void;
}

/** 화면 상태: 고른 항목, 이 화면에서 결정한 항목(목록에 "방금 결정함"으로 남는다), 키 처리 */
function useReviewState(data: ReviewData, ready: Ready) {
  const pending = useMemo(() => pendingOf(ready.items), [ready.items]);
  const [decided, setDecided] = useState<ReadonlyMap<string, Decided>>(new Map());
  const [kept, setKept] = useState<ReadonlyMap<string, ReviewItem>>(new Map());
  const decidedItems = useMemo(
    () => [...kept.values()].filter((item) => !pending.some((p) => p.itemId === item.itemId)),
    [kept, pending],
  );
  const groups = useMemo(() => groupsOf(pending, decidedItems), [pending, decidedItems]);
  const ids = useMemo(() => groups.flatMap((g) => g.items.map((i) => i.itemId)), [groups]);
  const [selected, setSelected] = useState<string | null>(null);
  const current = selected !== null && ids.includes(selected) ? selected : (ids[0] ?? null);
  const item = pending.find((i) => i.itemId === current) ?? kept.get(current ?? "") ?? null;
  const handleRef = useRef<DecisionHandle | null>(null);
  const fileRef = useRef<FileHandle | null>(null);

  const onDecided = useCallback(
    (itemId: string, result: Decided) => {
      const found = pending.find((i) => i.itemId === itemId);
      if (found !== undefined) setKept((old) => new Map(old).set(itemId, found));
      setDecided((old) => new Map(old).set(itemId, result));
      data.reload();
    },
    [data, pending],
  );

  const pendingIds = useMemo(() => pending.map((i) => i.itemId), [pending]);
  const next = current === null || !decided.has(current) ? null : nextAfter(pendingIds, current);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (typing(event.target)) return;
    const key = reviewKeyOf(event);
    if (key === null) return;
    event.preventDefault();
    switch (key) {
      case "next":
      case "prev":
        setSelected(stepItem(ids, current, key === "next" ? 1 : -1));
        return;
      case "approve":
        handleRef.current?.approve();
        return;
      case "reject":
        handleRef.current?.reject();
        return;
      case "nextFile":
      case "prevFile":
        fileRef.current?.step(key === "nextFile" ? 1 : -1);
        return;
      default:
        assertNever(key, "review key");
    }
  };

  return {
    pending,
    groups,
    current,
    item,
    decided: current === null ? null : (decided.get(current) ?? null),
    decidedOf: (itemId: string) => decided.get(itemId) ?? null,
    select: (itemId: string) => {
      setSelected(itemId);
    },
    next:
      next === null
        ? null
        : () => {
            setSelected(next);
          },
    onDecided,
    onKeyDown,
    handleRef,
    fileRef,
  };
}

type ReviewState = ReturnType<typeof useReviewState>;

/** 읽기 상태(읽는 중, 연결 끊김, 지원 안 함, 실패). 준비되지 않은 데이터를 빈 목록으로 그리지 않는다 */
function LoadBand(props: { readonly data: ReviewData }): ReactNode {
  const { load } = props.data;
  switch (load.status) {
    case "loading":
      return (
        <div
          role="status"
          aria-label={t("desktop.craft.review.state.loading")}
          className="grid w-full max-w-[720px] gap-3 p-4"
        >
          <Skeleton className="h-8" style={{ width: "100%" }} />
          <Skeleton className="h-8" style={{ width: "86%" }} />
          <Skeleton className="h-8" style={{ width: "92%" }} />
        </div>
      );
    case "offline":
      return (
        <div data-rail-avoid="" className="w-full max-w-[720px] p-4">
          <Alert tone="warning" icon={<ToneGlyph tone="warning" />}>
            {t("desktop.craft.review.state.offline")}
          </Alert>
        </div>
      );
    case "unsupported":
      return (
        <div data-rail-avoid="" className="w-full max-w-[720px] p-4">
          <Alert tone="warning" icon={<ToneGlyph tone="warning" />}>
            {t("desktop.craft.review.state.unsupported")}
          </Alert>
        </div>
      );
    case "failed":
      return (
        <div data-rail-avoid="" className="w-full max-w-[720px] p-4">
          <Alert
            tone="danger"
            icon={<ToneGlyph tone="danger" />}
            actions={[
              {
                label: t("desktop.craft.review.state.retry"),
                primary: true,
                onClick: () => {
                  props.data.reload();
                },
              },
            ]}
          >
            {t("desktop.craft.review.state.failed")}
          </Alert>
        </div>
      );
    case "ready":
      return null;
    default:
      return assertNever(load, "review load");
  }
}

function Empty(props: { readonly dev: ReviewDevSlot | null }): ReactNode {
  const { dev } = props;
  return (
    <div className="grid flex-1 place-items-center p-6">
      <EmptyState
        size="md"
        surface="none"
        icon={<Inbox />}
        title={t("desktop.craft.review.state.empty")}
        description={t("desktop.craft.review.state.emptyHint")}
        {...(dev === null
          ? {}
          : {
              actions: [
                {
                  label: t("desktop.craft.review.dev.showSample"),
                  icon: <FlaskConical />,
                  variant: "ghost",
                  onClick: dev.showSample,
                },
              ],
            })}
      />
    </div>
  );
}

function KeysTip(): ReactNode {
  return (
    <InfoTip
      text={t("desktop.craft.review.keys.hint")}
      label={t("desktop.craft.review.keys.label")}
    />
  );
}

/** 끊김 띠: 읽은 목록은 남기고 결정만 잠근다 */
function OfflineBand(props: { readonly offline: boolean }): ReactNode {
  if (!props.offline) return null;
  return (
    <div className="px-4 pt-2">
      <Alert data-rail-avoid="" tone="warning" icon={<ToneGlyph tone="warning" />}>
        {t("desktop.craft.review.state.offlineStale")}
      </Alert>
    </div>
  );
}

// ── 목록 ────────────────────────────────────────────────────────────────

const ROW = cn(listNavigationLink({ kind: "sessions", size: "sm" }), SIDE_ROW, "min-w-0 border-0");

function ListRow(props: {
  readonly item: ReviewItem;
  readonly on: boolean;
  readonly decided: Decided | null;
  readonly now: number;
  readonly onPick: () => void;
}): ReactNode {
  const { item } = props;
  return (
    <li className="list-none">
      <button
        type="button"
        data-review-row={item.itemId}
        aria-current={props.on ? "page" : undefined}
        className={cn(
          ROW,
          props.on ? null : "bg-transparent",
          props.decided === null ? null : "text-text-tertiary",
        )}
        onClick={props.onPick}
      >
        <KindTile kind={primaryKindOf(item.card)} size={16} />
        <span className={cn(listNavigationLabel(), "min-w-0 flex-1 truncate")}>
          {item.card.displayName}
        </span>
        <span className={listNavigationMeta()}>
          {props.decided === null
            ? agoText(item.createdAt, props.now)
            : t(
                props.decided.kind === "approved"
                  ? "desktop.craft.review.outcome.approved"
                  : props.decided.kind === "sentBack"
                    ? "desktop.craft.review.outcome.sentBack"
                    : "desktop.craft.review.outcome.discarded",
              )}
        </span>
      </button>
    </li>
  );
}

function SplitLayout(props: {
  readonly data: ReviewData;
  readonly ready: Ready;
  readonly state: ReviewState;
  readonly now: number;
  readonly arrange: DetailArrange;
}): ReactNode {
  const { state, ready, now } = props;
  const titleOf = useThreadTitles();
  const item = state.item;
  return (
    <div className="rv-split flex min-h-0 flex-1">
      <nav
        aria-label={t("desktop.craft.review.listLabel")}
        className="rv-list flex shrink-0 flex-col overflow-y-auto border-e border-border-subtle px-2 pt-2 pb-4"
      >
        {state.groups.map((group) => (
          <div key={group.key} className="grid gap-px pt-2 first:pt-0">
            <div className={cn(listNavigationHeading({ kind: "sessions" }), "justify-start")}>
              <span>{t(group.label)}</span>
              <span className="ms-auto text-hint text-text-placeholder normal-case normal-nums">
                {String(group.items.length)}
              </span>
            </div>
            <ul className="m-0 grid gap-px p-0">
              {group.items.map((i) => (
                <ListRow
                  key={i.itemId}
                  item={i}
                  on={i.itemId === state.current}
                  decided={state.decidedOf(i.itemId)}
                  now={now}
                  onPick={() => {
                    state.select(i.itemId);
                  }}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {item === null ? (
        <p className="m-0 p-6 text-ui text-text-tertiary">{t("desktop.craft.review.state.pick")}</p>
      ) : (
        <ReviewDetail
          key={item.itemId}
          item={item}
          versions={versionsOf(item, ready.items)}
          profiles={ready.profiles}
          missing={ready.missing}
          managedOff={ready.managedOff.has(item.name)}
          offline={ready.offline}
          threadTitle={titleOf(item.originThreadId)}
          now={now}
          data={props.data}
          decided={state.decided}
          onDecided={state.onDecided}
          onNext={state.next}
          handleRef={state.handleRef}
          fileRef={state.fileRef}
          arrange={props.arrange}
        />
      )}
    </div>
  );
}

// ── 화면 ────────────────────────────────────────────────────────────────

/**
 * 오른쪽 떠 있는 막대와 겹치면 막대를 비키는 줄들(m6R5). 줄 단위로 고른다: 알림 카드, 섹션 안의 한 덩이(제목, 알림 줄, 이름표-값의 값),
 * 결정 칸의 한 칸. 선과 열의 면은 고르지 않아 끝까지 간다. 고른 줄이 막대와 세로로도 가로로도 겹칠 때만 줄어든다(`rail-avoid.ts`)
 */
const RAIL_ROWS =
  ".rv-head > *, .rv-alerts > *, .rv-sec > :not(.rv-facts, .rv-lines), .rv-facts dd, .rv-lines > *, .rv-decide > *";

function ReadyView(props: {
  readonly data: ReviewData;
  readonly ready: Ready;
  readonly arrange: DetailArrange;
  readonly dev: ReviewDevSlot | null;
}): ReactNode {
  const state = useReviewState(props.data, props.ready);
  // 상대 시각(n분 전)의 기준. 화면을 연 때로 고정한다(그리기마다 바뀌지 않게)
  const [now] = useState(() => Date.now());
  const empty = state.groups.length === 0;
  // 화면을 열면 초점을 화면으로 옮긴다: 탐색 줄을 눌러 들어와도 j·k·a·r가 바로 듣는다. 글을 쓰는 중이면 옮기지 않는다
  const rootRef = useRef<HTMLElement>(null);
  useRailAvoid(rootRef, RAIL_ROWS);
  useEffect(() => {
    if (typing(document.activeElement)) return;
    rootRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-label={t("desktop.craft.review.title")}
      className="flex min-h-0 flex-1 flex-col outline-none focus-visible:shadow-none focus-visible:outline-none"
      onKeyDown={state.onKeyDown}
    >
      {/* 목록과 자세히는 머리 선 바로 아래에서 시작하고 창 오른쪽 끝까지 간다(`flush`, 등록의 `bleed`): 세로 선이 머리 선과 만나고,
          오른쪽 떠 있는 막대와 겹치는 줄만 화면이 비킨다(`RAIL_ROWS`, m6R5) */}
      <ScreenHeader
        title={t("desktop.craft.review.title")}
        flush={!empty}
        meta={
          state.pending.length === 0 ? undefined : (
            <span className="text-ui text-text-tertiary">
              {t("desktop.craft.review.pending", { count: state.pending.length })}
            </span>
          )
        }
        controls={headerControls(empty ? null : <KeysTip />, props.dev)}
      />
      <OfflineBand offline={props.ready.offline} />
      {empty ? (
        <Empty dev={props.dev} />
      ) : (
        <SplitLayout
          data={props.data}
          ready={props.ready}
          state={state}
          now={now}
          arrange={props.arrange}
        />
      )}
    </section>
  );
}

/** 머리 오른쪽 칸: 키 안내, 그리고 맨 오른쪽 끝에 개발 빌드의 표본 메뉴 */
function headerControls(keys: ReactNode, dev: ReviewDevSlot | null): ReactNode {
  if (keys === null && dev === null) return undefined;
  return (
    <>
      {keys}
      {dev?.menu}
    </>
  );
}

/** 불러오는 중·실패·끊김 화면. 끝까지 쓰는 화면이라 이 안내도 막대와 겹치면 비킨다 */
function LoadView(props: {
  readonly data: ReviewData;
  readonly dev: ReviewDevSlot | null;
}): ReactNode {
  const rootRef = useRef<HTMLElement>(null);
  useRailAvoid(rootRef, "");
  return (
    <section
      ref={rootRef}
      aria-label={t("desktop.craft.review.title")}
      className="flex min-h-0 flex-1 flex-col"
    >
      <ScreenHeader
        title={t("desktop.craft.review.title")}
        controls={headerControls(null, props.dev)}
      />
      <LoadBand data={props.data} />
    </section>
  );
}

export function ReviewView(props: {
  readonly data: ReviewData;
  /** 개발 빌드의 견주기 판. 배포 빌드는 `band`다 */
  readonly arrange?: DetailArrange;
  /** 개발 빌드만. 배포 빌드는 넘기지 않는다 */
  readonly dev?: ReviewDevSlot;
}): ReactNode {
  const { load } = props.data;
  const dev = props.dev ?? null;
  if (load.status !== "ready") return <LoadView data={props.data} dev={dev} />;
  return (
    <ReadyView
      data={props.data}
      ready={{
        items: load.items,
        profiles: load.profiles,
        managedOff: load.managedOff,
        missing: load.missing,
        offline: load.offline,
      }}
      arrange={props.arrange ?? "band"}
      dev={dev}
    />
  );
}
