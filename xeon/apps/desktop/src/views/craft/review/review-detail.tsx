// 리뷰 항목 하나의 자세히(C5, craft-flows 6.12, AGE-34 둘째 판). 카드 면에 가두지 않고 목록 오른쪽 콘텐츠 영역 전체를 쓴다.
// 배치(`review.css`의 `.rv-detail`): 위에 요약 띠(무엇이, 어디서, 무엇을 하려는지, 버전) → 아래 두 열.
//   가운데 넓은 열 = 읽는 것: 설명 → 작동 방식(시점 / 입력 / 영향 / 출력) → 승인하면 실행될 것 → 바뀌는 파일(전·후 차이).
//   오른쪽 좁은 열 = 판단하는 것(`review-judge.tsx`): 코드 실행 경고, 권한과 위험, 출처, 넣을 곳, 거절·승인. 열이 따로 스크롤해
//   긴 차이를 읽는 동안에도 경고와 결정 단추가 남는다.
// 섹션 문법은 캔버스 상세 패널(cv4)과 같다(제목 15/600, 아이콘 없음, 섹션 사이 가는 선).
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type {
  CardScriptEnv,
  HookKind,
  HookPower,
  PluginCard,
  ScriptUse,
} from "@fresnel/contracts/extensions";
import type { DiffRow as CardDiffRow, Profile, ReviewItem } from "@fresnel/contracts/wire";
import { useId, type ReactNode, type Ref } from "react";
import {
  changeWhatOf,
  workFactsOf,
  type ChangePart,
  type ChangesFact,
  type GivesFact,
  type ReadsFact,
  type WhenFact,
} from "./review-facts.ts";
import { FilesSection, type FileHandle } from "./review-files.tsx";
import { KindTile } from "./review-glyphs.tsx";
import { JudgeColumn, type Decided, type DecisionHandle } from "./review-judge.tsx";
import {
  entryKindOf,
  keeperOf,
  kindsOf,
  primaryKindOf,
  purposeDraftOf,
  runLinesOf,
  shortHash,
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
          <p className="m-0 truncate text-ui text-text-tertiary">
            {t(ACTION_WORD[entry])}
            {" · "}
            {originText(item, props.threadTitle)}
            {" · "}
            {agoText(item.createdAt, props.now)}
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
        key: "ui",
        word: t("desktop.craft.review.fact.gives.ui", { count: fact.count }),
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
    <div className="flex items-start gap-3 py-[3px]">
      <dt className="w-12 shrink-0 pt-[3px] text-ui-sm leading-4 text-text-tertiary">
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
function ChangeLine(props: {
  readonly row: CardDiffRow;
  readonly what: string;
  readonly detail?: string;
}): ReactNode {
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

function HowSection(props: { readonly item: ReviewItem; readonly card: PluginCard }): ReactNode {
  const { item } = props;
  const facts = workFactsOf(props.card);
  const diff = item.diff;
  const changes = [
    ...diff.added.map((entry) => ({ mark: "added" as const, entry })),
    ...diff.changed.map((entry) => ({ mark: "changed" as const, entry })),
    ...diff.removed.map((entry) => ({ mark: "removed" as const, entry })),
  ];
  const rows = [facts.when, facts.reads, facts.changes, facts.gives];
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
        </dl>
      )}
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
  system_tools: "desktop.craft.review.run.usesSystemTools",
  network: "desktop.craft.review.run.usesNetwork",
  user_full_access: "desktop.craft.review.run.usesUserFull",
  user_environment: "desktop.craft.review.run.usesUserEnv",
  read_wide: "desktop.craft.review.run.usesReadWide",
  write_project: "desktop.craft.review.run.usesWriteProject",
};

/**
 * 가져온 훅(환경 모드)의 사실: 셸, 실행 파일(못 찾았으면 주의 줄), 읽는 파일과 지문. 엔진이 모르는 것은 모른다고 말한다(`refsKnown`)
 */
function EnvFacts(props: { readonly env: CardScriptEnv }): ReactNode {
  const { env } = props;
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
      {env.missingTools.length === 0 && !env.fromProject ? null : (
        <ul className="rv-lines m-0 p-0">
          {env.missingTools.length === 0 ? null : (
            <NoticeLine as="li" tone="warning">
              {t("desktop.craft.review.run.missingTools", { names: env.missingTools.join(", ") })}
            </NoticeLine>
          )}
          {env.fromProject ? (
            <NoticeLine as="li" tone="warning">
              {t("desktop.craft.review.run.fromProject")}
            </NoticeLine>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function RunRow(props: { readonly line: RunLine }): ReactNode {
  const { line } = props;
  const uses = line.kind === "script" && line.uses !== null ? line.uses : [];
  const env = line.kind === "script" ? line.env : null;
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
