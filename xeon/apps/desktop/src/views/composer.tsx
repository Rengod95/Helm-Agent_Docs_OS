import { t } from "@fresnel/client/i18n";
import { Button, Chip, IconButton, Textarea } from "@caustic/react";
import { ArrowUp, LoaderCircle, Plus, RotateCw } from "@caustic/react/icons";
import type { CommandRowVM } from "@fresnel/client/settings";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  useAborting,
  useEngineState,
  useLinkPhase,
  useOpenThreadId,
  useQueuedInputs,
  useRetrying,
  useThreadRunning,
  useWriteAccessAllowed,
  type ProviderRetry,
} from "../state/engine/index.ts";
import {
  useComposerRequest,
  useDeniedModels,
  useObserving,
  useSelectedThreadId,
} from "../state/ui/index.ts";
import {
  attachDisabledReason,
  baseNameOf,
  chipsReady,
  dataSourceLimit,
  exceedsLimit,
  failureOf,
  readyParts,
  replaceChip,
  sourceOfFile,
  type AttachChip,
  type AttachmentSource,
  sendBlockedText,
} from "./attachment-model.ts";
import { AttachmentRow } from "./composer-attachments.tsx";
import { pickAttachmentFile } from "./folder-pick.ts";
import { useFolderPick } from "./folder-pick-context.ts";
import {
  useCommands,
  type AttachmentParts,
  type BusyInputMode,
  type CommandError,
} from "./commands.ts";
import { ModelChip, PermissionModeChip, ThinkingChip } from "./composer-chips.tsx";
import {
  busyModeOfEnter,
  chipInputs,
  composerDisabledReason,
  createEnterGuard,
  createSendLatch,
  engineGoneOf,
  looksLikeSecret,
  stopBlockedReasonOf,
  withdrawStateOf,
  type WithdrawState,
} from "./composer-model.ts";
import { retryLineOf } from "./retry-status-model.ts";
import {
  type ModeChangeError,
  useDefaultModel,
  useModelChoices,
  useThreadModel,
  useThreadPermissionMode,
  useThreadThinking,
} from "./model-usage.ts";
import { thinkingSelectableOf } from "./thinking-level-model.ts";
import {
  appSlashOf,
  slashFillOf,
  slashIssuesOf,
  slashMenuOf,
  slashMoveOf,
  unknownSlashOf,
  type SkillsVM,
  type SlashMenuRow,
} from "./composer-slash.ts";
import { runThreadCompact } from "./thread-compact.ts";
import { QueuedInputs, useHeldCount, useSendHeld } from "./queued-inputs.tsx";
import { useSetupNeeded } from "./setup-needed.ts";
import { ProblemLine } from "./pages/shared/problem-state.tsx";
import { Presence, SwapFade } from "../lib/motion-presets.tsx";

// 입력창. 입력 중인 글자는 이 부품만 쓰므로 로컬 상태다(FS-04).
// requestId는 같은 입력의 재시도가 같은 값을 쓰도록 실패했을 때 유지하고, 성공하면 새로 만든다(spec 4.13).
// ⌘L과 명령 팔레트의 슬래시 명령은 `ComposerRequest`로 온다. 받으면 초점을 주고 빈 입력창에만 글을 채운 뒤 요청을 지운다.

/** 이 입력창이 실행 중에 보낸 입력. 대기열 칩의 "지금 반영"이 철회한 뒤 같은 내용을 다시 보내는 데 쓴다 */
interface SentInput {
  readonly text: string;
  readonly parts: AttachmentParts;
}

function newRequestId(): string {
  return crypto.randomUUID();
}

function sendErrorText(error: CommandError): string {
  if (error.kind === "offline") return t("desktop.composer.error.offline");
  if (error.kind === "switching") return t("desktop.composer.error.switching");
  if (error.kind === "locked") return t("desktop.composer.error.locked");
  if (error.kind === "unsupported") return t("desktop.composer.error.unsupported");
  if (error.kind === "rejected" && error.code !== null) {
    return t("desktop.composer.error.rejected", { code: error.code });
  }
  return t("desktop.composer.error.failed");
}

/** 모델을 바꾸지 못했을 때의 문장. 잠김과 연결 끊김은 보낼 때와 같은 문장이고 나머지는 모델 문장이다 */
function modelErrorText(error: CommandError): string {
  if (error.kind === "offline" || error.kind === "switching" || error.kind === "locked") {
    return sendErrorText(error);
  }
  return t("desktop.composer.model.error");
}

/**
 * 승인 모드를 바꾸지 못했을 때의 문장. 잠김과 연결 끊김은 보낼 때와 같은 문장이다. 그 밖은 승인 모드 문장이다
 */
export function modeErrorText(error: ModeChangeError): string {
  const cause = error.error;
  if (cause.kind === "offline" || cause.kind === "switching" || cause.kind === "locked") {
    return sendErrorText(cause);
  }
  return t("desktop.composer.approvalMode.error");
}

/** 추론 레벨을 바꾸지 못했을 때의 문장. 잠김과 연결 끊김은 보낼 때와 같은 문장이고 나머지는 추론 레벨 문장이다 */
function thinkingErrorText(error: CommandError): string {
  if (error.kind === "offline" || error.kind === "switching" || error.kind === "locked") {
    return sendErrorText(error);
  }
  return t("desktop.composer.thinking.error");
}

/**
 * 입력창 아래 줄 틀. caustic 꼬리 줄의 보내기 칸은 줄어들지 못해(min-width auto) 900폭·150%에서 모델 칩이 보내기 단추를 창 밖으로 민다.
 * 보내기 칸이 줄어들게 하고(모델 칩의 글이 먼저 잘린다) 왼쪽 단추 칸(`+`)은 줄어들지 않게 한다.
 * 기본 높이는 84px다(DP-130, DP-67을 대체): 글 칸 48(위 12 + 글 줄 20 + 빈 16) + 꼬리 줄 36(28 단추 + 아래 8).
 * 꼬리 줄 왼쪽 6은 `+` 아이콘(28 칸 안 16)의 왼쪽 끝을 글의 왼쪽 끝(12)에 맞추고, 오른쪽 8은 보내기 단추를 아래 끝과 같은 8에 둔다
 */
export const COMPOSER_FOOTER_CLASS =
  "[&_[data-slot=textarea-footer]]:gap-2 [&_[data-slot=textarea-footer]]:pt-0 [&_[data-slot=textarea-footer]]:pb-2 [&_[data-slot=textarea-footer]]:pl-1.5 [&_[data-slot=textarea-footer]]:pr-2 [&_[data-slot=textarea-actions]]:shrink-0 [&_[data-slot=textarea-submit]]:min-w-0";

/** 입력창 안에서 제 동작이 있는 것. 이것 밖의 빈 곳(꼬리 줄의 틈, 칩 사이)을 누르면 글 칸에 초점이 간다(DP-131) */
const COMPOSER_CONTROL_SELECTOR =
  "button, a, input, textarea, select, label, [role=button], [role=menuitem], [role=menuitemradio], [role=option], [contenteditable=true]";

/** 누른 곳이 입력창 상자 안의 빈 곳인가. 제 동작이 있는 것(단추, 칩, 첨부, 글 칸 자체)은 아니다 */
export function composerBlankHit(
  target: { closest(selector: string): unknown },
  inBox: boolean,
): boolean {
  return inBox && target.closest(COMPOSER_CONTROL_SELECTOR) === null;
}

/**
 * 제공자 재시도를 기다리는 동안의 상태 줄. 남은 초는 1초마다 다시 센다. `clock`은 시험이 고정한다.
 * 진행 상태라 경고 빛이 아니고, 초가 매초 바뀌므로 실시간 영역(role=status)으로 알리지 않는다.
 */
export function RetryStatus(props: {
  readonly retry: ProviderRetry;
  readonly clock?: () => number;
}): ReactNode {
  const clock = props.clock ?? Date.now;
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(clock());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [clock]);
  const line = retryLineOf(props.retry, now);
  return (
    <p
      data-composer-retry
      className="m-0 flex min-h-7 items-center gap-2 px-1 text-ui text-text-secondary tabular-nums"
    >
      <RotateCw aria-hidden className="size-3.5 shrink-0 text-text-tertiary" />
      {line.soon
        ? t("desktop.composer.retryingSoon", { attempt: line.attempt, max: line.max })
        : t("desktop.composer.retrying", {
            attempt: line.attempt,
            max: line.max,
            seconds: line.seconds,
          })}
    </p>
  );
}

/** 선택된 대화의 입력창만 초점 요청을 받는다. 선택이 없으면 어느 입력창이든 받는다 */
export function ownsComposerRequest(selected: ThreadId | null, own: ThreadId): boolean {
  return selected === null || selected === own;
}

/**
 * 입력창 위 슬래시 목록의 한 행. 이름 뒤에 출처 칩(프로젝트·사용자)을 작게 붙이고, 인자 안내와 설명이 잇는다.
 * 칩이 없는 행(내장 명령 등)은 칩 자리가 비어 있다.
 */
export function SlashRow(props: {
  readonly row: SlashMenuRow;
  readonly selected: boolean;
  readonly onFill: () => void;
  readonly onHover: () => void;
}): ReactNode {
  const { row } = props;
  return (
    <li
      id={`composer-slash-${row.name}`}
      role="option"
      aria-selected={props.selected}
      className="flex cursor-default items-baseline gap-2 rounded-xl px-2.5 py-1.5 text-ui text-text-secondary aria-selected:bg-neutral-hover aria-selected:text-text-primary"
      onMouseDown={(event) => {
        event.preventDefault();
        props.onFill();
      }}
      onMouseEnter={() => {
        props.onHover();
      }}
    >
      <span className="text-ui-strong text-text-primary">{row.label}</span>
      {row.sourceChip === null ? null : (
        <Chip size="xs" variant="outline" data-composer-slash-source>
          {row.sourceChip}
        </Chip>
      )}
      {row.hint === null ? null : <span>{row.hint}</span>}
      <span className="min-w-0 truncate">{row.description}</span>
    </li>
  );
}

function ComposerFor(props: {
  readonly threadId: ThreadId;
  readonly disabledReason: string | null;
  /** 엔진이 없다(`engineGoneOf`). 그러면 대화가 실행 중이라고 말하지 않고 정지 단추를 누를 수 없게 한다 */
  readonly engineGone: boolean;
}): ReactNode {
  const commands = useCommands();
  // 거울의 실행 중 값은 엔진이 없으면 오래된 것이다. 실행 중이라는 판단(첨부 잠금, 사용량)은 엔진이 있을 때만 쓴다
  const threadRunning = useThreadRunning(props.threadId);
  // 제공자 재시도를 기다리는 중이면 입력창 위에 남은 초를 보인다(휘발, 응답이 오기 시작하면 사라진다)
  const retrying = useRetrying(props.threadId);
  const running = threadRunning && !props.engineGone;
  const stopBlocked = stopBlockedReasonOf(props.engineGone);
  // 이 대화의 모델(정하지 않았으면 기본 모델)과 문맥 사용량(model-usage.ts)
  const defaultModel = useDefaultModel();
  const threadModel = useThreadModel(props.threadId, defaultModel);
  // 이 대화의 승인 모드 칩(설정 l1.tools.permissionMode, 대화 범위). 모르는 동안은 칩을 그리지 않는다
  const permission = useThreadPermissionMode(props.threadId);
  const writeAccessAllowed = useWriteAccessAllowed(props.threadId);
  const thinking = useThreadThinking(props.threadId);
  const modelChoices = useModelChoices();
  const deniedModels = useDeniedModels();
  // 멈춤을 누른 뒤 실제로 멈출 때까지(`turn.abort_requested` 뒤 끝나기 전) 멈춤 단추가 "멈추는 중"을 보인다(DP-101)
  const aborting = useAborting(props.threadId);
  // 멈춘 뒤 보내기를 기다리는 대기 입력(DP-156). 빈 입력창의 보내기(↑, Enter)가 그것을 시작한다
  const held = useHeldCount(props.threadId, chipInputs(useQueuedInputs(props.threadId)));
  const sendHeld = useSendHeld(props.threadId);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const requestId = useRef<string>(newRequestId());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const request = useComposerRequest();
  const selectedThread = useSelectedThreadId();
  const folderPick = useFolderPick();
  const [chips, setChips] = useState<readonly AttachChip[]>([]);
  // 실행 중에 보낸 글은 기본이 대기열(끝난 뒤, followUp)이고 ⌘Enter가 바로 반영(steer)이다. 모드 토글은 두지 않는다(2026-11-08 사용자 결정).
  // 대기열 칩의 "지금 반영"은 철회한 뒤 같은 글을 steer로 다시 보내므로, 이 입력창이 보낸 글을 요청 id로 기억한다(거울의 미리보기는 120자에서 잘린다)
  const sent = useRef(new Map<string, SentInput>());
  const [dragging, setDragging] = useState(false);
  // 첨부가 막힌 때(턴이 도는 중 등) 끌어 놓은 파일을 받지 않았다는 안내. 막힘이 풀렸거나 다시 끌면 지운다
  const [dropRefused, setDropRefused] = useState(false);
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const limit = useRef<number | null>(null);
  // 슬래시 목록: 엔진 명령(`command.list`)은 `/`를 처음 칠 때 읽는다. 못 읽으면 null이라 앱 명령만 보이고 모르는 명령 확인은 하지 않는다
  const [engineRows, setEngineRows] = useState<readonly CommandRowVM[] | null>(null);
  // 이 대화에 실린 스킬(`knowledge.skills.list`). 못 읽으면(스킬 설정이 꺼짐 등) null이라 스킬 묶음이 없다
  const [skillsView, setSkillsView] = useState<SkillsVM | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [unknownName, setUnknownName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachBlocked = attachDisabledReason({
    composerReason: props.disabledReason,
    running,
  });
  // 경로로 올리는 길은 이 기기의 엔진일 때만 맞다. 원격 엔진이면 파일을 바이트로 보낸다
  const picker = commands.restore.engineTarget()?.kind === "remote" ? null : folderPick;

  useEffect(() => {
    detach(
      commands.attachmentLimit().then((value) => {
        limit.current = value;
        return null;
      }),
      rethrow,
    );
  }, [commands]);

  const startsSlash = draft.startsWith("/");
  useEffect(() => {
    if (!startsSlash) return undefined;
    let live = true;
    detach(
      commands.commandList(props.threadId).then((listed) => {
        if (live) setEngineRows(listed.ok ? listed.value : null);
        return undefined;
      }),
      rethrow,
    );
    detach(
      commands.skills.list(props.threadId).then((listed) => {
        if (live) setSkillsView(listed.ok ? listed.value : null);
        return undefined;
      }),
      rethrow,
    );
    return () => {
      live = false;
    };
  }, [commands, props.threadId, startsSlash]);
  const menuRows = menuDismissed ? [] : slashMenuOf(draft, engineRows ?? [], skillsView);
  const menuIssues = menuDismissed ? [] : slashIssuesOf(draft, skillsView);
  const menuActive = menuRows.length > 0;
  const activeRow = menuRows[Math.min(menuIndex, menuRows.length - 1)];

  const upload = async (id: string, source: AttachmentSource): Promise<void> => {
    const added = await commands.addAttachment(props.threadId, source);
    setChips((current) =>
      replaceChip(current, id, (chip) =>
        added.ok
          ? { ...chip, status: "ready", failure: null, parts: added.value.parts }
          : { ...chip, status: "failed", failure: failureOf(added.error, limit.current) },
      ),
    );
  };

  const addChip = (name: string, size: number | null, source: AttachmentSource): string => {
    const id = newRequestId();
    setChips((current) => [
      ...current,
      { id, name, size, source, status: "uploading", failure: null, parts: null },
    ]);
    return id;
  };

  const addFile = async (file: File): Promise<void> => {
    const name = file.name === "" ? t("desktop.composer.attach.pasted") : file.name;
    const fileLimit = dataSourceLimit(limit.current);
    if (exceedsLimit(file.size, fileLimit)) {
      // 큰 파일은 읽지 않고 바로 실패 칩을 보인다(다시 시도 없음). 한도는 한 요청에 실을 수 있는 크기다
      setChips((current) => [
        ...current,
        {
          id: newRequestId(),
          name,
          size: file.size,
          source: { kind: "data", data: "-", mime: "application/octet-stream" },
          status: "failed",
          failure: { kind: "tooLarge", limit: fileLimit },
          parts: null,
        },
      ]);
      return;
    }
    const source = await sourceOfFile(file);
    const id = addChip(name, file.size, source);
    await upload(id, source);
  };

  const addFiles = async (files: readonly File[]): Promise<void> => {
    setAttachNote(null);
    await Promise.all(files.map(addFile));
  };

  const pickFile = async (): Promise<void> => {
    if (picker === null) {
      fileInput.current?.click();
      return;
    }
    const picked = await pickAttachmentFile(picker);
    if (!picked.ok) {
      setAttachNote(t("desktop.composer.attach.error.pickFailed"));
      return;
    }
    if (picked.value === undefined) return;
    setAttachNote(null);
    const source: AttachmentSource = { kind: "path", path: picked.value };
    const id = addChip(baseNameOf(picked.value), null, source);
    detach(upload(id, source), rethrow);
  };

  const retry = (id: string): void => {
    const chip = chips.find((c) => c.id === id);
    if (chip === undefined) return;
    setChips((current) =>
      replaceChip(current, id, (c) => ({ ...c, status: "uploading", failure: null })),
    );
    detach(upload(id, chip.source), rethrow);
  };

  const onDrop = (event: DragEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setDragging(false);
    if (attachBlocked !== null) {
      setDropRefused(true);
      return;
    }
    detach(addFiles([...event.dataTransfer.files]), rethrow);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = [...event.clipboardData.files];
    // 글만 붙이는 보통의 붙여넣기는 건드리지 않는다
    if (files.length === 0 || attachBlocked !== null) return;
    event.preventDefault();
    detach(addFiles(files), rethrow);
  };
  // 최신 입력. 한글 조합이 끝난 직후의 keydown은 React 상태가 아직 갱신되기 전일 수 있다
  const draftRef = useRef("");
  const guard = useRef(createEnterGuard());
  // 조합 중 눌린 Enter의 자리(⌘Enter면 바로 반영). compositionend에서 보낼 때 쓴다
  const enterMode = useRef<BusyInputMode>("followUp");
  // sending 상태는 비동기라 연속 Enter를 못 막는다. 동기 잠금으로 막는다
  const latch = useRef(createSendLatch());

  const loadEngineRows = async (): Promise<readonly CommandRowVM[] | null> => {
    const listed = await commands.commandList(props.threadId);
    const rows = listed.ok ? listed.value : null;
    setEngineRows(rows);
    return rows;
  };
  const fillSlash = (index: number): void => {
    const row = menuRows[index];
    if (row === undefined) return;
    const next = slashFillOf(row);
    draftRef.current = next;
    setDraft(next);
    setMenuIndex(0);
    textarea.current?.focus();
  };
  /** `force`는 모르는 명령 확인에서 "그대로 보내기"를 눌렀을 때다 */
  const send = async (force = false, whenBusy: BusyInputMode = "followUp"): Promise<void> => {
    const text = draftRef.current.trim();
    const parts = readyParts(chips);
    if (props.disabledReason !== null) return;
    if (!chipsReady(chips)) {
      // 올리지 못했거나 올리는 중인 첨부가 있으면 왜 못 보내는지 말한다(글은 그대로 둔다)
      setError(sendBlockedText(chips));
      return;
    }
    if (text === "" && parts.length === 0) {
      if (held > 0 && !running) sendHeld.send();
      return;
    }
    if (parts.length === 0 && !force) {
      // 앱이 직접 하는 명령(`/compact [지침]`)은 모델로 보내지 않고 대화 요약으로 간다
      const app = appSlashOf(text);
      if (app !== null) {
        draftRef.current = "";
        setDraft("");
        setError(null);
        setUnknownName(null);
        runThreadCompact(commands, props.threadId, app.instructions ?? undefined);
        return;
      }
      // 앱도 엔진도 모르는 `/명령`은 모델로 보내기 전에 한 번 묻는다
      if (text.startsWith("/")) {
        const rows = engineRows ?? (await loadEngineRows());
        const unknown = unknownSlashOf(text, rows, skillsView);
        if (unknown !== null) {
          setUnknownName(unknown);
          return;
        }
      }
    }
    if (!latch.current.tryAcquire()) return;
    setUnknownName(null);
    setSending(true);
    setError(null);
    // 보내는 즉시 비운다. 남은 조합 글자가 두 번째 메시지가 되지 않게 한다
    draftRef.current = "";
    setDraft("");
    const sentId = requestId.current;
    if (running) sent.current.set(sentId, { text, parts });
    const result = await commands.sendTurn(
      props.threadId,
      text,
      sentId,
      parts.length === 0 ? undefined : parts,
      whenBusy,
    );
    latch.current.release();
    if (!result.ok) sent.current.delete(sentId);
    setSending(false);
    if (result.ok) {
      requestId.current = newRequestId();
      setChips([]);
      return;
    }
    // 실패하면 입력을 돌려주고(그 사이 새로 쓴 것이 없을 때만) 오류를 보인다
    if (draftRef.current === "") {
      draftRef.current = text;
      setDraft(text);
    }
    setError(sendErrorText(result.error));
  };

  /**
   * 대기열 칩의 "지금 반영": 칩을 철회하고 같은 내용을 도는 턴에 바로 반영(steer)으로 다시 보낸다. 이 입력창이 보낸 입력이 아니면(기억이 없으면) 하지 않는다.
   * 철회가 이미 늦었으면(모델에 전달됨) 보내지 않는다. 다시 보내지 못하면 입력창이 비어 있을 때 글을 되돌리고 오류를 보인다
   */
  const steerNow = async (queuedRequestId: string): Promise<WithdrawState> => {
    const record = sent.current.get(queuedRequestId);
    if (record === undefined) return { status: "idle" };
    const withdrawn = withdrawStateOf(
      await commands.withdrawInput(props.threadId, queuedRequestId),
    );
    if (withdrawn.status !== "withdrawn") return withdrawn;
    sent.current.delete(queuedRequestId);
    const resent = await commands.sendTurn(
      props.threadId,
      record.text,
      newRequestId(),
      record.parts.length === 0 ? undefined : record.parts,
      "steer",
    );
    if (resent.ok) return withdrawn;
    if (draftRef.current === "") {
      draftRef.current = record.text;
      setDraft(record.text);
    }
    setError(sendErrorText(resent.error));
    return withdrawn;
  };

  // 요청은 입력창이 받는 순간 지운다. 입력 중인 글이 있으면 채우지 않고 초점만 준다(글을 지우지 않는다)
  useEffect(() => {
    if (request === null) return;
    // 대화를 바꾸는 중에는 옛 대화의 입력창이 아직 떠 있다. 선택된 대화의 입력창이 마운트될 때까지 요청을 남겨 둔다
    if (!ownsComposerRequest(selectedThread, props.threadId)) return;
    if (request.insert !== null && draftRef.current === "") {
      draftRef.current = request.insert;
      setDraft(request.insert);
    }
    textarea.current?.focus();
    commands.settleComposerRequest();
  }, [request, commands, selectedThread, props.threadId, draftRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // 슬래시 목록이 열려 있으면 위아래로 고르고 Tab으로 채우고 Esc로 닫는다(한글 조합 중에는 건드리지 않는다)
    if (menuActive && !event.nativeEvent.isComposing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setMenuIndex(slashMoveOf(menuIndex, menuRows.length, event.key === "ArrowDown" ? 1 : -1));
        return;
      }
      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        fillSlash(Math.min(menuIndex, menuRows.length - 1));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuDismissed(true);
        return;
      }
    }
    // Enter는 보내기, Shift+Enter는 줄바꿈이다. 한글 조합 중 Enter 한 번은 글자 확정 + 보내기다(compositionend에서 보낸다, composer-model.ts)
    if (event.key === "Enter" && !event.shiftKey) enterMode.current = busyModeOfEnter(event);
    const action = guard.current.keyDown(
      {
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: event.nativeEvent.isComposing,
        // oxlint-disable-next-line typescript/no-deprecated -- keyCode는 폐기 표시지만 WebKit이 IME 처리 중 Enter keydown에 실어 보내는 값(229)이라 읽는다 (review.macos-checklist M-11)
        keyCode: event.nativeEvent.keyCode,
      },
      event.timeStamp,
    );
    if (action === "pass") return;
    event.preventDefault();
    if (action === "send") commitEnter(busyModeOfEnter(event));
  };

  /** 보내기 Enter. 슬래시 목록에서 고른 행이 입력과 다르면 보내지 않고 그 행으로 채운다. 이미 같으면 보낸다 */
  const commitEnter = (whenBusy: BusyInputMode): void => {
    if (menuActive && activeRow !== undefined && activeRow.label !== draftRef.current.trim()) {
      fillSlash(Math.min(menuIndex, menuRows.length - 1));
      return;
    }
    detach(send(false, whenBusy), rethrow);
  };

  // 입력창 부품은 caustic Textarea다. 글과 Enter 처리는 이 파일이 맡고, 단추 줄(첨부·승인 모드·모델·추론 레벨·중단·보내기)은 Textarea의 아래 칸에 둔다.
  // caustic Composer를 쓰지 않는 까닭: 실행 중에는 Enter가 보내기를 막고 단추가 중단으로 바뀌는데, 앱은 실행 중에도 큐에 넣으며 보내고 중단을 따로 둔다.
  // 또 Composer는 글이 빈 첨부만의 보내기를 막는다.
  // 경고는 늘 보이게 둔다(정보 아이콘 뒤에 숨기지 않는다): 비밀처럼 보이는 글이나 첨부가 있을 때 입력창 위 한 줄
  const secretWarning = secretWarningOf(draft, chips.length > 0);
  // 빈 입력창의 보내기 단추가 멈춘 대기 입력을 시작한다(DP-156): 이름도 그 일로 바뀐다
  const heldSend = held > 0 && !running && draft.trim() === "" && chips.length === 0;
  return (
    <form
      className="grid min-w-0 gap-1.5"
      onDragOver={(event) => {
        // 막혀 있어도 놓을 수는 있게 두어야 브라우저가 파일을 열어 버리지 않고, 못 받는 까닭을 보일 수 있다
        event.preventDefault();
        setDropRefused(false);
        setDragging(true);
      }}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDrop={onDrop}
      onSubmit={(event) => {
        event.preventDefault();
        detach(send(), rethrow);
      }}
    >
      <QueuedInputs
        threadId={props.threadId}
        disabledReason={props.disabledReason}
        steerable={(id) => sent.current.has(id)}
        onSteerNow={steerNow}
      />
      <AttachmentRow
        chips={chips}
        onRemove={(id) => {
          setChips((current) => current.filter((c) => c.id !== id));
          setError(null);
          // 지운 단추는 사라지므로 초점이 BODY로 떨어지지 않게 입력창으로 돌린다
          textarea.current?.focus();
        }}
        onRetry={retry}
      />
      {dragging || (dropRefused && attachBlocked !== null) ? (
        <p role="status" className="m-0 text-center text-ui text-text-secondary">
          {attachBlocked === null
            ? t("desktop.composer.attach.dropHint")
            : running
              ? t("desktop.composer.attach.dropBlocked")
              : attachBlocked}
        </p>
      ) : null}
      {/* 입력창에 붙는 줄은 올라와 가라앉고 내려가며 사라진다(dzM2 시안 §8). 배치는 그대로다 */}
      <Presence show={attachNote !== null} variant="band" initial={false}>
        {attachNote === null ? null : <ProblemLine>{attachNote}</ProblemLine>}
      </Presence>
      <Presence show={error !== null} variant="band" initial={false}>
        {error === null ? null : <ProblemLine>{error}</ProblemLine>}
      </Presence>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        aria-label={t("desktop.composer.attach.button")}
        onChange={(event) => {
          const picked = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          detach(addFiles(picked), rethrow);
        }}
      />
      <Presence show={secretWarning !== null} variant="band" initial={false}>
        {secretWarning === null ? null : (
          <div data-composer-secret-warning="">
            <ProblemLine tone="warning" role="note">
              {secretWarning}
            </ProblemLine>
          </div>
        )}
      </Presence>
      {menuActive || menuIssues.length > 0 ? (
        <ul
          id="composer-slash-list"
          role="listbox"
          aria-label={t("desktop.composer.slash.label")}
          data-composer-slash-list
          className="m-0 grid list-none gap-0.5 rounded-2xl bg-neutral-well p-1.5"
        >
          {menuRows.map((row, index) => (
            <Fragment key={row.name}>
              {row.group === "skill" && menuRows[index - 1]?.group !== "skill" ? (
                <li
                  role="presentation"
                  data-composer-slash-group="skill"
                  className="px-2.5 pt-1.5 text-ui text-text-tertiary"
                >
                  {t("desktop.composer.slash.skills.group")}
                </li>
              ) : null}
              <SlashRow
                row={row}
                selected={index === Math.min(menuIndex, menuRows.length - 1)}
                onFill={() => {
                  fillSlash(index);
                }}
                onHover={() => {
                  setMenuIndex(index);
                }}
              />
            </Fragment>
          ))}
          {menuIssues.map((issue) => (
            <li
              key={issue}
              role="presentation"
              data-composer-slash-issue
              className="px-2.5 py-1 text-ui text-warning-text"
            >
              {issue}
            </li>
          ))}
        </ul>
      ) : null}
      {unknownName === null ? null : (
        <ProblemLine
          tone="warning"
          role="status"
          action={
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => {
                detach(send(true), rethrow);
              }}
            >
              {t("desktop.composer.slash.sendAsIs")}
            </Button>
          }
        >
          {t("desktop.composer.slash.unknown")} · /{unknownName}
        </ProblemLine>
      )}
      <Presence show={retrying !== null} variant="band" initial={false}>
        {retrying === null ? null : <RetryStatus key={retrying.at} retry={retrying} />}
      </Presence>
      {/* 상자 안의 빈 곳(꼬리 줄의 틈, 칩 사이)을 눌러도 글 칸에 초점이 가고 커서는 글 끝이다(DP-131). 단추·칩·첨부는 제 동작을 하고,
          글 칸 안(안쪽 여백 포함)은 브라우저가 그대로 맡아 눌러 끌면 글이 골라진다 */}
      <div
        className="contents"
        onMouseDown={(event) => {
          const box = textarea.current?.closest("[data-slot=textarea]");
          const target = event.target;
          if (event.button !== 0 || props.disabledReason !== null) return;
          if (box === null || box === undefined || !(target instanceof Element)) return;
          if (!composerBlankHit(target, box.contains(target))) return;
          event.preventDefault();
          focusAtEnd(textarea.current);
        }}
      >
        <Textarea
          ref={textarea}
          aria-label={t("desktop.composer.input.label")}
          aria-autocomplete={menuActive ? "list" : undefined}
          aria-controls={menuActive ? "composer-slash-list" : undefined}
          aria-activedescendant={
            menuActive && activeRow !== undefined ? `composer-slash-${activeRow.name}` : undefined
          }
          variant="solid"
          size="md"
          radius="2xl"
          shadow="3"
          tone={dragging ? "accent" : "neutral"}
          rows={1}
          // 48에서 시작해 글이 늘면 max-h(240, 약 11줄)까지 자라고 넘으면 안에서 스크롤한다(field-sizing). 비우면 48로 돌아간다
          className="max-h-60 min-h-12 resize-none pt-3 pb-0 [field-sizing:content]"
          containerClassName={`composer-box rounded-[calc(var(--radius-2xl)+4px)] ${COMPOSER_FOOTER_CLASS}`}
          value={draft}
          // 안내 글(placeholder)은 없다. 입력을 막은 때만 그 이유를 보인다
          placeholder={props.disabledReason ?? undefined}
          disabled={props.disabledReason !== null}
          onChange={(event) => {
            draftRef.current = event.currentTarget.value;
            setDraft(event.currentTarget.value);
            setMenuIndex(0);
            setMenuDismissed(false);
            setUnknownName(null);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onCompositionStart={() => {
            guard.current.compositionStart();
          }}
          onCompositionEnd={(event) => {
            if (!guard.current.compositionEnd(event.timeStamp)) return;
            // 조합 중 Enter: 확정된 글(DOM 값)을 다음 틱에 보낸다. 같은 틱에는 브라우저가 조합 정리를 아직 하는 중이다
            const box = event.currentTarget;
            const whenBusy = enterMode.current;
            setTimeout(() => {
              draftRef.current = box.value;
              commitEnter(whenBusy);
            }, 0);
          }}
          actions={
            <>
              <IconButton
                label={attachBlocked ?? t("desktop.composer.attach.button")}
                size="sm"
                aria-description={t("desktop.composer.attach.info")}
                disabled={attachBlocked !== null}
                onClick={() => {
                  detach(pickFile(), rethrow);
                }}
              >
                <Plus aria-hidden />
              </IconButton>
            </>
          }
          submit={
            <span className="flex min-w-0 items-center gap-1">
              {permission.mode === null ? null : (
                <PermissionModeChip
                  mode={permission.mode}
                  bypassAllowed={permission.bypassAllowed}
                  disabled={props.disabledReason !== null}
                  writeAccess={writeAccessAllowed}
                  onChange={(next) => {
                    detach(
                      permission.choose(next).then((result) => {
                        if (!result.ok) setError(modeErrorText(result.error));
                        return undefined;
                      }),
                      rethrow,
                    );
                  }}
                />
              )}
              {threadModel.ref === null ? null : (
                <ModelChip
                  current={threadModel.ref}
                  chosen={threadModel.chosen}
                  fallback={defaultModel}
                  choices={modelChoices}
                  disabled={props.disabledReason !== null}
                  denied={deniedModels}
                  onChange={(model) => {
                    detach(
                      commands.setThreadModel(props.threadId, model).then((result) => {
                        if (!result.ok) setError(modelErrorText(result.error));
                        return undefined;
                      }),
                      rethrow,
                    );
                  }}
                />
              )}
              {thinking.level === null ||
              threadModel.ref === null ||
              !thinkingSelectableOf(modelChoices, threadModel.ref) ? null : (
                <ThinkingChip
                  level={thinking.level}
                  disabled={props.disabledReason !== null}
                  onChange={(next) => {
                    detach(
                      thinking.choose(next).then((result) => {
                        if (!result.ok) setError(thinkingErrorText(result.error));
                        return undefined;
                      }),
                      rethrow,
                    );
                  }}
                />
              )}
              {threadRunning ? (
                <StopButton
                  aborting={aborting}
                  blockedReason={stopBlocked}
                  onStop={() => {
                    detach(commands.interrupt(props.threadId), rethrow);
                  }}
                />
              ) : null}
              <IconButton
                type="submit"
                variant="solid"
                radius="full"
                size="sm"
                label={
                  heldSend
                    ? t("desktop.composer.queue.held.sendLabel", { count: held })
                    : t("desktop.composer.send.button")
                }
                disabled={
                  props.disabledReason !== null ||
                  sending ||
                  (heldSend && sendHeld.busy) ||
                  !chipsReady(chips) ||
                  (draft.trim() === "" && chips.length === 0 && !heldSend)
                }
              >
                <ArrowUp aria-hidden />
              </IconButton>
            </span>
          }
        />
      </div>
    </form>
  );
}

/** 글 칸에 초점을 주고 커서를 글 끝에 둔다 */
function focusAtEnd(box: HTMLTextAreaElement | null): void {
  if (box === null) return;
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);
}

/**
 * 멈춤 단추(입력창 아래 줄, 보내기 단추 왼쪽). 멈춤을 누른 뒤 엔진이 멈출 때까지는 회전 표시로 바뀌고 다시 누를 수 없다.
 * 이름도 "멈추는 중…"으로 바뀌어 읽기 프로그램이 상태를 안다
 */
export function StopButton(props: {
  readonly aborting: boolean;
  /** 누를 수 없는 까닭(엔진이 없음). 없으면 null */
  readonly blockedReason: string | null;
  readonly onStop: () => void;
}): ReactNode {
  return (
    <IconButton
      type="button"
      variant="solid"
      radius="full"
      size="sm"
      data-composer-stop={props.aborting ? "stopping" : "idle"}
      label={
        props.blockedReason ??
        (props.aborting
          ? t("desktop.composer.interrupt.stopping")
          : t("desktop.composer.interrupt.button"))
      }
      aria-busy={props.aborting || undefined}
      disabled={props.blockedReason !== null || props.aborting}
      onClick={props.onStop}
      // "멈추는 중"으로 바뀔 때 네모와 회전 표시가 교차 전환된다(나가는 것이 단추 안에 겹쳐 남는다)
      className="relative"
    >
      <SwapFade swapKey={props.aborting ? "stopping" : "idle"} inline className="inline-flex">
        {props.aborting ? (
          <LoaderCircle aria-hidden className="animate-spinner" />
        ) : (
          <span aria-hidden className="block size-stop-glyph rounded-2xs bg-current" />
        )}
      </SwapFade>
    </IconButton>
  );
}

/** 입력창 위에 보일 비밀 경고 글. 보일 때가 아니면 null */
export function secretWarningOf(draft: string, hasAttachments: boolean): string | null {
  if (looksLikeSecret(draft)) return t("desktop.composer.secret.warning");
  if (hasAttachments) return t("desktop.composer.attach.info");
  return null;
}

export function Composer(): ReactNode {
  const commands = useCommands();
  const threadId = useOpenThreadId();
  const engine = useEngineState();
  const phase = useLinkPhase();
  const setupNeeded = useSetupNeeded();
  const observing = useObserving(threadId);
  if (threadId === null) return null;
  const disabledReason = composerDisabledReason({
    engineRunning: engine?.kind === "running",
    phase,
    observing,
    setupNeeded,
  });
  // thread가 바뀌면 입력 중이던 글자를 버린다(key). 관찰 띠는 입력창 자리에 같은 모서리로 놓인다(p02-opus ObserveBand)
  return (
    <div className="mx-auto grid w-full max-w-184 flex-none gap-1.5 px-3 pb-3.5">
      {observing ? (
        <div
          role="status"
          className="flex min-h-14 items-center gap-3 rounded-2xl bg-neutral-well px-4 py-3"
        >
          <p className="m-0 min-w-0 flex-1 text-ui-strong text-text-primary">
            {t("desktop.composer.observing.notice")}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              commands.retryWrite(threadId);
            }}
          >
            {t("desktop.composer.retryWrite.button")}
          </Button>
        </div>
      ) : null}
      <ComposerFor
        key={threadId}
        threadId={threadId}
        disabledReason={disabledReason}
        engineGone={engineGoneOf(engine, phase)}
      />
    </div>
  );
}
