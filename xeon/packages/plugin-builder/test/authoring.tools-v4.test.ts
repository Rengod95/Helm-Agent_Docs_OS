import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type {
  DevkitError,
  DevkitService,
  DraftSummary,
  ScaffoldInput,
  ScaffoldMode,
  SourceFacts,
} from "@fresnel/contracts/services";
import { createOrchestrationRig, devkitProbe, type OrchestrationRig } from "./group-support.ts";

// 빌더 도구의 v4 면(M5c §4.9.3, §4.9.2, §4.9.4, §4.9.6): 이름만으로 기존 플러그인 열기, 초안 목록, 세 방식의 제출 도달, 목적 한 문장,
// 상주 표지. 도구는 실제 호스트 위에서 부르고 devkit은 호출을 기록하는 대역이다(group-support.ts).

const DIR = "/work/demo";
const SOURCE_DIR = "/config/plugins/demo";
const EVIDENCE_TURN = "turn_1";

/** 한 번 확인된 세션을 검사 단계까지 맞춘다: 새 플러그인 시작, 종류·이름 확인 예 */
async function confirmedNewSession(
  rig: OrchestrationRig,
  extra: Record<string, string | boolean> = {},
) {
  const started = await rig.call("authoring_start", {
    kind: "single-plugin",
    name: "demo",
    dir: DIR,
    ...extra,
  });
  expect(started).toMatchObject({ ok: true, sessionId: "auth-demo" });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  await rig.answer("yes");
}

/** 검사를 지나 시험 대화의 턴을 증거로 제출하기 직전까지 간다 */
async function trialed(rig: OrchestrationRig): Promise<void> {
  await rig.call("authoring_validate", { sessionId: "auth-demo" });
  await rig.call("authoring_trial", { sessionId: "auth-demo" });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  await rig.answer("yes");
}

/** 기존 플러그인 원본 폴더를 여는 면. 원본이 검토본과 다르다고 알린다 */
const SOURCE: SourceFacts = { dir: SOURCE_DIR, bundled: false, differsFromReviewed: true };

test("authoring.fix.a: a name alone opens the source folder at once (no kind or name card), and the draft goes out as an update of it", async () => {
  const base = devkitProbe();
  const devkit: DevkitService = {
    ...base.devkit,
    sourceOf: (name) => {
      base.calls.push(`source:${name}`);
      return Promise.resolve(
        name === "demo" ? ok(SOURCE) : err({ kind: "not_found", message: "x" }),
      );
    },
  };
  const rig = await createOrchestrationRig({ devkit });
  const started = await rig.call("authoring_start", { name: "demo" });
  expect(started).toMatchObject({
    ok: true,
    sessionId: "auth-demo",
    source: { dir: SOURCE_DIR, bundled: false, differsFromReviewed: true },
  });
  expect(rig.state()).toMatchObject({
    phase: "validate",
    kind: "single-plugin",
    name: "demo",
    dir: SOURCE_DIR,
    intentConfirmed: true,
    fromSource: true,
  });
  // 원본에서 시작하므로 뼈대를 만들지 않는다: 뼈대 도구는 거절한다
  expect(await rig.call("authoring_scaffold", { sessionId: "auth-demo" })).toMatchObject({
    ok: false,
    error: { kind: "exists" },
  });
  await trialed(rig);
  await rig.call("authoring_submit", { sessionId: "auth-demo", turnId: EVIDENCE_TURN });
  expect(base.submits).toEqual([
    {
      dir: SOURCE_DIR,
      originThreadId: rig.thread,
      evidence: [{ kind: "turn", threadId: "thr_trial", turnId: EVIDENCE_TURN }],
    },
  ]);
  expect(base.calls).toContain("source:demo");
});

/** `sourceOf`가 거절하면 세션을 열지 않고 그 오류를 그대로 돌려준다 */
async function refusedStart(failure: DevkitError): Promise<void> {
  const base = devkitProbe();
  const devkit: DevkitService = {
    ...base.devkit,
    sourceOf: () => Promise.resolve(err(failure)),
  };
  const rig = await createOrchestrationRig({ devkit });
  expect(await rig.call("authoring_start", { name: "demo" })).toEqual({
    ok: false,
    error: { kind: failure.kind, message: failure.message },
  });
  expect(rig.state().sessionId).toBeNull();
}

test("authoring.fix.b1: a missing source folder is refused as not_found and opens no session", async () => {
  await refusedStart({ kind: "not_found", message: "demo has no source folder" });
});

test("authoring.fix.b2: a bundled plugin with no source folder is refused as bundled_not_editable and opens no session", async () => {
  await refusedStart({ kind: "bundled_not_editable", message: "demo is built in" });
});

test("authoring.fix.c: without a sourceOf in this build a name alone is refused, and a new plugin still needs kind and dir", async () => {
  const rig = await createOrchestrationRig();
  expect(await rig.call("authoring_start", { name: "demo" })).toMatchObject({
    ok: false,
    error: { kind: "source_unavailable" },
  });
  expect(rig.state().sessionId).toBeNull();
});

/** 한 방식의 뼈대가 새 플러그인 세션에서 scaffold(방식)로 만들어지고 제출 도구까지 닿는다 */
async function modeReachesSubmit(mode: ScaffoldMode): Promise<void> {
  const base = devkitProbe();
  const scaffolds: ScaffoldInput[] = [];
  const devkit: DevkitService = {
    ...base.devkit,
    scaffold: (input) => {
      scaffolds.push(input);
      return Promise.resolve(ok({ dir: input.dir, files: ["src/index.ts"] }));
    },
  };
  const rig = await createOrchestrationRig({ devkit });
  await confirmedNewSession(rig);
  expect(await rig.call("authoring_scaffold", { sessionId: "auth-demo", mode })).toMatchObject({
    ok: true,
  });
  await trialed(rig);
  await rig.call("authoring_submit", { sessionId: "auth-demo", turnId: EVIDENCE_TURN });
  expect(scaffolds.map((input) => input.mode)).toEqual([mode]);
  expect(base.submits.map((input) => input.dir)).toEqual([DIR]);
}

for (const mode of ["hook", "inject", "drive", "app", "native"] as const) {
  test(`authoring.modes.${mode}: the ${mode} mode reaches the submit tool, and the scaffold is asked for that mode`, async () => {
    await modeReachesSubmit(mode);
  });
}

test("authoring.modes.bad: a mode outside the three is refused by the schema and creates nothing", async () => {
  const base = devkitProbe();
  const scaffolds: ScaffoldInput[] = [];
  const devkit: DevkitService = {
    ...base.devkit,
    scaffold: (input) => {
      scaffolds.push(input);
      return Promise.resolve(ok({ dir: input.dir, files: [] }));
    },
  };
  const rig = await createOrchestrationRig({ devkit });
  await confirmedNewSession(rig);
  const refused = await rig.call("authoring_scaffold", {
    sessionId: "auth-demo",
    mode: "policy",
  });
  expect(refused).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
  expect(scaffolds).toEqual([]);
});

test("authoring.scaffold.text: scaffold gets the session purpose and the description input", async () => {
  const base = devkitProbe();
  const scaffolds: ScaffoldInput[] = [];
  const devkit: DevkitService = {
    ...base.devkit,
    scaffold: (input) => {
      scaffolds.push(input);
      return Promise.resolve(ok({ dir: input.dir, files: ["src/index.ts"] }));
    },
  };
  const rig = await createOrchestrationRig({ devkit });
  await confirmedNewSession(rig, { purpose: "로그를 정리한다" });
  expect(
    await rig.call("authoring_scaffold", {
      sessionId: "auth-demo",
      description: "Tidies the log folder.",
    }),
  ).toMatchObject({ ok: true });
  expect(scaffolds).toStrictEqual([
    {
      kind: "single-plugin",
      name: "demo",
      dir: DIR,
      purpose: "로그를 정리한다",
      description: "Tidies the log folder.",
    },
  ]);
});

test("authoring.scaffold.text.none: without a purpose or a description, scaffold gets neither key", async () => {
  const base = devkitProbe();
  const scaffolds: ScaffoldInput[] = [];
  const devkit: DevkitService = {
    ...base.devkit,
    scaffold: (input) => {
      scaffolds.push(input);
      return Promise.resolve(ok({ dir: input.dir, files: ["src/index.ts"] }));
    },
  };
  const rig = await createOrchestrationRig({ devkit });
  await confirmedNewSession(rig);
  expect(await rig.call("authoring_scaffold", { sessionId: "auth-demo" })).toMatchObject({
    ok: true,
  });
  expect(scaffolds).toStrictEqual([{ kind: "single-plugin", name: "demo", dir: DIR }]);
});

test("authoring.drafts.a: the drafts of a plugin come newest first with their parent, and the session's plugin is the default", async () => {
  const drafts: DraftSummary[] = [
    {
      draftId: "drf_2",
      parent: "drf_1",
      contentHash: `sha256:${"b".repeat(64)}`,
      createdAt: "2026-11-18T01:00:00.000Z",
      originThreadId: "thr_test",
      submittedItemId: "rvw_2",
    },
    {
      draftId: "drf_1",
      parent: null,
      contentHash: `sha256:${"a".repeat(64)}`,
      createdAt: "2026-11-18T00:00:00.000Z",
      originThreadId: null,
      submittedItemId: null,
    },
  ];
  const requested: string[] = [];
  const base = devkitProbe();
  const devkit: DevkitService = {
    ...base.devkit,
    sourceOf: () => Promise.resolve(ok(SOURCE)),
    draftList: (name) => {
      requested.push(name);
      return Promise.resolve(ok({ drafts: name === "demo" ? drafts : [] }));
    },
  };
  const rig = await createOrchestrationRig({ devkit });
  expect(await rig.call("authoring_drafts", {})).toEqual({
    ok: false,
    error: { kind: "no_name", message: expect.stringContaining("name") },
  });
  expect(await rig.call("authoring_drafts", { name: "demo" })).toEqual({
    ok: true,
    name: "demo",
    drafts: drafts.map((draft) => ({
      draftId: draft.draftId,
      parent: draft.parent,
      contentHash: draft.contentHash,
      createdAt: draft.createdAt,
      originThreadId: draft.originThreadId,
      submittedItemId: draft.submittedItemId,
    })),
  });
  await rig.call("authoring_start", { name: "demo" });
  expect(await rig.call("authoring_drafts", {})).toMatchObject({ ok: true, name: "demo" });
  expect(requested).toEqual(["demo", "demo"]);
});

test("authoring.drafts.b: without a draftList in this build the tool says so", async () => {
  const rig = await createOrchestrationRig();
  expect(await rig.call("authoring_drafts", { name: "demo" })).toMatchObject({
    ok: false,
    error: { kind: "drafts_unavailable" },
  });
});

test("authoring.purpose: the purpose given at start reaches the submit when the submit has none, and the submit's own purpose wins", async () => {
  const base = devkitProbe();
  const devkit: DevkitService = {
    ...base.devkit,
    sourceOf: () => Promise.resolve(ok(SOURCE)),
  };
  const rig = await createOrchestrationRig({ devkit });
  await rig.call("authoring_start", { name: "demo", purpose: "로그를 정리한다" });
  expect(rig.state()).toMatchObject({ purpose: "로그를 정리한다", resident: false });
  await trialed(rig);
  await rig.call("authoring_submit", { sessionId: "auth-demo", turnId: EVIDENCE_TURN });
  expect(base.submits.at(-1)?.purpose).toBe("로그를 정리한다");
  await rig.call("authoring_submit", {
    sessionId: "auth-demo",
    turnId: EVIDENCE_TURN,
    purpose: "기록을 지운다",
  });
  expect(base.submits.at(-1)?.purpose).toBe("기록을 지운다");
});

test("authoring.resident: the resident flag set at start is kept in the state, and a stop clears it", async () => {
  const base = devkitProbe();
  const devkit: DevkitService = {
    ...base.devkit,
    sourceOf: () => Promise.resolve(ok(SOURCE)),
  };
  const rig = await createOrchestrationRig({ devkit });
  await rig.call("authoring_start", { name: "demo", resident: true });
  expect(rig.state()).toMatchObject({ resident: true });
  await rig.call("authoring_stop", {});
  expect(rig.state()).toMatchObject({ resident: false, sessionId: null, purpose: null });
});

test("authoring.context.a: the context tool reads the references of the calling craft chat, with the evidence bundle of a finding", async () => {
  const seen: string[] = [];
  const base = devkitProbe();
  const devkit: DevkitService = {
    ...base.devkit,
    craftContext: (threadId) => {
      seen.push(threadId);
      return Promise.resolve(
        ok({
          threadId,
          refs: [
            { ref: { kind: "plugin", name: "demo" }, bundle: null },
            {
              ref: { kind: "finding", findingId: "fnd_1" },
              bundle: { findingId: "fnd_1", hash: "sha256:x", samples: 3 },
            },
          ],
        }),
      );
    },
  };
  const rig = await createOrchestrationRig({ devkit });
  expect(await rig.call("authoring_context", {})).toEqual({
    ok: true,
    threadId: rig.thread,
    refs: [
      { ref: { kind: "plugin", name: "demo" }, bundle: null },
      {
        ref: { kind: "finding", findingId: "fnd_1" },
        bundle: { findingId: "fnd_1", hash: "sha256:x", samples: 3 },
      },
    ],
  });
  expect(seen).toEqual([rig.thread]);
});

test("authoring.context.b: without a craftContext in this build the context tool says so", async () => {
  const rig = await createOrchestrationRig();
  expect(await rig.call("authoring_context", {})).toMatchObject({
    ok: false,
    error: { kind: "context_unavailable" },
  });
});
