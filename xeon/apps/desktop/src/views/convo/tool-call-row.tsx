import { Button, toast } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { ItemId, ItemRecord, JsonObject, ThreadId } from "@fresnel/contracts/conversation";
import { useEffect, useState, type ReactNode } from "react";
import {
  useEngineState,
  useItem,
  useLinkPhase,
  useOpenThreadRunning,
  useToolApprovals,
  useToolCallAwaitingApproval,
  useToolInterventions,
  useToolProgress,
  useToolResult,
} from "../../state/engine/index.ts";
import { fileChangeViewOfArgs, type FileChangeView } from "../approval-form.ts";
import { engineGoneOf } from "../composer-model.ts";
import { useDesktopShell, type DesktopShell } from "../desktop-shell-context.ts";
import { useOpenExtensionRecords } from "../extension-records-link.ts";
import { FileChangeDiff } from "../file-change-view.tsx";
import type { HookDenialView } from "../hook-denial-model.ts";
import { toolRowModeOf } from "../item-detail-model.ts";
import { stripAnsi } from "../tool-output-model.ts";
import type { SandboxBlockView } from "../sandbox-block-model.ts";
import { WEB_TOOLS, webSourcesOf } from "../tool-extras-model.ts";
import { useTranscriptDetail } from "../transcript-detail.ts";
import { interventionTagsOf } from "./intervention-model.ts";
import { revealFullOutput } from "./reveal-full-output.ts";
import { SourceChips } from "./source-chips.tsx";
import { ToolLine, useDisclosure, type LineStatus } from "./tool-line.tsx";
import { failureLineOf } from "./activity-model.ts";
import {
  commandMetaOf,
  failureToneOf,
  pathDenialLineOf,
  toolHeadOf,
  toolResultOf,
  type ToolOutcome,
  type ToolResultView,
} from "./tool-view-model.ts";
import { MetaParts } from "../meta-parts.tsx";
import { FixPluginLink } from "../plugin/fix-plugin-link.tsx";
import { trialThreadOf } from "../authoring-row-model.ts";
import { TrialChatLink } from "./trial-chat-link.tsx";

// 도구 호출 하나의 줄(dzT2a 시안 3.3). 결과·진행 출력·개입·승인 기록을 구독해 `ToolLine`에 넘긴다. 결과가 오면 같은 줄이 결과를 따른다.

/** 실행 중 출력 꼬리로 보일 줄 수 */
const TAIL_LINES = 5;

/** 실행 중인 동안 1초마다 늘어나는 경과 초 */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [active]);
  return active ? seconds : 0;
}

/** 이 호출이 도는 중인가. 엔진이 없으면 열린 대화가 돈다고 해도 더 돌지 않는다 */
export function useCallRunning(): boolean {
  const engineGone = engineGoneOf(useEngineState(), useLinkPhase());
  return useOpenThreadRunning() && !engineGone;
}

/** 같은 메시지에서 이 호출보다 앞선 호출 id(앞선 호출이 승인을 기다리면 이 호출도 줄 서 기다린다) */
function earlierCallIdsOf(item: ItemRecord | undefined, callId: string): readonly string[] {
  if (item?.kind !== "assistant") return [];
  const out: string[] = [];
  for (const block of item.message.content) {
    if (block.type !== "toolCall") continue;
    if (block.id === callId) return out;
    out.push(block.id);
  }
  return out;
}

function diffStatsOf(view: FileChangeView): string | null {
  if (view.kind === "write")
    return t("desktop.convo.lines", { count: view.head.length + view.hiddenLines });
  const rows = [...view.head, ...view.rest];
  const add = rows.filter((row) => row.kind === "add").length;
  const del = rows.filter((row) => row.kind === "remove").length;
  return add + del === 0 ? null : `+${add} −${del}`;
}

function DiffStats(props: { readonly view: FileChangeView }): ReactNode {
  const { view } = props;
  if (view.kind === "write") return diffStatsOf(view);
  const rows = [...view.head, ...view.rest];
  const add = rows.filter((row) => row.kind === "add").length;
  const del = rows.filter((row) => row.kind === "remove").length;
  if (add + del === 0) return null;
  return (
    <>
      <span className="convo-add">+{add}</span> <span className="convo-del">−{del}</span>
    </>
  );
}

/** 샌드박스가 막은 것의 한국어 이유 글 */
function sandboxBlockText(block: SandboxBlockView): string {
  switch (block.code) {
    case "sandbox.network_blocked":
      return t("desktop.tool.blocked.network", { domain: block.domain });
    case "sandbox.write_blocked":
      return t("desktop.tool.blocked.write", { path: block.path });
    case "sandbox.read_blocked":
      return t("desktop.tool.blocked.read", { path: block.path });
    default:
      return assertNever(block, "SandboxBlockView");
  }
}

const SANDBOX_NOTE_LIMIT = 5;

/** 막힘 이유 줄. 접힌 줄에서도 보인다 */
function SandboxNotes(props: { readonly blocks: readonly SandboxBlockView[] }): ReactNode {
  const { blocks } = props;
  if (blocks.length === 0) return null;
  const shown = blocks.slice(0, SANDBOX_NOTE_LIMIT);
  const rest = blocks.length - shown.length;
  return (
    <ul className="m-0 ml-5 grid list-none gap-0.5 p-0">
      {shown.map((block) => (
        <li
          key={`${block.code}:${"domain" in block ? block.domain : block.path}`}
          className="convo-note"
          data-tone="warning"
        >
          {sandboxBlockText(block)}
        </li>
      ))}
      {rest > 0 ? (
        <li className="convo-note" data-tone="warning">
          {t("desktop.tool.blocked.more", { count: rest })}
        </li>
      ) : null}
    </ul>
  );
}

/** 결과 글 상자 */
export function OutputBox(props: {
  readonly text: string;
  readonly tone?: "danger" | undefined;
  readonly cut?: ToolResultView["cut"] | undefined;
  readonly leading?: ToolResultView["leading"] | undefined;
}): ReactNode {
  const shell = useDesktopShell();
  return (
    <>
      {props.leading === undefined || props.leading === null ? null : (
        <div className="grid gap-0.5 text-footnote text-text-tertiary">
          <p className="m-0">{t("desktop.item.output.leadingOmitted")}</p>
          {props.leading.fullOutputPath === null ? null : (
            <p className="m-0 flex min-w-0 items-baseline gap-2">
              <span className="flex-none">{t("desktop.item.output.fullPath")}</span>
              <span className="min-w-0 break-all font-mono select-text">
                {props.leading.fullOutputPath}
              </span>
              {shell === null ? null : (
                <RevealFullOutputButton shell={shell} path={props.leading.fullOutputPath} />
              )}
            </p>
          )}
        </div>
      )}
      {props.text === "" ? null : (
        <pre className="convo-output" data-tone={props.tone} tabIndex={0}>
          {props.text}
        </pre>
      )}
      {props.cut === undefined || props.cut === null ? null : (
        <p className="m-0 text-footnote text-text-tertiary">
          {t("desktop.item.output.partial", { total: props.cut.total, shown: props.cut.shown })}
        </p>
      )}
    </>
  );
}

/** "전체 출력" 경로 옆의 "폴더에서 보기" 단추. 웹처럼 셸이 없으면 부르는 쪽이 그리지 않는다 */
function RevealFullOutputButton(props: {
  readonly shell: Pick<DesktopShell, "invoke">;
  readonly path: string;
}): ReactNode {
  return (
    <Button
      size="xs"
      variant="ghost"
      className="flex-none"
      onClick={() => {
        detach(
          revealFullOutput(props.shell, props.path).then((result) => {
            if (result !== "revealed") {
              toast({
                tone: "danger",
                title: t(
                  result === "missing"
                    ? "desktop.item.output.revealMissing"
                    : "desktop.item.output.revealFailed",
                ),
              });
            }
            return undefined;
          }),
          rethrow,
        );
      }}
    >
      {t("desktop.item.output.reveal")}
    </Button>
  );
}

/** 확장이 오류를 낸 거부의 "기록 보기" 단추. 확장 이름이 없거나 열 곳(문맥)이 없으면 그리지 않는다 */
function HookRecordsLink(props: { readonly hook: HookDenialView }): ReactNode {
  const openRecords = useOpenExtensionRecords();
  const { hook } = props;
  if (hook.outcome !== "threw" || hook.extension === null || openRecords === null) return null;
  const extension = hook.extension;
  return (
    <div className="justify-self-start">
      <Button
        size="xs"
        variant="ghost"
        onClick={() => {
          openRecords(extension);
        }}
      >
        {t("desktop.item.hookDenial.records")}
      </Button>
    </div>
  );
}

function argsText(args: JsonObject): string {
  return JSON.stringify(args, null, 2);
}

export function lineStatusOf(input: {
  readonly outcome: ToolOutcome | null;
  readonly running: boolean;
  readonly awaiting: boolean;
  readonly seconds: number;
}): LineStatus {
  if (input.outcome !== null) {
    return input.outcome.kind === "done"
      ? { kind: "done" }
      : { kind: "failed", failure: input.outcome.failure };
  }
  if (!input.running) return { kind: "failed", failure: "interrupted" };
  return {
    kind: "running",
    awaiting: input.awaiting,
    label: input.awaiting
      ? t("desktop.item.toolAwaitingApproval")
      : input.seconds > 0
        ? t("desktop.item.toolRunningFor", { seconds: input.seconds })
        : t("desktop.item.toolRunning"),
  };
}

/** 줄 상태의 표시 정도 판정용 값 */
export function rowStatusOf(status: LineStatus): "done" | "failed" | "running" {
  return status.kind === "running" ? "running" : status.kind === "failed" ? "failed" : "done";
}

/** 결과 item의 화면 값(없으면 null). 줄과 묶음 머리가 같이 쓴다 */
export function resultViewOf(result: ItemRecord | undefined): ToolResultView | null {
  return result === undefined ? null : toolResultOf(result);
}

export function CallRow(props: {
  readonly threadId: ThreadId;
  readonly itemId: ItemId;
  readonly callId: string;
  readonly name: string;
  readonly args: JsonObject;
  /** 접힌 묶음 안: 실패·도는 중·개입이 있는 줄만 그린다 */
  readonly flaggedOnly?: boolean;
  /**
   * 묶음 안의 줄(DP-154): 상태는 작은 표시 하나(경과 초·알약 없음, 머리가 말한다)이고, 실패 줄은 오류 상자를 접은 채
   * 한 줄 요약으로 시작한다
   */
  readonly grouped?: boolean;
}): ReactNode {
  const { threadId, callId, name, args } = props;
  const item = useItem(props.itemId);
  const result = useToolResult(callId);
  const running = useCallRunning();
  const awaiting = useToolCallAwaitingApproval(callId, earlierCallIdsOf(item, callId));
  const progress = useToolProgress(threadId, callId);
  const interventions = useToolInterventions(threadId, callId);
  const approvals = useToolApprovals(threadId, callId);
  const detailSetting = useTranscriptDetail();
  const view = resultViewOf(result);
  const pending = view === null && running;
  const seconds = useElapsedSeconds(pending && !awaiting);
  const status = lineStatusOf({ outcome: view?.outcome ?? null, running, awaiting, seconds });
  const mode = toolRowModeOf(detailSetting, rowStatusOf(status));
  const change = fileChangeViewOfArgs(name, args);
  const grouped = props.grouped === true;
  // 혼자 선 실패 줄은 펼친다(묶음 안 실패 줄은 접고 한 줄 요약). 파일 변경은 "모두 보기"에서 펼친다. 요약 설정에서는 실패만 펼친다
  // 결과 없이 끊긴 줄(되살아난 호출)은 펼칠 것이 인자뿐이라 접힌 한 줄로 둔다(AGE-78)
  const cutOff = view === null && status.kind === "failed" && status.failure === "interrupted";
  const want =
    mode === "default" &&
    ((status.kind === "failed" &&
      status.failure !== "badArgs" &&
      status.failure !== "pathBlocked" &&
      !grouped &&
      !cutOff) ||
      (change !== null && status.kind === "done" && detailSetting === "full"));
  const [open, toggle] = useDisclosure(want);
  if (mode === "hidden") return null;
  const head = toolHeadOf(name, args, view?.server ?? null);
  const tags = interventionTagsOf(interventions, approvals);
  if (props.flaggedOnly === true && status.kind === "done" && tags.length === 0) return null;
  const isCommand = head.icon === "command";
  const sources =
    WEB_TOOLS.includes(name) && view?.outcome.kind === "done" ? webSourcesOf(view.output) : [];
  const tail =
    pending && isCommand && progress !== null
      ? progress.lines.slice(-TAIL_LINES).map(stripAnsi)
      : [];
  const commandParts = isCommand && view !== null ? commandMetaOf(view) : [];
  const meta =
    change !== null ? (
      <DiffStats view={change} />
    ) : commandParts.length === 0 ? null : (
      <span className="inline-flex items-baseline gap-2">
        <MetaParts parts={commandParts} />
      </span>
    );
  const commandFull =
    isCommand &&
    head.target.kind === "command" &&
    (head.target.text.includes("\n") || head.target.text.length > 80)
      ? head.target.text
      : null;
  const detail =
    view === null ? (
      head.argsDetail ? (
        <OutputBox text={argsText(args)} />
      ) : null
    ) : (
      <>
        {head.argsDetail ? <OutputBox text={argsText(args)} /> : null}
        {commandFull === null ? null : <OutputBox text={commandFull} />}
        {change === null || view.outcome.kind !== "done" ? null : <FileChangeDiff view={change} />}
        {change !== null && view.outcome.kind === "done" ? null : (
          <OutputBox
            text={view.output}
            tone={
              view.outcome.kind === "failed" && view.outcome.failure === "failed"
                ? "danger"
                : undefined
            }
            cut={view.cut}
            leading={view.leading}
          />
        )}
        {view.hook === null ? null : <HookRecordsLink hook={view.hook} />}
        {open ? <FixPluginLink tool={name} /> : null}
      </>
    );
  const hasDetail = detail !== null;
  const trialThread =
    view === null || view.outcome.kind !== "done" ? null : trialThreadOf(name, view.output);
  // 묶음 안 실패 줄의 한 줄 요약. 펼치면 상자가 같은 글을 보이므로 감춘다
  // 도구 인자 검증 오류(`badArgs`)는 묶음 밖에서도 접고, 영어 원문 대신 한 줄을 보인다. 원문은 펼치면 나온다
  const badArgs =
    view !== null && view.outcome.kind === "failed" && view.outcome.failure === "badArgs";
  // 작업 폴더 경계가 막은 줄(`pathBlocked`)도 같다: 한국어 한 줄이 먼저이고 원문은 펼치면 나온다
  const failLine = badArgs
    ? open
      ? null
      : t("desktop.item.badArgs.line")
    : view !== null &&
        view.pathDenial !== null &&
        view.outcome.kind === "failed" &&
        view.outcome.failure === "pathBlocked"
      ? open
        ? null
        : pathDenialLineOf(view.pathDenial)
      : grouped && !open && view !== null && view.outcome.kind === "failed"
        ? failureLineOf(view.output)
        : null;
  return (
    <ToolLine
      compact={grouped}
      icon={head.icon}
      verb={status.kind === "running" ? head.verbRunning : head.verb}
      rawName={head.rawName}
      quiet={head.quiet}
      target={head.target}
      server={head.server}
      tags={tags}
      meta={meta}
      status={head.quiet && status.kind === "done" ? { kind: "none" } : status}
      {...(hasDetail ? { detail, open, onToggle: toggle } : {})}
      below={
        <>
          {failLine === null || view === null || view.outcome.kind !== "failed" ? null : (
            <p
              className="convo-fail-line"
              data-tone={failureToneOf(view.outcome.failure)}
              title={failLine}
            >
              {failLine}
            </p>
          )}
          {tail.length === 0 ? null : <div className="convo-tail">{tail.join("\n")}</div>}
          {view === null ? null : <SandboxNotes blocks={view.blocks} />}
          {trialThread === null ? null : <TrialChatLink threadId={trialThread} />}
          <SourceChips sources={sources} />
        </>
      }
    />
  );
}

/** 짝이 되는 호출이 화면에 없는 결과 item 한 줄 */
export function OrphanResultRow(props: { readonly id: ItemId }): ReactNode {
  const item = useItem(props.id);
  const detailSetting = useTranscriptDetail();
  const view = item === undefined ? null : toolResultOf(item);
  const status: LineStatus =
    view === null
      ? { kind: "none" }
      : view.outcome.kind === "done"
        ? { kind: "done" }
        : { kind: "failed", failure: view.outcome.failure };
  const mode = toolRowModeOf(detailSetting, rowStatusOf(status));
  const [open, toggle] = useDisclosure(mode === "default" && status.kind === "failed");
  if (item?.kind !== "toolResult" || view === null || mode === "hidden") return null;
  return (
    <ToolLine
      icon="other"
      verb={item.message.toolName}
      rawName
      target={{ kind: "none" }}
      server={view.server}
      status={status}
      detail={<OutputBox text={view.output} cut={view.cut} leading={view.leading} />}
      open={open}
      onToggle={toggle}
      below={<SandboxNotes blocks={view.blocks} />}
    />
  );
}
