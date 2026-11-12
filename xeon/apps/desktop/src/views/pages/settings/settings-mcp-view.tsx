import {
  Badge,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  IconButton,
  Input,
  Menu,
  MenuItem,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  Skeleton,
  Switch,
  Textarea,
  Tooltip,
} from "@caustic/react";
import { Check, Ellipsis, Plus, RotateCw, X } from "@caustic/react/icons";
import { t, type MessageId } from "@fresnel/client/i18n";
import type { McpServerAction, McpServerRow, McpToolRow } from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import type { StatusDot } from "../../status-cell.tsx";
import { CheckSteps, overallOf, type CheckStep } from "../shared/check-steps.tsx";
import { FIELD_WIDTH, FORM_CONTROL_SIZE, RowNote, SettingSection } from "./settings-section.tsx";
import {
  blockActionOf,
  rowModelOf,
  statusChipOf,
  toolHiddenKindOf,
  withPairAdded,
  withPairChanged,
  withPairRemoved,
  type DraftIssue,
  type McpDraft,
  type McpLoad,
  type McpRowModel,
  type PairRow,
} from "./settings-mcp-model.ts";
import type { PasteIssue } from "./settings-mcp-paste.ts";
import { dotToneOf } from "./settings-mcp-test.ts";
import {
  blockedIdOf,
  chipIdOf,
  draftIssueIdOf,
  hiddenIdOf,
  locationIdOf,
  sourceRefOf,
  type MsgRef,
} from "./settings-mcp-text.ts";

// 설정 "도구와 MCP"의 "MCP 서버" 구역(W-15, DP-111 [결정: 2026-11-11 사용자]). 상태는 없고 props만 받는다(서버 렌더 시험이 직접 그린다).
// 카드 하나에 서버마다 한 줄(최소 56px): 상태 점 8 · 이름 13/600 · 종류(mono)·출처 배지 / 둘째 줄 상태 글(연결됨 · 도구 N개, 막힌 사유,
// 마지막 오류) ……… 다시 시작 · ⋯(도구 보기, 고치기, 지우기) · 켜기 스위치(끄면 "항상 끄기"). 펴면 도구 칩과 마지막 오류 출력.
// 빈 목록은 두 줄 안내와 "서버 추가"(이 화면의 강조 한 곳). 값과 쓰기는 `settings-mcp-screen.tsx`가 맡는다.

export interface McpServersViewProps {
  readonly load: McpLoad;
  readonly offline: boolean;
  readonly locale: string;
  /** 행동을 보내는 중인 서버 id */
  readonly busy: ReadonlySet<string>;
  /** 행마다 마지막 행동의 실패 글 */
  readonly rowErrors: Readonly<Record<string, MsgRef>>;
  readonly expanded: ReadonlySet<string>;
  readonly onReload: () => void;
  readonly onAdd: () => void;
  readonly onToggle: (server: string) => void;
  readonly onAction: (server: string, action: McpServerAction) => void;
  readonly onEdit: (server: string) => void;
  readonly onRemove: (server: string) => void;
}

const DOT: Readonly<Record<StatusDot, string>> = {
  success: "bg-success-graphic",
  warning: "bg-warning-graphic",
  danger: "bg-danger-graphic",
  neutral: "bg-neutral-graphic",
};

/** "MCP 서버" 구역 하나. 머리에 다시 불러오기와 서버 추가, 아래에 서버 줄 카드다 */
export function McpServersView(props: McpServersViewProps): ReactNode {
  const empty = props.load.kind === "ready" && props.load.rows.length === 0;
  return (
    <SettingSection
      title={t("desktop.settings.mcp.title")}
      end={
        <div className="flex items-center gap-2">
          <Button
            size={FORM_CONTROL_SIZE}
            variant="ghost"
            disabled={props.offline}
            onClick={props.onReload}
          >
            {t("desktop.settings.mcp.reload")}
          </Button>
          {empty ? null : (
            <Button
              size={FORM_CONTROL_SIZE}
              variant="outline"
              disabled={props.offline || props.load.kind !== "ready"}
              onClick={props.onAdd}
            >
              <Plus aria-hidden />
              {t("desktop.settings.mcp.add")}
            </Button>
          )}
        </div>
      }
    >
      <McpServersBody {...props} />
    </SettingSection>
  );
}

function McpServersBody(props: McpServersViewProps): ReactNode {
  const { load } = props;
  if (load.kind === "loading") {
    if (props.offline)
      return <p className="m-0 text-ui text-text-tertiary">{t("desktop.settings.offline")}</p>;
    return <Skeleton height={40} />;
  }
  if (load.kind === "failed") {
    return (
      <RowNote
        tone="danger"
        actions={
          <Button size={FORM_CONTROL_SIZE} variant="outline" onClick={props.onReload}>
            {t("desktop.settings.mcp.reload")}
          </Button>
        }
      >
        {t("desktop.settings.mcp.load.failed")}
      </RowNote>
    );
  }
  if (load.rows.length === 0) {
    return (
      <div data-slot="mcp-empty" className="grid justify-items-start gap-3">
        <div className="grid gap-0.5">
          <p className="m-0 text-ui font-medium text-text-primary">
            {t("desktop.settings.mcp.empty")}
          </p>
          <p className="m-0 text-ui text-text-tertiary">{t("desktop.settings.mcp.empty.hint")}</p>
        </div>
        <Button
          size={FORM_CONTROL_SIZE}
          variant="solid"
          disabled={props.offline}
          onClick={props.onAdd}
        >
          <Plus aria-hidden />
          {t("desktop.settings.mcp.add")}
        </Button>
      </div>
    );
  }
  return (
    <>
      {load.rows.map((row) => (
        <McpServerRowView
          key={row.server}
          row={row}
          locale={props.locale}
          busy={props.busy.has(row.server)}
          error={props.rowErrors[row.server] ?? null}
          expanded={props.expanded.has(row.server)}
          offline={props.offline}
          onToggle={() => {
            props.onToggle(row.server);
          }}
          onAction={(action) => {
            props.onAction(row.server, action);
          }}
          onEdit={() => {
            props.onEdit(row.server);
          }}
          onRemove={() => {
            props.onRemove(row.server);
          }}
        />
      ))}
    </>
  );
}

interface McpServerRowViewProps {
  readonly row: McpServerRow;
  readonly locale: string;
  readonly busy: boolean;
  readonly error: MsgRef | null;
  readonly expanded: boolean;
  readonly offline: boolean;
  readonly onToggle: () => void;
  readonly onAction: (action: McpServerAction) => void;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}

/** 둘째 줄 상태 글. 항상 끔 > 막힘 > 실패(마지막 오류) > 연결됨(도구 수) > 그 밖의 상태 */
function StatusLine(props: { readonly model: McpRowModel }): ReactNode {
  const { model } = props;
  if (model.alwaysBlocked) {
    return <span>{t("desktop.settings.mcp.blocked.always")}</span>;
  }
  if (model.state === "blocked" || model.blocked !== null) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        <span className="min-w-0">
          {model.blocked === null
            ? t("desktop.settings.mcp.blocked.unknown")
            : t(blockedIdOf(model.blocked))}
        </span>
        {model.approvalNote ? (
          <InfoTip text={t("desktop.settings.mcp.blocked.approval.info")} />
        ) : null}
      </span>
    );
  }
  if (model.state === "failed" && model.error !== null) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        <span className="min-w-0 truncate text-text-secondary">
          {t("desktop.settings.mcp.lastError", {
            time: model.error.time,
            message: model.error.message,
          })}
        </span>
        {model.error.original === null ? null : (
          <InfoTip
            text={t("desktop.settings.mcp.error.original", { text: model.error.original })}
          />
        )}
      </span>
    );
  }
  if (model.state === "connected") {
    return (
      <span>
        {model.toolCount > 0
          ? t("desktop.settings.mcp.connectedTools", { count: model.toolCount })
          : t("desktop.settings.mcp.connectedNoTools")}
      </span>
    );
  }
  return <span>{t(chipIdOf(statusChipOf(model)))}</span>;
}

function McpServerRowView(props: McpServerRowViewProps): ReactNode {
  const model = rowModelOf(props.row, props.locale);
  const location = locationIdOf(model.locationNote);
  const source = sourceRefOf(model.source);
  const tone = dotToneOf(model);
  const disabled = props.busy || props.offline;
  return (
    <div
      data-slot="mcp-server-row"
      data-server={model.server}
      data-tone={tone}
      className="group/mcp grid gap-2 px-4 py-2.5 transition-colors hover:bg-neutral-hover focus-within:bg-neutral-hover"
    >
      <div className="flex min-h-9 min-w-0 items-center gap-3">
        <span aria-hidden className={`size-2 flex-none rounded-full ${DOT[tone]}`} />
        <button
          type="button"
          aria-expanded={props.expanded}
          onClick={props.onToggle}
          className="grid min-w-0 flex-1 cursor-pointer gap-0.5 rounded-md border-0 bg-transparent p-0 text-start outline-none focus-visible:focus-ring"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-ui font-semibold text-text-primary">
              {model.name}
            </span>
            {model.idText === null ? null : (
              <span className="truncate font-mono text-mono-sm text-text-tertiary">
                {model.idText}
              </span>
            )}
            <Badge size="sm" variant="outline" className="font-mono">
              {props.row.transport}
            </Badge>
            <Badge size="sm" variant="outline">
              {t(source.id, source.args)}
            </Badge>
          </span>
          <span className="flex min-w-0 items-center text-ui text-text-tertiary">
            <StatusLine model={model} />
          </span>
        </button>
        {location === null ? null : <InfoTip text={t(location)} />}
        <div className="flex flex-none items-center gap-1">
          <Tooltip side="top" content={t("desktop.settings.mcp.action.restart")}>
            <IconButton
              size={FORM_CONTROL_SIZE}
              variant="ghost"
              label={t("desktop.settings.mcp.action.restart")}
              disabled={disabled || model.alwaysBlocked}
              onClick={() => {
                props.onAction("restart");
              }}
            >
              <RotateCw />
            </IconButton>
          </Tooltip>
          <Menu
            size="sm"
            align="end"
            aria-label={t("desktop.settings.mcp.menu", { name: model.name })}
            trigger={
              <IconButton
                size={FORM_CONTROL_SIZE}
                variant="ghost"
                label={t("desktop.settings.mcp.menu", { name: model.name })}
              >
                <Ellipsis />
              </IconButton>
            }
          >
            <MenuItem onSelect={props.onToggle}>
              {t(
                props.expanded
                  ? "desktop.settings.mcp.action.collapse"
                  : "desktop.settings.mcp.action.details",
              )}
            </MenuItem>
            {model.editable ? (
              <>
                <MenuItem disabled={disabled} onSelect={props.onEdit}>
                  {t("desktop.settings.mcp.action.edit")}
                </MenuItem>
                <MenuItem tone="danger" disabled={disabled} onSelect={props.onRemove}>
                  {t("desktop.settings.mcp.action.remove")}
                </MenuItem>
              </>
            ) : null}
          </Menu>
          <Switch
            size="sm"
            aria-label={t("desktop.settings.mcp.enabled", { name: model.name })}
            checked={!model.alwaysBlocked}
            disabled={disabled}
            onCheckedChange={() => {
              props.onAction(blockActionOf(model));
            }}
          />
        </div>
      </div>
      <HiddenLine model={model} />
      {props.error === null ? null : (
        <RowNote tone="danger">{t(props.error.id, props.error.args)}</RowNote>
      )}
      {props.expanded ? <McpServerDetails model={model} /> : null}
    </div>
  );
}

/** 숨은 도구 한 줄. 접힌 상태에서도 보인다 */
function HiddenLine(props: { readonly model: McpRowModel }): ReactNode {
  const { hidden } = props.model;
  if (hidden === null) return null;
  const reasons = hidden.reasons.map((kind) => t(hiddenIdOf(kind))).join(" · ");
  return <RowNote>{t("desktop.settings.mcp.hidden", { count: hidden.count, reasons })}</RowNote>;
}

/** 펼친 내용: 도구 칩과, 실패한 서버의 마지막 오류 출력(코드 글꼴). 줄의 이름 칸(점 뒤 20px)에 맞춰 들인다 */
function McpServerDetails(props: { readonly model: McpRowModel }): ReactNode {
  const { tools, stderr } = props.model;
  return (
    <div data-slot="mcp-server-details" className="grid gap-2 ps-5">
      {tools.length === 0 ? (
        <p className="m-0 text-ui text-text-tertiary">{t("desktop.settings.mcp.tools.empty")}</p>
      ) : (
        <ul
          aria-label={t("desktop.settings.mcp.tools.title")}
          className="m-0 flex list-none flex-wrap gap-1.5 p-0"
        >
          {tools.map((tool) => (
            <ToolChip key={tool.name} tool={tool} />
          ))}
        </ul>
      )}
      {stderr.length === 0 ? null : (
        <pre
          aria-label={t("desktop.settings.mcp.stderr.title")}
          className="m-0 rounded-lg bg-neutral-well p-3 font-mono text-mono-sm break-all whitespace-pre-wrap text-text-secondary"
        >
          {stderr.join("\n")}
        </pre>
      )}
    </div>
  );
}

/** 도구 하나: 이름(mono) 칩. 읽기 전용·바꿈 표시는 서버가 알린 성질이고, 숨은 도구는 사유를 붙여 흐리게 */
function ToolChip(props: { readonly tool: McpToolRow }): ReactNode {
  const { tool } = props;
  const hidden = toolHiddenKindOf(tool);
  const hint =
    tool.declared?.destructiveHint === true
      ? t("desktop.settings.mcp.tool.destructive")
      : tool.declared?.readOnlyHint === true
        ? t("desktop.settings.mcp.tool.readOnly")
        : null;
  return (
    <li
      title={tool.title ?? tool.name}
      className={`inline-flex h-6 max-w-full items-center gap-1.5 rounded-md px-2 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] ${hidden === null ? "" : "opacity-60"}`}
    >
      <span className="min-w-0 truncate font-mono text-mono-sm text-text-primary">{tool.name}</span>
      {hint === null ? null : <span className="text-ui-xs text-text-tertiary">{hint}</span>}
      {hidden === null ? null : (
        <span className="text-ui-xs text-text-tertiary">{t(hiddenIdOf(hidden))}</span>
      )}
    </li>
  );
}

// ── 추가와 고치기 대화 상자 ─────────────────────────────────────────────
//
// 추가: 맨 위 "붙여 넣기"(명령 한 줄이나 설정 JSON) → 아래 칸이 채워진다 → "저장하고 연결 시험" → 같은 대화 상자가 점검 줄
// (저장 → 실행과 초기화 → 도구 목록)로 바뀐다. 실패하면 고치는 법과 "고치기로 돌아가기". 고치기도 저장 뒤 같은 시험을 한다.
// 칸 배치: 이름 · 표시 이름 두 열 / 종류 segmented / 명령(전폭) / 인자(줄마다 하나, mono) / 환경 변수(이름 · 값, 비밀처럼 보이는
// 이름이면 값 칸 옆 "시크릿" 고르기). 이름표는 칸 위 13 secondary, 칸 사이 12.

/** 붙여 넣기 결과 한 줄 */
export type PasteNote =
  | { readonly kind: "filled"; readonly name: string; readonly env: number; readonly count: number }
  | { readonly kind: "issue"; readonly issue: PasteIssue };

interface McpPasteProps {
  readonly text: string;
  readonly note: PasteNote | null;
  /** 붙여 넣은 글에 서버가 여럿이면 그 이름들. 고른 차례는 `chosen` */
  readonly candidates: readonly string[];
  readonly chosen: number;
  readonly onText: (text: string) => void;
  readonly onChoose: (index: number) => void;
}

export interface McpFormViewProps {
  readonly open: boolean;
  readonly adding: boolean;
  readonly draft: McpDraft;
  /** 저장을 눌렀을 때 짚인 입력 문제. 고치면 지운다 */
  readonly issue: DraftIssue | null;
  /** 저장 실패의 글 */
  readonly error: MsgRef | null;
  readonly saving: boolean;
  /** 시크릿처럼 보이는 평문 값이 있는가. 있으면 경고를 늘 보인다 */
  readonly plaintextSecret: boolean;
  /** 추가일 때만 있다 */
  readonly paste: McpPasteProps | null;
  /** 환경 변수 값 칸 옆에서 고를 시크릿 이름 */
  readonly secretNames: readonly string[];
  /** 저장 뒤 연결 시험. `null`이면 폼이다 */
  readonly test: { readonly steps: readonly CheckStep[]; readonly name: string } | null;
  readonly onDraft: (next: McpDraft) => void;
  readonly onSave: () => void;
  readonly onBackToForm: () => void;
  readonly onRetest: () => void;
  readonly onClose: () => void;
}

/** 서버 추가와 고치기 대화 상자 */
export function McpFormDialog(props: McpFormViewProps): ReactNode {
  const { draft, onDraft, test } = props;
  const overall = test === null ? null : overallOf(test.steps);
  return (
    <Dialog
      kind="dialog"
      size="lg"
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title={
        test === null
          ? t(
              props.adding
                ? "desktop.settings.mcp.form.add.title"
                : "desktop.settings.mcp.form.edit.title",
            )
          : t("desktop.settings.mcp.test.title", { name: test.name })
      }
      footer={
        test === null ? (
          <>
            <DialogClose asChild>
              <Button variant="outline" size={FORM_CONTROL_SIZE}>
                {t("desktop.settings.mcp.form.cancel")}
              </Button>
            </DialogClose>
            <Button
              variant="solid"
              size={FORM_CONTROL_SIZE}
              disabled={props.saving}
              onClick={props.onSave}
            >
              {t("desktop.settings.mcp.form.saveAndTest")}
            </Button>
          </>
        ) : (
          <>
            {overall === "failed" ? (
              <Button variant="outline" size={FORM_CONTROL_SIZE} onClick={props.onBackToForm}>
                {t("desktop.settings.mcp.test.back")}
              </Button>
            ) : null}
            <Button
              variant={overall === "failed" ? "outline" : "solid"}
              size={FORM_CONTROL_SIZE}
              onClick={props.onClose}
            >
              {t("desktop.settings.mcp.test.close")}
            </Button>
          </>
        )
      }
    >
      {test === null ? (
        <McpFormBody
          draft={draft}
          issue={props.issue}
          error={props.error}
          plaintextSecret={props.plaintextSecret}
          paste={props.paste}
          secretNames={props.secretNames}
          onDraft={onDraft}
        />
      ) : (
        <div data-slot="mcp-test" className="grid gap-3">
          <p className="m-0 text-ui text-text-secondary">{t("desktop.settings.mcp.test.body")}</p>
          <CheckSteps
            label={t("desktop.settings.mcp.test.title", { name: test.name })}
            steps={test.steps}
            onRetry={props.onRetest}
          />
        </div>
      )}
    </Dialog>
  );
}

/** 폼 본문의 값. 대화 상자 밖에서도 그려 시험할 수 있게 본문을 따로 둔다 */
export interface McpFormBodyProps {
  readonly draft: McpDraft;
  readonly issue: DraftIssue | null;
  readonly error: MsgRef | null;
  readonly plaintextSecret: boolean;
  readonly paste?: McpPasteProps | null | undefined;
  readonly secretNames?: readonly string[] | undefined;
  readonly onDraft: (next: McpDraft) => void;
}

const PASTE_ISSUE_ID: Readonly<Record<PasteIssue, MessageId>> = {
  empty: "desktop.settings.mcp.paste.issue.empty",
  json: "desktop.settings.mcp.paste.issue.json",
  noServer: "desktop.settings.mcp.paste.issue.noServer",
  unknown: "desktop.settings.mcp.paste.issue.unknown",
};

function PasteBlock(props: { readonly paste: McpPasteProps }): ReactNode {
  const { paste } = props;
  const note = paste.note;
  return (
    <div data-slot="mcp-paste" className="grid gap-1.5">
      <span className="inline-flex items-center gap-1 text-ui text-text-secondary">
        {t("desktop.settings.mcp.paste.label")}
        <InfoTip text={t("desktop.settings.mcp.paste.info")} />
      </span>
      <Textarea
        size={FORM_CONTROL_SIZE}
        rows={3}
        className="font-mono"
        aria-label={t("desktop.settings.mcp.paste.label")}
        placeholder={t("desktop.settings.mcp.paste.placeholder")}
        value={paste.text}
        spellCheck={false}
        onChange={(event) => {
          paste.onText(event.currentTarget.value);
        }}
      />
      {note === null ? null : note.kind === "filled" ? (
        <span
          role="status"
          className="flex min-w-0 items-center gap-1.5 text-ui text-text-secondary"
        >
          <Check aria-hidden className="size-icon-sm flex-none text-success-text" />
          <span className="min-w-0">
            {t("desktop.settings.mcp.paste.filled", { name: note.name, env: note.env })}
          </span>
          {paste.candidates.length > 1 ? (
            <Select
              size={FORM_CONTROL_SIZE}
              aria-label={t("desktop.settings.mcp.paste.choose")}
              value={String(paste.chosen)}
              className={FIELD_WIDTH.medium}
              onValueChange={(next) => {
                paste.onChoose(Number(next));
              }}
            >
              {paste.candidates.map((name, index) => (
                <SelectOption key={`${name}:${String(index)}`} value={String(index)}>
                  {name}
                </SelectOption>
              ))}
            </Select>
          ) : null}
        </span>
      ) : (
        <RowNote>{t(PASTE_ISSUE_ID[note.issue])}</RowNote>
      )}
    </div>
  );
}

/** 폼 본문: 붙여 넣기(추가만), 서버 이름, 표시 이름, 종류, 종류에 맞는 칸, 경고와 오류 줄 */
export function McpFormBody(props: McpFormBodyProps): ReactNode {
  const { draft, onDraft } = props;
  const secretNames = props.secretNames ?? [];
  return (
    <div className="grid gap-3">
      {props.paste === undefined || props.paste === null ? null : (
        <>
          <PasteBlock paste={props.paste} />
          <div aria-hidden className="h-px bg-border-subtle" />
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FieldLabel
          label={t("desktop.settings.mcp.form.id")}
          info={t("desktop.settings.mcp.form.id.info")}
        >
          <Input
            size={FORM_CONTROL_SIZE}
            className="font-mono"
            aria-label={t("desktop.settings.mcp.form.id")}
            placeholder={t("desktop.settings.mcp.form.id.placeholder")}
            value={draft.id}
            spellCheck={false}
            onValueChange={(next) => {
              onDraft({ ...draft, id: next });
            }}
          />
        </FieldLabel>
        <FieldLabel label={t("desktop.settings.mcp.form.title")}>
          <Input
            size={FORM_CONTROL_SIZE}
            aria-label={t("desktop.settings.mcp.form.title")}
            placeholder={t("desktop.settings.mcp.form.title.placeholder")}
            value={draft.title}
            onValueChange={(next) => {
              onDraft({ ...draft, title: next });
            }}
          />
        </FieldLabel>
      </div>
      <FieldLabel label={t("desktop.settings.mcp.form.transport")}>
        <SegmentedControl
          size={FORM_CONTROL_SIZE}
          className="justify-self-start"
          aria-label={t("desktop.settings.mcp.form.transport")}
          value={draft.transport}
          onValueChange={(next) => {
            if (next === "stdio" || next === "http" || next === "sse") {
              onDraft({ ...draft, transport: next });
            }
          }}
        >
          <SegmentedControlItem value="stdio">
            {t("desktop.settings.mcp.form.transport.stdio")}
          </SegmentedControlItem>
          <SegmentedControlItem value="http">
            {t("desktop.settings.mcp.form.transport.http")}
          </SegmentedControlItem>
          <SegmentedControlItem value="sse">
            {t("desktop.settings.mcp.form.transport.sse")}
          </SegmentedControlItem>
        </SegmentedControl>
      </FieldLabel>
      {draft.transport === "stdio" ? (
        <>
          <FieldLabel label={t("desktop.settings.mcp.form.command")}>
            <Input
              size={FORM_CONTROL_SIZE}
              className="font-mono"
              aria-label={t("desktop.settings.mcp.form.command")}
              placeholder={t("desktop.settings.mcp.form.command.placeholder")}
              value={draft.command}
              spellCheck={false}
              onValueChange={(next) => {
                onDraft({ ...draft, command: next });
              }}
            />
          </FieldLabel>
          <FieldLabel
            label={t("desktop.settings.mcp.form.args")}
            info={t("desktop.settings.mcp.form.args.info")}
          >
            <Textarea
              size={FORM_CONTROL_SIZE}
              className="font-mono"
              aria-label={t("desktop.settings.mcp.form.args")}
              rows={3}
              value={draft.args}
              spellCheck={false}
              onChange={(event) => {
                onDraft({ ...draft, args: event.currentTarget.value });
              }}
            />
          </FieldLabel>
          <PairsEditor
            label={t("desktop.settings.mcp.form.env")}
            nameLabel={t("desktop.settings.mcp.form.env.name")}
            valueLabel={t("desktop.settings.mcp.form.env.value")}
            rows={draft.env}
            secretNames={secretNames}
            onChange={(env) => {
              onDraft({ ...draft, env });
            }}
          />
        </>
      ) : (
        <>
          <FieldLabel label={t("desktop.settings.mcp.form.url")}>
            <Input
              size={FORM_CONTROL_SIZE}
              className="font-mono"
              aria-label={t("desktop.settings.mcp.form.url")}
              placeholder="https://"
              value={draft.url}
              spellCheck={false}
              onValueChange={(next) => {
                onDraft({ ...draft, url: next });
              }}
            />
          </FieldLabel>
          <PairsEditor
            label={t("desktop.settings.mcp.form.headers")}
            nameLabel={t("desktop.settings.mcp.form.header.name")}
            valueLabel={t("desktop.settings.mcp.form.header.value")}
            rows={draft.headers}
            secretNames={[]}
            onChange={(headers) => {
              onDraft({ ...draft, headers });
            }}
          />
        </>
      )}
      {props.plaintextSecret ? (
        <RowNote>{t("desktop.settings.mcp.form.secretWarning")}</RowNote>
      ) : null}
      {props.issue === null ? null : <RowNote>{t(draftIssueIdOf(props.issue))}</RowNote>}
      {props.error === null ? null : (
        <RowNote tone="danger">{t(props.error.id, props.error.args)}</RowNote>
      )}
    </div>
  );
}

function FieldLabel(props: {
  readonly label: string;
  readonly info?: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="inline-flex items-center gap-1 text-ui text-text-secondary">
        {props.label}
        {props.info === undefined ? null : <InfoTip text={props.info} />}
      </span>
      {props.children}
    </div>
  );
}

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;
const SECRET_PREFIX = "secret://";

/**
 * 이름=값 행들. 줄 = 이름(1fr, mono) · 값(2fr) · [시크릿 고르기](비밀처럼 보이는 이름일 때) · 지우기 아이콘. 모두 28px.
 * 끝에 "추가" ghost 단추
 */
function PairsEditor(props: {
  readonly label: string;
  readonly nameLabel: string;
  readonly valueLabel: string;
  readonly rows: readonly PairRow[];
  readonly secretNames: readonly string[];
  readonly onChange: (rows: readonly PairRow[]) => void;
}): ReactNode {
  return (
    <div className="grid gap-1.5">
      <span className="text-ui text-text-secondary">{props.label}</span>
      {props.rows.map((row) => {
        const secret = props.secretNames.length > 0 && SECRET_NAME.test(row.name);
        const chosen = row.value.startsWith(SECRET_PREFIX)
          ? row.value.slice(SECRET_PREFIX.length)
          : "";
        return (
          <div key={row.uid} className="flex min-w-0 items-center gap-2">
            <Input
              size={FORM_CONTROL_SIZE}
              className="font-mono"
              aria-label={props.nameLabel}
              placeholder={props.nameLabel}
              value={row.name}
              spellCheck={false}
              containerClassName="min-w-0 flex-1"
              onValueChange={(next) => {
                props.onChange(withPairChanged(props.rows, row.uid, { name: next }));
              }}
            />
            <Input
              size={FORM_CONTROL_SIZE}
              className="font-mono"
              aria-label={props.valueLabel}
              placeholder={props.valueLabel}
              value={row.value}
              spellCheck={false}
              containerClassName="min-w-0 flex-[2]"
              onValueChange={(next) => {
                props.onChange(withPairChanged(props.rows, row.uid, { value: next }));
              }}
            />
            {secret ? (
              <Select
                size={FORM_CONTROL_SIZE}
                aria-label={t("desktop.settings.mcp.form.secretPick")}
                placeholder={t("desktop.settings.mcp.form.secretPick.short")}
                value={props.secretNames.includes(chosen) ? chosen : ""}
                className={FIELD_WIDTH.short}
                onValueChange={(name) => {
                  props.onChange(
                    withPairChanged(props.rows, row.uid, { value: `${SECRET_PREFIX}${name}` }),
                  );
                }}
              >
                {props.secretNames.map((name) => (
                  <SelectOption key={name} value={name}>
                    {name}
                  </SelectOption>
                ))}
              </Select>
            ) : null}
            <IconButton
              size={FORM_CONTROL_SIZE}
              variant="ghost"
              label={t("desktop.settings.mcp.form.removeRow")}
              onClick={() => {
                props.onChange(withPairRemoved(props.rows, row.uid));
              }}
            >
              <X />
            </IconButton>
          </div>
        );
      })}
      <div>
        <Button
          size={FORM_CONTROL_SIZE}
          variant="ghost"
          className="-ms-2"
          onClick={() => {
            props.onChange(withPairAdded(props.rows));
          }}
        >
          <Plus aria-hidden />
          {t("desktop.settings.mcp.form.addRow")}
        </Button>
      </div>
    </div>
  );
}

/** 지우기 확인 대화 상자. 되돌릴 수 없다고 먼저 알리고, "남겨 두기"가 첫 초점이다 */
export function McpRemoveDialog(props: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: MsgRef | null;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <Dialog
      kind="alert"
      size="sm"
      tone="danger"
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title={t("desktop.settings.mcp.remove.title")}
      description={t("desktop.settings.mcp.remove.body")}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size={FORM_CONTROL_SIZE} autoFocus>
              {t("desktop.settings.mcp.remove.keep")}
            </Button>
          </DialogClose>
          {props.busy ? null : (
            <DialogAction onClick={props.onConfirm}>
              {t("desktop.settings.mcp.remove.confirm")}
            </DialogAction>
          )}
        </>
      }
    >
      {props.error === null ? null : (
        <RowNote tone="danger">{t(props.error.id, props.error.args)}</RowNote>
      )}
    </Dialog>
  );
}
