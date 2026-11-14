import { expect, test } from "bun:test";
import { modeCoversRunApprovals } from "../src/policy/modes.ts";
import { createHarness, layer } from "./support/harness.ts";

// [결정: 2026-11-13 사용자] "모두 허용"은 실행 허가 성격의 승인을 덮는다. 덮는지 판정하는 곳은 한 군데다.
test("only bypass covers run approvals, and only while managed does not forbid it", () => {
  expect(modeCoversRunApprovals("bypass", true)).toBe(true);
  expect(modeCoversRunApprovals("bypass", false)).toBe(false);
  expect(modeCoversRunApprovals("default", true)).toBe(false);
  expect(modeCoversRunApprovals("acceptEdits", true)).toBe(false);
});

test("ToolService.coversRunApprovals follows the thread's mode and the managed bypass switch", async () => {
  const bypass = await createHarness({
    layers: [layer("user", { "l1.tools.permissionMode": "bypass" })],
  });
  expect(bypass.runtime.tools.coversRunApprovals(bypass.thread)).toBe(true);

  const forbidden = await createHarness({
    layers: [
      layer("user", { "l1.tools.permissionMode": "bypass" }),
      layer("managed", { "l1.tools.bypassAllowed": false }),
    ],
  });
  expect(forbidden.runtime.tools.coversRunApprovals(forbidden.thread)).toBe(false);

  // 저장소가 커밋한 bypass는 덮지 않는다
  const repository = await createHarness({
    layers: [layer("project", { "l1.tools.permissionMode": "bypass" })],
  });
  expect(repository.runtime.tools.coversRunApprovals(repository.thread)).toBe(false);

  const asking = await createHarness({
    layers: [layer("user", { "l1.tools.permissionMode": "default" })],
  });
  expect(asking.runtime.tools.coversRunApprovals(asking.thread)).toBe(false);

  const unset = await createHarness({});
  // 시험 마구는 모드를 정하지 않으면 default를 깐다
  expect(unset.runtime.tools.coversRunApprovals(unset.thread)).toBe(false);
});
