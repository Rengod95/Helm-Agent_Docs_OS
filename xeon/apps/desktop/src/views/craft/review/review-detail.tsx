// 리뷰 항목 하나의 자세히(C5, craft-flows 6.12, AGE-34 둘째 판). 카드 면에 가두지 않고 목록 오른쪽 콘텐츠 영역 전체를 쓴다.
// 배치(`review.css`의 `.rv-detail`): 위에 요약 띠(무엇이, 어디서, 무엇을 하려는지, 버전) → 아래 두 열.
//   가운데 넓은 열 = 읽는 것: 설명 → 작동 방식(시점 / 입력 / 영향 / 출력) → 승인하면 실행될 것 → 바뀌는 파일(전·후 차이).
//   오른쪽 좁은 열 = 판단하는 것(`review-judge.tsx`): 코드 실행 경고, 권한과 위험, 출처, 넣을 곳, 거절·승인. 열이 따로 스크롤해
//   긴 차이를 읽는 동안에도 경고와 결정 단추가 남는다.
// 섹션 문법은 캔버스 상세 패널(cv4)과 같다(제목 15/600, 아이콘 없음, 섹션 사이 가는 선).
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type {
  BridgeCapability,
  CardScriptEnv,
  HookKind,
  HookPower,
  Placement,
  PluginCard,
  ScriptUse,
} from "@fresnel/contracts/extensions";
import type { DiffRow as CardDiffRow, Profile, ReviewItem } from "@fresnel/contracts/wire";
import { useId, type ReactNode, type Ref } from "react";
import { useInstalledEntries } from "../installed-entries.ts";
import { PartyLabel } from "../deps/dependency-refusal.tsx";
import {
  dependencyChangeOf,
  KIND_WORD,
  partyNameOf,
  splitRegistration,
} from "../deps/deps-model.ts";
import {
  changeWhatOf,
  placementOf,
  workFactsOf,
  type ChangePart,
  type ChangesFact,
  type GivesFact,
  type ReadsFact,
  type ScreenFact,
  type WhenFact,
} from "./review-facts.ts";
import { FilesSection, type FileHandle } from "./review-files.tsx";
import { KindTile } from "./review-glyphs.tsx";
import { JudgeColumn, type Decided, type DecisionHandle } from "./review-judge.tsx";
import {
  entryKindOf,
  hookOriginLineOf,
  keeperOf,
  kindsOf,
  primaryKindOf,
  purposeDraftOf,
  runLinesOf,
  shortHash,
  type HookOriginLine,
  type RunLine,
  type Versions,
} from "./review-model.ts";
import {
  ACTION_WORD,
  agoText,
  Chip,
  ENTRY_WORD,
  Fact,
  Facts,
  KEEPER_CHIP,
  KEEPER_LINE,
  KindChip,
  MUTED,
  NoticeLine,
  originText,
  placeText,
  purposeText,
  Section,
} from "./review-parts.tsx";
import type { ReviewData } from "./review-source.ts";

/** 요약 띠: 종류 타일 28, 이름(19/600)과 버전, "무엇을 하려는지 · 어디서 · 언제", 칩 줄은 타일 왼끝에서 시작한다 */
function ReviewHead(props: {
  readonly item: ReviewItem;
  readonly versions: Versions;
  readonly threadTitle: string | null;
  readonly now: number;
  readonly headingId: string;
}): ReactNode {
  const { item, versions } = props;
  const entry = entryKindOf(item);
  const keeper = keeperOf(item.card);
  return (
    <header className="rv-head grid gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <KindTile kind={primaryKindOf(item.card)} size={28} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2
              id={props.headingId}
              className="m-0 truncate text-title-feature font-semibold text-text-primary"
              title={item.card.displayName}
            >
              {item.card.displayName}
            </h2>
            {versions.now === null ? null : (
              <span data-slot="review-version" className="shrink-0 text-ui text-text-tertiary">
                {versions.before === null
                  ? versions.now
                  : t("desktop.craft.review.source.versionChange", {
                      from: versions.before,
                      to: versions.now,
                    })}
              </span>
            )}
          </div>
          <p className="m-0 flex min-w-0 items-baseline gap-2 text-ui text-text-tertiary">
            <span className="shrink-0">{t(ACTION_WORD[entry])}</span>{" "}
            <span className="min-w-0 truncate">{originText(item, props.threadTitle)}</span>{" "}
            <span className="shrink-0">{agoText(item.createdAt, props.now)}</span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip>{t(ENTRY_WORD[entry])}</Chip>
        {kindsOf(item.card).map((kind) => (
          <KindChip key={kind} kind={kind} />
        ))}
        <Chip tone={keeper === "engine" ? "warning" : "neutral"} title={t(KEEPER_LINE[keeper])}>
          {t(KEEPER_CHIP[keeper])}
        </Chip>
      </div>
    </header>
  );
}

// ── 작동 방식 ─────────────────────────────────────────────────────────

const HOOK_READS: Readonly<Record<HookKind, MessageId>> = {
  input: "desktop.craft.review.fact.reads.input",
  request: "desktop.craft.review.fact.reads.request",
  tool: "desktop.craft.review.fact.reads.tool",
  boundary: "desktop.craft.review.fact.reads.boundary",
  thread: "desktop.craft.review.fact.reads.thread",
  lifecycle: "desktop.craft.review.fact.reads.lifecycle",
  guard: "desktop.craft.review.fact.reads.guard",
  ask: "desktop.craft.review.fact.reads.ask",
  agent: "desktop.craft.review.fact.reads.agent",
};

const POWER_WORD: Readonly<Record<HookPower, MessageId>> = {
  observe: "desktop.craft.review.fact.changes.observe",
  modify: "desktop.craft.review.fact.changes.modify",
  decide: "desktop.craft.review.fact.changes.decide",
  contribute: "desktop.craft.review.fact.changes.contribute",
};

/** 칩 하나의 글: 말과 값(사람이 고르거나 적는 이름). 값은 고정폭 글자로 */
interface FactChip {
  readonly key: string;
  readonly word: string;
  readonly value: string | null;
  readonly warn: boolean;
}

function whenChip(fact: WhenFact): FactChip {
  switch (fact.kind) {
    case "place":
      return {
        key: `place:${fact.place.group}:${fact.place.side ?? ""}`,
        word: placeText(fact.place),
        value: null,
        warn: false,
      };
    case "start":
      return {
        key: "start",
        word: t("desktop.craft.review.fact.when.start"),
        value: null,
        warn: false,
      };
    case "command":
      return {
        key: `cmd:${fact.value}`,
        word: t("desktop.craft.review.fact.when.command"),
        value: fact.value,
        warn: false,
      };
    case "handoff":
      return {
        key: "handoff",
        word: t("desktop.craft.review.fact.when.handoff"),
        value: null,
        warn: false,
      };
    case "toolCall":
      return {
        key: "toolCall",
        word: t("desktop.craft.review.fact.when.toolCall"),
        value: null,
        warn: false,
      };
    case "everyRequest":
      return {
        key: "every",
        word: t("desktop.craft.review.fact.when.everyRequest"),
        value: null,
        warn: false,
      };
    case "onDemand":
      return {
        key: "onDemand",
        word: t("desktop.craft.review.fact.when.onDemand"),
        value: null,
        warn: false,
      };
    default:
      return assertNever(fact, "review when fact");
  }
}

function readsChip(fact: ReadsFact): FactChip {
  switch (fact.kind) {
    case "hook":
      return { key: `hook:${fact.hook}`, word: t(HOOK_READS[fact.hook]), value: null, warn: false };
    case "thread":
      return {
        key: "thread",
        word: t("desktop.craft.review.fact.reads.conversation"),
        value: null,
        warn: false,
      };
    case "toolArgs":
      return {
        key: "toolArgs",
        word: t("desktop.craft.review.fact.reads.toolArgs"),
        value: null,
        warn: false,
      };
    case "env":
      return {
        key: `env:${fact.value}`,
        word: t("desktop.craft.review.fact.reads.env"),
        value: fact.value,
        warn: false,
      };
    default:
      return assertNever(fact, "review reads fact");
  }
}

function changesChip(fact: ChangesFact): FactChip {
  switch (fact.kind) {
    case "power":
      return {
        key: `power:${fact.power}`,
        word: t(POWER_WORD[fact.power]),
        value: null,
        warn: fact.power === "decide",
      };
    case "instructions":
      return {
        key: "instructions",
        word: t("desktop.craft.review.fact.changes.instructions"),
        value: null,
        warn: false,
      };
    case "leads":
      return {
        key: "leads",
        word: t("desktop.craft.review.fact.changes.leads"),
        value: null,
        warn: false,
      };
    case "replaces":
      return {
        key: `replaces:${fact.value}`,
        word: t("desktop.craft.review.fact.changes.replaces"),
        value: fact.value,
        warn: true,
      };
    default:
      return assertNever(fact, "review changes fact");
  }
}

/** 출력 줄의 화면 칩 글: 자리마다 글 하나에 수(`{count}`)를 넣는다 */
const GIVES_UI_WORD: Readonly<Record<Placement, MessageId>> = {
  page: "desktop.craft.review.fact.gives.ui.page",
  panel: "desktop.craft.review.fact.gives.ui.panel",
  card: "desktop.craft.review.fact.gives.ui.card",
  status: "desktop.craft.review.fact.gives.ui.status",
  command: "desktop.craft.review.fact.gives.ui.command",
  settings: "desktop.craft.review.fact.gives.ui.settings",
};

/** 화면 줄의 자리 이름. page와 panel은 설정의 화면 자리 말을 그대로 쓴다 */
const SCREEN_PLACE_WORD: Readonly<Record<Placement, MessageId>> = {
  page: "desktop.addons.where.page",
  panel: "desktop.addons.where.panel",
  card: "desktop.craft.review.screen.place.card",
  status: "desktop.craft.review.screen.place.status",
  command: "desktop.craft.review.screen.place.command",
  settings: "desktop.craft.review.screen.place.settings",
};

/** 화면 줄의 자리 말. 계약에 없는 자리 이름은 카드가 든 그대로 보인다 */
function placeWordOf(name: string): string {
  const placement = placementOf(name);
  return placement === null ? name : t(SCREEN_PLACE_WORD[placement]);
}

/** 브릿지 권한의 이름. 설정의 권한 제목 말을 그대로 쓴다 */
const CAPABILITY_WORD: Readonly<Record<BridgeCapability, MessageId>> = {
  files: "desktop.addons.cap.files.title",
  notify: "desktop.addons.cap.notify.title",
  settingsWrite: "desktop.addons.cap.settingsWrite.title",
  secrets: "desktop.addons.cap.secrets.title",
};

function givesChip(fact: GivesFact): FactChip {
  switch (fact.kind) {
    case "tool":
      return {
        key: `tool:${fact.value}`,
        word: t("desktop.craft.review.fact.gives.tool"),
        value: fact.value,
        warn: false,
      };
    case "server":
      return {
        key: `server:${fact.value}`,
        word: t("desktop.craft.review.fact.gives.server"),
        value: fact.value,
        warn: false,
      };
    case "command":
      return {
        key: `command:${fact.value}`,
        word: t("desktop.craft.review.fact.gives.command"),
        value: fact.value,
        warn: false,
      };
    case "agent":
      return {
        key: `agent:${fact.value}`,
        word: t("desktop.craft.review.fact.gives.agent"),
        value: fact.value,
        warn: false,
      };
    case "skill":
      return {
        key: `skill:${fact.value}`,
        word: t("desktop.craft.review.fact.gives.skill"),
        value: fact.value,
        warn: false,
      };
    case "ui":
      return {
        key: `ui:${fact.placement}`,
        word: t(GIVES_UI_WORD[fact.placement], { count: fact.count }),
        value: null,
        warn: false,
      };
    case "decision":
      return {
        key: "decision",
        word: t("desktop.craft.review.fact.gives.decision"),
        value: null,
        warn: false,
      };
    default:
      return assertNever(fact, "review gives fact");
  }
}

/** 네 줄 가운데 하나: 왼쪽 줄 이름(시점·입력·영향·출력) + 값 칩들. 값이 없으면 줄이 없다 */
function FactRow(props: {
  readonly label: MessageId;
  readonly chips: readonly FactChip[];
}): ReactNode {
  if (props.chips.length === 0) return null;
  return (
    <div className="flex items-start gap-3 py-0.75">
      <dt className="w-12 shrink-0 pt-0.75 text-ui-sm leading-4 text-text-tertiary">
        {t(props.label)}
      </dt>
      <dd className="m-0 flex min-w-0 flex-1 flex-wrap gap-1">
        {props.chips.map((chip) => (
          <span key={chip.key} className="rv-fact" data-warn={chip.warn ? "" : undefined}>
            <span>{chip.word}</span>
            {chip.value === null ? null : <span className="rv-fact-value">{chip.value}</span>}
          </span>
        ))}
      </dd>
    </div>
  );
}

const ROW_WORD: Readonly<Record<CardDiffRow, MessageId>> = {
  inject: "desktop.craft.review.row.inject",
  hook: "desktop.craft.review.row.hook",
  drive: "desktop.craft.review.row.drive",
  runs: "desktop.craft.review.row.runs",
  setting: "desktop.craft.review.row.setting",
  replaces: "desktop.craft.review.row.replaces",
  dependencies: "desktop.craft.review.row.dependencies",
};

const PART_WORD: Readonly<Record<ChangePart, MessageId>> = {
  instruction: "desktop.craft.review.change.instruction",
  skill: "desktop.craft.review.change.skill",
  tool: "desktop.craft.review.change.tool",
  mcp: "desktop.craft.review.change.mcp",
  script: "desktop.craft.review.change.script",
  agent: "desktop.craft.review.change.agent",
  command: "desktop.craft.review.change.command",
  provider: "desktop.craft.review.change.provider",
  ui: "desktop.craft.review.change.ui",
  replaces: "desktop.craft.review.change.replaces",
  hook: "desktop.craft.review.change.hook",
  driveStart: "desktop.craft.review.change.driveStart",
  runsCode: "desktop.craft.review.change.runsCode",
  runsIsolated: "desktop.craft.review.change.runsIsolated",
};

/** 달라진 일 한 줄: 부품 말(모르면 칸 말)과 이름 */
/** 의존 줄은 대상 이름, 기대는 멤버, 종류, 범위를 사람 말로 보인다. 모양이 다르면 원문이다 */
function DependencyChange(props: { readonly what: string; readonly detail?: string }): ReactNode {
  const entries = useInstalledEntries();
  const change = dependencyChangeOf(props.what, props.detail);
  if (change === null) return null;
  const from = splitRegistration(change.from).member;
  return (
    <>
      <span className="shrink-0 text-ui-sm text-text-tertiary">
        {t("desktop.craft.review.row.dependencies")}
      </span>
      <span className="min-w-0 text-ui-sm">
        <PartyLabel name={partyNameOf(change.target, entries)} />
      </span>
      {from !== null && (
        <span className="shrink-0 text-ui-sm text-text-tertiary">
          {t("desktop.craft.deps.byMember", { id: from })}
        </span>
      )}
      {change.kind !== null && (
        <span className="shrink-0 text-ui-sm text-text-secondary">{t(KIND_WORD[change.kind])}</span>
      )}
      <span className="shrink-0 font-mono text-mono-sm text-text-tertiary">
        {change.range ?? t("desktop.craft.deps.range.any")}
      </span>
    </>
  );
}

function ChangeLine(props: {
  readonly row: CardDiffRow;
  readonly what: string;
  readonly detail?: string;
}): ReactNode {
  if (props.row === "dependencies" && dependencyChangeOf(props.what, props.detail) !== null) {
    return (
      <DependencyChange
        what={props.what}
        {...(props.detail === undefined ? {} : { detail: props.detail })}
      />
    );
  }
  const what = changeWhatOf(props.what);
  return (
    <>
      <span className="shrink-0 text-ui-sm text-text-tertiary">
        {t(what.part === null ? ROW_WORD[props.row] : PART_WORD[what.part])}
      </span>
      {what.name === "" ? null : (
        <span
          className="min-w-0 truncate font-mono text-ui-sm text-text-primary"
          title={props.detail}
        >
          {what.name}
        </span>
      )}
    </>
  );
}

/**
 * 자체 코드로 그리는 화면(앱 모드) 목록. 화면마다 자리와 id·"플러그인 앱", 까닭, 브릿지 권한을 세 줄로 보인다.
 * 앱 화면이 없으면 아무것도 그리지 않는다. 목록 머리는 "이전 버전과 달라진 일" 머리와 같은 모양이다.
 */
function ScreensBlock(props: { readonly screens: readonly ScreenFact[] }): ReactNode {
  const apps = props.screens.filter((screen) => screen.mode === "app");
  if (apps.length === 0) return null;
  return (
    <div className="grid gap-1.5 pt-1">
      <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.craft.review.screen.title")}</p>
      <ul className="m-0 grid gap-1 p-0">
        {apps.map((screen) => (
          <li key={`${screen.placement}:${screen.id}`} className="grid min-w-0 gap-0.5 text-ui">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-ui-sm text-text-tertiary">
                {placeWordOf(screen.placement)}
              </span>
              <span className="min-w-0 truncate font-mono text-ui-sm text-text-primary">
                {screen.id}
              </span>
              <span className="shrink-0 text-ui-sm text-text-tertiary">
                {t("desktop.craft.review.screen.app")}
              </span>
            </div>
            {screen.reason === null ? null : (
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 text-ui-sm text-text-tertiary">
                  {t("desktop.craft.review.screen.reason")}
                </span>
                <span className="min-w-0 text-ui-sm text-text-secondary">{screen.reason}</span>
              </div>
            )}
            <div className="flex min-w-0 items-baseline gap-2">
              {screen.capabilities.length === 0 ? (
                <span className="text-ui-sm text-text-tertiary">
                  {t("desktop.craft.review.screen.bridgeNone")}
                </span>
              ) : (
                <>
                  <span className="shrink-0 text-ui-sm text-text-tertiary">
                    {t("desktop.craft.review.screen.bridge")}
                  </span>
                  <span className="min-w-0 text-ui-sm text-text-secondary">
                    {screen.capabilities
                      .map((capability) => t(CAPABILITY_WORD[capability]))
                      .join(", ")}
                  </span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HowSection(props: { readonly item: ReviewItem; readonly card: PluginCard }): ReactNode {
  const { item } = props;
  const facts = workFactsOf(props.card);
  const diff = item.diff;
  const changes = [
    ...diff.added.map((entry) => ({ mark: "added" as const, entry })),
    ...diff.changed.map((entry) => ({ mark: "changed" as const, entry })),
    ...diff.removed.map((entry) => ({ mark: "removed" as const, entry })),
  ];
  const entries = useInstalledEntries();
  // 의존 줄: 대상 이름과 종류, 범위. 엔진이 문제를 찾았으면 경고 색이다(설치되지 않음, 멤버 없음, 범위 어긋남)
  const dependChips: readonly FactChip[] = (props.card.dependencies?.dependsOn ?? []).map(
    (line) => {
      const name = partyNameOf(line.target, entries);
      return {
        key: `${line.from}->${line.target}`,
        word:
          name.member === null
            ? name.plugin
            : `${name.plugin} ${t("desktop.craft.deps.member", { id: name.member })}`,
        value:
          line.range === null
            ? t(KIND_WORD[line.kind])
            : `${t(KIND_WORD[line.kind])} ${line.range}`,
        warn: line.problem !== null,
      };
    },
  );
  const rows = [facts.when, facts.reads, facts.changes, facts.gives, dependChips];
  return (
    <Section title="desktop.craft.review.section.how" id="how">
      {rows.every((r) => r.length === 0) ? (
        <p className={MUTED}>{t("desktop.craft.review.fact.none")}</p>
      ) : (
        <dl className="m-0 grid">
          <FactRow label="desktop.craft.review.fact.when" chips={facts.when.map(whenChip)} />
          <FactRow label="desktop.craft.review.fact.reads" chips={facts.reads.map(readsChip)} />
          <FactRow
            label="desktop.craft.review.fact.changes"
            chips={facts.changes.map(changesChip)}
          />
          <FactRow label="desktop.craft.review.fact.gives" chips={facts.gives.map(givesChip)} />
          <FactRow label="desktop.craft.review.fact.depends" chips={dependChips} />
        </dl>
      )}
      <ScreensBlock screens={facts.screens} />
      {item.kind === "update" && changes.length > 0 ? (
        <div className="grid gap-1.5 pt-1">
          <p className="m-0 text-ui-sm text-text-tertiary">
            {t("desktop.craft.review.does.changes")}
          </p>
          <ul className="m-0 grid gap-1 p-0">
            {changes.map(({ mark, entry }) => (
              <li
                key={`${mark}:${entry.row}:${entry.what}`}
                className="flex min-w-0 items-baseline gap-2 text-ui"
              >
                <span className={`rv-change-${mark} w-10 shrink-0 text-ui-sm`}>
                  {t(
                    mark === "added"
                      ? "desktop.craft.review.does.added"
                      : mark === "removed"
                        ? "desktop.craft.review.does.removed"
                        : "desktop.craft.review.does.changed",
                  )}
                </span>
                <ChangeLine
                  row={entry.row}
                  what={entry.what}
                  {...(entry.detail === undefined ? {} : { detail: entry.detail })}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

function AboutSection(props: { readonly card: PluginCard }): ReactNode {
  const purpose = (props.card.purpose ?? "").trim();
  // 목적이 없으면 결정 칸이 채워 둔 기본 문장을 같이 보인다(m6R4). 기본 문장도 못 만들면 이전처럼 적어 달라고 한다
  const draft = purpose === "" ? purposeText(purposeDraftOf(props.card)) : "";
  return (
    <Section title="desktop.craft.review.section.about" id="about">
      {purpose !== "" ? (
        <p className="m-0 max-w-[72ch] text-ui-md-relaxed text-text-primary">{purpose}</p>
      ) : draft === "" ? (
        <NoticeLine tone="warning">{t("desktop.craft.review.does.purposeMissing")}</NoticeLine>
      ) : (
        <div className="grid max-w-[72ch] gap-1.5" data-slot="review-purpose-draft">
          <p className="m-0 text-ui-md-relaxed text-text-secondary">{draft}</p>
          <p className="m-0 text-ui-sm text-text-tertiary">
            {t("desktop.craft.review.does.purposeDrafted")}
          </p>
        </div>
      )}
    </Section>
  );
}

// ── 승인하면 실행될 것 ────────────────────────────────────────────────

const USE_WORD: Readonly<Record<ScriptUse, MessageId>> = {
  // 열린 정책(AGE-63): 셸 도구처럼 파일을 읽고 쓴다. "넓은 읽기"(가져온 훅의 샌드박스 설정, 쓰기는 프로젝트만)와 다른 값이다
  sandbox_full_access: "desktop.craft.review.run.usesFullAccess",
  system_tools: "desktop.craft.review.run.usesSystemTools",
  network: "desktop.craft.review.run.usesNetwork",
  user_full_access: "desktop.craft.review.run.usesUserFull",
  user_environment: "desktop.craft.review.run.usesUserEnv",
  read_wide: "desktop.craft.review.run.usesReadWide",
  write_project: "desktop.craft.review.run.usesWriteProject",
};

/**
 * 훅의 출처 위험 줄(m6R6): 다섯째 판의 위험 줄 모양(주의 색의 느낌표 없는 세모 + 무채색 글) 그대로. 프로젝트에서 왔으면 그 폴더를 고정폭 흐린 글로
 * 다음 줄에 둔다(긴 경로가 문장을 밀지 않게, 넘치면 말줄임과 title로 전체)
 */
function OriginLine(props: { readonly origin: HookOriginLine }): ReactNode {
  const { origin } = props;
  if (origin.kind === "unknown") {
    return (
      <NoticeLine as="li" tone="warning" slot="review-hook-origin">
        {t("desktop.craft.review.run.originUnknown")}
      </NoticeLine>
    );
  }
  return (
    <NoticeLine as="li" tone="warning" slot="review-hook-origin">
      <span className="block">{t("desktop.craft.review.run.originProject")}</span>
      {origin.label === null ? null : (
        <span className="rv-code block truncate text-text-tertiary" title={origin.label}>
          {origin.label}
        </span>
      )}
    </NoticeLine>
  );
}

/**
 * 가져온 훅(환경 모드)의 사실: 셸, 실행 파일(못 찾았으면 주의 줄), 읽는 파일과 지문. 엔진이 모르는 것은 모른다고 말한다(`refsKnown`)
 */
function EnvFacts(props: { readonly env: CardScriptEnv }): ReactNode {
  const { env } = props;
  const origin = hookOriginLineOf(env);
  return (
    <div className="grid gap-2" data-slot="review-env">
      <Facts>
        <Fact term={t("desktop.craft.review.run.shell")}>
          <span className="rv-code">{env.shell}</span>
        </Fact>
        {env.interpreter === null ? null : (
          <Fact term={t("desktop.craft.review.run.interpreter")}>
            <span className="rv-code">{env.interpreter}</span>
          </Fact>
        )}
        <Fact term={t("desktop.craft.review.run.refs")}>
          {!env.refsKnown ? (
            <span className="text-text-secondary">{t("desktop.craft.review.run.refsUnknown")}</span>
          ) : env.refs.length === 0 ? (
            <span className="text-text-secondary">{t("desktop.craft.review.run.refsNone")}</span>
          ) : (
            <ul className="m-0 grid gap-1 p-0">
              {env.refs.map((ref) => (
                <li key={ref.path} className="flex min-w-0 list-none items-baseline gap-2">
                  <span className="rv-code min-w-0 truncate" title={ref.path}>
                    {ref.path}
                  </span>
                  {ref.hash === null ? (
                    <span className="ms-auto shrink-0 text-ui-sm text-text-tertiary">
                      {t("desktop.craft.review.run.noHash")}
                    </span>
                  ) : (
                    <span className="rv-code ms-auto shrink-0 text-text-tertiary" title={ref.hash}>
                      {shortHash(ref.hash)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Fact>
        {env.versionHints.length === 0 ? null : (
          <Fact term={t("desktop.craft.review.run.versionHints")}>
            <span className="rv-code">{env.versionHints.join(", ")}</span>
          </Fact>
        )}
      </Facts>
      {env.missingTools.length === 0 && origin === null ? null : (
        <ul className="rv-lines m-0 p-0">
          {origin === null ? null : <OriginLine origin={origin} />}
          {env.missingTools.length === 0 ? null : (
            <NoticeLine as="li" tone="warning">
              {t("desktop.craft.review.run.missingTools", { names: env.missingTools.join(", ") })}
            </NoticeLine>
          )}
        </ul>
      )}
    </div>
  );
}

function RunRow(props: { readonly line: RunLine }): ReactNode {
  const { line } = props;
  const env = line.kind === "script" ? line.env : null;
  // 엔진은 `user_environment`를 가져온 훅(환경 모드)에만 싣는다(AGE-63, enPp6-b). 화면은 받은 값을 그대로 칩으로 보인다
  const uses = line.kind === "script" ? (line.uses ?? []) : [];
  // 가져온 훅은 엔진이 실제로 부르는 원래 명령 한 줄을 보인다(실행기와 인자를 이어 붙인 줄이 아니다)
  const command = env === null ? line.command : env.command;
  return (
    <li className="grid gap-2.5 rounded-xl px-3 py-3 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-ui-sm text-text-tertiary">
          {env !== null
            ? t("desktop.craft.review.run.imported")
            : line.kind === "script"
              ? t("desktop.craft.review.run.script")
              : t("desktop.craft.review.run.server")}
        </span>
        <span className="min-w-0 truncate text-ui-strong text-text-primary">{line.name}</span>
        <span className="ms-auto flex shrink-0 flex-wrap items-center gap-1.5">
          {uses.map((use) => (
            <Chip key={use} tone={use === "user_environment" ? "neutral" : "warning"}>
              {t(USE_WORD[use])}
            </Chip>
          ))}
          {line.kind === "script" ? (
            <span className="text-ui-sm text-text-tertiary">
              {t("desktop.craft.review.run.timeout", {
                seconds: Math.round(line.timeoutMs / 1000),
              })}
            </span>
          ) : null}
        </span>
      </div>
      {command === null ? (
        <p className="m-0 text-ui-sm text-text-tertiary">
          {t("desktop.craft.review.run.httpServer")}
        </p>
      ) : (
        <code className="block overflow-x-auto rounded-md bg-neutral-soft px-2 py-1.5 font-mono text-ui-sm whitespace-pre text-text-primary">
          {command}
        </code>
      )}
      {env === null ? null : <EnvFacts env={env} />}
      {line.envNames.length === 0 ? null : (
        <p className="m-0 text-ui-sm text-text-tertiary">
          {t("desktop.craft.review.run.env", { names: line.envNames.join(", ") })}
        </p>
      )}
      {/* 선언했지만 허용 목록 밖이라 넘어가지 않는 이름. 경고가 아니라 사실 안내이고 이름만 보인다(값은 카드에 없다) */}
      {line.kind !== "script" || line.envNotPassed.length === 0 ? null : (
        <p className="m-0 text-ui-sm text-text-tertiary" data-slot="review-env-not-passed">
          {t("desktop.craft.review.run.envNotPassed", { names: line.envNotPassed.join(", ") })}
        </p>
      )}
    </li>
  );
}

function RunsSection(props: { readonly card: PluginCard }): ReactNode {
  const lines = runLinesOf(props.card);
  return (
    <Section title="desktop.craft.review.section.runs" id="runs">
      {lines.length === 0 ? (
        <p className={MUTED}>{t("desktop.craft.review.run.none")}</p>
      ) : (
        <ul className="m-0 grid gap-2 p-0">
          {lines.map((line) => (
            <RunRow key={`${line.kind}:${line.name}`} line={line} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function RemovesSection(props: { readonly item: ReviewItem }): ReactNode {
  const removal = props.item.removal;
  if (removal === null) return null;
  return (
    <Section title="desktop.craft.review.section.removes" id="removes">
      <ul className="m-0 grid gap-1.5 p-0">
        <li className="list-none text-ui text-text-primary">
          {removal.affectedProfiles.length === 0
            ? t("desktop.craft.review.removes.noProfiles")
            : t("desktop.craft.review.removes.profiles", {
                names: removal.affectedProfiles.map((p) => p.title).join(", "),
              })}
        </li>
        {removal.removes.state ? (
          <NoticeLine as="li" tone="warning">
            {t("desktop.craft.review.removes.state")}
          </NoticeLine>
        ) : null}
        {removal.removes.records === null ? null : (
          <li className="list-none text-ui text-text-secondary">
            {t("desktop.craft.review.removes.records", { count: removal.removes.records })}
          </li>
        )}
      </ul>
    </Section>
  );
}

/** 상세 배치. `band`가 배포 판이다. 개발 빌드는 버린 두 안(`rail`, `stack`)을 견주어 볼 수 있다(`review-dev.tsx`) */
export type DetailArrange = "band" | "rail" | "stack";

/** 자세히 전체: 요약 띠, 읽는 열, 판단 열. 좁은 창은 `review.css`의 컨테이너 질의가 한 열로 접는다 */
export function ReviewDetail(props: {
  readonly item: ReviewItem;
  readonly versions: Versions;
  readonly profiles: readonly Profile[];
  readonly missing: ReadonlyMap<string, readonly string[]>;
  readonly managedOff: boolean;
  readonly offline: boolean;
  readonly threadTitle: string | null;
  readonly now: number;
  readonly data: Pick<ReviewData, "file" | "decide">;
  readonly decided: Decided | null;
  readonly onDecided: (itemId: string, decided: Decided) => void;
  readonly onNext: (() => void) | null;
  readonly handleRef: Ref<DecisionHandle>;
  readonly fileRef: Ref<FileHandle>;
  readonly arrange: DetailArrange;
}): ReactNode {
  const { item } = props;
  const headingId = useId();
  // 지우는 항목의 카드는 지난 승인 버전의 카드다(엔진의 `removal.baseCard`)
  const card = item.kind === "remove" ? (item.removal?.baseCard ?? item.card) : item.card;
  return (
    <div className="rv-detail-host">
      <article aria-labelledby={headingId} className="rv-detail" data-arrange={props.arrange}>
        <ReviewHead
          item={item}
          versions={props.versions}
          threadTitle={props.threadTitle}
          now={props.now}
          headingId={headingId}
        />
        <div className="rv-read" data-slot="review-read">
          <AboutSection card={card} />
          <HowSection item={item} card={card} />
          {item.kind === "remove" ? (
            <RemovesSection item={item} />
          ) : (
            <>
              <RunsSection card={item.card} />
              <Section title="desktop.craft.review.section.files" id="files">
                <FilesSection item={item} data={props.data} fileRef={props.fileRef} />
              </Section>
            </>
          )}
        </div>
        <JudgeColumn
          item={item}
          versions={props.versions}
          profiles={props.profiles}
          missing={props.missing}
          managedOff={props.managedOff}
          offline={props.offline}
          threadTitle={props.threadTitle}
          now={props.now}
          data={props.data}
          decided={props.decided}
          onDecided={props.onDecided}
          onNext={props.onNext}
          handleRef={props.handleRef}
        />
      </article>
    </div>
  );
}

export type { Decided, DecisionHandle } from "./review-judge.tsx";
export type { FileHandle } from "./review-files.tsx";
