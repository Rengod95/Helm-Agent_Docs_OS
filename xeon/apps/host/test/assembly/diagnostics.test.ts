import { expect, test } from "bun:test";
import type { ExtDiagnostic } from "@xeon/ext-host";
import { createExtDiagnosticSink } from "../../src/assembly/diagnostics.ts";

// L0.os.spec §3.14, M3-REQ-52: 확장 진단 배열은 256개까지만 남기고, 넘친 만큼 버린 수를 센다.

function diagnosticOf(index: number): ExtDiagnostic {
  return { level: "warning", code: "handler_failed", message: `diagnostic ${String(index)}` };
}

test("pushing 300 diagnostics keeps the newest 256 and reports 44 dropped", () => {
  const sink = createExtDiagnosticSink();
  for (let index = 0; index < 300; index += 1) sink.push(diagnosticOf(index));
  const kept = sink.items().map((diagnostic) => diagnostic.message);
  expect(kept).toHaveLength(256);
  expect(kept[0]).toBe("diagnostic 44");
  expect(kept.at(-1)).toBe("diagnostic 299");
  expect(sink.dropped()).toBe(44);
});

test("below the cap nothing is dropped and the order is kept", () => {
  const sink = createExtDiagnosticSink();
  sink.push(diagnosticOf(1));
  sink.push(diagnosticOf(2));
  expect(sink.items().map((diagnostic) => diagnostic.message)).toEqual([
    "diagnostic 1",
    "diagnostic 2",
  ]);
  expect(sink.dropped()).toBe(0);
});
