import { afterEach, describe, expect, test } from "bun:test";
import {
  type EngineProcess,
  HELLO,
  processesWithHome,
  resolveTimeoutMs,
  startEngine,
} from "./harness.ts";

// 엔진 시험 도구(harness.ts)의 단위 시험. 사이드카 바이너리가 필요 없어서 건너뛰지 않는다. 바이너리 시험의 건너뜀 규칙은
// sidecar.e2e.test.ts에만 있다.

describe("resolveTimeoutMs", () => {
  test("an explicit option wins over the environment", () => {
    expect(resolveTimeoutMs(200, { XEON_E2E_TIMEOUT_MS: "90000" })).toBe(200);
    expect(resolveTimeoutMs(200, {})).toBe(200);
  });

  test("without an option, a positive integer in XEON_E2E_TIMEOUT_MS is used", () => {
    expect(resolveTimeoutMs(undefined, { XEON_E2E_TIMEOUT_MS: "90000" })).toBe(90_000);
    expect(resolveTimeoutMs(undefined, { XEON_E2E_TIMEOUT_MS: " 1500 " })).toBe(1500);
  });

  test("without an option or a variable, the default is 60000", () => {
    expect(resolveTimeoutMs(undefined, {})).toBe(60_000);
  });

  for (const raw of ["0", "-5", "abc", "", "1.5", "1e3", "99999999999"]) {
    test(`an invalid XEON_E2E_TIMEOUT_MS (${JSON.stringify(raw)}) falls back to 60000`, () => {
      expect(resolveTimeoutMs(undefined, { XEON_E2E_TIMEOUT_MS: raw })).toBe(60_000);
    });
  }
});

describe("startEngine with a process that never answers", () => {
  const engines: EngineProcess[] = [];

  afterEach(async () => {
    await Promise.all(engines.splice(0).map((engine) => engine.dispose()));
  });

  test("the request is rejected at the limit, and dispose stops the process", async () => {
    // 표준 입력을 읽기만 하고 아무것도 쓰지 않는다. 요청에는 응답이 오지 않는다
    const engine = await startEngine([process.execPath, "-e", "process.stdin.resume()"], {
      timeoutMs: 200,
    });
    engines.push(engine);

    // 거부 이유를 값으로 받아 문장을 본다. 응답이 왔다면 "answered"가 되어 아래 검사가 실패한다
    const outcome = await engine.request("host.hello", HELLO).then(
      () => "answered",
      (error: unknown) => (error instanceof Error ? error.message : "not an Error"),
    );
    expect(outcome).toMatch(
      /^engine e2e: timed out waiting for host\.hello after \d+ ms \(limit 200 ms\)/,
    );

    // 시험이 실제로 살아 있는 프로세스를 상대했는지 확인한 뒤 정리한다
    const alive = processesWithHome(engine.home);
    if (alive !== null) expect(alive.length).toBeGreaterThan(0);
    // dispose가 거부하면 이 await가 던져 시험이 실패한다
    await engine.dispose();
    const left = processesWithHome(engine.home);
    if (left !== null) expect(left).toEqual([]);
  });
});
