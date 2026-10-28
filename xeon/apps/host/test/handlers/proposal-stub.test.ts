import { expect, test } from "bun:test";
import { createWireHandlers } from "../../src/handlers/index.ts";
import { isNotImplemented } from "../../src/handlers/not-implemented.ts";
import { createFakeEngine } from "../fixtures/fake-engine.ts";

// M3-REQ-18: F가 proposal.* wire 메서드를 더했다. 처리기는 L4 호스트 트랙이 구현하고 그때까지 notImplemented다.

test("proposal.list and proposal.decide are registered as not implemented and stay out of other handlers", () => {
  const fake = createFakeEngine({});
  const table = createWireHandlers(
    fake.engine,
    () => {
      throw new Error("hub is not used");
    },
    { serverName: "xeon", serverVersion: "0.0.0-test", pid: 1 },
  );
  expect({
    list: isNotImplemented(table["proposal.list"]),
    decide: isNotImplemented(table["proposal.decide"]),
    threadList: isNotImplemented(table["thread.list"]),
  }).toEqual({ list: true, decide: true, threadList: false });
});
