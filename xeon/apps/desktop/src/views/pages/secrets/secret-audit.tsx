import { t, type Locale } from "@fresnel/client/i18n";
import type { SecretAuditEntry, SecretAuditResult } from "@fresnel/contracts/wire";
import { assertNever } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { Badge, Button, Dialog } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { FORM_CONTROL_SIZE } from "../settings/settings-section.tsx";
import { useThread } from "../../../state/engine/index.ts";
import type { Load } from "./secret-model.ts";
import { auditModeIdOf, auditReasonIdOf, commandErrorText, lastUsedTextOf } from "./secret-text.ts";

// 시크릿 사용 기록(P-10, W-13 `secret.audit`). 언제, 어느 대화가, 어떤 모습으로 썼는지와 거절 사유를 보인다. 값은 와이어에 없다.
// 상세 시트에는 최근 다섯 줄과 "모두 보기"만 두고, 전체 기록은 대화 상자에서 PAGE_SIZE씩 "더 보기"로 늘린다(DP-85).
// 줄은 시각 · 대화(아래 모습·호스트) · 결과 두 줄 모양이고 줄 사이에 옅은 선이 있다.
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
  const how =
    entry.host === null
      ? t(auditModeIdOf(entry.mode))
      : `${t(auditModeIdOf(entry.mode))} · ${entry.host}`;
  return (
    <li
      data-slot="audit-row"
      className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-start gap-3 py-1.5"
    >
      <time
        dateTime={entry.at}
        title={entry.at}
        className="pt-px text-ui-sm text-text-tertiary tabular-nums"
      >
        {relative ?? entry.at}
      </time>
      <span className="grid min-w-0">
        <span className="min-w-0 truncate text-ui">
          {entry.threadId === null ? (
            <span className="text-text-secondary">{t("desktop.secrets.audit.noThread")}</span>
          ) : (
            <ThreadCell threadId={entry.threadId} />
          )}
        </span>
        <span className="min-w-0 truncate text-ui-sm text-text-tertiary">{how}</span>
      </span>
      {denied ? (
        <span className="flex items-center gap-1.5">
          {entry.reason === null ? null : (
            <span className="text-ui-sm text-text-tertiary">
              {t(auditReasonIdOf(entry.reason))}
            </span>
          )}
          <Badge size="sm" className="bg-danger-soft text-danger-text">
            {t("desktop.secrets.audit.denied")}
          </Badge>
        </span>
      ) : (
        <span className="pt-px text-ui-sm text-text-tertiary">
          {t("desktop.secrets.audit.used")}
        </span>
      )}
    </li>
  );
}

/** 기록 줄들. `limit`가 있으면 앞 몇 줄만 그리고 나머지는 "모두 보기"가 연다. 없으면 PAGE_SIZE씩 "더 보기" */
function AuditRows(props: {
  readonly result: SecretAuditResult;
  readonly nowMs: number;
  readonly locale: Locale;
  readonly limit?: number | undefined;
  readonly onShowAll?: (() => void) | undefined;
}): ReactNode {
  const { result, nowMs, locale } = props;
  const [shown, setShown] = useState(props.limit ?? AUDIT_PAGE_SIZE);
  if (result.entries.length === 0) {
    return <p className="m-0 text-ui text-text-tertiary">{t("desktop.secrets.audit.empty")}</p>;
  }
  const rest = result.entries.length - shown;
  const keys = keysOf(result.entries);
  return (
    <div className="grid gap-1">
      <ul
        aria-label={t("desktop.secrets.audit.label")}
        className="m-0 grid list-none divide-y divide-border-subtle p-0"
      >
        {result.entries.slice(0, shown).map((entry, index) => (
          <AuditRow key={keys[index] ?? entry.at} entry={entry} nowMs={nowMs} locale={locale} />
        ))}
      </ul>
      {rest > 0 ? (
        <div>
          <Button
            size={FORM_CONTROL_SIZE}
            variant="ghost"
            className="-ms-2"
            onClick={() => {
              if (props.limit !== undefined && props.onShowAll !== undefined) props.onShowAll();
              else setShown(shown + AUDIT_PAGE_SIZE);
            }}
          >
            {props.limit !== undefined
              ? t("desktop.secrets.audit.showAll", { count: result.entries.length })
              : t("desktop.secrets.audit.more", { count: rest })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** 상세 시트 안의 "최근 사용": 다섯 줄과 "모두 보기"(전체 기록 대화 상자) */
export function UsageLog(props: {
  readonly audit: Load<SecretAuditResult>;
  readonly nowMs: number;
  readonly locale: Locale;
  /** 앞 몇 줄만 보인다. 없으면 전부(더 보기로) */
  readonly limit?: number | undefined;
  readonly onShowAll?: (() => void) | undefined;
}): ReactNode {
  const { audit, nowMs, locale } = props;
  if (audit.kind === "idle") return null;
  switch (audit.kind) {
    case "loading":
      return (
        <p role="status" className="m-0 text-ui text-text-tertiary">
          {t("desktop.secrets.audit.loading")}
        </p>
      );
    case "failed": {
      const text = commandErrorText(audit.error);
      return (
        <p role="alert" className="m-0 text-ui text-danger-text">
          {t(text.id, text.args)}
        </p>
      );
    }
    case "ready":
      return (
        <AuditRows
          result={audit.value}
          nowMs={nowMs}
          locale={locale}
          limit={props.limit}
          onShowAll={props.onShowAll}
        />
      );
    default:
      return assertNever(audit, "Load");
  }
}

/** 전체 사용 기록 대화 상자 */
export function UsageLogDialog(props: {
  readonly open: boolean;
  readonly name: string;
  readonly audit: Load<SecretAuditResult>;
  readonly nowMs: number;
  readonly locale: Locale;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <Dialog
      kind="dialog"
      size="lg"
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title={t("desktop.secrets.audit.allTitle", { name: props.name })}
      description={t("desktop.secrets.audit.info")}
    >
      <UsageLog audit={props.audit} nowMs={props.nowMs} locale={props.locale} />
    </Dialog>
  );
}
