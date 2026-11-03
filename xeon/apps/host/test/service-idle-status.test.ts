import { expect, test } from "bun:test";
import { isServiceIdle } from "../src/service/ensure.ts";

// 결정 2026-11-04 B11. 승인을 기다리는 thread가 있는 서비스는 바쁘다: 버전이 달라도 바꾸지 않는다.

test("a service with a thread waiting on approval is busy even with no live turn and one connection", () => {
  expect(isServiceIdle({ liveTurns: 0, connections: 1 })).toBe(true);
  expect(isServiceIdle({ liveTurns: 0, connections: 1, waitingApprovals: 0 })).toBe(true);
  expect(isServiceIdle({ liveTurns: 0, connections: 1, waitingApprovals: 2 })).toBe(false);
  expect(isServiceIdle({ liveTurns: 1, connections: 1 })).toBe(false);
  expect(isServiceIdle({ liveTurns: 0, connections: 2 })).toBe(false);
});
