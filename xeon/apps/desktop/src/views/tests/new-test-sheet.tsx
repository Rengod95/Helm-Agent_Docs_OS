// 새 시험 시트(O-12, §6.31). 종류(Test run, replay, benchmark, 보호 경로 검사, 켬/끔 비교), 대상, 옵션을 받는다.
// 시안(c01-trials parts/sheets.tsx): 종류는 라디오 묶음이고, 개발 모드에서만 열리는 종류는 배포 앱에서 잠기며 "개발 모드에서만" 배지를 단다.
// 입력 검사와 잠김은 `@fresnel/client/workbench`의 `submitPlanOf`가 정하고, 여기는 그 결과를 그린다.
import { t } from "@fresnel/client/i18n";
import {
  draftErrorsOf,
  newTestItemOf,
  newTestItemsOf,
  NEW_TEST_KINDS,
  submitPlanOf,
  type NewTestDraft,
  type NewTestField,
  type NewTestKind,
} from "@fresnel/client/workbench";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  Field,
  Input,
  RadioGroup,
  RadioGroupItem,
  Sheet,
  Textarea,
} from "@caustic/react";
import { Lock } from "@caustic/react/icons";
import type { ExtTestRunParams } from "@fresnel/contracts/wire";
import { useId, useState, type ReactNode } from "react";
import { InfoTip } from "../craft/info-tip.tsx";
import { NEW_KIND_TEXT, newTestErrorTextOf } from "./tests-text.ts";

/** 화면에 보일 입력 오류. 칸을 건드렸거나(바꾸거나 벗어남) 보내기를 눌렀을 때만 보인다. 처음 열었을 때는 빨간 오류가 없다 */
export function visibleErrorsOf<E extends { readonly field: NewTestField }>(
  errors: readonly E[],
  touched: readonly NewTestField[],
  submitted: boolean,
): readonly E[] {
  return submitted ? errors : errors.filter((error) => touched.includes(error.field));
}

const MUTED = "m-0 text-ui text-text-tertiary";

export interface NewTestHandlers {
  readonly change: (draft: NewTestDraft) => void;
  readonly submit: () => void;
  readonly close: () => void;
}

export interface NewTestSheetProps {
  /** 시트 입력. null이면 닫혀 있다 */
  readonly draft: NewTestDraft | null;
  readonly devMode: boolean;
  readonly sending: boolean;
  /** 대상으로 고를 수 있는 확장 이름(`ext.list`). 읽지 못했으면 빈 목록 */
  readonly targetNames: readonly string[];
  /** 시작이 실패했을 때의 이유 글. 시트가 화면 알림을 가리므로 시트 안에도 보인다. 없으면 null */
  readonly failure: string | null;
  readonly handlers: NewTestHandlers;
}

export function NewTestSheet(props: NewTestSheetProps): ReactNode {
  const { draft, devMode, sending, targetNames, failure, handlers } = props;
  const formId = useId();
  const plan = draft === null ? null : submitPlanOf(draft, devMode);
  // 입력이 모자란 채로도 누를 수 있다: 누르면 빠진 칸의 오류가 보인다. 잠김과 미연결 종류만 막는다
  const canStart = plan !== null && (plan.kind === "run" || plan.kind === "invalid");
  return (
    <Sheet
      size="sm"
      open={draft !== null}
      onOpenChange={(open) => {
        if (!open) handlers.close();
      }}
      title={t("desktop.tests.newTest")}
      footer={
        draft === null ? null : (
          <>
            <Button variant="ghost" size="sm" disabled={sending} onClick={handlers.close}>
              {t("desktop.tests.sheet.close")}
            </Button>
            <Button
              type="submit"
              form={formId}

              variant="solid"
              size="sm"
              loading={sending}
              disabled={!canStart}
            >
              {t("desktop.tests.sheet.start")}
            </Button>
          </>
        )
      }
    >
      {draft === null ? null : (
        <NewTestForm
          id={formId}
          draft={draft}
          devMode={devMode}
          targetNames={targetNames}
          failure={failure}
          onChange={handlers.change}
          onSubmit={handlers.submit}
        />
      )}
    </Sheet>
  );
}

function kindOf(value: string): NewTestKind | null {
  return NEW_TEST_KINDS.find((kind) => kind === value) ?? null;
}

/** 시트의 입력 칸. 서버 렌더 시험이 이 부품을 직접 그린다 */
export function NewTestForm(props: {
  readonly id: string;
  readonly draft: NewTestDraft;
  readonly devMode: boolean;
  /** 대상으로 고를 수 있는 확장 이름. 빈 목록이면 고르기 줄을 그리지 않는다 */
  readonly targetNames?: readonly string[];
  /** 시작이 실패한 이유. 있으면 맨 위에 경고로 보인다 */
  readonly failure?: string | null;
  readonly onChange: (draft: NewTestDraft) => void;
  readonly onSubmit: () => void;
}): ReactNode {
  const { draft, devMode, onChange } = props;
  const targetNames = props.targetNames ?? [];
  const items = newTestItemsOf(devMode);
  const current = newTestItemOf(draft.kind, devMode);
  const [touched, setTouched] = useState<readonly NewTestField[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const errors = visibleErrorsOf(draftErrorsOf(draft), touched, submitted);
  const touch = (field: NewTestField): void => {
    setTouched((prev) => (prev.includes(field) ? prev : [...prev, field]));
  };
  const errorOf = (field: NewTestField): string | undefined => {
    const found = errors.find((error) => error.field === field);
    return found === undefined ? undefined : t(newTestErrorTextOf(found));
  };
  return (
    <form
      id={props.id}
      noValidate
      className="grid min-w-0 gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (draftErrorsOf(draft).length > 0) {
          setSubmitted(true);
          return;
        }
        props.onSubmit();
      }}
    >
      {props.failure === undefined || props.failure === null ? null : (
        <Alert tone="danger" size="sm">
          {props.failure}
        </Alert>
      )}
      <Field label={t("desktop.tests.sheet.kind")} group>
        <RadioGroup
          size="sm"
          value={draft.kind}
          onValueChange={(value) => {
            const kind = kindOf(value);
            if (kind !== null) onChange({ ...draft, kind });
          }}
          className="gap-0"
        >
          {items.map((item) => (
            <RadioGroupItem key={item.kind} value={item.kind} disabled={item.lock !== null}>
              <span className="flex min-w-0 items-center gap-2 py-1">
                <span className="min-w-0 flex-1 text-ui-dense text-text-primary">
                  {t(NEW_KIND_TEXT[item.kind])}
                </span>
                {item.lock === "devMode" ? (
                  <Badge size="xs" variant="soft" icon={<Lock />}>
                    {t("desktop.tests.lock.devMode")}
                  </Badge>
                ) : null}
              </span>
            </RadioGroupItem>
          ))}
        </RadioGroup>
      </Field>
      {items.some((item) => item.lock === "isolation") ? (
        <p className={MUTED}>{t("desktop.tests.lock.isolation")}</p>
      ) : null}
      {current.lock === null && !current.startable ? (
        <Alert tone="info">{t("desktop.tests.lock.unwired")}</Alert>
      ) : null}
      <Field label={t("desktop.tests.sheet.target")} error={errorOf("target")}>
        <div className="flex items-center gap-1.5">
          <Input
            size="xs"
            spellCheck={false}
            value={draft.target}
            className="font-mono"
            containerClassName="min-w-0 flex-1"
            onValueChange={(value) => {
              touch("target");
              onChange({ ...draft, target: value });
            }}
            onBlur={() => {
              touch("target");
            }}
          />
          <InfoTip text={t("desktop.tests.sheet.targetHint")} />
        </div>
        {draft.kind === "testRun" && targetNames.length > 0 ? (
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
            <span className={MUTED}>{t("desktop.tests.sheet.targetPick")}</span>
            {targetNames.map((name) => (
              <Button
                key={name}
                size="xs"
                variant={draft.target === name ? "soft" : "outline"}
                className="font-mono"
                onClick={() => {
                  touch("target");
                  onChange({ ...draft, target: name });
                }}
              >
                {name}
              </Button>
            ))}
          </div>
        ) : null}
      </Field>
      {draft.kind === "testRun" ? (
        <Field label={t("desktop.tests.sheet.prompt")} error={errorOf("prompt")}>
          <div className="flex items-start gap-1.5">
            <Textarea
              size="xs"
              rows={4}
              value={draft.prompt}
              className="resize-none"
              containerClassName="min-w-0 flex-1"
              onChange={(event) => {
                touch("prompt");
                onChange({ ...draft, prompt: event.currentTarget.value });
              }}
              onBlur={() => {
                touch("prompt");
              }}
            />
            <InfoTip text={t("desktop.tests.sheet.promptHint")} />
          </div>
        </Field>
      ) : null}
      {draft.kind === "replay" ? (
        <Field label={t("desktop.tests.sheet.maxCommits")} error={errorOf("maxCommits")}>
          <Input
            size="xs"
            inputMode="numeric"
            value={draft.maxCommits}
            containerClassName="w-36"
            onValueChange={(value) => {
              touch("maxCommits");
              onChange({ ...draft, maxCommits: value });
            }}
            onBlur={() => {
              touch("maxCommits");
            }}
          />
        </Field>
      ) : null}
      {draft.kind === "benchmark" ? (
        <Field label={t("desktop.tests.sheet.runs")} error={errorOf("runs")}>
          <Input
            size="xs"
            inputMode="numeric"
            value={draft.runs}
            containerClassName="w-36"
            onValueChange={(value) => {
              touch("runs");
              onChange({ ...draft, runs: value });
            }}
            onBlur={() => {
              touch("runs");
            }}
          />
        </Field>
      ) : null}
    </form>
  );
}

/** 비용이 드는 시험을 시작하기 전의 확인(§6.26). 예상 실행 수는 wire가 주지 않아 글로만 묻는다 */
export function RunConfirmDialog(props: {
  readonly params: ExtTestRunParams | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  return (
    <Dialog
      kind="alert"
      open={props.params !== null}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={t("desktop.tests.confirm.title")}
      description={t("desktop.tests.confirm.body")}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.tests.confirm.cancel")}
            </Button>
          </DialogClose>
          <DialogAction onClick={props.onConfirm}>{t("desktop.tests.confirm.start")}</DialogAction>
        </>
      }
    />
  );
}
