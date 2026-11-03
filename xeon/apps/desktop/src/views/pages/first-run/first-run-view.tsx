import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Progress,
  Skeleton,
  Stepper,
  Switch,
  Table,
  type StepperStep,
  type TableColumn,
  type TableRow,
} from "@caustic/react";
import { ArrowRight } from "@caustic/react/icons";
import {
  checkModelRef,
  PRESET_PROVIDERS,
  type BinaryView,
  type KeyField,
  type SetupSnapshot,
} from "@fresnel/client/settings";
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { useId, type ReactNode } from "react";
import type { DefaultGroupId } from "../../commands.ts";
import {
  groupRowsOf,
  keyViewOf,
  stepIdAt,
  unknownStepsOf,
  type FirstRunKeyEntry,
  type FirstRunModel,
  type FirstRunStatus,
  type GroupRow,
  type StepId,
  type StepState,
} from "./first-run-model.ts";
import { FirstRunKeyForm } from "./first-run-key.tsx";
import {
  groupNameOf,
  groupWhatOf,
  recommendStateOf,
  stepTitleOf,
  summaryOf,
} from "./first-run-text.ts";

// 첫 실행 화면(P-01)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 단계 목록은 `Stepper variant="checklist"`이고, 고른 단계의 본문이 오른쪽 카드에 보인다. 쓰기는 `locked`일 때 모두 잠긴다.

/** 도구 표가 이 줄 수를 넘으면 선택 도구는 접는다(L4.desktop-ux §6.5 긴 내용) */
const LONG_TOOLS = 8;

export interface FirstRunViewHandlers {
  readonly open: (step: StepId) => void;
  /** 외부 도구와 설정을 다시 읽는다(`load({ binaries: true })`) */
  readonly recheck: () => void;
  readonly retry: () => void;
  readonly provider: (value: string) => void;
  readonly model: (value: string) => void;
  readonly register: () => void;
  readonly submitKey: (field: KeyField) => void;
  readonly cancelKey: () => void;
  readonly connect: () => void;
  readonly saveModel: () => void;
  readonly setGroup: (group: DefaultGroupId, on: boolean) => void;
  readonly dismissSearch: () => void;
  readonly openLightCraft: () => void;
}

export interface FirstRunViewProps {
  readonly status: FirstRunStatus;
  /** `status`가 `error`일 때 설정을 못 읽은 까닭의 문장. 없으면 null */
  readonly reason: string | null;
  /** 쓰기를 잠갔는가: 오프라인이거나 보내는 중이다 */
  readonly locked: boolean;
  readonly setup: SetupSnapshot | null;
  readonly model: FirstRunModel | null;
  readonly open: StepId;
  readonly providerInput: string;
  readonly modelInput: string;
  readonly keyEntry: FirstRunKeyEntry;
  /** 화면 아래 한 줄 알림(저장됨, 저장 실패). 없으면 null */
  readonly notice: string | null;
  readonly handlers: FirstRunViewHandlers;
}

/** 단계 옆 요약. 읽는 중이면 진행 표시, 모델이 없으면 "확인할 수 없음"이다 */
function detailOf(step: StepState, props: FirstRunViewProps): ReactNode {
  if (props.status === "loading") {
    return <Progress indeterminate size="sm" aria-label={t("desktop.settings.loading.status")} />;
  }
  const model = props.model;
  if (model === null) return t("desktop.firstRun.summary.unknown");
  if (step.id === "model" && step.done && model.defaultModel !== null) return model.defaultModel;
  return t(summaryOf(step, model));
}

function stepperStepsOf(props: FirstRunViewProps): StepperStep[] {
  const rows = props.model?.steps ?? unknownStepsOf();
  return rows.map((step): StepperStep => ({
    id: step.id,
    label: t(stepTitleOf(step.id)),
    status: step.done ? "done" : step.id === props.open ? "now" : "todo",
    detail: detailOf(step, props),
    clickable: props.model !== null && !step.locked,
  }));
}

export function FirstRunView(props: FirstRunViewProps): ReactNode {
  const headingId = useId();
  const bodyId = useId();
  const { status, handlers } = props;
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
    >
      <h1 id={headingId} className="text-ui-strong text-text-primary">
        {t("desktop.firstRun.title")}
      </h1>
      {status === "offline" ? <Alert tone="warning">{t("desktop.firstRun.offline")}</Alert> : null}
      {status === "error" ? (
        <Alert
          tone="danger"
          action={
            <Button size="xs" variant="outline" disabled={props.locked} onClick={handlers.retry}>
              {t("desktop.firstRun.retry")}
            </Button>
          }
        >
          {t("desktop.firstRun.loadFailed")}
          {props.reason === null ? null : ` ${props.reason}`}
        </Alert>
      ) : null}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <Stepper
          variant="checklist"
          title={t("desktop.firstRun.steps.label")}
          steps={stepperStepsOf(props)}
          onStepClick={(index) => {
            const id = stepIdAt(index);
            if (id !== null) handlers.open(id);
          }}
        />
        <Card role="region" aria-labelledby={bodyId} size="sm" className="grid min-w-0 gap-3">
          <h2 id={bodyId} className="text-ui-strong text-text-primary">
            {t(stepTitleOf(props.open))}
          </h2>
          <StepBody {...props} />
          {props.notice === null ? null : (
            <p role="status" className="text-ui-sm text-text-secondary">
              {props.notice}
            </p>
          )}
        </Card>
      </div>
    </section>
  );
}

function StepBody(props: FirstRunViewProps): ReactNode {
  switch (props.open) {
    case "tools":
      return <ToolsBody {...props} />;
    case "key":
      return props.setup === null ? null : <KeyBody {...props} setup={props.setup} />;
    case "model":
      return props.model === null ? null : <ModelBody {...props} model={props.model} />;
    case "search":
      return props.model === null ? null : <SearchBody {...props} model={props.model} />;
    case "groups":
      return props.model === null ? null : <GroupsBody {...props} model={props.model} />;
    default:
      return assertNever(props.open, "StepId");
  }
}

// ── 외부 도구 ────────────────────────────────────────────────────────────

function ToolsBody(props: FirstRunViewProps): ReactNode {
  const binaries = props.setup?.binaries ?? null;
  return (
    <div className="grid gap-3">
      {props.status === "loading" ? <Skeleton height={96} /> : null}
      {props.status === "ready" || props.status === "offline" ? (
        binaries === null ? (
          <p className="text-ui-sm text-text-secondary">
            {props.status === "offline"
              ? t("desktop.firstRun.tools.offline")
              : t("desktop.settings.tools.unavailable")}
          </p>
        ) : (
          <ToolRows binaries={binaries} />
        )
      ) : null}
      {props.status === "ready" ? (
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={props.locked}
            onClick={props.handlers.recheck}
          >
            {t("desktop.settings.recheck.button")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const tableRowsOf = (list: BinaryView["rows"]): TableRow[] =>
  list.map((row) => ({
    id: row.name,
    tool: row.name,
    need: t(
      row.need === "required"
        ? "desktop.settings.tools.need.required"
        : "desktop.settings.tools.need.optional",
    ),
    status: row.ok
      ? `${t("desktop.settings.tools.status.available")} · ${row.note}`
      : `${t("desktop.settings.tools.status.unavailable")} · ${row.note} · ${row.impact}`,
    usedBy: row.usedBy,
  }));

function ToolRows(props: { readonly binaries: BinaryView }): ReactNode {
  const { rows } = props.binaries;
  const folded = rows.length > LONG_TOOLS;
  const required = rows.filter((row) => row.need === "required");
  const optional = rows.filter((row) => row.need !== "required");
  const columns: TableColumn[] = [
    { key: "tool", header: t("desktop.settings.tools.column.tool") },
    { key: "need", header: t("desktop.settings.tools.column.need") },
    { key: "status", header: t("desktop.settings.tools.column.status") },
    { key: "usedBy", header: t("desktop.settings.tools.column.usedBy") },
  ];
  return (
    <>
      <Table columns={columns} rows={tableRowsOf(folded ? required : rows)} />
      {folded && optional.length > 0 ? (
        <Accordion type="single">
          <AccordionItem value="optional">
            <AccordionTrigger>
              {t("desktop.firstRun.tools.optionalFold", { count: optional.length })}
            </AccordionTrigger>
            <AccordionContent>
              <Table columns={columns} rows={tableRowsOf(optional)} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}
    </>
  );
}

// ── 모델 키 ──────────────────────────────────────────────────────────────

function KeyBody(props: FirstRunViewProps & { readonly setup: SetupSnapshot }): ReactNode {
  const { setup, handlers, keyEntry, locked } = props;
  const view = keyViewOf(setup, props.providerInput);
  const linkedText = view.linked ? ` · ${t("desktop.firstRun.key.linked")}` : "";
  return (
    <div className="grid gap-3">
      <Field
        label={t("desktop.firstRun.key.provider")}
        hint={t("desktop.firstRun.key.providerRule")}
      >
        <Input
          list="first-run-provider-presets"
          value={props.providerInput}
          disabled={locked}
          onValueChange={handlers.provider}
        />
      </Field>
      <datalist id="first-run-provider-presets">
        {PRESET_PROVIDERS.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <p className="text-ui-sm text-text-secondary">
        {view.secretName === null ? null : (
          <>
            {t("desktop.settings.secretName.label")} <code>{view.secretName}</code>
            {" · "}
            {view.registered
              ? t("desktop.settings.secret.registered")
              : t("desktop.settings.secret.notRegistered")}
          </>
        )}
        {linkedText}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={locked || view.secretName === null} onClick={handlers.register}>
          {view.registered
            ? t("desktop.settings.key.change.button")
            : t("desktop.settings.key.register.button")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={locked || !view.registered || view.linked}
          onClick={handlers.connect}
        >
          {t("desktop.firstRun.key.connect")}
        </Button>
        <Button size="sm" variant="ghost" disabled={locked} onClick={handlers.recheck}>
          {t("desktop.settings.recheck.button")}
        </Button>
      </div>
      {keyEntry.state === "form" ? (
        <FirstRunKeyForm
          busy={locked}
          onSubmit={handlers.submitKey}
          onCancel={handlers.cancelKey}
        />
      ) : null}
      {keyEntry.state === "failed" ? <Alert tone="danger">{keyEntry.text}</Alert> : null}
    </div>
  );
}

// ── 기본 모델 ────────────────────────────────────────────────────────────

function ModelBody(props: FirstRunViewProps & { readonly model: FirstRunModel }): ReactNode {
  const { model, handlers, locked } = props;
  const step = model.steps.find((entry) => entry.id === "model");
  const stepLocked = step?.locked === true;
  const check = checkModelRef(props.modelInput);
  const invalid = props.modelInput.trim() !== "" && !check.ok;
  return (
    <div className="grid gap-3">
      {stepLocked ? (
        <p className="text-ui-sm text-text-secondary">{t("desktop.firstRun.model.locked")}</p>
      ) : null}
      <Field
        label={t("desktop.firstRun.model.label")}
        error={invalid ? t("desktop.firstRun.model.invalid") : undefined}
      >
        <Input
          placeholder="anthropic/claude-sonnet-5-5"
          value={props.modelInput}
          invalid={invalid}
          disabled={locked || stepLocked}
          onValueChange={handlers.model}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={locked || stepLocked || !check.ok} onClick={handlers.saveModel}>
          {t("desktop.settings.save.button")}
        </Button>
        <span className="text-ui-sm text-text-secondary">
          {model.defaultModel === null
            ? t("desktop.settings.defaultModel.unset")
            : t("desktop.settings.defaultModel.current", { model: model.defaultModel })}
        </span>
      </div>
    </div>
  );
}

// ── 웹 검색(선택) ────────────────────────────────────────────────────────

function SearchBody(props: FirstRunViewProps & { readonly model: FirstRunModel }): ReactNode {
  const { model, handlers, locked } = props;
  const search = model.search;
  if (search === null) {
    return <p className="text-ui-sm text-text-secondary">{t("desktop.firstRun.search.unknown")}</p>;
  }
  const current =
    search.provider === "auto" ? t("desktop.firstRun.search.builtin") : search.provider;
  return (
    <div className="grid gap-3">
      <p className="text-ui text-text-primary">
        {t("desktop.firstRun.search.current", { provider: current })}
      </p>
      <p className="text-ui-sm text-text-secondary">{t("desktop.firstRun.search.cost")}</p>
      <h3 className="text-ui-strong text-text-primary">
        {t("desktop.firstRun.search.recommended")}
      </h3>
      <ul className="m-0 grid list-none gap-2 p-0">
        {search.recommendations.map((entry) => (
          <li key={entry.providerId} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-ui text-text-primary">{entry.label}</span>
            <span className="text-ui-sm text-text-secondary">
              {t(
                recommendStateOf(entry.state),
                entry.state === "unavailable" ? { reason: entry.hint } : {},
              )}
            </span>
          </li>
        ))}
      </ul>
      {model.searchState === "pending" ? (
        <div>
          <Button size="sm" variant="ghost" disabled={locked} onClick={handlers.dismissSearch}>
            {t("desktop.firstRun.search.later")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ── 기본 그룹(선택) ──────────────────────────────────────────────────────

function GroupsBody(props: FirstRunViewProps & { readonly model: FirstRunModel }): ReactNode {
  const { model, handlers, locked } = props;
  const groups = model.groups;
  if (groups === null) {
    return <p className="text-ui-sm text-text-secondary">{t("desktop.firstRun.groups.unknown")}</p>;
  }
  return (
    <div className="grid gap-3">
      {groups.safeMode ? (
        <Alert tone="warning">{t("desktop.firstRun.groups.safeMode")}</Alert>
      ) : null}
      <ul className="m-0 grid list-none gap-3 p-0">
        {groupRowsOf(groups).map((row) => (
          <GroupRowView key={row.id} row={row} locked={locked} onChange={handlers.setGroup} />
        ))}
      </ul>
      <div>
        <Button
          variant="ghost"
          size="sm"
          iconEnd={<ArrowRight />}
          onClick={handlers.openLightCraft}
        >
          {t("desktop.firstRun.groups.lightCraft")}
        </Button>
      </div>
    </div>
  );
}

function GroupRowView(props: {
  readonly row: GroupRow;
  readonly locked: boolean;
  readonly onChange: (group: DefaultGroupId, on: boolean) => void;
}): ReactNode {
  const { row } = props;
  const nameId = useId();
  return (
    <li className="flex items-start gap-3">
      {row.switchable ? (
        <Switch
          aria-labelledby={nameId}
          checked={row.on}
          disabled={props.locked}
          className="mt-0.5"
          onCheckedChange={(on) => {
            props.onChange(row.id, on);
          }}
        />
      ) : (
        <Badge className="mt-0.5">{t("desktop.firstRun.group.off")}</Badge>
      )}
      <div className="grid min-w-0 gap-0.5">
        <span id={nameId} className="text-ui-strong text-text-primary">
          {t(groupNameOf(row.id))}
        </span>
        <span className="text-ui-sm text-text-secondary">{t(groupWhatOf(row.id))}</span>
      </div>
    </li>
  );
}
