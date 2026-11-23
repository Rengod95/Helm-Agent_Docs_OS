import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type {
  DriveCommand,
  DriveStepInput,
  PostItem,
  StepResult,
} from "@fresnel/contracts/extensions";
import type { DevkitService, ValidationReport } from "@fresnel/contracts/services";
import { authoringDrive, type DriveApi } from "../src/group-drive.ts";
import { INITIAL_AUTHORING_STATE, type AuthoringState } from "../src/group-state.ts";
import { packConfirmation } from "../src/confirm.ts";

// 주도 단계 함수(group-drive.ts)를 직접 부른다. 엔진 없이 명령이 무엇인지만 본다: 상태와 직전 결과가 같으면 같은 명령이다(재시작 안전).

const DIR = "/work/demo";
const OK_REPORT: ValidationReport = { ok: true, issues: [] };

interface Post {
  readonly item: PostItem;
  readonly when: string;
  readonly requestId: string;
}

function drive(): {
  readonly step: ReturnType<typeof authoringDrive>;
  readonly posts: Post[];
  readonly calls: string[];
} {
  const posts: Post[] = [];
  const calls: string[] = [];
  const api: DriveApi = {
    post: (item, options) => {
      posts.push({ item, when: options.when, requestId: options.requestId });
      return Promise.resolve({});
    },
  };
  const devkit: DevkitService = {
    kinds: () => Promise.resolve([]),
    scaffold: (input) => {
      calls.push(`scaffold:${input.dir}`);
      return Promise.resolve(ok({ dir: input.dir, files: [] }));
    },
    validate: (dir) => {
      calls.push(`validate:${dir}`);
      return Promise.resolve(ok(OK_REPORT));
    },
    validateComposition: () => OK_REPORT,
    testRun: (input) => {
      calls.push(`testRun:${input.dir}`);
      return Promise.resolve(ok({ threadId: "thr_trial" }));
    },
    replay: () => Promise.resolve(err({ kind: "dev_mode_required", message: "not in dev" })),
    pack: (input) => {
      calls.push(`pack:${input.dir}`);
      return Promise.resolve(
        ok({ path: `${input.dir}/dist/package`, files: ["a"], sha256: "a".repeat(64) }),
      );
    },
    submit: (input) => {
      calls.push(`submit:${input.dir}`);
      return Promise.resolve(ok({ draftId: "draft_demo", itemId: "rvw_demo" }));
    },
  };
  return { step: authoringDrive(api, devkit), posts, calls };
}

function stepInput(
  state: AuthoringState,
  last: StepResult | null = null,
  frame: DriveStepInput<AuthoringState>["frame"] = { frameDepth: 1, calledBy: null, input: null },
): DriveStepInput<AuthoringState> {
  return {
    state,
    last,
    budget: { turns: null, spawns: null, tokens: null },
    frame,
  };
}

/** 맡겨진 첫 단계의 문맥: `helm`이 `handoff`로 목적과 요청 id를 실었다 */
const HANDED = {
  frameDepth: 2,
  calledBy: "helm",
  input: { purpose: "로그 정리 도구", id: "nabcdefghijklm" },
} as const;

const SESSION: AuthoringState = {
  ...INITIAL_AUTHORING_STATE,
  phase: "compose",
  sessionId: "auth-demo",
  kind: "single-plugin",
  name: "demo",
  dir: DIR,
  intentConfirmed: true,
};

const INTENT: AuthoringState = {
  ...INITIAL_AUTHORING_STATE,
  phase: "intent",
  sessionId: "auth-demo",
  kind: "single-plugin",
  name: "demo",
  dir: DIR,
};

function answered(selected: "yes" | "no"): StepResult {
  return { kind: "ask", answer: "answered", value: { confirm: { selected: [selected] } } };
}

const USER: PostItem = { kind: "user", content: "계속" };

test("authoring.drive.a: a closed session with nothing pending is done, so the builder steps aside", async () => {
  const { step } = drive();
  expect(await step(stepInput(INITIAL_AUTHORING_STATE))).toEqual({ do: "done" });
});

test("authoring.drive.b: an open session with nothing to do yields and stays resident across calls", async () => {
  const { step } = drive();
  const unrelated: StepResult = { kind: "refused", code: "command_unavailable" };
  expect(await step(stepInput(SESSION))).toEqual({ do: "yield" });
  expect(await step(stepInput(SESSION, unrelated))).toEqual({ do: "yield" });
  expect(await step(stepInput(SESSION, unrelated))).toEqual({ do: "yield" });
});

test("authoring.drive.c: a user message is a turn with that message as input, open session or not", async () => {
  const { step } = drive();
  const message: StepResult = { kind: "user", message: USER, requestId: "msg-1" };
  expect(await step(stepInput(SESSION, message))).toEqual({ do: "turn", input: USER });
  expect(await step(stepInput(INITIAL_AUTHORING_STATE, message))).toEqual({
    do: "turn",
    input: USER,
  });
});

test("authoring.drive.d: the intent confirmation is an ask command, and the answer decides the commit", async () => {
  const { step, posts } = drive();
  const asked = await step(stepInput(INTENT));
  expect(asked).toEqual({
    do: "ask",
    card: {
      questions: [
        {
          id: "confirm",
          text: '플러그인 "demo"을 /work/demo에 만들까요?',
          options: [
            { id: "yes", label: "예", recommended: true },
            { id: "no", label: "아니요" },
          ],
          multiSelect: false,
          allowFreeText: false,
        },
      ],
    },
    requestId: "authoring:intent:demo:0",
  });
  expect(posts).toEqual([]);

  const yes = await step(stepInput(INTENT, answered("yes")));
  expect(yes).toEqual({
    do: "commit",
    state: { ...INTENT, phase: "compose", intentConfirmed: true },
    next: { do: "yield" },
  });
  expect(posts.map((post) => [post.when, post.requestId])).toEqual([
    ["followUp", "authoring:intent:demo:0:r"],
  ]);

  const no = await step(stepInput(INTENT, answered("no")));
  expect(no).toEqual({
    do: "commit",
    state: INITIAL_AUTHORING_STATE,
    next: { do: "done" },
  });
  // 사람이 거부한 경우도 "아니요"와 같다
  const denied = await step(stepInput(INTENT, { kind: "denied", by: "human", reason: null }));
  expect(denied).toEqual(no);
});

test("authoring.drive.e: the same state and the same last give the same command (restart safe)", async () => {
  const { step } = drive();
  const first: DriveCommand<AuthoringState> = await step(stepInput(INTENT, answered("yes")));
  expect(await step(stepInput(INTENT, answered("yes")))).toEqual(first);
  const asked = await step(stepInput(INTENT));
  expect(await step(stepInput(INTENT))).toEqual(asked);
  const packing: AuthoringState = {
    ...SESSION,
    phase: "validate",
    pending: "package",
    askRound: 1,
  };
  const packAsk = await step(stepInput(packing));
  expect(await step(stepInput(packing))).toEqual(packAsk);
});

test("authoring.drive.f: nothing is packed without a yes, and the packing ask carries the release request id; the drive never submits", async () => {
  const packing: AuthoringState = {
    ...SESSION,
    phase: "validate",
    pending: "package",
    askRound: 1,
  };
  const pack = drive();
  expect(await pack.step(stepInput(packing))).toEqual({
    do: "ask",
    card: packConfirmation(DIR, 1).card,
    requestId: packConfirmation(DIR, 1).requestId,
  });
  const declined = await pack.step(stepInput(packing, answered("no")));
  expect(declined).toMatchObject({
    do: "commit",
    state: { pending: null, denied: "package", packaged: null },
  });
  expect(pack.calls).toEqual([]);
  const accepted = await pack.step(stepInput(packing, answered("yes")));
  expect(accepted).toMatchObject({
    do: "commit",
    state: {
      pending: null,
      phase: "package",
      packaged: { path: `${DIR}/dist/package`, sha256: "a".repeat(64), files: 1 },
    },
    next: { do: "yield" },
  });
  expect(pack.calls).toEqual([`pack:${DIR}`]);

  // 검토함으로 보내는 일(`authoring_submit`)은 도구가 한다. drive는 묶은 뒤 아무 것도 더 하지 않고 상주하며, 제출을 부르지 않는다
  const packaged: AuthoringState = {
    ...SESSION,
    phase: "package",
    pending: null,
    packaged: { path: `${DIR}/dist/package`, sha256: "a".repeat(64), files: 1 },
  };
  const after = drive();
  expect(await after.step(stepInput(packaged))).toEqual({ do: "yield" });
  expect(after.calls).toEqual([]);
});

test("authoring.drive.g: a trial starts only after a yes and the fix limit keeps going only after a yes", async () => {
  const trial: AuthoringState = { ...SESSION, phase: "trial", pending: "trial" };
  const run = drive();
  expect(await run.step(stepInput(trial, answered("no")))).toMatchObject({
    do: "commit",
    state: { pending: null, denied: "trial" },
  });
  expect(run.calls).toEqual([]);
  expect(await run.step(stepInput(trial, answered("yes")))).toMatchObject({
    do: "commit",
    state: { pending: null, trial: { threadId: "thr_trial" } },
  });
  expect(run.calls).toEqual([`testRun:${DIR}`]);

  const limited: AuthoringState = {
    ...SESSION,
    phase: "fix",
    pending: "fix_limit",
    sameErrorRuns: 3,
  };
  const fix = drive();
  expect(await fix.step(stepInput(limited, answered("yes")))).toEqual({
    do: "commit",
    state: { ...limited, pending: null, sameErrorRuns: 0 },
    next: { do: "yield" },
  });
  expect(await fix.step(stepInput(limited, answered("no")))).toEqual({
    do: "commit",
    state: { ...limited, pending: null, phase: "done" },
    next: { do: "done" },
  });
});

test("authoring.drive.handoff-a: a closed session handed a purpose opens a purpose-only session, notices it once and answers accepted at once", async () => {
  const run = drive();
  expect(await run.step(stepInput(INITIAL_AUTHORING_STATE, null, HANDED))).toEqual({
    do: "commit",
    state: {
      ...INITIAL_AUTHORING_STATE,
      phase: "intent",
      sessionId: "auth-handoff-nabcdefghijklm",
      purpose: "로그 정리 도구",
    },
    next: { do: "done", result: { accepted: true, purpose: "로그 정리 도구" } },
  });
  expect(run.posts).toEqual([
    {
      item: {
        kind: "context",
        customType: "grp.authoring.notice.status",
        content: "[authoring] helm가 플러그인 제작을 맡겼다: 로그 정리 도구",
        display: true,
      },
      when: "followUp",
      requestId: "authoring:handoff:nabcdefghijklm",
    },
  ]);
  // 같은 단계가 재시작 뒤 다시 와도 같은 알림 id가 나온다(중복 없음은 요청 id가 정한다)
  const again = drive();
  await again.step(stepInput(INITIAL_AUTHORING_STATE, null, HANDED));
  expect(again.posts.map((post) => post.requestId)).toEqual(
    run.posts.map((post) => post.requestId),
  );
});

test("authoring.drive.handoff-b: an open session declines the handoff without a notice and without residing", async () => {
  const run = drive();
  expect(await run.step(stepInput(SESSION, null, HANDED))).toEqual({
    do: "done",
    result: { accepted: false, reason: "session_open" },
  });
  expect(run.posts).toEqual([]);
});

test("authoring.drive.handoff-c: a handoff without a readable purpose is declined as bad_input", async () => {
  const run = drive();
  const frame = { frameDepth: 2, calledBy: "helm", input: { purpose: 3 } } as const;
  expect(await run.step(stepInput(INITIAL_AUTHORING_STATE, null, frame))).toEqual({
    do: "done",
    result: { accepted: false, reason: "bad_input" },
  });
  // 재시작 뒤 맡은 프레임은 입력이 없다(기록에 없다): 같은 사유로 물러난다
  expect(
    await run.step(stepInput(INITIAL_AUTHORING_STATE, null, { ...HANDED, input: null })),
  ).toEqual({
    do: "done",
    result: { accepted: false, reason: "bad_input" },
  });
  expect(run.posts).toEqual([]);
});

test("authoring.drive.handoff-d: a user-started frame (no calledBy) keeps the existing rules", async () => {
  const { step, posts } = drive();
  expect(await step(stepInput(SESSION))).toEqual({ do: "yield" });
  expect(await step(stepInput(INITIAL_AUTHORING_STATE))).toEqual({ do: "done" });
  expect(posts).toEqual([]);
});

test("authoring.drive.handoff-e: a purpose-only session has no name yet, so the step does not ask and steps aside", async () => {
  const { step } = drive();
  const purposeOnly: AuthoringState = {
    ...INITIAL_AUTHORING_STATE,
    phase: "intent",
    sessionId: "auth-handoff-nabcdefghijklm",
    purpose: "로그 정리 도구",
  };
  expect(await step(stepInput(purposeOnly))).toEqual({ do: "done" });
});

test("authoring.drive.resident-a: a resident session that submitted yields and keeps waiting for the next user message", async () => {
  const { step, calls } = drive();
  const submitted: AuthoringState = {
    ...SESSION,
    phase: "package",
    resident: true,
    submitted: { draftId: "draft_demo", itemId: "rvw_demo" },
  };
  expect(await step(stepInput(submitted))).toEqual({ do: "yield" });
  expect(calls).toEqual([]);
});

test("authoring.drive.resident-b: a user message after a submit in a resident session starts a fresh iteration of the same plugin", async () => {
  const { step } = drive();
  const submitted: AuthoringState = {
    ...SESSION,
    phase: "package",
    resident: true,
    trial: { threadId: "thr_trial" },
    packaged: { path: `${DIR}/dist/package`, sha256: "a".repeat(64), files: 1 },
    submitted: { draftId: "draft_demo", itemId: "rvw_demo" },
    lastErrorKey: null,
  };
  const message: StepResult = { kind: "user", message: USER, requestId: "msg-1" };
  expect(await step(stepInput(submitted, message))).toEqual({
    do: "commit",
    state: {
      ...submitted,
      phase: "compose",
      trial: null,
      packaged: null,
      submitted: null,
    },
    next: { do: "turn", input: USER },
  });
});

test("authoring.drive.resident-c: a non-resident session that submitted steps aside, and a user message still gets a turn", async () => {
  const { step } = drive();
  const submitted: AuthoringState = {
    ...SESSION,
    phase: "package",
    submitted: { draftId: "draft_demo", itemId: "rvw_demo" },
  };
  expect(await step(stepInput(submitted))).toEqual({ do: "done" });
  const message: StepResult = { kind: "user", message: USER, requestId: "msg-1" };
  expect(await step(stepInput(submitted, message))).toEqual({ do: "turn", input: USER });
});

test("authoring.drive.resident-d: a resident session that stops fixing stays open in the fix phase", async () => {
  const { step } = drive();
  const limited: AuthoringState = {
    ...SESSION,
    phase: "fix",
    pending: "fix_limit",
    sameErrorRuns: 3,
    resident: true,
  };
  expect(await step(stepInput(limited, answered("no")))).toEqual({
    do: "commit",
    state: { ...limited, pending: null, phase: "fix" },
    next: { do: "yield" },
  });
});
