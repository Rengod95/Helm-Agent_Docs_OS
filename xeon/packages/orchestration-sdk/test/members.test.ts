import { expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import type { PluginDecl } from "@fresnel/contracts/extensions";
import { extReadViewOf } from "@fresnel/ext-host";
import { createTestHost } from "@fresnel/ext-host/testing";
import { Type } from "typebox";
import {
  checkRecordKind,
  defaultMetricsRegistry,
  defineOrchestration,
  defineOrchestrationMember,
  validateOrchestrationDef,
  type OrchestrationDefShape,
  type OrchestrationManifest,
} from "../src/index.ts";
import { checkOrchestration } from "../src/testing/index.ts";
import { fireSettled, install } from "./support/host.ts";
import { orchestrationManifestOf } from "./support/manifests.ts";

const CounterSchema = Type.Object({ n: Type.Integer({ minimum: 0 }) });

/** 구성원 선언(L3, 훅 없음). id가 있으면 구성원 후보다 */
function member(id: string): PluginDecl {
  return { id, layer: "L3", hooks: [] };
}

/**
 * 뿌리 플러그인 하나와 구성원 플러그인들을 가진 매니페스트. `listed`를 주면 `orchestration.members`가 그 목록이다.
 * 구성원 id의 순서가 `plugins[]` 순서다
 */
function withMembers(
  name: string,
  members: readonly PluginDecl[],
  listed?: string[],
): OrchestrationManifest {
  return {
    ...orchestrationManifestOf({ name }),
    plugins: [{ layer: "L3", hooks: [] }, ...members],
    orchestration: listed === undefined ? {} : { members: listed },
  };
}

/** 검사 결과의 오류만 (코드, 경로) 쌍으로 */
function errorsOf(def: OrchestrationDefShape): [string, string][] {
  return validateOrchestrationDef(def)
    .filter((found) => found.severity === "error")
    .map((found) => [found.code, found.path]);
}

test("a root and two members install as three Registrations in plugins order, with nothing unregistered", async () => {
  const t = await createTestHost();
  const module = defineOrchestration({
    manifest: withMembers("mem-three", [member("alpha"), member("beta")]),
    setup() {},
    members: {
      alpha: defineOrchestrationMember({ setup() {} }),
      beta: defineOrchestrationMember({ setup() {} }),
    },
  });
  const outcome = await install(t, module);
  expect(outcome.unregistered).toEqual([]);
  expect(outcome.registrations).toEqual(["mem-three", "mem-three/alpha", "mem-three/beta"]);
  expect(t.host.registrations().map((info) => info.id)).toEqual([
    "mem-three",
    "mem-three/alpha",
    "mem-three/beta",
  ]);
  // 로더의 plugin_not_registered 경고는 이 unregistered 목록에서 나온다(entry-loader.ts)
  // 구성원의 계측은 등록부에 올리지 않는다. 등록부 키는 오케스트레이션 이름 하나다
  expect(defaultMetricsRegistry.get("mem-three")).toBeDefined();
  expect(defaultMetricsRegistry.get("mem-three/alpha")).toBeUndefined();
});

test("member keys are checked against plugins[] and orchestration.members, and each declared member needs a definition", () => {
  const noop = defineOrchestrationMember({ setup() {} });
  // beta는 plugins[]에 있어도 orchestration.members에 없으면 구성원이 아니다
  const listed = withMembers("mem-keys", [member("alpha"), member("beta")], ["alpha"]);
  expect(errorsOf({ manifest: listed, members: { alpha: noop, ghost: noop, beta: noop } })).toEqual(
    [
      ["member_unknown", "/members/ghost"],
      ["member_unknown", "/members/beta"],
    ],
  );
  expect(() =>
    defineOrchestration({ manifest: listed, members: { ghost: noop }, setup() {} }),
  ).toThrow(/member_unknown \/members\/ghost/);

  // 선언만 있고 정의가 없는 구성원은 member_missing이다
  const declared = withMembers("mem-missing", [member("alpha"), member("beta")]);
  expect(errorsOf({ manifest: declared, members: { alpha: noop } })).toEqual([
    ["member_missing", "/members/beta"],
  ]);
  expect(errorsOf({ manifest: withMembers("mem-none", [member("alpha")]) })).toEqual([
    ["member_missing", "/members/alpha"],
  ]);

  // 구성원의 상태 검사는 뿌리와 같은 규칙이고 경로가 /members/<id>다
  const broken = defineOrchestrationMember({
    state: { schema: CounterSchema, initial: { n: -1 }, version: 2 },
    setup() {},
  });
  expect(
    errorsOf({ manifest: withMembers("mem-state", [member("alpha")]), members: { alpha: broken } }),
  ).toEqual([
    ["state_migration_missing", "/members/alpha/migrations/1"],
    ["state_initial_invalid", "/members/alpha/state/initial"],
  ]);

  // 다른 방법으로 만든 구성원은 defineOrchestration이 Bug로 거부한다
  const handWritten = { mount() {} };
  const hand = () =>
    defineOrchestration({
      manifest: withMembers("mem-hand", [member("alpha")]),
      setup() {},
      members: { alpha: handWritten },
    });
  expect(hand).toThrow(Bug);
  expect(hand).toThrow(/defineOrchestrationMember/);
});

test("a member's setup runs on its own Registration, and its on() hook is listed under that Registration", async () => {
  const t = await createTestHost();
  const ran: string[] = [];
  const module = defineOrchestration({
    manifest: withMembers("mem-hook", [
      { id: "alpha", layer: "L3", hooks: ["tool.call.before"], defaultEnabled: true },
    ]),
    setup(g) {
      ran.push(g.id);
    },
    members: {
      alpha: defineOrchestrationMember({
        setup(g) {
          ran.push(g.id);
          g.on("tool.call.before", () => undefined);
        },
      }),
    },
  });
  await install(t, module);
  await t.settled();
  expect(ran).toEqual(["mem-hook", "mem-hook/alpha"]);
  expect(
    extReadViewOf(t.host)
      .handlers()
      .map((row) => [row.point, row.scopeId]),
  ).toEqual([["tool.call.before", "mem-hook/alpha"]]);
  expect(t.host.registrations().map((info) => [info.id, info.status])).toEqual([
    ["mem-hook", "enabled"],
    ["mem-hook/alpha", "enabled"],
  ]);
});

test("a member's state is its own Registration's document, apart from the root's", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const seen: Record<string, number> = {};
  const module = defineOrchestration({
    manifest: {
      ...orchestrationManifestOf({ name: "mem-state-own", hooks: ["boundary.settle.after"] }),
      plugins: [
        { layer: "L3", hooks: ["boundary.settle.after"] },
        { id: "alpha", layer: "L3", hooks: ["boundary.settle.after"], defaultEnabled: true },
      ],
    },
    state: { schema: CounterSchema, initial: { n: 0 }, version: 1 },
    setup(g) {
      // 상태는 대화 안에서 읽는다. setup에서는 대화가 없어 읽을 수 없다
      g.on("boundary.settle.after", () => {
        seen.root = g.state().n;
      });
    },
    members: {
      alpha: defineOrchestrationMember({
        state: { schema: CounterSchema, initial: { n: 5 }, version: 1 },
        setup(g) {
          g.on("boundary.settle.after", () => {
            seen.member = g.state().n;
          });
        },
      }),
    },
  });
  await install(t, module);
  await t.settled();
  await fireSettled(t, thread, "member-state");
  expect(seen).toEqual({ root: 0, member: 5 });
});

test("a root-only definition keeps one Registration, its metrics entry under the plugin name, and no member checks", async () => {
  const t = await createTestHost();
  const module = defineOrchestration({
    manifest: orchestrationManifestOf({ name: "solo-root", hooks: ["tool.call.before"] }),
    setup(g) {
      g.on("tool.call.before", () => undefined);
    },
  });
  const outcome = await install(t, module);
  expect(outcome.registrations).toEqual(["solo-root"]);
  expect(outcome.unregistered).toEqual([]);
  expect(t.host.registrations().map((info) => info.id)).toEqual(["solo-root"]);
  expect(
    extReadViewOf(t.host)
      .handlers()
      .map((row) => [row.point, row.scopeId]),
  ).toEqual([["tool.call.before", "solo-root"]]);
  expect(defaultMetricsRegistry.get("solo-root")).toBeDefined();
  expect(errorsOf({ manifest: orchestrationManifestOf({ name: "solo-root" }) })).toEqual([]);
});

test("checkOrchestration reports a member's undeclared hook at that member's plugins[] position", async () => {
  const module = defineOrchestration({
    manifest: withMembers("mem-check", [member("alpha"), member("beta")]),
    setup() {},
    members: {
      alpha: defineOrchestrationMember({ setup() {} }),
      beta: defineOrchestrationMember({
        setup(g) {
          g.on("tool.call.before", () => undefined);
        },
      }),
    },
  });
  expect((await checkOrchestration(module)).map((found) => [found.code, found.path])).toEqual([
    ["hook_undeclared", "/plugins/2/hooks"],
  ]);
});

test("checkRecordKind reads the given registration's declaration, and the root's when none is given", () => {
  const kind = "grp.memrec.note.done";
  const declared: PluginDecl = {
    id: "alpha",
    layer: "L3",
    hooks: [],
    recordKinds: [
      {
        kind,
        version: 1,
        description: "A note.",
        payload: { type: "object", additionalProperties: false },
      },
    ],
  };
  const manifest = withMembers("memrec", [declared]);
  expect(checkRecordKind(manifest, kind, declared)).toEqual({ ok: true });
  expect(checkRecordKind(manifest, kind)).toMatchObject({
    ok: false,
    code: "record_kind_undeclared",
  });
});
