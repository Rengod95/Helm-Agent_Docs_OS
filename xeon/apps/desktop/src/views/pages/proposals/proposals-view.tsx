import { t } from "@fresnel/client/i18n";
import type { ProposalAction, ProposalRowVM, ProposalScope } from "@fresnel/client/settings";
import { assertNever } from "@fresnel/contracts";
import type { WireResult } from "@fresnel/contracts/wire";
import {
  Alert,
  Badge,
  Button,
  Chip,
  CodeDiff,
  CodeDiffLine,
  Dialog,
  DialogAction,
  DialogClose,
  EmptyState,
  List,
  ListRow,
  RadioGroup,
  RadioGroupItem,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  Skeleton,
  Textarea,
  Tooltip,
} from "@caustic/react";
import { TriangleAlert } from "@caustic/react/icons";
import { useId, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import { relativeAgeOf } from "../shared/relative-age.ts";
import {
  DIFF_FOLD_LINES,
  diffLinesOf,
  effectiveScopeOf,
  selectedRowOf,
  visibleRowsOf,
  type Editor,
  type KindFilter,
  type ListState,
  type ProposalFilter,
  type ProposalsState,
  type SkillPeek,
  type SkillRequest,
  type SourceFilter,
  type StatusFilter,
} from "./proposals-model.ts";
import {
  actionLabelIdOf,
  kindFilterIdOf,
  scopeIdOf,
  skillFailureIdOf,
  skillScopeIdOf,
  sourceFilterIdOf,
  statusFilterIdOf,
} from "./proposals-text.ts";

// 제안 화면(P-06)의 그림. 상태와 동작은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
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

export function ProposalsView(props: ProposalsViewProps): ReactNode {
  const { state, live, handlers } = props;
  const headingId = useId();
  const rows =
    state.list.status === "ready" ? visibleRowsOf(state.list.rows, state.filter.kind) : [];
  const selected = selectedRowOf(rows, state.selectedKey);
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
      onKeyDown={handlers.onKey}
    >
      <h1 id={headingId} className="text-ui-strong text-text-primary">
        {t("desktop.proposals.title")}
      </h1>
      {live ? null : (
        <Alert tone="warning" layout="inline">
          {t("desktop.proposals.offline")}
        </Alert>
      )}
      <FilterBar filter={state.filter} onChange={handlers.filterChange} />
      {state.notice === null ? null : (
        <Alert
          tone={state.notice.tone === "danger" ? "danger" : "success"}
          dismissible
          dismissLabel={t("desktop.proposals.dismiss")}
          onDismiss={handlers.dismissNotice}
        >
          {state.notice.text}
        </Alert>
      )}
      <div className="grid min-h-0 flex-1 gap-3 compact:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
        <ListPane state={state} rows={rows} live={live} handlers={handlers} />
        <DetailPane
          state={state}
          selected={selected}
          live={live}
          openable={props.openable}
          handlers={handlers}
        />
      </div>
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

function FilterBar(props: {
  readonly filter: ProposalFilter;
  readonly onChange: (filter: ProposalFilter) => void;
}): ReactNode {
  const { filter, onChange } = props;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl
        size="sm"
        aria-label={t("desktop.proposals.filter.status.label")}
        value={filter.status}
        onValueChange={(value) => {
          const next = STATUS_ITEMS.find((item) => item === value);
          if (next !== undefined) onChange({ ...filter, status: next });
        }}
      >
        {STATUS_ITEMS.map((item) => (
          <SegmentedControlItem key={item} value={item}>
            {t(statusFilterIdOf(item))}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <Select
        size="sm"
        aria-label={t("desktop.proposals.filter.source.label")}
        value={filter.source}
        onValueChange={(value) => {
          const next = SOURCE_ITEMS.find((item) => item === value);
          if (next !== undefined) onChange({ ...filter, source: next });
        }}
      >
        {SOURCE_ITEMS.map((item) => (
          <SelectOption key={item} value={item}>
            {t(sourceFilterIdOf(item))}
          </SelectOption>
        ))}
      </Select>
      <Select
        size="sm"
        aria-label={t("desktop.proposals.filter.kind.label")}
        value={filter.kind}
        onValueChange={(value) => {
          const next = KIND_ITEMS.find((item) => item === value);
          if (next !== undefined) onChange({ ...filter, kind: next });
        }}
      >
        {KIND_ITEMS.map((item) => (
          <SelectOption key={item} value={item}>
            {t(kindFilterIdOf(item))}
          </SelectOption>
        ))}
      </Select>
    </div>
  );
}

function ListPane(props: {
  readonly state: ProposalsState;
  readonly rows: readonly ProposalRowVM[];
  readonly live: boolean;
  readonly handlers: ProposalsHandlers;
}): ReactNode {
  const { state, rows, live, handlers } = props;
  const list: ListState = state.list;
  if (list.status === "loading") {
    return (
      <div role="status" aria-busy="true" className="grid content-start gap-2">
        <span className="sr-only">{t("desktop.proposals.loading")}</span>
        {[0, 1, 2, 3, 4].map((line) => (
          <Skeleton key={line} height={44} />
        ))}
      </div>
    );
  }
  if (list.status === "failed") {
    return (
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
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {list.unavailableTexts.map((text) => (
        <Alert key={text} tone="warning">
          {text}
        </Alert>
      ))}
      {rows.length === 0 ? (
        <EmptyState
          size="sm"
          title={t(
            state.filter.status === "pending" && state.filter.kind === "all"
              ? "client.settings.proposals.empty"
              : "desktop.proposals.filteredEmpty",
          )}
        />
      ) : (
        <List aria-label={t("desktop.proposals.list.label")}>
          {rows.map((row) => {
            const age = relativeAgeOf(row.createdAt, state.readAt);
            return (
              <ListRow
                key={row.key}
                title={`${row.kindLabel}: ${row.target}`}
                description={[
                  row.sourceLabel,
                  row.statusLabel,
                  t("desktop.proposals.evidence", { count: row.evidenceCount }),
                  t(age.id, age.args),
                ].join(" · ")}
                end={
                  row.conflictsWith === null ? undefined : (
                    <Chip size="sm" tone="warning" variant="soft">
                      {t("desktop.proposals.conflict")}
                    </Chip>
                  )
                }
                aria-current={row.key === state.selectedKey ? "true" : undefined}
                onClick={() => {
                  handlers.select(row.key);
                }}
              />
            );
          })}
        </List>
      )}
      {list.nextCursor === null ? null : (
        <Button
          size="sm"
          variant="outline"
          loading={list.loadingMore}
          disabled={!live || list.loadingMore}
          onClick={handlers.loadMore}
        >
          {t("desktop.proposals.more")}
        </Button>
      )}
    </div>
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
  if (selected === null) {
    return (
      <div className="flex min-h-0 items-start justify-center p-4 text-body text-text-secondary">
        {t("desktop.proposals.detail.empty")}
      </div>
    );
  }
  const scope = effectiveScopeOf(selected, state.scope);
  const editing = state.editor.mode !== "none" && state.editor.key === selected.key;
  const actionsEnabled = live && !state.busy;
  const threadId = selected.evidenceThreadIds.find((id) => openable(id));
  const conflict = selected.conflictsWith;
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border-subtle p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="min-w-0 flex-1 text-ui-strong text-text-primary">
          {selected.kindLabel}: {selected.target}
        </h2>
        <Badge>{selected.statusLabel}</Badge>
        <Badge>{selected.sourceLabel}</Badge>
        <span className="text-caption text-text-secondary">
          {t("desktop.proposals.revision", { rev: selected.revision })}
        </span>
      </div>
      {selected.afterUntrusted ? (
        <Alert tone="warning" layout="inline" icon={<TriangleAlert />}>
          {t("desktop.proposals.detail.untrusted")}
        </Alert>
      ) : null}
      {conflict === null ? null : (
        <Alert
          tone="info"
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
      {selected.rationale === null ? null : (
        <div className="flex flex-col gap-1">
          <h3 className="text-ui-sm font-semibold text-text-primary">
            {t("desktop.proposals.detail.rationale")}
          </h3>
          <p className="whitespace-pre-wrap text-body text-text-secondary">{selected.rationale}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-caption text-text-secondary">
        <span>{t("desktop.proposals.evidence", { count: selected.evidenceCount })}</span>
        {threadId === undefined ? null : (
          <Button
            size="xs"
            variant="outline"
            disabled={!actionsEnabled}
            onClick={() => {
              handlers.openThread(threadId);
            }}
          >
            {t("desktop.proposals.detail.openThread")}
          </Button>
        )}
      </div>
      <DiffView
        key={selected.key}
        diff={selected.diff}
        label={`${selected.kindLabel}: ${selected.target}`}
      />
      {selected.scopeChoice === null || !selected.actions.includes("approve") ? null : (
        <RadioGroup
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
      )}
      {editing ? <EditorPane editor={state.editor} busy={state.busy} handlers={handlers} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        {selected.actions.map((action) => (
          <ActionButton
            key={action}
            action={action}
            enabled={actionsEnabled}
            live={live}
            onClick={() => {
              handlers.act(action);
            }}
          />
        ))}
      </div>
    </section>
  );
}

function ActionButton(props: {
  readonly action: ProposalAction;
  readonly enabled: boolean;
  readonly live: boolean;
  readonly onClick: () => void;
}): ReactNode {
  const { action, enabled, live } = props;
  const button = (
    <Button
      size="sm"
      variant={action === "approve" ? "solid" : "outline"}
      disabled={!enabled}
      onClick={props.onClick}
    >
      {t(actionLabelIdOf(action))}
    </Button>
  );
  if (live) return button;
  return (
    <Tooltip content={t("desktop.offline.hint")}>
      <span className="inline-flex">{button}</span>
    </Tooltip>
  );
}

function EditorPane(props: {
  readonly editor: Editor;
  readonly busy: boolean;
  readonly handlers: ProposalsHandlers;
}): ReactNode {
  const { editor, busy, handlers } = props;
  if (editor.mode === "none") return null;
  const edit = editor.mode === "edit";
  const label = t(edit ? "desktop.proposals.edit.label" : "desktop.proposals.reject.label");
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label={label}
        rows={edit ? 8 : 3}
        maxLength={edit ? 200_000 : 500}
        value={editor.text}
        disabled={busy}
        onChange={(event) => {
          handlers.editorChange(event.target.value);
        }}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" loading={busy} onClick={handlers.editorSubmit}>
          {t(edit ? "desktop.proposals.action.save" : "desktop.proposals.action.reject")}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={handlers.editorCancel}>
          {t("desktop.proposals.action.cancel")}
        </Button>
      </div>
    </div>
  );
}

/** 변경 보기. 줄 수가 많으면 `DIFF_FOLD_LINES`줄까지만 보이고 나머지는 펼친다 */
function DiffView(props: { readonly diff: string; readonly label: string }): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const lines = diffLinesOf(props.diff);
  const folded = !expanded && lines.length > DIFF_FOLD_LINES;
  const shown = folded ? lines.slice(0, DIFF_FOLD_LINES) : lines;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-ui-sm font-semibold text-text-primary">
        {t("desktop.proposals.detail.diff")}
      </h3>
      <CodeDiff aria-label={props.label} filename={props.label} actions={false}>
        {shown.map((line) => (
          <CodeDiffLine key={line.number} kind={line.kind} number={line.number}>
            {line.text}
          </CodeDiffLine>
        ))}
      </CodeDiff>
      {folded ? (
        <Button
          size="xs"
          variant="ghost"
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
