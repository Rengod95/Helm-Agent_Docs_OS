// 리뷰 항목 하나의 상세(C5, craft-flows 6.12). 두 판(가·나)이 같은 본문을 쓴다.
// 순서는 중요도 순이다: 머리(무엇이, 어디서, 무엇을 하려는지) → 늘 보이는 코드 실행 안내 → 승인하면 실행될 것 → 하는 일 →
// 바뀌는 파일 → 권한과 위험 → 출처 → 승인하면(또는 지우면) → 결정 줄. 섹션 제목은 14/600이고 아이콘을 달지 않는다.
// 겉면은 받은 요청 카드와 같은 값이다(rounded-xl, p-4, 테두리 subtle, 아이콘 타일 28, 제목 13/500).
import { t, type MessageId } from "@fresnel/client/i18n";
import { Badge, Button, cn, Select, SelectOption, Textarea } from "@caustic/react";
import { Check, ChevronDown, ChevronRight, ChevronUp, X } from "@caustic/react/icons";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type { DiffRow, Profile, ReviewItem } from "@fresnel/contracts/wire";
import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { FileChangeDiff } from "../../file-change-view.tsx";
import type { FileChangeView } from "../../approval-form.ts";
import { KindGlyph, KindTile } from "./review-glyphs.tsx";
import {
  approveBlockOf,
  approveDecisionOf,
  approveOutcomeOf,
  codeNoticeOf,
  decideFailureOf,
  defaultTargetOf,
  entryKindOf,
  fileRowsOf,
  firstFileOf,
  kindsOf,
  placesOf,
  primaryKindOf,
  rejectDecisionOf,
  runLinesOf,
  shortHash,
  sizeOf,
  stepFile,
  warningsOf,
  type ApproveOutcome,
  type DecideFailure,
  type EntryKind,
  type FileRow,
  type Place,
  type PluginKind,
  type RunLine,
  type Target,
  type Warning,
} from "./review-model.ts";
import type { ReviewData } from "./review-source.ts";

export const ENTRY_WORD: Readonly<Record<EntryKind, MessageId>> = {
  install: "desktop.craft.review.group.install",
  update: "desktop.craft.review.group.update",
  draft: "desktop.craft.review.group.draft",
  remove: "desktop.craft.review.group.remove",
};

const ACTION_WORD: Readonly<Record<EntryKind, MessageId>> = {
  install: "desktop.craft.review.action.install",
  update: "desktop.craft.review.action.update",
  draft: "desktop.craft.review.action.draft",
  remove: "desktop.craft.review.action.remove",
};

const KIND_WORD: Readonly<Record<PluginKind, MessageId>> = {
  drive: "desktop.craft.review.kind.drive",
  hook: "desktop.craft.review.kind.hook",
  tool: "desktop.craft.review.kind.tool",
  inject: "desktop.craft.review.kind.inject",
};

/** 어디서 왔는지 한 줄. 대화에서 만든 것은 그 대화의 이름을 쓴다(거울에 있으면) */
function originText(item: ReviewItem, threadTitle: string | null): string {
  if (item.kind === "remove") return t("desktop.craft.review.origin.request");
  if (item.originThreadId !== null) {
    return threadTitle === null
      ? t("desktop.craft.review.origin.thread")
      : t("desktop.craft.review.origin.threadNamed", { title: threadTitle });
  }
  switch (item.provenance) {
    case "user_instruction":
      return t("desktop.craft.review.origin.instruction");
    case "project":
      return t("desktop.craft.review.origin.project");
    case "migration":
      return t("desktop.craft.review.origin.migration");
    case "bundled":
      return t("desktop.craft.review.origin.bundled");
    case "unknown":
      return t("desktop.craft.review.origin.unknown");
    case "assistant":
      return t("desktop.craft.review.origin.folder");
    default:
      return assertNever(item.provenance, "review provenance");
  }
}

/** 올라온 때를 짧게(방금, n분 전, n시간 전, n일 전) */
export function agoText(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return t("desktop.craft.review.ago.now");
  if (minutes < 60) return t("desktop.craft.review.ago.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("desktop.craft.review.ago.hours", { count: hours });
  return t("desktop.craft.review.ago.days", { count: Math.floor(hours / 24) });
}

/** 상태 칩(outlined). 결정 결과와 항목 종류를 같은 모양으로 쓴다 */
const CHIP_TONE: Readonly<Record<"neutral" | "warning", string>> = {
  neutral: "",
  warning: "text-warning-text shadow-[inset_0_0_0_1px_var(--cs-color-warning-border)]",
};

function Chip(props: {
  readonly tone?: "neutral" | "warning";
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Badge size="sm" variant="outline" className={CHIP_TONE[props.tone ?? "neutral"]}>
      {props.children}
    </Badge>
  );
}

/** 종류 칩: 종류 색의 그림 + 이름. 종류를 가르는 데만 색을 쓴다 */
function KindChip(props: { readonly kind: PluginKind }): ReactNode {
  return (
    <span
      className={`rv-kind-${props.kind} inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-ui-sm text-text-secondary shadow-[inset_0_0_0_1px_var(--cs-color-border-default)]`}
    >
      <span className="rv-kind-text inline-flex">
        <KindGlyph kind={props.kind} size={11} />
      </span>
      {t(KIND_WORD[props.kind])}
    </span>
  );
}

/** 머리: 종류 타일 28, 이름 13/500, 아래 한 줄은 "무엇을 하려는지 · 어디서", 칩 줄은 타일 왼끝에서 시작한다 */
export function ReviewHead(props: {
  readonly item: ReviewItem;
  readonly threadTitle: string | null;
  readonly now: number;
  readonly headingId?: string;
  readonly trailing?: ReactNode;
}): ReactNode {
  const { item } = props;
  const entry = entryKindOf(item);
  return (
    <header className="grid gap-2.5">
      <div className="flex min-w-0 items-start gap-3">
        <KindTile kind={primaryKindOf(item.card)} size={28} />
        <div className="grid min-w-0 flex-1 gap-0.5 pt-px">
          <h2
            id={props.headingId}
            className="m-0 truncate text-ui-strong text-text-primary"
            title={item.card.displayName}
          >
            {item.card.displayName}
          </h2>
          <p className="m-0 truncate text-ui-sm text-text-tertiary">
            {t(ACTION_WORD[entry])}
            {" · "}
            {originText(item, props.threadTitle)}
            {" · "}
            {agoText(item.createdAt, props.now)}
          </p>
        </div>
        {props.trailing}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip>{t(ENTRY_WORD[entry])}</Chip>
        {kindsOf(item.card).map((kind) => (
          <KindChip key={kind} kind={kind} />
        ))}
        <Chip tone={item.card.enforcement === "enforced" ? "warning" : "neutral"}>
          {item.card.enforcement === "enforced"
            ? t("desktop.craft.review.chip.enforced")
            : t("desktop.craft.review.chip.advisory")}
        </Chip>
      </div>
    </header>
  );
}

/** 코드 실행 안내. 경고라 아이콘 뒤에 숨기지 않고 늘 보인다 [결정: AGE-14] */
export function CodeNotice(props: { readonly card: PluginCard }): ReactNode {
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
      className="rv-code-notice m-0 rounded-md px-3 py-2 text-ui"
    >
      {t("desktop.craft.review.code.notice")}
      {extra.length === 0 ? null : <> {extra.join(" ")}</>}
    </p>
  );
}

function Section(props: {
  readonly title: MessageId;
  readonly children: ReactNode;
  readonly id?: string;
}): ReactNode {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-2.5" data-section={props.id}>
      <h3 id={id} className="m-0 text-title-3 font-semibold text-text-primary">
        {t(props.title)}
      </h3>
      {props.children}
    </section>
  );
}

const MUTED = "m-0 text-ui text-text-secondary";

function RunRow(props: { readonly line: RunLine }): ReactNode {
  const { line } = props;
  const uses =
    line.kind === "script" && line.uses !== null
      ? line.uses.map((use) =>
          use === "network"
            ? t("desktop.craft.review.run.usesNetwork")
            : t("desktop.craft.review.run.usesSystemTools"),
        )
      : [];
  return (
    <li className="grid gap-1.5 rounded-lg px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-ui-sm text-text-tertiary">
          {line.kind === "script"
            ? t("desktop.craft.review.run.script")
            : t("desktop.craft.review.run.server")}
        </span>
        <span className="min-w-0 truncate text-ui-strong text-text-primary">{line.name}</span>
        <span className="ms-auto flex shrink-0 items-center gap-1.5">
          {uses.map((use) => (
            <Chip key={use} tone="warning">
              {use}
            </Chip>
          ))}
          {line.kind === "script" ? (
            <span className="text-ui-sm text-text-tertiary tabular-nums">
              {t("desktop.craft.review.run.timeout", {
                seconds: Math.round(line.timeoutMs / 1000),
              })}
            </span>
          ) : null}
        </span>
      </div>
      {line.command === null ? (
        <p className="m-0 text-ui-sm text-text-tertiary">
          {t("desktop.craft.review.run.httpServer")}
        </p>
      ) : (
        <code className="block overflow-x-auto rounded-md bg-neutral-soft px-2 py-1.5 font-mono text-ui-sm whitespace-pre text-text-primary">
          {line.command}
        </code>
      )}
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

const PLACE_WORD: Readonly<Record<Place["group"], MessageId>> = {
  input: "desktop.craft.review.place.input",
  request: "desktop.craft.review.place.request",
  tool: "desktop.craft.review.place.tool",
  turn: "desktop.craft.review.place.turn",
  thread: "desktop.craft.review.place.thread",
  other: "desktop.craft.review.place.other",
};

function placeText(place: Place): string {
  const word = t(PLACE_WORD[place.group]);
  if (place.side === "before") return t("desktop.craft.review.place.before", { place: word });
  if (place.side === "after") return t("desktop.craft.review.place.after", { place: word });
  return t("desktop.craft.review.place.at", { place: word });
}

const ROW_WORD: Readonly<Record<DiffRow, MessageId>> = {
  inject: "desktop.craft.review.row.inject",
  hook: "desktop.craft.review.row.hook",
  drive: "desktop.craft.review.row.drive",
  runs: "desktop.craft.review.row.runs",
  setting: "desktop.craft.review.row.setting",
  replaces: "desktop.craft.review.row.replaces",
};

/** 두 칸짜리 정의 줄(이름 칸 112px) */
function Fact(props: { readonly term: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-3">
      <dt className="text-ui-sm text-text-tertiary">{props.term}</dt>
      <dd className="m-0 min-w-0 text-ui text-text-primary [overflow-wrap:anywhere]">
        {props.children}
      </dd>
    </div>
  );
}

function DoesSection(props: { readonly item: ReviewItem }): ReactNode {
  const { item } = props;
  const places = placesOf(item.card);
  const diff = item.diff;
  const changes = [
    ...diff.added.map((entry) => ({ mark: "added" as const, entry })),
    ...diff.changed.map((entry) => ({ mark: "changed" as const, entry })),
    ...diff.removed.map((entry) => ({ mark: "removed" as const, entry })),
  ];
  const purpose = (item.card.purpose ?? "").trim();
  return (
    <Section title="desktop.craft.review.section.does" id="does">
      {purpose === "" ? (
        <p className="rv-caution m-0 text-ui">{t("desktop.craft.review.does.purposeMissing")}</p>
      ) : (
        <p className="m-0 text-ui text-text-primary">{purpose}</p>
      )}
      {places.length === 0 ? null : (
        <dl className="m-0 grid gap-1.5">
          <Fact term={t("desktop.craft.review.does.places")}>
            {places.map(placeText).join(", ")}
          </Fact>
        </dl>
      )}
      {item.kind === "update" && changes.length > 0 ? (
        <div className="grid gap-1.5">
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
                <span className="shrink-0 text-ui-sm text-text-tertiary">
                  {t(ROW_WORD[entry.row])}
                </span>
                <span className="min-w-0 truncate text-text-primary" title={entry.detail}>
                  {entry.what}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

const CHANGE_WORD: Readonly<Record<FileRow["change"], MessageId>> = {
  added: "desktop.craft.review.files.change.added",
  changed: "desktop.craft.review.files.change.changed",
  removed: "desktop.craft.review.files.change.removed",
  same: "desktop.craft.review.files.change.same",
};
const CHANGE_MARK: Readonly<Record<FileRow["change"], string>> = {
  added: "+",
  changed: "~",
  removed: "−",
  same: "·",
};

type FileText =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly text: string | null; readonly truncated: boolean };

const PREVIEW_LINES = 80;

/**
 * 파일 본문을 그림으로. 이전 내용을 엔진이 주지 않으므로 줄 차이가 아니라 쓸 내용의 앞줄이다(기호 없음).
 * 새 파일을 모두 더한 줄로 칠하면 화면 전체가 초록으로 물들어 쓰지 않는다. 새 파일인지는 파일 줄의 + 표시가 말한다
 */
function viewOf(path: string, text: string): FileChangeView {
  const lines = text.replace(/\n$/, "").split("\n");
  return {
    kind: "write",
    path,
    head: lines.slice(0, PREVIEW_LINES),
    hiddenLines: Math.max(0, lines.length - PREVIEW_LINES),
  };
}

/** 바이트 크기 글(1.2 KB) */
function sizeText(bytes: number): string {
  const size = sizeOf(bytes);
  return `${String(size.value)} ${size.unit}`;
}

function FilesSection(props: {
  readonly item: ReviewItem;
  readonly base: ReviewItem | null;
  readonly data: Pick<ReviewData, "file">;
  readonly fileRef: Ref<FileHandle>;
}): ReactNode {
  const { item, base, data } = props;
  const rows = fileRowsOf(item, base);
  const changed = rows.filter((row) => row.change !== "same");
  const same = rows.length - changed.length;
  const [current, setCurrent] = useState<string | null>(() => firstFileOf(rows));
  // 읽은 본문은 경로와 함께 둔다. 고른 경로와 다르면 아직 읽는 중이다(효과 안에서 상태를 바로 바꾸지 않는다)
  const [read, setRead] = useState<{ readonly path: string; readonly text: FileText } | null>(null);
  const row = rows.find((r) => r.path === current) ?? null;
  // 엔진은 대기 중인 항목의 본문만 준다(승인하면 후보 폴더가 버전 폴더로 옮겨 간다). 결정한 뒤에는 목록만 보인다
  const open = item.state === "pending";
  const readable = open && row?.readable === true;
  const text: FileText = read !== null && read.path === current ? read.text : { status: "loading" };

  useImperativeHandle(props.fileRef, () => ({
    step: (delta) => {
      setCurrent((now) => stepFile(rows, now, delta));
    },
  }));

  useEffect(() => {
    if (current === null || !readable) return undefined;
    let live = true;
    const run = async (): Promise<void> => {
      const got = await data.file(item.itemId, current);
      if (!live) return;
      setRead({
        path: current,
        text: got.ok
          ? { status: "ready", text: got.value.text, truncated: got.value.truncated }
          : { status: "failed" },
      });
    };
    detach(run(), rethrow);
    return () => {
      live = false;
    };
  }, [data, item.itemId, current, readable]);

  if (item.kind === "remove") return null;
  const basis =
    item.baseHash === null
      ? t("desktop.craft.review.files.noBase")
      : base === null
        ? t("desktop.craft.review.files.baseUnknown")
        : t("desktop.craft.review.files.base", { hash: shortHash(item.baseHash) ?? "" });
  const shown = changed.length > 0 ? changed : rows;
  return (
    <Section title="desktop.craft.review.section.files" id="files">
      <p className="m-0 text-ui-sm text-text-tertiary">{basis}</p>
      {rows.length === 0 ? (
        <p className={MUTED}>{t("desktop.craft.review.files.none")}</p>
      ) : (
        <div className="grid gap-2">
          <ul className="m-0 grid gap-px p-0" aria-label={t("desktop.craft.review.section.files")}>
            {shown.map((r) => {
              const on = r.path === current;
              return (
                <li key={r.path} className="list-none">
                  <button
                    type="button"
                    disabled={!open || (!r.readable && r.change !== "removed")}
                    aria-current={on ? "true" : undefined}
                    onClick={() => {
                      setCurrent(r.path);
                    }}
                    className={cn(
                      "flex h-control-sm w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-ui outline-none focus-visible:shadow-focus",
                      // 카드(surface-base) 위라 control-raised는 밝은 판에서 보이지 않는다
                      on ? "bg-neutral-selected" : "hover:bg-neutral-hover",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={`rv-change-${r.change} w-3 shrink-0 text-center font-mono`}
                    >
                      {CHANGE_MARK[r.change]}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-text-primary">
                      {r.path}
                    </span>
                    <span className="sr-only">{t(CHANGE_WORD[r.change])}</span>
                    <span className="shrink-0 text-ui-sm text-text-tertiary tabular-nums">
                      {sizeText(r.bytes)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {same > 0 && changed.length > 0 ? (
            <p className="m-0 ps-2 text-ui-sm text-text-tertiary">
              {t("desktop.craft.review.files.sameCount", { count: same })}
            </p>
          ) : null}
          {!open ? (
            <p className="m-0 ps-2 text-ui-sm text-text-tertiary">
              {t("desktop.craft.review.files.closed")}
            </p>
          ) : row === null ? null : (
            <div className="grid gap-1.5" aria-live="polite">
              <div className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-text-secondary">
                  {row.path}
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={t("desktop.craft.review.files.prev")}
                  title={`${t("desktop.craft.review.files.prev")} · [`}
                  className="w-control-xs px-0"
                  onClick={() => {
                    setCurrent((now) => stepFile(rows, now, -1));
                  }}
                >
                  <ChevronUp aria-hidden="true" className="size-3.5" />
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={t("desktop.craft.review.files.next")}
                  title={`${t("desktop.craft.review.files.next")} · ]`}
                  className="w-control-xs px-0"
                  onClick={() => {
                    setCurrent((now) => stepFile(rows, now, 1));
                  }}
                >
                  <ChevronDown aria-hidden="true" className="size-3.5" />
                </Button>
              </div>
              <FileBody row={row} text={text} />
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function FileBody(props: { readonly row: FileRow; readonly text: FileText }): ReactNode {
  const { row, text } = props;
  if (!row.readable) return <p className={MUTED}>{t("desktop.craft.review.files.removedNote")}</p>;
  if (text.status === "loading") {
    return (
      <p role="status" className={MUTED}>
        {t("desktop.craft.review.files.loading")}
      </p>
    );
  }
  if (text.status === "failed") {
    return <p className="m-0 text-ui text-danger-text">{t("desktop.craft.review.files.failed")}</p>;
  }
  if (text.text === null) return <p className={MUTED}>{t("desktop.craft.review.files.binary")}</p>;
  return (
    <div className="grid gap-1.5">
      {row.change === "changed" ? (
        <p className="m-0 text-ui-sm text-text-tertiary">
          {t("desktop.craft.review.files.oldMissing")}
        </p>
      ) : null}
      <FileChangeDiff view={viewOf(row.path, text.text)} />
      {text.truncated ? (
        <p className="m-0 text-ui-sm text-text-tertiary">
          {t("desktop.craft.review.files.truncated")}
        </p>
      ) : null}
    </div>
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
  // 목적 문장 없음은 하는 일 섹션과 결정 줄이 말하므로 여기서 되풀이하지 않는다
  const warnings = warningsOf(item, props.managedOff).filter((w) => w !== "purposeMissing");
  const always = item.diff.costDelta.always;
  return (
    <Section title="desktop.craft.review.section.risk" id="risk">
      <dl className="m-0 grid gap-1.5">
        <Fact term={t("desktop.craft.review.risk.enforcement")}>
          {item.card.enforcement === "enforced"
            ? t("desktop.craft.review.risk.enforced")
            : t("desktop.craft.review.risk.advisory")}
        </Fact>
      </dl>
      {warnings.length === 0 && (always === null || always === 0) ? (
        <p className={MUTED}>{t("desktop.craft.review.risk.none")}</p>
      ) : (
        <ul className="m-0 grid gap-1 p-0">
          {warnings.map((w) =>
            w === "costUp" ? null : (
              <li
                key={w}
                className={cn(
                  "rv-caution list-none text-ui",
                  w === "handEdit" || w === "managedOff" ? "rv-caution-danger" : null,
                )}
              >
                {t(WARNING_WORD[w])}
              </li>
            ),
          )}
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
  readonly threadTitle: string | null;
  readonly now: number;
}): ReactNode {
  const { item } = props;
  return (
    <Section title="desktop.craft.review.section.source" id="source">
      <dl className="m-0 grid gap-1.5">
        <Fact term={t("desktop.craft.review.source.package")}>
          <span className="font-mono text-ui-sm">{item.name}</span>
        </Fact>
        <Fact term={t("desktop.craft.review.source.version")}>
          <span className="text-text-tertiary">
            {t("desktop.craft.review.source.versionMissing")}
          </span>
        </Fact>
        {item.candidateHash === null ? null : (
          <Fact term={t("desktop.craft.review.source.candidate")}>
            <span className="font-mono text-ui-sm" title={item.candidateHash}>
              {shortHash(item.candidateHash)}
            </span>
          </Fact>
        )}
        {item.baseHash === null ? null : (
          <Fact term={t("desktop.craft.review.source.base")}>
            <span className="font-mono text-ui-sm" title={item.baseHash}>
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
      </dl>
    </Section>
  );
}

function RemovesSection(props: { readonly item: ReviewItem }): ReactNode {
  const removal = props.item.removal;
  if (removal === null) return null;
  return (
    <Section title="desktop.craft.review.section.removes" id="removes">
      <ul className="m-0 grid gap-1 p-0">
        <li className="list-none text-ui text-text-primary">
          {removal.affectedProfiles.length === 0
            ? t("desktop.craft.review.removes.noProfiles")
            : t("desktop.craft.review.removes.profiles", {
                names: removal.affectedProfiles.map((p) => p.title).join(", "),
              })}
        </li>
        {removal.removes.state ? (
          <li className="rv-caution list-none text-ui">
            {t("desktop.craft.review.removes.state")}
          </li>
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

/** 파일 넘기기(키보드 [ ]가 부른다) */
export interface FileHandle {
  step(delta: 1 | -1): void;
}

/** 결정 줄의 바깥 동작(키보드가 부른다) */
export interface DecisionHandle {
  approve(): void;
  reject(): void;
}

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "rejecting" }
  | { readonly kind: "sending"; readonly what: "approve" | "reject" }
  | { readonly kind: "failed"; readonly failure: DecideFailure };

/** 결정 뒤 화면이 들고 있는 결과(목록의 "방금 결정함" 줄과 상세의 결과 판) */
export type Decided =
  | { readonly kind: "approved"; readonly outcome: ApproveOutcome; readonly removal: boolean }
  | { readonly kind: "sentBack" }
  | { readonly kind: "discarded" };

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

const LIBRARY = "__library__";

function targetValue(target: Target): string {
  return target.kind === "profile" ? target.profileId : LIBRARY;
}

/** 승인하면 어떻게 되는지와 결정(승인·거절). 거절 사유는 선택이다 */
function AfterAndDecide(props: {
  readonly item: ReviewItem;
  readonly profiles: readonly Profile[];
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
  const approveDisabled =
    props.offline || block !== null || sending || (needsPurpose && purpose.trim() === "");

  const send = (what: "approve" | "reject"): void => {
    const decision =
      what === "approve" ? approveDecisionOf(item, target, purpose) : rejectDecisionOf(reason);
    setPhase({ kind: "sending", what });
    const run = async (): Promise<void> => {
      const result = await props.data.decide(item.itemId, decision);
      if (!result.ok) {
        setPhase({ kind: "failed", failure: decideFailureOf(result.error) });
        return;
      }
      setPhase({ kind: "idle" });
      if (decision.kind === "approve") {
        props.onDecided(item.itemId, {
          kind: "approved",
          outcome: approveOutcomeOf(item, result.value.appliedTo, profiles),
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

  const after: ReactNode =
    item.kind === "remove" ? null : item.kind === "update" ? (
      <p className={MUTED}>{t("desktop.craft.review.after.update")}</p>
    ) : (
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ui-sm text-text-tertiary">
            {t("desktop.craft.review.after.target")}
          </span>
          <Select
            size="xs"
            variant="outline"
            aria-label={t("desktop.craft.review.after.target")}
            value={targetValue(target)}
            onValueChange={(value) => {
              setTarget(
                value === LIBRARY ? { kind: "library" } : { kind: "profile", profileId: value },
              );
            }}
          >
            {profiles.map((profile) => (
              <SelectOption key={profile.id} value={profile.id}>
                {profile.title}
              </SelectOption>
            ))}
            <SelectOption value={LIBRARY}>{t("desktop.craft.review.after.library")}</SelectOption>
          </Select>
        </div>
        <p className={MUTED}>
          {target.kind === "profile"
            ? t("desktop.craft.review.after.profileNote")
            : t("desktop.craft.review.after.libraryNote")}
        </p>
        <p className="rv-caution m-0 text-ui">{t("desktop.craft.review.after.restart")}</p>
      </div>
    );

  return (
    <>
      {after === null ? (
        <RemovesSection item={item} />
      ) : (
        <Section title="desktop.craft.review.section.after" id="after">
          {after}
          {needsPurpose ? (
            <label className="grid gap-1">
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
        </Section>
      )}
      <div
        data-slot="review-decide"
        className="sticky bottom-0 grid gap-2 border-t border-border-subtle bg-surface-base pt-3"
      >
        {phase.kind === "rejecting" || (phase.kind === "sending" && phase.what === "reject") ? (
          <label className="grid gap-1">
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
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {phase.kind === "failed" ? (
            <p role="alert" className="m-0 min-w-0 flex-1 text-ui text-danger-text">
              {t(
                phase.failure === "profileInvalid" && item.kind === "new"
                  ? "desktop.craft.review.failure.profileNew"
                  : FAILURE_WORD[phase.failure],
              )}
            </p>
          ) : props.offline ? (
            <p className="m-0 min-w-0 flex-1 text-ui text-text-tertiary">
              {t("desktop.craft.review.locked.offline")}
            </p>
          ) : block === "handEdit" ? (
            <p className="m-0 min-w-0 flex-1 text-ui text-danger-text">
              {t("desktop.craft.review.locked.handEdit")}
            </p>
          ) : sending ? (
            <p role="status" className="m-0 min-w-0 flex-1 text-ui-sm text-text-tertiary">
              {t("desktop.craft.review.sending")}
            </p>
          ) : (
            <span className="flex-1" />
          )}
          {phase.kind === "rejecting" || (phase.kind === "sending" && phase.what === "reject") ? (
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
    </>
  );
}

/** 결정 뒤의 결과 판. 승인이면 들어간 프로필과 다음에 할 일을 말한다 */
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
      className="grid gap-2 rounded-lg px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--cs-color-border-default)]"
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
        <>
          {decided.outcome.profiles.length > 0 ? (
            <p className={MUTED}>
              {t("desktop.craft.review.outcome.inProfiles", {
                names: decided.outcome.profiles.join(", "),
              })}{" "}
              {t("desktop.craft.review.after.profileNote")}
            </p>
          ) : decided.outcome.library ? (
            <p className={MUTED}>{t("desktop.craft.review.after.libraryNote")}</p>
          ) : null}
          {decided.outcome.restart ? (
            <p className="rv-caution m-0 text-ui">{t("desktop.craft.review.after.restart")}</p>
          ) : null}
        </>
      ) : null}
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

/** 상세 본문(머리 아래). 결정이 끝났으면 결정 줄 대신 결과 판을 둔다 */
export function ReviewBody(props: {
  readonly item: ReviewItem;
  readonly base: ReviewItem | null;
  readonly profiles: readonly Profile[];
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
}): ReactNode {
  const { item } = props;
  return (
    <div className="grid gap-6">
      {props.managedOff ? (
        <p role="note" className="rv-code-notice rv-notice-danger m-0 rounded-md px-3 py-2 text-ui">
          {t("desktop.craft.review.risk.managedOff")}
        </p>
      ) : null}
      {props.decided === null ? null : (
        <DecidedPanel decided={props.decided} onNext={props.onNext} />
      )}
      {item.kind === "remove" ? null : <CodeNotice card={item.card} />}
      {item.kind === "remove" ? null : <RunsSection card={item.card} />}
      <DoesSection item={item} />
      <FilesSection item={item} base={props.base} data={props.data} fileRef={props.fileRef} />
      <RiskSection item={item} managedOff={props.managedOff} />
      <SourceSection item={item} threadTitle={props.threadTitle} now={props.now} />
      {props.decided === null ? (
        <AfterAndDecide
          item={item}
          profiles={props.profiles}
          offline={props.offline}
          data={props.data}
          handleRef={props.handleRef}
          onDecided={props.onDecided}
        />
      ) : null}
    </div>
  );
}
