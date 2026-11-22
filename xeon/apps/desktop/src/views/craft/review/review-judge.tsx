// 리뷰 상세의 오른쪽 좁은 열: "판단하는 것"(AGE-34). 긴 차이를 읽는 동안에도 경고와 결정 단추가 보이도록 이 열은 따로 스크롤한다.
// 위에서부터: 결정 결과 → 관리 잠금 → 코드 실행 안내(늘 보임, [결정: AGE-14]) → 권한과 위험 → 비용(m6R5) → 출처 → 결정 칸(넣을 곳과 없는 플러그인 경고,
// 목적 한 문장, 거절 사유, 실패 사유, 거절·승인). 셋째 판: 결정 칸은 열 바닥에 따로 떠 있지 않고 출처 바로 뒤를 따른다. 열이 넘칠 때만
// 바닥에 붙는다(sticky). 그래서 짧은 항목에서 출처와 단추 사이가 비지 않는다. 좁은 창에서는 셋으로 나뉜다(`review.css`): 경고는 요약 아래로
// 올라가고, 권한·출처는 읽는 열 아래로 내려가고, 결정 칸은 화면 바닥에 붙는다.
// 넷째 판(m6R4): 알림 카드는 앱의 알림 토스트와 같은 부품(`NoticeCard`)이고, 권한과 위험의 줄도 토스트와 같은 문법(`NoticeLine`)이다.
// 목적 한 문장은 비워 두지 않고 카드의 사실로 만든 문장을 채워 둔다. 거절·승인 단추는 한 줄을 반씩 나눠 가진다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { Button, Select, SelectOption, Textarea } from "@caustic/react";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type { Profile, ReviewItem } from "@fresnel/contracts/wire";
import {
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import type { ProfileIssueView } from "../../commands.ts";
import {
  approveBlockOf,
  approveDecisionOf,
  approveOutcomeOf,
  codeNoticeOf,
  costViewOf,
  decideFailureOf,
  defaultTargetOf,
  keeperOf,
  missingForTarget,
  needsTarget,
  purposeDraftOf,
  rejectDecisionOf,
  shortHash,
  warningsOf,
  type ApproveOutcome,
  type CostLine,
  type DecideFailure,
  type Target,
  type Versions,
  type Warning,
} from "./review-model.ts";
import {
  agoText,
  Fact,
  Facts,
  KEEPER_LINE,
  NoticeCard,
  NoticeLine,
  originText,
  purposeText,
  Section,
} from "./review-parts.tsx";
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

/**
 * 코드 실행 안내. 경고라 아이콘 뒤에 숨기지 않고 늘 보인다 [결정: AGE-14]. 세기는 토스트의 문법으로 가른다:
 * 가져온 훅이 사용자 권한으로 돌면 주의(warning), 샌드박스 안의 가져온 훅과 Fresnel에서 만든 스크립트는 정보(info)다
 */
function CodeNotice(props: { readonly card: PluginCard }): ReactNode {
  const notice = codeNoticeOf(props.card);
  if (notice === null) return null;
  if (notice.mode === "userFull") {
    return (
      <NoticeCard
        name="code"
        tone="warning"
        title={t("desktop.craft.review.code.userFull.heading")}
        description={t("desktop.craft.review.code.userFull.body")}
      />
    );
  }
  if (notice.mode === "sandboxed") {
    return (
      <NoticeCard
        name="code"
        tone="info"
        title={t("desktop.craft.review.code.sandboxed.heading")}
        description={t("desktop.craft.review.code.sandboxed.body")}
      />
    );
  }
  const extra: string[] = [t("desktop.craft.review.code.notice")];
  if (notice.network) extra.push(t("desktop.craft.review.code.network"));
  if (notice.systemTools) extra.push(t("desktop.craft.review.code.systemTools"));
  if (notice.usesUnknown) extra.push(t("desktop.craft.review.code.usesUnknown"));
  if (notice.isolated === false) extra.push(t("desktop.craft.review.code.notIsolated"));
  return (
    <NoticeCard
      name="code"
      tone={notice.usesUnknown || notice.isolated === false ? "warning" : "info"}
      title={t("desktop.craft.review.code.heading")}
      description={extra.join(" ")}
    />
  );
}

/** 이 기기에 없는 플러그인 이름들을 ‘a’, ‘b’로 */
function quoted(names: readonly string[]): string {
  return names.map((name) => `‘${name}’`).join(", ");
}

/**
 * 조용한 경고 한 줄: 넣을 프로필이 이미 가리키던, 지금 이 기기에 없는 플러그인. 거절이 아니다(실행 때 건너뛴다) [결정: 2026-11-20, AGE-34].
 * 토스트와 같은 문법: 주의 색의 맨 그림 + 무채색 글
 */
function MissingNote(props: { readonly names: readonly string[] }): ReactNode {
  if (props.names.length === 0) return null;
  return (
    <NoticeLine tone="warning" slot="review-missing">
      <span className="text-ui-sm text-text-secondary">
        {t("desktop.craft.review.missing.note", { names: quoted(props.names) })}
      </span>
    </NoticeLine>
  );
}

const WARNING_WORD: Readonly<Record<Warning, MessageId>> = {
  handEdit: "desktop.craft.review.risk.handEdit",
  managedOff: "desktop.craft.review.risk.managedOff",
  purposeMissing: "desktop.craft.review.does.purposeMissing",
  enforcedNow: "desktop.craft.review.risk.enforcedNow",
  projectCode: "desktop.craft.review.risk.projectCode",
  hookOriginUnknown: "desktop.craft.review.run.originUnknown",
};

function RiskSection(props: {
  readonly item: ReviewItem;
  readonly managedOff: boolean;
}): ReactNode {
  const { item } = props;
  // 목적 문장 없음은 설명 섹션과 결정 칸이, 관리 잠금은 위의 알림 카드가 말하므로 여기서 되풀이하지 않는다. 비용은 아래 비용 섹션이 말한다
  const warnings = warningsOf(item, props.managedOff).filter(
    (w) => w !== "purposeMissing" && w !== "managedOff",
  );
  return (
    <Section title="desktop.craft.review.section.risk" id="risk">
      <Facts>
        <Fact term={t("desktop.craft.review.risk.enforcement")}>
          {t(KEEPER_LINE[keeperOf(item.card)])}
        </Fact>
      </Facts>
      {warnings.length === 0 ? (
        <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.craft.review.risk.none")}</p>
      ) : (
        <ul className="rv-lines m-0 p-0">
          {warnings.map((w) => (
            <NoticeLine key={w} as="li" tone={w === "handEdit" ? "danger" : "warning"}>
              {t(WARNING_WORD[w])}
            </NoticeLine>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** 비용 한 줄의 값: "약 N토큰", 바뀐 양은 그 뒤에 흐린 글로("· N토큰 늘어요"). 비용은 위험이 아니라 경고 색과 그림을 쓰지 않는다 */
function CostValue(props: { readonly line: CostLine }): ReactNode {
  const { tokens, change } = props.line;
  const changeText =
    change === null
      ? null
      : change > 0
        ? t("desktop.craft.review.cost.more", { tokens: change })
        : t("desktop.craft.review.cost.less", { tokens: -change });
  if (tokens === null) return changeText;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-2">
      <span>{t("desktop.craft.review.cost.tokens", { tokens })}</span>
      {changeText === null ? null : (
        <>
          {" "}
          <span className="text-text-tertiary">{changeText}</span>
        </>
      )}
    </span>
  );
}

/**
 * 비용(m6R5). 권한과 위험에서 빼낸 별도 섹션이다. 같은 이름표-값 줄을 쓰고, 엔진이 값을 주지 않으면 섹션이 없고, 싣는 양이 없으면 한 줄로 말한다
 */
function CostSection(props: { readonly item: ReviewItem }): ReactNode {
  const view = costViewOf(props.item);
  if (view.kind === "hidden") return null;
  return (
    <Section title="desktop.craft.review.section.cost" id="cost">
      {view.kind === "none" ? (
        <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.craft.review.cost.none")}</p>
      ) : (
        <Facts>
          {view.always === null ? null : (
            <Fact term={t("desktop.craft.review.cost.always")}>
              <CostValue line={view.always} />
            </Fact>
          )}
          {view.onDemand === null ? null : (
            <Fact term={t("desktop.craft.review.cost.onDemand")}>
              <CostValue line={view.onDemand} />
            </Fact>
          )}
          {view.tools === null ? null : (
            <Fact term={t("desktop.craft.review.cost.tools")}>
              {t("desktop.craft.review.cost.toolCount", { count: view.tools })}
            </Fact>
          )}
        </Facts>
      )}
    </Section>
  );
}

/**
 * 출처. 숫자(버전, 올라온 때)는 보통 글자와 같은 글꼴·자간이다(m6R4). 뜻이 코드인 것(패키지 이름, 해시)만 고정폭으로 남긴다
 */
function SourceSection(props: {
  readonly item: ReviewItem;
  readonly versions: Versions;
  readonly threadTitle: string | null;
  readonly now: number;
}): ReactNode {
  const { item, versions } = props;
  return (
    <Section title="desktop.craft.review.section.source" id="source">
      <Facts>
        <Fact term={t("desktop.craft.review.source.package")}>
          <span className="rv-code">{item.name}</span>
        </Fact>
        {versions.now === null ? null : (
          <Fact term={t("desktop.craft.review.source.version")}>
            {versions.before === null
              ? versions.now
              : t("desktop.craft.review.source.versionChange", {
                  from: versions.before,
                  to: versions.now,
                })}
          </Fact>
        )}
        {item.candidateHash === null ? null : (
          <Fact term={t("desktop.craft.review.source.candidate")}>
            <span className="rv-code" title={item.candidateHash}>
              {shortHash(item.candidateHash)}
            </span>
          </Fact>
        )}
        {item.baseHash === null ? null : (
          <Fact term={t("desktop.craft.review.source.base")}>
            <span className="rv-code" title={item.baseHash}>
              {shortHash(item.baseHash)}
            </span>
          </Fact>
        )}
        <Fact term={t("desktop.craft.review.source.from")}>
          {originText(item, props.threadTitle)}
        </Fact>
        <Fact term={t("desktop.craft.review.source.when")}>
          {agoText(item.createdAt, props.now)}
        </Fact>
      </Facts>
    </Section>
  );
}

/** 결정 뒤의 결과 카드(토스트와 같은 부품). 승인이면 들어간 프로필을 말하고 다음 항목으로 가는 단추를 카드 끝에 둔다 */
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
  const detail: string | null =
    decided.kind === "approved" && !decided.removal
      ? decided.outcome.profiles.length > 0
        ? `${t("desktop.craft.review.outcome.inProfiles", {
            names: decided.outcome.profiles.join(", "),
          })} ${t("desktop.craft.review.after.profileNote")}`
        : decided.outcome.library
          ? t("desktop.craft.review.after.libraryNote")
          : t("desktop.craft.review.after.noProfiles")
      : null;
  return (
    <div data-slot="review-decided" className="grid gap-2">
      <NoticeCard
        name="decided"
        live
        tone={decided.kind === "approved" ? "success" : "neutral"}
        title={t(title)}
        {...(detail === null ? {} : { description: detail })}
        {...(props.onNext === null
          ? {}
          : { actionLabel: t("desktop.craft.review.outcome.next"), onAction: props.onNext })}
      />
      {decided.kind === "approved" ? <MissingNote names={decided.outcome.missing} /> : null}
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
  // 목적 한 문장의 기본값: 카드의 사실로 만든 문장(모델을 부르지 않는다). 사람은 고칠 것이 있을 때만 고친다(m6R4)
  const draft = useMemo(() => purposeText(purposeDraftOf(item.card)), [item.card]);
  const [purpose, setPurpose] = useState(draft);
  const [reason, setReason] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const purposeId = useId();
  const purposeHintId = useId();
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
      <div role="alert" className="grid gap-2">
        <NoticeLine tone="danger">{t(FAILURE_WORD[phase.failure])}</NoticeLine>
        {blocking.length === 0 ? null : (
          <ul className="rv-lines m-0 p-0" data-slot="review-profile-issues">
            {blocking.map((issue, index) => (
              <NoticeLine
                key={`${issue.code}:${issue.profile ?? ""}:${issue.plugin ?? ""}:${String(index)}`}
                as="li"
                tone="danger"
              >
                {issueText(issue, profiles)}
              </NoticeLine>
            ))}
          </ul>
        )}
      </div>
    ) : props.offline ? (
      <NoticeLine tone="neutral">{t("desktop.craft.review.locked.offline")}</NoticeLine>
    ) : block === "handEdit" ? (
      <NoticeLine tone="danger">{t("desktop.craft.review.locked.handEdit")}</NoticeLine>
    ) : sending ? (
      <p role="status" className="m-0 text-ui-sm text-text-tertiary">
        {t("desktop.craft.review.sending")}
      </p>
    ) : null;
  const edited = purpose.trim() !== draft.trim();

  return (
    <div data-slot="review-decide" className="rv-decide">
      {item.kind === "new" ? (
        <label className="rv-field">
          <span className="rv-field-label">{t("desktop.craft.review.after.target")}</span>
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
          {note === null ? null : <span className="rv-field-hint">{t(note)}</span>}
          <MissingNote names={targetMissing} />
        </label>
      ) : item.kind === "update" ? (
        <p className="rv-field-hint m-0">{t("desktop.craft.review.after.update")}</p>
      ) : null}
      {needsPurpose ? (
        <div className="rv-field">
          <div className="flex min-h-5 items-center gap-2">
            <label htmlFor={purposeId} className="rv-field-label">
              {t("desktop.craft.review.after.purpose")}
            </label>
            {edited && draft !== "" ? (
              <Button
                size="xs"
                variant="ghost"
                className="ms-auto -me-1.5"
                onClick={() => {
                  setPurpose(draft);
                }}
              >
                {t("desktop.craft.review.after.purposeReset")}
              </Button>
            ) : null}
          </div>
          <Textarea
            id={purposeId}
            size="xs"
            rows={2}
            maxLength={200}
            value={purpose}
            placeholder={t("desktop.craft.review.after.purposePlaceholder")}
            aria-describedby={purposeHintId}
            className="resize-none"
            onChange={(event) => {
              setPurpose(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              // 목적 칸의 글자는 화면 키(a·r·j·k)가 아니다
              event.stopPropagation();
            }}
          />
          <span id={purposeHintId} className="rv-field-hint">
            {draft === ""
              ? null
              : edited
                ? t("desktop.craft.review.after.purposeEdited")
                : t("desktop.craft.review.after.purposeHint")}
          </span>
        </div>
      ) : null}
      {rejecting ? (
        <label className="rv-field">
          <span className="rv-field-label">{t("desktop.craft.review.reject.reason")}</span>
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
          <span className="rv-field-hint">{t("desktop.craft.review.reject.reasonHint")}</span>
        </label>
      ) : null}
      {status}
      {/* 두 단추는 한 줄을 반씩 나눠 가진다(flex-grow 1, 같은 크기) */}
      <div className="rv-decide-actions">
        {rejecting ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
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
              className="flex-1 text-danger-text"
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
              variant="outline"
              className="flex-1"
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
              className="flex-1"
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
      <div className="rv-alerts">
        {props.decided === null ? null : (
          <DecidedPanel decided={props.decided} onNext={props.onNext} />
        )}
        {props.managedOff ? (
          <NoticeCard
            name="managed"
            tone="danger"
            title={t("desktop.craft.review.risk.managedOffTitle")}
            description={t("desktop.craft.review.risk.managedOffBody")}
          />
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
          <CostSection item={item} />
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
