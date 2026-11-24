// 앱 플러그인의 끝까지 흐름(AGE-78): 뼈대(`authoring_scaffold` mode `app`) → 검사(`authoring_validate`) → 테스트 대화(`authoring_trial`)
// → 검토 제출(`authoring_submit`). 뼈대와 검사는 실제 제작 코어(`scaffoldExtension`, `validateExtensionDir`)가 임시 폴더에 쓰고 읽는다.
// 테스트 대화(`ext.test.run`의 testRun 종류, 빌더에서는 `authoring_trial`)와 검토 제출은 호출을 기록하는 대역이다(`devkitProbe`).
// 흐름은 제출에서 끝난다. 설치나 승인 도구는 없고, 검사를 통과하지 않았거나 테스트 대화의 증거가 없으면 제출이 거절된다.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { toJsonValue } from "@fresnel/contracts/conversation";
import type { DevkitService } from "@fresnel/contracts/services";
import { isSkeletonFolder, scaffoldExtension, validateExtensionDir } from "@fresnel/core-authoring";
import { createOrchestrationRig, devkitProbe, type OrchestrationRig } from "./group-support.ts";
import { tempRoot, templateDirs } from "./support.ts";

const root = tempRoot();
const templates = templateDirs();
const EVIDENCE_TURN = "turn_1";
const SESSION = "auth-demo";
const DESCRIPTION = "Keeps a short list that the user and the agent can both add to.";

/** 실제 뼈대와 검사를 쓰는 제작 서비스. 테스트 대화와 제출은 `devkitProbe`의 기록 대역을 그대로 쓴다 */
function appDevkit(): {
  readonly devkit: DevkitService;
  readonly base: ReturnType<typeof devkitProbe>;
} {
  const base = devkitProbe();
  const devkit: DevkitService = {
    ...base.devkit,
    scaffold: (input) => scaffoldExtension(input, { templates }),
    validate: (dir) => validateExtensionDir(dir),
    isSkeletonOnly: (input) => isSkeletonFolder(input, { templates }),
  };
  return { devkit, base };
}

/** 새 플러그인 세션을 열고 종류와 이름 확인에 예라고 답한다 */
async function confirmedNewSession(rig: OrchestrationRig, dir: string): Promise<void> {
  // 목적과 설명은 필수다(AU-013, AGE-31). 목적은 세션에, 설명은 뼈대 도구에 넘긴다
  const started = await rig.call("authoring_start", {
    kind: "single-plugin",
    name: "demo",
    dir,
    purpose: "Keeps a short list.",
  });
  expect(started).toMatchObject({ ok: true, sessionId: SESSION });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  await rig.answer("yes");
}

/** 테스트 대화를 열고(사용자 확인 예), 그 대화가 열리면서 testRun이 한 번 불린다 */
async function openTestRun(rig: OrchestrationRig): Promise<void> {
  await rig.call("authoring_trial", { sessionId: SESSION });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  await rig.answer("yes");
}

test("app flow: scaffold(app) writes the app files, validate passes the app check, the test run and the review submit each give their values", async () => {
  const { devkit, base } = appDevkit();
  const rig = await createOrchestrationRig({ devkit });
  const dir = root.path("demo");
  await confirmedNewSession(rig, dir);

  // 1. 뼈대: 앱 방식의 파일 여섯 개가 생긴다(매니페스트, 엔진 코드, 화면 파일 넷, 경로 순)
  expect(
    await rig.call("authoring_scaffold", {
      sessionId: SESSION,
      mode: "app",
      description: DESCRIPTION,
    }),
  ).toEqual({
    ok: true,
    dir,
    files: [
      ".fresnel-plugin/plugin.json",
      "src/index.ts",
      "ui/app/app.js",
      "ui/app/bridge.js",
      "ui/app/index.html",
      "ui/app/theme.css",
    ],
  });

  // 2. 검사: 실제 앱 검사를 지난다. 뼈대 그대로의 경고 둘(대체 화면 없음, 까닭 글 그대로)만 남는다
  const direct = await validateExtensionDir(dir);
  if (!direct.ok) throw new Error(direct.error.message);
  expect(direct.value.ok).toBe(true);
  expect(direct.value.issues.map((issue) => [issue.severity, issue.code])).toEqual([
    ["warning", "AU-007"],
    ["warning", "app_reason_placeholder"],
  ]);
  expect(await rig.call("authoring_validate", { sessionId: SESSION })).toEqual({
    ok: true,
    report: toJsonValue(direct.value) ?? null,
  });

  // 3. 제출은 테스트 대화의 증거가 없으면 거절된다(검토를 건너뛰는 길이 없다)
  expect(
    await rig.call("authoring_submit", { sessionId: SESSION, turnId: EVIDENCE_TURN }),
  ).toMatchObject({ ok: false, error: { kind: "no_evidence" } });
  expect(base.submits).toEqual([]);

  // 4. 테스트 대화: 뼈대 그대로면 카드가 뜨지 않고 거절된다(U-05). 요청한 기능을 파일에 넣고 다시 검사한 뒤에 연다
  expect(await rig.call("authoring_trial", { sessionId: SESSION })).toMatchObject({
    ok: false,
    error: { kind: "skeleton_only" },
  });
  expect(base.calls.filter((call) => call.startsWith("testRun:"))).toEqual([]);
  const entry = join(dir, "src", "index.ts");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}// the requested feature\n`);
  expect(await rig.call("authoring_validate", { sessionId: SESSION })).toMatchObject({ ok: true });
  await openTestRun(rig);
  expect(base.calls.filter((call) => call.startsWith("testRun:"))).toEqual([`testRun:${dir}`]);

  // 5. 검토 제출: 증거는 테스트 대화의 턴 하나이고, 초안과 검토 항목이 돌아온다
  expect(await rig.call("authoring_submit", { sessionId: SESSION, turnId: EVIDENCE_TURN })).toEqual(
    {
      ok: true,
      notice: "리뷰 화면에서 승인해야 쓸 수 있다",
    },
  );
  expect(base.submits).toEqual([
    {
      dir,
      originThreadId: rig.thread,
      evidence: [{ kind: "turn", threadId: "thr_trial", turnId: EVIDENCE_TURN }],
      purpose: "Keeps a short list.",
    },
  ]);
  expect(rig.state()).toMatchObject({
    phase: "trial",
    dir,
    submitted: { draftId: "draft_demo", itemId: "rvw_demo" },
  });
});

test("app flow: a missing app entry fails the app check, and the test run and the submit are refused", async () => {
  const { devkit, base } = appDevkit();
  const rig = await createOrchestrationRig({ devkit });
  const dir = root.path("demo-broken");
  await confirmedNewSession(rig, dir);
  expect(
    await rig.call("authoring_scaffold", {
      sessionId: SESSION,
      mode: "app",
      description: DESCRIPTION,
    }),
  ).toMatchObject({
    ok: true,
  });
  rmSync(join(dir, "ui", "app", "index.html"));

  // 앱 검사는 화면 진입 파일이 없다는 오류를 낸다. 검사가 실패하면 테스트 대화도 제출도 열리지 않는다
  const direct = await validateExtensionDir(dir);
  if (!direct.ok) throw new Error(direct.error.message);
  expect(direct.value.ok).toBe(false);
  expect(
    direct.value.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => [issue.code, issue.path]),
  ).toEqual([["app_entry_missing", "/ui/items/0/app/entry"]]);
  expect(await rig.call("authoring_validate", { sessionId: SESSION })).toEqual({
    ok: false,
    report: toJsonValue(direct.value) ?? null,
  });
  expect(await rig.call("authoring_trial", { sessionId: SESSION })).toMatchObject({
    ok: false,
    error: { kind: "not_validated" },
  });
  expect(
    await rig.call("authoring_submit", { sessionId: SESSION, turnId: EVIDENCE_TURN }),
  ).toMatchObject({ ok: false, error: { kind: "not_validated" } });
  expect(base.submits).toEqual([]);
  expect(base.calls.filter((call) => call.startsWith("testRun:"))).toEqual([]);
});

test("app flow: scaffold again with another mode swaps the untouched skeleton, and an edited file is kept with a reason and a next step", async () => {
  const { devkit } = appDevkit();
  const rig = await createOrchestrationRig({ devkit });
  const dir = root.path("demo-swap");
  await confirmedNewSession(rig, dir);
  const hook = await rig.call("authoring_scaffold", {
    sessionId: SESSION,
    mode: "hook",
    description: DESCRIPTION,
  });
  expect(hook).toMatchObject({ ok: true });
  // 훅 뼈대를 만든 뒤 앱 뼈대로 바꾼다(S-05): 남은 뼈대 파일 때문에 거부하지 않는다
  const app = await rig.call("authoring_scaffold", {
    sessionId: SESSION,
    mode: "app",
    description: DESCRIPTION,
  });
  expect(app).toMatchObject({ ok: true });
  expect(existsSync(join(dir, "ui", "app", "index.html"))).toBe(true);
  // 사용자가 고친 파일은 덮지 않는다. 거부 글에 고친 파일과 다음 걸음이 있다
  writeFileSync(join(dir, "src", "index.ts"), "// edited by hand\n");
  const refused = await rig.call("authoring_scaffold", {
    sessionId: SESSION,
    mode: "hook",
    description: DESCRIPTION,
  });
  expect(refused).toMatchObject({ ok: false, error: { kind: "exists" } });
  expect(JSON.stringify(refused)).toContain("src/index.ts");
  expect(JSON.stringify(refused)).toContain("authoring_validate");
  expect(readFileSync(join(dir, "src", "index.ts"), "utf8")).toBe("// edited by hand\n");
});
