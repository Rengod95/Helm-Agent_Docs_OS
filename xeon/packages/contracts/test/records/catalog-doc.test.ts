import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_EVENT_CATALOG } from "../../src/records/index.ts";

// F.records.spec §3.3 표(<!-- catalog:start --> ~ <!-- catalog:end -->)와 CORE_EVENT_CATALOG를 대조한다.
// xeon/scripts/check-event-catalog.ts가 같은 일을 just verify에서 한다. 문서가 보이지 않는 곳(패키지만 복사된 경우)에서는 건너뛴다.
const SPEC = join(import.meta.dir, "../../../../../docs/xeon/F/records/spec.md");

describe("catalog doc table", () => {
  test.skipIf(!existsSync(SPEC))("kind and durable columns match the code", () => {
    const text = readFileSync(SPEC, "utf8");
    const start = text.indexOf("<!-- catalog:start -->");
    const end = text.indexOf("<!-- catalog:end -->");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const rows = text
      .slice(start, end)
      .split("\n")
      .map((line) => /^\| `([a-z_.]+)` \| (예|아니오) \|/.exec(line))
      .filter((match) => match !== null)
      .map((match) => ({ kind: match[1], durable: match[2] === "예" }));
    expect(rows).toEqual(CORE_EVENT_CATALOG.map((e) => ({ kind: e.kind, durable: e.durable })));
  });
});
