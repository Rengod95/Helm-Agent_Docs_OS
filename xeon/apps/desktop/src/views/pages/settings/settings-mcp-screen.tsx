import { toast } from "@caustic/react";
import { activeLocale, t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { McpServerDef } from "@fresnel/contracts/capabilities";
import type { McpServerAction, McpServerRow } from "@fresnel/contracts/wire";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { useCommands, type Commands } from "../../commands.ts";
import {
  defOfDraft,
  draftOfDefinition,
  EMPTY_DRAFT,
  idsOf,
  mcpDefOfView,
  newFailuresOf,
  plaintextSecretOf,
  tableWithServer,
  userTableOf,
  withRowReplaced,
  type DraftIssue,
  type McpDraft,
  type McpLoad,
} from "./settings-mcp-model.ts";
import { commandErrorRefOf, type MsgRef } from "./settings-mcp-text.ts";
import { McpFormDialog, McpRemoveDialog, McpServersView } from "./settings-mcp-view.tsx";

// 설정 "도구와 웹" 탭의 "MCP 서버" 구역(W-15)의 동작. 목록은 `mcp.servers`로 읽고, 행동은 `mcp.serverAction`으로 보낸다.
// 설정에 둔 서버의 추가·고치기·지우기는 사용자 범위 `l2.mcp.servers` 표 전체를 다시 읽어 그 서버만 바꾸고 `settings.set`으로 쓴다.
// 서버 변경을 알리는 wire 알림이 없어서, 구역이 열릴 때와 다시 불러오기, 행동과 저장 뒤에만 읽는다.
// 시작 실패는 서버 id와 오류 시각이 같으면 이 앱 실행 안에서 한 번만 토스트로 알린다.

/** 저장과 지우기가 쓰는 서버 한 칸. `previousId`가 없으면 새 서버다 */
interface ServerChange {
  readonly previousId: string | null;
  readonly id: string;
  readonly def: McpServerDef | null;
}

/** 대화 상자 상태. 추가·고치기 폼과 지우기 확인 가운데 하나만 열린다 */
type Dialog =
  | { readonly kind: "closed" }
  | {
      readonly kind: "form";
      readonly previousId: string | null;
      readonly base: McpServerDef | null;
      readonly draft: McpDraft;
      readonly issue: DraftIssue | null;
      readonly error: MsgRef | null;
      readonly saving: boolean;
    }
  | {
      readonly kind: "remove";
      readonly server: string;
      readonly error: MsgRef | null;
      readonly busy: boolean;
    };

/**
 * 행동이 끝난 뒤에도 단추를 잠가 두는 시간(밀리초). 같은 단추가 행동 결과로 "항상 끄기"에서 "차단 풀기"로 바뀌므로,
 * 연속 클릭의 두 번째 눌림이 방금 한 행동을 되돌리지 않게 한다
 */
const ACTION_SETTLE_MS = 700;

/** 이 앱 실행에서 이미 알린 시작 실패(서버 id와 오류 시각). 구역을 닫았다 열어도 같은 실패는 다시 알리지 않는다 */
const ANNOUNCED = new Set<string>();

function announceFailures(rows: readonly McpServerRow[]): void {
  for (const notice of newFailuresOf(rows, ANNOUNCED)) {
    ANNOUNCED.add(notice.key);
    toast({
      tone: "danger",
      title: t("desktop.settings.mcp.toast.failed", { name: notice.name, reason: notice.reason }),
      dismissLabel: t("desktop.workbench.toast.dismiss"),
    });
  }
}

function withMember(set: ReadonlySet<string>, value: string, member: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (member) next.add(value);
  else next.delete(value);
  return next;
}

function withRowError(
  errors: Readonly<Record<string, MsgRef>>,
  server: string,
  error: MsgRef | null,
): Readonly<Record<string, MsgRef>> {
  const next: Record<string, MsgRef> = { ...errors };
  if (error === null) delete next[server];
  else next[server] = error;
  return next;
}

/** 사용자 설정 파일의 서버 표를 읽어 한 서버만 바꾸고 다시 쓴다. 실패하면 글을 돌려주고, 성공하면 `null`이다 */
async function persistServer(commands: Commands, change: ServerChange): Promise<MsgRef | null> {
  const read = await commands.settings.readFile({ scope: "user", threadId: null });
  if (!read.ok) return commandErrorRefOf(read.error);
  const table = userTableOf(read.value.text);
  if (!table.ok) {
    return table.error === "unreadable"
      ? { id: "desktop.settings.mcp.error.tableUnreadable" }
      : { id: "desktop.settings.mcp.error.tableInvalid" };
  }
  const written = await commands.mcp.setUserTable(tableWithServer(table.value, change));
  return written.ok ? null : commandErrorRefOf(written.error);
}

/** "MCP 서버" 구역. 연결이 살아 있을 때 목록을 읽고, 꺼져 있으면 안내만 보인다 */
export function McpServersPanel(): ReactNode {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [load, setLoad] = useState<McpLoad>({ kind: "loading" });
  // 다시 읽기 신호. 다시 불러오기 단추, 행동과 저장과 지우기의 뒤가 올린다
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [rowErrors, setRowErrors] = useState<Readonly<Record<string, MsgRef>>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [dialog, setDialog] = useState<Dialog>({ kind: "closed" });

  useEffect(() => {
    if (!live) return undefined;
    let stale = false;
    const read = async (): Promise<void> => {
      const listed = await commands.mcp.servers();
      if (stale) return;
      if (!listed.ok) {
        setLoad({ kind: "failed" });
        return;
      }
      setLoad({ kind: "ready", rows: listed.value, rev: tick });
      announceFailures(listed.value);
    };
    detach(read(), rethrow);
    return () => {
      stale = true;
    };
  }, [commands, live, tick]);

  const reload = (): void => {
    setTick((n) => n + 1);
  };

  // 처리 중인 서버. 상태가 아니라 참조인 이유: 같은 틱의 두 번째 눌림도 막아야 한다
  const inflight = useRef<Set<string>>(new Set());

  const release = (server: string): void => {
    inflight.current.delete(server);
    setBusy((prev) => withMember(prev, server, false));
  };

  const runAction = async (server: string, action: McpServerAction): Promise<void> => {
    const done = await commands.mcp.serverAction(server, action);
    if (!done.ok) {
      release(server);
      setRowErrors((prev) => withRowError(prev, server, commandErrorRefOf(done.error)));
      return;
    }
    setLoad((prev) =>
      prev.kind === "ready"
        ? { kind: "ready", rows: withRowReplaced(prev.rows, done.value), rev: prev.rev }
        : prev,
    );
    // 행동은 다른 행의 상태(이름 충돌로 숨은 도구 등)도 바꿀 수 있으니 목록을 다시 읽는다
    reload();
    window.setTimeout(() => {
      release(server);
    }, ACTION_SETTLE_MS);
  };

  const act = (server: string, action: McpServerAction): void => {
    if (inflight.current.has(server)) return;
    inflight.current.add(server);
    setBusy((prev) => withMember(prev, server, true));
    setRowErrors((prev) => withRowError(prev, server, null));
    detach(runAction(server, action), rethrow);
  };

  const openAdd = (): void => {
    setDialog({
      kind: "form",
      previousId: null,
      base: null,
      draft: EMPTY_DRAFT,
      issue: null,
      error: null,
      saving: false,
    });
  };

  const openEdit = (server: string): void => {
    if (load.kind !== "ready") return;
    const row = load.rows.find((candidate) => candidate.server === server);
    if (row === undefined || row.definition === undefined) return;
    setDialog({
      kind: "form",
      previousId: server,
      base: mcpDefOfView(row.definition),
      draft: draftOfDefinition(server, row.definition),
      issue: null,
      error: null,
      saving: false,
    });
  };

  const runSave = async (change: ServerChange): Promise<void> => {
    const error = await persistServer(commands, change);
    if (error === null) {
      setDialog({ kind: "closed" });
      reload();
      return;
    }
    setDialog((prev) => (prev.kind === "form" ? { ...prev, saving: false, error } : prev));
  };

  const save = (): void => {
    if (dialog.kind !== "form" || dialog.saving || load.kind !== "ready") return;
    const taken = idsOf(load.rows).filter((id) => id !== dialog.previousId);
    const checked = defOfDraft(dialog.draft, { base: dialog.base, taken });
    if (!checked.ok) {
      setDialog({ ...dialog, issue: checked.error, error: null });
      return;
    }
    setDialog({ ...dialog, issue: null, error: null, saving: true });
    detach(
      runSave({ previousId: dialog.previousId, id: checked.value.id, def: checked.value.def }),
      rethrow,
    );
  };

  const askRemove = (server: string): void => {
    setDialog({ kind: "remove", server, error: null, busy: false });
  };

  const runRemove = async (server: string): Promise<void> => {
    const error = await persistServer(commands, { previousId: server, id: server, def: null });
    if (error === null) {
      setDialog({ kind: "closed" });
      reload();
      return;
    }
    setDialog((prev) => (prev.kind === "remove" ? { ...prev, busy: false, error } : prev));
  };

  const confirmRemove = (): void => {
    if (dialog.kind !== "remove" || dialog.busy) return;
    const server = dialog.server;
    setDialog({ ...dialog, busy: true, error: null });
    detach(runRemove(server), rethrow);
  };

  const formOpen = dialog.kind === "form";
  const draft = dialog.kind === "form" ? dialog.draft : EMPTY_DRAFT;
  const close = (): void => {
    setDialog({ kind: "closed" });
  };

  return (
    <>
      <McpServersView
        load={load}
        offline={!live}
        locale={activeLocale()}
        busy={busy}
        rowErrors={rowErrors}
        expanded={expanded}
        onReload={reload}
        onAdd={openAdd}
        onToggle={(server) => {
          setExpanded((prev) => withMember(prev, server, !prev.has(server)));
        }}
        onAction={act}
        onEdit={openEdit}
        onRemove={askRemove}
      />
      <McpFormDialog
        open={formOpen}
        adding={dialog.kind === "form" && dialog.previousId === null}
        draft={draft}
        issue={dialog.kind === "form" ? dialog.issue : null}
        error={dialog.kind === "form" ? dialog.error : null}
        saving={dialog.kind === "form" && dialog.saving}
        plaintextSecret={plaintextSecretOf(draft)}
        onDraft={(next) => {
          setDialog((prev) =>
            prev.kind === "form" ? { ...prev, draft: next, issue: null, error: null } : prev,
          );
        }}
        onSave={save}
        onClose={close}
      />
      <McpRemoveDialog
        open={dialog.kind === "remove"}
        busy={dialog.kind === "remove" && dialog.busy}
        error={dialog.kind === "remove" ? dialog.error : null}
        onConfirm={confirmRemove}
        onClose={close}
      />
    </>
  );
}
