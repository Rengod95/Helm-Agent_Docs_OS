import { t } from "@fresnel/client/i18n";
import type { KeyField } from "@fresnel/client/settings";
import type { SecretName, SecretApproval } from "@fresnel/contracts/capabilities";
import type { SecretReferencesResult } from "@fresnel/contracts/wire";
import {
  Alert,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  Field,
  Input,
  Select,
  SelectOption,
} from "@caustic/react";
import { TriangleAlert } from "@caustic/react/icons";
import { useRef, type ReactNode } from "react";
import type { EntryState, Load, MetaState } from "./secret-model.ts";
import type { MetaDraft } from "./secret-draft.ts";
import { approvalIdOf, commandErrorText } from "./secret-text.ts";
import { assertNever } from "@fresnel/contracts";

// 시크릿 화면의 대화 상자(P-10): 등록 창, 메타 고치기, 삭제 확인. 값 칸은 제어 컴포넌트가 아니다: 값은 DOM 노드에만 있고
// React 상태와 props에 들어가지 않는다. 저장을 누르면 부모가 `field.take()`로 읽는 즉시 비운다(설정 화면과 같은 규칙).

const APPROVALS: readonly SecretApproval[] = ["none", "per-session", "per-use"];

function approvalOf(value: string): SecretApproval | null {
  return APPROVALS.find((approval) => approval === value) ?? null;
}

// ── 등록 창 ─────────────────────────────────────────────────────────────

export interface EntryDialogProps {
  readonly entry: EntryState;
  readonly onName: (name: string) => void;
  readonly onNext: () => void;
  readonly onSubmitValue: (field: KeyField) => void;
  readonly onClose: () => void;
}

export function EntryDialog(props: EntryDialogProps): ReactNode {
  const { entry, onClose } = props;
  const open = entry.kind !== "closed";
  const title =
    entry.kind === "value" && entry.action === "set"
      ? t("desktop.secrets.entry.changeTitle", { name: entry.name })
      : t("desktop.secrets.entry.addTitle");
  return (
    <Dialog
      kind="dialog"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
    >
      {entry.kind === "name" ? (
        <NameStep
          name={entry.name}
          busy={entry.busy}
          error={entry.error}
          onName={props.onName}
          onNext={props.onNext}
          onCancel={onClose}
        />
      ) : null}
      {entry.kind === "value" ? (
        <ValueStep
          busy={entry.busy}
          error={entry.error}
          onSubmit={props.onSubmitValue}
          onCancel={onClose}
        />
      ) : null}
    </Dialog>
  );
}

function NameStep(props: {
  readonly name: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onName: (name: string) => void;
  readonly onNext: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        props.onNext();
      }}
    >
      <Field
        label={t("desktop.secrets.entry.nameLabel")}
        hint={t("desktop.secrets.entry.nameRule")}
        error={props.error}
      >
        <Input
          value={props.name}
          disabled={props.busy}
          autoComplete="off"
          spellCheck={false}
          onValueChange={props.onName}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.busy}
          onClick={props.onCancel}
        >
          {t("desktop.secrets.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={props.busy}>
          {t("desktop.secrets.entry.next")}
        </Button>
      </div>
    </form>
  );
}

/** 값 칸. 비제어 입력이라 값은 DOM에만 있고, 저장하면 `take()`가 읽는 즉시 비운다 */
function ValueStep(props: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: (field: KeyField) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const input = useRef<HTMLInputElement | null>(null);
  const clear = (): void => {
    if (input.current !== null) input.current.value = "";
  };
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit({
          take: () => {
            const typed = input.current?.value ?? "";
            clear();
            return typed;
          },
        });
      }}
    >
      <Field
        label={t("desktop.secrets.entry.valueLabel")}
        hint={t("desktop.secrets.entry.valueHint")}
      >
        <Input
          ref={input}
          type="password"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          defaultValue=""
          disabled={props.busy}
        />
      </Field>
      {props.error === null ? null : <Alert tone="danger">{props.error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.busy}
          onClick={() => {
            clear();
            props.onCancel();
          }}
        >
          {t("desktop.secrets.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={props.busy}>
          {t("desktop.secrets.entry.save")}
        </Button>
      </div>
    </form>
  );
}

// ── 메타 고치기 ──────────────────────────────────────────────────────────

export interface MetaDialogProps {
  readonly meta: MetaState;
  readonly onDraft: (draft: MetaDraft) => void;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
}

export function MetaDialog(props: MetaDialogProps): ReactNode {
  const { meta } = props;
  const open = meta.kind === "open";
  return (
    <Dialog
      kind="dialog"
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title={t("desktop.secrets.meta.title")}
    >
      {meta.kind === "open" ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!meta.busy) props.onSubmit();
          }}
        >
          <Field label={t("desktop.secrets.meta.desc")} error={meta.error}>
            <Input
              value={meta.draft.desc}
              disabled={meta.busy}
              onValueChange={(value) => {
                props.onDraft({ ...meta.draft, desc: value });
              }}
            />
          </Field>
          <Field label={t("desktop.secrets.meta.hosts")} hint={t("desktop.secrets.meta.hostsHint")}>
            <Input
              value={meta.draft.hosts}
              disabled={meta.busy}
              spellCheck={false}
              onValueChange={(value) => {
                props.onDraft({ ...meta.draft, hosts: value });
              }}
            />
          </Field>
          <Field
            label={t("desktop.secrets.meta.expiresAt")}
            hint={t("desktop.secrets.meta.expiresHint")}
          >
            <Input
              value={meta.draft.expiresAt}
              placeholder="YYYY-MM-DD"
              disabled={meta.busy}
              spellCheck={false}
              onValueChange={(value) => {
                props.onDraft({ ...meta.draft, expiresAt: value });
              }}
            />
          </Field>
          <Field label={t("desktop.secrets.meta.approval")}>
            <Select
              value={meta.draft.approval}
              disabled={meta.busy}
              onValueChange={(value) => {
                const approval = approvalOf(value);
                if (approval !== null) props.onDraft({ ...meta.draft, approval });
              }}
            >
              {APPROVALS.map((approval) => (
                <SelectOption key={approval} value={approval}>
                  {t(approvalIdOf(approval))}
                </SelectOption>
              ))}
            </Select>
          </Field>
          <Field label={t("desktop.secrets.meta.ttlSeconds")}>
            <Input
              inputMode="numeric"
              value={meta.draft.ttlSeconds}
              disabled={meta.busy}
              onValueChange={(value) => {
                props.onDraft({ ...meta.draft, ttlSeconds: value });
              }}
            />
          </Field>
          <Field label={t("desktop.secrets.meta.maxUses")}>
            <Input
              inputMode="numeric"
              value={meta.draft.maxUses}
              disabled={meta.busy}
              onValueChange={(value) => {
                props.onDraft({ ...meta.draft, maxUses: value });
              }}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={meta.busy}
              onClick={props.onClose}
            >
              {t("desktop.secrets.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={meta.busy}>
              {t("desktop.secrets.meta.save")}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}

// ── 삭제 확인 ───────────────────────────────────────────────────────────

/** 쓰는 곳이 있으면 지울 수 없다. 설정 키나 활성 임대가 있으면 쓰는 중이다 */
function inUseOf(refs: SecretReferencesResult): boolean {
  return refs.settingKeys.length > 0 || refs.activeLeases > 0;
}

export interface RemoveDialogProps {
  readonly open: boolean;
  readonly name: SecretName | null;
  readonly refs: Load<SecretReferencesResult>;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

export function RemoveDialog(props: RemoveDialogProps): ReactNode {
  const { open, name, refs, busy } = props;
  const inUse = refs.kind === "ready" && inUseOf(refs.value);
  const canConfirm = refs.kind === "ready" && !inUse && !busy;
  return (
    <Dialog
      kind="alert"
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      icon={<TriangleAlert />}
      title={t("desktop.secrets.delete.title")}
      description={t("desktop.secrets.delete.body", { name: name ?? "" })}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t("desktop.secrets.delete.keep")}
            </Button>
          </DialogClose>
          {canConfirm ? (
            <DialogAction
              onClick={() => {
                props.onConfirm();
              }}
            >
              {t("desktop.secrets.delete.confirm")}
            </DialogAction>
          ) : null}
        </>
      }
    >
      <RemoveStatus refs={refs} inUse={inUse} />
    </Dialog>
  );
}

function RemoveStatus(props: {
  readonly refs: Load<SecretReferencesResult>;
  readonly inUse: boolean;
}): ReactNode {
  const { refs, inUse } = props;
  switch (refs.kind) {
    case "idle":
    case "loading":
      return (
        <p role="status" className="text-ui-sm text-text-tertiary">
          {t("desktop.secrets.delete.checking")}
        </p>
      );
    case "failed": {
      const failure = commandErrorText(refs.error);
      return (
        <p role="alert" className="text-ui-sm text-danger-text">
          {t(failure.id, failure.args)}
        </p>
      );
    }
    case "ready":
      return inUse ? (
        <p role="alert" className="text-ui-sm text-danger-text">
          {t("desktop.secrets.delete.inUse")}
        </p>
      ) : null;
    default:
      return assertNever(refs, "Load");
  }
}
