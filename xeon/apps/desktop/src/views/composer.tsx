import { t } from "@fresnel/client/i18n";
import {
  Button,
  IconButton,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  Textarea,
} from "@caustic/react";
import { ArrowUp, Plus } from "@caustic/react/icons";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { PermissionMode } from "@fresnel/contracts/services";
import type { ModelEntry } from "@fresnel/contracts/wire";
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  useEngineState,
  useLinkPhase,
  useOpenThreadId,
  useThreadRunning,
} from "../state/engine/index.ts";
import { useComposerRequest, useObserving, useSelectedThreadId } from "../state/ui/index.ts";
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
import { useCommands, type BusyInputMode, type CommandError, type SwitchMode } from "./commands.ts";
import { modeLabelIdOf } from "./approval-card/card-model.ts";
import {
  busyModeOf,
  composerDisabledReason,
  createEnterGuard,
  createSendLatch,
  looksLikeSecret,
} from "./composer-model.ts";
import {
  DEFAULT_MODEL_CHOICE,
  modelOptionsOf,
  contextCostText,
  priceNumberText,
  type ModelOption,
  useDefaultModel,
  useModelChoices,
  useSessionUsage,
  useThreadModel,
  useThreadPermissionMode,
} from "./model-usage.ts";
import { permissionModeOptionsOf, switchModeOf } from "./permission-mode-model.ts";
import { QueuedInputs } from "./queued-inputs.tsx";
import { useSetupNeeded } from "./setup-needed.ts";

// 입력창. 입력 중인 글자는 이 부품만 쓰므로 로컬 상태다(FS-04).
// requestId는 같은 입력의 재시도가 같은 값을 쓰도록 실패했을 때 유지하고, 성공하면 새로 만든다(spec 4.13).
// ⌘L과 명령 팔레트의 슬래시 명령은 `ComposerRequest`로 온다. 받으면 초점을 주고 빈 입력창에만 글을 채운 뒤 요청을 지운다.

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

/** 승인 모드를 바꾸지 못했을 때의 문장. 잠김과 연결 끊김은 보낼 때와 같은 문장이고 나머지는 승인 모드 문장이다 */
function modeErrorText(error: CommandError): string {
  if (error.kind === "offline" || error.kind === "switching" || error.kind === "locked") {
    return sendErrorText(error);
  }
  return t("desktop.composer.approvalMode.error");
}

const RING_C = 50.27;
const USAGE_WARNING = 80;
const USAGE_DANGER = 95;
type RingTone = "accent" | "warning" | "danger";
const RING_TEXT: Record<RingTone, string> = {
  accent: "text-accent-solid",
  warning: "text-warning-solid",
  danger: "text-danger-solid",
};

/** 승인 모드 칩의 글. 모르는 모드는 원시값이다(approval-card/bodies.tsx의 `modeLabelOf`와 같은 규칙) */
function permissionModeLabelOf(mode: PermissionMode): string {
  const id = modeLabelIdOf(mode);
  return id === null ? mode : t(id);
}

/**
 * 대화별 승인 모드 칩(입력창 모델 칸 왼쪽). 값은 이 대화의 `l1.tools.permissionMode`(대화 범위)다.
 * 고를 수 있는 것은 기본과 편집 자동 허용뿐이다. 지금이 계획이나 모두 허용이면 그 글을 칩에 보이고, 메뉴에서는 고를 수 없다.
 */
export function PermissionModeSelect(props: {
  /** 지금 이 대화의 승인 모드 */
  readonly mode: PermissionMode;
  readonly disabled: boolean;
  /** 고른 모드. 계획과 모두 허용으로는 바꾸지 않는다(고를 수 없는 줄이라 여기 오지 않는다) */
  readonly onChange: (mode: SwitchMode) => void;
}): ReactNode {
  return (
    <Select
      size="xs"
      aria-label={t("desktop.composer.approvalMode.label")}
      value={props.mode}
      disabled={props.disabled}
      onValueChange={(value) => {
        const next = switchModeOf(value);
        if (next !== null && next !== props.mode) props.onChange(next);
      }}
      className="w-auto text-text-tertiary"
    >
      {permissionModeOptionsOf(props.mode).map((option) => (
        <SelectOption key={option.mode} value={option.mode} disabled={!option.selectable}>
          {permissionModeLabelOf(option.mode)}
        </SelectOption>
      ))}
    </Select>
  );
}

/**
 * 대화별 모델 select(시안 `sonnet-5-5 ⌄`). 값은 대화가 정한 모델이고 정하지 않았으면 기본 모델이다.
 * 고르면 `thread.setModel`로 이 대화의 다음 turn부터 바뀐다. 대화가 모델을 정했으면 끝에 "기본 모델"로 되돌리는 줄이 있다.
 * 목록은 호스트 카탈로그(`models.list`)다
 */
function modelOptionText(option: ModelOption, contextTokens: number | null): string {
  if (option.price === null) return option.label;
  if (option.price === "unknown") {
    return `${option.label} · ${t("desktop.composer.model.priceUnknown")}`;
  }
  const base = `${option.label} · ${t("desktop.composer.model.price", {
    input: priceNumberText(option.price.input),
    output: priceNumberText(option.price.output),
  })}`;
  const estimate = contextCostText(contextTokens, option.price.input);
  return estimate === null
    ? base
    : `${base} · ${t("desktop.composer.model.contextCost", { cost: estimate })}`;
}

export function ModelSelect(props: {
  /** 지금 쓰는 모델 참조(대화가 정한 모델, 없으면 기본 모델) */
  readonly current: string;
  /** 대화가 모델을 정했는가 */
  readonly chosen: boolean;
  /** 정하지 않았을 때 쓰는 기본 모델. 모르면 null */
  readonly fallback: string | null;
  readonly choices: readonly ModelEntry[];
  readonly disabled: boolean;
  /** 이 대화의 지금 문맥 토큰. 줄마다 "이 문맥을 보내면 약 얼마"를 보이는 데 쓴다. 모르면 null */
  readonly contextTokens?: number | null;
  /** 모델 참조를 고르면 그 값, 기본 모델로 돌아가면 null */
  readonly onChange: (model: string | null) => void;
}): ReactNode {
  const options = modelOptionsOf(
    props.choices,
    props.current,
    props.chosen ? props.fallback : null,
  );
  return (
    <Select
      size="xs"
      aria-label={t("desktop.composer.model.label")}
      value={props.current}
      disabled={props.disabled}
      onValueChange={(value) => {
        if (value === DEFAULT_MODEL_CHOICE) props.onChange(null);
        else if (value !== props.current) props.onChange(value);
      }}
      className="w-auto text-text-tertiary"
    >
      {options.map((option) => (
        <SelectOption key={option.value} value={option.value}>
          {option.value === DEFAULT_MODEL_CHOICE
            ? t("desktop.composer.model.default", { model: option.label })
            : modelOptionText(option, props.contextTokens ?? null)}
        </SelectOption>
      ))}
    </Select>
  );
}

/**
 * 문맥 사용량 링. 한도를 알 때만 그린다(`percent`가 null이면 아무것도 그리지 않는다, 비율을 지어내지 않는다).
 * 80%를 넘으면 경고, 95%를 넘으면 위험 색이다. 입력창이 꺼져 있으면 흐리게 보인다.
 */
export function UsageRing(props: {
  readonly percent: number | null;
  readonly disabled: boolean;
}): ReactNode {
  if (props.percent === null) return null;
  const pct = Math.min(100, Math.max(0, props.percent));
  const tone: RingTone = pct > USAGE_DANGER ? "danger" : pct > USAGE_WARNING ? "warning" : "accent";
  const color = props.disabled ? "text-disabled-text" : RING_TEXT[tone];
  return (
    <svg
      data-level={tone === "accent" ? undefined : tone}
      role="img"
      aria-label={t("desktop.composer.usage.label", { percent: Math.round(pct) })}
      viewBox="0 0 22 22"
      className={`size-usage-ring shrink-0 fill-none stroke-3 ${color}`}
    >
      <circle cx="11" cy="11" r="8" className="stroke-neutral-track" />
      <circle
        cx="11"
        cy="11"
        r="8"
        transform="rotate(-90 11 11)"
        strokeLinecap="round"
        strokeDasharray={RING_C}
        strokeDashoffset={RING_C * (1 - pct / 100)}
        className="stroke-current transition-[stroke-dashoffset] duration-gentle ease-standard"
      />
    </svg>
  );
}

/** 선택된 대화의 입력창만 초점 요청을 받는다. 선택이 없으면 어느 입력창이든 받는다 */
export function ownsComposerRequest(selected: ThreadId | null, own: ThreadId): boolean {
  return selected === null || selected === own;
}

function ComposerFor(props: {
  readonly threadId: ThreadId;
  readonly disabledReason: string | null;
}): ReactNode {
  const commands = useCommands();
  const running = useThreadRunning(props.threadId);
  // 이 대화의 모델(정하지 않았으면 기본 모델)과 문맥 사용량(model-usage.ts)
  const defaultModel = useDefaultModel();
  const threadModel = useThreadModel(props.threadId, defaultModel);
  // 이 대화의 승인 모드 칩(설정 l1.tools.permissionMode, 대화 범위). 모르는 동안은 칩을 그리지 않는다
  const permission = useThreadPermissionMode(props.threadId);
  const modelChoices = useModelChoices();
  const usage = useSessionUsage(props.threadId, running);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const requestId = useRef<string>(newRequestId());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const request = useComposerRequest();
  const selectedThread = useSelectedThreadId();
  const folderPick = useFolderPick();
  const [chips, setChips] = useState<readonly AttachChip[]>([]);
  // 실행 중에 보낸 글이 들어갈 자리. 기본은 끝난 뒤(followUp)다. 시안이 말하는 기본 모드 설정(l1.tasks.queue.defaultMode)은 설정 카탈로그에 없어서 읽지 않는다
  const [mode, setMode] = useState<BusyInputMode>("followUp");
  const [dragging, setDragging] = useState(false);
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const limit = useRef<number | null>(null);
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
    if (attachBlocked !== null) return;
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
  // sending 상태는 비동기라 연속 Enter를 못 막는다. 동기 잠금으로 막는다
  const latch = useRef(createSendLatch());

  const send = async (): Promise<void> => {
    const text = draftRef.current.trim();
    const parts = readyParts(chips);
    if (props.disabledReason !== null) return;
    if (!chipsReady(chips)) {
      // 올리지 못했거나 올리는 중인 첨부가 있으면 왜 못 보내는지 말한다(글은 그대로 둔다)
      setError(sendBlockedText(chips));
      return;
    }
    if (text === "" && parts.length === 0) return;
    if (!latch.current.tryAcquire()) return;
    setSending(true);
    setError(null);
    // 보내는 즉시 비운다. 남은 조합 글자가 두 번째 메시지가 되지 않게 한다
    draftRef.current = "";
    setDraft("");
    const result = await commands.sendTurn(
      props.threadId,
      text,
      requestId.current,
      parts.length === 0 ? undefined : parts,
      mode,
    );
    latch.current.release();
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
  }, [request, commands, selectedThread, props.threadId]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // 한글 조합 중의 Enter는 글자 확정이다. 보내지 않는다(WebKit은 keyCode 229, compositionend가 먼저)
    if (
      !guard.current.isSendEnter(
        {
          key: event.key,
          shiftKey: event.shiftKey,
          isComposing: event.nativeEvent.isComposing,
          // oxlint-disable-next-line typescript/no-deprecated -- keyCode는 폐기 표시지만 WebKit이 IME 처리 중 Enter keydown에 실어 보내는 값(229)이라 읽는다 (review.macos-checklist M-11)
          keyCode: event.nativeEvent.keyCode,
        },
        event.timeStamp,
      )
    )
      return;
    event.preventDefault();
    detach(send(), rethrow);
  };

  // 입력창 부품은 caustic Textarea다. 글과 Enter 처리는 이 파일이 맡고, 단추 줄(첨부·바로/끝난 뒤·모델·사용량·중단·보내기)은 Textarea의 아래 칸에 둔다.
  // caustic Composer를 쓰지 않는 까닭: 실행 중에는 Enter가 보내기를 막고 단추가 중단으로 바뀌는데, 앱은 실행 중에도 큐에 넣으며 보내고 중단을 따로 둔다.
  // 또 Composer는 글이 빈 첨부만의 보내기를 막는다.
  // 경고는 늘 보이게 둔다(정보 아이콘 뒤에 숨기지 않는다): 비밀처럼 보이는 글이나 첨부가 있을 때 입력창 위 한 줄
  const secretWarning = secretWarningOf(draft, chips.length > 0);
  return (
    <form
      className="grid min-w-0 gap-1.5"
      onDragOver={(event) => {
        if (attachBlocked !== null) return;
        event.preventDefault();
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
      <QueuedInputs threadId={props.threadId} disabledReason={props.disabledReason} />
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
      {dragging ? (
        <p role="status" className="m-0 text-center text-ui-sm text-text-secondary">
          {t("desktop.composer.attach.dropHint")}
        </p>
      ) : null}
      {attachNote === null ? null : (
        <p role="alert" className="m-0 px-1 text-ui-sm text-danger-text">
          {attachNote}
        </p>
      )}
      {error === null ? null : (
        <p role="alert" className="m-0 px-1 text-ui-sm text-danger-text">
          {error}
        </p>
      )}
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
      {secretWarning === null ? null : (
        <p
          role="note"
          data-composer-secret-warning
          className="m-0 px-1 text-ui-sm text-warning-text"
        >
          {secretWarning}
        </p>
      )}
      <Textarea
        ref={textarea}
        aria-label={t("desktop.composer.input.label")}
        variant="solid"
        size="md"
        radius="2xl"
        shadow="3"
        tone={dragging ? "accent" : "neutral"}
        rows={2}
        className="resize-none"
        value={draft}
        placeholder={props.disabledReason ?? t("desktop.composer.placeholder")}
        disabled={props.disabledReason !== null}
        onChange={(event) => {
          draftRef.current = event.currentTarget.value;
          setDraft(event.currentTarget.value);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onCompositionStart={() => {
          guard.current.compositionStart();
        }}
        onCompositionEnd={(event) => {
          guard.current.compositionEnd(event.timeStamp);
        }}
        actions={
          <>
            <IconButton
              label={attachBlocked ?? t("desktop.composer.attach.button")}
              size="xs"
              aria-description={t("desktop.composer.attach.info")}
              disabled={attachBlocked !== null}
              onClick={() => {
                detach(pickFile(), rethrow);
              }}
            >
              <Plus aria-hidden />
            </IconButton>
            <SegmentedControl
              size="xs"
              aria-label={t("desktop.composer.mode.label")}
              value={mode}
              onValueChange={(value) => {
                const next = busyModeOf(value);
                if (next !== null) setMode(next);
              }}
              disabled={props.disabledReason !== null}
            >
              <SegmentedControlItem value="steer">
                {t("desktop.composer.mode.steer")}
              </SegmentedControlItem>
              <SegmentedControlItem value="followUp">
                {t("desktop.composer.mode.followUp")}
              </SegmentedControlItem>
            </SegmentedControl>
          </>
        }
        submit={
          <span className="flex items-center gap-1">
            {permission.mode === null ? null : (
              <PermissionModeSelect
                mode={permission.mode}
                disabled={props.disabledReason !== null}
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
              <ModelSelect
                current={threadModel.ref}
                chosen={threadModel.chosen}
                fallback={defaultModel}
                choices={modelChoices}
                disabled={props.disabledReason !== null}
                contextTokens={usage === null ? null : usage.tokens}
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
            <UsageRing percent={usage?.percent ?? null} disabled={props.disabledReason !== null} />
            {running ? (
              <IconButton
                type="button"
                variant="solid"
                radius="full"
                size="sm"
                label={t("desktop.composer.interrupt.button")}
                onClick={() => {
                  detach(commands.interrupt(props.threadId), rethrow);
                }}
              >
                <span aria-hidden className="block size-stop-glyph rounded-2xs bg-current" />
              </IconButton>
            ) : null}
            <IconButton
              type="submit"
              variant="solid"
              radius="full"
              size="sm"
              label={t("desktop.composer.send.button")}
              disabled={
                props.disabledReason !== null ||
                sending ||
                !chipsReady(chips) ||
                (draft.trim() === "" && chips.length === 0)
              }
            >
              <ArrowUp aria-hidden />
            </IconButton>
          </span>
        }
      />
    </form>
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
    <div className="mx-auto grid w-full max-w-184 flex-none gap-1.5 px-3 pb-1.5">
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
      <ComposerFor key={threadId} threadId={threadId} disabledReason={disabledReason} />
    </div>
  );
}
