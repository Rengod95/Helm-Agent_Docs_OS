import { describe, expect, test } from "bun:test";
import type { JsonObject } from "@fresnel/contracts/conversation";
import { sandboxBlocksOf } from "../../src/views/sandbox-block-model.ts";

// 엔진이 싣는 모양(L1.tools.spec §4.12.3)을 값으로 확인한다. 화면은 이 목록을 한국어 글로 바꾼다.

describe("sandboxBlocksOf", () => {
  test("reads every listed block in order, keeping the domain or the path of each", () => {
    const details: JsonObject = {
      code: "sandbox.network_blocked",
      domain: "localhost",
      blocks: [
        { code: "sandbox.network_blocked", domain: "localhost" },
        { code: "sandbox.write_blocked", path: "/etc/hosts" },
        { code: "sandbox.read_blocked", path: "/Users/u/.npmrc" },
      ],
    };
    expect(sandboxBlocksOf(details)).toEqual([
      { code: "sandbox.network_blocked", domain: "localhost" },
      { code: "sandbox.write_blocked", path: "/etc/hosts" },
      { code: "sandbox.read_blocked", path: "/Users/u/.npmrc" },
    ]);
  });

  test("without a blocks list, the top-level code and target make one block", () => {
    expect(sandboxBlocksOf({ code: "sandbox.write_blocked", path: "/etc/hosts" })).toEqual([
      { code: "sandbox.write_blocked", path: "/etc/hosts" },
    ]);
    expect(sandboxBlocksOf({ code: "sandbox.network_blocked", domain: "a.test" })).toEqual([
      { code: "sandbox.network_blocked", domain: "a.test" },
    ]);
  });

  test("entries that do not read as a block are skipped", () => {
    const details: JsonObject = {
      code: "sandbox.write_blocked",
      blocks: [
        { code: "sandbox.write_blocked", path: 7 },
        { code: "exit_nonzero", path: "/x" },
        { code: "sandbox.read_blocked", path: "/home/u/.netrc" },
      ],
    };
    expect(sandboxBlocksOf(details)).toEqual([
      { code: "sandbox.read_blocked", path: "/home/u/.netrc" },
    ]);
  });

  test("when the list has nothing usable, the top-level target still makes one block", () => {
    expect(
      sandboxBlocksOf({
        code: "sandbox.network_blocked",
        domain: "localhost",
        blocks: [{ code: "sandbox.network_blocked" }],
      }),
    ).toEqual([{ code: "sandbox.network_blocked", domain: "localhost" }]);
  });

  test("another code, a missing target, or no details is not a sandbox block", () => {
    expect(sandboxBlocksOf({ code: "exit_nonzero", detail: { exitCode: 7 } })).toEqual([]);
    expect(sandboxBlocksOf({ code: "denied_by_extension", outcome: "blocked" })).toEqual([]);
    expect(sandboxBlocksOf({ code: "sandbox.network_blocked" })).toEqual([]);
    expect(sandboxBlocksOf({ code: "sandbox.write_blocked", path: 3 })).toEqual([]);
    expect(sandboxBlocksOf(undefined)).toEqual([]);
    expect(sandboxBlocksOf(null)).toEqual([]);
    expect(sandboxBlocksOf(["sandbox.write_blocked"])).toEqual([]);
  });
});
