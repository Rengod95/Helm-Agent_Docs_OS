import { describe, expect, test } from "bun:test";
import { memorySecrets } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";
import { httpCtx } from "./support/ctx.ts";
import { forms } from "./support/encode.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { metaOf } from "./support/meta.ts";
import { handleOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

// spec §9 3번: 가짜 값 S(무작위 24바이트)를 넣고 계층 다섯 개를 따로 확인한다.
// S의 형태: 원문, base64 표준·URL-safe·무패딩, URL 인코딩, hex, JSON 이스케이프, Basic 인증 형태 base64("user:" + S).

async function leasedService() {
  const clock = manualClock();
  const value = fakeValue(seededRandom(2026), 24, true);
  const service = memorySecrets({
    clock,
    scheduler: clock,
    ids: fixedLocalIds(),
    secrets: [{ meta: metaOf(), value }],
  });
  const lease = await service.lease(handleOf("github-token"), httpCtx());
  if (!lease.ok) throw new Error("setup failed");
  return { service, value, all: forms(value) };
}

describe("five redaction layers", () => {
  test("layer 1 human-input: mask on user text before it becomes an event", async () => {
    const { service, all } = await leasedService();
    for (const form of all) {
      const out = service.redactor.mask(`my note: ${form.text}, thanks`);
      expect(out.text).not.toContain(form.text);
      expect(out.hits.length).toBeGreaterThan(0);
    }
  });

  test("layer 2 tool-result: maskDeep on stdout, stderr and structured results", async () => {
    const { service, all } = await leasedService();
    for (const form of all) {
      const result = {
        stdout: `out ${form.text}`,
        stderr: [`err ${form.text}`],
        details: { nested: { line: form.text }, code: 0 },
      };
      const out = service.redactor.maskDeep(result);
      expect(JSON.stringify(out.value)).not.toContain(form.text);
      expect(out.value.details.code).toBe(0);
    }
  });

  test("layer 3 outbound: containsKnown rejects instead of rewriting", async () => {
    const { service, all } = await leasedService();
    for (const form of all) {
      expect(service.redactor.containsKnown(`search ${form.text} please`)).toBe(true);
    }
    expect(service.redactor.containsKnown("search for something else")).toBe(false);
  });

  test("layer 4 model-projection: maskDeep on projected messages", async () => {
    const { service, all } = await leasedService();
    for (const form of all) {
      const projection = [
        { role: "tool", content: [{ type: "text", text: `file says ${form.text}` }] },
        { role: "user", content: form.text },
      ];
      const out = service.redactor.maskDeep(projection);
      expect(JSON.stringify(out.value)).not.toContain(form.text);
    }
  });

  test("layer 5 ops-log: mask on every log line just before output", async () => {
    const { service, all } = await leasedService();
    for (const form of all) {
      const line = JSON.stringify({ event: "tool.finished", fields: { detail: form.text } });
      const out = service.redactor.mask(line);
      expect(out.text).not.toContain(form.text);
    }
  });
});

describe("values never reach errors or audit records", () => {
  test("denied errors and records carry no value", async () => {
    const clock = manualClock();
    const value = fakeValue(seededRandom(404), 24, true);
    const service = memorySecrets({
      clock,
      scheduler: clock,
      ids: fixedLocalIds(),
      secrets: [{ meta: metaOf({ ttlSeconds: 1 }), value }],
    });
    const records: unknown[] = [];
    service.onAudit((record) => records.push(record));
    const bad = await service.lease(
      handleOf("github-token"),
      httpCtx({ target: { kind: "host", host: "x.test", port: 443 } }),
    );
    const lease = await service.lease(handleOf("github-token"), httpCtx());
    if (!lease.ok) throw new Error("setup failed");
    clock.advance(2000);
    const late = await lease.value.use(() => 0);
    const dump = JSON.stringify({ bad, late, records, lease: lease.value });
    for (const form of forms(value)) expect(dump).not.toContain(form.text);
  });
});
