import { describe, expect, test } from "bun:test";
import type { AutoAllowBlock, SandboxPolicy } from "@xeon/contracts/services";
import { decideAutoAllow } from "../src/auto-allow.ts";
import { createSandboxService } from "../src/service.ts";
import {
  fakeOs,
  fakeSrt,
  linuxPlatform,
  makeTestDirs,
  NO_CANCEL,
  recordingShell,
  settingsOf,
} from "./support/fakes.ts";

const WORKSPACE = "/work/project";
const TEMP = "/work/tmp";

function policy(overrides: Partial<SandboxPolicy> = {}): SandboxPolicy {
  return {
    writeRoots: [WORKSPACE],
    readDeny: [],
    writeDeny: [],
    network: { allowedDomains: [], deniedDomains: [] },
    allowEscape: false,
    ...overrides,
  };
}

describe("autoAllow decision table", () => {
  test("all 32 combinations of the five conditions give the expected decision and blocks", () => {
    for (let mask = 0; mask < 32; mask += 1) {
      const unavailable = (mask & 1) !== 0;
      const escape = (mask & 2) !== 0;
      const rootOutside = (mask & 4) !== 0;
      const cwdOutside = (mask & 8) !== 0;
      const network = (mask & 16) !== 0;
      const writeRoots = rootOutside ? ["/etc/elsewhere"] : [WORKSPACE];
      const cwd = cwdOutside ? "/var/other" : `${WORKSPACE}/src`;
      const decision = decideAutoAllow(
        policy({
          writeRoots,
          allowEscape: escape,
          network: { allowedDomains: network ? ["example.com"] : [], deniedDomains: [] },
        }),
        { cwd, workspaceRoots: [WORKSPACE], tempDir: TEMP },
        { available: !unavailable },
        [],
      );
      const expected: AutoAllowBlock[] = [];
      if (unavailable) expected.push("sandbox_unavailable");
      if (escape) expected.push("escape_requested");
      if (rootOutside) expected.push("write_root_outside");
      // 쓰기 루트가 밖이어도 cwd가 작업 공간 안이면 cwd 조건은 만족한다(위 cwd 값은 작업 공간 안이다)
      if (cwdOutside) expected.push("cwd_outside_write_roots");
      if (network) expected.push("network_outside_default");
      if (expected.length === 0) expect(decision).toEqual({ allow: true });
      else expect(decision).toEqual({ allow: false, blocks: expected });
    }
  });

  test("path comparison is by segment, not by string prefix", () => {
    const decision = decideAutoAllow(
      policy({ writeRoots: ["/work/project-evil"] }),
      { cwd: "/work/project-evil", workspaceRoots: [WORKSPACE], tempDir: TEMP },
      { available: true },
      [],
    );
    // cwd는 쓰기 루트 안이라 cwd 조건은 만족한다. 쓰기 루트가 작업 공간 밖인 것만 걸린다
    expect(decision).toEqual({ allow: false, blocks: ["write_root_outside"] });
  });

  test("the temp directory is an allowed write root", () => {
    const decision = decideAutoAllow(
      policy({ writeRoots: [WORKSPACE, TEMP] }),
      { cwd: TEMP, workspaceRoots: [WORKSPACE], tempDir: TEMP },
      { available: true },
      [],
    );
    expect(decision).toEqual({ allow: true });
  });

  test("a relative cwd is never inside", () => {
    const decision = decideAutoAllow(
      policy(),
      { cwd: "src", workspaceRoots: [WORKSPACE], tempDir: TEMP },
      { available: true },
      [],
    );
    expect(decision).toEqual({ allow: false, blocks: ["cwd_outside_write_roots"] });
  });

  test("denied domains do not matter, a subset of the default allow-list does not block", () => {
    const decision = decideAutoAllow(
      policy({ network: { allowedDomains: ["a.example"], deniedDomains: ["b.example"] } }),
      { cwd: WORKSPACE, workspaceRoots: [WORKSPACE], tempDir: TEMP },
      { available: true },
      ["a.example", "c.example"],
    );
    expect(decision).toEqual({ allow: true });
  });
});

describe("autoAllow never allows escape", () => {
  test("escapeRetry true still blocks allowEscape calls with escape_requested", async () => {
    const dirs = makeTestDirs();
    const service = await createSandboxService(
      {
        os: fakeOs(dirs),
        settings: () => settingsOf({ escapeRetry: true }),
        srt: fakeSrt(),
        platform: linuxPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    expect(service.status().available).toBe(true);
    const escaping = {
      ...service.defaultPolicy({ workspaceRoots: [dirs.workspace], tempDir: dirs.tmp }),
      allowEscape: true,
    };
    const decision = service.autoAllow(escaping, {
      command: "ls",
      cwd: dirs.workspace,
      workspaceRoots: [dirs.workspace],
      tempDir: dirs.tmp,
    });
    expect(decision).toEqual({ allow: false, blocks: ["escape_requested"] });
    const normal = service.autoAllow(
      service.defaultPolicy({ workspaceRoots: [dirs.workspace], tempDir: dirs.tmp }),
      { command: ["ls"], cwd: dirs.workspace, workspaceRoots: [dirs.workspace], tempDir: dirs.tmp },
    );
    expect(normal).toEqual({ allow: true });
    // 샌드박스 밖 재시도 허용 설정이 있어도 격리된 호출의 실행 경로는 그대로다
    const shell = recordingShell();
    const result = await service
      .wrapShell(shell, escaping)
      .exec("ls", { cwd: dirs.workspace }, NO_CANCEL);
    expect(result.ok && result.value.sandbox?.unsandboxedBy).toBe("escape");
  });
});
