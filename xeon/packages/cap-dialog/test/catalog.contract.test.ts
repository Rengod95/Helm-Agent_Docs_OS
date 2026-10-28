import { describe, expect, test } from "bun:test";
import { DIALOG_EVENT_CATALOG, TYPE_PREFIX_OWNERS } from "@xeon/contracts/records";

describe("카탈로그", () => {
  test("dialog.status는 휘발이고 dialog.notified는 내구이며 접두 소유자는 cap.dialog다", () => {
    const status = DIALOG_EVENT_CATALOG.find((entry) => entry.kind === "dialog.status");
    const notified = DIALOG_EVENT_CATALOG.find((entry) => entry.kind === "dialog.notified");
    expect(status).toMatchObject({ version: 1, durable: false });
    expect(notified).toMatchObject({ version: 1, durable: true });
    expect(TYPE_PREFIX_OWNERS["dialog."]).toBe("cap.dialog");
  });
});
