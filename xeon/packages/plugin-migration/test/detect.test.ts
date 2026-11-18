import { expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import {
  detectForeignFormats,
  FOREIGN_FORMAT_MARKERS,
  foreignFormatNotice,
} from "../src/detect.ts";
import type { ForeignFormatMarker, ScanFs } from "../src/types.ts";
import { memoryFs } from "./support.ts";

const HOME = "/home/test";
const ROOT = "/work/proj";

/** M5g-2 뒤의 `.agents/skills` 표지: 엔진은 읽지 않고, 예전에 읽던 자리라 "더는 읽지 않는" 자리다 */
function shared(marker: string): ForeignFormatMarker {
  return {
    marker,
    harness: "agent-skills",
    engineReads: false,
    stoppedReading: true,
    importable: true,
  };
}

/** 호출 수를 세는 래퍼. 감지는 `lstat`만 불러야 한다 */
function countingFs(base: ScanFs) {
  const calls = { lstat: 0, listDir: 0, readBounded: 0, realpath: 0 };
  const fs: ScanFs = {
    lstat: (path) => {
      calls.lstat += 1;
      return base.lstat(path);
    },
    listDir: (path) => {
      calls.listDir += 1;
      return base.listDir(path);
    },
    readBounded: (path, maxBytes) => {
      calls.readBounded += 1;
      return base.readBounded(path, maxBytes);
    },
    realpath: (path) => {
      calls.realpath += 1;
      return base.realpath(path);
    },
  };
  return { fs, calls };
}

test("a project .mcp.json is a marker the engine stopped reading: it is in willStopReading and importable", async () => {
  // M5g-2: 엔진은 `.mcp.json`을 읽지 않는다. 신호(표지)는 계속 나가고, 알림은 "더는 읽지 않는 자리"로 이 파일을 든다
  const fs = memoryFs({ "/work/proj/.mcp.json": "{}" });
  const markers = await detectForeignFormats({ fs, projectRoot: ROOT, homeDir: HOME });
  expect(markers).toEqual([
    {
      marker: ".mcp.json",
      harness: "claude-code",
      engineReads: false,
      stoppedReading: true,
      importable: true,
    },
  ]);
  expect(foreignFormatNotice(markers)).toEqual({
    code: "foreign_format_found",
    willStopReading: [".mcp.json"],
    importable: [".mcp.json"],
    importAvailable: true,
  });
});

test("shared skills are checked from the project up to /, nearest first, as relative paths", async () => {
  const fs = memoryFs({
    "/work/proj/.agents/skills/deploy/SKILL.md": "x",
    "/work/.agents/skills/review/SKILL.md": "x",
    "/.agents/skills/lint/SKILL.md": "x",
  });
  const markers = await detectForeignFormats({ fs, projectRoot: ROOT, homeDir: HOME });
  expect(markers).toEqual([
    shared(".agents/skills"),
    shared("../.agents/skills"),
    shared("../../.agents/skills"),
  ]);
  expect(foreignFormatNotice(markers)?.willStopReading).toEqual([
    ".agents/skills",
    "../.agents/skills",
    "../../.agents/skills",
  ]);
});

test("the user's home skills are never counted, even when home is an ancestor or the project root", async () => {
  // 홈이 상위 폴더일 때는 빠진다
  const underHome = memoryFs({
    "/home/test/work/.agents/skills/a/SKILL.md": "x",
    "/home/test/.agents/skills/b/SKILL.md": "x",
  });
  expect(
    await detectForeignFormats({
      fs: underHome,
      projectRoot: "/home/test/work/proj",
      homeDir: HOME,
    }),
  ).toEqual([shared("../.agents/skills")]);

  // 프로젝트 루트가 홈이면 그 자리도 빠진다
  const home = memoryFs({ "/home/test/.agents/skills/b/SKILL.md": "x" });
  expect(await detectForeignFormats({ fs: home, projectRoot: HOME, homeDir: HOME })).toEqual([]);

  // 홈이 아닌 같은 이름 폴더는 센다. 홈 바깥의 상위 폴더도 센다
  const other = memoryFs({ "/home/other/.agents/skills/x/SKILL.md": "x" });
  expect(
    await detectForeignFormats({ fs: other, projectRoot: "/home/other/proj", homeDir: HOME }),
  ).toEqual([shared("../.agents/skills")]);

  // 홈이 경로 위에 없으면 홈의 스킬은 확인 대상도 아니다
  const elsewhere = memoryFs({ "/home/test/.agents/skills/b/SKILL.md": "x" });
  expect(await detectForeignFormats({ fs: elsewhere, projectRoot: ROOT, homeDir: HOME })).toEqual(
    [],
  );
});

test("claude, instruction, and other-harness markers: engineReads is false and the notice lists importables", async () => {
  const fs = memoryFs({
    "/work/proj/CLAUDE.md": "# notes",
    "/work/proj/.claude/settings.json": "{}",
    "/work/proj/.cursor/rules/a.mdc": "x",
    "/work/proj/.roomodes": "{}",
  });
  const markers = await detectForeignFormats({ fs, projectRoot: ROOT, homeDir: HOME });
  expect(markers).toEqual([
    {
      marker: ".claude/",
      harness: "claude-code",
      engineReads: false,
      stoppedReading: false,
      importable: true,
    },
    {
      marker: "CLAUDE.md",
      harness: "claude-code",
      engineReads: false,
      stoppedReading: false,
      importable: true,
    },
    {
      marker: ".cursor/",
      harness: "other",
      engineReads: false,
      stoppedReading: false,
      importable: false,
    },
    {
      marker: ".roomodes",
      harness: "other",
      engineReads: false,
      stoppedReading: false,
      importable: false,
    },
  ]);
  expect(foreignFormatNotice(markers)).toEqual({
    code: "foreign_format_found",
    willStopReading: [],
    importable: [".claude/", "CLAUDE.md"],
    importAvailable: true,
  });
});

test("only non-importable markers: the notice exists but importing is not available", async () => {
  const fs = memoryFs({ "/work/proj/.cursor/rules/a.mdc": "x" });
  const markers = await detectForeignFormats({ fs, projectRoot: ROOT, homeDir: HOME });
  expect(foreignFormatNotice(markers)).toEqual({
    code: "foreign_format_found",
    willStopReading: [],
    importable: [],
    importAvailable: false,
  });
});

test("a plain file named .claude is not the .claude/ folder marker", async () => {
  const fs = memoryFs({ "/work/proj/.claude": "not a folder" });
  expect(await detectForeignFormats({ fs, projectRoot: ROOT, homeDir: HOME })).toEqual([]);
});

test("nothing found gives an empty list and no notice; markers in ancestors other than shared skills are not counted", async () => {
  const empty = memoryFs({ "/work/proj/src/index.ts": "x" });
  const markers = await detectForeignFormats({ fs: empty, projectRoot: ROOT, homeDir: HOME });
  expect(markers).toEqual([]);
  expect(foreignFormatNotice(markers)).toBeUndefined();

  // 프로젝트 루트 밖의 .mcp.json과 CLAUDE.md는 표지가 아니다
  const ancestor = memoryFs({ "/work/.mcp.json": "{}", "/work/CLAUDE.md": "x" });
  expect(await detectForeignFormats({ fs: ancestor, projectRoot: ROOT, homeDir: HOME })).toEqual(
    [],
  );
});

test("reading is never called: only lstat runs, and the result is still found", async () => {
  const base = memoryFs({
    "/work/proj/.mcp.json": '{"mcpServers":{}}',
    "/work/proj/.agents/skills/deploy/SKILL.md": "---\nname: deploy\n---\n",
    "/work/proj/CLAUDE.md": "# notes",
  });
  const { fs, calls } = countingFs(base);
  const markers = await detectForeignFormats({ fs, projectRoot: ROOT, homeDir: HOME });
  expect(markers.map((marker) => marker.marker)).toEqual([
    ".mcp.json",
    ".agents/skills",
    "CLAUDE.md",
  ]);
  expect(calls.readBounded).toBe(0);
  expect(calls.listDir).toBe(0);
  expect(calls.lstat).toBeGreaterThan(0);
});

test("the same input gives the same result every time", async () => {
  const fs = memoryFs({
    "/work/proj/CLAUDE.md": "x",
    "/work/proj/.mcp.json": "{}",
    "/work/.agents/skills/a/SKILL.md": "x",
  });
  const input = { fs, projectRoot: ROOT, homeDir: HOME };
  const first = await detectForeignFormats(input);
  const second = await detectForeignFormats(input);
  expect(second).toEqual(first);
  expect(JSON.stringify(second)).toBe(JSON.stringify(first));
});

test("a symlink counts as present, even when its target is missing or the link is broken", async () => {
  const fs = memoryFs({
    "/work/proj/.mcp.json": { symlinkTo: "/elsewhere/mcp.json" },
    "/work/proj/CLAUDE.md": { symlinkTo: "/nowhere" },
    "/work/proj/.claude": { symlinkTo: "/work/dotclaude" },
  });
  expect(
    (await detectForeignFormats({ fs, projectRoot: ROOT, homeDir: HOME })).map(
      (marker) => marker.marker,
    ),
  ).toEqual([".mcp.json", ".claude/", "CLAUDE.md"]);
});

test("the walk up to the filesystem root ends, at / and from a deep project", async () => {
  const atRoot = memoryFs({ "/.agents/skills/a/SKILL.md": "x" });
  expect(await detectForeignFormats({ fs: atRoot, projectRoot: "/", homeDir: HOME })).toEqual([
    shared(".agents/skills"),
  ]);

  // 깊은 프로젝트에서 루트까지 7단계 올라가 찾는다
  const deep = memoryFs({ "/.agents/skills/a/SKILL.md": "x" });
  expect(
    await detectForeignFormats({ fs: deep, projectRoot: "/a/b/c/d/e/f/g", homeDir: HOME }),
  ).toEqual([shared("../../../../../../../.agents/skills")]);

  // 아무것도 없어도 끝난다(루프가 멈추지 않으면 시험이 멈춘다)
  expect(
    await detectForeignFormats({ fs: memoryFs({}), projectRoot: "/a/b/c/d/e/f/g", homeDir: HOME }),
  ).toEqual([]);
});

test("the marker table lists the section 6.1 markers in order; no marker is engine-read after M5g-2, two stopped reading", () => {
  expect(FOREIGN_FORMAT_MARKERS.map((marker) => marker.marker)).toEqual([
    ".mcp.json",
    ".agents/skills",
    ".claude/",
    "CLAUDE.md",
    "CLAUDE.local.md",
    ".cursor/",
    ".cursorrules",
    ".codex/",
    ".gemini/",
    "GEMINI.md",
    ".opencode/",
    ".pi/",
    ".clinerules",
    ".cline/",
    ".roo/",
    ".roomodes",
    ".windsurfrules",
  ]);
  expect(
    FOREIGN_FORMAT_MARKERS.filter((marker) => marker.engineReads).map((marker) => marker.marker),
  ).toEqual([]);
  expect(
    FOREIGN_FORMAT_MARKERS.filter((marker) => marker.stoppedReading).map((marker) => marker.marker),
  ).toEqual([".mcp.json", ".agents/skills"]);
});

/** 거부된 값을 돌려준다. 거부하지 않고 끝나면 `undefined`다 */
function rejectionOf(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => undefined,
    (caught: unknown) => caught,
  );
}

test("a relative project root is a bug", async () => {
  const outcome = await rejectionOf(
    detectForeignFormats({ fs: memoryFs({}), projectRoot: "work/proj", homeDir: HOME }),
  );
  expect(outcome).toBeInstanceOf(Bug);
  expect(outcome).toMatchObject({ message: "detect.path_not_absolute" });
});

test("a failing lstat is passed on, not turned into 'absent'", async () => {
  const failure = new Error("EACCES");
  const failing: ScanFs = {
    ...memoryFs({}),
    lstat: () => Promise.reject(failure),
  };
  const outcome = await rejectionOf(
    detectForeignFormats({ fs: failing, projectRoot: ROOT, homeDir: HOME }),
  );
  expect(outcome).toBe(failure);
});
