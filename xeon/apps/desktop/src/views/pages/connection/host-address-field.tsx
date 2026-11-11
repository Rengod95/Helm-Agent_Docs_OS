import { Button, Field, Input, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import type { TargetAddressReason } from "@fresnel/client";
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { useState, type ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import { addressMessageOf } from "./connection-text.ts";
import {
  composeFields,
  fieldsOfAddress,
  HOST_KINDS,
  hostKindOf,
  suggestLabel,
  switchKind,
  type HostFieldError,
  type HostFieldKey,
  type HostFields,
  type HostFormValue,
  type HostKind,
  type SshFields,
  type TcpFields,
  type UnixFields,
  type WssFields,
} from "./host-address.ts";

// 추가 칸의 그림. 위에서 아래로: 전체 주소를 붙이는 칸, 연결 방식 고르기, 방식별 칸, 이름, 저장될 주소 미리보기,
// 추가·취소 단추다. 상태는 props로만 받는다: 칸이 바뀌면 `onChange`로 새 값을 주고, 저장은 `onSubmit`(Enter 포함),
// 취소는 `onCancel`이다. 오류는 `checkHostForm`이 준 칸별 목록을 그 칸 아래에 보인다.

/** 칸 아래 오류와 힌트는 13px로 올린다(caustic 기본은 11.5px) */
const FIELD_TEXT =
  "[&_[data-slot=field-error]]:text-ui [&_[data-slot=field-hint]]:text-ui [&_[data-slot=field-optional-mark]]:text-ui [&_[data-slot=field-required-mark]]:text-ui";

const KIND_LABEL: Readonly<Record<HostKind, MessageId>> = {
  ssh: "desktop.connection.host.kind.ssh",
  wss: "desktop.connection.host.kind.wss",
  unix: "desktop.connection.host.kind.unix",
  tcp: "desktop.connection.host.kind.tcp",
};

/** 칸마다 빈 값과 형식 오류의 문장. 칸 밖의 주소 사유는 `addressMessageOf`를 쓴다 */
const ERROR_IDS: Readonly<
  Record<HostFieldKey, { readonly empty: MessageId; readonly badFormat: MessageId }>
> = {
  user: {
    empty: "desktop.connection.address.empty",
    badFormat: "desktop.connection.host.error.user.badFormat",
  },
  host: {
    empty: "desktop.connection.host.error.host.empty",
    badFormat: "desktop.connection.host.error.host.badFormat",
  },
  port: {
    empty: "desktop.connection.host.error.port.empty",
    badFormat: "desktop.connection.host.error.port.badFormat",
  },
  socket: {
    empty: "desktop.connection.host.error.socket.empty",
    badFormat: "desktop.connection.host.error.socket.badFormat",
  },
  path: {
    empty: "desktop.connection.host.error.socket.empty",
    badFormat: "desktop.connection.host.error.socket.badFormat",
  },
  address: {
    empty: "desktop.connection.host.error.web.empty",
    badFormat: "desktop.connection.host.error.web.badFormat",
  },
  pin: {
    empty: "desktop.connection.address.empty",
    badFormat: "desktop.connection.host.error.pin.badFormat",
  },
  target: {
    empty: "desktop.connection.address.empty",
    badFormat: "desktop.connection.address.badFormat",
  },
};

/** 칸 오류 하나의 문장 키 */
function messageOf(error: HostFieldError): MessageId {
  const ids = ERROR_IDS[error.field];
  switch (error.reason) {
    case "empty":
      return ids.empty;
    case "bad_format":
    case "bad_fingerprint":
      return ids.badFormat;
    case "relative_path":
    case "non_loopback":
    case "duplicate":
      return addressMessageOf(error.reason);
    default:
      return assertNever(error.reason, "HostReason");
  }
}

export interface HostAddressFieldProps {
  /** 지금 칸의 값: 이름과 방식·칸 */
  readonly value: HostFormValue;
  /** 칸이 바뀔 때마다 새 값을 준다. 방식을 바꾸면 칸은 그 방식의 빈 칸이다 */
  readonly onChange: (next: HostFormValue) => void;
  /** `checkHostForm`이 준 오류. 칸 이름이 맞는 오류를 그 칸 아래에 보이고, 칸 밖의 오류는 미리보기 아래에 보인다 */
  readonly errors: readonly HostFieldError[];
  /** 저장 중이면 칸과 취소를 잠그고 추가 단추에 진행 표시를 단다 */
  readonly busy: boolean;
  /** 추가 단추와 Enter(폼 제출)가 부른다 */
  readonly onSubmit: () => void;
  /** 취소 단추가 부른다 */
  readonly onCancel: () => void;
}

interface RowsProps<F> {
  readonly fields: F;
  readonly onFields: (next: F) => void;
  readonly errorOf: (field: HostFieldKey) => string | undefined;
  readonly busy: boolean;
}

/** 칸 옆에 설명 아이콘 하나를 둔다 */
function WithInfo(props: { readonly text: string; readonly children: ReactNode }): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 flex-1">{props.children}</span>
      <InfoTip text={props.text} />
    </span>
  );
}

function SshRows({ fields, onFields, errorOf, busy }: RowsProps<SshFields>): ReactNode {
  return (
    <div className="grid gap-4">
      {/* 사용자 · 호스트 · 포트를 주소 모양 그대로 한 줄에 둔다(좁으면 세 줄) */}
      <div className="@container">
        <div className="grid gap-4 @[30rem]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_6rem]">
          <Field
            label={t("desktop.connection.host.field.user")}
            optional
            optionalLabel={t("desktop.connection.host.optional")}
            error={errorOf("user")}
            disabled={busy}
            className={FIELD_TEXT}
          >
            <Input
              className="font-mono"
              value={fields.user}
              placeholder={t("desktop.connection.host.placeholder.user")}
              autoComplete="off"
              spellCheck={false}
              onValueChange={(user) => {
                onFields({ ...fields, user });
              }}
            />
          </Field>
          <Field
            label={t("desktop.connection.host.field.host")}
            required
            error={errorOf("host")}
            disabled={busy}
            className={FIELD_TEXT}
          >
            <Input
              className="font-mono"
              value={fields.host}
              autoComplete="off"
              spellCheck={false}
              onValueChange={(host) => {
                onFields({ ...fields, host });
              }}
            />
          </Field>
          <Field
            label={t("desktop.connection.host.field.port")}
            optional
            optionalLabel={t("desktop.connection.host.optional")}
            error={errorOf("port")}
            disabled={busy}
            className={FIELD_TEXT}
          >
            <Input
              className="font-mono"
              value={fields.port}
              placeholder="22"
              inputMode="numeric"
              autoComplete="off"
              onValueChange={(port) => {
                onFields({ ...fields, port });
              }}
            />
          </Field>
        </div>
      </div>
      <Field
        label={t("desktop.connection.host.field.socket")}
        required
        error={errorOf("socket")}
        disabled={busy}
        className={FIELD_TEXT}
      >
        <WithInfo text={t("desktop.connection.host.info.socket")}>
          <Input
            className="font-mono"
            value={fields.socket}
            autoComplete="off"
            spellCheck={false}
            onValueChange={(socket) => {
              onFields({ ...fields, socket });
            }}
          />
        </WithInfo>
      </Field>
    </div>
  );
}

function WssRows({ fields, onFields, errorOf, busy }: RowsProps<WssFields>): ReactNode {
  return (
    <div className="grid gap-4">
      <Field
        label={t("desktop.connection.host.field.web")}
        required
        error={errorOf("address")}
        disabled={busy}
        className={FIELD_TEXT}
      >
        <WithInfo text={t("desktop.connection.host.info.web")}>
          <Input
            className="font-mono"
            value={fields.address}
            placeholder="example.com:8443"
            autoComplete="off"
            spellCheck={false}
            onValueChange={(address) => {
              onFields({ ...fields, address });
            }}
          />
        </WithInfo>
      </Field>
      <Field
        label={t("desktop.connection.host.field.pin")}
        optional
        optionalLabel={t("desktop.connection.host.optional")}
        error={errorOf("pin")}
        disabled={busy}
        className={FIELD_TEXT}
      >
        <WithInfo text={t("desktop.connection.host.info.pin")}>
          <Input
            className="font-mono"
            value={fields.pin}
            autoComplete="off"
            spellCheck={false}
            onValueChange={(pin) => {
              onFields({ ...fields, pin });
            }}
          />
        </WithInfo>
      </Field>
    </div>
  );
}

function UnixRows({ fields, onFields, errorOf, busy }: RowsProps<UnixFields>): ReactNode {
  return (
    <div className="grid gap-4">
      <Field
        label={t("desktop.connection.host.field.socket")}
        required
        error={errorOf("path")}
        disabled={busy}
        className={FIELD_TEXT}
      >
        <WithInfo text={t("desktop.connection.host.info.socket")}>
          <Input
            className="font-mono"
            value={fields.path}
            autoComplete="off"
            spellCheck={false}
            onValueChange={(path) => {
              onFields({ ...fields, path });
            }}
          />
        </WithInfo>
      </Field>
    </div>
  );
}

function TcpRows({ fields, onFields, errorOf, busy }: RowsProps<TcpFields>): ReactNode {
  return (
    <div className="grid gap-4">
      <Field
        label={t("desktop.connection.host.field.port")}
        required
        error={errorOf("port")}
        disabled={busy}
        className={FIELD_TEXT}
      >
        <WithInfo text={t("desktop.connection.host.info.tcp")}>
          <Input
            className="font-mono"
            value={fields.port}
            inputMode="numeric"
            autoComplete="off"
            onValueChange={(port) => {
              onFields({ ...fields, port });
            }}
          />
        </WithInfo>
      </Field>
    </div>
  );
}

/** 방식별 칸. 방식이 칸의 짝을 정하므로 각 줄은 자기 칸만 받는다 */
function kindRowsOf(
  fields: HostFields,
  setFields: (next: HostFields) => void,
  errorOf: (field: HostFieldKey) => string | undefined,
  busy: boolean,
): ReactNode {
  switch (fields.kind) {
    case "ssh":
      return (
        <SshRows
          fields={fields}
          onFields={(next) => {
            setFields({ kind: "ssh", ...next });
          }}
          errorOf={errorOf}
          busy={busy}
        />
      );
    case "wss":
      return (
        <WssRows
          fields={fields}
          onFields={(next) => {
            setFields({ kind: "wss", ...next });
          }}
          errorOf={errorOf}
          busy={busy}
        />
      );
    case "unix":
      return (
        <UnixRows
          fields={fields}
          onFields={(next) => {
            setFields({ kind: "unix", ...next });
          }}
          errorOf={errorOf}
          busy={busy}
        />
      );
    case "tcp":
      return (
        <TcpRows
          fields={fields}
          onFields={(next) => {
            setFields({ kind: "tcp", ...next });
          }}
          errorOf={errorOf}
          busy={busy}
        />
      );
    default:
      return assertNever(fields, "HostFields");
  }
}

export function HostAddressField(props: HostAddressFieldProps): ReactNode {
  const { value, onChange, errors, busy, onSubmit, onCancel } = props;
  const [pasteText, setPasteText] = useState("");
  const [pasteReason, setPasteReason] = useState<TargetAddressReason | null>(null);
  const { fields } = value;
  const errorOf = (field: HostFieldKey): string | undefined => {
    const found = errors.find((error) => error.field === field);
    return found === undefined ? undefined : t(messageOf(found));
  };
  const setFields = (next: HostFields): void => {
    onChange({ ...value, fields: next });
  };
  const preview = composeFields(fields);
  const targetError = errorOf("target");
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Field
        label={t("desktop.connection.host.paste.label")}
        error={pasteReason === null ? undefined : t(addressMessageOf(pasteReason))}
        disabled={busy}
        className={FIELD_TEXT}
      >
        <WithInfo text={t("desktop.connection.host.paste.info")}>
          <Input
            className="font-mono"
            value={pasteText}
            placeholder={t("desktop.connection.host.paste.placeholder")}
            autoComplete="off"
            spellCheck={false}
            onValueChange={(text) => {
              setPasteText(text);
              setPasteReason(null);
              if (text.trim() === "") return;
              const parsed = fieldsOfAddress(text);
              if (parsed.ok) onChange({ ...value, fields: parsed.fields });
            }}
            onBlur={() => {
              if (pasteText.trim() === "") return;
              const parsed = fieldsOfAddress(pasteText);
              if (!parsed.ok) setPasteReason(parsed.reason);
            }}
          />
        </WithInfo>
      </Field>

      <div className="grid gap-1.5">
        <span className="text-ui-strong text-text-secondary">
          {t("desktop.connection.host.kind.label")}
        </span>
        <SegmentedControl
          size="lg"
          className="flex w-full"
          aria-label={t("desktop.connection.host.kind.label")}
          value={fields.kind}
          disabled={busy}
          onValueChange={(next) => {
            const kind = hostKindOf(next);
            if (kind !== undefined) onChange(switchKind(value, kind));
          }}
        >
          {HOST_KINDS.map((kind) => (
            <SegmentedControlItem key={kind} value={kind} className="flex-1">
              {t(KIND_LABEL[kind])}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>

      {kindRowsOf(fields, setFields, errorOf, busy)}

      <Field
        label={t("desktop.connection.form.label")}
        optional
        optionalLabel={t("desktop.connection.host.optional")}
        disabled={busy}
        className={FIELD_TEXT}
      >
        <Input
          value={value.label}
          placeholder={suggestLabel(fields.kind, fields)}
          autoComplete="off"
          onValueChange={(label) => {
            onChange({ ...value, label });
          }}
        />
      </Field>

      <div className="grid gap-1.5">
        <span className="text-ui-strong text-text-secondary">
          {t("desktop.connection.host.preview.label")}
        </span>
        <p
          aria-live="polite"
          className="min-w-0 rounded-lg bg-bg-inset px-3 py-2 font-mono text-ui break-all text-text-primary shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
        >
          {preview === "" ? (
            <span className="font-ui text-text-tertiary">
              {t("desktop.connection.host.preview.empty")}
            </span>
          ) : (
            preview
          )}
        </p>
        {targetError === undefined ? null : (
          <span role="alert" className="text-ui text-danger-text">
            {targetError}
          </span>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          {t("desktop.connection.form.discard")}
        </Button>
        <Button type="submit" variant="solid" size="sm" loading={busy}>
          {t("desktop.connection.host.add")}
        </Button>
      </div>
    </form>
  );
}
