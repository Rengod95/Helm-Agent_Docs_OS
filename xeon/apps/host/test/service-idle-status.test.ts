import { expect, test } from "bun:test";
import { isServiceReplaceable } from "../src/service/ensure.ts";

// 결정 2026-11-04 B11. 승인을 기다리는 thread가 있는 서비스는 바쁘다: 빌드가 달라도 바꾸지 않는다.
// 결정 2026-11-15: 다른 연결이 있어도 일하는 중이 아니면 바꾼다.

test("a service with a thread waiting on approval or a live turn is not replaceable", () => {
  expect(isServiceReplaceable({ liveTurns: 0 })).toBe(true);
  expect(isServiceReplaceable({ liveTurns: 0, waitingApprovals: 0 })).toBe(true);
  expect(isServiceReplaceable({ liveTurns: 0, waitingApprovals: 2 })).toBe(false);
  expect(isServiceReplaceable({ liveTurns: 1 })).toBe(false);
});
