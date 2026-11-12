import { parseTaskList, type TaskListLine } from "@fresnel/contracts/capabilities";

// 할 일 블록(`task_write`)의 줄 모델(DP-143). 순수 함수다.
// 블록은 그 호출이 끝난 시점의 전체 목록을 그린다: 원천은 그 호출의 결과 글(`renderTaskList`, 그 시점 전체 체크리스트)이다.
// 지금 상태(`selectNow`)를 쓰면 옛 블록에도 최신 숫자가 붙는다(dzV 문제 2). 결과가 아직 없으면 이번 호출이 보낸 항목만 그린다.

/** 이번 호출의 연산 하나(`summarizeToolArgs`의 tasks 항목과 같은 모양) */
export type TaskOp = {
  readonly op: "create" | "update" | "link" | "unlink";
  readonly ref: string | null;
  readonly content: string | null;
  readonly status: string | null;
};

export type ChecklistRow = {
  readonly key: string;
  readonly content: string;
  /** 할 일 상태 글(`pending`, `in_progress`, `completed`, `failed`, `cancelled`). 모르면 null */
  readonly status: string | null;
  /** 이번 호출이 만들거나 바꾼 줄 */
  readonly changed: boolean;
};

export type Checklist = {
  /** 그 시점의 진행(취소는 세지 않는다). 결과를 읽지 못했으면 null */
  readonly progress: { readonly done: number; readonly total: number } | null;
  /** 늘 보이는 줄 */
  readonly rows: readonly ChecklistRow[];
  /** 접어 둔 줄(바뀌지 않았고 진행 중도 아닌 줄). 목록이 길 때만 */
  readonly folded: readonly ChecklistRow[];
};

/** 이보다 줄이 많으면 바뀐 줄과 진행 중 줄만 두고 나머지를 접는다 */
const CHECKLIST_FOLD_AFTER = 9;

const CREATED_HEAD = /^Created: (.*)$/mu;

/** 결과 머리 `Created: @a=t1, @b=t2`의 참조 → id */
function createdIdsOf(text: string): ReadonlyMap<string, string> {
  const head = CREATED_HEAD.exec(text)?.[1];
  if (head === undefined) return new Map();
  return new Map(
    head.split(", ").flatMap((pair) => {
      const [ref, id] = pair.split("=");
      return ref === undefined || id === undefined ? [] : [[ref, id] as const];
    }),
  );
}

/** 이번 호출이 건드린 작업 id. create는 결과 머리로 참조를 풀고, 참조가 없는 create는 이름이 같은 줄로 찾는다 */
function changedIdsOf(
  ops: readonly TaskOp[],
  lines: readonly TaskListLine[],
  created: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const op of ops) {
    if (op.op === "link" || op.op === "unlink") continue;
    if (op.op === "update") {
      if (op.ref !== null) ids.add(created.get(op.ref) ?? op.ref);
      continue;
    }
    const byRef = op.ref === null ? undefined : created.get(op.ref);
    if (byRef !== undefined) {
      ids.add(byRef);
      continue;
    }
    const byName = lines.find((line) => line.label === op.content && !ids.has(line.id));
    if (byName !== undefined) ids.add(byName.id);
  }
  return ids;
}

/** 긴 목록에서 접지 않는 줄: 이번에 바뀐 줄과 진행 중 줄 */
function keep(row: ChecklistRow): boolean {
  return row.changed || row.status === "in_progress";
}

/** 결과 글이 없을 때: 이번 호출의 항목만(진행 숫자 없음) */
function opsOnly(ops: readonly TaskOp[]): Checklist {
  const rows = ops.flatMap((op, index): ChecklistRow[] =>
    op.op === "link" || op.op === "unlink"
      ? []
      : [
          {
            key: `${index}:${op.ref ?? op.content ?? ""}`,
            content: op.content ?? op.ref ?? "",
            status: op.status ?? (op.op === "create" ? "pending" : null),
            changed: true,
          },
        ],
  );
  return { progress: null, rows, folded: [] };
}

/**
 * 블록의 줄. `resultText`가 체크리스트로 읽히면 그 시점 전체 목록과 진행이고, 이번 호출이 바꾼 줄에 `changed`가 선다.
 * 줄이 `CHECKLIST_FOLD_AFTER`보다 많으면 바뀐 줄·진행 중 줄 밖의 줄은 `folded`로 간다(차례는 지킨다)
 */
export function checklistOf(ops: readonly TaskOp[], resultText: string | null): Checklist {
  const lines = resultText === null ? null : parseTaskList(resultText);
  if (lines === null || resultText === null) return opsOnly(ops);
  const changed = changedIdsOf(ops, lines, createdIdsOf(resultText));
  const all = lines.map((line): ChecklistRow => ({
    key: line.id,
    content: line.label,
    status: line.status,
    changed: changed.has(line.id),
  }));
  const counted = lines.filter((line) => line.status !== "cancelled");
  const progress = {
    done: counted.filter((line) => line.status === "completed").length,
    total: counted.length,
  };
  if (all.length <= CHECKLIST_FOLD_AFTER) return { progress, rows: all, folded: [] };
  return { progress, rows: all.filter(keep), folded: all.filter((row) => !keep(row)) };
}
