import { expect, test } from "bun:test";
import { defineManifest, type ExtensionEntry } from "@xeon/contracts/extensions";
import { PrimitiveError, type ExtensionUnit } from "@xeon/ext-host";
import { createHarness, type Harness } from "./support/harness.ts";
import { countKind } from "./support/inspect.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

// L1A.6 (LP10): drive 임대 예산을 실제 루프 위에서 시험한다. 횟수는 X가 loop.turn 호출 앞에서, 토큰은 호출 사이에서 센다(L1.loop.spec §4.7).

const answer = (value: string, totalTokens = 10): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
  totalTokens,
});

interface DriveProbe {
  readonly outcomes: string[];
  readonly errors: unknown[];
  /** 각 turn 뒤 `loop.budget.tokens`(남은 토큰, 상한이 없으면 null) */
  readonly tokensLeft: (number | null)[];
}

/** drive 함수가 loop.turn을 `calls`번 부르는 그룹. 임대 한도는 `limits`다 */
function driveGroup(
  name: string,
  calls: number,
  limits: { maxTurns?: number; maxTokens?: number },
): { unit: ExtensionUnit; probe: DriveProbe } {
  const probe: DriveProbe = { outcomes: [], errors: [], tokensLeft: [] };
  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      g.drive(
        async (loop) => {
          const turnAt = async (index: number): Promise<void> => {
            if (index >= calls) return;
            try {
              const result = await loop.turn({
                input: { kind: "user", content: `drive ${index}` },
              });
              probe.outcomes.push(result.status);
              probe.tokensLeft.push(loop.budget.tokens);
            } catch (error) {
              probe.errors.push(error);
              return;
            }
            await turnAt(index + 1);
          };
          await turnAt(0);
        },
        { limits },
      );
    });
  };
  return {
    unit: {
      manifest: defineManifest({
        schemaVersion: 1,
        name,
        version: "0.1.0",
        layer: "L3",
        kind: "group",
        entry: "./index.ts",
        points: [],
        usesDrive: true,
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

test("drive_budget_stops_at_turns_cap: the third loop.turn of a lease with 2 turns is refused", async () => {
  const h = await createHarness({
    script: [answer("drive 0"), answer("drive 1"), answer("never")],
  });
  const group = driveGroup("budget-turns", 3, { maxTurns: 2 });
  await runWith(h, group.unit);
  expect(group.probe.outcomes.slice(0, 2)).toEqual(["completed", "completed"]);
  const error = group.probe.errors[0];
  expect(error instanceof PrimitiveError && error.code).toBe("lease_budget");
  // drive turn 둘만 열렸고 세 번째 모델 요청은 나가지 않았다
  expect(countKind(h.fake.events(h.threadId), "turn.started")).toBe(2);
  expect(h.models.requests).toHaveLength(2);
  // 임대를 쥔 채 남지 않는다
  expect(h.host.host.scopes()[0]?.drive).not.toBe("holding");
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
  expect(group.probe.errors).toEqual([]);
  expect(h.models.requests).toHaveLength(2);
});
