import { describe, expect, test } from "bun:test";
import type { EventKind } from "@fresnel/contracts/records";
import type { EventsBatchParams } from "@fresnel/contracts/wire";
import { watchExtensionChanges } from "../../src/plugin-ui/watch.ts";
import { fakeConnection } from "../state/fake-connection.ts";
import { evt, thr } from "../state/helpers.ts";

const SUB = "s1";

function invalidated(keys: string[]) {
  return { keys, scopes: ["user" as const], threadId: null };
}

function batch(kinds: EventKind[]): EventsBatchParams {
  return {
    sub: SUB,
    from: 0,
    to: kinds.length,
    caughtUp: true,
    events: kinds.map((kind, index) => ({
      id: evt(index + 1),
      kind,
      version: 1,
      durable: true,
      seq: index + 1,
      parentId: null,
      threadId: thr(1),
      turnId: null,
      stepId: null,
      recordedAt: "2026-11-04T00:00:00.000Z",
      causationId: null,
      correlationId: "c",
      payload: {},
      redactions: [],
    })),
  };
}

describe("watchExtensionChanges", () => {
  test("extension and app policy settings, an unknown key list, and scope.changed ask for a re-read; other changes do not", () => {
    const fake = fakeConnection({});
    let heard = 0;
    const stop = watchExtensionChanges(fake.connection, () => {
      heard += 1;
    });
    fake.emit("settings.invalidated", invalidated(["ext.helm.enabled"]));
    fake.emit("settings.invalidated", invalidated(["x.ui.apps"]));
    fake.emit("settings.invalidated", invalidated([]));
    expect(heard).toBe(3);
    fake.emit("settings.invalidated", invalidated(["l1.models.default"]));
    fake.emit("events.batch", batch(["item.recorded"]));
    expect(heard).toBe(3);
    fake.emit("events.batch", batch(["item.recorded", "scope.changed"]));
    expect(heard).toBe(4);
    stop();
    fake.emit("settings.invalidated", invalidated([]));
    expect(heard).toBe(4);
  });
});
