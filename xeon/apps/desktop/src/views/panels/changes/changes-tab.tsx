import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Dialog,
  SegmentedControl,
  SegmentedControlItem,
  Timeline,
  TimelineItem,
  Tooltip,
} from "@caustic/react";
import { Diamond, Maximize2, Terminal } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useContext, useMemo, useState, type ReactNode } from "react";
import {
  useOpenThreadId,
  useOpenTranscript,
  useTurnSummaries,
} from "../../../state/engine/index.ts";
import { MessageActionsContext } from "../../convo/message-actions.tsx";
import { ProgressOrb } from "../../effects/progress-orb.tsx";
import { FileChangeDiff } from "../../file-change-view.tsx";
import { ListSkeleton } from "../../pages/shared/panel-parts.tsx";
import { relativeAgeOf } from "../../pages/shared/relative-age.ts";
import { useClockNow } from "../../approval-card/clock.ts";
import { PanelEmpty, PanelSection } from "../panel-kit.tsx";
import {
  changedTurnsOf,
  changesOf,
  pathPartsOf,
  rewindOf,
  type ChangeTurn,
  type ChangesView,
  type FileChange,
  type UntrackedCall,
} from "./changes-model.ts";

// 변경 탭(DP-198~200, 시안 _notes/design/dz/dzR5-design.md §3). 이 대화가 바꾼 파일을 전체와 턴별로 보이고, 턴 끝으로 대화를 되감는다.
// 값은 열린 대화의 확정 item에서 모은다(`changes-model.ts`). 파일 되돌리기는 엔진에 없어 되감기 확인에서 그 사실을 말한다.

type ChangesMode = "all" | "turns";

/** 추적 밖 호출을 처음에 보이는 수. 나머지는 "더 보기"로 편다 */
const UNTRACKED_HEAD = 8;

export function ChangesTab(): ReactNode {
  const threadId = useOpenThreadId();
  if (threadId === null) {
    return <PanelEmpty title={t("desktop.changes.empty.noThread")} />;
  }
  return <ThreadChanges key={threadId} threadId={threadId} />;
}

function ThreadChanges(props: { readonly threadId: ThreadId }): ReactNode {
  const transcript = useOpenTranscript(props.threadId);
  const turns = useTurnSummaries(props.threadId);
  const [mode, setMode] = useState<ChangesMode>("all");
  const view = useMemo(
    () =>
      transcript.status === "ready"
        ? changesOf({ itemIds: transcript.itemIds, items: transcript.items, turns })
        : null,
    [transcript, turns],
  );
  if (transcript.status === "error") {
    return <PanelEmpty title={t("desktop.changes.error")} />;
  }
  if (view === null || transcript.status !== "ready") {
    return <ListSkeleton label={t("desktop.changes.loading")} />;
  }
  if (view.files.length === 0 && view.untracked.length === 0) {
    return (
      <PanelEmpty
        title={t("desktop.changes.empty.message")}
        body={t("desktop.changes.empty.body")}
      />
    );
  }
  return (
    <div data-panel="changes" className="grid grid-cols-1 min-w-0 gap-3">
      <div className="flex h-7 min-w-0 items-center gap-2">
        <span className="text-ui-strong text-text-primary">
          {t("desktop.changes.summary.files", { count: view.files.length })}
        </span>
        <LineCounts added={view.added} removed={view.removed} wholeWrite={false} />
        <span className="flex-1" />
        <SegmentedControl
          size="sm"
          aria-label={t("desktop.changes.mode.label")}
          value={mode}
          onValueChange={(next) => {
            setMode(next === "turns" ? "turns" : "all");
          }}
        >
          <SegmentedControlItem value="all">{t("desktop.changes.mode.all")}</SegmentedControlItem>
          <SegmentedControlItem value="turns">
            {t("desktop.changes.mode.turns")}
          </SegmentedControlItem>
        </SegmentedControl>
      </div>
      {mode === "all" ? (
        <AllChanges view={view} />
      ) : (
        <TurnChanges view={view} threadId={props.threadId} />
      )}
      {transcript.truncated ? (
        <p className="m-0 text-footnote text-text-tertiary">{t("desktop.changes.truncated")}</p>
      ) : null}
    </div>
  );
}

/** "+12 −3". 지운 줄이 없으면 −는 빼고, 전체 쓰기가 끼어 있으면 더한 줄 수에 그 사실을 툴팁으로 붙인다 */
function LineCounts(props: {
  readonly added: number;
  readonly removed: number;
  readonly wholeWrite: boolean;
}): ReactNode {
  const added = <span className="text-success-text">+{props.added}</span>;
  return (
    <span className="inline-flex flex-none items-center gap-1.5 text-ui-sm tabular-nums">
      {props.wholeWrite ? (
        <Tooltip content={t("desktop.changes.wholeWrite")} side="top">
          <span data-whole-write>{added}</span>
        </Tooltip>
      ) : (
        added
      )}
      {props.removed === 0 ? null : <span className="text-danger-text">−{props.removed}</span>}
    </span>
  );
}

function FileName(props: { readonly path: string }): ReactNode {
  const { name, dir } = pathPartsOf(props.path);
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5" title={props.path}>
      <span className="min-w-0 truncate text-ui-strong text-text-primary">{name}</span>
      {dir === "" ? null : (
        <span className="min-w-0 flex-1 truncate text-footnote text-text-tertiary">{dir}</span>
      )}
    </span>
  );
}

/** 파일 줄 묶음. 줄을 누르면 그 파일의 diff가 아래에 펼쳐진다 */
function FileList(props: {
  readonly files: readonly FileChange[];
  readonly view: ChangesView;
  /** 턴 안에서 그리면 턴 머리를 diff 위에 다시 적지 않는다 */
  readonly inTurn: boolean;
}): ReactNode {
  return (
    <Accordion type="multiple" size="sm" className="min-w-0 grid-cols-1">
      {props.files.map((file) => (
        <AccordionItem key={file.path} value={file.path} data-file={file.path} className="min-w-0">
          <AccordionTrigger>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <FileName path={file.path} />
              {file.pending ? <ProgressOrb /> : null}
              <LineCounts added={file.added} removed={file.removed} wholeWrite={file.wholeWrite} />
            </span>
          </AccordionTrigger>
          <AccordionContent className="max-w-none pb-3">
            <FileDiffs file={file} view={props.view} inTurn={props.inTurn} />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function turnLabelOf(turn: ChangeTurn): string {
  return turn.number === 0
    ? t("desktop.changes.turn.before")
    : t("desktop.changes.turn.number", { number: turn.number });
}

/** 파일 하나를 바꾼 호출들의 diff. 맨 위에 "크게 보기"(대화 상자에 같은 diff를 넓게) */
function FileDiffs(props: {
  readonly file: FileChange;
  readonly view: ChangesView;
  readonly inTurn: boolean;
}): ReactNode {
  const [wide, setWide] = useState(false);
  const wideButton = (
    <Button
      size="xs"
      variant="ghost"
      iconStart={<Maximize2 aria-hidden />}
      className="flex-none"
      onClick={() => {
        setWide(true);
      }}
    >
      {t("desktop.changes.wide")}
    </Button>
  );
  const diffs = (withButton: boolean): ReactNode => (
    <div className="grid grid-cols-1 min-w-0 gap-3">
      {props.file.edits.map((edit, index) => {
        const turn = props.view.turns[edit.turnIndex];
        const label =
          props.inTurn || turn === undefined
            ? null
            : `${turnLabelOf(turn)}${turn.prompt === null ? "" : ` · ${turn.prompt}`}`;
        const button = withButton && index === 0 ? wideButton : null;
        return (
          <div key={edit.callId} className="grid grid-cols-1 min-w-0 gap-1.5">
            {label === null && button === null ? null : (
              <div className="flex min-h-6 min-w-0 items-center gap-2">
                <p className="m-0 min-w-0 flex-1 truncate text-footnote text-text-tertiary">
                  {label}
                </p>
                {button}
              </div>
            )}
            <FileChangeDiff view={edit.view} />
          </div>
        );
      })}
    </div>
  );
  return (
    <div className="grid grid-cols-1 min-w-0">
      {diffs(true)}
      <Dialog
        open={wide}
        onOpenChange={setWide}
        size="lg"
        title={pathPartsOf(props.file.path).name}
        description={props.file.path}
        showClose
        closeLabel={t("desktop.changes.wide.close")}
      >
        <div className="max-h-[calc(var(--app-vh)*0.7)] min-w-0 overflow-auto">{diffs(false)}</div>
      </Dialog>
    </div>
  );
}

function AllChanges(props: { readonly view: ChangesView }): ReactNode {
  const { view } = props;
  return (
    <div className="grid grid-cols-1 min-w-0 gap-5">
      {view.files.length === 0 ? null : <FileList files={view.files} view={view} inTurn={false} />}
      {view.untracked.length === 0 ? null : (
        <PanelSection
          title={t("desktop.changes.untracked.title")}
          info={t("desktop.changes.untracked.help")}
          count={view.untracked.length}
        >
          <UntrackedList calls={view.untracked} view={view} showTurn />
        </PanelSection>
      )}
    </div>
  );
}

function UntrackedList(props: {
  readonly calls: readonly UntrackedCall[];
  readonly view: ChangesView;
  readonly showTurn: boolean;
}): ReactNode {
  const [all, setAll] = useState(false);
  const shown = all ? props.calls : props.calls.slice(0, UNTRACKED_HEAD);
  return (
    <div className="grid grid-cols-1 min-w-0">
      <ul className="m-0 grid list-none p-0">
        {shown.map((call) => {
          const turn = props.view.turns[call.turnIndex];
          return (
            <li
              key={call.callId}
              data-untracked={call.kind}
              className="flex min-h-8 min-w-0 items-center gap-1.5 text-ui"
            >
              {call.kind === "command" ? (
                <Terminal aria-hidden className="size-icon-sm flex-none text-text-tertiary" />
              ) : (
                <Diamond aria-hidden className="size-icon-sm flex-none text-text-tertiary" />
              )}
              <span
                className={`min-w-0 flex-1 truncate ${call.kind === "command" ? "font-mono text-ui-sm" : "text-ui"} text-text-secondary`}
                title={call.text}
              >
                {call.kind === "agent" && call.agent !== null ? (
                  <span className="text-text-primary">{call.agent} </span>
                ) : null}
                {call.text}
              </span>
              {call.state === "pending" ? <ProgressOrb /> : null}
              {props.showTurn && turn !== undefined ? (
                <span className="flex-none text-footnote text-text-tertiary tabular-nums">
                  {turnLabelOf(turn)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {props.calls.length > UNTRACKED_HEAD ? (
        <div>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setAll(!all);
            }}
          >
            {all
              ? t("desktop.changes.untracked.less")
              : t("desktop.changes.untracked.more", {
                  count: props.calls.length - UNTRACKED_HEAD,
                })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ageText(at: string | null, nowMs: number): string | undefined {
  if (at === null) return undefined;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return undefined;
  const age = relativeAgeOf(ms, nowMs);
  return t(age.id, age.args);
}

function turnDetailOf(turn: ChangeTurn): string {
  const parts: string[] = [];
  if (turn.files.length > 0) {
    parts.push(t("desktop.changes.summary.files", { count: turn.files.length }));
    parts.push(
      turn.removed === 0
        ? `+${String(turn.added)}`
        : `+${String(turn.added)} −${String(turn.removed)}`,
    );
  }
  if (turn.untracked.length > 0) {
    parts.push(t("desktop.changes.turn.untracked", { count: turn.untracked.length }));
  }
  return parts.join(" · ");
}

/**
 * 턴별 보기(caustic Timeline). 턴을 고르면 그 끝으로 대화를 되감는 단추가 나오고, 확인 단계에서 무엇이 바뀌고 무엇이 남는지 말한다.
 * 고른 턴은 고리로 표시하지 않는다(DP-209 [결정: 2026-11-15 사용자]): Timeline을 neutral·ghost로 써서 마디의 테두리 고리를 빼고
 * (점은 같은 자리의 채운 점), 고른 상태는 턴 머리(제목·요약 두 줄을 한 단추로)의 면(selection 연한 채움)과 말의 글자색(secondary → primary)이 말한다
 */
function TurnChanges(props: {
  readonly view: ChangesView;
  readonly threadId: ThreadId;
}): ReactNode {
  const { view } = props;
  const port = useContext(MessageActionsContext);
  const turns = changedTurnsOf(view);
  const [picked, setPicked] = useState<string>("");
  const [failed, setFailed] = useState(false);
  const nowMs = useClockNow();
  const pickedTurn = turns.find((turn) => String(turn.index) === picked);
  const rewind = pickedTurn === undefined ? null : rewindOf(view, pickedTurn);
  const note =
    rewind?.kind === "busy"
      ? t("desktop.changes.rewind.busy")
      : rewind?.kind === "latest"
        ? t("desktop.changes.rewind.latest")
        : failed
          ? t("desktop.changes.rewind.failed")
          : undefined;
  return (
    <Timeline
      aria-label={t("desktop.changes.mode.turns")}
      size="lg"
      tone="neutral"
      variant="ghost"
      restore={rewind?.kind === "ok" && port !== null ? "item" : "none"}
      restoreLabel={t("desktop.changes.rewind.label")}
      cancelLabel={t("desktop.convo.cancel")}
      note={note}
      onRestore={() => {
        if (rewind?.kind !== "ok" || port === null) return;
        setFailed(false);
        detach(
          port.rewindTo(props.threadId, rewind.target).then((done) => {
            if (!done.ok) setFailed(true);
            else setPicked("");
            return undefined;
          }),
          rethrow,
        );
      }}
    >
      {turns.map((turn) => {
        const id = String(turn.index);
        const selected = picked === id;
        const turnRewind = rewindOf(view, turn);
        return (
          <TimelineItem
            key={id}
            itemId={id}
            author="human"
            selected={selected}
            title={
              <button
                type="button"
                data-changes-turn-head=""
                className={`-mx-2 -my-1 grid w-[calc(100%+1rem)] min-w-0 cursor-pointer rounded-md border-0 px-2 py-1 text-start text-inherit outline-none transition-colors duration-quick focus-visible:focus-ring ${selected ? "bg-neutral-soft" : "bg-transparent hover:bg-neutral-hover"}`}
                aria-pressed={selected}
                onClick={() => {
                  setFailed(false);
                  setPicked(selected ? "" : id);
                }}
              >
                <span className="min-w-0 truncate">
                  {turnLabelOf(turn)}
                  {turn.prompt === null ? null : (
                    <span
                      className={`font-normal ${selected ? "text-text-primary" : "text-text-secondary"}`}
                    >
                      {" "}
                      · {turn.prompt}
                    </span>
                  )}
                </span>
                <span className="min-w-0 truncate text-ui-sm font-normal text-text-tertiary">
                  {turnDetailOf(turn)}
                </span>
              </button>
            }
            time={turn.running ? <ProgressOrb /> : ageText(turn.startedAt, nowMs)}
            {...(turn.startedAt === null ? {} : { dateTime: turn.startedAt })}
            confirmMessage={
              turnRewind.kind === "ok"
                ? t("desktop.changes.rewind.confirm", { count: turnRewind.dropsTurns })
                : undefined
            }
          >
            <div className="grid grid-cols-1 min-w-0 gap-1 pt-1.5">
              {turn.files.length === 0 ? null : <FileList files={turn.files} view={view} inTurn />}
              {turn.untracked.length === 0 ? null : (
                <UntrackedList calls={turn.untracked} view={view} showTurn={false} />
              )}
            </div>
          </TimelineItem>
        );
      })}
    </Timeline>
  );
}
