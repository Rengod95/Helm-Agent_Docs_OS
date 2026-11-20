import { expect, test } from "bun:test";
import { Bug, parse } from "@fresnel/contracts";
import type {
  DriveCommand,
  DriveLockBudget,
  PostItem,
  StepResult,
} from "@fresnel/contracts/extensions";
import type { OrchestrationApi } from "@fresnel/group-sdk";
import { BUILDER_PLUGIN, helmDrive } from "../../src/drive.ts";
import type { ExplorationMarker } from "../../src/guard.ts";
import { parseHelmCommand, runHelmCommand, viewOf } from "../../src/commands.ts";
import { needIdFrom, inquiryIdFrom } from "../../src/signals.ts";
import { DEFAULT_HELM_SETTINGS } from "../../src/settings.ts";
import {
  HelmStateSchema,
  INITIAL_HELM_STATE,
  pluginNeedOf,
  type HelmPluginNeed,
  type HelmState,
} from "../../src/state.ts";
import { fakeStateApi } from "../support/state-api.ts";

// `/helm plugin` 요청과 맡기기 단계를 엔진 없이 본다. 단계 함수는 같은 상태와 같은 직전 결과에서 같은 명령을 낸다.
// 알림 requestId는 요청 id에서 정해져 재시작 뒤에도 같다(중복 없음).

const FRAME = { frameDepth: 1, calledBy: null, input: null };
const FULL: DriveLockBudget = { turns: 4, spawns: 8, tokens: 400000 };
const PURPOSE = "로그 정리 도구";
const NEED: HelmPluginNeed = { purpose: PURPOSE, id: needIdFrom("plugin:inv-1") };
const WITH_NEED: HelmState = { ...INITIAL_HELM_STATE, pluginNeed: NEED };

interface Posted {
  readonly requestId: string;
  readonly text: string;
}

function textOf(item: PostItem): string {
  return typeof item.content === "string" ? item.content : "";
}

/** 단계 함수 한 번 호출. 알림은 `posted`에 쌓인다(효과는 단계 함수가 낸다) */
function stepper(posted: Posted[]) {
  const marker: ExplorationMarker = { phase: "idle" };
  const api: Pick<OrchestrationApi<HelmState>, "record" | "post" | "capability"> = {
    record: () => Promise.resolve(),
    post: (item, options) => {
      posted.push({ requestId: options.requestId, text: textOf(item) });
      return Promise.resolve({ requestId: options.requestId, duplicate: false });
    },
    capability: () => {
      throw new Bug("the plugin-need steps call no capability");
    },
  };
  const step = helmDrive(api, () => DEFAULT_HELM_SETTINGS, marker);
  return (state: HelmState, last: StepResult | null): Promise<DriveCommand<HelmState>> =>
    step({ state, last, budget: FULL, frame: FRAME });
}

function fresh(): Posted[] {
  return [];
}

const DONE_ACCEPTED: StepResult = {
  kind: "handoff",
  status: "done",
  result: { accepted: true, purpose: PURPOSE },
};

test("plugin.parse: /helm plugin takes the purpose, and an empty purpose is a usage error", () => {
  expect(parseHelmCommand("plugin 로그 정리 도구")).toEqual({
    ok: true,
    value: { name: "plugin", purpose: PURPOSE },
  });
  expect(parseHelmCommand("  plugin   ").ok).toBe(false);
  expect(parseHelmCommand("plugin")).toMatchObject({ ok: false, error: { kind: "usage" } });
});

test("plugin.command: the request is committed once, a second one waits, and a live inquiry refuses it", async () => {
  const api = fakeStateApi();
  const first = await runHelmCommand(
    api,
    { name: "plugin", purpose: PURPOSE },
    {
      nonce: "inv-1",
      terms: [],
    },
  );
  expect(first.ok).toBe(true);
  expect(api.commits.at(-1)?.pluginNeed).toEqual(NEED);
  if (first.ok) expect(first.value.lease).toBe("waiting");

  const second = await runHelmCommand(
    api,
    { name: "plugin", purpose: "다른 도구" },
    {
      nonce: "inv-2",
      terms: [],
    },
  );
  expect(second).toEqual({ ok: false, error: { kind: "plugin_pending" } });

  const live = fakeStateApi({
    ...INITIAL_HELM_STATE,
    phase: "diverge",
    inquiryId: inquiryIdFrom("x"),
    topic: "캐시",
  });
  expect(
    await runHelmCommand(live, { name: "plugin", purpose: PURPOSE }, { nonce: "inv-3", terms: [] }),
  ).toEqual({
    ok: false,
    error: { kind: "already_running", inquiryId: inquiryIdFrom("x") },
  });
  expect(live.commits).toEqual([]);
});

test("plugin.stop: stop while idle cancels a pending plugin request", async () => {
  const api = fakeStateApi(WITH_NEED);
  const stopped = await runHelmCommand(api, { name: "stop" }, { nonce: "inv-4", terms: [] });
  expect(stopped.ok).toBe(true);
  expect(pluginNeedOf(api.state())).toBeNull();
});

test("plugin.step: a pending request hands off to the builder with the purpose and the request id", async () => {
  const posted = fresh();
  const run = stepper(posted);
  expect(await run(WITH_NEED, null)).toEqual({
    do: "handoff",
    to: BUILDER_PLUGIN,
    input: { purpose: PURPOSE, id: NEED.id },
  });
  expect(BUILDER_PLUGIN).toBe("authoring");
  // 맡기기를 낼 때는 알림도 상태 커밋도 하지 않는다. 결과가 올 때 한다
  expect(posted).toEqual([]);
});

test("plugin.done: an accepted reply notices once, clears the request in a commit, then ends the frame", async () => {
  const posted = fresh();
  const run = stepper(posted);
  const command = await run(WITH_NEED, DONE_ACCEPTED);
  expect(command).toEqual({
    do: "commit",
    state: { ...INITIAL_HELM_STATE, pluginNeed: null },
    next: { do: "done" },
  });
  expect(posted).toEqual([
    { requestId: `helm:plugin:${NEED.id}:result`, text: expect.stringContaining("받았어요") },
  ]);
});

test("plugin.refused: a refused handoff (depth limit) notices the failure and clears the request", async () => {
  const posted = fresh();
  const run = stepper(posted);
  const command = await run(WITH_NEED, { kind: "refused", code: "depth_limit" });
  expect(command).toEqual({
    do: "commit",
    state: { ...INITIAL_HELM_STATE, pluginNeed: null },
    next: { do: "done" },
  });
  expect(posted).toEqual([
    {
      requestId: `helm:plugin:${NEED.id}:result`,
      text: `[helm] 플러그인 맡기기를 거부당했어요: ${PURPOSE} (맡기기 깊이 상한에 닿았어요).`,
    },
  ]);
});

test("plugin.outcomes: aborted, declined and unreadable replies each leave one line and clear the request", async () => {
  const cases: readonly [StepResult, string][] = [
    [{ kind: "handoff", status: "aborted", result: null }, "멈췄어요"],
    [{ kind: "aborted" }, "멈췄어요"],
    [
      { kind: "handoff", status: "done", result: { accepted: false, reason: "session_open" } },
      "제작 대화가 이미 열려 있어요",
    ],
    [{ kind: "handoff", status: "done", result: { nonsense: 1 } }, "답을 읽지 못했어요"],
  ];
  const runs = await Promise.all(
    cases.map(async ([last, fragment]) => {
      const posted = fresh();
      const command = await stepper(posted)(WITH_NEED, last);
      return { command, notices: posted.map((post) => post.text), fragment };
    }),
  );
  for (const run of runs) {
    expect(run.command).toMatchObject({
      do: "commit",
      state: { pluginNeed: null },
      next: { do: "done" },
    });
    expect(run.notices).toHaveLength(1);
    expect(run.notices.join("\n")).toContain(run.fragment);
  }
});

test("plugin.stale: a handoff reply with no request left is ignored without a notice", async () => {
  const posted = fresh();
  expect(await stepper(posted)(INITIAL_HELM_STATE, DONE_ACCEPTED)).toEqual({ do: "done" });
  expect(posted).toEqual([]);
});

test("plugin.then-inquiry: a request and a pending topic run the handoff first, then the inquiry starts", async () => {
  const posted = fresh();
  const run = stepper(posted);
  const pending = {
    ...WITH_NEED,
    pending: { inquiryId: inquiryIdFrom("p"), topic: "캐시", source: "command" as const },
  };
  expect(await run(pending, null)).toMatchObject({ do: "handoff", to: BUILDER_PLUGIN });
  const after = await run(pending, DONE_ACCEPTED);
  expect(after).toMatchObject({
    do: "commit",
    state: { pluginNeed: null },
    next: { do: "commit", state: { phase: "diverge" } },
  });
});

test("plugin.old-document: a state document without the field reads as no request and still validates", async () => {
  const old: Record<string, unknown> = { ...INITIAL_HELM_STATE };
  delete old.pluginNeed;
  const checked = parse(HelmStateSchema, old);
  expect(checked.ok).toBe(true);
  if (!checked.ok) return;
  expect(pluginNeedOf(checked.value)).toBeNull();
  expect(viewOf(checked.value).lease).toBe("none");
  expect(await stepper(fresh())(checked.value, null)).toEqual({ do: "done" });
});
