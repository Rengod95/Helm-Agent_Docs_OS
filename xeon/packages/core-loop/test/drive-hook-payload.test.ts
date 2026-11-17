import { expect, test } from "bun:test";
import {
  defineManifest,
  type DriveCommand,
  type ExtensionEntry,
  type StepResult,
} from "@fresnel/contracts/extensions";
import type { ExtensionUnit } from "@fresnel/ext-host";
import type { ScriptedResponse } from "./support/fake-models.ts";
import { createHarness } from "./support/harness.ts";

// 턴 시작 훅 `input.agent.before`의 payload가 주도권 스택을 싣는다(drive-isolation.md 2.5). 값은 실제 dispatch로 핸들러가 받은 것을 본다.
// 스택이 [A, B]면 `driver`는 맨 위 B, `stack`은 아래에서 위 순서 [A, B]다. 스택이 비면 `driver`는 null, `stack`은 빈 배열이다.

type Command = DriveCommand<never>;

/** 핸들러가 받은 `driver`와 `stack`만 모은다 */
interface SeenDrive {
  readonly driver: string | null;
  readonly stack: readonly string[];
}

const answer = (value: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
});

/** 턴 시작 훅을 듣고 `driver`·`stack`을 `seen`에 쌓는다. 시스템 프롬프트는 건드리지 않는다 */
function probeUnit(seen: SeenDrive[]): ExtensionUnit {
  const entry: ExtensionEntry = ({ manifest, register }) => {
    register(manifest.name, {}, (g) => {
      g.on("input.agent.before", (payload) => {
        seen.push({ driver: payload.driver, stack: [...payload.stack] });
        return undefined;
      });
    });
  };
  return {
    manifest: defineManifest({
      schemaVersion: 2,
      name: "payload-probe",
      version: "0.1.0",
      entry: "./index.ts",
      plugins: [{ layer: "plugin", hooks: ["input.agent.before"] }],
    }),
    entry,
    loadIndex: 4,
    builtin: false,
  };
}

/** 주도 단계 함수 하나짜리 그룹. 단계마다 `decide`가 고른 명령을 돌려준다 */
function driveUnit(
  name: string,
  loadIndex: number,
  decide: (last: StepResult | null) => Command,
): ExtensionUnit {
  const entry: ExtensionEntry = ({ manifest, register }) => {
    register(manifest.name, {}, (g) => {
      g.drive(({ last }) => Promise.resolve(decide(last)));
    });
  };
  return {
    manifest: defineManifest({
      schemaVersion: 2,
      name,
      version: "0.1.0",
      entry: "./index.ts",
      plugins: [{ layer: "L3", hooks: [], drives: true }],
      group: {},
      trust: { level: "builtin" },
    }),
    entry,
    loadIndex,
    builtin: false,
  };
}

test("a_turn_with_no_drive_carries_a_null_driver_and_an_empty_stack", async () => {
  const seen: SeenDrive[] = [];
  const h = await createHarness({ script: [answer("plain")] });
  await h.host.host.install(probeUnit(seen));
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  expect(seen).toEqual([{ driver: null, stack: [] }]);
});

test("a_turn_under_a_two_frame_stack_names_the_top_driver_and_the_stack_bottom_up_then_empties", async () => {
  const seen: SeenDrive[] = [];
  const h = await createHarness({ script: [answer("b done"), answer("after")] });
  await h.host.host.install(probeUnit(seen));
  // A는 처음 호출에서 B에게 맡기고, B는 처음 호출에서 turn을 낸다. 두 번째 호출은 끝낸다
  await h.host.host.install(
    driveUnit("drive-a", 2, (last) =>
      last === null ? { do: "handoff", to: "drive-b", input: "a to b" } : { do: "done" },
    ),
  );
  await h.host.host.install(
    driveUnit("drive-b", 3, (last) =>
      last === null ? { do: "turn", input: { kind: "user", content: "drive b" } } : { do: "done" },
    ),
  );
  await h.host.settled();
  expect(h.host.host.startDrive(h.threadId, "drive-a").ok).toBe(true);
  await h.settle();

  // 주도 중인 B의 턴 시작 훅: 맨 위가 B이고 스택은 아래에서 위로 A, B다
  expect(seen).toEqual([{ driver: "drive-b", stack: ["drive-a", "drive-b"] }]);

  // 주도가 끝나 스택이 비면 다음 턴의 훅은 주도 없음 값을 받는다
  await h.loop.admit({ threadId: h.threadId, content: "after", via: "interactive" });
  await h.settle();
  expect(seen.at(-1)).toEqual({ driver: null, stack: [] });
});
