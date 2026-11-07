import {
  Alert,
  Badge,
  Button,
  Chip,
  Dialog,
  DialogAction,
  DialogClose,
  Input,
  Select,
  SelectOption,
  Skeleton,
  Textarea,
} from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { McpServerAction, McpServerRow, McpToolRow } from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import { SettingSection } from "./settings-section.tsx";
import {
  blockActionOf,
  rowModelOf,
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
import {
  blockedIdOf,
  draftIssueIdOf,
  hiddenIdOf,
  locationIdOf,
  sourceRefOf,
  stateIdOf,
  stateToneOf,
  type MsgRef,
} from "./settings-mcp-text.ts";

// 설정 "도구와 웹" 탭의 "MCP 서버" 구역(W-15). 상태는 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 행은 이름, 출처 칩, 상태 칩, 막힌 사유, 마지막 오류, 숨은 도구 줄을 보이고, 펴면 도구 목록과 마지막 오류 출력을 보인다.
// 설명은 정보 아이콘 뒤에 두고, 막힘과 오류와 숨은 도구는 보이게 둔다. 값과 쓰기는 `settings-mcp-screen.tsx`가 맡는다.

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

/** "MCP 서버" 구역 하나. 머리에 다시 불러오기와 서버 추가, 아래에 행들이다 */
export function McpServersView(props: McpServersViewProps): ReactNode {
  return (
    <SettingSection
      title={t("desktop.settings.mcp.title")}
      end={
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" disabled={props.offline} onClick={props.onReload}>
            {t("desktop.settings.mcp.reload")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={props.offline || props.load.kind !== "ready"}
            onClick={props.onAdd}
          >
            {t("desktop.settings.mcp.add")}
          </Button>
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
      return (
        <Alert tone="info" size="sm">
          {t("desktop.settings.offline")}
        </Alert>
      );
    return <Skeleton height={48} />;
  }
  if (load.kind === "failed") {
    return (
      <Alert
        tone="danger"
        size="sm"
        action={
          <Button size="xs" variant="outline" onClick={props.onReload}>
            {t("desktop.settings.mcp.reload")}
          </Button>
        }
      >
        {t("desktop.settings.mcp.load.failed")}
      </Alert>
    );
  }
  if (load.rows.length === 0) {
    return <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.settings.mcp.empty")}</p>;
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

function McpServerRowView(props: McpServerRowViewProps): ReactNode {
  const model = rowModelOf(props.row, props.locale);
  const location = locationIdOf(model.locationNote);
  const source = sourceRefOf(model.source);
  return (
    <div data-slot="mcp-server-row" data-server={model.server} className="grid gap-2 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-ui font-medium text-text-primary">{model.name}</span>
        {model.idText === null ? null : (
          <span className="font-mono text-mono-sm text-text-tertiary">{model.idText}</span>
        )}
        <Badge size="xs" variant="outline">
          {t(source.id, source.args)}
        </Badge>
        <Chip size="xs" tone={stateToneOf(model.state)} variant="soft">
          {t(stateIdOf(model.state))}
        </Chip>
        <span className="text-ui-sm text-text-tertiary">
          {t("desktop.settings.mcp.tools", { count: model.toolCount })}
        </span>
        {location === null ? null : <InfoTip text={t(location)} />}
      </div>
      <BlockedLine model={model} />
      {model.error === null ? null : (
        <p className="m-0 text-ui-sm break-words text-danger-text">
          {t("desktop.settings.mcp.lastError", {
            time: model.error.time,
            message: model.error.message,
          })}
        </p>
      )}
      <HiddenLine model={model} />
      {props.error === null ? null : (
        <Alert tone="danger" size="sm">
          {t(props.error.id, props.error.args)}
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={props.busy || props.offline}
          onClick={() => {
            props.onAction("restart");
          }}
        >
          {t("desktop.settings.mcp.action.restart")}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={props.busy || props.offline}
          onClick={() => {
            props.onAction(blockActionOf(model));
          }}
        >
          {t(
            model.alwaysBlocked
              ? "desktop.settings.mcp.action.unblock"
              : "desktop.settings.mcp.action.block",
          )}
        </Button>
        {model.editable ? (
          <>
            <Button
              size="xs"
              variant="outline"
              disabled={props.busy || props.offline}
              onClick={props.onEdit}
            >
              {t("desktop.settings.mcp.action.edit")}
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={props.busy || props.offline}
              onClick={props.onRemove}
            >
              {t("desktop.settings.mcp.action.remove")}
            </Button>
          </>
        ) : null}
        <Button size="xs" variant="ghost" aria-expanded={props.expanded} onClick={props.onToggle}>
          {t(
            props.expanded
              ? "desktop.settings.mcp.action.collapse"
              : "desktop.settings.mcp.action.details",
          )}
        </Button>
      </div>
      {props.expanded ? <McpServerDetails model={model} /> : null}
    </div>
  );
}

/** 막힌 사유 한 줄. 승인 대기는 설명을 정보 아이콘 뒤에 둔다 */
function BlockedLine(props: { readonly model: McpRowModel }): ReactNode {
  const { model } = props;
  if (model.blocked === null && model.state !== "blocked") return null;
  const text =
    model.blocked === null
      ? t("desktop.settings.mcp.blocked.unknown")
      : t(blockedIdOf(model.blocked));
  return (
    <div className="flex flex-wrap items-center gap-1 text-ui-sm text-text-secondary">
      <span>{text}</span>
      {model.approvalNote ? (
        <InfoTip text={t("desktop.settings.mcp.blocked.approval.info")} />
      ) : null}
    </div>
  );
}

/** 숨은 도구 한 줄. 접힌 상태에서도 보인다 */
function HiddenLine(props: { readonly model: McpRowModel }): ReactNode {
  const { hidden } = props.model;
  if (hidden === null) return null;
  const reasons = hidden.reasons.map((kind) => t(hiddenIdOf(kind))).join(" · ");
  return (
    <p className="m-0 text-ui-sm break-words text-warning-text">
      {t("desktop.settings.mcp.hidden", { count: hidden.count, reasons })}
    </p>
  );
}

/** 펼친 내용: 도구 목록과, 실패한 서버의 마지막 오류 출력(코드 글꼴) */
function McpServerDetails(props: { readonly model: McpRowModel }): ReactNode {
  const { tools, stderr } = props.model;
  return (
    <div className="grid gap-2 rounded-lg bg-neutral-track px-3 py-2">
      {tools.length === 0 ? (
        <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.settings.mcp.tools.empty")}</p>
      ) : (
        <ul aria-label={t("desktop.settings.mcp.tools.title")} className="m-0 grid gap-1 p-0">
          {tools.map((tool) => (
            <ToolLine key={tool.name} tool={tool} />
          ))}
        </ul>
      )}
      {stderr.length === 0 ? null : (
        <pre
          aria-label={t("desktop.settings.mcp.stderr.title")}
          className="m-0 font-mono text-mono-sm break-all whitespace-pre-wrap text-text-secondary"
        >
          {stderr.join("\n")}
        </pre>
      )}
    </div>
  );
}

function ToolLine(props: { readonly tool: McpToolRow }): ReactNode {
  const { tool } = props;
  const hidden = toolHiddenKindOf(tool);
  return (
    <li className="flex flex-wrap items-baseline gap-2">
      <span className="font-mono text-mono-sm text-text-primary">{tool.name}</span>
      {tool.title === undefined || tool.title === "" ? null : (
        <span className="text-ui-sm text-text-tertiary">{tool.title}</span>
      )}
      {hidden === null ? null : (
        <span className="text-ui-sm text-warning-text">{t(hiddenIdOf(hidden))}</span>
      )}
    </li>
  );
}

// ── 추가와 고치기 대화 상자 ─────────────────────────────────────────────

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
  readonly onDraft: (next: McpDraft) => void;
  readonly onSave: () => void;
  readonly onClose: () => void;
}

/** 서버 추가와 고치기 대화 상자. 전송 방식에 따라 명령과 인자, 또는 주소와 헤더를 보인다 */
export function McpFormDialog(props: McpFormViewProps): ReactNode {
  const { draft, onDraft } = props;
  return (
    <Dialog
      kind="dialog"
      size="lg"
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title={t(
        props.adding
          ? "desktop.settings.mcp.form.add.title"
          : "desktop.settings.mcp.form.edit.title",
      )}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t("desktop.settings.mcp.form.cancel")}
            </Button>
          </DialogClose>
          <Button variant="solid" size="sm" disabled={props.saving} onClick={props.onSave}>
            {t("desktop.settings.mcp.form.save")}
          </Button>
        </>
      }
    >
      <McpFormBody
        draft={draft}
        issue={props.issue}
        error={props.error}
        plaintextSecret={props.plaintextSecret}
        onDraft={onDraft}
      />
    </Dialog>
  );
}

/** 폼 본문의 값. 대화 상자 밖에서도 그려 시험할 수 있게 본문을 따로 둔다 */
export interface McpFormBodyProps {
  readonly draft: McpDraft;
  readonly issue: DraftIssue | null;
  readonly error: MsgRef | null;
  readonly plaintextSecret: boolean;
  readonly onDraft: (next: McpDraft) => void;
}

/** 폼 본문: 서버 이름, 표시 이름, 전송 방식, 전송에 맞는 칸, 경고와 오류 줄 */
export function McpFormBody(props: McpFormBodyProps): ReactNode {
  const { draft, onDraft } = props;
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-end gap-1">
        <InfoTip text={t("desktop.settings.mcp.form.apply.info")} />
      </div>
      <FieldLabel label={t("desktop.settings.mcp.form.id")}>
        <Input
          aria-label={t("desktop.settings.mcp.form.id")}
          value={draft.id}
          spellCheck={false}
          onValueChange={(next) => {
            onDraft({ ...draft, id: next });
          }}
        />
      </FieldLabel>
      <FieldLabel label={t("desktop.settings.mcp.form.title")}>
        <Input
          aria-label={t("desktop.settings.mcp.form.title")}
          value={draft.title}
          onValueChange={(next) => {
            onDraft({ ...draft, title: next });
          }}
        />
      </FieldLabel>
      <FieldLabel label={t("desktop.settings.mcp.form.transport")}>
        <Select
          aria-label={t("desktop.settings.mcp.form.transport")}
          value={draft.transport}
          onValueChange={(next) => {
            if (next === "stdio" || next === "http" || next === "sse") {
              onDraft({ ...draft, transport: next });
            }
          }}
        >
          <SelectOption value="stdio">
            {t("desktop.settings.mcp.form.transport.stdio")}
          </SelectOption>
          <SelectOption value="http">{t("desktop.settings.mcp.form.transport.http")}</SelectOption>
          <SelectOption value="sse">{t("desktop.settings.mcp.form.transport.sse")}</SelectOption>
        </Select>
      </FieldLabel>
      {draft.transport === "stdio" ? (
        <>
          <FieldLabel label={t("desktop.settings.mcp.form.command")}>
            <Input
              aria-label={t("desktop.settings.mcp.form.command")}
              value={draft.command}
              spellCheck={false}
              onValueChange={(next) => {
                onDraft({ ...draft, command: next });
              }}
            />
          </FieldLabel>
          <FieldLabel label={t("desktop.settings.mcp.form.args")}>
            <Textarea
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
            onChange={(env) => {
              onDraft({ ...draft, env });
            }}
          />
        </>
      ) : (
        <>
          <FieldLabel label={t("desktop.settings.mcp.form.url")}>
            <Input
              aria-label={t("desktop.settings.mcp.form.url")}
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
            onChange={(headers) => {
              onDraft({ ...draft, headers });
            }}
          />
        </>
      )}
      {props.plaintextSecret ? (
        <Alert tone="warning" variant="ghost" size="sm">
          {t("desktop.settings.mcp.form.secretWarning")}
        </Alert>
      ) : null}
      {props.issue === null ? null : (
        <Alert tone="warning" variant="ghost" size="sm">
          {t(draftIssueIdOf(props.issue))}
        </Alert>
      )}
      {props.error === null ? null : (
        <Alert tone="danger" size="sm">
          {t(props.error.id, props.error.args)}
        </Alert>
      )}
    </div>
  );
}

function FieldLabel(props: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className="grid gap-1">
      <span className="text-ui-sm text-text-secondary">{props.label}</span>
      {props.children}
    </div>
  );
}

/** 이름=값 행들. 행마다 두 칸과 지우기 단추가 있고, 끝에 행 추가 단추가 있다 */
function PairsEditor(props: {
  readonly label: string;
  readonly nameLabel: string;
  readonly valueLabel: string;
  readonly rows: readonly PairRow[];
  readonly onChange: (rows: readonly PairRow[]) => void;
}): ReactNode {
  return (
    <div className="grid gap-2">
      <span className="text-ui-sm text-text-secondary">{props.label}</span>
      {props.rows.map((row) => (
        <div key={row.uid} className="flex flex-wrap items-center gap-2">
          <Input
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
            aria-label={props.valueLabel}
            placeholder={props.valueLabel}
            value={row.value}
            spellCheck={false}
            containerClassName="min-w-0 flex-[2]"
            onValueChange={(next) => {
              props.onChange(withPairChanged(props.rows, row.uid, { value: next }));
            }}
          />
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              props.onChange(withPairRemoved(props.rows, row.uid));
            }}
          >
            {t("desktop.settings.mcp.form.removeRow")}
          </Button>
        </div>
      ))}
      <div>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            props.onChange(withPairAdded(props.rows));
          }}
        >
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
            <Button variant="outline" size="sm" autoFocus>
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
        <Alert tone="danger" size="sm">
          {t(props.error.id, props.error.args)}
        </Alert>
      )}
    </Dialog>
  );
}
