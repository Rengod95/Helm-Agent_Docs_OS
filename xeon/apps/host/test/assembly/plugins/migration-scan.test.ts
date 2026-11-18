// 훑기 자식의 띄우기와 응답 읽기(migration.md §7.4 [제안], host-service §4.25). 기한, 응답 상한, 크래시, 잘못된 응답, 격리 불가를
// 값으로 본다. 띄우기는 대역(`migration-scan-rig.ts`)이고, 자식 본체는 같은 프로세스에서 실제 코드를 돈다.
import { afterEach, expect, test } from "bun:test";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseJson } from "@fresnel/contracts";
import { scanRoots, type ScanRoot } from "@fresnel/plugin-migration";
import { createScanFs } from "../../../src/assembly/plugins/migration-fs.ts";
import {
  createMigrationScanner,
  SCAN_DEADLINE_MS,
  SCAN_REPLY_MAX_BYTES,
  type ScanRunInput,
} from "../../../src/assembly/plugins/migration-scan-child.ts";
import { SILENT } from "./intake-rig.ts";
import { fakeScanSource, type ChildContext } from "./migration-scan-rig.ts";
import { removeTree, tempRoot, writeFiles } from "./support.ts";

const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) removeTree(root);
});

const HOME = "/home/fixture";

function inputOf(
  roots: readonly ScanRoot[],
  progress: (done: number, total: number) => void = () => undefined,
): ScanRunInput {
  return { scanId: "scan-test-1", roots, homeDir: HOME, onProgress: progress };
}

/** 사용자 루트 하나의 목록 */
function oneRoot(path: string): ScanRoot[] {
  return [{ path, scope: "user", label: "홈" }];
}

/** 홈과 프로젝트 두 폴더. 스킬 폴더에는 바이트가 든 파일이 있다 */
function folders(): { readonly home: string; readonly proj: string } {
  const root = tempRoot("migration-scan-unit-");
  created.push(root);
  const home = join(root, "home");
  const proj = join(root, "proj");
  writeFiles(home, {
    ".claude/CLAUDE.md": "항상 한국어로 답한다\n",
    ".claude.json": JSON.stringify({
      mcpServers: {
        sentry: { command: "npx", args: ["sentry-mcp"], env: { SENTRY_TOKEN: "sk-test-ZZZZ9876" } },
      },
    }),
  });
  writeFiles(proj, {
    ".agents/skills/deploy/SKILL.md": "---\nname: deploy\ndescription: 배포를 돕는다\n---\n본문\n",
    "CLAUDE.md": "프로젝트 지침\n",
  });
  writeFileSync(join(proj, ".agents/skills/deploy/logo.bin"), new Uint8Array([0, 255, 1, 128]));
  return { home: realpathSync(home), proj: realpathSync(proj) };
}

/** 줄 하나. 끝에 줄바꿈을 붙인다 */
function lineOf(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

const EMPTY_OK = {
  kind: "ok",
  limitReached: false,
  scan: { scanned: [], items: [], diagnostics: [] },
};

test("the reply's items equal what the library scan returns in-process, bytes included, and progress comes one line per root", async () => {
  const { home, proj } = folders();
  const roots: ScanRoot[] = [
    { path: home, scope: "user", label: "홈" },
    { path: proj, scope: "project", label: "fresnel-proj" },
  ];
  const fake = fakeScanSource();
  const scanner = createMigrationScanner(fake.source, SILENT);
  const progress: [number, number][] = [];
  const outcome = await scanner.run(inputOf(roots, (done, total) => progress.push([done, total])));
  if (!outcome.ok) throw new Error(`the scan failed: ${outcome.error}`);

  const direct = await scanRoots({
    roots,
    fs: createScanFs([home, proj]).fs,
    ctx: { homeDir: HOME },
  });
  expect(outcome.value.items).toEqual(direct.items);
  expect(outcome.value.scanned).toEqual(direct.scanned);
  expect(outcome.value.diagnostics).toEqual(direct.diagnostics);
  expect(outcome.value.limitReached).toBe(false);
  expect(progress).toEqual([
    [1, 2],
    [2, 2],
  ]);
  // 바이트는 `Uint8Array`로 돌아와 값이 같다
  const skill = outcome.value.items.find((item) => item.ir.kind === "skill");
  expect(
    skill?.ir.kind === "skill" ? skill.ir.files.map((file) => Array.from(file.bytes)) : [],
  ).toContainEqual([0, 255, 1, 128]);
  expect(fake.spawns).toHaveLength(1);
});

test("the request line names each root by its canonical path, scope and label, with the home folder", async () => {
  const { home, proj } = folders();
  const requests: string[] = [];
  const fake = fakeScanSource({
    behavior: (child) => {
      requests.push(child.request);
      child.exit(1, null);
    },
  });
  await createMigrationScanner(fake.source, SILENT).run(
    inputOf([
      { path: home, scope: "user", label: "홈" },
      { path: proj, scope: "project", label: "fresnel-proj" },
    ]),
  );
  expect(requests).toHaveLength(1);
  expect(parseJson(requests.join(""))).toEqual({
    ok: true,
    value: {
      roots: [
        { path: home, scope: "user", label: "홈" },
        { path: proj, scope: "project", label: "fresnel-proj" },
      ],
      homeDir: HOME,
    },
  });
});

test("the child is spawned with the engine's own command, the first root as its folder, the others as readable roots, and no environment", async () => {
  const { home, proj } = folders();
  const fake = fakeScanSource();
  const outcome = await createMigrationScanner(fake.source, SILENT).run(
    inputOf([
      { path: home, scope: "user", label: "홈" },
      { path: proj, scope: "project", label: "fresnel-proj" },
    ]),
  );
  expect(outcome.ok).toBe(true);
  expect(fake.spawns.map((record) => record.spec)).toEqual([
    {
      // 소스 실행이라 진입 파일이 앞에 붙고, 소스 작업 공간(진입 파일에서 올라가며 찾은 폴더)도 읽는다
      command: "/usr/bin/false",
      args: ["/fake/main.ts", "migration-scan", "--stdio"],
      readRoot: home,
      runtimeReadRoots: [proj, "/fake"],
      env: {},
      label: "migration-scan:scan-test-1",
    },
  ]);
});

test("no root means no child at all: the scan answers an empty reply", async () => {
  const fake = fakeScanSource();
  const outcome = await createMigrationScanner(fake.source, SILENT).run(inputOf([]));
  expect(outcome).toEqual({
    ok: true,
    value: { limitReached: false, scanned: [], items: [], diagnostics: [] },
  });
  expect(fake.spawns).toEqual([]);
});

test("a folder that cannot be run under the sandbox is refused as unavailable, and no child is spawned", async () => {
  const { home } = folders();
  const cases = [
    { name: "the sandbox is off", options: { sandbox: "unavailable" as const } },
    { name: "there is no sandbox service", options: { sandbox: "missing" as const } },
    { name: "there is no process port", options: { withPort: false } },
    {
      name: "the port refuses the spawn",
      options: {
        spawnError: { kind: "sandbox_unavailable" as const, reason: "missing_dependency" },
      },
    },
  ];
  await Promise.all(
    cases.map(async (item) => {
      const fake = fakeScanSource(item.options);
      const outcome = await createMigrationScanner(fake.source, SILENT).run(inputOf(oneRoot(home)));
      expect({ case: item.name, outcome }).toEqual({
        case: item.name,
        outcome: { ok: false, error: "unavailable" },
      });
      expect(fake.spawns).toEqual([]);
    }),
  );
});

test("a child that never answers is killed with SIGKILL at the deadline, and its outcome is a timeout", async () => {
  const { home } = folders();
  const started = Promise.withResolvers<void>();
  const fake = fakeScanSource({
    behavior: () => {
      // 기한을 세는 타이머는 이 시점에 이미 걸려 있다(요청을 쓰기 전에 건다)
      started.resolve();
    },
  });
  const running = createMigrationScanner(fake.source, SILENT).run(inputOf(oneRoot(home)));
  await started.promise;
  fake.scheduler.advance(SCAN_DEADLINE_MS);
  expect(await running).toEqual({ ok: false, error: "timeout" });
  expect(fake.spawns.map((record) => record.kills)).toEqual([["SIGKILL"]]);
});

test("a child that exits without a reply is a bad reply when the code is 0, and crashed otherwise or on a signal", async () => {
  const { home } = folders();
  const cases: readonly {
    readonly name: string;
    readonly code: number | null;
    readonly signal: string | null;
    readonly expected: "bad_reply" | "crashed";
  }[] = [
    { name: "a clean exit with no reply", code: 0, signal: null, expected: "bad_reply" },
    { name: "a failing exit with no reply", code: 1, signal: null, expected: "crashed" },
    { name: "a signal with no reply", code: null, signal: "SIGSEGV", expected: "crashed" },
  ];
  await Promise.all(
    cases.map(async (item) => {
      const fake = fakeScanSource({
        behavior: (child: ChildContext) => {
          child.exit(item.code, item.signal);
        },
      });
      const outcome = await createMigrationScanner(fake.source, SILENT).run(inputOf(oneRoot(home)));
      expect({ case: item.name, outcome }).toEqual({
        case: item.name,
        outcome: { ok: false, error: item.expected },
      });
    }),
  );
});

test("a child that reports its own failure is crashed, and the error line carries only the short code", async () => {
  const { home } = folders();
  const fake = fakeScanSource({
    behavior: (child) => {
      child.write(lineOf({ kind: "error", code: "scan_failed" }));
      child.exit(1, null);
    },
  });
  const outcome = await createMigrationScanner(fake.source, SILENT).run(inputOf(oneRoot(home)));
  expect(outcome).toEqual({ ok: false, error: "crashed" });
});

test("a line that is not JSON, or that does not match the reply shape, is a bad reply and the child is killed", async () => {
  const { home } = folders();
  const badLines = [
    "이건 JSON이 아니다\n",
    lineOf({ kind: "ok" }),
    lineOf({ kind: "progress", done: -1, total: 1 }),
  ];
  await Promise.all(
    badLines.map(async (text) => {
      const fake = fakeScanSource({
        behavior: (child) => {
          child.write(text);
        },
      });
      const outcome = await createMigrationScanner(fake.source, SILENT).run(inputOf(oneRoot(home)));
      expect({ line: text, outcome }).toEqual({
        line: text,
        outcome: { ok: false, error: "bad_reply" },
      });
      expect(fake.spawns.map((record) => record.kills)).toEqual([["SIGKILL"]]);
    }),
  );
});

test("a reply over the size cap is a bad reply and the child is killed; the same reply under the cap is read", async () => {
  const { home } = folders();
  const small = createMigrationScanner(fakeScanSource().source, SILENT, { replyMaxBytes: 100 });
  const over = await small.run(inputOf(oneRoot(home)));
  expect(over.ok).toBe(false);
  expect(over.ok ? undefined : over.error).toBe("bad_reply");

  const roomy = createMigrationScanner(fakeScanSource().source, SILENT, {
    replyMaxBytes: SCAN_REPLY_MAX_BYTES,
  });
  const under = await roomy.run(inputOf(oneRoot(home)));
  expect(under.ok).toBe(true);
});

test("a reply split across several chunks is read as one line, and bytes after the final line are ignored", async () => {
  const { home } = folders();
  const line = lineOf(EMPTY_OK);
  const fake = fakeScanSource({
    behavior: (child) => {
      child.write(line.slice(0, 10));
      child.write(line.slice(10, 30));
      child.write(`${line.slice(30)}이건 무시된다\n`);
      child.exit(0, null);
    },
  });
  const outcome = await createMigrationScanner(fake.source, SILENT).run(inputOf(oneRoot(home)));
  expect(outcome).toEqual({
    ok: true,
    value: { limitReached: false, scanned: [], items: [], diagnostics: [] },
  });
});

test("the child's limit flag comes through, so the service can refuse the scan as over the limit", async () => {
  const { home } = folders();
  const fake = fakeScanSource({
    behavior: (child) => {
      child.write(lineOf({ ...EMPTY_OK, limitReached: true }));
      child.exit(0, null);
    },
  });
  const outcome = await createMigrationScanner(fake.source, SILENT).run(inputOf(oneRoot(home)));
  expect(outcome.ok && outcome.value.limitReached).toBe(true);
});
