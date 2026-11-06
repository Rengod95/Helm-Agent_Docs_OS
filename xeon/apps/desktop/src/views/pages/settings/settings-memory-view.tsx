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

/** 행에 보이는 글. 줄바꿈은 한 줄 안에서 공백으로 보인다 */
function previewOf(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function MemoryPanelView(props: MemoryPanelViewProps): ReactNode {
  const { load, notice, busy } = props;
  return (
    <div data-slot="settings-memory" data-memory-state={load.kind}>
      <SettingSection
        title={
          <span className="flex items-center gap-2">
            {t("desktop.memory.label")}
            <InfoTip text={t("desktop.memory.info")} />
          </span>
        }
      >
        {notice === null ? null : (
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
  return (
    <div data-memory-store={spec.store} className="grid gap-2 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-body text-text-primary">
          {t(spec.title)}
          <InfoTip text={t(spec.info)} />
          <span className="text-ui-sm text-text-tertiary">
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
        <ul className="grid">
          {view.entries.map((entry) => (
            <li
              key={entry.id}
              data-memory-entry={entry.id}
              className="flex items-center justify-between gap-3 border-b border-border-subtle py-2"
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

function EditorDialog(args: { readonly props: MemoryPanelViewProps }): ReactNode {
  const { props } = args;
  const { editor, busy } = props;
  const open = editor.kind === "open";
  const adding = editor.kind === "open" && editor.entryId === null;
  const text = editor.kind === "open" ? editor.text : "";
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
      <Textarea
        aria-label={t("desktop.memory.text.label")}
        rows={4}
        value={text}
        onChange={(event) => {
          props.onText(event.currentTarget.value);
        }}
      />
    </Dialog>
  );
}

function RemoveDialog(args: { readonly props: MemoryPanelViewProps }): ReactNode {
  const { props } = args;
  const { removing, busy } = props;
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
    />
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
