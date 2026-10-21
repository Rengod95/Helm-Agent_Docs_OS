import { describe, expect, test } from "bun:test";
import {
  BLOCKED_NETWORK,
  toSrtFileConfig,
  toSrtGlobalConfig,
  validationCandidate,
} from "../src/policy.ts";
import { createSrtPort } from "../src/srt.ts";

// 실제 srt 스키마(0.0.79)에 변환 결과를 대 본다. srt를 초기화하거나 프로세스를 띄우지 않는다.
describe("srt schema accepts converted config", () => {
  const srt = createSrtPort();

  test("global config with and without helper paths", () => {
    expect(srt.validateConfig(toSrtGlobalConfig({}, BLOCKED_NETWORK))).toEqual([]);
    expect(
      srt.validateConfig(
        toSrtGlobalConfig(
          {
            bwrapPath: "/usr/bin/bwrap",
            socatPath: "/usr/bin/socat",
            ripgrepCommand: "/usr/bin/rg",
          },
          BLOCKED_NETWORK,
        ),
      ),
    ).toEqual([]);
  });

  test("per-command file policy merged with the global config", () => {
    const custom = toSrtFileConfig({
      writeRoots: ["/w", "/w/with*star"],
      readDeny: ["/home/u/.ssh", "/w/.env"],
      writeDeny: ["/home/u/.ssh", "/w/.git/hooks", "/w/.env"],
    });
    expect(srt.validateConfig(validationCandidate({}, custom))).toEqual([]);
  });

  test("the schema really rejects a malformed config", () => {
    expect(srt.validateConfig({ network: {}, filesystem: {} }).length).toBeGreaterThan(0);
  });
});
