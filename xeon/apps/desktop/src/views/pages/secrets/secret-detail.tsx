import { t, type Locale } from "@fresnel/client/i18n";
import { REVEAL_VISIBLE_MS } from "@fresnel/client/settings";
import type {
  SecretListEntry,
  SecretReferencesResult,
  SecretTestResult,
} from "@fresnel/contracts/wire";
import { assertNever } from "@fresnel/contracts";
import {
  Badge,
  Button,
  ListDescription,
  ListDescriptionRow,
  Menu,
  MenuItem,
  MenuSeparator,
  Progress,
} from "@caustic/react";
import { CircleCheck, Ellipsis } from "@caustic/react/icons";
import { useId, useState, type ReactNode, type RefObject } from "react";
import type { DetailState, Load } from "./secret-model.ts";
import { UsageLog } from "./secret-audit.tsx";
import type { RevealView } from "./secret-reveal.ts";
import {
  approvalIdOf,
  commandErrorText,
  revealFailureText,
  type MessageRef,
} from "./secret-text.ts";

// 고른 시크릿의 상세(P-10). 이름 줄의 동작, 메타 목록, 값 칸, 시험 한 줄, 사용 기록을 그린다(mockup `detail.tsx`).
// 참조는 "참조 보기" 메뉴 뒤에 접혀 있다. 값 칸은 `reveal`과 `shownText`로만 그린다:
// `shownText`는 값이 보일 때 화면이 만든 글자이고, 상태나 뷰 모델에 들어가지 않는다.

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
  readonly sectionRef: RefObject<HTMLElement | null>;
  readonly handlers: SecretDetailHandlers;
}

const NONE = (): string => t("desktop.secrets.none");

const ROWS_CLASS =
  "rounded-none [--cs-size-list-term:7rem] [&_[data-slot=list-description-row]]:px-0";

export function SecretDetail(props: SecretDetailProps): ReactNode {
  const { entry, detail, acting, locale, nowMs, handlers, sectionRef } = props;
  const headingId = useId();
  // 참조는 기본으로 접혀 있다. 고른 시크릿이 바뀌면 화면이 이 상세를 새로 그린다(key)
  const [refsOpen, setRefsOpen] = useState(false);
  const hosts = entry.meta?.use.hosts ?? [];
  const approval = entry.meta === undefined ? NONE() : t(approvalIdOf(entry.meta.approval));
  return (
    <section
      aria-labelledby={headingId}
      ref={sectionRef}
      tabIndex={-1}
      className="grid min-w-0 gap-1 outline-none"
    >
      <div className="flex min-h-8 items-center gap-2">
        <h2
          id={headingId}
          className="m-0 min-w-0 flex-1 truncate font-mono text-mono text-text-primary"
        >
          {entry.name}
        </h2>
        <div className="flex flex-none items-center gap-0.5">
          <Button
            size="xs"

            variant="ghost"
            disabled={!acting}
            onClick={handlers.changeValue}
          >
            {t("desktop.secrets.changeValue")}
          </Button>
          <Button
            size="xs"

            variant="ghost"
            disabled={!acting || entry.meta === undefined}
            onClick={handlers.editMeta}
          >
            {t("desktop.secrets.meta.button")}
          </Button>
          <Button
            size="xs"

            variant="ghost"
            disabled={!acting}
            onClick={handlers.test}
          >
            {t("desktop.secrets.test.button")}
          </Button>
          <Menu
            align="end"
            aria-label={t("desktop.secrets.detail.menu", { name: entry.name })}
            trigger={
              <Button
                size="xs"

                variant="ghost"
                disabled={!acting}
                aria-label={t("desktop.secrets.detail.more", { name: entry.name })}
              >
                <Ellipsis />
              </Button>
            }
          >
            <MenuItem
              onSelect={() => {
                setRefsOpen(true);
              }}
            >
              {t("desktop.secrets.refs.show")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem tone="danger" onSelect={handlers.askRemove}>
              {t("desktop.secrets.delete.button")}
            </MenuItem>
          </Menu>
        </div>
      </div>
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={t("desktop.secrets.detail.label")}
        className={ROWS_CLASS}
      >
        <ListDescriptionRow term={t("desktop.secrets.value")}>
          <ValueCell {...props} />
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.secrets.detail.description")}>
          {entry.meta?.desc ?? NONE()}
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.secrets.columns.hosts")} mono>
          {hosts.length === 0 ? NONE() : hosts.join(", ")}
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.secrets.meta.approval")}>
          {approval}
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.secrets.columns.expiry")}>
          <ExpiryText entry={entry} />
        </ListDescriptionRow>
      </ListDescription>
      {refsOpen ? <RefsLine refs={detail.refs} /> : null}
      <UsageLog audit={detail.audit} nowMs={nowMs} locale={locale} />
      <TestLine test={detail.test} />
    </section>
  );
}

/** 만료일. 임박과 만료는 배지로 알리고, 없으면 "없음"이다 */
function ExpiryText(props: { readonly entry: SecretListEntry }): ReactNode {
  const { entry } = props;
  const expires = entry.meta?.expiresAt ?? NONE();
  if (entry.status === "expiring") {
    return (
      <Badge size="sm" className="bg-warning-soft text-warning-text">
        {expires}
      </Badge>
    );
  }
  if (entry.status === "expired") {
    return (
      <Badge size="sm" className="bg-danger-soft text-danger-text">
        {expires}
      </Badge>
    );
  }
  return expires;
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
        <Button size="xs" variant="ghost" onClick={handlers.hide}>
          {t("desktop.secrets.reveal.hideNow")}
        </Button>
      </span>
    );
  }

  if (own?.status === "revealed") {
    const share = Math.round((own.remainingSec / (REVEAL_VISIBLE_MS / 1000)) * 100);
    return (
      <span className="grid min-w-0 gap-1.5 py-1">
        <span className="break-all font-mono text-mono text-text-primary">{shownText ?? ""}</span>
        <span className="flex flex-wrap items-center gap-1">
          <Button size="xs" variant="outline" onClick={handlers.copy}>
            {t("desktop.secrets.reveal.copy")}
          </Button>
          <Button size="xs" variant="ghost" onClick={handlers.hide}>
            {t("desktop.secrets.reveal.hideNow")}
          </Button>
          <span className="ms-2 flex items-center gap-2">
            <Progress
              value={share}
              size="sm"
              label={t("desktop.secrets.reveal.progress")}
              className="w-28"
            />
            <span role="status" className="text-ui-sm tabular-nums text-text-tertiary">
              {t("desktop.secrets.reveal.countdown", { seconds: own.remainingSec })}
            </span>
          </span>
        </span>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span aria-hidden="true" className="font-mono text-mono tracking-[0.1em] text-text-tertiary">
        ••••••••••••
      </span>
      <span className="sr-only">{t("desktop.secrets.value.hidden")}</span>
      <Button
        size="xs"

        variant="outline"
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
        <p role="status" className="m-0 text-ui-sm text-text-tertiary">
          {t("desktop.secrets.refs.loading")}
        </p>
      );
    case "failed":
      return (
        <p role="alert" className="m-0 text-ui-sm text-danger-text">
          <MessageText text={commandErrorText(refs.error)} />
        </p>
      );
    case "ready":
      return (
        <ListDescription
          variant="ghost"
          size="xs"
          aria-label={t("desktop.secrets.refs.label")}
          className={ROWS_CLASS}
        >
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

/** 시험 결과는 한 줄이다: 풀 수 있었는지만 보인다. 길이와 해시 앞부분은 보이지 않는다 */
function TestLine(props: { readonly test: Load<SecretTestResult> }): ReactNode {
  const { test } = props;
  switch (test.kind) {
    case "idle":
      return null;
    case "loading":
      return (
        <p role="status" className="m-0 text-ui-sm text-text-tertiary">
          {t("desktop.secrets.test.running")}
        </p>
      );
    case "failed":
      return (
        <p role="alert" className="m-0 text-ui-sm text-danger-text">
          <MessageText text={commandErrorText(test.error)} />
        </p>
      );
    case "ready": {
      const decryptable = test.value.decryptable;
      return (
        <p
          role="status"
          className="m-0 flex items-center gap-1.5 pt-1 text-ui-sm text-text-secondary"
        >
          {decryptable ? (
            <CircleCheck aria-hidden className="size-icon-sm text-success-text" />
          ) : null}
          {t("desktop.secrets.test.label")}:{" "}
          {t(
            decryptable
              ? "desktop.secrets.test.decryptable"
              : "desktop.secrets.test.notDecryptable",
          )}
        </p>
      );
    }
    default:
      return assertNever(test, "Load");
  }
}
