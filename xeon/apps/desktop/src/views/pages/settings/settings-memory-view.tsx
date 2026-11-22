import {
  Alert,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  IconButton,
  Input,
  SegmentedControl,
  SegmentedControlItem,
  Textarea,
} from "@caustic/react";
import { Pencil, Plus, Search, Trash2 } from "@caustic/react/icons";
import { activeLocale, t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { MemoryEntry, MemoryStore, MemoryStoreView } from "@fresnel/contracts/capabilities";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import { FIELD_WIDTH, FORM_CONTROL_SIZE, RowNote, SettingSection } from "./settings-section.tsx";
import { UsageMeter } from "../shared/usage-meter.tsx";
import { useCommands } from "../../commands.ts";
import type { CommandError } from "../../commands.ts";
import {
  filterEntries,
  findEntriesOf,
  labelOnlyOf,
  matchesQuery,
  MEMORY_SORTS,
  previewOf,
  sortEntries,
  tokensOf,
  type MemorySort,
} from "./settings-memory-model.ts";

// 설정 "대화와 컨텍스트" 탭의 기억 구역(W-19, 시나리오 scE S7). 엔진의 기억은 항목 목록이라(`USER.md`, `MEMORY.md`의 `§` 구분)
// 항목마다 한 행이다. 사용자 기억과 환경 기억 두 구역이고, 환경 기억은 작업 폴더별이 아니라 모두가 함께 쓴다.
// 바깥(CLI, 모델)에서 바뀐 것은 이 구역을 열 때와 창이 다시 앞에 올 때 읽고, 쓰기가 `baseHash` 거절을 받으면 다시 읽는다.
// 저장과 지우기의 오류는 열린 대화 상자 안에 보이고, 대화 상자가 없을 때만 구역 머리 위에 보인다.
// 구역 머리에는 문맥 토큰 줄이 있고, 항목이 여섯 넘으면 찾기 칸과 정렬 선택이 두 묶음 위에 한 번 보인다(`settings-memory-model.ts`가 거른다).
// 설정 찾기가 이 구역을 고르면 `MemoryFindView`가 맞는 글만 "기억" 묶음으로 그린다.
// 그림은 `MemoryPanelView`와 `MemoryFindView`, 명령과 읽기는 `useMemoryPanel`이 잇는다.

type MemoryLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly unsupported: boolean }
  | { readonly kind: "ready"; readonly stores: readonly MemoryStoreView[] };

type MemoryEditor =
  | { readonly kind: "closed" }
  | {
      readonly kind: "open";
      readonly store: MemoryStore;
      /** 고칠 항목. 새로 넣는 창이면 null */
      readonly entryId: string | null;
      readonly text: string;
    };

interface MemoryRemoving {
  readonly store: MemoryStore;
  readonly entryId: string;
  readonly text: string;
}

export interface MemoryPanelViewProps {
  readonly load: MemoryLoad;
  readonly notice: MessageId | null;
  readonly editor: MemoryEditor;
  readonly removing: MemoryRemoving | null;
  readonly busy: boolean;
  /** 구역 안 찾기 글. 설정 찾기와 따로 둔다. 빈 글이면 모두 보인다 */
  readonly search: string;
  readonly sort: MemorySort;
  readonly onSearch: (text: string) => void;
  readonly onSort: (sort: MemorySort) => void;
  readonly onOpenAdd: (store: MemoryStore) => void;
  readonly onOpenEdit: (store: MemoryStore, entryId: string, text: string) => void;
  readonly onText: (text: string) => void;
  readonly onSave: () => void;
  readonly onCloseEditor: () => void;
  readonly onAskRemove: (store: MemoryStore, entryId: string, text: string) => void;
  readonly onConfirmRemove: () => void;
  readonly onCloseRemove: () => void;
}

const STORES: readonly {
  readonly store: MemoryStore;
  readonly title: MessageId;
  readonly info: MessageId;
}[] = [
  { store: "user", title: "desktop.memory.user.title", info: "desktop.memory.user.info" },
  { store: "env", title: "desktop.memory.env.title", info: "desktop.memory.env.info" },
];

/** 저장소마다 설정 화면이 보이는 한도 이름. 줄 안의 한도 이름이 설정 화면과 같은 글이 되도록 설정의 번역 키를 쓴다 */
const LIMIT_LABEL: Record<MemoryStore, MessageId> = {
  user: "settings.l2.knowledge.memory.userLimitChars.label",
  env: "settings.l2.knowledge.memory.envLimitChars.label",
};

/**
 * 저장소 한도에서 이 글이 들어가면 남을 글자 수. 고치는 글이면 그 항목이 쓰던 글자 수를 되돌린다.
 * 셈은 엔진과 같은 코드 포인트이고, 앞뒤 공백은 저장할 때 지워지므로 뺀다. 줄마다 붙는 구분 글자는 셈에 없어서 어림이다.
 */
export function remainingOf(args: {
  readonly limitChars: number;
  readonly usedChars: number;
  /** 고치는 항목의 옛 글자 수. 새로 넣는 창이면 0 */
  readonly oldChars: number;
  readonly text: string;
}): number {
  return args.limitChars - args.usedChars + args.oldChars - Array.from(args.text.trim()).length;
}

/** 기억 구역의 그림(DP-88): 스위치 카드에 이어지는 두 열 카드. 구역 안 찾기, 정렬, 문맥 줄을 보인다 */
export function MemoryPanelView(props: MemoryPanelViewProps): ReactNode {
  return <MemoryCard props={props} finding={null} />;
}

/**
 * 설정 찾기가 고른 기억 구역. 구역 안 찾기 칸과 문맥 줄은 없고, 설정 찾기 글이 든 글만 보인다.
 * 구역 이름만 맞으면 모든 글이 보인다(`labelOnlyOf`).
 */
export function MemoryFindView(args: {
  readonly props: MemoryPanelViewProps;
  readonly query: string;
}): ReactNode {
  return <MemoryCard props={args.props} finding={args.query} />;
}

/** 한 열에 처음 보이는 글 수. 넘으면 "모두 보기"로 편다(설정 찾기 결과는 모두 보인다) */
const VISIBLE_ENTRIES = 6;

/** 구역 안 찾기와 정렬이 나타나는 글 수(이보다 많을 때) */
const FIND_FROM = 5;

/**
 * 구역 하나의 그림. `finding`이 null이면 앞의 스위치 카드("기억")에 이어지는 카드이고(제목 없음), 설정 찾기 결과면 제목 "기억"을 단다.
 * 카드 안: 머리 줄(문맥 토큰 · 찾기와 정렬), 두 열(사용자 기억 | 환경 기억), 둘 다 비었을 때만 빈 상태 한 줄.
 */
function MemoryCard(args: {
  readonly props: MemoryPanelViewProps;
  readonly finding: string | null;
}): ReactNode {
  const { props, finding } = args;
  const { load, notice, busy, editor, removing } = props;
  // 대화 상자가 열려 있으면 오류는 그 안에 보인다. 뒤의 구역 머리에 같은 줄을 또 그리지 않는다
  const dialogOpen = editor.kind === "open" || removing !== null;
  const stores = load.kind === "ready" ? load.stores : [];
  const total = stores.reduce((sum, view) => sum + view.entries.length, 0);
  const shownTotal = stores.reduce(
    (sum, view) => sum + filterEntries(view.entries, props.search).length,
    0,
  );
  const locale = activeLocale();
  const labelOnly = finding !== null && labelOnlyOf(stores, finding, t("desktop.memory.label"));
  const rowsOf = (view: MemoryStoreView): readonly MemoryEntry[] => {
    const picked =
      finding === null
        ? filterEntries(view.entries, props.search)
        : findEntriesOf(view.entries, finding, labelOnly);
    return sortEntries(picked, props.sort, locale);
  };
  // 머리 줄(문맥 토큰, 찾기)은 기억이 하나라도 있을 때만 둔다. 다 비면 "0토큰"이 빈 말을 하나 더 하므로 열 둘과 안내 한 줄만 남긴다
  const head = load.kind === "ready" && finding === null && total > 0;
  const noticeShown = notice !== null && !dialogOpen;
  const allEmpty = total === 0 && finding === null;
  return (
    <div data-slot="settings-memory" data-memory-state={load.kind} className="min-w-0">
      <SettingSection
        {...(finding === null
          ? { continues: true, label: t("desktop.memory.label") }
          : { title: t("desktop.memory.label") })}
        body="plain"
      >
        {head ? (
          <div className="flex min-h-7 min-w-0 items-center gap-3">
            <ContextLine tokens={tokensOf(load.stores)} />
            {total > FIND_FROM ? <FindRow props={props} shown={shownTotal} total={total} /> : null}
          </div>
        ) : null}
        {noticeShown ? <RowNote>{t(notice)}</RowNote> : null}
        {load.kind === "loading" ? (
          <p role="status" className="m-0 text-ui text-text-tertiary">
            {t("desktop.memory.loading")}
          </p>
        ) : null}
        {load.kind === "failed" ? (
          <RowNote tone="danger">
            {t(load.unsupported ? "desktop.memory.unsupported" : "desktop.memory.loadFailed")}
          </RowNote>
        ) : null}
        {load.kind === "ready" ? (
          <>
            {total > 0 && shownTotal === 0 && finding === null ? (
              <p className="m-0 text-ui text-text-tertiary">{t("desktop.memory.search.noMatch")}</p>
            ) : null}
            <div
              className={`-mx-4 grid grid-cols-2 ${head || noticeShown || finding !== null ? "border-t border-border-subtle" : "-mt-4"} @max-[32rem]:grid-cols-1 [&>*+*]:border-s [&>*+*]:border-border-subtle @max-[32rem]:[&>*+*]:border-s-0 @max-[32rem]:[&>*+*]:border-t`}
            >
              {STORES.map((spec) => {
                const view = stores.find((candidate) => candidate.store === spec.store);
                return (
                  <StoreColumn
                    key={spec.store}
                    spec={spec}
                    view={view}
                    rows={view === undefined ? [] : rowsOf(view)}
                    finding={finding !== null}
                    allEmpty={allEmpty}
                    busy={busy}
                    props={props}
                  />
                );
              })}
            </div>
            {allEmpty ? (
              <p
                data-memory-empty
                className="-mx-4 -mb-4 mt-0 border-t border-border-subtle px-4 py-3 text-ui text-text-tertiary"
              >
                {t("desktop.memory.empty.hint")}
              </p>
            ) : null}
          </>
        ) : null}
      </SettingSection>
      <EditorDialog props={props} />
      <RemoveDialog props={props} />
    </div>
  );
}

/** 카드 머리의 문맥 토큰 줄. 설명은 정보 아이콘 뒤에 둔다 */
function ContextLine(args: { readonly tokens: number }): ReactNode {
  return (
    <div
      data-memory-context
      className="flex min-w-0 flex-1 items-center gap-1 text-ui text-text-tertiary"
    >
      {t("desktop.memory.context", { tokens: String(args.tokens) })}
      <InfoTip text={[t("desktop.memory.info"), t("desktop.memory.context.info")]} />
    </div>
  );
}

/** 구역 안 찾기 칸, 개수, 정렬. 두 열 위에 한 번 보인다(글이 여섯 넘을 때) */
function FindRow(args: {
  readonly props: MemoryPanelViewProps;
  readonly shown: number;
  readonly total: number;
}): ReactNode {
  const { props, shown, total } = args;
  return (
    <div className="flex flex-none items-center gap-2">
      {/* 거른 수는 찾는 중에만 뜻이 있다. 찾는 말이 없으면 "11/11개"는 빈 말이다 */}
      {props.search.trim() === "" ? null : (
        <span data-memory-count className="text-ui-sm text-text-tertiary">
          {t("desktop.memory.count", { shown: String(shown), total: String(total) })}
        </span>
      )}
      <Input
        type="search"
        size={FORM_CONTROL_SIZE}
        variant="soft"
        prefix={<Search />}
        aria-label={t("desktop.memory.search.label")}
        placeholder={t("desktop.memory.search.placeholder")}
        value={props.search}
        spellCheck={false}
        containerClassName={FIELD_WIDTH.medium}
        onValueChange={props.onSearch}
      />
      <SegmentedControl
        size={FORM_CONTROL_SIZE}
        aria-label={t("desktop.memory.sort.label")}
        value={props.sort}
        onValueChange={(value) => {
          const next = MEMORY_SORTS.find((item) => item === value);
          if (next !== undefined) props.onSort(next);
        }}
      >
        <SegmentedControlItem value="recent">
          {t("desktop.memory.sort.recent")}
        </SegmentedControlItem>
        <SegmentedControlItem value="name">{t("desktop.memory.sort.name")}</SegmentedControlItem>
      </SegmentedControl>
    </div>
  );
}

/** 기억 한 열: 머리(이름 · 정보 · 새로 넣기), 사용량 막대, 글 목록(여섯까지, 더 있으면 모두 보기) */
function StoreColumn(args: {
  readonly spec: (typeof STORES)[number];
  readonly view: MemoryStoreView | undefined;
  /** 보일 글. 찾기와 정렬을 거친 것이다 */
  readonly rows: readonly MemoryEntry[];
  /** 설정 찾기 결과인가. 맞는 글이 없는 열은 통째로 빼고, 맞는 글은 모두 보인다 */
  readonly finding: boolean;
  readonly allEmpty: boolean;
  readonly busy: boolean;
  readonly props: MemoryPanelViewProps;
}): ReactNode {
  const { spec, view, rows, finding, allEmpty, busy, props } = args;
  const [expanded, setExpanded] = useState(false);
  if (view === undefined) return null;
  if (finding && view.entries.length > 0 && rows.length === 0) return null;
  const locked = busy || view.writeBlocked;
  const shown = expanded || finding ? rows : rows.slice(0, VISIBLE_ENTRIES);
  const title = t(spec.title);
  return (
    <div data-memory-store={spec.store} className="grid min-w-0 content-start gap-3 px-4 pt-3">
      <div className="flex min-h-7 min-w-0 items-center gap-2">
        <span className="inline-flex min-w-0 flex-1 items-center gap-1">
          <span className="truncate text-ui font-medium text-text-primary">{title}</span>
          <InfoTip text={t(spec.info)} />
        </span>
        <Button
          variant="ghost"
          size={FORM_CONTROL_SIZE}
          disabled={locked}
          onClick={() => {
            props.onOpenAdd(spec.store);
          }}
        >
          <Plus aria-hidden />
          {t("desktop.memory.add")}
        </Button>
      </div>
      <span data-memory-used>
        <UsageMeter
          used={view.usedChars}
          limit={view.limitChars}
          label={t("desktop.memory.used.label", { name: title })}
          valueText={t("desktop.memory.used", {
            used: view.usedChars.toLocaleString(),
            limit: view.limitChars.toLocaleString(),
          })}
        />
      </span>
      {view.writeBlocked ? <RowNote>{t("desktop.memory.blocked")}</RowNote> : null}
      {view.entries.length === 0 ? (
        // 둘 다 비었으면 아래 안내 한 줄이 말한다(빈 상태는 한 번만)
        allEmpty ? (
          <span aria-hidden className="block pb-1" />
        ) : (
          <p className="m-0 pb-3 text-ui-sm text-text-tertiary">{t("desktop.memory.empty")}</p>
        )
      ) : (
        <ul className="-mx-2 my-0 grid min-w-0 list-none p-0 pb-2">
          {shown.map((entry) => (
            <li
              key={entry.id}
              data-memory-entry={entry.id}
              className="group/entry flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 hover:bg-neutral-hover focus-within:bg-neutral-hover"
            >
              <span
                className="min-w-0 flex-1 truncate text-ui text-text-primary"
                title={previewOf(entry.text)}
              >
                {previewOf(entry.text)}
              </span>
              <span className="flex flex-none gap-0.5 opacity-0 group-hover/entry:opacity-100 group-focus-within/entry:opacity-100">
                <IconButton
                  variant="ghost"
                  size="xs"
                  label={t("desktop.memory.edit")}
                  disabled={locked}
                  onClick={() => {
                    props.onOpenEdit(spec.store, entry.id, entry.text);
                  }}
                >
                  <Pencil />
                </IconButton>
                <IconButton
                  variant="ghost"
                  size="xs"
                  label={t("desktop.memory.remove")}
                  disabled={locked}
                  onClick={() => {
                    props.onAskRemove(spec.store, entry.id, entry.text);
                  }}
                >
                  <Trash2 />
                </IconButton>
              </span>
            </li>
          ))}
          {rows.length > VISIBLE_ENTRIES && !finding ? (
            <li className="px-2 pt-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setExpanded(!expanded);
                }}
              >
                {expanded
                  ? t("desktop.memory.showLess")
                  : t("desktop.memory.showAll", { count: String(rows.length) })}
              </Button>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

/** 대화 상자 안의 오류 줄. 다시 읽은 것은 주의(warning), 저장이 실패한 것은 위험(danger)이다 */
export function DialogNotice(args: { readonly notice: MessageId }): ReactNode {
  return (
    <Alert
      tone={args.notice === "desktop.memory.stale" ? "warning" : "danger"}
      variant="outline"
      emphasis="lead"
      size="sm"
    >
      {t(args.notice)}
    </Alert>
  );
}

function oldCharsOf(view: MemoryStoreView, entryId: string | null): number {
  if (entryId === null) return 0;
  return view.entries.find((entry) => entry.id === entryId)?.chars ?? 0;
}

/** 글 칸 아래의 남은 글자 줄. 한도를 넘으면 경고 한 문장이 줄을 대신한다. 저장은 막지 않는다(엔진이 거절할 수 있다) */
function RemainingLine(args: {
  readonly view: MemoryStoreView;
  readonly entryId: string | null;
  readonly text: string;
}): ReactNode {
  const { view, entryId, text } = args;
  const remaining = remainingOf({
    limitChars: view.limitChars,
    usedChars: view.usedChars,
    oldChars: oldCharsOf(view, entryId),
    text,
  });
  const over = remaining < 0;
  // 한도의 10%보다 적게 남으면 경고 색이다
  const low = remaining * 10 < view.limitChars;
  return (
    <div className="grid gap-1">
      {over ? (
        <Alert tone="warning" variant="outline" emphasis="lead" size="sm">
          {t("desktop.memory.overLimit", {
            over: String(-remaining),
            tab: t("client.settings.tabs.sessions"),
            limit: t(LIMIT_LABEL[view.store]),
          })}
        </Alert>
      ) : null}
      <div className="flex items-center gap-1 text-ui">
        {over ? null : (
          <span data-memory-remaining className={low ? "text-warning-text" : "text-text-tertiary"}>
            {t("desktop.memory.remaining", { n: String(remaining) })}
          </span>
        )}
        <InfoTip text={t("desktop.memory.limit.info")} />
      </div>
    </div>
  );
}

/** 고치기·새로 넣기 대화 상자의 본문. 오류 줄은 글 칸 위, 남은 글자 줄은 글 칸 아래에 둔다 */
export function MemoryEditorBody(props: {
  readonly notice: MessageId | null;
  /** 고칠 저장소의 값. 대화 상자가 닫혀 있거나 값을 아직 못 읽었으면 undefined */
  readonly view: MemoryStoreView | undefined;
  readonly entryId: string | null;
  readonly text: string;
  readonly onText: (text: string) => void;
}): ReactNode {
  const { notice, view, entryId, text, onText } = props;
  return (
    <div className="grid gap-2">
      {notice === null ? null : <DialogNotice notice={notice} />}
      <Textarea
        size="sm"
        aria-label={t("desktop.memory.text.label")}
        rows={4}
        value={text}
        onChange={(event) => {
          onText(event.currentTarget.value);
        }}
      />
      {view === undefined ? null : <RemainingLine view={view} entryId={entryId} text={text} />}
    </div>
  );
}

function EditorDialog(args: { readonly props: MemoryPanelViewProps }): ReactNode {
  const { props } = args;
  const { editor, busy, load } = props;
  const open = editor.kind === "open";
  const adding = editor.kind === "open" && editor.entryId === null;
  const text = editor.kind === "open" ? editor.text : "";
  const entryId = editor.kind === "open" ? editor.entryId : null;
  const view =
    editor.kind === "open" && load.kind === "ready"
      ? load.stores.find((candidate) => candidate.store === editor.store)
      : undefined;
  return (
    <Dialog
      kind="dialog"
      size="md"
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onCloseEditor();
      }}
      title={t(adding ? "desktop.memory.add.title" : "desktop.memory.edit.title")}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t("desktop.memory.cancel")}
            </Button>
          </DialogClose>
          <Button
            variant="solid"
            size="sm"
            disabled={busy || text.trim() === ""}
            onClick={props.onSave}
          >
            {t("desktop.memory.save")}
          </Button>
        </>
      }
    >
      <MemoryEditorBody
        notice={props.notice}
        view={view}
        entryId={entryId}
        text={text}
        onText={props.onText}
      />
    </Dialog>
  );
}

function RemoveDialog(args: { readonly props: MemoryPanelViewProps }): ReactNode {
  const { props } = args;
  const { removing, busy, notice } = props;
  return (
    <Dialog
      kind="alert"
      size="sm"
      tone="danger"
      open={removing !== null}
      onOpenChange={(next) => {
        if (!next) props.onCloseRemove();
      }}
      title={t("desktop.memory.remove.title")}
      description={t("desktop.memory.remove.body", {
        text: removing === null ? "" : previewOf(removing.text),
      })}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.memory.remove.keep")}
            </Button>
          </DialogClose>
          {busy ? null : (
            <DialogAction onClick={props.onConfirmRemove}>
              {t("desktop.memory.remove.confirm")}
            </DialogAction>
          )}
        </>
      }
    >
      {notice === null ? null : <DialogNotice notice={notice} />}
    </Dialog>
  );
}

/** 바깥에서 바뀐 파일을 알리는 거절이다(host가 `baseHash`를 가리킨다) */
function staleOf(error: CommandError): boolean {
  return error.kind === "rejected" && error.path === "baseHash";
}

/** 기억 구역의 읽기, 명령, 대화 상자, 구역 안 찾기와 정렬 상태. 설정 화면이 부르고, 그림은 `MemoryPanelView`와 `MemoryFindView`가 그린다 */
export interface MemoryPanelHook {
  readonly props: MemoryPanelViewProps;
  /** 설정 찾기 글에 이 구역이 맞는가. 값을 아직 못 읽었으면 맞지 않는다 */
  readonly matches: (query: string) => boolean;
}

/**
 * `visible`은 설정의 "대화와 컨텍스트" 탭을 고르고 있는가다. 고를 때마다 다시 읽는다.
 * 설정 찾기는 탭과 상관없이 값이 필요해서 화면이 뜰 때 읽고, 창이 다시 앞에 와도 읽는다.
 */
export function useMemoryPanel(visible: boolean): MemoryPanelHook {
  const commands = useCommands();
  const [load, setLoad] = useState<MemoryLoad>({ kind: "loading" });
  const [notice, setNotice] = useState<MessageId | null>(null);
  const [editor, setEditor] = useState<MemoryEditor>({ kind: "closed" });
  const [removing, setRemoving] = useState<MemoryRemoving | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<MemorySort>("recent");

  const latest = useRef(0);
  const reload = useCallback(async (): Promise<void> => {
    latest.current += 1;
    const seq = latest.current;
    const read = await commands.memory.read();
    if (seq !== latest.current) return;
    setLoad(
      read.ok
        ? { kind: "ready", stores: read.value.stores }
        : { kind: "failed", unsupported: read.error.kind === "unsupported" },
    );
  }, [commands]);

  useEffect(() => {
    detach(reload(), rethrow);
    // 창이 다시 앞에 오면 바깥(CLI, 모델)에서 바뀐 것을 읽는다
    const onFocus = (): void => {
      detach(reload(), rethrow);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  // 이 탭을 고를 때마다 바깥에서 바뀐 것을 읽는다. 화면이 뜬 순간의 읽기는 위 효과가 맡는다
  useEffect(() => {
    if (visible) detach(reload(), rethrow);
  }, [visible, reload]);

  const hashOf = (store: MemoryStore): string | null => {
    if (load.kind !== "ready") return null;
    return load.stores.find((candidate) => candidate.store === store)?.fileHash ?? null;
  };

  const finish = async (
    done: Promise<
      | { readonly ok: true; readonly value: unknown }
      | { readonly ok: false; readonly error: CommandError }
    >,
  ): Promise<void> => {
    setBusy(true);
    const result = await done;
    setBusy(false);
    if (result.ok) {
      setNotice(null);
      setEditor({ kind: "closed" });
      setRemoving(null);
    } else {
      setNotice(staleOf(result.error) ? "desktop.memory.stale" : "desktop.memory.saveFailed");
      if (staleOf(result.error)) {
        setEditor({ kind: "closed" });
        setRemoving(null);
      }
    }
    await reload();
  };

  const save = (): void => {
    if (editor.kind !== "open") return;
    const { store, entryId, text } = editor;
    const base = hashOf(store);
    if (entryId === null) {
      detach(finish(commands.memory.add(store, text.trim())), rethrow);
      return;
    }
    if (base === null) return;
    detach(finish(commands.memory.replace(store, entryId, text.trim(), base)), rethrow);
  };

  const confirmRemove = (): void => {
    if (removing === null) return;
    const base = hashOf(removing.store);
    if (base === null) return;
    detach(finish(commands.memory.remove(removing.store, removing.entryId, base)), rethrow);
  };

  // 설정 찾기는 값을 읽은 뒤에만 이 구역을 고른다(읽는 중에는 맞지 않는다)
  const matches = useCallback(
    (query: string): boolean =>
      matchesQuery(query, {
        label: t("desktop.memory.label"),
        stores: load.kind === "ready" ? load.stores : null,
      }),
    [load],
  );

  return {
    matches,
    props: {
      load,
      notice,
      editor,
      removing,
      busy,
      search,
      sort,
      onSearch: (text) => {
        setSearch(text);
      },
      onSort: (next) => {
        setSort(next);
      },
      onOpenAdd: (store) => {
        setNotice(null);
        setEditor({ kind: "open", store, entryId: null, text: "" });
      },
      onOpenEdit: (store, entryId, text) => {
        setNotice(null);
        setEditor({ kind: "open", store, entryId, text });
      },
      onText: (text) => {
        setEditor((current) => (current.kind === "open" ? { ...current, text } : current));
      },
      onSave: save,
      onCloseEditor: () => {
        setEditor({ kind: "closed" });
      },
      onAskRemove: (store, entryId, text) => {
        setNotice(null);
        setRemoving({ store, entryId, text });
      },
      onConfirmRemove: confirmRemove,
      onCloseRemove: () => {
        setRemoving(null);
      },
    },
  };
}
