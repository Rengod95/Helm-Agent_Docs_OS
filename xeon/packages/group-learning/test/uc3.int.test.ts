import { expect, test } from "bun:test";
import { driveStandIn } from "./support/drive-group.ts";
import { NEW_SKILL, queueApi, submit, type Review } from "./support/flow.ts";
import { createRig } from "./support/rig.ts";

// M3a 종료 조건 X2(product.scope.spec 4.4, UC-3). 임계 도달 → 백그라운드 검토 포크 → 스킬·피드백 후보 → 승인 전 파일 불변 → 승인은 L2를 거쳐 적용.
// Helm 대역이 drive 임대를 쥔 채로 전부 일어난다.

test("uc3.threshold-review-queue-and-helm-coexist", async () => {
  const rig = await createRig({ settings: { "l3.learning.trigger.userTurns": 3 } });
  const helm = driveStandIn("helm-stand-in");
  await rig.t.host.install(helm.unit);
  await rig.t.host.openThread(rig.thread);
  await Bun.sleep(20);
  rig.control.waitSettled = false;
  expect(rig.t.host.leaseOf(rig.thread)?.scopeId).toBe("helm-stand-in");

  // (1) 임계 직전까지는 포크가 없다
  const filesBefore = rig.knowledge.snapshot();
  await rig.turn();
  await rig.turn();
  expect(rig.agents.delegated).toHaveLength(0);
  // 임계를 넘는 turn에서 포크가 백그라운드로 한 번 시작된다
  await rig.turn({ toolSteps: 2 });
  expect(rig.agents.delegated).toHaveLength(1);
  const delegation = rig.agents.delegated[0];
  if (delegation === undefined) throw new Error("the review did not start");
  expect(delegation.request).toMatchObject({
    agent: "learning-review",
    requestId: "learning:review:1",
    fork: { at: "item" },
  });
  expect("report" in delegation.request).toBe(false);
  const review: Review = {
    rig,
    requestId: delegation.request.requestId,
    childThreadId: delegation.childThreadId,
  };

  // (2) 임대는 Helm 대역이 그대로 쥐고, 학습 그룹은 drive를 부르지 않았다
  expect(rig.t.host.leaseOf(rig.thread)?.scopeId).toBe("helm-stand-in");
  expect(rig.module.manifest.usesDrive).toBe(false);

  // 검토 포크가 스킬 후보와 피드백 후보를 제출한다
  expect(await submit(review, NEW_SKILL)).toMatchObject({ ok: true, status: "pending" });
  expect(
    await submit(review, {
      kind: "feedback",
      op: "add",
      target: "user/work-style",
      body: "Ask before deleting files, because the user lost a draft once.",
      rationale: "The user was upset after an unrequested deletion.",
      evidenceEventIds: ["evt_00000000000000000000000009"],
    }),
  ).toMatchObject({ ok: true, status: "pending" });
  await rig.settle(review.requestId, "completed");

  // 후보가 대기열에 있고 승인 전에는 스킬 디렉터리와 메모리 파일이 그대로다
  const listed = await queueApi(rig).list({});
  const rows = listed.ok ? listed.value : [];
  expect(
    rows
      .map((row) => [row.kind, row.status, row.source])
      .toSorted((a, b) => a.join().localeCompare(b.join())),
  ).toEqual([
    ["feedback", "pending", "learning"],
    ["skill", "pending", "learning"],
  ]);
  expect(rig.knowledge.snapshot()).toBe(filesBefore);
  expect(rig.knowledge.writes).toEqual([]);

  // (4) 검토 결과는 부모 대화의 모델 입력에 들어가지 않는다: 보고 post도, 입력 큐 항목도 없다
  expect(rig.t.queue.items).toEqual([]);
  expect(rig.t.records.events(rig.thread).some((event) => event.kind === "input.queued")).toBe(
    false,
  );
  expect(rig.payloads("grp.learning.review.finished")[0]).toMatchObject({
    outcome: "completed",
    proposalCount: 2,
  });
  // 대기열 알림(배지)용 공개 레코드
  expect(rig.payloads("grp.learning.skill.proposed")).toHaveLength(1);
  expect(rig.payloads("grp.learning.feedback.proposed")).toHaveLength(1);

  // (3) 승인한 뒤에만 L2 쓰기 API가 불린다
  const skill = rows.find((row) => row.kind === "skill");
  const decided = await queueApi(rig).decide(
    { kind: "approve", proposalId: skill?.id ?? "", revision: skill?.revision ?? 0 },
    new AbortController().signal,
  );
  expect(decided).toMatchObject({ ok: true, applied: true, proposal: { status: "applied" } });
  expect(rig.knowledge.writes.map((write) => [write.method, write.approvalSource])).toEqual([
    ["create", "learning.queue"],
  ]);
  expect(rig.knowledge.skills.has("release-notes")).toBe(true);
  // 승인하지 않은 피드백은 메모리에 들어가지 않았다
  expect(rig.knowledge.memory.user).toEqual([]);
  // 승인한 뒤에도 임대는 그대로다
  expect(rig.t.host.leaseOf(rig.thread)?.scopeId).toBe("helm-stand-in");

  helm.release();
  rig.control.waitSettled = true;
  await rig.t.settled();
});

test("uc3.review-works-on-the-second-threshold-after-the-first-finished", async () => {
  const rig = await createRig({ settings: { "l3.learning.trigger.userTurns": 2 } });
  await rig.turn();
  await rig.turn();
  expect(rig.agents.delegated).toHaveLength(1);
  await rig.settle("learning:review:1", "completed");
  await rig.turn();
  await rig.turn();
  expect(rig.agents.delegated).toHaveLength(2);
  expect(rig.agents.delegated.map((delegation) => delegation.request.requestId)).toEqual([
    "learning:review:1",
    "learning:review:2",
  ]);
});
