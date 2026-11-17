import { fileChangesOf, type FileChangeEntry } from "@fresnel/contracts/capabilities";
import type { ItemId, ItemRecord, TurnId } from "@fresnel/contracts/conversation";
import { messageCopyText, type TurnSummary } from "../../../state/engine/index.ts";
import { previewOf, summarizeToolArgs } from "../../../state/engine/tool-summary.ts";
import { DIFF_HEAD_ROWS, type FileChangeRow, type FileChangeView } from "../../approval-form.ts";

// 변경 탭(DP-198~200)의 순수 모델. 열린 대화의 확정 item 가운데 완료된 도구 호출의 결과에서 파일 변경을 턴(사용자 말 하나에서 다음 사용자 말 앞까지)별로 모은다.
// 원천은 결과 `details`의 파일 변경 기록이고, 읽는 방법은 `fileChangesOf`다(M5e 스펙 §4.7, F-5). 엔진이 도구 결과에 싣는다(내장 `edit`·`write`는 옛 `FileChange` 한 건, 대체 도구와 플러그인은 `fileChanges` 목록).
// 도구 이름과 인자 모양은 보지 않는다. 결과가 아직 없는 호출은 파일로 세지 않는다(경로와 diff가 결과에서만 온다). 오류 결과도 세지 않는다.
// 명령(`bash`)과 하위 에이전트(`agent`)가 바꾼 파일은 알 수 없어 인자 이름으로 "추적 밖" 호출만 남긴다(P-4 계측 전).

/** 호출의 결과. 결과가 아직 없고 턴이 돌고 있으면 `pending`, 오류 결과거나 턴이 끝났는데 결과가 없으면 `failed`다. 추적 밖 호출에만 쓴다 */
type CallState = "applied" | "failed" | "pending";

/** 파일 하나를 바꾼 호출 하나(완료된 결과 하나가 실은 파일 여럿이면 여럿이다) */
interface FileEdit {
  readonly callId: string;
  /** `ChangesView.turns` 안 자리 */
  readonly turnIndex: number;
  readonly view: FileChangeView;
  readonly added: number;
  /** 지운 줄 수. 결과 기록이 지운 줄 수를 항상 실으므로 지금은 null이 없다 */
  readonly removed: number | null;
  readonly state: Exclude<CallState, "failed">;
}

/** 파일 하나에 모은 변경. 실패한 호출은 넣지 않는다 */
export interface FileChange {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  /** 지운 줄 수를 다 알지 못하는 쓰기가 끼어 있다. 결과의 변경 기록은 지운 줄 수를 항상 실으므로 지금 원천에서는 참이 되지 않는다 */
  readonly wholeWrite: boolean;
  readonly pending: boolean;
  readonly edits: readonly FileEdit[];
}

/** 파일 단위로 기록되지 않는 변경 가능성: 명령과 하위 에이전트 */
export interface UntrackedCall {
  readonly callId: string;
  readonly kind: "command" | "agent";
  /** 명령 줄, 또는 하위 에이전트 이름과 맡긴 일 */
  readonly text: string;
  readonly agent: string | null;
  readonly turnIndex: number;
  readonly state: CallState;
}

/** 턴 하나. 사용자 말 하나에서 다음 사용자 말 앞까지의 item이다 */
export interface ChangeTurn {
  readonly index: number;
  /** 사람이 읽는 번호(1부터). 사용자 말 앞의 item 묶음은 0이다 */
  readonly number: number;
  /** 시작한 사용자 말. 사용자 말 앞 묶음이면 null */
  readonly userItemId: ItemId | null;
  readonly prompt: string | null;
  /** 이 턴의 마지막 item. "여기로 되감기"가 대화 leaf를 이 item으로 옮긴다 */
  readonly endItemId: ItemId | null;
  readonly turnId: TurnId | null;
  readonly startedAt: string | null;
  readonly running: boolean;
  readonly files: readonly FileChange[];
  readonly untracked: readonly UntrackedCall[];
  readonly added: number;
  readonly removed: number;
}

export interface ChangesView {
  readonly turns: readonly ChangeTurn[];
  /** 대화 전체를 파일별로. 처음 바뀐 순서다 */
  readonly files: readonly FileChange[];
  readonly untracked: readonly UntrackedCall[];
  readonly added: number;
  readonly removed: number;
}

/** 프롬프트 한 줄 미리보기 글자 수 */
const PROMPT_PREVIEW = 120;
const UNTRACKED_PREVIEW = 160;

type Segment = { readonly userItemId: ItemId | null; readonly ids: ItemId[] };

function segmentsOf(
  itemIds: readonly ItemId[],
  items: Readonly<Record<string, ItemRecord>>,
): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  for (const id of itemIds) {
    const item = items[id];
    if (item === undefined) continue;
    if (item.kind === "user") {
      current = { userItemId: id, ids: [id] };
      segments.push(current);
      continue;
    }
    if (current === null) {
      current = { userItemId: null, ids: [] };
      segments.push(current);
    }
    current.ids.push(id);
  }
  return segments;
}

/** 도구 호출 id → 결과가 오류인가 */
function resultsOf(
  itemIds: readonly ItemId[],
  items: Readonly<Record<string, ItemRecord>>,
): ReadonlyMap<string, boolean> {
  const results = new Map<string, boolean>();
  for (const id of itemIds) {
    const item = items[id];
    if (item?.kind === "toolResult") results.set(item.message.toolCallId, item.message.isError);
  }
  return results;
}

function stateOf(
  results: ReadonlyMap<string, boolean>,
  callId: string,
  running: boolean,
): CallState {
  const isError = results.get(callId);
  if (isError === undefined) return running ? "pending" : "failed";
  return isError ? "failed" : "applied";
}

/**
 * 완료된 결과의 파일 변경 한 건을 그림 값으로 바꾼다. diff 줄을 더함·지움·문맥으로 나눈다(승인 카드의 edit 그림과 같은 모양).
 * 머리 `DIFF_HEAD_ROWS`줄 뒤는 `rest`다. diff가 없는 항목(보고된 것 중 diff를 안 준 것)은 줄 없는 그림이다.
 */
function viewOfEntry(entry: FileChangeEntry): FileChangeView {
  const rows = rowsOfDiff(entry.diff ?? "");
  return {
    kind: "edit",
    path: entry.path,
    head: rows.slice(0, DIFF_HEAD_ROWS),
    rest: rows.slice(DIFF_HEAD_ROWS),
  };
}

/**
 * 통합 diff 글을 줄 목록으로 바꾼다. 첫 `@@` 머리 앞의 파일 머리(`---`, `+++`)는 버린다. 머리 뒤의 본문 줄은 첫 글자가
 * `+`·`-`·` `이고, `\`(줄바꿈 없음 표시)와 빈 줄은 버린다. 본문 줄은 항상 이 표지로 시작하므로 `-- x` 같은 지운 줄도 맞게 읽는다.
 */
function rowsOfDiff(diff: string): readonly FileChangeRow[] {
  const rows: FileChangeRow[] = [];
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk || line === "" || line.startsWith("\\")) continue;
    const mark = line.charAt(0);
    const text = line.slice(1);
    if (mark === "+") rows.push({ kind: "add", text });
    else if (mark === "-") rows.push({ kind: "remove", text });
    else if (mark === " ") rows.push({ kind: "context", text });
  }
  return rows;
}

/** 호출들을 경로별로 모은다. 처음 나온 경로 순서를 지킨다 */
function filesOf(edits: readonly FileEdit[]): readonly FileChange[] {
  const byPath = new Map<string, FileEdit[]>();
  for (const edit of edits) {
    const list = byPath.get(edit.view.path);
    if (list === undefined) byPath.set(edit.view.path, [edit]);
    else list.push(edit);
  }
  return [...byPath].map(([path, list]) => ({
    path,
    added: list.reduce((sum, e) => sum + e.added, 0),
    removed: list.reduce((sum, e) => sum + (e.removed ?? 0), 0),
    wholeWrite: list.some((e) => e.removed === null),
    pending: list.some((e) => e.state === "pending"),
    edits: list,
  }));
}

function sumOf(files: readonly FileChange[]): { readonly added: number; readonly removed: number } {
  return {
    added: files.reduce((sum, f) => sum + f.added, 0),
    removed: files.reduce((sum, f) => sum + f.removed, 0),
  };
}

function summaryOf(
  turns: readonly TurnSummary[],
  userItemId: ItemId | null,
  last: boolean,
): TurnSummary | null {
  if (userItemId !== null) {
    const found = turns.find((t) => t.inputItemIds.includes(userItemId));
    if (found !== undefined) return found;
  }
  // 시작 사건을 못 본 옛 턴은 입력 item을 모른다. 마지막 묶음만 도는 턴에 잇는다
  if (last) return turns.find((t) => t.running) ?? null;
  return null;
}

function untrackedOf(
  name: string,
  args: unknown,
): {
  readonly kind: UntrackedCall["kind"];
  readonly text: string;
  readonly agent: string | null;
} | null {
  const summary = summarizeToolArgs(name, args);
  if (summary.kind === "command") {
    return { kind: "command", text: previewOf(summary.command, UNTRACKED_PREVIEW), agent: null };
  }
  if (summary.kind === "agent") {
    return {
      kind: "agent",
      text: previewOf(summary.task, UNTRACKED_PREVIEW),
      agent: summary.agent,
    };
  }
  return null;
}

/** 열린 대화의 확정 item과 턴 요약에서 변경 보기를 만든다(순수) */
export function changesOf(input: {
  readonly itemIds: readonly ItemId[];
  readonly items: Readonly<Record<string, ItemRecord>>;
  readonly turns: readonly TurnSummary[];
}): ChangesView {
  const { itemIds, items } = input;
  const results = resultsOf(itemIds, items);
  const segments = segmentsOf(itemIds, items);
  const allEdits: FileEdit[] = [];
  const allUntracked: UntrackedCall[] = [];
  let number = 0;
  const turns = segments.map((segment, index): ChangeTurn => {
    if (segment.userItemId !== null) number += 1;
    const summary = summaryOf(input.turns, segment.userItemId, index === segments.length - 1);
    const running = summary?.running ?? false;
    const edits: FileEdit[] = [];
    const untracked: UntrackedCall[] = [];
    for (const id of segment.ids) {
      const item = items[id];
      // 완료된 호출의 결과에 실린 파일 변경만 센다. 오류 결과는 세지 않는다. 결과가 없는 호출은 경로와 diff가 없어 그릴 것이 없다
      if (item?.kind === "toolResult" && !item.message.isError) {
        for (const entry of fileChangesOf(item.message.details ?? null)) {
          edits.push({
            callId: item.message.toolCallId,
            turnIndex: index,
            view: viewOfEntry(entry),
            added: entry.added,
            removed: entry.removed,
            state: "applied",
          });
        }
        continue;
      }
      if (item?.kind !== "assistant") continue;
      for (const block of item.message.content) {
        if (block.type !== "toolCall") continue;
        const loose = untrackedOf(block.name, block.arguments);
        if (loose !== null) {
          const state = stateOf(results, block.id, running);
          untracked.push({ callId: block.id, turnIndex: index, state, ...loose });
        }
      }
    }
    allEdits.push(...edits);
    allUntracked.push(...untracked);
    const files = filesOf(edits);
    const sums = sumOf(files);
    const user = segment.userItemId === null ? undefined : items[segment.userItemId];
    const prompt = user === undefined ? null : messageCopyText(user);
    return {
      index,
      number: segment.userItemId === null ? 0 : number,
      userItemId: segment.userItemId,
      prompt:
        prompt === null ? null : previewOf(prompt.replace(/\s+/g, " ").trim(), PROMPT_PREVIEW),
      endItemId: segment.ids.at(-1) ?? null,
      turnId: summary?.turnId ?? null,
      startedAt: summary?.startedAt ?? null,
      running,
      files,
      untracked,
      added: sums.added,
      removed: sums.removed,
    };
  });
  const files = filesOf(allEdits);
  return { turns, files, untracked: allUntracked, ...sumOf(files) };
}

/** 턴별 보기에 싣는 턴: 바꾼 파일이나 추적 밖 호출이 있는 턴. 새 턴이 앞이다 */
export function changedTurnsOf(view: ChangesView): readonly ChangeTurn[] {
  return view.turns.filter((t) => t.files.length > 0 || t.untracked.length > 0).toReversed();
}

/**
 * 이 턴 끝으로 되감을 수 있는가. 마지막 턴은 지금 자리라 되감을 것이 없다. 도는 턴이 있으면 엔진이 거절한다(`turn.busy`).
 * 사용자 말 앞 묶음은 되감기 자리가 아니다
 */
export type RewindAvailability =
  | { readonly kind: "ok"; readonly target: ItemId; readonly dropsTurns: number }
  | { readonly kind: "latest" }
  | { readonly kind: "busy" }
  | { readonly kind: "none" };

export function rewindOf(view: ChangesView, turn: ChangeTurn): RewindAvailability {
  const last = view.turns.at(-1);
  if (last === undefined || turn.index === last.index) return { kind: "latest" };
  if (turn.userItemId === null || turn.endItemId === null) return { kind: "none" };
  if (view.turns.some((t) => t.running)) return { kind: "busy" };
  const dropsTurns = view.turns.filter((t) => t.index > turn.index && t.userItemId !== null).length;
  return { kind: "ok", target: turn.endItemId, dropsTurns };
}

/** 경로를 이름과 폴더로 나눈다. 폴더가 없으면 빈 글이다 */
export function pathPartsOf(path: string): { readonly name: string; readonly dir: string } {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  if (slash < 0) return { name: trimmed, dir: "" };
  return { name: trimmed.slice(slash + 1), dir: trimmed.slice(0, slash) };
}
