import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import {
  createInstructionSections,
  nodeInstructionFs,
  type InstructionSections,
} from "../src/index.ts";

// M5c §4.4.7 시험. 임시 폴더 위에서 node:fs 포트로 읽는다. 값을 비교한다.

const threadId: ThreadId = fixedIdFactory().next("thr");

let scratch: string;
let outside: string[];

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "fresnel-instructions-"));
  outside = [];
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
  for (const dir of outside) rmSync(dir, { recursive: true, force: true });
});

/** 임시 폴더 하나를 더 만든다(루트 밖 대상용). 정리는 afterEach가 한다 */
function otherDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fresnel-instructions-outside-"));
  outside.push(dir);
  return dir;
}

/** 상대 경로에 파일을 쓴다. 폴더는 먼저 만든다 */
function put(relative: string, content: string | Uint8Array, base = scratch): string {
  const path = join(base, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  return path;
}

/** 시험에서 쓰는 정규 루트. 임시 폴더는 macOS에서 `/var`가 `/private/var`로 풀린다 */
function canonicalRoot(): string {
  return realpathSync(scratch);
}

function readSections(options: {
  readonly workspace: string | undefined;
  readonly root?: string;
  readonly maxBytes?: number;
}): Promise<InstructionSections> {
  const instructionSectionsOf = createInstructionSections({
    workspaceOf: () => options.workspace,
    ...(options.root === undefined ? {} : { projectRootOf: () => options.root }),
    maxBytes: () => options.maxBytes ?? 65_536,
    fs: nodeInstructionFs,
  });
  return instructionSectionsOf(threadId);
}

test("sections run from the root to the workspace, root first, with three nested folders", async () => {
  put("AGENTS.md", "root rules");
  put("a/AGENTS.md", "a rules");
  put("a/b/AGENTS.md", "a/b rules");
  put("a/b/c/AGENTS.md", "a/b/c rules");

  const result = await readSections({
    workspace: join(scratch, "a/b/c"),
    root: scratch,
  });

  expect(Object.keys(result.sections)).toEqual([
    "project:.",
    "project:a",
    "project:a/b",
    "project:a/b/c",
  ]);
  expect(Object.values(result.sections)).toEqual([
    "root rules",
    "a rules",
    "a/b rules",
    "a/b/c rules",
  ]);
  expect(result.diagnostics).toEqual([]);
});

test("a file's text is passed through exactly, with BOM, trailing spaces and blank lines", async () => {
  const exact = "﻿# 규칙\n\n- `code`  \n\n\n한국어 줄\r\n";
  put("AGENTS.md", exact);

  const result = await readSections({ workspace: scratch, root: scratch });

  expect(result.sections).toEqual({ "project:.": exact });
  expect(result.diagnostics).toEqual([]);
});

test("the root key is project:. and a nested workspace key is its relative path", async () => {
  put("AGENTS.md", "root");
  put("x/y/AGENTS.md", "xy");

  const result = await readSections({ workspace: join(scratch, "x/y"), root: scratch });

  expect(result.sections).toEqual({ "project:.": "root", "project:x/y": "xy" });
});

test("a folder without AGENTS.md is skipped silently and the rest still loads", async () => {
  put("AGENTS.md", "root");
  mkdirSync(join(scratch, "a/b"), { recursive: true });

  const result = await readSections({ workspace: join(scratch, "a/b"), root: scratch });

  expect(result.sections).toEqual({ "project:.": "root" });
  expect(result.diagnostics).toEqual([]);
});

test("a file over the byte limit is left out with only an instruction_too_large diagnostic", async () => {
  const root = canonicalRoot();
  put("AGENTS.md", "0123456789A"); // 11 bytes, over the limit of 10
  put("a/AGENTS.md", "0123456789"); // exactly 10 bytes, at the limit: included

  const result = await readSections({ workspace: join(scratch, "a"), root: scratch, maxBytes: 10 });

  expect(result.sections).toEqual({ "project:a": "0123456789" });
  expect(result.diagnostics).toEqual([
    {
      code: "instruction_too_large",
      path: join(root, "AGENTS.md"),
      bytes: 11,
      maxBytes: 10,
    },
  ]);
});

test("a symlink whose real path leaves the root is not read, and one that stays inside is", async () => {
  const root = canonicalRoot();
  const secret = put("secret.md", "secret", otherDir());
  symlinkSync(secret, join(scratch, "AGENTS.md"));
  put("shared.md", "shared");
  mkdirSync(join(scratch, "a"), { recursive: true });
  symlinkSync(join(scratch, "shared.md"), join(scratch, "a/AGENTS.md"));

  const result = await readSections({ workspace: join(scratch, "a"), root: scratch });

  expect(result.sections).toEqual({ "project:a": "shared" });
  expect(result.diagnostics).toEqual([
    { code: "instruction_outside_root", path: join(root, "AGENTS.md") },
  ]);
});

test("a file that cannot be read is skipped with an instruction_read_failed diagnostic", async () => {
  const root = canonicalRoot();
  // 디렉터리 이름이 AGENTS.md면 읽기가 실패한다(EISDIR). 권한 설정에 기대지 않는다
  mkdirSync(join(scratch, "AGENTS.md"));

  const result = await readSections({ workspace: scratch, root: scratch });

  expect(result.sections).toEqual({});
  expect(result.diagnostics).toEqual([
    { code: "instruction_read_failed", path: join(root, "AGENTS.md"), detail: expect.any(String) },
  ]);
});

test("bytes that are not UTF-8 are a read failure, not a silent replacement", async () => {
  const root = canonicalRoot();
  put("AGENTS.md", new Uint8Array([0xff, 0xfe, 0x41]));

  const result = await readSections({ workspace: scratch, root: scratch });

  expect(result.sections).toEqual({});
  expect(result.diagnostics).toEqual([
    {
      code: "instruction_read_failed",
      path: join(root, "AGENTS.md"),
      detail: "not valid UTF-8",
    },
  ]);
});

test("only AGENTS.md is read, and a CLAUDE.md beside it or in another folder is ignored", async () => {
  put("AGENTS.md", "agents");
  put("CLAUDE.md", "claude root");
  put("a/CLAUDE.md", "claude a");
  put("a/GEMINI.md", "gemini a");

  const result = await readSections({ workspace: join(scratch, "a"), root: scratch });

  expect(result.sections).toEqual({ "project:.": "agents" });
  expect(result.diagnostics).toEqual([]);
});

test("a changed file is picked up on the next call, by its modification time and size", async () => {
  const path = put("AGENTS.md", "aaaa");
  const instructionSectionsOf = createInstructionSections({
    workspaceOf: () => scratch,
    projectRootOf: () => scratch,
    maxBytes: () => 65_536,
    fs: nodeInstructionFs,
  });
  const when = new Date("2026-11-18T00:00:00Z");
  utimesSync(path, when, when);

  const first = await instructionSectionsOf(threadId);
  expect(first.sections).toEqual({ "project:.": "aaaa" });

  // 같은 크기, 다른 내용. 수정 시각이 바뀌면 다시 읽는다
  writeFileSync(path, "bbbb");
  const later = new Date("2026-11-18T00:00:10Z");
  utimesSync(path, later, later);
  const second = await instructionSectionsOf(threadId);
  expect(second.sections).toEqual({ "project:.": "bbbb" });

  // 크기가 바뀐 경우도 다시 읽는다
  writeFileSync(path, "a longer instruction text");
  const third = await instructionSectionsOf(threadId);
  expect(third.sections).toEqual({ "project:.": "a longer instruction text" });
});

test("without a project root the workspace is the root and only its own AGENTS.md is read", async () => {
  put("AGENTS.md", "root file");
  put("a/AGENTS.md", "workspace file");

  const result = await readSections({ workspace: join(scratch, "a") });

  expect(result.sections).toEqual({ "project:.": "workspace file" });
  expect(result.diagnostics).toEqual([]);
});

test("a conversation without a workspace reads nothing", async () => {
  put("AGENTS.md", "root file");

  const result = await readSections({ workspace: undefined, root: scratch });

  expect(result).toEqual({ sections: {}, diagnostics: [] });
});

test("a root that does not contain the workspace is reported and the workspace is used as the root", async () => {
  const unrelated = otherDir();
  put("a/AGENTS.md", "workspace file");

  const result = await readSections({ workspace: join(scratch, "a"), root: unrelated });

  expect(result.sections).toEqual({ "project:.": "workspace file" });
  expect(result.diagnostics).toEqual([{ code: "instruction_root_mismatch", path: unrelated }]);
});
