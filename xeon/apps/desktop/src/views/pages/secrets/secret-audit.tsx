import { t, type Locale } from "@fresnel/client/i18n";
import type { SecretAuditEntry, SecretAuditResult } from "@fresnel/contracts/wire";
import { assertNever } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { Badge, Button } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import { useThread } from "../../../state/engine/index.ts";
import type { Load } from "./secret-model.ts";
import { auditModeIdOf, auditReasonIdOf, commandErrorText, lastUsedTextOf } from "./secret-text.ts";

// 시크릿 사용 기록(P-10, W-13 `secret.audit`). 언제, 어느 대화가, 어떤 모습으로 썼는지와 거절 사유를 보인다. 값은 와이어에 없다.
// 행 사이에 선을 긋지 않고 간격으로 나눈다(DP-26). 기록 개수 상한은 없으므로 처음 PAGE_SIZE개만 그리고 "더 보기"로 늘린다.
// 대화 칸은 id가 아니라 제목이다. 제목은 엔진 거울(thread.list)에서 찾는다. 목록에 없으면 id의 앞뒤 몇 글자를 보인다.

/** 한 번에 그리는 행 수 */
const AUDIT_PAGE_SIZE = 50;

/** 목록에 없는 대화의 id를 줄여 보인다(앞 머리와 끝 여섯 글자) */
function shortThreadIdOf(threadId: ThreadId): string {
  return `${threadId.slice(0, 4)}…${threadId.slice(-6)}`;
}

/** 행의 key. 같은 시각·같은 내용의 행이 있으면 뒤에 몇 번째인지를 붙인다 */
function keysOf(entries: readonly SecretAuditEntry[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const base = `${entry.at}|${entry.decision}|${entry.mode}|${entry.toolCallId ?? ""}|${entry.host ?? ""}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return `${base}|${count}`;
  });
}

/**
 * 한 줄의 "대화" 칸. 제목이 있으면 제목, 제목이 없으면 "제목 없음", 목록에 없으면 줄인 id다.
 * 대화가 없으면(예약, 터미널 실행) 문장으로 쓴다
 */
function ThreadCell(props: { readonly threadId: ThreadId }): ReactNode {
  const thread = useThread(props.threadId);
  if (thread === undefined) {
    return (
      <span className="font-mono text-mono-sm text-text-tertiary">
        {shortThreadIdOf(props.threadId)}
      </span>
    );
  }
  return <span className="text-text-primary">{thread.title ?? t("desktop.threads.untitled")}</span>;
}

function AuditRow(props: {
  readonly entry: SecretAuditEntry;
  readonly nowMs: number;
  readonly locale: Locale;
}): ReactNode {
  const { entry, nowMs, locale } = props;
  const relative = lastUsedTextOf(entry.at, nowMs, locale);
  const denied = entry.decision === "deny";
  return (
    <li className="grid grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-baseline gap-3 py-1">
      <time dateTime={entry.at} title={entry.at} className="tabular-nums text-text-tertiary">
        {relative ?? entry.at}
      </time>
      <span className="min-w-0 truncate">
        {entry.threadId === null ? (
          <span className="text-text-tertiary">{t("desktop.secrets.audit.noThread")}</span>
        ) : (
          <ThreadCell threadId={entry.threadId} />
        )}
      </span>
      <span className="min-w-0 truncate text-text-secondary">
        {entry.host === null
          ? t(auditModeIdOf(entry.mode))
          : `${t(auditModeIdOf(entry.mode))} · ${entry.host}`}
      </span>
      {denied ? (
        <span className="flex items-baseline gap-2">
          {entry.reason === null ? null : (
            <span className="text-ui-xs text-text-tertiary">
              {t(auditReasonIdOf(entry.reason))}
            </span>
          )}
          <Badge size="xs" className="bg-danger-soft text-danger-text">
            {t("desktop.secrets.audit.denied")}
          </Badge>
        </span>
      ) : (
        <span className="text-ui-xs text-text-tertiary">{t("desktop.secrets.audit.used")}</span>
      )}
    </li>
  );
}

function AuditRows(props: {
  readonly result: SecretAuditResult;
  readonly nowMs: number;
  readonly locale: Locale;
}): ReactNode {
  const { result, nowMs, locale } = props;
  const [shown, setShown] = useState(AUDIT_PAGE_SIZE);
  if (result.entries.length === 0) {
    return <p className="text-ui-sm text-text-tertiary">{t("desktop.secrets.audit.empty")}</p>;
  }
  const rest = result.entries.length - shown;
  const keys = keysOf(result.entries);
  return (
    <>
      <ul
        aria-label={t("desktop.secrets.audit.label")}
        className="m-0 grid list-none gap-0.5 p-0 text-ui-sm"
      >
        {result.entries.slice(0, shown).map((entry, index) => (
          <AuditRow key={keys[index] ?? entry.at} entry={entry} nowMs={nowMs} locale={locale} />
        ))}
      </ul>
      {rest > 0 ? (
        <div>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setShown(shown + AUDIT_PAGE_SIZE);
            }}
          >
            {t("desktop.secrets.audit.more", { count: rest })}
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function UsageLog(props: {
  readonly audit: Load<SecretAuditResult>;
  readonly nowMs: number;
  readonly locale: Locale;
}): ReactNode {
  const { audit, nowMs, locale } = props;
  if (audit.kind === "idle") return null;
  return (
    <section aria-label={t("desktop.secrets.audit.label")} className="grid gap-1">
      <h3 className="m-0 flex h-7 items-center gap-2 text-ui-sm font-semibold text-text-secondary">
        {t("desktop.secrets.audit.label")}
        <InfoTip text={t("desktop.secrets.audit.info")} />
      </h3>
      <AuditBody audit={audit} nowMs={nowMs} locale={locale} />
    </section>
  );
}

function AuditBody(props: {
  readonly audit: Exclude<Load<SecretAuditResult>, { readonly kind: "idle" }>;
  readonly nowMs: number;
  readonly locale: Locale;
}): ReactNode {
  const { audit, nowMs, locale } = props;
  switch (audit.kind) {
    case "loading":
      return (
        <p role="status" className="text-ui-sm text-text-tertiary">
          {t("desktop.secrets.audit.loading")}
        </p>
      );
    case "failed": {
      const text = commandErrorText(audit.error);
      return (
        <p role="alert" className="text-ui-sm text-danger-text">
          {t(text.id, text.args)}
        </p>
      );
    }
    case "ready":
      return <AuditRows result={audit.value} nowMs={nowMs} locale={locale} />;
    default:
      return assertNever(audit, "Load");
  }
}
