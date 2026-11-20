// 리뷰 상세의 오른쪽 좁은 열: "판단하는 것"(AGE-34). 긴 차이를 읽는 동안에도 경고와 결정 단추가 보이도록 이 열은 따로 스크롤한다.
// 위에서부터: 결정 결과 → 관리 잠금 → 코드 실행 안내(늘 보임, [결정: AGE-14]) → 권한과 위험 → 출처 → 결정 칸(넣을 곳과 없는 플러그인 경고,
// 목적 한 문장, 거절 사유, 실패 사유, 거절·승인). 셋째 판: 결정 칸은 열 바닥에 따로 떠 있지 않고 출처 바로 뒤를 따른다. 열이 넘칠 때만
// 바닥에 붙는다(sticky). 그래서 짧은 항목에서 출처와 단추 사이가 비지 않는다. 좁은 창에서는 셋으로 나뉜다(`review.css`): 경고는 요약 아래로
// 올라가고, 권한·출처는 읽는 열 아래로 내려가고, 결정 칸은 화면 바닥에 붙는다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { Button, cn, Select, SelectOption, Textarea } from "@caustic/react";
import { Check, ChevronRight, X } from "@caustic/react/icons";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type { Profile, ReviewItem } from "@fresnel/contracts/wire";
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import type { ProfileIssueView } from "../../commands.ts";
import {
  approveBlockOf,
  approveDecisionOf,
  approveOutcomeOf,
  codeNoticeOf,
  decideFailureOf,
  defaultTargetOf,
  missingForTarget,
  needsTarget,
  rejectDecisionOf,
  shortHash,
  warningsOf,
  type ApproveOutcome,
  type DecideFailure,
  type Target,
  type Versions,
  type Warning,
} from "./review-model.ts";
import { agoText, Fact, MUTED, originText, Section } from "./review-parts.tsx";
import type { ReviewData } from "./review-source.ts";

/** 결정 줄의 바깥 동작(키보드가 부른다) */
export interface DecisionHandle {
  approve(): void;
  reject(): void;
}

/** 결정 뒤 화면이 들고 있는 결과(목록의 "방금 결정함" 줄과 오른쪽 열의 결과 판) */
export type Decided =
  | { readonly kind: "approved"; readonly outcome: ApproveOutcome; readonly removal: boolean }
  | { readonly kind: "sentBack" }
  | { readonly kind: "discarded" };

/** 코드 실행 안내. 경고라 아이콘 뒤에 숨기지 않고 늘 보인다 [결정: AGE-14] */
function CodeNotice(props: { readonly card: PluginCard }): ReactNode {
  const notice = codeNoticeOf(props.card);
  if (notice === null) return null;
  const extra: string[] = [];
  if (notice.network) extra.push(t("desktop.craft.review.code.network"));
  if (notice.systemTools) extra.push(t("desktop.craft.review.code.systemTools"));
  if (notice.usesUnknown) extra.push(t("desktop.craft.review.code.usesUnknown"));
  if (notice.isolated === false) extra.push(t("desktop.craft.review.code.notIsolated"));
  return (
    <p
      data-slot="review-code-notice"
      role="note"
      className="rv-code-notice m-0 rounded-lg px-3 py-2.5 text-ui"
    >
      {t("desktop.craft.review.code.notice")}
      {extra.length === 0 ? null : <> {extra.join(" ")}</>}
    </p>
  );
}

/** 이 기기에 없는 플러그인 이름들을 ‘a’, ‘b’로 */
function quoted(names: readonly string[]): string {
  return names.map((name) => `‘${name}’`).join(", ");
}

/**
 * 조용한 경고 한 줄: 넣을 프로필이 이미 가리키던, 지금 이 기기에 없는 플러그인. 거절이 아니다(실행 때 건너뛴다) [결정: 2026-11-20, AGE-34].
 * 글은 무채색, 줄 앞 2px 선만 경고 색(`rv-caution`)
 */
function MissingNote(props: { readonly names: readonly string[] }): ReactNode {
  if (props.names.length === 0) return null;
  return (
    <p
      role="note"
      data-slot="review-missing"
      className="rv-caution m-0 text-ui-sm text-text-secondary"
    >
      {t("desktop.craft.review.missing.note", { names: quoted(props.names) })}
    </p>
  );
}

const WARNING_WORD: Readonly<Record<Exclude<Warning, "costUp">, MessageId>> = {
  handEdit: "desktop.craft.review.risk.handEdit",
  managedOff: "desktop.craft.review.risk.managedOff",
  purposeMissing: "desktop.craft.review.does.purposeMissing",
  enforcedNow: "desktop.craft.review.risk.enforcedNow",
  projectCode: "desktop.craft.review.risk.projectCode",
};

function RiskSection(props: {
  readonly item: ReviewItem;
  readonly managedOff: boolean;
}): ReactNode {
  const { item } = props;
  // 목적 문장 없음은 설명 섹션과 결정 칸이, 관리 잠금은 위의 띠가 말하므로 여기서 되풀이하지 않는다
  const warnings = warningsOf(item, props.managedOff).filter(
    (w) => w !== "purposeMissing" && w !== "managedOff" && w !== "costUp",
  );
  const always = item.diff.costDelta.always;
  return (
    <Section title="desktop.craft.review.section.risk" id="risk">
      <dl className="m-0 grid gap-1.5">
        <Fact wide term={t("desktop.craft.review.risk.enforcement")}>
          {item.card.enforcement === "enforced"
            ? t("desktop.craft.review.risk.enforced")
            : t("desktop.craft.review.risk.advisory")}
        </Fact>
      </dl>
      {warnings.length === 0 && (always === null || always === 0) ? (
        <p className={MUTED}>{t("desktop.craft.review.risk.none")}</p>
      ) : (
        <ul className="m-0 grid gap-1.5 p-0">
          {warnings.map((w) => (
            <li
              key={w}
              className={cn(
                "rv-caution list-none text-ui",
                w === "handEdit" ? "rv-caution-danger" : null,
              )}
            >
              {t(WARNING_WORD[w])}
            </li>
          ))}
          {always !== null && always !== 0 ? (
            <li
              className={cn("list-none text-ui", always > 0 ? "rv-caution" : "text-text-secondary")}
            >
              {always > 0
                ? t("desktop.craft.review.risk.costUp", { tokens: always })
                : t("desktop.craft.review.risk.costDown", { tokens: -always })}
            </li>
          ) : null}
        </ul>
      )}
    </Section>
  );
}

function SourceSection(props: {
  readonly item: ReviewItem;
  readonly versions: Versions;
  readonly threadTitle: string | null;
  readonly now: number;
}): ReactNode {
  const { item, versions } = props;
  return (
    <Section title="desktop.craft.review.section.source" id="source">
      <dl className="m-0 grid gap-1.5">
        <Fact wide term={t("desktop.craft.review.source.package")}>
          <span className="font-mono text-ui-sm">{item.name}</span>
        </Fact>
        {versions.now === null ? null : (
          <Fact wide term={t("desktop.craft.review.source.version")}>
            <span className="font-mono text-ui-sm">
              {versions.before === null
                ? versions.now
                : t("desktop.craft.review.source.versionChange", {
                    from: versions.before,
                    to: versions.now,
                  })}
            </span>
          </Fact>
        )}
        {item.candidateHash === null ? null : (
          <Fact wide term={t("desktop.craft.review.source.candidate")}>
            <span className="font-mono text-ui-sm" title={item.candidateHash}>
              {shortHash(item.candidateHash)}
            </span>
          </Fact>
        )}
        {item.baseHash === null ? null : (
          <Fact wide term={t("desktop.craft.review.source.base")}>
            <span className="font-mono text-ui-sm" title={item.baseHash}>
              {shortHash(item.baseHash)}
            </span>
          </Fact>
        )}
        <Fact wide term={t("desktop.craft.review.source.from")}>
          {originText(item, props.threadTitle)}
        </Fact>
        <Fact wide term={t("desktop.craft.review.source.when")}>
          {agoText(item.createdAt, props.now)}
        </Fact>
      </dl>
    </Section>
  );
}

/** 결정 뒤의 결과 판. 승인이면 들어간 프로필을 말하고 다음 항목으로 가는 길을 둔다 */
function DecidedPanel(props: {
  readonly decided: Decided;
  readonly onNext: (() => void) | null;
}): ReactNode {
  const { decided } = props;
  const title: MessageId =
    decided.kind === "approved"
      ? decided.removal
        ? "desktop.craft.review.outcome.removed"
        : "desktop.craft.review.outcome.approved"
      : decided.kind === "sentBack"
        ? "desktop.craft.review.outcome.sentBack"
        : "desktop.craft.review.outcome.discarded";
  return (
    <div
      role="status"
      data-slot="review-decided"
      className="grid gap-1.5 rounded-lg px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--cs-color-border-default)]"
    >
      <p className="m-0 flex items-center gap-2 text-ui-strong text-text-primary">
        {decided.kind === "approved" ? (
          <Check className="size-3.5 text-success-text" aria-hidden="true" />
        ) : (
          <X className="size-3.5 text-text-tertiary" aria-hidden="true" />
        )}
        {t(title)}
      </p>
      {decided.kind === "approved" && !decided.removal ? (
        decided.outcome.profiles.length > 0 ? (
          <p className={MUTED}>
            {t("desktop.craft.review.outcome.inProfiles", {
              names: decided.outcome.profiles.join(", "),
            })}{" "}
            {t("desktop.craft.review.after.profileNote")}
          </p>
        ) : decided.outcome.library ? (
          <p className={MUTED}>{t("desktop.craft.review.after.libraryNote")}</p>
        ) : (
          <p className={MUTED}>{t("desktop.craft.review.after.noProfiles")}</p>
        )
      ) : null}
      {decided.kind === "approved" ? <MissingNote names={decided.outcome.missing} /> : null}
      {props.onNext === null ? null : (
        <div>
          <Button size="sm" variant="ghost" className="-ms-2.5 gap-1" onClick={props.onNext}>
            {t("desktop.craft.review.outcome.next")}
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "rejecting" }
  | { readonly kind: "sending"; readonly what: "approve" | "reject" }
  | {
      readonly kind: "failed";
      readonly failure: DecideFailure;
      readonly issues: readonly ProfileIssueView[];
    };

const FAILURE_WORD: Readonly<Record<DecideFailure, MessageId>> = {
  offline: "desktop.craft.review.failure.offline",
  switching: "desktop.craft.review.failure.switching",
  notPending: "desktop.craft.review.failure.notPending",
  notFound: "desktop.craft.review.failure.notFound",
  handEdit: "desktop.craft.review.failure.handEdit",
  purposeRequired: "desktop.craft.review.failure.purposeRequired",
  profileInvalid: "desktop.craft.review.failure.profileInvalid",
  failed: "desktop.craft.review.failure.failed",
};

/** 엔진의 프로필 검사 문제(`ProfileIssueCode`)를 사람이 읽는 말로. 모르는 종류는 일반 문장이다 */
const ISSUE_WORD: Readonly<Record<string, MessageId>> = {
  plugin_unknown: "desktop.craft.review.issue.pluginUnknown",
  plugin_not_reviewed: "desktop.craft.review.issue.pluginNotReviewed",
  replace_conflict: "desktop.craft.review.issue.replaceConflict",
  driver_not_in_list: "desktop.craft.review.issue.driverNotInList",
  driver_cannot_drive: "desktop.craft.review.issue.driverCannotDrive",
  driver_unavailable: "desktop.craft.review.issue.driverUnavailable",
  setting_unknown_key: "desktop.craft.review.issue.settingUnknownKey",
  setting_scope_not_allowed: "desktop.craft.review.issue.settingScope",
  setting_invalid_value: "desktop.craft.review.issue.settingInvalid",
  secret_literal: "desktop.craft.review.issue.secretLiteral",
  secret_missing: "desktop.craft.review.issue.secretMissing",
  required_unset: "desktop.craft.review.issue.requiredUnset",
  requirement_unmet: "desktop.craft.review.issue.requirementUnmet",
  managed_forbidden: "desktop.craft.review.issue.managedForbidden",
  limit: "desktop.craft.review.issue.limit",
};

export function issueText(issue: ProfileIssueView, profiles: readonly Profile[]): string {
  const profile =
    issue.profile === null || issue.profile === "common"
      ? t("desktop.craft.review.issue.allProfiles")
      : (profiles.find((p) => p.id === issue.profile)?.title ?? issue.profile);
  const word = ISSUE_WORD[issue.code] ?? "desktop.craft.review.issue.other";
  return t(word, {
    profile,
    plugin: issue.plugin ?? "",
    other: issue.other ?? "",
    key: issue.key ?? "",
  });
}

const LIBRARY = "__library__";

/** 고르기 칸의 값. 고르지 않았으면 빈 값이라 칸이 자리 글(고르세요)을 보인다 */
function targetValue(target: Target): string {
  switch (target.kind) {
    case "profile":
      return target.profileId;
    case "library":
      return LIBRARY;
    case "unset":
      return "";
    default:
      return assertNever(target, "review target");
  }
}

function targetNote(target: Target): MessageId | null {
  if (target.kind === "profile") return "desktop.craft.review.after.profileNote";
  if (target.kind === "library") return "desktop.craft.review.after.libraryNote";
  return null;
}

/** 결정 칸: 넣을 곳(새 플러그인), 목적 한 문장(비었을 때), 거절 사유, 실패 사유, 단추 */
function DecidePanel(props: {
  readonly item: ReviewItem;
  readonly profiles: readonly Profile[];
  readonly missing: ReadonlyMap<string, readonly string[]>;
  readonly offline: boolean;
  readonly data: Pick<ReviewData, "decide">;
  readonly handleRef: Ref<DecisionHandle>;
  readonly onDecided: (itemId: string, decided: Decided) => void;
}): ReactNode {
  const { item, profiles } = props;
  const [target, setTarget] = useState<Target>(() => defaultTargetOf(item, profiles));
  const [purpose, setPurpose] = useState("");
  const [reason, setReason] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const block = approveBlockOf(item);
  const needsPurpose = item.kind !== "remove" && (item.card.purpose ?? "").trim() === "";
  const sending = phase.kind === "sending";
  const rejecting =
    phase.kind === "rejecting" || (phase.kind === "sending" && phase.what === "reject");
  const approveDisabled =
    props.offline ||
    block !== null ||
    sending ||
    needsTarget(item, target) ||
    (needsPurpose && purpose.trim() === "");

  const send = (what: "approve" | "reject"): void => {
    const decision =
      what === "approve" ? approveDecisionOf(item, target, purpose) : rejectDecisionOf(reason);
    setPhase({ kind: "sending", what });
    const run = async (): Promise<void> => {
      const result = await props.data.decide(item.itemId, decision);
      if (!result.ok) {
        const error = result.error;
        setPhase({
          kind: "failed",
          failure: decideFailureOf(error),
          issues: error.kind === "rejected" ? (error.profileIssues ?? []) : [],
        });
        return;
      }
      setPhase({ kind: "idle" });
      if (decision.kind === "approve") {
        props.onDecided(item.itemId, {
          kind: "approved",
          outcome: approveOutcomeOf(
            item,
            result.value.appliedTo,
            profiles,
            result.value.missingPlugins ?? [],
          ),
          removal: item.kind === "remove",
        });
      } else {
        props.onDecided(item.itemId, {
          kind: decision.kind === "sendBack" ? "sentBack" : "discarded",
        });
      }
    };
    detach(run(), rethrow);
  };

  useImperativeHandle(props.handleRef, () => ({
    approve: () => {
      if (!approveDisabled) send("approve");
    },
    reject: () => {
      if (props.offline || sending) return;
      setPhase({ kind: "rejecting" });
    },
  }));

  useEffect(() => {
    if (phase.kind === "rejecting") reasonRef.current?.focus();
  }, [phase.kind]);

  const note = item.kind === "new" ? targetNote(target) : null;
  const targetMissing =
    item.kind === "new" ? missingForTarget(props.missing, target, item.name) : [];
  // 3656의 사유 가운데 경고(이미 있던 없는 플러그인)는 거절 사유가 아니다. 거절 사유만 위험 색으로 보인다
  const blocking =
    phase.kind === "failed" ? phase.issues.filter((issue) => issue.severity !== "warning") : [];
  const status: ReactNode =
    phase.kind === "failed" ? (
      <div role="alert" className="grid gap-1 text-ui text-danger-text">
        <p className="m-0">{t(FAILURE_WORD[phase.failure])}</p>
        {blocking.length === 0 ? null : (
          <ul className="m-0 grid gap-1 p-0" data-slot="review-profile-issues">
            {blocking.map((issue, index) => (
              <li
                key={`${issue.code}:${issue.profile ?? ""}:${issue.plugin ?? ""}:${String(index)}`}
                className="rv-caution rv-caution-danger list-none text-text-primary"
              >
                {issueText(issue, profiles)}
              </li>
            ))}
          </ul>
        )}
      </div>
    ) : props.offline ? (
      <p className="m-0 text-ui text-text-tertiary">{t("desktop.craft.review.locked.offline")}</p>
    ) : block === "handEdit" ? (
      <p className="m-0 text-ui text-danger-text">{t("desktop.craft.review.locked.handEdit")}</p>
    ) : sending ? (
      <p role="status" className="m-0 text-ui-sm text-text-tertiary">
        {t("desktop.craft.review.sending")}
      </p>
    ) : null;

  return (
    <div data-slot="review-decide" className="rv-decide grid gap-3">
      {item.kind === "new" ? (
        <label className="grid gap-1.5">
          <span className="text-ui-sm text-text-tertiary">
            {t("desktop.craft.review.after.target")}
          </span>
          <Select
            size="sm"
            variant="outline"
            aria-label={t("desktop.craft.review.after.target")}
            value={targetValue(target)}
            placeholder={t("desktop.craft.review.after.pick")}
            onValueChange={(value) => {
              setTarget(
                value === LIBRARY
                  ? { kind: "library" }
                  : value === ""
                    ? { kind: "unset" }
                    : { kind: "profile", profileId: value },
              );
              if (phase.kind === "failed") setPhase({ kind: "idle" });
            }}
          >
            {profiles.map((profile) => (
              <SelectOption key={profile.id} value={profile.id}>
                {profile.title}
              </SelectOption>
            ))}
            <SelectOption value={LIBRARY}>{t("desktop.craft.review.after.library")}</SelectOption>
          </Select>
          {note === null ? null : <span className="text-ui-sm text-text-tertiary">{t(note)}</span>}
          <MissingNote names={targetMissing} />
        </label>
      ) : item.kind === "update" ? (
        <p className="m-0 text-ui-sm text-text-tertiary">
          {t("desktop.craft.review.after.update")}
        </p>
      ) : null}
      {needsPurpose ? (
        <label className="grid gap-1.5">
          <span className="text-ui-sm text-text-tertiary">
            {t("desktop.craft.review.after.purpose")}
          </span>
          <Textarea
            size="xs"
            rows={2}
            maxLength={200}
            value={purpose}
            placeholder={t("desktop.craft.review.after.purposePlaceholder")}
            className="resize-none"
            onChange={(event) => {
              setPurpose(event.currentTarget.value);
            }}
          />
        </label>
      ) : null}
      {rejecting ? (
        <label className="grid gap-1.5">
          <span className="text-ui-sm text-text-tertiary">
            {t("desktop.craft.review.reject.reason")}
          </span>
          <Textarea
            ref={reasonRef}
            size="xs"
            rows={2}
            maxLength={2000}
            value={reason}
            className="resize-none"
            disabled={sending}
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              // 사유 칸의 글자는 화면 키가 아니다. Esc는 취소, ⌘Enter는 거절하기
              event.stopPropagation();
              if (event.key === "Escape") setPhase({ kind: "idle" });
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send("reject");
            }}
          />
          <span className="text-ui-sm text-text-tertiary">
            {t("desktop.craft.review.reject.reasonHint")}
          </span>
        </label>
      ) : null}
      {status}
      <div className="flex items-center justify-end gap-2">
        {rejecting ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={sending}
              onClick={() => {
                setPhase({ kind: "idle" });
              }}
            >
              {t("desktop.craft.review.reject.cancel")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-danger-text"
              disabled={sending || props.offline}
              onClick={() => {
                send("reject");
              }}
            >
              {t("desktop.craft.review.reject.confirm")}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={sending || props.offline}
              aria-keyshortcuts="r"
              onClick={() => {
                setPhase({ kind: "rejecting" });
              }}
            >
              {t("desktop.craft.review.reject")}
            </Button>
            <Button
              size="sm"
              variant="solid"
              disabled={approveDisabled}
              aria-keyshortcuts="a"
              className="min-w-20"
              onClick={() => {
                send("approve");
              }}
            >
              {t("desktop.craft.review.approve")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 오른쪽 열 전체. 세 칸(`rv-alerts` 경고, `rv-more` 권한·출처, `rv-decide-dock` 결정)을 한 열에 두고, 좁은 창에서는 `review.css`가
 * 열을 풀어(`display: contents`) 세 칸을 상세 격자의 다른 자리로 보낸다
 */
export function JudgeColumn(props: {
  readonly item: ReviewItem;
  readonly versions: Versions;
  readonly profiles: readonly Profile[];
  readonly missing: ReadonlyMap<string, readonly string[]>;
  readonly managedOff: boolean;
  readonly offline: boolean;
  readonly threadTitle: string | null;
  readonly now: number;
  readonly data: Pick<ReviewData, "decide">;
  readonly decided: Decided | null;
  readonly onDecided: (itemId: string, decided: Decided) => void;
  readonly onNext: (() => void) | null;
  readonly handleRef: Ref<DecisionHandle>;
}): ReactNode {
  const { item } = props;
  const notice = item.kind === "remove" ? null : <CodeNotice card={item.card} />;
  const alerts =
    props.decided !== null || props.managedOff || notice !== null ? (
      <div className="rv-alerts grid gap-2">
        {props.decided === null ? null : (
          <DecidedPanel decided={props.decided} onNext={props.onNext} />
        )}
        {props.managedOff ? (
          <p
            role="note"
            className="rv-code-notice rv-notice-danger m-0 rounded-lg px-3 py-2.5 text-ui"
          >
            {t("desktop.craft.review.risk.managedOff")}
          </p>
        ) : null}
        {notice}
      </div>
    ) : null;
  return (
    <aside aria-label={t("desktop.craft.review.judgeLabel")} className="rv-judge">
      <div className="rv-judge-scroll">
        {alerts}
        <div className="rv-more">
          {item.kind === "remove" ? null : (
            <RiskSection item={item} managedOff={props.managedOff} />
          )}
          <SourceSection
            item={item}
            versions={props.versions}
            threadTitle={props.threadTitle}
            now={props.now}
          />
        </div>
        {props.decided === null ? (
          <div className="rv-decide-dock">
            <DecidePanel
              item={item}
              profiles={props.profiles}
              missing={props.missing}
              offline={props.offline}
              data={props.data}
              handleRef={props.handleRef}
              onDecided={props.onDecided}
            />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
