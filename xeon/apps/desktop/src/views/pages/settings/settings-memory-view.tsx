import { Alert, Button, Dialog, DialogAction, DialogClose, Textarea } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { MemoryStore, MemoryStoreView } from "@fresnel/contracts/capabilities";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import { SettingSection } from "./settings-section.tsx";
import { useCommands } from "../../commands.ts";
import type { CommandError } from "../../commands.ts";

// 설정 "대화와 컨텍스트" 탭의 기억 구역(W-19, 시나리오 scE S7). 엔진의 기억은 항목 목록이라(`USER.md`, `MEMORY.md`의 `§` 구분)
// 항목마다 한 행이다. 사용자 기억과 환경 기억 두 구역이고, 환경 기억은 작업 폴더별이 아니라 모두가 함께 쓴다.
// 바깥(CLI, 모델)에서 바뀐 것은 이 구역을 열 때와 창이 다시 앞에 올 때 읽고, 쓰기가 `baseHash` 거절을 받으면 다시 읽는다.
// 저장과 지우기의 오류는 열린 대화 상자 안에 보이고, 대화 상자가 없을 때만 구역 머리 위에 보인다.
// 그림은 `MemoryPanelView`, 명령과 읽기는 `MemoryPanel`이 잇는다.

type MemoryLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly unsupported: boolean }
  | { readonly kind: "ready"; readonly stores: readonly MemoryStoreView[] };

type MemoryEditor =
  | { readonly kind: "closed" }
  | {
      readonly kind: "open";
      readonly store: MemoryStore;
      /** 고칠 항목. 새로 넣는 창이면 null */
      readonly entryId: string | null;
      readonly text: string;
    };

interface MemoryRemoving {
  readonly store: MemoryStore;
  readonly entryId: string;
  readonly text: string;
}

export interface MemoryPanelViewProps {
  readonly load: MemoryLoad;
  readonly notice: MessageId | null;
  readonly editor: MemoryEditor;
  readonly removing: MemoryRemoving | null;
  readonly busy: boolean;
  readonly onOpenAdd: (store: MemoryStore) => void;
  readonly onOpenEdit: (store: MemoryStore, entryId: string, text: string) => void;
  readonly onText: (text: string) => void;
  readonly onSave: () => void;
  readonly onCloseEditor: () => void;
  readonly onAskRemove: (store: MemoryStore, entryId: string, text: string) => void;
  readonly onConfirmRemove: () => void;
  readonly onCloseRemove: () => void;
}

const STORES: readonly {
  readonly store: MemoryStore;
  readonly title: MessageId;
  readonly info: MessageId;
}[] = [
  { store: "user", title: "desktop.memory.user.title", info: "desktop.memory.user.info" },
  { store: "env", title: "desktop.memory.env.title", info: "desktop.memory.env.info" },
];

/** 저장소마다 설정 화면이 보이는 한도 이름. 줄 안의 한도 이름이 설정 화면과 같은 글이 되도록 설정의 번역 키를 쓴다 */
const LIMIT_LABEL: Record<MemoryStore, MessageId> = {
  user: "settings.l2.knowledge.memory.userLimitChars.label",
  env: "settings.l2.knowledge.memory.envLimitChars.label",
};

/** 행에 보이는 글. 줄바꿈은 한 줄 안에서 공백으로 보인다 */
function previewOf(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 저장소 한도에서 이 글이 들어가면 남을 글자 수. 고치는 글이면 그 항목이 쓰던 글자 수를 되돌린다.
 * 셈은 엔진과 같은 코드 포인트이고, 앞뒤 공백은 저장할 때 지워지므로 뺀다. 줄마다 붙는 구분 글자는 셈에 없어서 어림이다.
 */
export function remainingOf(args: {
  readonly limitChars: number;
  readonly usedChars: number;
  /** 고치는 항목의 옛 글자 수. 새로 넣는 창이면 0 */
  readonly oldChars: number;
  readonly text: string;
}): number {
  return args.limitChars - args.usedChars + args.oldChars - Array.from(args.text.trim()).length;
}

export function MemoryPanelView(props: MemoryPanelViewProps): ReactNode {
  const { load, notice, busy, editor, removing } = props;
  // 대화 상자가 열려 있으면 오류는 그 안에 보인다. 뒤의 구역 머리에 같은 줄을 또 그리지 않는다
  const dialogOpen = editor.kind === "open" || removing !== null;
  return (
    <div data-slot="settings-memory" data-memory-state={load.kind} className="min-w-0">
      <SettingSection
        title={
          <span className="flex items-center gap-2">
            {t("desktop.memory.label")}
            <InfoTip text={t("desktop.memory.info")} />
          </span>
        }
      >
        {notice === null || dialogOpen ? null : (
          <Alert tone="warning" size="sm">
            {t(notice)}
          </Alert>
        )}
        {load.kind === "loading" ? (
          <p className="text-ui-sm text-text-tertiary">{t("desktop.memory.loading")}</p>
        ) : null}
        {load.kind === "failed" ? (
          <Alert tone="danger" size="sm">
            {t(load.unsupported ? "desktop.memory.unsupported" : "desktop.memory.loadFailed")}
          </Alert>
        ) : null}
        {load.kind === "ready"
          ? STORES.map((spec) => (
              <StoreGroup
                key={spec.store}
                spec={spec}
                view={load.stores.find((candidate) => candidate.store === spec.store)}
                busy={busy}
                props={props}
              />
            ))
          : null}
      </SettingSection>
      <EditorDialog props={props} />
      <RemoveDialog props={props} />
    </div>
  );
}

function StoreGroup(args: {
  readonly spec: (typeof STORES)[number];
  readonly view: MemoryStoreView | undefined;
  readonly busy: boolean;
  readonly props: MemoryPanelViewProps;
}): ReactNode {
  const { spec, view, busy, props } = args;
  if (view === undefined) return null;
  // 한도를 넘은 묶음은 머리의 글자 수를 경고 색으로 보인다(줄이기 전까지 새 글은 거절될 수 있다)
  const over = view.usedChars > view.limitChars;
  return (
    <div data-memory-store={spec.store} className="grid min-w-0 gap-2 py-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-body text-text-primary">
          {t(spec.title)}
          <InfoTip text={t(spec.info)} />
          <span
            data-memory-used
            className={over ? "text-ui-sm text-warning-text" : "text-ui-sm text-text-tertiary"}
          >
            {t("desktop.memory.used", {
              used: String(view.usedChars),
              limit: String(view.limitChars),
            })}
          </span>
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || view.writeBlocked}
          onClick={() => {
            props.onOpenAdd(spec.store);
          }}
        >
          {t("desktop.memory.add")}
        </Button>
      </div>
      {view.writeBlocked ? (
        <Alert tone="warning" size="sm">
          {t("desktop.memory.blocked")}
        </Alert>
      ) : null}
      {view.entries.length === 0 ? (
        <div className="grid gap-1 py-2">
          <span className="text-body text-text-secondary">{t("desktop.memory.empty")}</span>
          <span className="text-ui-sm text-text-tertiary">{t("desktop.memory.empty.hint")}</span>
        </div>
      ) : (
        <ul className="grid min-w-0">
          {view.entries.map((entry) => (
            <li
              key={entry.id}
              data-memory-entry={entry.id}
              className="flex min-w-0 items-center justify-between gap-3 border-b border-border-subtle py-2"
            >
              <span className="min-w-0 flex-1 truncate text-body text-text-primary">
                {previewOf(entry.text)}
              </span>
              <span className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || view.writeBlocked}
                  onClick={() => {
                    props.onOpenEdit(spec.store, entry.id, entry.text);
                  }}
                >
                  {t("desktop.memory.edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || view.writeBlocked}
                  onClick={() => {
                    props.onAskRemove(spec.store, entry.id, entry.text);
                  }}
                >
                  {t("desktop.memory.remove")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 대화 상자 안의 오류 줄. 다시 읽은 것은 주의(warning), 저장이 실패한 것은 위험(danger)이다 */
export function DialogNotice(args: { readonly notice: MessageId }): ReactNode {
  return (
    <Alert tone={args.notice === "desktop.memory.stale" ? "warning" : "danger"} size="sm">
      {t(args.notice)}
    </Alert>
  );
}

function oldCharsOf(view: MemoryStoreView, entryId: string | null): number {
  if (entryId === null) return 0;
  return view.entries.find((entry) => entry.id === entryId)?.chars ?? 0;
}

/** 글 칸 아래의 남은 글자 줄. 한도를 넘으면 경고 한 문장이 줄을 대신한다. 저장은 막지 않는다(엔진이 거절할 수 있다) */
function RemainingLine(args: {
  readonly view: MemoryStoreView;
  readonly entryId: string | null;
  readonly text: string;
}): ReactNode {
  const { view, entryId, text } = args;
  const remaining = remainingOf({
    limitChars: view.limitChars,
    usedChars: view.usedChars,
    oldChars: oldCharsOf(view, entryId),
    text,
  });
  const over = remaining < 0;
  // 한도의 10%보다 적게 남으면 경고 색이다
  const low = remaining * 10 < view.limitChars;
  return (
    <div className="grid gap-1">
      {over ? (
        <Alert tone="warning" size="sm">
          {t("desktop.memory.overLimit", {
            over: String(-remaining),
            tab: t("client.settings.tabs.sessions"),
            limit: t(LIMIT_LABEL[view.store]),
          })}
        </Alert>
      ) : null}
      <div className="flex items-center gap-1 text-ui-sm">
        {over ? null : (
          <span data-memory-remaining className={low ? "text-warning-text" : "text-text-tertiary"}>
            {t("desktop.memory.remaining", { n: String(remaining) })}
          </span>
        )}
        <InfoTip text={t("desktop.memory.limit.info")} />
      </div>
    </div>
  );
}

/** 고치기·새로 넣기 대화 상자의 본문. 오류 줄은 글 칸 위, 남은 글자 줄은 글 칸 아래에 둔다 */
export function MemoryEditorBody(props: {
  readonly notice: MessageId | null;
  /** 고칠 저장소의 값. 대화 상자가 닫혀 있거나 값을 아직 못 읽었으면 undefined */
  readonly view: MemoryStoreView | undefined;
  readonly entryId: string | null;
  readonly text: string;
  readonly onText: (text: string) => void;
}): ReactNode {
  const { notice, view, entryId, text, onText } = props;
  return (
    <div className="grid gap-2">
      {notice === null ? null : <DialogNotice notice={notice} />}
      <Textarea
        aria-label={t("desktop.memory.text.label")}
        rows={4}
        value={text}
        onChange={(event) => {
          onText(event.currentTarget.value);
        }}
      />
      {view === undefined ? null : <RemainingLine view={view} entryId={entryId} text={text} />}
    </div>
  );
}

function EditorDialog(args: { readonly props: MemoryPanelViewProps }): ReactNode {
  const { props } = args;
  const { editor, busy, load } = props;
  const open = editor.kind === "open";
  const adding = editor.kind === "open" && editor.entryId === null;
  const text = editor.kind === "open" ? editor.text : "";
  const entryId = editor.kind === "open" ? editor.entryId : null;
  const view =
    editor.kind === "open" && load.kind === "ready"
      ? load.stores.find((candidate) => candidate.store === editor.store)
      : undefined;
  return (
    <Dialog
      kind="dialog"
      size="md"
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onCloseEditor();
      }}
      title={t(adding ? "desktop.memory.add.title" : "desktop.memory.edit.title")}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t("desktop.memory.cancel")}
            </Button>
          </DialogClose>
          <Button
            variant="solid"
            size="sm"
            disabled={busy || text.trim() === ""}
            onClick={props.onSave}
          >
            {t("desktop.memory.save")}
          </Button>
        </>
      }
    >
      <MemoryEditorBody
        notice={props.notice}
        view={view}
        entryId={entryId}
        text={text}
        onText={props.onText}
      />
    </Dialog>
  );
}

function RemoveDialog(args: { readonly props: MemoryPanelViewProps }): ReactNode {
  const { props } = args;
  const { removing, busy, notice } = props;
  return (
    <Dialog
      kind="alert"
      size="sm"
      tone="danger"
      open={removing !== null}
      onOpenChange={(next) => {
        if (!next) props.onCloseRemove();
      }}
      title={t("desktop.memory.remove.title")}
      description={t("desktop.memory.remove.body", {
        text: removing === null ? "" : previewOf(removing.text),
      })}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.memory.remove.keep")}
            </Button>
          </DialogClose>
          {busy ? null : (
            <DialogAction onClick={props.onConfirmRemove}>
              {t("desktop.memory.remove.confirm")}
            </DialogAction>
          )}
        </>
      }
    >
      {notice === null ? null : <DialogNotice notice={notice} />}
    </Dialog>
  );
}

/** 바깥에서 바뀐 파일을 알리는 거절이다(host가 `baseHash`를 가리킨다) */
function staleOf(error: CommandError): boolean {
  return error.kind === "rejected" && error.path === "baseHash";
}

export function MemoryPanel(): ReactNode {
  const commands = useCommands();
  const [load, setLoad] = useState<MemoryLoad>({ kind: "loading" });
  const [notice, setNotice] = useState<MessageId | null>(null);
  const [editor, setEditor] = useState<MemoryEditor>({ kind: "closed" });
  const [removing, setRemoving] = useState<MemoryRemoving | null>(null);
  const [busy, setBusy] = useState(false);

  const latest = useRef(0);
  const reload = useCallback(async (): Promise<void> => {
    latest.current += 1;
    const seq = latest.current;
    const read = await commands.memory.read();
    if (seq !== latest.current) return;
    setLoad(
      read.ok
        ? { kind: "ready", stores: read.value.stores }
        : { kind: "failed", unsupported: read.error.kind === "unsupported" },
    );
  }, [commands]);

  useEffect(() => {
    detach(reload(), rethrow);
    // 창이 다시 앞에 오면 바깥(CLI, 모델)에서 바뀐 것을 읽는다
    const onFocus = (): void => {
      detach(reload(), rethrow);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  const hashOf = (store: MemoryStore): string | null => {
    if (load.kind !== "ready") return null;
    return load.stores.find((candidate) => candidate.store === store)?.fileHash ?? null;
  };

  const finish = async (
    done: Promise<
      | { readonly ok: true; readonly value: unknown }
      | { readonly ok: false; readonly error: CommandError }
    >,
  ): Promise<void> => {
    setBusy(true);
    const result = await done;
    setBusy(false);
    if (result.ok) {
      setNotice(null);
      setEditor({ kind: "closed" });
      setRemoving(null);
    } else {
      setNotice(staleOf(result.error) ? "desktop.memory.stale" : "desktop.memory.saveFailed");
      if (staleOf(result.error)) {
        setEditor({ kind: "closed" });
        setRemoving(null);
      }
    }
    await reload();
  };

  const save = (): void => {
    if (editor.kind !== "open") return;
    const { store, entryId, text } = editor;
    const base = hashOf(store);
    if (entryId === null) {
      detach(finish(commands.memory.add(store, text.trim())), rethrow);
      return;
    }
    if (base === null) return;
    detach(finish(commands.memory.replace(store, entryId, text.trim(), base)), rethrow);
  };

  const confirmRemove = (): void => {
    if (removing === null) return;
    const base = hashOf(removing.store);
    if (base === null) return;
    detach(finish(commands.memory.remove(removing.store, removing.entryId, base)), rethrow);
  };

  return (
    <MemoryPanelView
      load={load}
      notice={notice}
      editor={editor}
      removing={removing}
      busy={busy}
      onOpenAdd={(store) => {
        setNotice(null);
        setEditor({ kind: "open", store, entryId: null, text: "" });
      }}
      onOpenEdit={(store, entryId, text) => {
        setNotice(null);
        setEditor({ kind: "open", store, entryId, text });
      }}
      onText={(text) => {
        setEditor((current) => (current.kind === "open" ? { ...current, text } : current));
      }}
      onSave={save}
      onCloseEditor={() => {
        setEditor({ kind: "closed" });
      }}
      onAskRemove={(store, entryId, text) => {
        setNotice(null);
        setRemoving({ store, entryId, text });
      }}
      onConfirmRemove={confirmRemove}
      onCloseRemove={() => {
        setRemoving(null);
      }}
    />
  );
}
