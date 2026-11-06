import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Badge,
  Button,
  Combobox,
  Input,
  ListDescription,
  ListDescriptionRow,
  Progress,
  Skeleton,
  Switch,
  Table,
  Tooltip,
  type ComboboxGroupData,
  type ComboboxOptionData,
  type TableColumn,
  type TableRow,
} from "@caustic/react";
import { ArrowRight, CircleAlert, CircleCheck, RotateCcw } from "@caustic/react/icons";
import {
  PRESET_PROVIDERS,
  type BinaryView,
  type KeyField,
  type SetupSnapshot,
} from "@fresnel/client/settings";
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { ModelEntry } from "@fresnel/contracts/wire";
import type { SecretName } from "@fresnel/contracts/capabilities";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { DefaultGroupId } from "../../commands.ts";
import {
  groupRowsOf,
  keyViewOf,
  modelGroupsOf,
  modelInChoices,
  primaryActionOf,
  recommendSecretOf,
  showsInstallHelp,
  STEP_ORDER,
  unknownStepsOf,
  type FirstRunKeyEntry,
  type FirstRunModel,
  type FirstRunStatus,
  type GroupRow,
  type PrimaryAction,
  type PrimaryInput,
  type StepId,
  type StepState,
} from "./first-run-model.ts";
import { FirstRunKeyForm } from "./first-run-key.tsx";
import {
  groupNameOf,
  groupWhatOf,
  recommendStateOf,
  startBlockedOf,
  stepTitleOf,
  summaryOf,
} from "./first-run-text.ts";

// 첫 실행 화면(P-01)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 시안(`mockups/p01-first-run`)처럼 읽기 폭 한 칸에 머리(제목, 진행 개수, 대화 시작)와 단계 아코디언을 둔다.
// 한 번에 한 단계만 펼친다. 쓰기는 `locked`일 때 모두 잠기고, 오프라인이면 잠근 이유를 Tooltip으로 보인다.

/** 도구 표가 이 줄 수를 넘으면 선택 도구는 접는다(L4.desktop-ux §6.5 긴 내용) */
const LONG_TOOLS = 8;
/** 단계 안 이름표·값 목록. 행 안쪽 여백을 없애 본문 왼쪽 줄에 맞춘다(시안 LIST) */
const LIST = "rounded-none [&_[data-slot=list-description-row]]:px-0";

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
  /** 키체인 실패 뒤 "다시 시도": 키 값 칸을 다시 연다 */
  readonly retryKey: () => void;
  readonly connect: () => void;
  readonly saveModel: () => void;
  readonly setGroup: (group: DefaultGroupId, on: boolean) => void;
  readonly dismissSearch: () => void;
  /** 검색 권장 플러그인의 키를 등록한다. 이름은 권장 행의 시크릿 이름이다 */
  readonly registerSecret: (name: SecretName) => void;
  readonly openLightCraft: () => void;
  /** 대화를 새로 만들고 대화 화면으로 간다("대화 시작") */
  readonly startChat: () => void;
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
  /** 호스트 카탈로그(`models.list`)의 모델. 이 목록에서만 기본 모델을 고른다 */
  readonly modelChoices: readonly ModelEntry[];
  readonly keyEntry: FirstRunKeyEntry;
  /** 화면 아래 한 줄 알림(저장됨, 저장 실패). 없으면 null */
  readonly notice: string | null;
  /** 바닥글의 엔진 한 줄(상태·출처·연결)이다. 상태 표시줄과 같은 문장을 쓴다. 문장은 화면이 만든다 */
  readonly engineState: string;
  readonly handlers: FirstRunViewHandlers;
}

/** ⌘Enter가 보는 값. 화면 props에서 만든다 */
function primaryInputOf(props: FirstRunViewProps): PrimaryInput {
  const modelStep = props.model?.steps.find((step) => step.id === "model");
  return {
    step: props.open,
    locked: props.locked,
    ready: props.setup !== null,
    keyFormOpen: props.keyEntry.state === "form",
    secretKnown:
      props.setup !== null && keyViewOf(props.setup, props.providerInput).secretName !== null,
    modelReady: modelStep?.locked !== true && modelInChoices(props.modelChoices, props.modelInput),
    searchPending: props.model?.searchState === "pending",
  };
}

/** ⌘Enter(`metaKey` 또는 `ctrlKey`와 Enter)가 누른 단계의 주 동작을 한다. 키 칸은 열린 폼에 저장을 요청한다 */
function runPrimary(
  action: PrimaryAction,
  props: FirstRunViewProps,
  keyFormRef: RefObject<HTMLFormElement | null>,
): void {
  const { handlers } = props;
  switch (action) {
    case "recheck":
      handlers.recheck();
      return;
    case "register":
      handlers.register();
      return;
    case "submitKey":
      keyFormRef.current?.requestSubmit();
      return;
    case "saveModel":
      handlers.saveModel();
      return;
    case "dismissSearch":
      handlers.dismissSearch();
      return;
    default:
      assertNever(action, "PrimaryAction");
      return;
  }
}

export function FirstRunView(props: FirstRunViewProps): ReactNode {
  const headingId = useId();
  const keyFormRef = useRef<HTMLFormElement | null>(null);
  const { status, handlers, model } = props;
  const primary = primaryActionOf(primaryInputOf(props));
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key !== "Enter" || !mod || event.shiftKey || event.altKey) return;
    if (event.nativeEvent.isComposing || primary === null) return;
    event.preventDefault();
    runPrimary(primary, props, keyFormRef);
  };
  const doneCount = model === null ? 0 : model.steps.filter((step) => step.done).length;
  const ready = model?.readyToChat === true;
  const startBlocked = startBlockedOf(model);
  const start = (
    <Button
      size="sm"
      variant="solid"
      disabled={!ready || props.locked}
      onClick={handlers.startChat}
    >
      {t("desktop.firstRun.chat.start")}
    </Button>
  );
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={onKeyDown}
    >
      <header className="mx-auto flex h-10 w-full max-w-184 flex-none items-center gap-1 ps-3 pe-11">
        <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
          <h1 id={headingId} className="m-0 truncate text-ui-strong text-text-primary">
            {t("desktop.firstRun.steps.label")}
          </h1>
          <span
            className="text-ui-sm tabular-nums text-text-tertiary"
            aria-label={t("desktop.firstRun.progress", {
              done: doneCount,
              total: STEP_ORDER.length,
            })}
          >
            {`${doneCount}/${STEP_ORDER.length}`}
          </span>
        </div>
        {ready ? (
          start
        ) : (
          <Tooltip content={t("desktop.firstRun.chat.lockedTip")}>
            <span className="inline-flex">{start}</span>
          </Tooltip>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto grid w-full max-w-184 gap-2 px-3 pt-1 pb-6">
          {status === "offline" ? (
            <Alert tone="warning" layout="inline" size="sm">
              {t("desktop.firstRun.offline")}
            </Alert>
          ) : null}
          {status === "error" ? (
            <Alert
              tone="danger"
              layout="inline"
              size="sm"
              action={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={props.locked}
                  onClick={handlers.retry}
                >
                  {t("desktop.firstRun.retry")}
                </Button>
              }
            >
              {t("desktop.firstRun.loadFailed")}
              {props.reason === null ? null : ` ${props.reason}`}
            </Alert>
          ) : null}
          {startBlocked === null ? null : (
            <p role="status" className="m-0 text-ui-sm text-text-secondary">
              {t(startBlocked)}
            </p>
          )}
          <StepList {...props} keyFormRef={keyFormRef} />
          {props.notice === null ? null : (
            <p role="status" className="m-0 text-ui-sm text-text-secondary">
              {props.notice}
            </p>
          )}
          <footer className="text-ui-xs text-text-tertiary">{props.engineState}</footer>
        </div>
      </div>
    </section>
  );
}

type StepBodyProps = FirstRunViewProps & {
  readonly keyFormRef: RefObject<HTMLFormElement | null>;
};

// ── 단계 목록 ────────────────────────────────────────────────────────────

/** 단계 머리의 상태: 끝남, 필수 도구가 막힘, 그 밖은 할 일이다. 점검 결과를 못 받은 단계는 할 일로 본다 */
type StepIndicator = "done" | "failed" | "todo";

function indicatorOf(step: StepState): StepIndicator {
  if (step.done) return "done";
  return step.id === "tools" && !step.unknown ? "failed" : "todo";
}

/** 단계 머리의 원: 끝나면 체크, 필수 도구가 막히면 경고, 그 밖은 번호다(시안 Indicator) */
function Indicator(props: { readonly n: number; readonly status: StepIndicator }): ReactNode {
  if (props.status === "done")
    return (
      <span className="inline-flex size-full text-success-graphic">
        <CircleCheck />
      </span>
    );
  if (props.status === "failed")
    return (
      <span className="inline-flex size-full text-danger-graphic">
        <CircleAlert />
      </span>
    );
  return (
    <span className="grid size-full place-items-center rounded-full border border-border-default text-ui-xs leading-none text-text-secondary tabular-nums">
      {props.n}
    </span>
  );
}

/** 단계 줄 오른쪽의 요약(시안 summary). 막힌 도구는 빨간 글자로 보인다 */
function Summary(props: { readonly danger?: boolean; readonly children: ReactNode }): ReactNode {
  return (
    <span
      className={`text-ui-sm font-normal ${props.danger === true ? "text-danger-text" : "text-text-tertiary"}`}
    >
      {props.children}
    </span>
  );
}

/** 단계 옆 요약. 읽는 중이면 진행 표시, 설정을 못 읽었으면 "확인할 수 없음", 기본 모델은 모델 이름이다 */
function detailOf(step: StepState, props: FirstRunViewProps): ReactNode {
  if (props.status === "loading") {
    return <Progress indeterminate size="sm" aria-label={t("desktop.settings.loading.status")} />;
  }
  const model = props.model;
  if (model === null) return <Summary>{t("desktop.firstRun.summary.unknown")}</Summary>;
  if (step.id === "model" && step.done && model.defaultModel !== null) {
    return <Summary>{model.defaultModel}</Summary>;
  }
  return <Summary danger={indicatorOf(step) === "failed"}>{t(summaryOf(step, model))}</Summary>;
}

function StepList(props: StepBodyProps): ReactNode {
  const { model, handlers, open } = props;
  const steps = model?.steps ?? unknownStepsOf();
  return (
    <Accordion
      type="single"
      variant="ghost"
      size="sm"
      collapsible={false}
      value={open}
      onValueChange={(value) => {
        const next = STEP_ORDER.find((step) => step === value);
        if (next !== undefined) handlers.open(next);
      }}
      aria-label={t("desktop.firstRun.steps.label")}
      className="gap-1 [&_[data-slot=accordion-content]]:max-w-none [&_[data-slot=accordion-content]]:ps-10 [&_[data-slot=accordion-content]]:pe-3.5"
    >
      {steps.map((step, index) => {
        const indicator = indicatorOf(step);
        return (
          <AccordionItem
            key={step.id}
            value={step.id}
            disabled={model === null || step.locked}
            data-status={indicator}
          >
            <AccordionTrigger
              icon={<Indicator n={index + 1} status={indicator} />}
              accessory={detailOf(step, props)}
              aria-current={open === step.id ? "step" : undefined}
            >
              <span className="font-medium">
                {t(stepTitleOf(step.id))}
                {indicator === "done" ? (
                  <span className="sr-only"> {t("desktop.firstRun.step.done")}</span>
                ) : null}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <StepBody {...props} id={step.id} />
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

/** 오프라인이면 쓰기 단추를 잠그고 이유를 Tooltip으로 보인다(시안 Write) */
function WriteGate(props: { readonly offline: boolean; readonly children: ReactNode }): ReactNode {
  if (!props.offline) return props.children;
  return (
    <Tooltip content={t("desktop.firstRun.offlineTip")}>
      <span className="inline-flex">{props.children}</span>
    </Tooltip>
  );
}

function StepBody(props: StepBodyProps & { readonly id: StepId }): ReactNode {
  switch (props.id) {
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
      return assertNever(props.id, "StepId");
  }
}

// ── 외부 도구 ────────────────────────────────────────────────────────────

function ToolsBody(props: StepBodyProps): ReactNode {
  const binaries = props.setup?.binaries ?? null;
  const offline = props.status === "offline";
  return (
    <div className="grid gap-2">
      {props.status === "loading" ? (
        <div className="grid gap-2 py-1" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={14} width={i % 2 === 0 ? "90%" : "70%"} />
          ))}
        </div>
      ) : null}
      {props.status === "ready" || offline ? (
        binaries === null ? (
          <p className="m-0 text-ui-sm text-text-tertiary">
            {offline
              ? t("desktop.firstRun.tools.offline")
              : t("desktop.settings.tools.unavailable")}
          </p>
        ) : (
          <ToolRows rows={binaries.rows} />
        )
      ) : null}
      {props.status === "ready" ? (
        <div>
          <Button
            size="xs"
            variant="outline"
            iconStart={<RotateCcw />}
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

function ToolRows(props: { readonly rows: BinaryView["rows"] }): ReactNode {
  const folded = props.rows.length > LONG_TOOLS;
  const required = props.rows.filter((row) => row.need === "required");
  const optional = props.rows.filter((row) => row.need !== "required");
  return (
    <>
      <ToolsTable rows={folded ? required : props.rows} />
      {folded && optional.length > 0 ? (
        <Accordion type="single" variant="ghost" size="sm">
          <AccordionItem value="optional">
            <AccordionTrigger>
              {t("desktop.firstRun.tools.optionalFold", { count: optional.length })}
            </AccordionTrigger>
            <AccordionContent>
              <ToolsTable rows={optional} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}
    </>
  );
}

function ToolsTable(props: { readonly rows: BinaryView["rows"] }): ReactNode {
  const columns: TableColumn[] = [
    { key: "tool", header: t("desktop.settings.tools.column.tool"), width: 88 },
    { key: "need", header: t("desktop.settings.tools.column.need"), width: 56 },
    { key: "status", header: t("desktop.settings.tools.column.status") },
    { key: "usedBy", header: t("desktop.settings.tools.column.usedBy") },
  ];
  const rows: TableRow[] = props.rows.map((row) => ({ id: row.name }));
  return (
    <Table
      variant="ghost"
      size="xs"
      radius="none"
      aria-label={t("desktop.firstRun.step.tools")}
      className="[&_[data-slot=table-grid]]:min-w-0 [&_td:first-child]:ps-0 [&_th:first-child]:ps-0 [&_th]:bg-transparent"
      columns={columns}
      rows={rows}
      renderCell={(row, column) => toolCellOf(props.rows, row.id, column.key)}
    />
  );
}

/** 도구 표의 한 칸. 막힌 도구는 필수면 빨강, 선택이면 노랑으로 보인다 */
function toolCellOf(rows: BinaryView["rows"], id: string, column: string): ReactNode {
  const row = rows.find((entry) => entry.name === id);
  if (row === undefined) return null;
  if (column === "tool") return <span className="font-mono text-mono-sm">{row.name}</span>;
  if (column === "need")
    return (
      <span className={row.need === "required" ? undefined : "text-text-tertiary"}>
        {t(
          row.need === "required"
            ? "desktop.settings.tools.need.required"
            : "desktop.settings.tools.need.optional",
        )}
      </span>
    );
  if (column === "status") return <ToolStatus row={row} />;
  if (column === "usedBy") return <span className="text-text-secondary">{row.usedBy}</span>;
  return null;
}

function ToolStatus(props: { readonly row: BinaryView["rows"][number] }): ReactNode {
  const { row } = props;
  if (row.ok) {
    return (
      <span className="text-text-secondary">
        {t("desktop.settings.tools.status.available")} ·{" "}
        <span className="font-mono text-mono-sm">{row.note}</span>
      </span>
    );
  }
  const tone = row.need === "required" ? "text-danger-text" : "text-warning-text";
  return (
    <span className={tone}>
      {t("desktop.settings.tools.status.unavailable")} ·{" "}
      <span className="font-mono text-mono-sm">{row.note}</span>
      {row.impact === "" ? null : ` · ${row.impact}`}
    </span>
  );
}

// ── 모델 키 ──────────────────────────────────────────────────────────────

function KeyBody(props: StepBodyProps & { readonly setup: SetupSnapshot }): ReactNode {
  const { setup, handlers, locked, keyEntry } = props;
  const offline = props.status === "offline";
  const view = keyViewOf(setup, props.providerInput);
  return (
    <div className="grid gap-2">
      {keyEntry.state === "failed" ? (
        <KeyFailure entry={keyEntry} onRetry={handlers.retryKey} />
      ) : null}
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={t(stepTitleOf("key"))}
        className={LIST}
      >
        <ListDescriptionRow term={t("desktop.firstRun.key.provider")}>
          <Input
            size="xs"
            aria-label={t("desktop.firstRun.key.provider")}
            list="first-run-provider-presets"
            value={props.providerInput}
            disabled={locked}
            onValueChange={handlers.provider}
            containerClassName="w-40"
            className="font-mono"
          />
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.settings.secretName.label")}>
          {view.secretName === null ? (
            <span className="text-text-tertiary">{t("desktop.firstRun.key.providerRule")}</span>
          ) : (
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <code className="font-mono text-mono-sm">{`secret://${view.secretName}`}</code>
              <Badge size="xs">
                {view.registered
                  ? t("desktop.settings.secret.registered")
                  : t("desktop.settings.secret.notRegistered")}
              </Badge>
              {view.linked ? (
                <span className="text-ui-xs text-text-tertiary">
                  {t("desktop.firstRun.key.linked")}
                </span>
              ) : null}
            </span>
          )}
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.firstRun.key.valueLabel")}>
          {keyEntry.state === "form" ? (
            <FirstRunKeyForm
              formRef={props.keyFormRef}
              busy={locked}
              onSubmit={handlers.submitKey}
              onCancel={handlers.cancelKey}
            />
          ) : (
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <WriteGate offline={offline}>
                <Button
                  size="sm"
                  variant="solid"
                  disabled={locked || view.secretName === null}
                  onClick={handlers.register}
                >
                  {view.registered
                    ? t("desktop.settings.key.change.button")
                    : t("desktop.settings.key.register.button")}
                </Button>
              </WriteGate>
              <WriteGate offline={offline}>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={locked || !view.registered || view.linked}
                  onClick={handlers.connect}
                >
                  {t("desktop.firstRun.key.connect")}
                </Button>
              </WriteGate>
              <Button size="sm" variant="ghost" disabled={locked} onClick={handlers.recheck}>
                {t("desktop.settings.recheck.button")}
              </Button>
            </span>
          )}
        </ListDescriptionRow>
      </ListDescription>
      <datalist id="first-run-provider-presets">
        {PRESET_PROVIDERS.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <p className="m-0 text-ui-xs text-text-tertiary">{t("desktop.firstRun.key.valueNote")}</p>
    </div>
  );
}

/**
 * 키 저장 실패 문장. 키체인 실패면 "다시 시도"와 "도움말 열기"가 붙는다. 도움말은 앱 안에서 한 문단을 펼친다.
 * 터미널 명령은 보이지 않고, 키를 파일에 두는 쪽으로 몰래 넘어가지 않는다.
 */
function KeyFailure(props: {
  readonly entry: Extract<FirstRunKeyEntry, { readonly state: "failed" }>;
  readonly onRetry: () => void;
}): ReactNode {
  const [helpOpen, setHelpOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const { entry } = props;
  return (
    <div className="grid gap-2">
      <Alert tone="danger" layout="inline" size="sm">
        {entry.text}
      </Alert>
      {entry.detail === undefined ? null : (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={detailOpen}
            onClick={() => {
              setDetailOpen((open) => !open);
            }}
          >
            {t("desktop.firstRun.key.details")}
          </Button>
          {detailOpen ? (
            <span className="font-mono text-mono-sm text-text-tertiary">{entry.detail}</span>
          ) : null}
        </span>
      )}
      {entry.keystore === undefined ? null : (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <Button size="sm" variant="solid" onClick={props.onRetry}>
            {t("desktop.firstRun.key.retry")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={helpOpen}
            onClick={() => {
              setHelpOpen((open) => !open);
            }}
          >
            {t("desktop.firstRun.key.help")}
          </Button>
        </span>
      )}
      {helpOpen ? (
        <p className="m-0 text-ui-xs text-text-tertiary">{t("desktop.firstRun.key.helpBody")}</p>
      ) : null}
    </div>
  );
}

/** 키 값 칸과 실패 문장(검색 권장 단계). 검색 플러그인 키는 providerId가 null이라 시크릿 이름을 먼저 보인다 */
function KeyEntryView(props: StepBodyProps): ReactNode {
  const { keyEntry, handlers, locked, keyFormRef } = props;
  if (keyEntry.state === "failed")
    return <KeyFailure entry={keyEntry} onRetry={handlers.retryKey} />;
  if (keyEntry.state !== "form") return null;
  return (
    <div className="grid gap-2">
      {keyEntry.providerId === null ? (
        <p className="m-0 text-ui-sm text-text-secondary">
          {t("desktop.settings.secretName.label")} <code>{keyEntry.name}</code>
        </p>
      ) : null}
      <FirstRunKeyForm
        formRef={keyFormRef}
        busy={locked}
        onSubmit={handlers.submitKey}
        onCancel={handlers.cancelKey}
      />
      <p className="m-0 text-ui-xs text-text-tertiary">{t("desktop.firstRun.key.valueNote")}</p>
    </div>
  );
}

// ── 기본 모델 ────────────────────────────────────────────────────────────

/** 모델 Combobox의 단추 글. 고른 모델의 이름, 아직 없으면 안내 문장이다 */
function modelTriggerContent(option: ComboboxOptionData | undefined): ReactNode {
  return (
    <span className="block w-56 min-w-0 truncate text-start">
      {option === undefined ? (
        <span className="text-text-tertiary">{t("desktop.firstRun.model.placeholder")}</span>
      ) : (
        option.label
      )}
    </span>
  );
}

function ModelBody(props: StepBodyProps & { readonly model: FirstRunModel }): ReactNode {
  const { model, handlers, locked } = props;
  const step = model.steps.find((entry) => entry.id === "model");
  const stepLocked = step?.locked === true;
  const groups: ComboboxGroupData[] = modelGroupsOf(props.modelChoices).map((group) => ({
    label: group.provider,
    options: group.options.map((option) => ({ value: option.value, label: option.label })),
  }));
  const chosen = modelInChoices(props.modelChoices, props.modelInput);
  const noList = props.modelChoices.length === 0;
  // 저장한 기본 모델이 목록에 없으면 그 사실을 문장으로 보인다(목록에서 다시 고른다)
  const missing = props.modelInput.trim() !== "" && !chosen && !noList;
  return (
    <div className="grid gap-2">
      {stepLocked ? (
        <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.firstRun.model.locked")}</p>
      ) : null}
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={t(stepTitleOf("model"))}
        className={LIST}
      >
        <ListDescriptionRow term={t(stepTitleOf("model"))}>
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <Combobox
              mode="popup"
              size="xs"
              aria-label={t("desktop.firstRun.model.label")}
              popupLabel={t("desktop.firstRun.model.label")}
              searchLabel={t("desktop.firstRun.model.label")}
              listLabel={t("desktop.firstRun.model.label")}
              groups={groups}
              popupWidth="lg"
              triggerContent={modelTriggerContent}
              {...(chosen ? { value: props.modelInput } : {})}
              disabled={locked || stepLocked || noList}
              emptyMessage={t("desktop.firstRun.model.empty")}
              onValueChange={handlers.model}
            />
            <WriteGate offline={props.status === "offline"}>
              <Button
                size="sm"
                variant="solid"
                disabled={locked || stepLocked || !chosen}
                onClick={handlers.saveModel}
              >
                {t("desktop.settings.save.button")}
              </Button>
            </WriteGate>
          </span>
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.firstRun.model.where")}>
          <span className="text-text-secondary">
            {t("desktop.firstRun.model.whereValue", { key: "l1.models.default" })}
          </span>
        </ListDescriptionRow>
      </ListDescription>
      {noList && !stepLocked ? (
        <p className="m-0 text-ui-xs text-text-tertiary">{t("desktop.firstRun.model.empty")}</p>
      ) : null}
      {missing ? (
        <p className="m-0 text-ui-xs text-danger-text">{t("desktop.firstRun.model.missing")}</p>
      ) : null}
    </div>
  );
}

// ── 웹 검색(선택) ────────────────────────────────────────────────────────

function SearchBody(props: StepBodyProps & { readonly model: FirstRunModel }): ReactNode {
  const { model, handlers, locked } = props;
  // 설치는 이 화면에서 할 수 없어서(`[gap:W-15]`) "설치 방법 보기" 단추는 안내 문장 한 줄을 펼친다
  const [installHelp, setInstallHelp] = useState(false);
  const search = model.search;
  if (search === null) {
    return (
      <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.firstRun.search.unknown")}</p>
    );
  }
  const current =
    search.provider === "auto" ? t("desktop.firstRun.search.builtin") : search.provider;
  const anyInstallHelp = search.recommendations.some((entry) => showsInstallHelp(entry.state));
  return (
    <div className="grid gap-2">
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={t("desktop.firstRun.search.recommended")}
        className={LIST}
      >
        <ListDescriptionRow term={t("desktop.firstRun.search.nowTerm")}>
          <span className="text-text-secondary">{current}</span>
        </ListDescriptionRow>
        {search.recommendations.map((entry) => {
          const secret = recommendSecretOf(entry);
          return (
            <ListDescriptionRow key={entry.providerId} term={entry.label}>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-ui-xs text-text-tertiary">
                  {t(
                    recommendStateOf(entry.state),
                    entry.state === "unavailable" ? { reason: entry.hint } : {},
                  )}
                </span>
                {showsInstallHelp(entry.state) ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-expanded={installHelp}
                    onClick={() => {
                      setInstallHelp((open) => !open);
                    }}
                  >
                    {t("desktop.firstRun.search.installHelp")}
                  </Button>
                ) : null}
                {entry.state === "needs-key" && secret !== null ? (
                  <WriteGate offline={props.status === "offline"}>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={locked}
                      onClick={() => {
                        handlers.registerSecret(secret);
                      }}
                    >
                      {t("desktop.settings.key.register.button")}
                    </Button>
                  </WriteGate>
                ) : null}
              </span>
            </ListDescriptionRow>
          );
        })}
      </ListDescription>
      <p className="m-0 text-ui-xs text-text-tertiary">{t("desktop.firstRun.search.cost")}</p>
      {installHelp && anyInstallHelp ? (
        <p className="m-0 text-ui-xs text-text-tertiary">
          {t("desktop.firstRun.search.installNote")}
        </p>
      ) : null}
      <KeyEntryView {...props} />
      {model.searchState === "pending" ? (
        <div>
          <Button size="xs" variant="ghost" disabled={locked} onClick={handlers.dismissSearch}>
            {t("desktop.firstRun.search.later")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ── 기본 그룹(선택) ──────────────────────────────────────────────────────

function GroupsBody(props: StepBodyProps & { readonly model: FirstRunModel }): ReactNode {
  const { model, handlers, locked } = props;
  const groups = model.groups;
  if (groups === null) {
    return (
      <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.firstRun.groups.unknown")}</p>
    );
  }
  return (
    <div className="grid gap-2">
      {groups.safeMode ? (
        <Alert tone="warning" layout="inline" size="sm">
          {t("desktop.firstRun.groups.safeMode")}
        </Alert>
      ) : null}
      <ul aria-label={t(stepTitleOf("groups"))} className="m-0 grid list-none gap-2.5 p-0">
        {groupRowsOf(groups).map((row) => (
          <GroupRowView key={row.id} row={row} locked={locked} onChange={handlers.setGroup} />
        ))}
      </ul>
      <div>
        <Button
          size="xs"
          variant="outline"
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
    <li className="flex items-start gap-2.5">
      {row.switchable ? (
        <Switch
          size="sm"
          aria-labelledby={nameId}
          checked={row.on}
          disabled={props.locked}
          className="mt-0.5"
          onCheckedChange={(on) => {
            props.onChange(row.id, on);
          }}
        />
      ) : (
        // review는 기본으로 꺼져 있고 이 화면에서 바꾸지 않는다: 잠긴 꺼짐 스위치로 보인다
        <Switch size="sm" aria-labelledby={nameId} checked={row.on} disabled className="mt-0.5" />
      )}
      <div className="grid min-w-0 gap-0.5">
        <span id={nameId} className="text-ui-sm font-medium text-text-primary">
          {t(groupNameOf(row.id))}
        </span>
        <span className="text-ui-sm text-text-secondary">{t(groupWhatOf(row.id))}</span>
      </div>
    </li>
  );
}
