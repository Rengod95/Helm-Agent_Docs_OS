import { afterEach, expect, test } from "bun:test";
import { EXIT } from "../src/exit-codes.ts";
import { createMemoryGroupFs, filesUnder, type MemoryGroupFs } from "./support/group-fs.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// `xeon group new`(L4.cli.spec §3.1, L3.slots.spec §3.3.6 R1~R6). 파일 작업은 메모리 가짜가 맡는다.
// 실제 templates/ 와 실제 파일 시스템은 group-new-core-diff.test.ts가 본다.

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const CWD = "/work/project";

const INDEX = JSON.stringify({
  schemaVersion: 1,
  templates: {
    drive: {
      description: "구동 그룹",
      files: [
        "common/package.json",
        "common/README.md",
        "drive/.xeon-plugin/plugin.json",
        "drive/src/index.ts",
        "drive/test/unit.test.ts",
      ],
      usesDrive: true,
    },
    policy: {
      description: "정책 그룹",
      files: [
        "common/package.json",
        "common/README.md",
        "policy/.xeon-plugin/plugin.json",
        "policy/src/index.ts",
      ],
      usesDrive: false,
    },
    observe: {
      description: "관찰 그룹",
      files: [
        "common/package.json",
        "common/README.md",
        "observe/.xeon-plugin/plugin.json",
        "observe/src/__ID__.ts",
        "observe/test/unit.test.ts",
      ],
      usesDrive: false,
    },
  },
});

const OBSERVE_MANIFEST = `{
  "schemaVersion": 1,
  "name": "__ID__",
  "version": "__VERSION__",
  "displayName": "__TITLE__",
  "layer": "L3",
  "kind": "group",
  "entry": "./src/index.ts",
  "points": ["boundary.settle.after"],
  "usesDrive": false,
  "defaultEnabled": false,
  "recordKinds": [
    {
      "kind": "grp.__ID__.turn.counted",
      "version": 1,
      "description": "턴이 정착할 때마다 세는 계수 기록",
      "payload": {}
    }
  ],
  "trust": { "level": "user" }
}
`;

const DRIVE_MANIFEST = `{
  "schemaVersion": 1,
  "name": "__ID__",
  "version": "__VERSION__",
  "displayName": "__TITLE__",
  "layer": "L3",
  "kind": "group",
  "entry": "./src/index.ts",
  "points": ["boundary.settle.after"],
  "usesDrive": true,
  "defaultEnabled": false,
  "trust": { "level": "user" }
}
`;

const POLICY_MANIFEST = `{
  "schemaVersion": 1,
  "name": "__ID__",
  "version": "__VERSION__",
  "displayName": "__TITLE__",
  "layer": "L3",
  "kind": "group",
  "entry": "./src/index.ts",
  "points": ["tool.call.before"],
  "usesDrive": false,
  "defaultEnabled": false,
  "trust": { "level": "user" }
}
`;

const TEMPLATES: Readonly<Record<string, string>> = {
  "common/package.json": `{ "name": "@xeon/group-__ID__", "version": "__VERSION__" }\n`,
  "common/README.md": `# __TITLE__\n`,
  "drive/.xeon-plugin/plugin.json": DRIVE_MANIFEST,
  "drive/src/index.ts": `// __ID__\n`,
  "drive/test/unit.test.ts": `// __ID__ test\n`,
  "policy/.xeon-plugin/plugin.json": POLICY_MANIFEST,
  "policy/src/index.ts": `// __ID__\n`,
  "observe/.xeon-plugin/plugin.json": OBSERVE_MANIFEST,
  "observe/src/__ID__.ts": `// __ID__\n`,
  "observe/test/unit.test.ts": `// __ID__ test\n`,
};

function harness(fake: MemoryGroupFs, options: Parameters<typeof createHarness>[0] = {}): Harness {
  const created = createHarness({
    env: { NO_COLOR: "1" },
    cwd: CWD,
    groupTemplates: fake.port,
    ...options,
  });
  harnesses.push(created);
  return created;
}

function templatesFake(
  overrides: Readonly<Record<string, string>> = {},
  installed: readonly string[] = [],
): MemoryGroupFs {
  return createMemoryGroupFs({
    index: INDEX,
    templates: { ...TEMPLATES, ...overrides },
    installed,
  });
}

test("group new without a flag makes an observe group in <cwd>/<name> with the observe files", async () => {
  const fake = templatesFake();
  const h = harness(fake);
  expect(await h.run(["group", "new", "focus-lens"])).toBe(EXIT.ok);
  expect(filesUnder(fake, "/work/project/focus-lens")).toEqual([
    ".xeon-plugin/plugin.json",
    "README.md",
    "package.json",
    "src/focus-lens.ts",
    "test/unit.test.ts",
  ]);
  expect(h.stderrText()).toBe("");
});

test("--drive and --policy pick exactly the files that index.json lists for that kind", async () => {
  const drive = templatesFake();
  expect(await harness(drive).run(["group", "new", "focus-lens", "--drive"])).toBe(EXIT.ok);
  expect(filesUnder(drive, "/work/project/focus-lens")).toEqual([
    ".xeon-plugin/plugin.json",
    "README.md",
    "package.json",
    "src/index.ts",
    "test/unit.test.ts",
  ]);

  const policy = templatesFake();
  expect(await harness(policy).run(["group", "new", "focus-lens", "--policy"])).toBe(EXIT.ok);
  expect(filesUnder(policy, "/work/project/focus-lens")).toEqual([
    ".xeon-plugin/plugin.json",
    "README.md",
    "package.json",
    "src/index.ts",
  ]);
});

test("placeholders are replaced in file contents and in file paths", async () => {
  const fake = templatesFake();
  await harness(fake).run(["group", "new", "focus-lens"]);
  expect(fake.files.get("/work/project/focus-lens/package.json")).toBe(
    `{ "name": "@xeon/group-focus-lens", "version": "0.1.0" }\n`,
  );
  expect(fake.files.get("/work/project/focus-lens/README.md")).toBe("# focus-lens\n");
  expect(fake.files.get("/work/project/focus-lens/src/focus-lens.ts")).toBe("// focus-lens\n");
});

test("the generated plugin.json text is exact for a fixed name and version", async () => {
  const fake = templatesFake();
  await harness(fake).run(["group", "new", "focus-lens"]);
  expect(fake.files.get("/work/project/focus-lens/.xeon-plugin/plugin.json")).toBe(`{
  "schemaVersion": 1,
  "name": "focus-lens",
  "version": "0.1.0",
  "displayName": "focus-lens",
  "layer": "L3",
  "kind": "group",
  "entry": "./src/index.ts",
  "points": ["boundary.settle.after"],
  "usesDrive": false,
  "defaultEnabled": false,
  "recordKinds": [
    {
      "kind": "grp.focus-lens.turn.counted",
      "version": 1,
      "description": "턴이 정착할 때마다 세는 계수 기록",
      "payload": {}
    }
  ],
  "trust": { "level": "user" }
}
`);
});

test("--drive and --policy together are a usage error and write nothing", async () => {
  const fake = templatesFake();
  const h = harness(fake);
  expect(await h.run(["group", "new", "focus-lens", "--drive", "--policy"])).toBe(EXIT.usage);
  expect(h.stderrText()).toBe(
    "xeon: --drive와 --policy는 함께 쓸 수 없다\n  해결: 둘 중 하나만 쓴다. 없으면 관찰 그룹(observe)을 만든다\n",
  );
  expect(fake.files.size).toBe(0);
  expect(fake.dirs.size).toBe(0);
});

test("names that break the rules are rejected as usage errors before anything is written", async () => {
  const cases: readonly (readonly [string, string])[] = [
    ["Focus", `xeon: "Focus"은 그룹 이름 형식에 맞지 않는다`],
    ["focus_lens", `xeon: "focus_lens"은 그룹 이름 형식에 맞지 않는다`],
    ["core", `xeon: "core"은 예약된 그룹 이름이다`],
    ["a", `xeon: "a"은 그룹 이름 형식에 맞지 않는다`],
    ["a".repeat(33), `xeon: "${"a".repeat(33)}"은 그룹 이름 형식에 맞지 않는다`],
  ];
  await Promise.all(
    cases.map(async ([name, firstLine]) => {
      const fake = templatesFake();
      const h = harness(fake);
      expect(await h.run(["group", "new", name])).toBe(EXIT.usage);
      expect(h.stderrText().split("\n")[0]).toBe(firstLine);
      expect(fake.files.size).toBe(0);
      expect(fake.dirs.size).toBe(0);
    }),
  );
});

test("the longest allowed name (32 characters) is accepted", async () => {
  const name = `a${"b".repeat(31)}`;
  const fake = templatesFake();
  expect(await harness(fake).run(["group", "new", name])).toBe(EXIT.ok);
  expect(fake.files.get(`/work/project/${name}/package.json`)).toBe(
    `{ "name": "@xeon/group-${name}", "version": "0.1.0" }\n`,
  );
});

test("a name that clashes with an installed extension is refused and nothing is written", async () => {
  const fake = templatesFake({}, ["helm", "learning"]);
  const h = harness(fake);
  expect(await h.run(["group", "new", "helm"])).toBe(EXIT.usage);
  expect(h.stderrText()).toBe(
    `xeon: "helm"은 설치된 확장 이름과 겹친다\n  해결: 다른 이름을 고른다\n`,
  );
  expect(fake.files.size).toBe(0);
  expect(fake.dirs.size).toBe(0);
});

test("a target directory that is not empty is refused and its contents stay untouched", async () => {
  const fake = templatesFake();
  fake.dirs.add("/work/project/focus-lens");
  fake.files.set("/work/project/focus-lens/keep.txt", "keep");
  const before = new Map(fake.files);
  const h = harness(fake);
  expect(await h.run(["group", "new", "focus-lens"])).toBe(EXIT.usage);
  expect(h.stderrText()).toBe(
    "xeon: 대상 폴더가 비어 있지 않다: /work/project/focus-lens\n  해결: 빈 폴더를 주거나 --dir로 다른 폴더를 고른다\n",
  );
  expect(fake.files).toEqual(before);
});

test("an existing empty target directory is allowed and kept as the root", async () => {
  const fake = templatesFake();
  fake.dirs.add("/work/project/focus-lens");
  expect(await harness(fake).run(["group", "new", "focus-lens"])).toBe(EXIT.ok);
  expect(filesUnder(fake, "/work/project/focus-lens")).toHaveLength(5);
  expect(fake.dirs.has("/work/project/focus-lens")).toBe(true);
});

test("--dir sets the target folder, relative to the working folder", async () => {
  const fake = templatesFake();
  expect(await harness(fake).run(["group", "new", "focus-lens", "--dir", "packages/focus"])).toBe(
    EXIT.ok,
  );
  expect(filesUnder(fake, "/work/project/packages/focus")).toHaveLength(5);
  expect(filesUnder(fake, "/work/project/focus-lens")).toEqual([]);
});

test("a manifest that fails validateManifest leaves no files behind and exits as a usage error (R4)", async () => {
  const broken = OBSERVE_MANIFEST.replace(
    `"points": ["boundary.settle.after"]`,
    `"points": ["no.such.point"]`,
  );
  const fake = templatesFake({ "observe/.xeon-plugin/plugin.json": broken });
  const h = harness(fake);
  expect(await h.run(["group", "new", "focus-lens"])).toBe(EXIT.usage);
  expect(h.stderrText().split("\n")[0]).toMatch(
    /^xeon: 생성한 \.xeon-plugin\/plugin\.json이 검사를 통과하지 못했다: \/points\/0 /,
  );
  expect(fake.files.size).toBe(0);
  expect(fake.dirs.size).toBe(0);
});

test("a failed write removes what was already written (R3, rollback)", async () => {
  const fake = createMemoryGroupFs({
    index: INDEX,
    templates: TEMPLATES,
    failWriteAt: "README.md",
  });
  const h = harness(fake);
  expect(await h.run(["group", "new", "focus-lens"])).toBe(EXIT.environment);
  expect(h.stderrText().split("\n")[0]).toBe(
    "xeon: /work/project/focus-lens/README.md을 읽거나 쓰지 못했다: disk full (fixture)",
  );
  expect(fake.files.size).toBe(0);
  expect(fake.dirs.size).toBe(0);
});

test("a missing template index is an environment error and writes nothing", async () => {
  const fake = createMemoryGroupFs({});
  const h = harness(fake);
  expect(await h.run(["group", "new", "focus-lens"])).toBe(EXIT.environment);
  expect(h.stderrText().split("\n")[0]).toBe(
    "xeon: templates/index.json을 읽거나 쓰지 못했다: no index in this fixture",
  );
  expect(fake.files.size).toBe(0);
});

test("template code is never run: the generated source is only copied", async () => {
  const marker = `globalThis.xeonGroupTemplateRan = true;\n`;
  const fake = templatesFake({ "observe/src/__ID__.ts": marker });
  expect(await harness(fake).run(["group", "new", "focus-lens"])).toBe(EXIT.ok);
  expect(fake.files.get("/work/project/focus-lens/src/focus-lens.ts")).toBe(marker);
  expect("xeonGroupTemplateRan" in globalThis).toBe(false);
});

test("--json prints the name, template, folder and file list", async () => {
  const h = harness(templatesFake());
  expect(await h.run(["group", "new", "focus-lens", "--policy", "--json"])).toBe(EXIT.ok);
  expect(JSON.parse(h.stdoutText())).toEqual({
    name: "focus-lens",
    template: "policy",
    dir: "/work/project/focus-lens",
    files: ["package.json", "README.md", ".xeon-plugin/plugin.json", "src/index.ts"],
  });
});

test("the text output lists the files and the next steps, and does not install anything", async () => {
  const h = harness(templatesFake());
  expect(await h.run(["group", "new", "focus-lens"])).toBe(EXIT.ok);
  expect(h.stdoutText().split("\n")).toEqual([
    "그룹 focus-lens을 만들었다: /work/project/focus-lens (observe, 파일 5개)",
    "  package.json",
    "  README.md",
    "  .xeon-plugin/plugin.json",
    "  src/focus-lens.ts",
    "  test/unit.test.ts",
    "다음 단계",
    "  cd /work/project/focus-lens",
    "  bun install   의존을 설치한다. 생성 명령은 의존을 적거나 설치하지 않는다",
    "  bun test      생성된 시험을 돌린다",
    "",
  ]);
});

test("malformed group commands are usage errors", async () => {
  const cases: readonly (readonly [readonly string[], string])[] = [
    [["group"], "xeon: group에는 하위 명령이 필요하다"],
    [["group", "new"], "xeon: group new에는 그룹 이름이 필요하다"],
    [["group", "new", "a-one", "b-two"], "xeon: group new에 인자가 너무 많다"],
    [["group", "new", "focus-lens", "--dir", ""], "xeon: --dir에 폴더가 없다"],
    [["group", "frob"], "xeon: 모르는 명령 group frob"],
  ];
  await Promise.all(
    cases.map(async ([argv, firstLine]) => {
      const fake = templatesFake();
      const h = harness(fake);
      expect(await h.run(argv)).toBe(EXIT.usage);
      expect(h.stderrText().split("\n")[0]).toBe(firstLine);
      expect(fake.files.size).toBe(0);
    }),
  );
});

test("the help overview lists group new", async () => {
  const h = harness(templatesFake());
  expect(await h.run(["--help"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toContain(
    "  group new <이름> [--drive|--policy] [--dir <폴더>] [--json]\n",
  );
});
