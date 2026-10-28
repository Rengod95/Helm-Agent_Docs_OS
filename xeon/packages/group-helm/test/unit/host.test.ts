import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { WebSearch } from "@xeon/contracts/capabilities";
import { FIRST_DENY, validateManifest, validateUsage } from "@xeon/contracts/extensions";
import { capabilityDefTable } from "@xeon/ext-host";
import { helmManifest } from "../../src/index.ts";
import { HelmStateSchema, INITIAL_HELM_STATE, type HelmState } from "../../src/state.ts";
import { createRig, DEFS, type Rig } from "../support/rig.ts";

function statesOf(rig: Rig): readonly HelmState[] {
  return rig.t.records
    .events(rig.thread)
    .filter((event) => event.kind === "grp.helm.state.committed")
    .flatMap((event) => {
      const payload: unknown = event.payload;
      if (typeof payload !== "object" || payload === null || !("doc" in payload)) return [];
      const checked = parse(HelmStateSchema, payload.doc);
      return checked.ok ? [checked.value] : [];
    });
}

function noticeTexts(rig: Rig): readonly string[] {
  return rig.t.queue.items.flatMap((entry) => {
    const content = entry.item.content;
    return typeof content === "string" ? [content] : [];
  });
}

test("manifest.valid-and-usage-matches", async () => {
  expect(
    validateManifest(helmManifest).issues.filter((issue) => issue.severity === "error"),
  ).toEqual([]);
  expect(helmManifest.points).toHaveLength(6);
  expect(helmManifest.usesDrive).toBe(true);
  expect(helmManifest.usesPost).toBe(true);
  const rig = await createRig();
  const scope = rig.t.host.scopes().find((info) => info.id === "helm");
  expect(scope?.status).toBe("enabled");
  const usage = {
    on: [...helmManifest.points],
    post: true,
    drive: true,
    capabilities: [],
    recordKinds: helmManifest.recordKinds?.map((decl) => decl.kind) ?? [],
    readsRecordKinds: [],
  };
  expect(validateUsage(helmManifest, usage).filter((issue) => issue.severity === "error")).toEqual(
    [],
  );
  expect(rig.t.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toEqual([]);
});

test("commands.start-stop-status", async () => {
  const rig = await createRig();
  await rig.command("start 캐시 무효화");
  await rig.settle("k1");
  expect(statesOf(rig).at(-1)?.pending).toMatchObject({ topic: "캐시 무효화", source: "command" });
  const commits = statesOf(rig).length;
  // 탐구 중(대기 포함) start는 오류이고 상태를 바꾸지 않는다
  await rig.command("start 다른 주제");
  await rig.command("status");
  await rig.settle("k2");
  expect(statesOf(rig)).toHaveLength(commits);
  const texts = noticeTexts(rig);
  expect(texts.some((text) => text.includes("이미 탐구 중"))).toBe(true);
  expect(texts.some((text) => text.includes("임대: waiting") && text.includes("캐시 무효화"))).toBe(
    true,
  );
  // stop은 대기 중인 요청을 지운다
  await rig.command("stop");
  await rig.settle("k3");
  expect(statesOf(rig).at(-1)?.pending).toBeNull();
  // 잘못된 하위 명령은 사용법을 알린다
  await rig.command("explode");
  await rig.settle("k4");
  expect(noticeTexts(rig).some((text) => text.includes("사용법"))).toBe(true);
});

test("commands: stop during an inquiry sets stopRequested and the next drive ends it stopped", async () => {
  const holder: { rig?: Rig } = {};
  const rig = await createRig({
    onTurn: (request) => {
      if (request.requestId.includes(":turn:diverge:")) void holder.rig?.command("stop");
    },
  });
  holder.rig = rig;
  await rig.command("start 캐시 무효화");
  await rig.settle("s");
  await rig.drain(2);
  // 명령은 다음 on 지점에서 이어받는다
  await rig.settle("s2");
  await rig.drain();
  const finished = rig.records("grp.helm.inquiry.finished");
  expect(finished).toHaveLength(1);
  expect(finished[0]).toMatchObject({ outcome: "stopped" });
  expect(rig.t.loop.turns).toHaveLength(1);
});

test("guard.exception-becomes-deny", async () => {
  let armed = false;
  const values = {
    get "l3.helm.writeGuard"(): boolean {
      if (armed) throw new Error("settings unavailable");
      return true;
    },
  };
  const rig = await createRig({ settings: values });
  armed = true;
  const outcome = await rig.t.host.dispatch(
    "tool.call.before",
    { toolCallId: "call_1", toolName: "bash", input: {}, risk: "exec" },
    { threadId: rig.thread, dispatchKey: "k" },
  );
  expect(outcome.decision).toEqual(FIRST_DENY["tool.call.before"]);
  expect(outcome.substituted).toBe(true);
});

test("effects.no-capability-in-on-handlers", async () => {
  const rig = await createRig();
  const dispatched = [
    await rig.t.host.dispatch(
      "input.agent.before",
      { prompt: "`LRU` 캐시", systemPrompt: "s", systemPromptOptions: {} },
      {
        threadId: rig.thread,
        dispatchKey: "a",
        initial: { messages: [], systemPrompt: "s" },
      },
    ),
    await rig.t.host.dispatch(
      "tool.execution.after",
      { toolCallId: "c1", toolName: "bash", input: {}, result: "ok", isError: false },
      { threadId: rig.thread, dispatchKey: "b" },
    ),
    await rig.t.host.dispatch(
      "boundary.settle.after",
      { turnId: rig.t.ids.next("trn"), aborted: false },
      { threadId: rig.thread, dispatchKey: "c" },
    ),
  ];
  expect(dispatched).toHaveLength(3);
  expect(
    rig.fakes.web.calls +
      rig.fakes.knowledge.calls +
      rig.fakes.memory.calls +
      rig.fakes.tasks.calls,
  ).toBe(0);
});

test("knowledge.undeclared-method-degrades: a provider method without readOnly is refused by the X wrapper", async () => {
  const { readOnly: _declared, ...search } = WebSearch.service.methods.search;
  const undeclared = { ...WebSearch, service: { ...WebSearch.service, methods: { search } } };
  const defs = capabilityDefTable([undeclared]);
  const rig = await createRig({ host: { capabilityDefs: (id) => defs(id) ?? DEFS(id) } });
  await rig.runInquiry("캐시 무효화");
  expect(rig.fakes.web.calls).toBe(0);
  expect(rig.records("grp.helm.inquiry.finished")[0]).toMatchObject({ outcome: "applied" });
});

for (const [name, options] of [
  ["no provider", { without: ["web" as const] }],
  ["an unavailable provider", { webError: "unavailable" }],
] as const) {
  test(`knowledge.degrades-when-web-missing: ${name} still ends applied`, async () => {
    const rig = await createRig(options);
    await rig.runInquiry("캐시 무효화");
    expect(rig.records("grp.helm.inquiry.finished")[0]).toMatchObject({ outcome: "applied" });
    expect(rig.t.loop.turns).toHaveLength(2);
  });
}

test("a missing work capability skips the task links but keeps the discoveries", async () => {
  const rig = await createRig({ without: ["work"] });
  await rig.runInquiry("캐시 무효화");
  expect(rig.records("grp.helm.inquiry.finished")[0]).toMatchObject({ outcome: "applied" });
  expect(rig.records("grp.helm.discovery.recorded")).toHaveLength(3);
  expect(rig.fakes.tasks.created).toEqual([]);
});

test("restore.invalid-state-resets: session.start with an inconsistent state commits the initial state and a failed finish", async () => {
  const rig = await createRig();
  await rig.t.records.commit({
    threadId: rig.thread,
    requestId: "inconsistent",
    drafts: [
      {
        id: rig.t.ids.next("evt"),
        threadId: rig.thread,
        kind: "grp.helm.state.committed",
        version: 1,
        turnId: null,
        stepId: null,
        causationId: null,
        correlationId: null,
        durable: true,
        payload: {
          scopeId: "helm",
          rev: 99,
          prevEventId: null,
          version: 1,
          doc: { ...INITIAL_HELM_STATE, phase: "explore" },
        },
      },
    ],
  });
  await rig.t.host.closeThread(rig.thread);
  await rig.t.host.openThread(rig.thread);
  await rig.t.host.dispatch(
    "session.start",
    { reason: "resume", threadId: rig.thread },
    { threadId: rig.thread, dispatchKey: "ss" },
  );
  await rig.t.settled();
  expect(rig.records("grp.helm.inquiry.finished")).toEqual([
    expect.objectContaining({
      outcome: "failed",
      reason: expect.stringContaining("state inconsistent"),
    }),
  ]);
  expect(statesOf(rig).at(-1)).toEqual(INITIAL_HELM_STATE);
});

test("failures.missing-inquiry-finishes-failed: the drive of an explore state without an inquiry id finishes failed", async () => {
  const rig = await createRig();
  await rig.t.records.commit({
    threadId: rig.thread,
    requestId: "inconsistent-2",
    drafts: [
      {
        id: rig.t.ids.next("evt"),
        threadId: rig.thread,
        kind: "grp.helm.state.committed",
        version: 1,
        turnId: null,
        stepId: null,
        causationId: null,
        correlationId: null,
        durable: true,
        payload: {
          scopeId: "helm",
          rev: 99,
          prevEventId: null,
          version: 1,
          doc: { ...INITIAL_HELM_STATE, phase: "explore" },
        },
      },
    ],
  });
  await rig.t.host.closeThread(rig.thread);
  await rig.t.host.openThread(rig.thread);
  await rig.t.settled();
  await rig.drain(4);
  expect(rig.records("grp.helm.inquiry.finished")[0]).toMatchObject({ outcome: "failed" });
  expect(statesOf(rig).at(-1)).toEqual(INITIAL_HELM_STATE);
  expect(rig.t.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toEqual([]);
});
