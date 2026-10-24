import type { WorkTask, WorkTaskId } from "@xeon/contracts/capabilities";

// L2.work.spec §4.1.3. 선행 간선 `A blockedBy B`를 더하기 전의 순환 검사. 순수 함수다.

/**
 * 간선 `task blockedBy blocker`를 더하면 순환이 생기는지 본다. blocker에서 blockedBy 간선을 깊이 우선으로 따라
 * task에 이르는 경로가 있으면 순환 경로 [task, blocker, …, task]를 돌려준다. 자기 간선은 [task, task]다.
 * 선행 작업은 입력 순서대로 방문하므로 같은 입력은 같은 경로를 낸다.
 */
export function findCycle(
  tasks: ReadonlyMap<WorkTaskId, WorkTask>,
  task: WorkTaskId,
  blocker: WorkTaskId,
): WorkTaskId[] | undefined {
  if (task === blocker) return [task, task];
  const visited = new Set<WorkTaskId>([blocker]);
  // 스택 항목: 지금까지의 경로(blocker부터)와 그 끝 노드에서 아직 보지 않은 선행 작업 목록
  const stack: { path: WorkTaskId[]; rest: WorkTaskId[] }[] = [
    { path: [blocker], rest: (tasks.get(blocker)?.blockedBy ?? []).toReversed() },
  ];
  for (;;) {
    const top = stack[stack.length - 1];
    if (top === undefined) return undefined;
    const next = top.rest.pop();
    if (next === undefined) {
      stack.pop();
      continue;
    }
    if (next === task) return [task, ...top.path, task];
    if (visited.has(next)) continue;
    visited.add(next);
    stack.push({
      path: [...top.path, next],
      rest: (tasks.get(next)?.blockedBy ?? []).toReversed(),
    });
  }
}
