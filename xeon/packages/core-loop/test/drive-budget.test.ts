import { expect, test } from "bun:test";
import { defineManifest, type ExtensionEntry } from "@fresnel/contracts/extensions";
import type { ExtensionUnit } from "@fresnel/ext-host";
import { createHarness, type Harness } from "./support/harness.ts";
import { countKind } from "./support/inspect.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

// L1A.6 (LP10): drive 임대 예산을 실제 루프 위에서 시험한다. 횟수는 X가 turn 명령 앞에서, 토큰은 turn 결과 사이에서 센다(L1.loop.spec §4.7).

const answer = (value: string, totalTokens = 10): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
  totalTokens,
});

interface DriveProbe {
  readonly outcomes: string[];
  /** 각 turn 뒤 단계 함수가 받은 `budget.tokens`(남은 토큰, 상한이 없으면 null) */
  readonly tokensLeft: (number | null)[];
}

/** drive 함수가 turn 명령을 `calls`번 돌려주는 그룹. 임대 한도는 `limits`다 */
function driveGroup(
  name: string,
  calls: number,
  limits: { maxTurns?: number; maxTokens?: number },
): { unit: ExtensionUnit; probe: DriveProbe } {
  const probe: DriveProbe = { outcomes: [], tokensLeft: [] };
  const entry: ExtensionEntry = ({ manifest, register }) => {
    register(manifest.name, {}, (g) => {
      g.drive(
        async ({ last, budget }) => {
          if (last?.kind === "ok" && last.of === "turn") {
            probe.outcomes.push(last.value.status);
            probe.tokensLeft.push(budget.tokens);
          }
          if (probe.outcomes.length >= calls) return { do: "yield" };
          return { do: "turn", input: { kind: "user", content: `drive ${probe.outcomes.length}` } };
        },
        { limits },
      );
    });
  };
  return {
    unit: {
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
      loadIndex: 3,
      builtin: false,
    },
    probe,
  };
}

/** 그룹을 올리면 임대를 받고 drive 함수가 바로 돈다 */
async function runWith(h: Harness, unit: ExtensionUnit): Promise<void> {
  await h.host.host.install(unit);
  await h.host.settled();
  await h.settle();
}

test("drive_budget_stops_at_turns_cap: the third turn of a lease with 2 turns is refused and the lease is released as budget", async () => {
  const h = await createHarness({
    script: [answer("drive 0"), answer("drive 1"), answer("never")],
  });
  const group = driveGroup("budget-turns", 3, { maxTurns: 2 });
  await runWith(h, group.unit);
  expect(group.probe.outcomes).toEqual(["completed", "completed"]);
  // drive turn 둘만 열렸고 세 번째 모델 요청은 나가지 않았다
  expect(countKind(h.fake.events(h.threadId), "turn.started")).toBe(2);
  expect(h.models.requests).toHaveLength(2);
  // 세 번째 turn 명령은 거부되어 임대가 예산 사유로 반납된다(이 하니스는 lease.* 사건을 로그에 쓰지 않아 상태로 확인한다)
  // 임대를 쥔 채 남지 않는다
  expect(h.host.host.registrations()[0]?.drive).not.toBe("holding");
});

test("the token budget is reported after each turn and never cuts the running turn", async () => {
  const h = await createHarness({
    script: [answer("drive 0", 100), answer("drive 1", 10)],
  });
  const group = driveGroup("budget-tokens", 2, { maxTokens: 150 });
  await runWith(h, group.unit);
  // 첫 turn은 100토큰을 쓰고 끝까지 갔다. 남은 토큰은 50, 둘째 turn 뒤 40이다
  expect(group.probe.outcomes.slice(0, 2)).toEqual(["completed", "completed"]);
  expect(group.probe.tokensLeft.slice(0, 2)).toEqual([50, 40]);
  // 예산 소진이나 오류로 반납되지 않았다(두 turn 모두 실행됐고 임대가 끊기지 않았다)
  const released = h.fake
    .events(h.threadId)
    .filter((event) => event.kind === "lease.released")
    .map((event) => event.payload);
  expect(released).toEqual([]);
  expect(h.models.requests).toHaveLength(2);
});

test("a user interrupt releases the drive lock as revoked and the drive runs again only after the next command", async () => {
  const h = await createHarness({
    script: [{ kind: "stall" }, answer("next command done")],
  });
  const calls: string[] = [];
  const entry: ExtensionEntry = ({ manifest, register }) => {
    register(manifest.name, {}, (g) => {
      g.drive(({ last }) => {
        calls.push("drive");
        // 주도 중에 들어온 사용자 메시지는 단계 함수가 `last: user`로 받아 turn으로 처리한다(drive-isolation.md 2.4)
        if (last?.kind === "user") return Promise.resolve({ do: "turn", input: last.message });
        return Promise.resolve({ do: "yield" });
      });
    });
  };
  await runWith(h, {
    manifest: defineManifest({
      schemaVersion: 2,
      name: "stop-drive",
      version: "0.1.0",
      entry: "./index.ts",
      plugins: [{ layer: "L3", hooks: [], drives: true }],
      group: {},
      trust: { level: "builtin" },
    }),
    entry,
    loadIndex: 3,
    builtin: false,
  });
  expect(calls).toEqual(["drive"]);

  await h.loop.admit({ threadId: h.threadId, content: "work", via: "interactive" });
  await h.tick();
  await h.tick();
  expect(await h.loop.interrupt(h.threadId)).toBe(true);
  await h.settle();
  await h.host.settled();
  const released = h.fake
    .events(h.threadId)
    .filter((event) => event.kind === "lease.released")
    .map((event) => event.payload);
  expect(released).toMatchObject([{ reason: "revoked" }]);
  // 'work'를 받은 단계 한 번이 더 불렸다. 반납 뒤에는 불리지 않는다
  expect(calls).toEqual(["drive", "drive"]);

  await h.loop.admit({ threadId: h.threadId, content: "again", via: "interactive" });
  await h.settle();
  await h.host.settled();
  const kinds = h.fake.events(h.threadId).map((event) => event.kind);
  // 반납 뒤 다음 명령의 turn이 정착해야 임대가 다시 부여된다
  expect(kinds.slice(kinds.lastIndexOf("turn.started"))).toContain("lease.acquired");
  // 'again'의 turn이 정착한 뒤 임대가 다시 부여되어 단계가 한 번 더 불렸다
  expect(calls).toEqual(["drive", "drive", "drive"]);
});
