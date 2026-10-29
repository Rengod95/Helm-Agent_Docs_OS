import { expect, test } from "bun:test";
import { emptyUsageSource } from "../../src/assembly/usage.ts";

// M3-REQ-15: 조립 기본 사용량 원천은 게이지가 없다. 레이트 리밋과 계정 풀은 B2-MDL이 원천을 채울 때까지 빈 목록이다.

test("the assembly default usage source has no gauges for any input", async () => {
  const source = emptyUsageSource();
  const signal = new AbortController().signal;
  expect(await source.gauges({}, signal)).toEqual([]);
  expect(await source.gauges({ providerId: "anthropic" }, signal)).toEqual([]);
});
