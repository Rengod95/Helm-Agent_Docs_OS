import type { ItemId, ItemRecord, TurnId } from "@fresnel/contracts/conversation";
import { messageCopyText, type TurnSummary } from "../../../state/engine/index.ts";
import { previewOf, summarizeToolArgs } from "../../../state/engine/tool-summary.ts";
import { fileChangeViewOfArgs, type FileChangeView } from "../../approval-form.ts";

// 변경 탭(DP-198~200)의 순수 모델. 열린 대화의 확정 item에서 `edit`·`write` 호출을 턴(사용자 말 하나에서 다음 사용자 말 앞까지)별로 모은다.
// 엔진은 파일 변경을 따로 기록하지 않으므로 도구 호출 인자가 원천이다. `edit`은 바꾼 줄이 정확하고, `write`는 쓴 줄 수만 안다(옛 내용을 모른다).
// 명령(`bash`)과 하위 에이전트(`agent`)가 바꾼 파일은 알 수 없어 "추적 밖" 호출로만 남긴다.

/** 호출의 결과. 결과가 아직 없고 턴이 돌고 있으면 `pending`, 오류 결과거나 턴이 끝났는데 결과가 없으면 `failed`다 */
type CallState = "applied" | "failed" | "pending";

/** 파일 하나를 바꾼 호출 하나 */
interface FileEdit {
  readonly callId: string;
  /** `ChangesView.turns` 안 자리 */
  readonly turnIndex: number;
  readonly view: FileChangeView;
  readonly added: number;
  /** 지운 줄 수. `write`는 옛 내용을 몰라 null이다 */
  readonly removed: number | null;
  readonly state: Exclude<CallState, "failed">;
}

/** 파일 하나에 모은 변경. 실패한 호출은 넣지 않는다 */
export interface FileChange {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  /** 전체 쓰기(`write`)가 끼어 있어 지운 줄 수를 다 알지 못한다 */
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

/** diff 줄에서 더한 줄과 지운 줄을 센다. `write`는 쓴 줄 전부가 더한 줄이다 */
function lineCountOf(view: FileChangeView): {
  readonly added: number;
  readonly removed: number | null;
} {
  if (view.kind === "write") return { added: view.head.length + view.hiddenLines, removed: null };
  let added = 0;
  let removed = 0;
  for (const row of [...view.head, ...view.rest]) {
    if (row.kind === "add") added += 1;
    else if (row.kind === "remove") removed += 1;
  }
  return { added, removed };
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
      if (item?.kind !== "assistant") continue;
      for (const block of item.message.content) {
        if (block.type !== "toolCall") continue;
        const state = stateOf(results, block.id, running);
        const view = fileChangeViewOfArgs(block.name, block.arguments);
        if (view !== null) {
          if (state === "failed") continue;
          edits.push({ callId: block.id, turnIndex: index, view, ...lineCountOf(view), state });
          continue;
        }
        const loose = untrackedOf(block.name, block.arguments);
        if (loose !== null) untracked.push({ callId: block.id, turnIndex: index, state, ...loose });
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
