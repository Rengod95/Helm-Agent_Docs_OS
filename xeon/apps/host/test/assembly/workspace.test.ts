import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import {
  canonicalWorkspace,
  wireErrorOfWorkspace,
  workspaceFilterOf,
} from "../../src/assembly/workspace.ts";

// G2-02, HS-76: 대화의 작업 폴더는 심볼릭 링크를 푼 정규 절대 경로로 저장한다. 신뢰 저장소의 키와 같은 형태다.

const root = realpathSync(mkdtempSync(join(tmpdir(), "xh-ws-rule-")));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const project = join(root, "real", "project");
mkdirSync(project, { recursive: true });
const link = join(root, "link-to-project");
symlinkSync(project, link);
const aFile = join(root, "a-file");
writeFileSync(aFile, "x");

test("an existing directory is stored as its canonical path: links are followed, dots and trailing slashes are gone", async () => {
  expect(await canonicalWorkspace(project)).toEqual({ ok: true, value: project });
  expect(await canonicalWorkspace(link)).toEqual({ ok: true, value: project });
  expect(await canonicalWorkspace(`${link}/`)).toEqual({ ok: true, value: project });
  expect(await canonicalWorkspace(join(project, "..", "project", "."))).toEqual({
    ok: true,
    value: project,
  });
});

test("a relative path, a missing folder and a file are refused with their own reason", async () => {
  expect(await canonicalWorkspace("project")).toEqual({
    ok: false,
    error: { kind: "not_absolute" },
  });
  expect(await canonicalWorkspace(join(root, "missing"))).toEqual({
    ok: false,
    error: { kind: "not_found" },
  });
  expect(await canonicalWorkspace(aFile)).toEqual({ ok: false, error: { kind: "not_directory" } });
  // 파일 아래 경로는 폴더가 아니다
  expect(await canonicalWorkspace(join(aFile, "child"))).toEqual({
    ok: false,
    error: { kind: "not_found" },
  });
});

test("the list filter has the same canonical form, and a folder that is gone still filters by its tidied path", async () => {
  expect(await workspaceFilterOf(link)).toEqual({ ok: true, value: project });
  const gone = join(root, "moved", "..", "moved-project");
  expect(await workspaceFilterOf(gone)).toEqual({ ok: true, value: join(root, "moved-project") });
  expect(await workspaceFilterOf("project")).toEqual({
    ok: false,
    error: { kind: "not_absolute" },
  });
});

test("each refusal is invalid params on the workspace without a path in the details", () => {
  for (const failure of [
    { kind: "not_absolute" },
    { kind: "not_found" },
    { kind: "not_directory" },
    { kind: "unreadable", code: "EACCES" },
  ] as const) {
    const wire = wireErrorOfWorkspace(failure);
    expect(wire.data.kind).toBe("jsonrpc.invalidParams");
    expect(JSON.stringify(wire.data.details)).not.toContain(root);
    expect(wire.data.details).toMatchObject({ issues: [{ path: "workspace" }] });
  }
  expect(wireErrorOfWorkspace({ kind: "unreadable", code: "EACCES" }).data.details).toEqual({
    issues: [{ path: "workspace", message: "workspace cannot be read (EACCES)" }],
  });
});
