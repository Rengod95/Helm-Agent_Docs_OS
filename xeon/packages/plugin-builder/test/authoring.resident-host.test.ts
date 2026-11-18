import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { DriveStepInput, StepResult } from "@fresnel/contracts/extensions";
import type { DevkitService, SourceFacts } from "@fresnel/contracts/services";
import { authoringDrive, type DriveApi } from "../src/group-drive.ts";
import type { AuthoringState } from "../src/group-state.ts";
import { createGroupRig, devkitProbe } from "./group-support.ts";

// 상주 모드는 모델이 넘기는 값이 아니라 호스트가 정한다(M5c §4.8.6, `docs/xeon/L3/authoring/spec.md` 상주 모드 [제안]). 테스트 대화(craft 표지)이면 `authoring_start`의
// `resident`를 빼거나 거짓으로 넘겨도 상주다. 일반 대화는 넘긴 값을 그대로 쓴다. 호스트 판정은 `devkit.isCraftChat`이 준다.

const SOURCE: SourceFacts = {
  dir: "/config/plugins/demo",
  bundled: false,
  differsFromReviewed: true,
};

/** 호스트가 준 판정을 시험 중에 바꿀 수 있게 가변 값을 든다. `null`이면 판정 항목이 없는 빌드다 */
function craftDevkit(
  verdict: { readonly kind: "ok"; readonly craft: boolean } | { readonly kind: "err" } | null,
): { readonly devkit: DevkitService; readonly lookups: string[] } {
  const base = devkitProbe();
  const lookups: string[] = [];
  const devkit: DevkitService = {
    ...base.devkit,
    sourceOf: () => Promise.resolve(ok(SOURCE)),
    ...(verdict === null
      ? {}
      : {
          isCraftChat: (threadId: string) => {
            lookups.push(threadId);
            return Promise.resolve(
              verdict.kind === "ok"
                ? ok(verdict.craft)
                : err({ kind: "io", message: "the thread could not be read" }),
            );
          },
        }),
  };
  return { devkit, lookups };
}

test("resident.craft-a: in a craft chat the builder is resident even when the model passes resident false", async () => {
  const { devkit, lookups } = craftDevkit({ kind: "ok", craft: true });
  const rig = await createGroupRig({ devkit });
  await rig.call("authoring_start", { name: "demo", resident: false });
  expect(rig.state()).toMatchObject({ resident: true, sessionId: "auth-demo" });
  // 판정은 이 대화에 대해 물었다
  expect(lookups).toEqual([rig.thread]);
});

test("resident.craft-b: in a craft chat the builder is resident when the model passes no resident at all", async () => {
  const { devkit } = craftDevkit({ kind: "ok", craft: true });
  const rig = await createGroupRig({ devkit });
  await rig.call("authoring_start", { name: "demo" });
  expect(rig.state()).toMatchObject({ resident: true });
});

test("resident.craft-c: a resident craft chat yields after a submit, even though the model passed resident false", async () => {
  const { devkit } = craftDevkit({ kind: "ok", craft: true });
  const rig = await createGroupRig({ devkit });
  await rig.call("authoring_start", { name: "demo", resident: false });
  const started = rig.state();
  // 검토함으로 보낸 뒤의 상태: 비상주라면 `done`으로 물러났을 자리다
  const submitted: AuthoringState = {
    ...started,
    phase: "package",
    submitted: { draftId: "draft_demo", itemId: "rvw_demo" },
  };
  const { step } = drive();
  const result = await step(stepInput(submitted));
  expect(result).toEqual({ do: "yield" });
});

test("resident.plain-a: an ordinary thread keeps the model's resident argument: false stays false", async () => {
  const { devkit } = craftDevkit({ kind: "ok", craft: false });
  const rig = await createGroupRig({ devkit });
  await rig.call("authoring_start", { name: "demo", resident: false });
  expect(rig.state()).toMatchObject({ resident: false });
});

test("resident.plain-b: an ordinary thread keeps the model's resident argument: true stays true", async () => {
  const { devkit } = craftDevkit({ kind: "ok", craft: false });
  const rig = await createGroupRig({ devkit });
  await rig.call("authoring_start", { name: "demo", resident: true });
  expect(rig.state()).toMatchObject({ resident: true });
});

test("resident.plain-c: an ordinary non-resident session submitted steps aside (done), as before", async () => {
  const { devkit } = craftDevkit({ kind: "ok", craft: false });
  const rig = await createGroupRig({ devkit });
  await rig.call("authoring_start", { name: "demo" });
  const submitted: AuthoringState = {
    ...rig.state(),
    phase: "package",
    submitted: { draftId: "draft_demo", itemId: "rvw_demo" },
  };
  const { step } = drive();
  expect(await step(stepInput(submitted))).toEqual({ do: "done" });
});

test("resident.fallback-a: a build without the craft lookup leaves the model's argument in charge", async () => {
  const { devkit } = craftDevkit(null);
  const rig = await createGroupRig({ devkit });
  await rig.call("authoring_start", { name: "demo", resident: true });
  expect(rig.state()).toMatchObject({ resident: true });
});

test("resident.fallback-b: when the craft lookup cannot read the thread, the model's argument decides", async () => {
  const { devkit } = craftDevkit({ kind: "err" });
  const rig = await createGroupRig({ devkit });
  await rig.call("authoring_start", { name: "demo", resident: false });
  expect(rig.state()).toMatchObject({ resident: false });
});

// ── 도움 ─────────────────────────────────────────────────────────────

/** 주도 단계 함수. 게시는 이 시험이 보지 않으므로 받기만 한다 */
function drive(): { readonly step: ReturnType<typeof authoringDrive> } {
  const api: DriveApi = { post: () => Promise.resolve({}) };
  return { step: authoringDrive(api, devkitProbe().devkit) };
}

function stepInput(
  state: AuthoringState,
  last: StepResult | null = null,
): DriveStepInput<AuthoringState> {
  return {
    state,
    last,
    budget: { turns: null, spawns: null, tokens: null },
    frame: { frameDepth: 1, calledBy: null, input: null },
  };
}
