import { expect, test } from "bun:test";
import { crashAndResume } from "../support/crash.ts";

// 프로세스 강제 종료 뒤 재개. 실제 세션 DB와 자식 프로세스 SIGKILL은 L1.agents·core-persistence의 시험이 맡고(REQ-L1-01),
// 여기서는 같은 기록 저장소·루프·큐 위에 새 호스트를 올려 Helm이 마지막 커밋 상태에서 이어 가는지 본다

test("resume.after-kill-in-explore: a crash during the second spawn leaves one result per lens, one apply turn and one finish", async () => {
  const result = await crashAndResume({ spawnCall: 2 });
  const spawnIds = result.spawnsCompleted.map((requestId) =>
    requestId.split(":").slice(2).join(":"),
  );
  expect(spawnIds.toSorted((a, b) => a.localeCompare(b))).toEqual([
    "spawn:1:analogy",
    "spawn:1:first-principles",
    "spawn:1:prior-art",
  ]);
  const applyTurns = result.loop.turns.filter((request) =>
    request.requestId.includes(":turn:apply:"),
  );
  expect(applyTurns).toHaveLength(1);
  const finished = result.records.filter((event) => event.kind === "grp.helm.inquiry.finished");
  expect(finished).toHaveLength(1);
  expect(result.world.fakes.tasks.created).toHaveLength(2);
});
