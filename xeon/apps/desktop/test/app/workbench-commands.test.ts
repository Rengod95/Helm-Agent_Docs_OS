import { describe, expect, test } from "bun:test";
import type {
  CompositionDecl,
  DriveFrameView,
  TraceTurnResult,
} from "@fresnel/contracts/extensions";
import {
  WIRE_ERRORS,
  type EventWire,
  type ExtHealthEntry,
  type ExtVersionsResult,
  type HookEntry,
  type HooksOrderGetResult,
  type HooksOrderPreviewResult,
  type HooksOrderResetResult,
  type HooksOrderSetResult,
  type VolatileEventWire,
  type Profile,
  type ProfilePutResult,
  type ProfileInput,
  type ProfileListResult,
  type ProfilePreviewResult,
  type ThreadSetProfileResult,
  type ExtValidateResult,
  type PluginDraftCreateResult,
} from "@fresnel/contracts/wire";
import {
  asksDisable,
  hasScopeChange,
  isExtSettingsChange,
  subscribeExtChanges,
  subscribeProfilesChanges,
} from "../../src/app/workbench-commands.ts";
import { fakeConnection } from "../state/fake-connection.ts";
import { evt, STORE, SUB, thr, trn } from "../state/helpers.ts";
import { engineFake, makeApp, tick, until } from "./support.ts";

// 크래프트 명령이 보내는 wire 메서드와 params(W-22 ext.health, W-36 hooks.list, W-51 hooks.order.*, W-43 trace.turn).
// 가짜 엔진 위에서 명령을 부르고, 보낸 메서드와 params, 돌아온 값을 값으로 본다.

type Extra = Parameters<typeof engineFake>[2];

async function liveApp(extra: Extra) {
  const engine = engineFake(undefined, undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
  return { app, ...engine };
}

/** `thread.open write`의 답: 이 연결이 쓰기 소유자가 됐다 */
const OPENED_WRITE = {
  threadId: thr(1),
  role: "owner",
  position: { storeId: STORE, seq: 8 },
} as const;

/** 메서드 이름으로 보낸 params를 보낸 순서대로 모은다 */
const paramsOf = (
  calls: readonly { readonly method: string; readonly params: unknown }[],
  method: string,
): unknown[] => calls.filter((call) => call.method === method).map((call) => call.params);

/** 보낸 메서드 이름 가운데 `names`에 든 것만 보낸 순서대로 모은다(두 호출의 순서를 본다) */
const orderOf = (methods: readonly string[], ...names: readonly string[]): string[] =>
  methods.filter((method) => names.includes(method));

const HASH = `sha256:${"a".repeat(64)}`;
const DRAFT: PluginDraftCreateResult = {
  draftId: "drf_1",
  contentHash: HASH,
  card: {
    name: "docs",
    displayName: "Docs",
    purpose: "문서를 읽는다",
    does: {
      inject: null,
      hook: {
        hooks: [
          { name: "tool.call.before", fold: "first", position: "before", powers: ["decide"] },
        ],
      },
      drive: null,
    },
    enforcement: "advisory",
    runs: { code: false, isolated: null },
    cost: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
    health: { state: "idle", lastActiveAt: null, lastError: null },
    origin: { kind: "user" },
    review: { state: "draft", currentHash: null, pendingItemId: null, approvedAt: null },
    usedBy: [],
  },
  info: {
    draftId: "drf_1",
    name: "docs",
    contentHash: HASH,
    parent: null,
    createdAt: "2026-11-18T00:00:00Z",
    originThreadId: null,
    label: null,
    submittedItemId: null,
  },
};

const HEALTH: ExtHealthEntry = {
  name: "web",
  registrationId: "web",
  consecutiveFailures: 2,
  windowFailures: 2,
  windowMs: 1000,
  autoDisabled: false,
  lastFailureAt: "2026-11-04T10:00:00Z",
  lastError: "timeout",
};

/** 휘발 scope.handler_failed 조각. 열린 대화마다 온다 */
function failedChunk(payload: unknown): { readonly event: VolatileEventWire } {
  return {
    event: {
      id: evt(1),
      kind: "scope.handler_failed",
      version: 1,
      durable: false,
      threadId: thr(1),
      turnId: null,
      stepId: null,
      recordedAt: "2026-11-04T00:00:00.000Z",
      causationId: null,
      correlationId: "c",
      n: 0,
      afterSeq: 3,
      payload,
    },
  };
}
const failurePayload = {
  owner: "ext:review",
  point: "tool.result",
  result: "threw",
  message: "boom",
};

describe("크래프트 명령의 wire 호출", () => {
  test("ext.health는 모든 확장을 뜻하는 빈 params로 보내고 장부 배열을 돌려준다", async () => {
    const { app, params } = await liveApp({ results: { "ext.health": { health: [HEALTH] } } });
    const got = await app.commands.workbench.health();
    expect(got).toEqual({ ok: true, value: [HEALTH] });
    expect(paramsOf(params, "ext.health")).toEqual([{}]);
    await app.stop();
  });

  test("hooks.list는 빈 params로 보내고 hooks 배열을 돌려준다", async () => {
    const hook: HookEntry = {
      hook: "tool.call.before",
      fold: "first",
      handlers: 1,
      registrations: ["web"],
      external: false,
      order: [{ registrationId: "web", extension: "web", tier: 0, status: "enabled", error: null }],
    };
    const { app, params } = await liveApp({ results: { "hooks.list": { hooks: [hook] } } });
    const got = await app.commands.workbench.hooks();
    expect(got).toEqual({ ok: true, value: [hook] });
    expect(paramsOf(params, "hooks.list")).toEqual([{}]);
    await app.stop();
  });

  test("hooks.order.get은 빈 params로 보내고 저장 값과 적용 순서를 그대로 돌려준다", async () => {
    const body: HooksOrderGetResult = {
      hooks: [{ hook: "tool.call.before", saved: [], applied: ["web"], pending: false }],
    };
    const { app, params } = await liveApp({ results: { "hooks.order.get": body } });
    expect(await app.commands.workbench.orderGet()).toEqual({ ok: true, value: body });
    expect(paramsOf(params, "hooks.order.get")).toEqual([{}]);
    await app.stop();
  });

  test("hookKeepOff와 hookReenable은 hook만 보내고 설정을 쓰지 않는다(저장은 호스트가 한다)", async () => {
    const applied = { appliesAt: "nextStepBoundary", diagnostics: [] };
    const { app, params } = await liveApp({
      results: { "hooks.disableConfirm": applied, "hooks.reenable": applied },
    });
    expect(await app.commands.workbench.hookKeepOff("no-rm-rf")).toEqual({ ok: true, value: null });
    expect(await app.commands.workbench.hookReenable("no-rm-rf")).toEqual({
      ok: true,
      value: null,
    });
    expect(paramsOf(params, "hooks.disableConfirm")).toEqual([{ hook: "no-rm-rf" }]);
    expect(paramsOf(params, "hooks.reenable")).toEqual([{ hook: "no-rm-rf" }]);
    expect(paramsOf(params, "settings.set")).toEqual([]);
    await app.stop();
  });

  test("orderSet은 hook과 order를 보내고, 저장 결과를 돌려준다", async () => {
    const result: HooksOrderSetResult = {
      hook: "tool.call.before",
      saved: ["core", "web"],
      appliesAt: "nextStepBoundary",
    };
    const { app, params } = await liveApp({ results: { "hooks.order.set": result } });
    const got = await app.commands.workbench.orderSet("tool.call.before", ["core", "web"]);
    expect(got).toEqual({ ok: true, value: result });
    expect(paramsOf(params, "hooks.order.set")).toEqual([
      { hook: "tool.call.before", order: ["core", "web"] },
    ]);
    await app.stop();
  });

  test("orderReset은 훅을 생략하면 빈 params를, 주면 hook을 보낸다", async () => {
    const result: HooksOrderResetResult = {
      hooks: ["tool.call.before"],
      appliesAt: "nextStepBoundary",
    };
    const { app, params } = await liveApp({ results: { "hooks.order.reset": result } });
    expect(await app.commands.workbench.orderReset()).toEqual({ ok: true, value: result });
    expect(await app.commands.workbench.orderReset("tool.call.before")).toEqual({
      ok: true,
      value: result,
    });
    expect(paramsOf(params, "hooks.order.reset")).toEqual([{}, { hook: "tool.call.before" }]);
    await app.stop();
  });

  test("orderPreview는 hook과 order를 보내고 미리보기 결과를 그대로 돌려준다", async () => {
    const result: HooksOrderPreviewResult = {
      hook: "tool.call.before",
      order: ["core", "web"],
      saveable: true,
      skips: [],
      valueChanges: [],
      autoDisable: [],
      guardRisk: [],
    };
    const { app, params } = await liveApp({ results: { "hooks.order.preview": result } });
    expect(await app.commands.workbench.orderPreview("tool.call.before", ["core", "web"])).toEqual({
      ok: true,
      value: result,
    });
    expect(paramsOf(params, "hooks.order.preview")).toEqual([
      { hook: "tool.call.before", order: ["core", "web"] },
    ]);
    await app.stop();
  });

  test("trace는 threadId와 turnId를 보내고 턴 계측을 그대로 돌려준다", async () => {
    const turn: TraceTurnResult = {
      traceEnabled: true,
      retained: true,
      entries: [
        {
          seq: 1,
          hook: "tool.call.before",
          step: 0,
          handlers: [
            {
              registrationId: "web",
              ms: 3,
              result: "passed",
              atMs: 0,
              size: 0,
              skippedBy: null,
              reason: null,
            },
          ],
        },
      ],
    };
    const { app, params } = await liveApp({ results: { "trace.turn": turn } });
    expect(await app.commands.workbench.trace(thr(1), trn(1))).toEqual({ ok: true, value: turn });
    expect(paramsOf(params, "trace.turn")).toEqual([{ threadId: thr(1), turnId: trn(1) }]);
    await app.stop();
  });

  test("다시 시도는 ext.reenable만 name을 담아 보내고 전역 켜기 설정은 쓰지 않으며 값 null을 돌려준다", async () => {
    const applied = { appliesAt: "nextStepBoundary", diagnostics: [] };
    const { app, params } = await liveApp({ results: { "ext.reenable": applied } });
    expect(await app.commands.workbench.retry("review")).toEqual({ ok: true, value: null });
    expect(paramsOf(params, "ext.reenable")).toEqual([{ name: "review" }]);
    expect(paramsOf(params, "settings.set")).toEqual([]);
    await app.stop();
  });

  test("멈춤 답은 ext.disableConfirm만 name을 담아 보내고 전역 켜기 설정은 쓰지 않는다", async () => {
    const applied = { appliesAt: "nextStepBoundary", diagnostics: [] };
    const { app, params } = await liveApp({ results: { "ext.disableConfirm": applied } });
    expect(await app.commands.workbench.stop("review")).toEqual({ ok: true, value: null });
    expect(paramsOf(params, "ext.disableConfirm")).toEqual([{ name: "review" }]);
    expect(paramsOf(params, "settings.set")).toEqual([]);
    await app.stop();
  });

  test("다시 시도가 안전 모드로 거절되면 코드를 담은 오류 값이다", async () => {
    const { app } = await liveApp({
      errors: {
        "ext.reenable": {
          code: WIRE_ERRORS["extension.safeModeActive"].code,
          kind: "extension.safeModeActive",
        },
      },
    });
    expect(await app.commands.workbench.retry("review")).toEqual({
      ok: false,
      error: { kind: "rejected", code: WIRE_ERRORS["extension.safeModeActive"].code },
    });
    await app.stop();
  });

  test("프로필 목록은 빈 params로 보내고 프로필 배열을 돌려준다", async () => {
    const QUIET: Profile = {
      id: "quiet",
      title: "조용히",
      builtin: false,
      plugins: [{ name: "helm" }],
      settings: [],
      startDrive: null,
      updatedAt: "2026-11-04T10:00:00Z",
      rev: 1,
    };
    const common = { plugins: [], settings: [], updatedAt: "2026-11-04T10:00:00Z", rev: 0 };
    const listed: ProfileListResult = { profiles: [QUIET], common, rev: 1 };
    const { app, params } = await liveApp({ results: { "profile.list": listed } });
    expect(await app.commands.workbench.profiles()).toEqual({ ok: true, value: [QUIET] });
    expect(await app.commands.workbench.profileList()).toEqual({ ok: true, value: listed });
    expect(paramsOf(params, "profile.list")).toEqual([{}, {}]);
    await app.stop();
  });

  test("프로필 저장은 profile과 baseRev를 보내고 저장된 프로필을 돌려준다", async () => {
    const input: ProfileInput = {
      id: "quiet",
      title: "조용히",
      plugins: [{ name: "helm" }, { name: "notes" }],
      settings: [],
      startDrive: null,
    };
    const saved: ProfilePutResult = {
      profile: { ...input, builtin: false, updatedAt: "2026-11-04T10:00:00Z", rev: 2 },
      issues: [],
    };
    const { app, params } = await liveApp({ results: { "profile.put": saved } });
    expect(await app.commands.workbench.putProfile(input, 1)).toEqual({ ok: true, value: saved });
    expect(paramsOf(params, "profile.put")).toEqual([{ profile: input, baseRev: 1 }]);
    await app.stop();
  });

  test("프로필 삭제는 id를 보내고 목록 개정을 돌려준다", async () => {
    const { app, params } = await liveApp({
      results: { "profile.delete": { rev: 5, reassignedThreads: 0 } },
    });
    expect(await app.commands.workbench.deleteProfile("quiet")).toEqual({ ok: true, value: 5 });
    expect(paramsOf(params, "profile.delete")).toEqual([{ id: "quiet" }]);
    await app.stop();
  });

  test("프로필 미리 보기는 id와 대화를 보내고 계산 결과를 돌려준다", async () => {
    const preview: ProfilePreviewResult = {
      resolved: [{ name: "helm" }],
      issues: [],
      cost: {
        total: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
        byPlugin: [],
      },
      missingRequired: [],
      threadsUsing: 2,
      dropsDrive: null,
    };
    const { app, params } = await liveApp({ results: { "profile.preview": preview } });
    expect(await app.commands.workbench.previewProfile("quiet", thr(1))).toEqual({
      ok: true,
      value: preview,
    });
    expect(await app.commands.workbench.previewProfile("quiet")).toEqual({
      ok: true,
      value: preview,
    });
    expect(paramsOf(params, "profile.preview")).toEqual([
      { id: "quiet", threadId: thr(1) },
      { id: "quiet" },
    ]);
    await app.stop();
  });

  test("구성 검사는 composition을 보내고 이슈 목록을 그대로 돌려준다", async () => {
    const composition: CompositionDecl = {
      blocks: [{ id: "detect", stage: "detect", op: "on", hooks: ["tool.call.before"] }],
    };
    const result: ExtValidateResult = {
      issues: [{ severity: "warning", code: "x", path: "blocks[0]", message: "경고" }],
    };
    const { app, params } = await liveApp({ results: { "ext.validateComposition": result } });
    expect(await app.commands.workbench.validateComposition(composition)).toEqual({
      ok: true,
      value: result,
    });
    expect(paramsOf(params, "ext.validateComposition")).toEqual([{ composition }]);
    await app.stop();
  });

  test("제작 호출은 ext.kinds, scaffold, validate, package로 간다", async () => {
    const scaffolded = { dir: "/w/lens-review", files: ["plugin.json"] };
    const packed = { path: "/w/out.tgz", files: ["plugin.json"], sha256: "a".repeat(64) };
    const { app, params } = await liveApp({
      results: {
        "ext.kinds": { kinds: [] },
        "ext.scaffold": scaffolded,
        "ext.validate": { ok: true, issues: [] },
        "ext.package": packed,
      },
    });
    expect(await app.commands.workbench.kinds()).toEqual({ ok: true, value: [] });
    const input = {
      kind: "single-plugin" as const,
      name: "lens-review",
      dir: "/w/lens-review",
    };
    expect(await app.commands.workbench.scaffold(input)).toEqual({ ok: true, value: scaffolded });
    expect(paramsOf(params, "ext.scaffold")).toEqual([input]);
    const checked = await app.commands.workbench.validateDir("/w/lens-review");
    expect(checked.ok && checked.value.ok).toBe(true);
    expect(paramsOf(params, "ext.validate")).toEqual([{ dir: "/w/lens-review" }]);
    expect(await app.commands.workbench.packDir("/w/lens-review")).toEqual({
      ok: true,
      value: packed,
    });
    expect(paramsOf(params, "ext.package")).toEqual([{ dir: "/w/lens-review" }]);
    // out을 주면 그대로 싣는다(확장 상세의 내보내기)
    await app.commands.workbench.packDir("/cfg/extensions/lens", "/cfg/exports/lens-1");
    expect(paramsOf(params, "ext.package")).toEqual([
      { dir: "/w/lens-review" },
      { dir: "/cfg/extensions/lens", out: "/cfg/exports/lens-1" },
    ]);
    await app.stop();
  });

  test("Test run 대화 만들기는 프로필 id가 있을 때만 profileId를 보낸다", async () => {
    const { app, params } = await liveApp({
      results: {
        "thread.create": { threadId: thr(7), position: { storeId: STORE, seq: 6 }, sameFolder: [] },
      },
    });
    expect(await app.commands.tests.createTestRun()).toEqual({ ok: true, value: thr(7) });
    expect(await app.commands.tests.createTestRun("quiet")).toEqual({ ok: true, value: thr(7) });
    expect(paramsOf(params, "thread.create")).toEqual([
      { testRun: true },
      { testRun: true, profileId: "quiet" },
    ]);
    await app.stop();
  });

  test("프로필 적용은 대화를 쓰기로 연 뒤 thread.setProfile로 대화 id와 프로필 id만 보내고 바뀜의 미리 보기를 돌려준다", async () => {
    const set: ThreadSetProfileResult = {
      position: { storeId: STORE, seq: 9 },
      preview: { cacheImpact: "none" },
    };
    const { app, params, methods } = await liveApp({
      results: { "thread.open": OPENED_WRITE, "thread.setProfile": set },
    });
    expect(await app.commands.workbench.applyProfile("quiet", thr(1))).toEqual({
      ok: true,
      value: set,
    });
    // 첫 턴 전의 대화는 관찰로만 열려 있다. setProfile은 쓰기 소유자만 부르므로 먼저 쓰기로 연다(lcM6b)
    expect(paramsOf(params, "thread.open").at(-1)).toEqual({ threadId: thr(1), mode: "write" });
    expect(orderOf(methods, "thread.open", "thread.setProfile").slice(-2)).toEqual([
      "thread.open",
      "thread.setProfile",
    ]);
    expect(paramsOf(params, "thread.setProfile")).toEqual([
      { threadId: thr(1), profileId: "quiet" },
    ]);
    await app.stop();
  });

  test("다른 프로세스가 대화를 쥐었으면(thread.locked) setProfile을 보내지 않고 locked 값을 돌려준다", async () => {
    const { app, methods } = await liveApp({
      failFor: (method, sent) =>
        method === "thread.open" &&
        typeof sent === "object" &&
        sent !== null &&
        "mode" in sent &&
        sent.mode === "write"
          ? {
              code: WIRE_ERRORS["thread.locked"].code,
              kind: "thread.locked",
              details: { ownerKind: "cli", options: ["observe", "fork"] },
            }
          : undefined,
    });
    expect(await app.commands.workbench.applyProfile("quiet", thr(1))).toEqual({
      ok: false,
      error: { kind: "locked", ownerKind: "cli", options: ["observe", "fork"] },
    });
    expect(methods.includes("thread.setProfile")).toBe(false);
    await app.stop();
  });

  test("프로필이 없으면(profile.notFound) 코드를 담은 오류 값이다", async () => {
    const { app } = await liveApp({
      results: { "thread.open": OPENED_WRITE },
      errors: {
        "thread.setProfile": {
          code: WIRE_ERRORS["profile.notFound"].code,
          kind: "profile.notFound",
        },
      },
    });
    expect(await app.commands.workbench.applyProfile("gone", thr(1))).toEqual({
      ok: false,
      error: { kind: "rejected", code: WIRE_ERRORS["profile.notFound"].code },
    });
    await app.stop();
  });

  test("호스트에 메서드가 없으면(-32601) 명령은 unsupported 값이다", async () => {
    const { app } = await liveApp({
      errors: { "hooks.list": { code: -32601, kind: "jsonrpc.methodNotFound" } },
    });
    expect(await app.commands.workbench.hooks()).toEqual({
      ok: false,
      error: { kind: "unsupported" },
    });
    await app.stop();
  });

  test("versions는 name만 보내고 앱에 든 번들 판을 담은 결과를 그대로 돌려준다", async () => {
    const body: ExtVersionsResult = {
      versions: [
        {
          version: "0.2.0",
          installedAt: "2026-11-02T00:00:00.000Z",
          source: "user",
          manifestHash: "h2",
          stateSchemaVersion: null,
          current: true,
        },
      ],
      bundledVersion: "0.1.0",
    };
    const { app, params } = await liveApp({ results: { "ext.versions": body } });
    expect(await app.commands.workbench.versions("helm")).toEqual({ ok: true, value: body });
    expect(paramsOf(params, "ext.versions")).toEqual([{ name: "helm" }]);
    await app.stop();
  });

  test("설치 미리 보기는 plugin.draft.create의 카드를 미리 보기로 옮기고, 설치는 그 초안을 pluginReview.submitDraft로 보낸다", async () => {
    const { app, params, methods } = await liveApp({
      results: { "plugin.draft.create": DRAFT, "pluginReview.submitDraft": { itemId: "rvw_9" } },
    });
    const previewed = await app.commands.workbench.installPreview("/plugins/docs");
    expect(previewed).toEqual({
      ok: true,
      value: {
        name: "docs",
        version: "a".repeat(12),
        displayName: "Docs",
        description: "문서를 읽는다",
        source: "/plugins/docs",
        sha256: HASH,
        trustRequest: null,
        installedVersion: null,
        hooks: ["tool.call.before"],
        tools: [],
        capabilities: [],
        network: [],
        files: [],
        shell: [],
        drives: false,
        screens: [],
        warnings: [],
      },
    });
    expect(await app.commands.workbench.install("/plugins/docs", HASH)).toEqual({
      ok: true,
      value: { itemId: "rvw_9" },
    });
    expect(paramsOf(params, "plugin.draft.create")).toEqual([{ dir: "/plugins/docs" }]);
    expect(paramsOf(params, "pluginReview.submitDraft")).toEqual([{ draftId: "drf_1" }]);
    expect(orderOf(methods, "plugin.draft.create", "pluginReview.submitDraft")).toEqual([
      "plugin.draft.create",
      "pluginReview.submitDraft",
    ]);
    await app.stop();
  });

  test("미리 보기 없이 설치하면 초안을 만들고, 내용 해시가 다르면 source_changed로 거절하며 보내지 않는다", async () => {
    const { app, params } = await liveApp({ results: { "plugin.draft.create": DRAFT } });
    expect(
      await app.commands.workbench.install("/plugins/docs", `sha256:${"c".repeat(64)}`),
    ).toEqual({
      ok: false,
      error: { kind: "rejected", code: null, issue: "source_changed: content hash differs" },
    });
    expect(paramsOf(params, "pluginReview.submitDraft")).toEqual([]);
    await app.stop();
  });

  test("remove는 plugin.requestRemove로 이름만 보내고 검토 항목 id를 돌려준다", async () => {
    const requested = { itemId: "rvw_1" };
    const { app, params } = await liveApp({ results: { "plugin.requestRemove": requested } });
    expect(await app.commands.workbench.remove("web")).toEqual({ ok: true, value: requested });
    expect(paramsOf(params, "plugin.requestRemove")).toEqual([{ name: "web" }]);
    await app.stop();
  });

  test("addInstruction은 한 줄을 plugin.draft.fromInstruction으로 보내고 초안과 검토 항목 id를 돌려준다", async () => {
    const made = { draftId: "drf_1", itemId: "rvw_1" };
    const { app, params } = await liveApp({ results: { "plugin.draft.fromInstruction": made } });
    expect(await app.commands.workbench.addInstruction("Answer in Korean.")).toEqual({
      ok: true,
      value: made,
    });
    expect(await app.commands.workbench.addInstruction("Be terse.", "work")).toEqual({
      ok: true,
      value: made,
    });
    // 프로필을 주지 않으면 params에 profileId를 싣지 않는다(호스트가 default로 고른다)
    expect(paramsOf(params, "plugin.draft.fromInstruction")).toEqual([
      { text: "Answer in Korean." },
      { text: "Be terse.", profileId: "work" },
    ]);
    await app.stop();
  });

  test("reload는 이름만 ext.reload로 보내고 거절은 오류 값으로 돌려준다", async () => {
    const { app, params } = await liveApp({
      results: { "ext.reload": { appliesAt: "nextStepBoundary", diagnostics: [] } },
    });
    expect(await app.commands.workbench.reload("docs")).toEqual({ ok: true, value: null });
    expect(paramsOf(params, "ext.reload")).toEqual([{ name: "docs" }]);
    await app.stop();
    const refused = await liveApp({
      errors: { "ext.reload": { code: 3403, kind: "extension.safeModeActive" } },
    });
    expect(await refused.app.commands.workbench.reload("docs")).toEqual({
      ok: false,
      error: { kind: "rejected", code: 3403 },
    });
    await refused.app.stop();
  });
});

/** 내구 이벤트 하나(시험용). 종류와 seq만 바꾼다 */
const durable = (kind: EventWire["kind"], seq: number): EventWire => ({
  id: evt(seq),
  kind,
  version: 1,
  durable: true,
  seq,
  parentId: null,
  threadId: thr(1),
  turnId: null,
  stepId: null,
  recordedAt: "2026-11-04T10:00:00.000Z",
  causationId: null,
  correlationId: "c",
  payload: {},
  redactions: [],
});

describe("확장 목록을 다시 읽을 알림", () => {
  test("확장 설정 키가 바뀌었거나 키 목록이 비면(전체) 맞고, 다른 설정만 바뀌면 아니다", () => {
    expect(isExtSettingsChange({ keys: ["ext.web.enabled"] })).toBe(true);
    expect(isExtSettingsChange({ keys: ["l4.cli.theme", "ext.core-loop.enabled"] })).toBe(true);
    expect(isExtSettingsChange({ keys: [] })).toBe(true);
    expect(isExtSettingsChange({ keys: ["l1.models.default"] })).toBe(false);
  });

  test("내구 이벤트 묶음에 scope.changed가 있을 때만 맞다(자동 끄기 기록)", () => {
    expect(hasScopeChange({ events: [durable("scope.changed", 6)] })).toBe(true);
    expect(hasScopeChange({ events: [durable("turn.started", 6)] })).toBe(false);
    expect(hasScopeChange({ events: [] })).toBe(false);
  });

  test("새 끌까요 질문을 알리는 조각(asksDisable)에서만 목록을 다시 읽는다", () => {
    expect(asksDisable(failedChunk({ ...failurePayload, consecutive: 5, asksDisable: true }))).toBe(
      true,
    );
    expect(asksDisable(failedChunk({ ...failurePayload, consecutive: 4 }))).toBe(false);
    expect(
      asksDisable(failedChunk({ ...failurePayload, consecutive: 5, asksDisable: false })),
    ).toBe(false);
    expect(asksDisable(failedChunk({ owner: "ext:review" }))).toBe(false);
    const fake = fakeConnection({});
    let woke = 0;
    const stop = subscribeExtChanges(fake.connection, () => void (woke += 1));
    fake.emit("stream.chunk", failedChunk({ ...failurePayload, consecutive: 4 }));
    expect(woke).toBe(0);
    fake.emit(
      "stream.chunk",
      failedChunk({ ...failurePayload, consecutive: 5, asksDisable: true }),
    );
    expect(woke).toBe(1);
    stop();
    fake.emit(
      "stream.chunk",
      failedChunk({ ...failurePayload, consecutive: 5, asksDisable: true }),
    );
    expect(woke).toBe(1);
  });

  test("빈 키 목록의 설정 알림은 적용이 끝났다는 신호(settled)로 부른다. 키가 있는 알림과 이벤트는 아니다", () => {
    const fake = fakeConnection({});
    const seen: boolean[] = [];
    const stop = subscribeExtChanges(fake.connection, (settled) => {
      seen.push(settled);
    });
    fake.emit("settings.invalidated", { keys: [], scopes: ["user"], threadId: null });
    fake.emit("settings.invalidated", {
      keys: ["ext.review.enabled"],
      scopes: ["user"],
      threadId: null,
    });
    fake.emit(
      "stream.chunk",
      failedChunk({ ...failurePayload, consecutive: 5, asksDisable: true }),
    );
    expect(seen).toEqual([true, false, false]);
    stop();
  });

  test("구독은 맞는 알림마다 한 번 부르고, 구독을 풀면 더 부르지 않는다", () => {
    const fake = fakeConnection({});
    let woke = 0;
    const stop = subscribeExtChanges(fake.connection, () => void (woke += 1));
    fake.emit("settings.invalidated", {
      keys: ["ext.web.enabled"],
      scopes: ["user"],
      threadId: null,
    });
    fake.emit("settings.invalidated", {
      keys: ["l1.models.default"],
      scopes: ["user"],
      threadId: null,
    });
    fake.emit("events.batch", {
      sub: SUB,
      from: 5,
      to: 6,
      caughtUp: true,
      events: [durable("turn.started", 6)],
    });
    expect(woke).toBe(1);
    fake.emit("events.batch", {
      sub: SUB,
      from: 6,
      to: 7,
      caughtUp: true,
      events: [durable("scope.changed", 7)],
    });
    expect(woke).toBe(2);
    stop();
    fake.emit("settings.invalidated", { keys: [], scopes: ["user"], threadId: null });
    fake.emit("events.batch", {
      sub: SUB,
      from: 7,
      to: 8,
      caughtUp: true,
      events: [durable("scope.changed", 8)],
    });
    expect(woke).toBe(2);
  });

  test("drive.frames는 threadId를 담아 보내고 프레임 배열을 돌려준다", async () => {
    const core: DriveFrameView = {
      depth: 0,
      plugin: null,
      versionId: null,
      leaseId: null,
      state: "waiting",
      used: { turns: 0, spawns: 0, tokens: 0 },
      limits: {},
    };
    const { app, params } = await liveApp({ results: { "drive.frames": { frames: [core] } } });
    expect(await app.commands.workbench.driveFrames(thr(1))).toEqual({ ok: true, value: [core] });
    expect(paramsOf(params, "drive.frames")).toEqual([{ threadId: thr(1) }]);
    await app.stop();
  });

  test("onDriveFramesChanged는 이 대화의 drive.framesChanged에만 부르고, 구독을 풀면 더 부르지 않는다", async () => {
    const { app, fake } = await liveApp({});
    let woke = 0;
    const stop = app.commands.workbench.onDriveFramesChanged(thr(1), () => void (woke += 1));
    fake.emitLine({ jsonrpc: "2.0", method: "drive.framesChanged", params: { threadId: thr(2) } });
    fake.emitLine({ jsonrpc: "2.0", method: "drive.framesChanged", params: { threadId: thr(1) } });
    await until(() => woke === 1, "drive frames wake-up");
    stop();
    fake.emitLine({ jsonrpc: "2.0", method: "drive.framesChanged", params: { threadId: thr(1) } });
    await tick(20);
    expect(woke).toBe(1);
    await app.stop();
  });

  test("명령의 onChanged는 살아 있는 연결의 ext 설정 무효화 알림에 반응한다", async () => {
    const { app, fake } = await liveApp({});
    let woke = 0;
    const stop = app.commands.workbench.onChanged(() => void (woke += 1));
    fake.emitLine({
      jsonrpc: "2.0",
      method: "settings.invalidated",
      params: { keys: ["ext.web.enabled"], scopes: ["user"], threadId: null },
    });
    await until(() => woke === 1, "ext settings wake-up");
    stop();
    fake.emitLine({
      jsonrpc: "2.0",
      method: "settings.invalidated",
      params: { keys: ["ext.web.enabled"], scopes: ["user"], threadId: null },
    });
    await tick(20);
    expect(woke).toBe(1);
    await app.stop();
  });
});

test("subscribeProfilesChanges wakes on profile.changed only, and stops after unsubscribe", () => {
  const fake = fakeConnection({});
  let woke = 0;
  const stop = subscribeProfilesChanges(fake.connection, () => void (woke += 1));
  fake.emit("profile.changed", { rev: 2, ids: ["default"], commonChanged: false });
  expect(woke).toBe(1);
  fake.emit("settings.invalidated", { keys: [], scopes: ["user"], threadId: null });
  expect(woke).toBe(1);
  stop();
  fake.emit("profile.changed", { rev: 3, ids: [], commonChanged: true });
  expect(woke).toBe(1);
});
