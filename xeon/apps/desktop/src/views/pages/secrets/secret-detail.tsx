import { t, type Locale } from "@fresnel/client/i18n";
import { REVEAL_VISIBLE_MS } from "@fresnel/client/settings";
import type {
  SecretListEntry,
  SecretReferencesResult,
  SecretTestResult,
} from "@fresnel/contracts/wire";
import { assertNever } from "@fresnel/contracts";
import { Badge, Button, Card, ListDescription, ListDescriptionRow, Progress } from "@caustic/react";
import { Copy, Eye, EyeOff, FlaskConical, KeyRound, Pencil, Trash2 } from "@caustic/react/icons";
import { useId, type ReactNode, type RefObject } from "react";
import type { DetailState, Load } from "./secret-model.ts";
import { UsageLog } from "./secret-audit.tsx";
import type { RevealView } from "./secret-reveal.ts";
import {
  commandErrorText,
  lastUsedTextOf,
  revealFailureText,
  statusViewOf,
  type MessageRef,
  type StatusTone,
} from "./secret-text.ts";

// 고른 시크릿의 상세(P-10). 메타, 참조, 시험 결과, 값 보기, 동작 버튼을 그린다. 값 칸은 `reveal`과 `shownText`로만 그린다:
// `shownText`는 값이 보일 때 화면이 만든 글자이고, 상태나 뷰 모델에 들어가지 않는다.

/** 배지 색. caustic `Badge`의 `tone` 대신 같은 색 토큰을 유틸리티로 입힌다. 색만으로 뜻을 주지 않는다(글자가 따로 있다) */
export const TONE_CLASS: Readonly<Record<StatusTone, string>> = {
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
  neutral: "bg-neutral-track text-text-secondary",
};

/** 상세의 동작. 화면 조정자가 채운다 */
export interface SecretDetailHandlers {
  readonly reveal: () => void;
  readonly hide: () => void;
  readonly copy: () => void;
  readonly changeValue: () => void;
  readonly editMeta: () => void;
  readonly test: () => void;
  readonly askRemove: () => void;
}

export interface SecretDetailProps {
  readonly entry: SecretListEntry;
  readonly detail: DetailState;
  readonly reveal: RevealView;
  /** 값이 지금 보일 때만 그 글자. 상태에는 없다 */
  readonly shownText: string | null;
  readonly revealAvailable: boolean;
  readonly acting: boolean;
  readonly nowMs: number;
  readonly locale: Locale;
  readonly sectionRef: RefObject<HTMLDivElement | null>;
  readonly handlers: SecretDetailHandlers;
}

const NONE = (): string => t("desktop.secrets.none");

export function SecretDetail(props: SecretDetailProps): ReactNode {
  const { entry, detail, acting, locale, nowMs, handlers, sectionRef } = props;
  const headingId = useId();
  const status = statusViewOf(entry.status);
  const lastUsed = lastUsedTextOf(entry.lastUsedAt, nowMs, locale);
  const hosts = entry.meta?.use.hosts ?? [];
  return (
    <Card
      role="region"
      aria-labelledby={headingId}
      size="sm"
      tabIndex={-1}
      ref={sectionRef}
      className="grid min-w-0 gap-3 outline-none"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="min-w-0 break-all text-ui-strong text-text-primary">
          <code>{entry.name}</code>
        </h2>
        <Badge className={TONE_CLASS[status.tone]}>{t(status.label.id, status.label.args)}</Badge>
      </header>
      <ListDescription aria-label={t("desktop.secrets.detail.label")}>
        <ListDescriptionRow term={t("desktop.secrets.detail.description")}>
          {entry.meta?.desc ?? NONE()}
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.secrets.columns.provider")}>
          {entry.meta?.provider ?? NONE()}
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.secrets.columns.hosts")}>
          {hosts.length === 0 ? NONE() : hosts.join(", ")}
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.secrets.columns.lastUsed")}>
          {lastUsed ?? NONE()}
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.secrets.columns.expiry")}>
          {entry.meta?.expiresAt ?? NONE()}
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.secrets.value")}>
          <ValueCell {...props} />
        </ListDescriptionRow>
      </ListDescription>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          iconStart={<KeyRound />}
          disabled={!acting}
          onClick={handlers.changeValue}
        >
          {t("desktop.secrets.changeValue")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          iconStart={<Pencil />}
          disabled={!acting || entry.meta === undefined}
          onClick={handlers.editMeta}
        >
          {t("desktop.secrets.meta.button")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          iconStart={<FlaskConical />}
          disabled={!acting}
          onClick={handlers.test}
        >
          {t("desktop.secrets.test.button")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-danger-text"
          iconStart={<Trash2 />}
          disabled={!acting}
          onClick={handlers.askRemove}
        >
          {t("desktop.secrets.delete.button")}
        </Button>
      </div>
      <RefsLine refs={detail.refs} />
      <UsageLog audit={detail.audit} nowMs={nowMs} locale={locale} />
      <TestLine test={detail.test} />
    </Card>
  );
}

/** 값 칸. 이름이 다른 시크릿의 값 보기 상태는 이 칸과 상관없다 */
function ValueCell(props: SecretDetailProps): ReactNode {
  const { entry, reveal, shownText, revealAvailable, acting, handlers } = props;
  const own = reveal.status !== "hidden" && reveal.name === entry.name ? reveal : null;
  const canReveal = acting && revealAvailable && own?.status !== "reauth";

  if (own?.status === "reauth") {
    return <span role="status">{t("desktop.secrets.reveal.reauth")}</span>;
  }

  if (own?.status === "revealed" && own.hostShown) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span>{t("desktop.secrets.reveal.hostShown")}</span>
        <Button size="xs" variant="ghost" iconStart={<EyeOff />} onClick={handlers.hide}>
          {t("desktop.secrets.reveal.hideNow")}
        </Button>
      </span>
    );
  }

  if (own?.status === "revealed") {
    const share = Math.round((own.remainingSec / (REVEAL_VISIBLE_MS / 1000)) * 100);
    return (
      <span className="grid min-w-0 gap-2">
        <code className="break-all font-mono text-text-primary">{shownText ?? ""}</code>
        <span className="flex flex-wrap items-center gap-2">
          <Progress value={share} label={t("desktop.secrets.reveal.progress")} className="w-32" />
          <span role="status" className="text-ui-sm text-text-tertiary">
            {t("desktop.secrets.reveal.countdown", { seconds: own.remainingSec })}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Button size="xs" variant="outline" iconStart={<Copy />} onClick={handlers.copy}>
            {t("desktop.secrets.reveal.copy")}
          </Button>
          <Button size="xs" variant="ghost" iconStart={<EyeOff />} onClick={handlers.hide}>
            {t("desktop.secrets.reveal.hideNow")}
          </Button>
        </span>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span aria-hidden="true" className="tracking-widest text-text-tertiary">
        ••••••••
      </span>
      <span className="sr-only">{t("desktop.secrets.value.hidden")}</span>
      <Button
        size="xs"
        variant="outline"
        iconStart={<Eye />}
        disabled={!canReveal}
        onClick={handlers.reveal}
      >
        {t("desktop.secrets.reveal.button")}
      </Button>
      {own?.status === "failed" ? (
        <span role="alert" className="text-ui-sm text-danger-text">
          <MessageText text={revealFailureText(own.failure)} />
        </span>
      ) : null}
      {revealAvailable ? null : (
        <span className="text-ui-sm text-text-tertiary">
          {t("desktop.secrets.reveal.unavailable")}
        </span>
      )}
    </span>
  );
}

/** 메시지 참조를 글자로 그린다. 인자가 없으면 인자 객체도 비어 있다 */
function MessageText(props: { readonly text: MessageRef }): ReactNode {
  return t(props.text.id, props.text.args);
}

function RefsLine(props: { readonly refs: Load<SecretReferencesResult> }): ReactNode {
  const { refs } = props;
  switch (refs.kind) {
    case "idle":
      return null;
    case "loading":
      return (
        <p role="status" className="text-ui-sm text-text-tertiary">
          {t("desktop.secrets.refs.loading")}
        </p>
      );
    case "failed":
      return (
        <p role="alert" className="text-ui-sm text-danger-text">
          <MessageText text={commandErrorText(refs.error)} />
        </p>
      );
    case "ready":
      return (
        <ListDescription aria-label={t("desktop.secrets.refs.label")}>
          <ListDescriptionRow term={t("desktop.secrets.refs.settingKeys")}>
            {refs.value.settingKeys.length === 0 ? NONE() : refs.value.settingKeys.join(", ")}
          </ListDescriptionRow>
          <ListDescriptionRow term={t("desktop.secrets.refs.leases")}>
            {String(refs.value.activeLeases)}
          </ListDescriptionRow>
          <ListDescriptionRow term={t("desktop.secrets.refs.sessions")}>
            {refs.value.sessions.length === 0 ? NONE() : String(refs.value.sessions.length)}
          </ListDescriptionRow>
        </ListDescription>
      );
    default:
      return assertNever(refs, "Load");
  }
}

function TestLine(props: { readonly test: Load<SecretTestResult> }): ReactNode {
  const { test } = props;
  switch (test.kind) {
    case "idle":
      return null;
    case "loading":
      return (
        <p role="status" className="text-ui-sm text-text-tertiary">
          {t("desktop.secrets.test.running")}
        </p>
      );
    case "failed":
      return (
        <p role="alert" className="text-ui-sm text-danger-text">
          <MessageText text={commandErrorText(test.error)} />
        </p>
      );
    case "ready": {
      const result = test.value;
      return (
        <ListDescription aria-label={t("desktop.secrets.test.label")}>
          <ListDescriptionRow term={t("desktop.secrets.test.state")}>
            {t(
              result.state === "registered"
                ? "desktop.secrets.test.registered"
                : "desktop.secrets.test.missing",
            )}
          </ListDescriptionRow>
          <ListDescriptionRow term={t("desktop.secrets.test.decrypt")}>
            {t(
              result.decryptable
                ? "desktop.secrets.test.decryptable"
                : "desktop.secrets.test.notDecryptable",
            )}
          </ListDescriptionRow>
          <ListDescriptionRow term={t("desktop.secrets.test.length")}>
            {result.length === null
              ? NONE()
              : t("desktop.secrets.test.lengthValue", { length: result.length })}
          </ListDescriptionRow>
          <ListDescriptionRow term={t("desktop.secrets.test.sha")}>
            {result.sha256Prefix ?? NONE()}
          </ListDescriptionRow>
        </ListDescription>
      );
    }
    default:
      return assertNever(test, "Load");
  }
}
