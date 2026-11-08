import { ProposalArt } from "../../illustrations/index.tsx";
import { activeLocale, t } from "@fresnel/client/i18n";
import type { ProposalAction, ProposalRowVM, ProposalScope } from "@fresnel/client/settings";
import type { ToggleRequest } from "@fresnel/client/workbench";
import { assertNever } from "@fresnel/contracts";
import type { WireResult } from "@fresnel/contracts/wire";
import {
  Alert,
  Badge,
  Button,
  CodeDiff,
  CodeDiffLine,
  Dialog,
  DialogAction,
  DialogClose,
  EmptyState,
  Field,
  ListDescription,
  ListDescriptionRow,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  Skeleton,
  Textarea,
} from "@caustic/react";
import { TriangleAlert } from "@caustic/react/icons";
import { useId, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import { relativeAgeOf } from "../shared/relative-age.ts";
import {
  DIFF_FOLD_LINES,
  diffLinesOf,
  effectiveScopeOf,
  rowTitleOf,
  selectedRowOf,
  unavailableShownOf,
  visibleRowsOf,
  type KindFilter,
  type ProposalFilter,
  type ProposalsState,
  type SkillPeek,
  type SkillRequest,
  type SourceFilter,
  type StatusFilter,
} from "./proposals-model.ts";
import {
  actionLabelIdOf,
  expiryDateTextOf,
  kindFilterIdOf,
  scopeIdOf,
  skillFailureIdOf,
  skillScopeIdOf,
  sourceFilterIdOf,
  statusFilterIdOf,
  unavailableTextIdOf,
} from "./proposals-text.ts";

// 제안 화면(P-06)의 그림. 상태와 동작은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 무대는 머리(제목, 상태 칸, 종류·출처 칸), 가운데 두 열(목록 listbox, 상세), 결정 줄로 나뉜다(mockups/p06-proposals와 같다).
// 두 열은 투명 면 위에서 간격으로만 나누고, 스크롤은 열마다 `ScrollArea` 하나씩이다.
// 바로 가기 키의 뜻은 `proposalKeyIntentOf`가, 실제 동작은 `proposals-screen.tsx`가 맡는다.

/** 화면 동작. 속성 형태라 핸들러를 `onClick`에 그대로 넘긴다 */
export interface ProposalsHandlers {
  readonly filterChange: (filter: ProposalFilter) => void;
  readonly select: (key: string) => void;
  readonly act: (action: ProposalAction) => void;
  readonly scopeChange: (scope: ProposalScope) => void;
  readonly editorChange: (text: string) => void;
  readonly editorSubmit: () => void;
  readonly editorCancel: () => void;
  readonly confirmAccept: () => void;
  readonly confirmCancel: () => void;
  readonly loadMore: () => void;
  readonly retry: () => void;
  readonly openThread: (threadId: string) => void;
  /** 충돌 스킬 대화 상자를 연다(다시 읽기도 같다). 읽기는 화면이 부른다 */
  readonly skillOpen: (request: SkillRequest) => void;
  readonly skillClose: () => void;
  readonly dismissNotice: () => void;
  /** 꺼진 학습 그룹을 켠다(확장 스위치와 같은 쓰기) */
  readonly learningTurnOn: (request: ToggleRequest) => void;
  readonly onKey: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export interface ProposalsViewProps {
  readonly state: ProposalsState;
  readonly live: boolean;
  /** 근거 대화가 지금 대화 목록에 있는가 */
  readonly openable: (threadId: string) => boolean;
  readonly handlers: ProposalsHandlers;
}

const STATUS_ITEMS: readonly StatusFilter[] = ["pending", "applied", "all"];
const SOURCE_ITEMS: readonly SourceFilter[] = ["all", "learning", "knowledge"];
const KIND_ITEMS: readonly KindFilter[] = ["all", "skill", "memory", "feedback", "script"];

const LIST_DESC =
  "rounded-none [--cs-size-list-term:6rem] [&_[data-slot=list-description-row]]:px-0";

/** 결정 단추의 면. 거절은 자리가 왼쪽이라 글만, 수정과 되돌리기는 테두리, 승인은 채움이다 */
const ACTION_VARIANT: Readonly<Record<ProposalAction, "solid" | "outline" | "ghost">> = {
  approve: "solid",
  edit: "outline",
  reject: "ghost",
  revert: "ghost",
};

export function ProposalsView(props: ProposalsViewProps): ReactNode {
  const { state, live, handlers } = props;
  const headingId = useId();
  const rows =
    state.list.status === "ready" ? visibleRowsOf(state.list.rows, state.filter.kind) : [];
  const selected = selectedRowOf(rows, state.selectedKey);
  // 읽은 목록이 비었으면 두 열 대신 빈 상태 한 개를 가운데에 둔다(P-06 S6)
  const emptyList = state.list.status === "ready" && rows.length === 0;
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 flex-1 flex-col px-1.5 outline-none"
      onKeyDown={handlers.onKey}
    >
      <header className="flex min-h-10 flex-none flex-wrap items-center gap-x-2 gap-y-1 py-1">
        <h1 id={headingId} className="m-0 me-1 font-ui text-ui-strong text-text-primary">
          {t("desktop.proposals.title")}
        </h1>
        <SegmentedControl
          size="xs"
          aria-label={t("desktop.proposals.filter.status.label")}
          value={state.filter.status}
          onValueChange={(value) => {
            const next = STATUS_ITEMS.find((item) => item === value);
            if (next !== undefined) handlers.filterChange({ ...state.filter, status: next });
          }}
        >
          {STATUS_ITEMS.map((item) => (
            <SegmentedControlItem key={item} value={item}>
              {t(statusFilterIdOf(item))}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <span aria-hidden className="flex-1" />
        <Select
          size="xs"
          aria-label={t("desktop.proposals.filter.kind.label")}
          value={state.filter.kind}
          onValueChange={(value) => {
            const next = KIND_ITEMS.find((item) => item === value);
            if (next !== undefined) handlers.filterChange({ ...state.filter, kind: next });
          }}
          className="w-32"
        >
          {KIND_ITEMS.map((item) => (
            <SelectOption key={item} value={item}>
              {t(kindFilterIdOf(item))}
            </SelectOption>
          ))}
        </Select>
        <Select
          size="xs"
          aria-label={t("desktop.proposals.filter.source.label")}
          value={state.filter.source}
          onValueChange={(value) => {
            const next = SOURCE_ITEMS.find((item) => item === value);
            if (next !== undefined) handlers.filterChange({ ...state.filter, source: next });
          }}
          className="w-36"
        >
          {SOURCE_ITEMS.map((item) => (
            <SelectOption key={item} value={item}>
              {t(sourceFilterIdOf(item))}
            </SelectOption>
          ))}
        </Select>
      </header>
      {state.notice === null ? null : (
        <Alert
          tone={state.notice.tone}
          dismissible
          dismissLabel={t("desktop.proposals.dismiss")}
          onDismiss={handlers.dismissNotice}
        >
          {state.notice.text}
        </Alert>
      )}
      {state.learning.status === "off" ? (
        <LearningOffNotice
          turnOn={state.learning.turnOn}
          live={live}
          onTurnOn={handlers.learningTurnOn}
        />
      ) : null}
      {state.list.status === "ready"
        ? unavailableShownOf(state.list.unavailable, state.learning).map((source) => (
            <Alert key={source} tone="warning">
              {t(unavailableTextIdOf(source))}
            </Alert>
          ))
        : null}
      {emptyList ? (
        <div className="grid min-h-0 flex-1 place-items-center">
          <EmptyState
            media={<ProposalArt />}
            surface="none"
            title={t(
              state.filter.status === "pending" && state.filter.kind === "all"
                ? "client.settings.proposals.empty"
                : "desktop.proposals.filteredEmpty",
            )}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 compact:flex-row">
          <ListPane
            state={state}
            rows={rows}
            selectedKey={selected?.key ?? null}
            live={live}
            handlers={handlers}
          />
          <DetailPane
            state={state}
            selected={selected}
            live={live}
            openable={props.openable}
            handlers={handlers}
          />
        </div>
      )}
      <ConfirmDialog
        state={state}
        rows={state.list.status === "ready" ? state.list.rows : []}
        handlers={handlers}
      />
      <SkillDialog
        peek={state.skill}
        proposed={selected?.proposedText ?? null}
        live={live}
        handlers={handlers}
      />
    </section>
  );
}

/**
 * 학습 그룹이 꺼져 있다는 안내. 오류가 아니라 정보 줄이다. 켤 수 있으면 "켜기"를 둔다(잠겼거나 실리지 않은 그룹은 단추가 없다).
 * 꺼져 있어도 과거 기록은 목록에 그대로 있다
 */
function LearningOffNotice(props: {
  readonly turnOn: ToggleRequest | null;
  readonly live: boolean;
  readonly onTurnOn: (request: ToggleRequest) => void;
}): ReactNode {
  const { turnOn, live, onTurnOn } = props;
  return (
    <Alert
      tone="info"
      action={
        turnOn === null ? undefined : (
          <Button
            size="xs"
            variant="outline"
            disabled={!live}
            onClick={() => {
              onTurnOn(turnOn);
            }}
          >
            {t("desktop.proposals.learning.on")}
          </Button>
        )
      }
    >
      {t("desktop.proposals.learning.off")}
    </Alert>
  );
}

function ListPane(props: {
  readonly state: ProposalsState;
  readonly rows: readonly ProposalRowVM[];
  readonly selectedKey: string | null;
  readonly live: boolean;
  readonly handlers: ProposalsHandlers;
}): ReactNode {
  const { state, rows, selectedKey, live, handlers } = props;
  const label = t("desktop.proposals.list.label");
  return (
    <div className="flex min-h-0 flex-1 flex-col compact:w-80 compact:flex-none">
      <ScrollArea label={label} className="min-h-0 flex-1">
        {state.list.status === "loading" ? (
          <div role="status" aria-busy="true" className="grid gap-4 px-2.5 py-2">
            <span className="sr-only">{t("desktop.proposals.loading")}</span>
            {[0, 1, 2, 3, 4].map((line) => (
              <div key={line} className="grid gap-1.5">
                <Skeleton width="70%" height={14} />
                <Skeleton width="40%" height={10} />
              </div>
            ))}
          </div>
        ) : state.list.status === "failed" ? (
          <Alert
            tone="danger"
            action={
              <Button size="xs" variant="outline" onClick={handlers.retry}>
                {t("desktop.proposals.retry")}
              </Button>
            }
          >
            {t("desktop.proposals.load.failed")}
          </Alert>
        ) : (
          <div className="grid gap-1 pb-2">
            <ul role="listbox" aria-label={label} className="m-0 grid list-none gap-0.5 p-0">
              {rows.map((row) => {
                const age = relativeAgeOf(row.createdAt, state.readAt);
                return (
                  <Row
                    key={row.key}
                    row={row}
                    age={t(age.id, age.args)}
                    selected={row.key === selectedKey}
                    onSelect={() => {
                      handlers.select(row.key);
                    }}
                  />
                );
              })}
            </ul>
            {state.list.nextCursor === null ? null : (
              <Button
                size="xs"
                variant="ghost"
                className="ms-1 justify-self-start"
                loading={state.list.loadingMore}
                disabled={!live || state.list.loadingMore}
                onClick={handlers.loadMore}
              >
                {t("desktop.proposals.more")}
              </Button>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

/**
 * 목록의 한 행. 첫 줄은 제목(제안 내용의 요약, `rowTitleOf`), 둘째 줄은 종류·상태 말·만료 날짜다. 대기 중인 것은 겹치는 스킬이 있을 때만 "충돌"을 달고,
 * 기한(`expiresAt`)이 있으면 날짜를 단다. 대상 이름은 상세 머리에만 둔다
 */
function Row(props: {
  readonly row: ProposalRowVM;
  readonly age: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): ReactNode {
  const { row, age, selected, onSelect } = props;
  const pending = row.status === "pending";
  const conflicted = row.conflictsWith !== null;
  const line = [
    row.kindLabel,
    pending ? (conflicted ? t("desktop.proposals.conflict") : null) : row.statusLabel,
    row.expiresAt === null
      ? null
      : t("desktop.proposals.row.expires", {
          date: expiryDateTextOf(row.expiresAt, activeLocale()),
        }),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  return (
    <li role="option" aria-selected={selected}>
      <Button
        variant="ghost"
        onClick={onSelect}
        className={[
          "h-auto w-full min-w-0 items-start justify-start gap-2.5 rounded-lg px-2.5 py-2 text-left font-normal whitespace-normal",
          selected ? "bg-control-raised shadow-[inset_0_0_0_1px_var(--cs-color-control-edge)]" : "",
        ].join(" ")}
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="min-w-0 truncate text-ui text-text-primary">{rowTitleOf(row)}</span>
          <span
            className={`min-w-0 truncate text-ui-xs ${pending && conflicted ? "text-warning-text" : "text-text-tertiary"}`}
          >
            {line}
          </span>
        </span>
        <span className="shrink-0 whitespace-nowrap text-ui-xs tabular-nums text-text-tertiary">
          {age}
        </span>
      </Button>
    </li>
  );
}

function DetailPane(props: {
  readonly state: ProposalsState;
  readonly selected: ProposalRowVM | null;
  readonly live: boolean;
  readonly openable: (threadId: string) => boolean;
  readonly handlers: ProposalsHandlers;
}): ReactNode {
  const { state, selected, live, openable, handlers } = props;
  const headingId = useId();
  if (state.list.status === "loading") {
    return (
      <div className="grid min-w-0 flex-1 content-start gap-2 pt-1">
        <Skeleton width="45%" height={18} />
        <Skeleton height={80} />
        <Skeleton height={160} radius="xl" />
      </div>
    );
  }
  if (selected === null) return null;
  const scope = effectiveScopeOf(selected, state.scope);
  const actionsEnabled = live && !state.busy;
  const threadId = selected.evidenceThreadIds.find((id) => openable(id));
  const conflict = selected.conflictsWith;
  const label = `${selected.kindLabel}: ${selected.target}`;
  const editing = state.editor.mode !== "none" && state.editor.key === selected.key;
  return (
    <section aria-labelledby={headingId} className="flex min-h-0 min-w-0 flex-1 flex-col pe-1.5">
      <div className="flex min-h-8 flex-none items-center gap-2">
        <h2
          id={headingId}
          className="m-0 flex min-w-0 items-baseline gap-2 text-ui-strong font-semibold text-text-primary"
        >
          {selected.kindLabel}
          <span className="truncate font-mono text-mono-md font-medium">{selected.target}</span>
        </h2>
        {selected.status === "pending" ? null : <Badge size="xs">{selected.statusLabel}</Badge>}
      </div>
      <ScrollArea label={label} className="min-h-0 flex-1">
        <div className="grid gap-3 pt-1 pb-2">
          {live ? null : <Alert tone="warning">{t("desktop.proposals.offline")}</Alert>}
          {selected.afterUntrusted ? (
            <Alert tone="warning">{t("desktop.proposals.detail.untrusted")}</Alert>
          ) : null}
          {conflict === null ? null : (
            <Alert
              tone="warning"
              action={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!live}
                  onClick={() => {
                    handlers.skillOpen({ name: conflict, threadId: threadId ?? null });
                  }}
                >
                  {t("desktop.proposals.skill.open")}
                </Button>
              }
            >
              {t("desktop.proposals.detail.conflict", { target: conflict })}
            </Alert>
          )}
          <ListDescription variant="ghost" size="xs" className={LIST_DESC}>
            <ListDescriptionRow term={t("desktop.proposals.detail.source")}>
              {selected.sourceLabel}
            </ListDescriptionRow>
            {selected.rationale === null ? null : (
              <ListDescriptionRow term={t("desktop.proposals.detail.rationale")}>
                <span className="whitespace-pre-wrap">{selected.rationale}</span>
              </ListDescriptionRow>
            )}
            {selected.note === null || selected.note === "" ? null : (
              <ListDescriptionRow term={t("desktop.proposals.detail.note")}>
                <span className="whitespace-pre-wrap">{selected.note}</span>
              </ListDescriptionRow>
            )}
            {threadId === undefined ? null : (
              <ListDescriptionRow term={t("desktop.proposals.detail.evidence")}>
                <span className="flex items-center gap-2">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={!actionsEnabled}
                    onClick={() => {
                      handlers.openThread(threadId);
                    }}
                  >
                    {t("desktop.proposals.detail.openThread")}
                  </Button>
                </span>
              </ListDescriptionRow>
            )}
            {selected.scopeChoice === null || !selected.actions.includes("approve") ? null : (
              <ListDescriptionRow term={t("desktop.proposals.detail.scope")}>
                <RadioGroup
                  size="sm"
                  orientation="horizontal"
                  aria-label={t("desktop.proposals.detail.scope")}
                  value={scope ?? ""}
                  disabled={!actionsEnabled}
                  onValueChange={(value) => {
                    const next = selected.scopeChoice?.allowed.find((item) => item === value);
                    if (next !== undefined) handlers.scopeChange(next);
                  }}
                >
                  {selected.scopeChoice.allowed.map((item) => (
                    <RadioGroupItem key={item} value={item}>
                      {t(scopeIdOf(item))}
                    </RadioGroupItem>
                  ))}
                </RadioGroup>
              </ListDescriptionRow>
            )}
          </ListDescription>
          {selected.expiresAt === null ? null : (
            <div className="flex items-center gap-1 text-ui-xs text-text-tertiary">
              <span>
                {t("desktop.proposals.detail.expires", {
                  date: expiryDateTextOf(selected.expiresAt, activeLocale()),
                })}
              </span>
              <InfoTip text={t("desktop.proposals.detail.expiresInfo")} />
            </div>
          )}
          {state.editor.mode === "edit" && editing ? (
            <Textarea
              size="sm"
              rows={12}
              aria-label={t("desktop.proposals.edit.label")}
              className="font-mono text-mono-sm"
              maxLength={200_000}
              value={state.editor.text}
              disabled={state.busy}
              onChange={(event) => {
                handlers.editorChange(event.target.value);
              }}
            />
          ) : (
            <DiffView key={selected.key} diff={selected.diff} label={label} />
          )}
          {state.editor.mode === "reject" && editing ? (
            <Field label={t("desktop.proposals.reject.noteLabel")}>
              <Textarea
                size="sm"
                rows={2}
                autoFocus
                placeholder={t("desktop.proposals.reject.notePlaceholder")}
                maxLength={500}
                value={state.editor.text}
                disabled={state.busy}
                onChange={(event) => {
                  handlers.editorChange(event.target.value);
                }}
              />
            </Field>
          ) : null}
        </div>
      </ScrollArea>
      <DecisionRow state={state} selected={selected} live={live} handlers={handlers} />
    </section>
  );
}

/** 결정 줄. 거절은 시작 쪽, 수정·승인·되돌리기는 끝 쪽이고, 고치는 중에는 저장과 취소만 보인다 */
function DecisionRow(props: {
  readonly state: ProposalsState;
  readonly selected: ProposalRowVM;
  readonly live: boolean;
  readonly handlers: ProposalsHandlers;
}): ReactNode {
  const { state, selected, live, handlers } = props;
  const busy = state.busy;
  const editor = state.editor;
  if (editor.mode !== "none" && editor.key === selected.key) {
    return (
      <div className="flex min-h-11 flex-none flex-wrap items-center gap-1.5 py-1">
        <span aria-hidden className="flex-1" />
        <Button size="sm" variant="ghost" disabled={busy} onClick={handlers.editorCancel}>
          {t("desktop.proposals.action.cancel")}
        </Button>
        <Button
          size="sm"
          variant="solid"
          loading={busy}
          disabled={!live || busy}
          onClick={handlers.editorSubmit}
        >
          {t(
            editor.mode === "edit"
              ? "desktop.proposals.action.save"
              : "desktop.proposals.action.reject",
          )}
        </Button>
      </div>
    );
  }
  const enabled = live && !busy;
  const leading = selected.actions.filter((action) => action === "reject");
  const trailing = selected.actions.filter((action) => action !== "reject");
  return (
    <div className="flex min-h-11 flex-none flex-wrap items-center gap-1.5 py-1">
      {leading.map((action) => (
        <ActionButton
          key={action}
          action={action}
          enabled={enabled}
          onClick={() => {
            handlers.act(action);
          }}
        />
      ))}
      <span aria-hidden className="flex-1" />
      {trailing.map((action) => (
        <ActionButton
          key={action}
          action={action}
          enabled={enabled}
          onClick={() => {
            handlers.act(action);
          }}
        />
      ))}
    </div>
  );
}

function ActionButton(props: {
  readonly action: ProposalAction;
  readonly enabled: boolean;
  readonly onClick: () => void;
}): ReactNode {
  return (
    <Button
      size="sm"
      variant={ACTION_VARIANT[props.action]}
      disabled={!props.enabled}
      onClick={props.onClick}
    >
      {t(actionLabelIdOf(props.action))}
    </Button>
  );
}

/**
 * 변경 줄의 감싸기. caustic 줄은 한 줄 높이(`h-5`)와 `whitespace-pre`라 긴 글이 잘린다. 높이를 글에 맞추고 글을 감싸며,
 * 내용 칸은 `min-w-0`으로 줄어들게 해 가운데 칸이 글 길이만큼 늘어나지 않게 한다. 번호와 부호 칸은 그대로라 줄 맞춤은 첫 줄에 남는다
 */
const DIFF_WRAP =
  "h-auto min-h-5 whitespace-pre-wrap break-words [&>[data-slot=code-diff-content]]:min-w-0";

/** 변경 보기. 줄 수가 많으면 `DIFF_FOLD_LINES`줄까지만 보이고 나머지는 펼친다 */
function DiffView(props: { readonly diff: string; readonly label: string }): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const lines = diffLinesOf(props.diff);
  const folded = !expanded && lines.length > DIFF_FOLD_LINES;
  const shown = folded ? lines.slice(0, DIFF_FOLD_LINES) : lines;
  return (
    <div className="grid gap-2">
      <CodeDiff
        aria-label={props.label}
        filename={props.label}
        actions={false}
        size="sm"
        radius="xl"
      >
        {shown.map((line) => (
          <CodeDiffLine
            key={line.number}
            kind={line.kind}
            number={line.number}
            className={DIFF_WRAP}
          >
            {line.text}
          </CodeDiffLine>
        ))}
      </CodeDiff>
      {folded ? (
        <Button
          size="xs"
          variant="ghost"
          className="justify-self-start"
          onClick={() => {
            setExpanded(true);
          }}
        >
          {t("desktop.proposals.detail.foldMore", { count: lines.length - DIFF_FOLD_LINES })}
        </Button>
      ) : null}
    </div>
  );
}

function ConfirmDialog(props: {
  readonly state: ProposalsState;
  readonly rows: readonly ProposalRowVM[];
  readonly handlers: ProposalsHandlers;
}): ReactNode {
  const { state, rows, handlers } = props;
  const confirm = state.confirm;
  const row =
    confirm === null ? undefined : rows.find((candidate) => candidate.key === confirm.key);
  const open = confirm !== null && row !== undefined;
  const revert = confirm?.action === "revert";
  return (
    <Dialog
      kind="alert"
      open={open}
      onOpenChange={(next) => {
        if (!next) handlers.confirmCancel();
      }}
      icon={<TriangleAlert />}
      title={t(
        revert ? "desktop.proposals.confirm.revertTitle" : "desktop.proposals.confirm.approveTitle",
      )}
      description={t(
        revert ? "desktop.proposals.confirm.revertBody" : "desktop.proposals.confirm.approveBody",
        {
          target: row?.target ?? "",
        },
      )}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t("desktop.proposals.confirm.keep")}
            </Button>
          </DialogClose>
          <DialogAction
            onClick={() => {
              handlers.confirmAccept();
            }}
          >
            {t(revert ? "desktop.proposals.confirm.revert" : "desktop.proposals.confirm.approve")}
          </DialogAction>
        </>
      }
    />
  );
}

/** 충돌 스킬 대화 상자(W-14). 왼쪽은 제안 내용, 오른쪽은 지금 스킬의 본문이다. 열린 뒤에 한 번 읽는다 */
function SkillDialog(props: {
  readonly peek: SkillPeek;
  readonly proposed: string | null;
  readonly live: boolean;
  readonly handlers: ProposalsHandlers;
}): ReactNode {
  const { peek, proposed, live, handlers } = props;
  return (
    <Dialog
      size="lg"
      open={peek.status !== "closed"}
      onOpenChange={(next) => {
        if (!next) handlers.skillClose();
      }}
      title={t("desktop.proposals.skill.title")}
      description={
        peek.status === "closed"
          ? undefined
          : t("desktop.proposals.skill.name", { name: peek.name })
      }
      footer={
        <DialogClose asChild>
          <Button variant="outline" size="sm">
            {t("desktop.proposals.dismiss")}
          </Button>
        </DialogClose>
      }
    >
      <SkillCompare peek={peek} proposed={proposed} live={live} handlers={handlers} />
    </Dialog>
  );
}

/** 두 열(제안 내용, 지금 스킬). 대화 상자 안에서만 쓰지만 서버 렌더 시험이 이 부품을 직접 그린다 */
export function SkillCompare(props: {
  readonly peek: SkillPeek;
  readonly proposed: string | null;
  readonly live: boolean;
  readonly handlers: ProposalsHandlers;
}): ReactNode {
  const { peek, proposed, live, handlers } = props;
  if (peek.status === "closed") return null;
  return (
    <div className="grid gap-3 compact:grid-cols-2">
      <section className="flex min-w-0 flex-col gap-2">
        <h3 className="text-ui-sm font-semibold text-text-primary">
          {t("desktop.proposals.skill.proposed")}
        </h3>
        <ProposedText proposed={proposed} />
      </section>
      <section className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center gap-1">
          <h3 className="text-ui-sm font-semibold text-text-primary">
            {t("desktop.proposals.skill.current")}
          </h3>
          <InfoTip text={t("desktop.proposals.skill.info")} />
        </div>
        <CurrentSkill peek={peek} live={live} handlers={handlers} />
      </section>
    </div>
  );
}

/** 제안 쪽 글. 새 본문이 없으면(바뀌는 부분만 있는 연산, 빈 diff) 그렇다고 말한다 */
function ProposedText(props: { readonly proposed: string | null }): ReactNode {
  const { proposed } = props;
  if (proposed === null || proposed === "") {
    return <EmptyState size="sm" title={t("desktop.proposals.skill.noProposed")} />;
  }
  return <TextBlock text={proposed} kind="add" label={t("desktop.proposals.skill.proposed")} />;
}

/** 지금 스킬 쪽. 읽는 중, 찾지 못함, 기능 꺼짐, 오프라인, 읽기 실패, 본문을 그린다 */
function CurrentSkill(props: {
  readonly peek: Exclude<SkillPeek, { readonly status: "closed" }>;
  readonly live: boolean;
  readonly handlers: ProposalsHandlers;
}): ReactNode {
  const { peek, live, handlers } = props;
  switch (peek.status) {
    case "loading":
      return (
        <div role="status" aria-busy="true" className="grid content-start gap-2">
          <span className="sr-only">{t("desktop.proposals.skill.loading")}</span>
          {[0, 1, 2, 3].map((line) => (
            <Skeleton key={line} height={28} />
          ))}
        </div>
      );
    case "ready":
      return <SkillBody skill={peek.skill} />;
    case "notFound":
      return <Alert tone="warning">{t(skillFailureIdOf(peek.status))}</Alert>;
    case "unsupported":
      return <Alert tone="info">{t(skillFailureIdOf(peek.status))}</Alert>;
    case "offline":
    case "failed":
      return (
        <Alert
          tone={peek.status === "offline" ? "warning" : "danger"}
          action={
            <Button
              size="xs"
              variant="outline"
              disabled={!live}
              onClick={() => {
                handlers.skillOpen({ name: peek.name, threadId: peek.threadId });
              }}
            >
              {t("desktop.proposals.retry")}
            </Button>
          }
        >
          {t(skillFailureIdOf(peek.status))}
        </Alert>
      );
    default:
      return assertNever(peek, "SkillPeek");
  }
}

/** 읽은 스킬: 범위와 설명을 머리에, 본문을 아래에 둔다. 본문이 상한을 넘었으면 경고를 보인다 */
function SkillBody(props: { readonly skill: WireResult<"knowledge.skills.view"> }): ReactNode {
  const { skill } = props;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col gap-1">
        <div>
          <Badge>{t(skillScopeIdOf(skill.scope))}</Badge>
        </div>
        {skill.description === "" ? null : (
          <p className="whitespace-pre-wrap text-body text-text-secondary">{skill.description}</p>
        )}
      </div>
      {skill.bodyTruncated ? (
        <Alert tone="warning" layout="inline" icon={<TriangleAlert />}>
          {t("desktop.proposals.skill.truncated")}
        </Alert>
      ) : null}
      {skill.body === "" ? (
        <EmptyState size="sm" title={t("desktop.proposals.skill.empty")} />
      ) : (
        <TextBlock text={skill.body} kind="context" label={t("desktop.proposals.skill.current")} />
      )}
    </div>
  );
}

/** 글을 줄 번호가 붙은 코드 칸으로 보인다. 제안 쪽은 추가 줄, 지금 스킬 쪽은 문맥 줄이다 */
function TextBlock(props: {
  readonly text: string;
  readonly kind: "add" | "context";
  readonly label: string;
}): ReactNode {
  const numbered = props.text.split("\n").map((text, index) => ({ number: index + 1, text }));
  return (
    <CodeDiff aria-label={props.label} filename={props.label} actions={false}>
      {numbered.map((line) => (
        <CodeDiffLine key={line.number} kind={props.kind} number={line.number}>
          {line.text}
        </CodeDiffLine>
      ))}
    </CodeDiff>
  );
}
