import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { RECORD_KIND_PATTERN, validateManifest } from "@xeon/contracts/extensions";
import { buildCatalog } from "@xeon/contracts/settings";
import { checkGroup } from "@xeon/group-kit/testing";
import { createLearningGroup, learningManifest, learningSettings } from "../src/index.ts";
import { readLearningSettings } from "../src/settings.ts";
import { manualClock } from "./support/clock.ts";
import { foldReader } from "./support/projection.ts";
import { createRig } from "./support/rig.ts";

function group() {
  return createLearningGroup({ clock: manualClock(), reader: foldReader(() => []) });
}

test("manifest.validates", async () => {
  expect(validateManifest(learningManifest).issues.filter((i) => i.severity === "error")).toEqual(
    [],
  );
  expect(learningManifest.usesDrive).toBe(false);
  expect(learningManifest.usesPost).toBe(false);
  expect(learningManifest.defaultEnabled).toBe(true);
  expect(learningManifest.trust).toEqual({ level: "builtin" });
  expect(learningManifest.points).toEqual([
    "boundary.turn.before",
    "boundary.step.after",
    "boundary.settle.after",
    "lifecycle.agent.settled",
  ]);
  expect(learningManifest.readsRecordKinds).toEqual([]);
  const kinds = learningManifest.recordKinds ?? [];
  expect(kinds).toHaveLength(8);
  for (const decl of kinds) {
    expect(decl.kind.startsWith("grp.learning.")).toBe(true);
    expect(new RegExp(RECORD_KIND_PATTERN).test(decl.kind)).toBe(true);
  }
  // setup이 선언한 등록만 쓰는지 본다: 선언 없는 지점, post, drive, 레코드 kind가 있으면 오류다
  const rig = await createRig();
  expect(rig.installIssues.filter((found) => found.severity === "error")).toEqual([]);
  // 지식 능력이 없는 호스트에서는 X가 setup 전에 거부한다(capability_unavailable). 선언과 무관한 사용 오류는 없다
  const bare = await checkGroup(group());
  expect(bare.map((found) => found.code)).not.toContain("point_undeclared");
  expect(bare.map((found) => found.code)).not.toContain("drive_undeclared");
  expect(bare.map((found) => found.code)).not.toContain("post_undeclared");
});

test("settings.defs-valid", () => {
  const defs = Object.values(learningSettings.defs);
  expect(defs).toHaveLength(12);
  const built = buildCatalog([{ owner: "group-learning", namespace: "l3.learning", defs }]);
  expect(built.ok).toBe(true);
  const defaults = Object.fromEntries(defs.map((def) => [def.key, def.default]));
  expect(defaults).toEqual({
    "l3.learning.trigger.userTurns": 10,
    "l3.learning.trigger.toolIterations": 10,
    "l3.learning.review.maxIterations": 16,
    "l3.learning.review.tokenBudget": null,
    "l3.learning.review.model": null,
    "l3.learning.approval.required": true,
    "l3.learning.scan.enabled": true,
    "l3.learning.queue.expiryDays": 30,
    "l3.learning.curator.enabled": false,
    "l3.learning.curator.intervalHours": 168,
    "l3.learning.curator.minIdleHours": 2,
    "l3.learning.curator.llmConsolidate": false,
  });
  // 1차 코드가 읽지 않는 큐레이터 키(2차)는 화면과 settings.set에서 빠지도록 reserved다
  const reserved = defs.filter((def) => def.stage === "reserved").map((def) => def.key);
  expect(reserved).toEqual([
    "l3.learning.curator.enabled",
    "l3.learning.curator.intervalHours",
    "l3.learning.curator.minIdleHours",
    "l3.learning.curator.llmConsolidate",
  ]);
  const triggers = learningSettings.defs["trigger.userTurns"];
  expect(parse(triggers.type, 0).ok).toBe(true);
  expect(parse(triggers.type, 1001).ok).toBe(false);
});

test("settings.read-failure-fails-closed", () => {
  const good = readLearningSettings(() => ({
    "trigger.userTurns": 10,
    "trigger.toolIterations": 10,
    "review.maxIterations": 16,
    "review.tokenBudget": null,
    "review.model": null,
    "approval.required": true,
    "scan.enabled": true,
    "queue.expiryDays": 30,
  }));
  expect(good.ok).toBe(true);
  const threw = readLearningSettings(() => {
    throw new TypeError("settings are unreadable");
  });
  expect(threw).toEqual({ ok: false, error: { kind: "learning.settingsUnavailable" } });
  const broken = readLearningSettings(() => ({ "trigger.userTurns": "ten" }));
  expect(broken).toEqual({ ok: false, error: { kind: "learning.settingsUnavailable" } });
});
