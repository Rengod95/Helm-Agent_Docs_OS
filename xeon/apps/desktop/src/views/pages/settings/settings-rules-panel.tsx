import { Badge, Input, Switch } from "@caustic/react";
import { Lock, LockOpen, MessageCircleQuestion, SquarePen } from "@caustic/react/icons";
import { t, type MessageId } from "@fresnel/client/i18n";
import type { FieldVM, SettingsView } from "@fresnel/client/settings";
import type { SettingKey } from "@fresnel/contracts/settings";
import type { PolicyEffect, PolicyRule } from "@fresnel/contracts/services";
import { useState, type ComponentType, type ReactNode } from "react";
import { isCommitEnter } from "../../ime-enter.ts";
import { RadioCardGroup, RadioCardItem } from "../shared/radio-card.tsx";
import {
  VerdictTable,
  type Verdict,
  type VerdictExample,
  type VerdictRow,
} from "../shared/verdict-table.tsx";
import { UnreadableEditorNote } from "./settings-editors-view.tsx";
import {
  FieldRow,
  SavedMark,
  type DedicatedEditors,
  type FieldHandlers,
} from "./settings-field.tsx";
import { optionHelpOf, optionLabelOf, optionOf, optionTextOf } from "./settings-model.ts";
import {
  conflictsOf,
  partnersOf,
  patternTextOf,
  ruleListOf,
  ruleOfPattern,
  ruleSummaryOf,
  withEffect,
  withMemo,
  withoutRule,
  type AddIssue,
} from "./settings-rules-model.ts";
import {
  WEB_POLICY_KEYS,
  changedVerdictsOf,
  checkNewDomain,
  domainRowsOf,
  withDomainVerdict,
  type DomainAddIssue,
  type DomainLists,
} from "./settings-rules-web.ts";
import { textListOf } from "./settings-sandbox-model.ts";
import { RowNote, SettingSection } from "./settings-section.tsx";
import { shownFieldsOf } from "./settings-sections.ts";

// 설정 "권한" 구역의 패널(DP-109 [결정: 2026-11-11 사용자]). 구역 표(`settings-sections.ts`)의 패널 자리마다 하나씩 들어간다.
//   권한 모드    선택 카드 2×2(연결의 실행 방식과 같은 `RadioCardGroup`). "모두 허용"의 허락(관리 설정 `bypassAllowed`)은 그 카드에
//               딸린 조건 줄로 격자 아래 오른쪽 열에 붙는다.
//   권한 규칙    판정 표(`VerdictTable`): 도구·패턴 · 판정 · 메모. 추가 줄과 빈 상태 예시 칩. 판정·메모·추가·지우기는 바로 저장한다.
//   승인        무인 실행·계획 두 작은 카드를 두 열로(넓은 화면에서 이름표와 조작부가 멀어지지 않게).
//   웹 접근      판정 표(도메인 · 판정) + 이어지는 카드에 사설망 허용·대화에 없던 URL.
// 쓰기는 모두 사용자 범위이고 `handlers.change`(고치고 바로 저장)다. 편집기처럼 초안 줄이 따로 뜨지 않는다.

export interface PermissionPanelProps {
  readonly view: SettingsView;
  readonly live: boolean;
  readonly saved: ReadonlySet<SettingKey>;
  readonly editors: DedicatedEditors;
  readonly handlers: FieldHandlers;
}

/** 패널이 쓰는 항목 하나. 화면에 없는 키(정의가 아직 없는 엔진)는 `undefined` */
export function fieldOf(view: SettingsView, key: SettingKey): FieldVM | undefined {
  return shownFieldsOf(view.tabs).get(key);
}

/** 항목을 지금 고칠 수 있는가: 쓸 수 있고, 잠기지 않았고, 엔진 항목이면 연결이 살아 있다 */
export function editableOf(field: FieldVM, live: boolean): boolean {
  return field.editable && field.lock === null && (live || field.origin === "desktop");
}

/** 구역 머리 끝의 "저장됨". 키 가운데 하나라도 방금 저장됐으면 보인다 */
export function savedEndOf(saved: ReadonlySet<SettingKey>, keys: readonly SettingKey[]): ReactNode {
  return keys.some((key) => saved.has(key)) ? <SavedMark /> : undefined;
}

interface FieldNote {
  readonly key: string;
  readonly tone: "danger" | "warning";
  readonly text: string;
}

/** 항목 저장 오류나 잠금을 표 아래 한 줄로. 없으면 그리지 않는다 */
export function FieldNotes(props: {
  readonly fields: readonly (FieldVM | undefined)[];
}): ReactNode {
  const notes = props.fields.flatMap((field): readonly FieldNote[] => {
    if (field === undefined) return [];
    if (field.error !== null)
      return [{ key: field.key, tone: "danger", text: field.error.message }];
    if (field.lock !== null) return [{ key: field.key, tone: "warning", text: field.lock.text }];
    return [];
  });
  if (notes.length === 0) return null;
  return (
    <div className="grid gap-1 pt-2">
      {notes.map((note) => (
        <RowNote key={note.key} tone={note.tone}>
          {note.text}
        </RowNote>
      ))}
    </div>
  );
}

export function verdictLabelOf(verdict: Verdict): string {
  return t(VERDICT_ID[verdict]);
}

const VERDICT_ID: Readonly<Record<Verdict, MessageId>> = {
  allow: "desktop.settings.verdict.allow",
  ask: "desktop.settings.verdict.ask",
  deny: "desktop.settings.verdict.deny",
};

// ── 권한 모드 ─────────────────────────────────────────────────────────────

const MODE_KEY: SettingKey = "l1.tools.permissionMode";
const BYPASS_KEY: SettingKey = "l1.tools.bypassAllowed";

const MODE_ICON: Readonly<Record<string, ComponentType>> = {
  default: MessageCircleQuestion,
  acceptEdits: SquarePen,
  bypass: LockOpen,
};

function ModeIcon(props: { readonly mode: string }): ReactNode {
  const Icon = MODE_ICON[props.mode];
  return Icon === undefined ? null : <Icon />;
}

export function PermissionModePanel(props: PermissionPanelProps): ReactNode {
  const field = fieldOf(props.view, MODE_KEY);
  if (field === undefined || field.widget.kind !== "select") return null;
  const options = field.widget.options;
  const bypass = fieldOf(props.view, BYPASS_KEY);
  // 허락 항목이 없거나(옛 엔진) 참이면 "모두 허용"을 고를 수 있다. 지금 값이 이미 우회면 막지 않는다(그 카드가 고른 채로 보인다)
  const bypassAllowed = bypass === undefined || bypass.value !== false;
  const current = typeof field.value === "string" ? field.value : "";
  const editable = editableOf(field, props.live);
  return (
    <SettingSection
      title={t("desktop.settings.perm.mode.title")}
      body="bare"
      end={savedEndOf(props.saved, [MODE_KEY, BYPASS_KEY])}
    >
      <div data-slot="permission-mode" className="grid gap-2">
        <RadioCardGroup
          columns={2}
          label={field.label}
          value={current}
          disabled={!editable}
          onValueChange={(next) => {
            const option = optionOf(options, next);
            if (option !== null) props.handlers.change(field.key, option);
          }}
        >
          {options.map((option) => {
            const text = optionTextOf(option);
            const blocked = text === "bypass" && !bypassAllowed && current !== "bypass";
            return (
              <RadioCardItem
                key={text}
                value={text}
                icon={<ModeIcon mode={text} />}
                title={optionLabelOf(field.key, option)}
                description={
                  blocked
                    ? t("desktop.settings.perm.mode.bypassBlocked")
                    : (optionHelpOf(field.key, option) ?? "")
                }
                disabled={blocked}
              />
            );
          })}
        </RadioCardGroup>
        {bypass === undefined ? null : (
          <BypassCondition field={bypass} live={props.live} handlers={props.handlers} />
        )}
        <FieldNotes fields={[field]} />
      </div>
    </SettingSection>
  );
}

/**
 * "모두 허용"의 허락 조건. 격자의 오른쪽 열(넓을 때 "모두 허용" 카드 아래)에 붙는 한 줄이다. 관리 설정에서만 바뀌는 값이라 보통
 * 잠금 아이콘과 상태 글뿐이고, 사용자가 고칠 수 있는 환경이면 같은 자리에 스위치가 선다.
 */
function BypassCondition(props: {
  readonly field: FieldVM;
  readonly live: boolean;
  readonly handlers: FieldHandlers;
}): ReactNode {
  const { field } = props;
  const on = field.value !== false;
  const editable = editableOf(field, props.live);
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-2.5 @[32rem]:grid-cols-2">
        <div
          data-slot="bypass-condition"
          className="flex min-h-7 items-center gap-1.5 text-ui-sm text-text-tertiary @[32rem]:col-start-2"
        >
          {editable ? (
            <Switch
              size="sm"
              aria-label={t("desktop.settings.perm.mode.bypassAllowed")}
              checked={on}
              onCheckedChange={(next) => {
                props.handlers.change(field.key, next);
              }}
            />
          ) : (
            <Lock aria-hidden className="size-icon-xs flex-none" />
          )}
          <span className="min-w-0">
            {editable
              ? t("desktop.settings.perm.mode.bypassAllowed")
              : t(
                  on
                    ? "desktop.settings.perm.mode.bypassOn"
                    : "desktop.settings.perm.mode.bypassOff",
                )}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── 권한 규칙 ─────────────────────────────────────────────────────────────

const RULES_KEY: SettingKey = "l1.tools.rules";

/** 빈 상태 예시. 누르면 추가 줄이 채워진다 */
const RULE_EXAMPLES: readonly VerdictExample[] = [
  { subject: "read", verdict: "allow" },
  { subject: "bash(git status)", verdict: "allow" },
  { subject: "bash(rm -rf)", verdict: "deny" },
  { subject: "web_fetch", verdict: "ask" },
];

const ADD_ISSUE_ID: Readonly<Record<AddIssue, MessageId>> = {
  patternEmpty: "desktop.settings.perm.rules.issue.empty",
  patternLong: "desktop.settings.perm.rules.issue.long",
  patternCommandOnly: "desktop.settings.perm.rules.issue.commandOnly",
  patternForm: "desktop.settings.perm.rules.issue.form",
  patternDuplicate: "desktop.settings.perm.rules.issue.duplicate",
  memoLong: "desktop.settings.perm.rules.issue.memoLong",
};

interface RuleDraftRow {
  readonly pattern: string;
  readonly effect: PolicyEffect;
  readonly memo: string;
}

const EMPTY_DRAFT: RuleDraftRow = { pattern: "", effect: "ask", memo: "" };

/** 메모 칸: 글처럼 보이는 ghost 입력. 떠날 때나 Enter에 바뀐 글만 보낸다 */
function MemoInput(props: {
  readonly value: string;
  readonly label: string;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly onCommit: (text: string) => void;
}): ReactNode {
  const commit = (text: string): void => {
    if (text.trim() !== props.value) props.onCommit(text);
  };
  return (
    <Input
      key={props.value}
      size="sm"
      variant="ghost"
      containerClassName="w-full"
      className="placeholder:opacity-0 focus:placeholder:opacity-100 group-hover/vrow:placeholder:opacity-100"
      aria-label={props.label}
      placeholder={props.placeholder}
      defaultValue={props.value}
      disabled={props.disabled}
      onBlur={(event) => {
        commit(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (isCommitEnter(event)) commit(event.currentTarget.value);
      }}
    />
  );
}

function ruleRowsOf(
  rules: readonly PolicyRule[],
  editable: boolean,
  write: (next: readonly PolicyRule[]) => void,
): readonly VerdictRow[] {
  const conflicts = conflictsOf(rules);
  return rules.map((rule, index) => {
    const pattern = patternTextOf(rule);
    const partners = partnersOf(conflicts, index).map((at) => {
      const other = rules[at];
      return other === undefined ? "" : (patternTextOf(other) ?? ruleSummaryOf(other));
    });
    const subject =
      pattern !== null ? (
        pattern
      ) : (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate font-mono text-mono text-text-primary">
            {ruleSummaryOf(rule)}
          </span>
          <Badge size="sm" variant="outline">
            {t("desktop.settings.perm.rules.moreConditions")}
          </Badge>
        </span>
      );
    return {
      key: rule.id,
      subject,
      subjectTitle: pattern ?? rule.id,
      verdict: rule.effect,
      cells: [
        <MemoInput
          key="memo"
          value={rule.description ?? ""}
          label={t("desktop.settings.perm.rules.column.memo")}
          placeholder={t("desktop.settings.perm.rules.memo.placeholder")}
          disabled={!editable}
          onCommit={(text) => {
            write(withMemo(rules, index, text));
          }}
        />,
      ],
      note:
        partners.length === 0 ? undefined : (
          <RowNote>
            {t("desktop.settings.perm.rules.conflict", { rules: partners.join(", ") })}
          </RowNote>
        ),
    };
  });
}

/**
 * 권한 규칙 판정 표 하나. 구역 패널과 찾기 결과의 전용 편집기(`permissionRules`)가 같이 쓴다. 판정·메모·추가·지우기는
 * `handlers.change`로 바로 저장한다
 */
export function PermissionRulesTable(props: {
  readonly field: FieldVM;
  readonly editable: boolean;
  readonly handlers: FieldHandlers;
}): ReactNode {
  const [draft, setDraft] = useState<RuleDraftRow>(EMPTY_DRAFT);
  const [issue, setIssue] = useState<AddIssue | null>(null);
  const { field, editable } = props;
  const rules = ruleListOf(field.value);
  if (rules === null) {
    return <UnreadableEditorNote message={t("desktop.settings.rules.unreadable")} />;
  }
  const write = (next: readonly PolicyRule[]): void => {
    props.handlers.change(field.key, next);
  };
  const add = (): void => {
    const made = ruleOfPattern(draft, rules);
    if (!made.ok) {
      setIssue(made.error);
      return;
    }
    setIssue(null);
    setDraft(EMPTY_DRAFT);
    write([...rules, made.value]);
  };
  return (
    <VerdictTable
      label={field.label}
      subjectHeader={t("desktop.settings.perm.rules.column.pattern")}
      verdictHeader={t("desktop.settings.perm.rules.column.verdict")}
      extraColumns={[
        {
          header: t("desktop.settings.perm.rules.column.memo"),
          track: "minmax(0,0.8fr)",
          inset: true,
        },
      ]}
      choices={["allow", "ask", "deny"]}
      verdictLabel={verdictLabelOf}
      rows={ruleRowsOf(rules, editable, write)}
      disabled={!editable}
      onVerdict={(key, verdict) => {
        const index = rules.findIndex((rule) => rule.id === key);
        if (index >= 0) write(withEffect(rules, index, verdict));
      }}
      onRemove={(key) => {
        const index = rules.findIndex((rule) => rule.id === key);
        if (index >= 0) write(withoutRule(rules, index));
      }}
      removeLabel={(row) =>
        t("desktop.settings.perm.rules.remove", { rule: row.subjectTitle ?? row.key })
      }
      emptyText={t("desktop.settings.perm.rules.empty")}
      examples={RULE_EXAMPLES}
      onExample={(example) => {
        setIssue(null);
        setDraft({ ...draft, pattern: example.subject, effect: example.verdict });
      }}
      addLabel={t("desktop.settings.verdict.add")}
      add={{
        subject: draft.pattern,
        placeholder: t("desktop.settings.perm.rules.placeholder"),
        verdict: draft.effect,
        cells: [
          <Input
            key="memo"
            size="sm"
            containerClassName="w-full"
            aria-label={t("desktop.settings.perm.rules.column.memo")}
            placeholder={t("desktop.settings.perm.rules.memo.placeholder")}
            value={draft.memo}
            disabled={!editable}
            onValueChange={(memo) => {
              setDraft({ ...draft, memo });
            }}
            onKeyDown={(event) => {
              if (isCommitEnter(event)) add();
            }}
          />,
        ],
        error: issue === null ? null : t(ADD_ISSUE_ID[issue]),
        onSubject: (pattern) => {
          setIssue(null);
          setDraft({ ...draft, pattern });
        },
        onVerdict: (effect) => {
          setDraft({ ...draft, effect });
        },
        onAdd: add,
      }}
    />
  );
}

export function PermissionRulesPanel(props: PermissionPanelProps): ReactNode {
  const field = fieldOf(props.view, RULES_KEY);
  if (field === undefined) return null;
  return (
    <SettingSection
      title={t("desktop.settings.perm.rules.title")}
      description={t("desktop.settings.perm.rules.description")}
      end={savedEndOf(props.saved, [RULES_KEY])}
      body="bare"
    >
      <PermissionRulesTable
        field={field}
        editable={editableOf(field, props.live)}
        handlers={props.handlers}
      />
      <FieldNotes fields={[field]} />
    </SettingSection>
  );
}

// ── 승인 기다림: 무인 실행 ────────────────────────────────────────────

const UNATTENDED_APPROVAL: SettingKey = "l1.tools.unattended.approval";
const UNATTENDED_TIMEOUT: SettingKey = "l1.tools.unattended.timeoutSeconds";

/** 작은 카드 안 줄의 짧은 이름표. 카드 제목이 "무인 실행"을 이미 말한다 */
const SHORT_LABEL: ReadonlyMap<SettingKey, MessageId> = new Map<SettingKey, MessageId>([
  [UNATTENDED_APPROVAL, "desktop.settings.perm.wait.unattended.approval"],
  [UNATTENDED_TIMEOUT, "desktop.settings.perm.wait.unattended.timeout"],
]);

const CARD = "rounded-xl bg-surface-base shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]";

function MiniCard(props: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <section
      aria-label={props.title}
      data-slot="mini-card"
      className={`@container grid content-start overflow-hidden pb-1 ${CARD}`}
    >
      <h3 className="m-0 px-4 pt-3 pb-1 text-ui font-semibold text-text-primary">{props.title}</h3>
      {props.children}
    </section>
  );
}

function shortField(field: FieldVM): FieldVM {
  const id = SHORT_LABEL.get(field.key);
  return id === undefined ? field : { ...field, label: t(id) };
}

export function ApprovalWaitPanel(props: PermissionPanelProps): ReactNode {
  const row = (key: SettingKey): ReactNode => {
    const field = fieldOf(props.view, key);
    if (field === undefined) return null;
    return (
      <FieldRow
        key={key}
        field={shortField(field)}
        editable={field.editable && (props.live || field.origin === "desktop")}
        saved={props.saved.has(key)}
        editors={props.editors}
        handlers={props.handlers}
      />
    );
  };
  const approval = fieldOf(props.view, UNATTENDED_APPROVAL);
  // 제한 시간은 "시간이 지나면 만료"일 때만 뜻이 있다. 다른 값이면 줄을 숨긴다
  const showTimeout = approval === undefined || approval.value === "expire";
  return (
    <SettingSection title={t("desktop.settings.perm.wait.title")} body="bare">
      <div className="@container">
        <div className="grid grid-cols-1 gap-3 @[36rem]:grid-cols-2">
          <MiniCard title={t("desktop.settings.perm.wait.unattended.title")}>
            {row(UNATTENDED_APPROVAL)}
            {showTimeout ? row(UNATTENDED_TIMEOUT) : null}
          </MiniCard>
        </div>
      </div>
    </SettingSection>
  );
}

// ── 웹 접근 ───────────────────────────────────────────────────────────────

const WEB_EXAMPLES: readonly VerdictExample[] = [
  { subject: "github.com", verdict: "allow" },
  { subject: "*.internal", verdict: "deny" },
];

const DOMAIN_ISSUE_ID: Readonly<Record<DomainAddIssue, MessageId>> = {
  empty: "desktop.settings.sandbox.issue.empty",
  format: "desktop.settings.sandbox.issue.domain",
  duplicate: "desktop.settings.perm.web.issue.duplicate",
};

export function WebAccessPanel(props: PermissionPanelProps): ReactNode {
  const [draft, setDraft] = useState<{ readonly domain: string; readonly verdict: Verdict }>({
    domain: "",
    verdict: "ask",
  });
  const [issue, setIssue] = useState<DomainAddIssue | null>(null);
  const fields = {
    allow: fieldOf(props.view, WEB_POLICY_KEYS.allow),
    ask: fieldOf(props.view, WEB_POLICY_KEYS.ask),
    deny: fieldOf(props.view, WEB_POLICY_KEYS.deny),
  };
  const { allow, ask, deny } = fields;
  if (allow === undefined || ask === undefined || deny === undefined) return null;
  const lists: DomainLists = {
    allow: textListOf(allow.value) ?? [],
    ask: textListOf(ask.value) ?? [],
    deny: textListOf(deny.value) ?? [],
  };
  const editable = [allow, ask, deny].every((field) => editableOf(field, props.live));
  const write = (next: DomainLists): void => {
    for (const verdict of changedVerdictsOf(lists, next)) {
      props.handlers.change(WEB_POLICY_KEYS[verdict], next[verdict]);
    }
  };
  const add = (): void => {
    const checked = checkNewDomain(lists, draft.domain);
    if (!checked.ok) {
      setIssue(checked.error);
      return;
    }
    setIssue(null);
    setDraft({ domain: "", verdict: draft.verdict });
    write(withDomainVerdict(lists, checked.value, draft.verdict));
  };
  const rows: readonly VerdictRow[] = domainRowsOf(lists).map((row) => ({
    key: row.domain,
    subject: row.domain,
    verdict: row.verdict,
  }));
  const tail = [
    "l2.web.policy.allowPrivateNetwork",
    "l2.web.policy.unseenUrl",
  ] as const satisfies readonly SettingKey[];
  return (
    <>
      <SettingSection
        title={t("desktop.settings.perm.web.title")}
        description={t("desktop.settings.perm.web.description")}
        body="bare"
        end={savedEndOf(props.saved, [...Object.values(WEB_POLICY_KEYS), ...tail])}
      >
        <VerdictTable
          label={t("desktop.settings.perm.web.title")}
          subjectHeader={t("desktop.settings.perm.web.column.domain")}
          verdictHeader={t("desktop.settings.perm.rules.column.verdict")}
          choices={["allow", "ask", "deny"]}
          verdictLabel={verdictLabelOf}
          rows={rows}
          disabled={!editable}
          onVerdict={(domain, verdict) => {
            write(withDomainVerdict(lists, domain, verdict));
          }}
          onRemove={(domain) => {
            write(withDomainVerdict(lists, domain, null));
          }}
          removeLabel={(row) => t("desktop.settings.perm.web.remove", { domain: row.key })}
          emptyText={t("desktop.settings.perm.web.empty")}
          examples={WEB_EXAMPLES}
          onExample={(example) => {
            setIssue(null);
            setDraft({ domain: example.subject, verdict: example.verdict });
          }}
          addLabel={t("desktop.settings.verdict.add")}
          add={{
            subject: draft.domain,
            placeholder: t("desktop.settings.perm.web.placeholder"),
            verdict: draft.verdict,
            error: issue === null ? null : t(DOMAIN_ISSUE_ID[issue]),
            onSubject: (domain) => {
              setIssue(null);
              setDraft({ ...draft, domain });
            },
            onVerdict: (verdict) => {
              setDraft({ ...draft, verdict });
            },
            onAdd: add,
          }}
        />
        <FieldNotes fields={[allow, ask, deny]} />
      </SettingSection>
      <SettingSection continues label={t("desktop.settings.perm.web.title")}>
        {tail.map((key) => {
          const field = fieldOf(props.view, key);
          return field === undefined ? null : (
            <FieldRow
              key={key}
              field={field}
              editable={field.editable && (props.live || field.origin === "desktop")}
              saved={props.saved.has(key)}
              editors={props.editors}
              handlers={props.handlers}
            />
          );
        })}
      </SettingSection>
    </>
  );
}
