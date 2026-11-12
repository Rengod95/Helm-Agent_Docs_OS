import { toast } from "@caustic/react";
import { activeLocale, t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { McpServerDef } from "@fresnel/contracts/capabilities";
import type { McpServerAction, McpServerRow } from "@fresnel/contracts/wire";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { useCommands } from "../../commands.ts";
import {
  defOfDraft,
  draftOfDefinition,
  EMPTY_DRAFT,
  idsOf,
  mcpDefOfView,
  newFailuresOf,
  plaintextSecretOf,
  withRowReplaced,
  type DraftIssue,
  type McpDraft,
  type McpLoad,
} from "./settings-mcp-model.ts";
import { commandErrorRefOf, type MsgRef } from "./settings-mcp-text.ts";
import { persistServer, type ServerChange } from "./settings-mcp-write.ts";
import { draftsOfPaste, freeIdOf } from "./settings-mcp-paste.ts";
import { settledOf, testStepsOf, TEST_DEADLINE_MS, TEST_POLL_MS } from "./settings-mcp-test.ts";
import {
  McpFormDialog,
  McpRemoveDialog,
  McpServersView,
  type PasteNote,
} from "./settings-mcp-view.tsx";

// 설정 "도구와 웹" 탭의 "MCP 서버" 구역(W-15)의 동작. 목록은 `mcp.servers`로 읽고, 행동은 `mcp.serverAction`으로 보낸다.
// 설정에 둔 서버의 추가·고치기·지우기는 사용자 설정 파일을 `settings.readFile`로 읽어 `l2.mcp.servers` 표의 그 서버만 바꾸고,
// 읽은 해시를 `baseSha256`으로 실어 `settings.writeFile`로 쓴다. 읽은 뒤 파일이 바뀌었으면 충돌로 알리고 덮어쓰지 않는다.
// 서버 변경을 알리는 wire 알림이 없어서, 구역이 열릴 때와 다시 불러오기, 행동과 저장 뒤에만 읽는다.
// 시작 실패는 서버 id와 오류 시각이 같으면 이 앱 실행 안에서 한 번만 토스트로 알린다.

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
      /** 붙여 넣은 글과 그 결과(추가일 때만 쓴다) */
      readonly paste: string;
      readonly pasteNote: PasteNote | null;
      readonly candidates: readonly McpDraft[];
      readonly chosen: number;
      /** 저장 뒤 연결 시험. 있으면 대화 상자가 점검 줄을 보인다 */
      readonly test: TestState | null;
    }
  | {
      readonly kind: "remove";
      readonly server: string;
      readonly error: MsgRef | null;
      readonly busy: boolean;
    };

/** 연결 시험의 진행. 같은 시험인지는 `run` 번호로 가린다(다시 시험·닫기 뒤의 옛 응답을 버린다) */
interface TestState {
  readonly run: number;
  readonly server: string;
  readonly name: string;
  readonly saveMs: number;
  /** 저장 뒤 지난 시간. 다시 읽을 때마다 고친다 */
  readonly elapsedMs: number;
  readonly row: McpServerRow | undefined;
  readonly timedOut: boolean;
}

const EMPTY_FORM = {
  issue: null,
  error: null,
  saving: false,
  paste: "",
  pasteNote: null,
  candidates: [],
  chosen: 0,
  test: null,
} as const;

/** 붙여 넣은 서버 하나를 폼 초안으로: 이미 쓰는 이름이면 `-2`를 붙인다 */
function noteOfDraft(draft: McpDraft, count: number): PasteNote {
  return { kind: "filled", name: draft.id, env: draft.env.length + draft.headers.length, count };
}

/** 단조 시계(밀리초). 시험 경과는 이벤트 처리와 비동기 응답에서만 잰다 */
function clockMs(): number {
  return performance.now();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

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

/** 환경 변수 값 칸 옆 시크릿 고르기의 이름들. 폼이 열릴 때 한 번 읽고, 읽지 못하면 빈 목록이다(고르기가 사라질 뿐) */
function useSecretNameList(open: boolean): readonly string[] {
  const commands = useCommands();
  const [names, setNames] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!open) return undefined;
    let stale = false;
    detach(
      commands.secrets.list().then((listed) => {
        if (!stale) setNames(listed.ok ? listed.value.map((entry) => entry.name) : []);
        return undefined;
      }),
      rethrow,
    );
    return () => {
      stale = true;
    };
  }, [commands, open]);
  return names;
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
  const secretNames = useSecretNameList(live && dialog.kind === "form");

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
    setDialog({ kind: "form", previousId: null, base: null, draft: EMPTY_DRAFT, ...EMPTY_FORM });
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
      ...EMPTY_FORM,
    });
  };

  // 연결 시험 번호. 다시 시험하거나 닫으면 올라가서 옛 시험의 다시 읽기가 멈춘다
  const testRun = useRef(0);

  /** 저장한 서버를 1초마다 다시 읽어 상태가 정해지거나 15초가 지나면 멈춘다. 한 번 읽고 기다린 뒤 자기를 다시 부른다 */
  const runTest = async (run: number, server: string, started: number): Promise<void> => {
    const listed = await commands.mcp.servers();
    if (testRun.current !== run) return;
    const row = listed.ok ? listed.value.find((item) => item.server === server) : undefined;
    if (listed.ok) setLoad({ kind: "ready", rows: listed.value, rev: run });
    const elapsedMs = clockMs() - started;
    const timedOut = elapsedMs >= TEST_DEADLINE_MS;
    setDialog((prev) =>
      prev.kind === "form" && prev.test !== null && prev.test.run === run
        ? { ...prev, test: { ...prev.test, row, timedOut, elapsedMs } }
        : prev,
    );
    if (settledOf(row) || timedOut) return;
    await wait(TEST_POLL_MS);
    if (testRun.current !== run) return;
    await runTest(run, server, started);
  };

  const startTest = (server: string, name: string, saveMs: number): void => {
    testRun.current += 1;
    const run = testRun.current;
    setDialog((prev) =>
      prev.kind === "form"
        ? {
            ...prev,
            saving: false,
            previousId: server,
            test: {
              run,
              server,
              name,
              saveMs,
              elapsedMs: 0,
              row: undefined,
              timedOut: false,
            },
          }
        : prev,
    );
    detach(runTest(run, server, clockMs()), rethrow);
  };

  const runSave = async (change: ServerChange, name: string): Promise<void> => {
    const started = clockMs();
    const error = await persistServer(commands, change);
    if (error === null) {
      // 고친 서버는 다시 띄워야 새 정의로 연결한다. 새 서버는 엔진이 설정을 읽고 바로 띄운다
      if (change.previousId !== null) await commands.mcp.serverAction(change.id, "restart");
      startTest(change.id, name, clockMs() - started);
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
    const name = dialog.draft.title.trim() === "" ? checked.value.id : dialog.draft.title.trim();
    detach(
      runSave(
        { previousId: dialog.previousId, id: checked.value.id, def: checked.value.def },
        name,
      ),
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
    testRun.current += 1;
    const tested = dialog.kind === "form" && dialog.test !== null;
    setDialog({ kind: "closed" });
    if (tested) reload();
  };
  const taken = load.kind === "ready" ? idsOf(load.rows) : [];

  /** 붙여 넣은 글을 읽어 초안을 채운다. 읽지 못하면 초안은 그대로 두고 까닭만 보인다 */
  const onPaste = (text: string): void => {
    setDialog((prev) => {
      if (prev.kind !== "form") return prev;
      if (text.trim() === "") {
        return { ...prev, paste: text, pasteNote: null, candidates: [], chosen: 0 };
      }
      const read = draftsOfPaste(text);
      if (!read.ok) {
        return {
          ...prev,
          paste: text,
          pasteNote: { kind: "issue", issue: read.error },
          candidates: [],
        };
      }
      // 붙여 넣은 서버끼리도 이름이 겹치지 않게 차례로 고른다
      const candidates: McpDraft[] = [];
      for (const item of read.value) {
        const id = freeIdOf(item.id, [...taken, ...candidates.map((made) => made.id)]);
        candidates.push({ ...item, id });
      }
      const first = candidates[0] ?? EMPTY_DRAFT;
      return {
        ...prev,
        paste: text,
        draft: first,
        issue: null,
        error: null,
        candidates,
        chosen: 0,
        pasteNote: noteOfDraft(first, candidates.length),
      };
    });
  };

  const onChoose = (index: number): void => {
    setDialog((prev) => {
      if (prev.kind !== "form") return prev;
      const picked = prev.candidates[index];
      if (picked === undefined) return prev;
      return {
        ...prev,
        draft: picked,
        chosen: index,
        pasteNote: noteOfDraft(picked, prev.candidates.length),
      };
    });
  };

  const test = dialog.kind === "form" ? dialog.test : null;

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
        adding={dialog.kind === "form" && dialog.previousId === null && dialog.test === null}
        draft={draft}
        issue={dialog.kind === "form" ? dialog.issue : null}
        error={dialog.kind === "form" ? dialog.error : null}
        saving={dialog.kind === "form" && dialog.saving}
        plaintextSecret={plaintextSecretOf(draft)}
        paste={
          dialog.kind === "form" && dialog.previousId === null && dialog.test === null
            ? {
                text: dialog.paste,
                note: dialog.pasteNote,
                candidates: dialog.candidates.map((item) => item.id),
                chosen: dialog.chosen,
                onText: onPaste,
                onChoose,
              }
            : null
        }
        secretNames={secretNames}
        test={
          test === null
            ? null
            : {
                name: test.name,
                steps: testStepsOf({
                  saveMs: test.saveMs,
                  elapsedMs: test.elapsedMs,
                  row: test.row,
                  timedOut: test.timedOut,
                }),
              }
        }
        onDraft={(next) => {
          setDialog((prev) =>
            prev.kind === "form" ? { ...prev, draft: next, issue: null, error: null } : prev,
          );
        }}
        onSave={save}
        onBackToForm={() => {
          testRun.current += 1;
          setDialog((prev) => (prev.kind === "form" ? { ...prev, test: null } : prev));
        }}
        onRetest={() => {
          if (test === null) return;
          detach(
            commands.mcp.serverAction(test.server, "restart").then(() => {
              startTest(test.server, test.name, test.saveMs);
              return undefined;
            }),
            rethrow,
          );
        }}
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
