// 리뷰 화면(C5)의 두 판. 같은 원천(`ReviewData`)과 같은 상세 본문(`review-detail.tsx`)을 쓰고 배치만 다르다.
//   가(`split`): 왼쪽 목록(대화 목록과 같은 줄) + 오른쪽 상세 카드. 목록을 훑으며 하나씩 깊이 본다.
//   나(`cards`): 가운데 한 줄의 카드 목록. 고른 카드가 그 자리에서 펼쳐진다. 접힌 카드에도 코드 실행 안내가 보인다.
// 키(두 판 같음): j·k(↑·↓) 목록 이동, a 승인, r 거절, [ ] 파일 넘기기. 글을 넣는 칸 안에서는 먹지 않는다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  Alert,
  Button,
  cn,
  EmptyState,
  listNavigationHeading,
  listNavigationLabel,
  listNavigationLink,
  listNavigationMeta,
  Skeleton,
} from "@caustic/react";
import { ChevronDown, ChevronRight, Inbox } from "@caustic/react/icons";
import { assertNever } from "@fresnel/contracts";
import type { Profile, ReviewItem } from "@fresnel/contracts/wire";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useThreadSummaries } from "../../../state/engine/index.ts";
import { ScreenHeader } from "../../shell/screen-header.tsx";
import { SIDE_ROW } from "../../side-row.ts";
import { InfoTip } from "../info-tip.tsx";
import {
  agoText,
  CodeNotice,
  ENTRY_WORD,
  ReviewBody,
  ReviewHead,
  type Decided,
  type DecisionHandle,
  type FileHandle,
} from "./review-detail.tsx";
import { KindTile } from "./review-glyphs.tsx";
import {
  baseItemOf,
  entryKindOf,
  nextAfter,
  pendingOf,
  primaryKindOf,
  reviewKeyOf,
  stepItem,
  type EntryKind,
} from "./review-model.ts";
import type { ReviewData } from "./review-source.ts";

export type ReviewLayout = "split" | "cards";

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
  readonly offline: boolean;
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
  // 나 판에서 고른 카드를 접었는지. 가 판은 늘 펼쳐 둔다
  const [open, setOpen] = useState(true);
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
        setOpen(true);
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
    open,
    select: (itemId: string) => {
      setSelected(itemId);
      setOpen(true);
    },
    collapse: () => {
      setOpen(false);
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
        <div className="w-full max-w-[720px] p-4">
          <Alert tone="warning">{t("desktop.craft.review.state.offline")}</Alert>
        </div>
      );
    case "unsupported":
      return (
        <div className="w-full max-w-[720px] p-4">
          <Alert tone="warning">{t("desktop.craft.review.state.unsupported")}</Alert>
        </div>
      );
    case "failed":
      return (
        <div className="w-full max-w-[720px] p-4">
          <Alert
            tone="danger"
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

function Empty(): ReactNode {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <EmptyState
        size="md"
        surface="none"
        icon={<Inbox />}
        title={t("desktop.craft.review.state.empty")}
        description={t("desktop.craft.review.state.emptyHint")}
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
      <Alert tone="warning">{t("desktop.craft.review.state.offlineStale")}</Alert>
    </div>
  );
}

// ── 가: 목록 + 상세 ─────────────────────────────────────────────────────

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
}): ReactNode {
  const { state, ready, now } = props;
  const titleOf = useThreadTitles();
  const headingId = useId();
  const item = state.item;
  return (
    <div className="flex min-h-0 flex-1">
      <nav
        aria-label={t("desktop.craft.review.listLabel")}
        className="flex w-[288px] shrink-0 flex-col overflow-y-auto border-e border-border-subtle px-2 pb-4"
      >
        {state.groups.map((group) => (
          <div key={group.key} className="grid gap-px pt-2 first:pt-0">
            <div className={cn(listNavigationHeading({ kind: "sessions" }), "justify-start")}>
              <span>{t(group.label)}</span>
              <span className="ms-auto text-hint text-text-placeholder normal-case tabular-nums">
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
      <div className="min-w-0 flex-1 overflow-y-auto">
        {item === null ? (
          <p className="m-0 p-6 text-ui text-text-tertiary">
            {t("desktop.craft.review.state.pick")}
          </p>
        ) : (
          <article
            aria-labelledby={headingId}
            className="mx-auto my-3 grid max-w-[760px] gap-5 rounded-xl bg-surface-base p-4 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
          >
            <ReviewHead
              item={item}
              threadTitle={titleOf(item.originThreadId)}
              now={now}
              headingId={headingId}
            />
            <ReviewBody
              key={item.itemId}
              item={item}
              base={baseItemOf(ready.items, item)}
              profiles={ready.profiles}
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
            />
          </article>
        )}
      </div>
    </div>
  );
}

// ── 나: 펼치는 카드 ─────────────────────────────────────────────────────

function CardRow(props: {
  readonly item: ReviewItem;
  readonly open: boolean;
  readonly ready: Ready;
  readonly state: ReviewState;
  readonly data: ReviewData;
  readonly now: number;
  readonly titleOf: (threadId: string | null) => string | null;
}): ReactNode {
  const { item, open, state } = props;
  const headingId = useId();
  const bodyId = useId();
  const decided = state.decidedOf(item.itemId);
  const ref = useRef<HTMLElement>(null);
  // 처음 그릴 때는 움직이지 않는다(펼친 첫 카드가 무리 제목을 화면 밖으로 밀지 않게). 사용자가 펼칠 때만 맞춘다
  const shown = useRef(false);
  useEffect(() => {
    if (!shown.current) {
      shown.current = true;
      return;
    }
    if (open) ref.current?.scrollIntoView({ block: "nearest" });
  }, [open]);
  return (
    <li className="list-none">
      <article
        ref={ref}
        aria-labelledby={headingId}
        data-review-card={item.itemId}
        data-open={open ? "" : undefined}
        className={cn(
          "grid gap-3 rounded-xl bg-surface-base p-4 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]",
          open ? "shadow-[inset_0_0_0_1px_var(--cs-color-border-default)]" : "",
          decided === null ? "" : "opacity-70",
        )}
      >
        <ReviewHead
          item={item}
          threadTitle={props.titleOf(item.originThreadId)}
          now={props.now}
          headingId={headingId}
          trailing={
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={open}
              aria-controls={bodyId}
              className="-me-1.5 shrink-0 gap-1 text-text-secondary"
              onClick={() => {
                if (open) state.collapse();
                else state.select(item.itemId);
              }}
            >
              {open ? t("desktop.craft.review.collapse") : t("desktop.craft.review.expand")}
              {open ? (
                <ChevronDown className="size-3.5" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-3.5" aria-hidden="true" />
              )}
            </Button>
          }
        />
        {open || item.kind === "remove" ? null : <CodeNotice card={item.card} />}
        {open ? (
          <div id={bodyId} className="pt-2">
            <ReviewBody
              key={item.itemId}
              item={item}
              base={baseItemOf(props.ready.items, item)}
              profiles={props.ready.profiles}
              managedOff={props.ready.managedOff.has(item.name)}
              offline={props.ready.offline}
              threadTitle={props.titleOf(item.originThreadId)}
              now={props.now}
              data={props.data}
              decided={state.decided}
              onDecided={state.onDecided}
              onNext={state.next}
              handleRef={state.handleRef}
              fileRef={state.fileRef}
            />
          </div>
        ) : null}
      </article>
    </li>
  );
}

function CardsLayout(props: {
  readonly data: ReviewData;
  readonly ready: Ready;
  readonly state: ReviewState;
  readonly now: number;
}): ReactNode {
  const { state } = props;
  const titleOf = useThreadTitles();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-[760px] gap-5 px-4 pt-2 pb-8">
        {state.groups.map((group) => (
          <section key={group.key} aria-label={t(group.label)} className="grid gap-2">
            <h2 className="m-0 flex items-baseline gap-2 ps-1 text-ui-sm font-medium text-text-tertiary">
              {t(group.label)}
              <span className="text-hint text-text-placeholder tabular-nums">
                {String(group.items.length)}
              </span>
            </h2>
            <ul className="m-0 grid gap-2 p-0">
              {group.items.map((item) => (
                <CardRow
                  key={item.itemId}
                  item={item}
                  open={state.open && item.itemId === state.current}
                  ready={props.ready}
                  state={state}
                  data={props.data}
                  now={props.now}
                  titleOf={titleOf}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

// ── 화면 ────────────────────────────────────────────────────────────────

function ReadyView(props: {
  readonly data: ReviewData;
  readonly ready: Ready;
  readonly layout: ReviewLayout;
}): ReactNode {
  const state = useReviewState(props.data, props.ready);
  // 상대 시각(n분 전)의 기준. 화면을 연 때로 고정한다(그리기마다 바뀌지 않게)
  const [now] = useState(() => Date.now());
  const empty = state.groups.length === 0;
  // 화면을 열면 초점을 화면으로 옮긴다: 탐색 줄을 눌러 들어와도 j·k·a·r가 바로 듣는다. 글을 쓰는 중이면 옮기지 않는다
  const rootRef = useRef<HTMLElement>(null);
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
      <ScreenHeader
        title={t("desktop.craft.review.title")}
        meta={
          state.pending.length === 0 ? undefined : (
            <span className="text-ui text-text-tertiary tabular-nums">
              {t("desktop.craft.review.pending", { count: state.pending.length })}
            </span>
          )
        }
        controls={empty ? undefined : <KeysTip />}
      />
      <OfflineBand offline={props.ready.offline} />
      {empty ? (
        <Empty />
      ) : props.layout === "split" ? (
        <SplitLayout data={props.data} ready={props.ready} state={state} now={now} />
      ) : (
        <CardsLayout data={props.data} ready={props.ready} state={state} now={now} />
      )}
    </section>
  );
}

export function ReviewView(props: {
  readonly data: ReviewData;
  readonly layout: ReviewLayout;
}): ReactNode {
  const { load } = props.data;
  if (load.status !== "ready") {
    return (
      <section
        aria-label={t("desktop.craft.review.title")}
        className="flex min-h-0 flex-1 flex-col"
      >
        <ScreenHeader title={t("desktop.craft.review.title")} />
        <LoadBand data={props.data} />
      </section>
    );
  }
  return (
    <ReadyView
      data={props.data}
      ready={{
        items: load.items,
        profiles: load.profiles,
        managedOff: load.managedOff,
        offline: load.offline,
      }}
      layout={props.layout}
    />
  );
}
