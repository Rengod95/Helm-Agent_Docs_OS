import { describe, expect, test } from "bun:test";
import { createScreenLedger, LEDGER_DISABLE_AFTER } from "../../src/views/ledger.ts";

describe("screen ledger", () => {
  test("four failures keep the screen active, the fifth consecutive one disables it", () => {
    const ledger = createScreenLedger();
    for (let index = 1; index < LEDGER_DISABLE_AFTER; index += 1) {
      expect(ledger.fail("helm/inquiry", "query_failed")).toBe(false);
      expect(ledger.stateOf("helm/inquiry")).toEqual({ state: "active", consecutive: index });
    }
    expect(ledger.fail("helm/inquiry", "bridge_format")).toBe(true);
    expect(ledger.stateOf("helm/inquiry")).toEqual({
      state: "view_disabled",
      last: "bridge_format",
    });
  });

  test("a success resets the consecutive count", () => {
    const ledger = createScreenLedger();
    for (let index = 0; index < 4; index += 1) ledger.fail("a/b", "result_invalid");
    ledger.succeed("a/b");
    expect(ledger.stateOf("a/b")).toEqual({ state: "active", consecutive: 0 });
    for (let index = 0; index < 4; index += 1) ledger.fail("a/b", "result_invalid");
    expect(ledger.stateOf("a/b")).toEqual({ state: "active", consecutive: 4 });
  });

  test("screens are counted separately and only the failing one is disabled", () => {
    const ledger = createScreenLedger();
    for (let index = 0; index < 5; index += 1) ledger.fail("a/one", "render_exception");
    expect(ledger.stateOf("a/one").state).toBe("view_disabled");
    expect(ledger.stateOf("a/two")).toEqual({ state: "active", consecutive: 0 });
  });

  test("a disabled screen ignores later successes and failures until it is re-enabled", () => {
    const ledger = createScreenLedger();
    for (let index = 0; index < 5; index += 1) ledger.fail("a/one", "liveness_lost");
    ledger.succeed("a/one");
    expect(ledger.fail("a/one", "query_failed")).toBe(false);
    expect(ledger.stateOf("a/one")).toEqual({ state: "view_disabled", last: "liveness_lost" });
    ledger.reenable("a/one");
    expect(ledger.stateOf("a/one")).toEqual({ state: "active", consecutive: 0 });
  });

  test("listeners hear the disable and the re-enable, and stop after unsubscribe", () => {
    const ledger = createScreenLedger();
    const heard: string[] = [];
    const stop = ledger.subscribe((key, state) => heard.push(`${key}:${state.state}`));
    for (let index = 0; index < 5; index += 1) ledger.fail("a/one", "ready_timeout");
    ledger.reenable("a/one");
    stop();
    for (let index = 0; index < 5; index += 1) ledger.fail("a/one", "ready_timeout");
    expect(heard).toEqual(["a/one:view_disabled", "a/one:active"]);
  });
});
