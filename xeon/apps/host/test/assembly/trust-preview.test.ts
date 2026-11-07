import { expect, test } from "bun:test";
import type { LoaderFs } from "@fresnel/contracts/extensions";
import { previewTrustResources } from "../../src/assembly/trust-preview.ts";

// 신뢰 카드 미리 보기(X.loading-trust.spec §4.7.4). 가짜 파일 시스템 위에서 돈다. 읽은 경로와 본 디렉터리를 기록해
// 이름 말고는 아무것도 읽지 않았음을 값으로 확인한다.

const ROOT = "/work/proj";

type Entry = { readonly name: string; readonly kind: "file" | "dir" | "symlink" };

interface FakeInput {
  readonly texts?: Readonly<Record<string, string>>;
  /** 읽을 때 던지는 경로 */
  readonly broken?: readonly string[];
  readonly dirs?: Readonly<Record<string, readonly Entry[]>>;
}

function fakeFs(
  input: FakeInput,
): LoaderFs & { readonly reads: string[]; readonly listed: string[] } {
  const reads: string[] = [];
  const listed: string[] = [];
  const texts = input.texts ?? {};
  const dirs = input.dirs ?? {};
  const broken = input.broken ?? [];
  return {
    reads,
    listed,
    readText(path) {
      reads.push(path);
      if (broken.includes(path)) return Promise.reject(new Error("EACCES: permission denied"));
      return Promise.resolve(texts[path] ?? null);
    },
    listDir(path) {
      listed.push(path);
      return Promise.resolve(dirs[path] ?? null);
    },
    exists: () => Promise.resolve(false),
    realpath: (path) => Promise.resolve(path),
  };
}

const MCP_JSON = `${ROOT}/.mcp.json`;
const FRESNEL_MCP_JSON = `${ROOT}/.fresnel/mcp.json`;

test("the MCP server name, command and args are listed exactly, and env values never appear", async () => {
  const fs = fakeFs({
    texts: {
      [MCP_JSON]: JSON.stringify({
        mcpServers: {
          docs: {
            command: "npx",
            args: ["-y", "docs-server"],
            env: { API_TOKEN: "sk-secret-value-123" },
          },
          remote: { url: "https://remote.example/mcp", headers: { Authorization: "Bearer x" } },
        },
      }),
    },
  });
  const preview = await previewTrustResources(fs, ROOT);
  // url만 있는 원격 서버는 실행 명령이 없어 목록에 싣지 않는다
  expect(preview.details.mcpServers).toEqual([
    { name: "docs", command: "npx", args: ["-y", "docs-server"] },
  ]);
  expect(preview.issues).toEqual([]);
  expect(JSON.stringify(preview)).not.toContain("sk-secret-value-123");
  expect(JSON.stringify(preview)).not.toContain("Bearer");
});

test("a server without args gets an empty argument list, and the .fresnel/mcp.json file is read too", async () => {
  const fs = fakeFs({
    texts: {
      [FRESNEL_MCP_JSON]: JSON.stringify({ mcpServers: { local: { command: "./bin/local" } } }),
    },
  });
  const preview = await previewTrustResources(fs, ROOT);
  expect(preview.details.mcpServers).toEqual([{ name: "local", command: "./bin/local", args: [] }]);
});

test("a malformed MCP file gives an empty server list and is reported, it never throws", async () => {
  const fs = fakeFs({ texts: { [MCP_JSON]: '{ "mcpServers": { "docs": ' } });
  const preview = await previewTrustResources(fs, ROOT);
  expect(preview.details.mcpServers).toEqual([]);
  expect(preview.issues).toEqual([{ path: ".mcp.json", reason: "malformed" }]);
});

test("a file of another shape, or servers that are not objects, give no servers and no crash", async () => {
  const fs = fakeFs({
    texts: {
      [MCP_JSON]: JSON.stringify([{ command: "npx" }]),
      [FRESNEL_MCP_JSON]: JSON.stringify({ mcpServers: { bad: "npx", nul: null } }),
    },
  });
  const preview = await previewTrustResources(fs, ROOT);
  expect(preview.details.mcpServers).toEqual([]);
  expect(preview.issues).toEqual([]);
});

test("a server whose argument is not a string is left out, so no argument is hidden from the list", async () => {
  const fs = fakeFs({
    texts: {
      [MCP_JSON]: JSON.stringify({
        mcpServers: {
          port: { command: "node", args: ["server.js", 8080] },
          fine: { command: "node", args: ["server.js"] },
        },
      }),
    },
  });
  const preview = await previewTrustResources(fs, ROOT);
  expect(preview.details.mcpServers).toEqual([
    { name: "fine", command: "node", args: ["server.js"] },
  ]);
});

test("an unreadable MCP file is reported as unreadable and the preview still returns", async () => {
  const fs = fakeFs({ broken: [MCP_JSON] });
  const preview = await previewTrustResources(fs, ROOT);
  expect(preview.details.mcpServers).toEqual([]);
  expect(preview.issues).toEqual([{ path: ".mcp.json", reason: "unreadable" }]);
});

test("a UTF-8 byte order mark in front of the MCP file is skipped", async () => {
  const fs = fakeFs({
    texts: { [MCP_JSON]: `﻿${JSON.stringify({ mcpServers: { a: { command: "a" } } })}` },
  });
  const preview = await previewTrustResources(fs, ROOT);
  expect(preview.details.mcpServers).toEqual([{ name: "a", command: "a", args: [] }]);
});

test("hooks, skills, commands and extensions are listed by name, and their contents are never read", async () => {
  const fs = fakeFs({
    dirs: {
      [`${ROOT}/.fresnel/hooks`]: [
        { name: "pre.sh", kind: "file" },
        { name: "canary.sh", kind: "file" },
      ],
      [`${ROOT}/.fresnel/skills`]: [
        { name: "review", kind: "dir" },
        { name: "notes.md", kind: "file" },
      ],
      [`${ROOT}/.fresnel/commands`]: [
        { name: "ship.md", kind: "file" },
        { name: "lint", kind: "dir" },
      ],
      [`${ROOT}/.fresnel/extensions`]: [{ name: "lint-ext", kind: "dir" }],
    },
  });
  const preview = await previewTrustResources(fs, ROOT);
  expect(preview.details.hooks).toEqual(["canary.sh", "pre.sh"]);
  expect(preview.details.skills).toEqual(["notes", "review"]);
  expect(preview.details.commands).toEqual(["lint", "ship"]);
  expect(preview.details.extensions).toEqual(["lint-ext"]);
  expect(preview.issues).toEqual([]);
});

test("the preview reads only the two MCP files and lists only the four directories", async () => {
  // canary: 훅 파일이 있어도 그 내용을 읽거나 실행하지 않는다. 읽은 경로는 두 MCP 정의 파일뿐이다
  const fs = fakeFs({
    texts: { [MCP_JSON]: JSON.stringify({ mcpServers: {} }) },
    dirs: { [`${ROOT}/.fresnel/hooks`]: [{ name: "canary.sh", kind: "file" }] },
  });
  await previewTrustResources(fs, ROOT);
  expect(fs.reads.toSorted()).toEqual([FRESNEL_MCP_JSON, MCP_JSON].toSorted());
  expect(fs.listed.toSorted()).toEqual(
    [
      `${ROOT}/.fresnel/commands`,
      `${ROOT}/.fresnel/extensions`,
      `${ROOT}/.fresnel/hooks`,
      `${ROOT}/.fresnel/skills`,
    ].toSorted(),
  );
});

test("a directory that cannot be listed is reported and the rest of the preview still returns", async () => {
  const fs: LoaderFs = {
    ...fakeFs({ dirs: { [`${ROOT}/.fresnel/skills`]: [{ name: "review", kind: "dir" }] } }),
    listDir: (path) =>
      path.endsWith("/hooks")
        ? Promise.reject(new Error("EACCES: permission denied"))
        : Promise.resolve(path.endsWith("/skills") ? [{ name: "review", kind: "dir" }] : null),
  };
  const preview = await previewTrustResources(fs, ROOT);
  expect(preview.details.hooks).toEqual([]);
  expect(preview.details.skills).toEqual(["review"]);
  expect(preview.issues).toEqual([{ path: ".fresnel/hooks", reason: "unreadable" }]);
});

test("a project with nothing in it gives empty lists and no issues", async () => {
  const preview = await previewTrustResources(fakeFs({}), ROOT);
  expect(preview.details).toEqual({
    mcpServers: [],
    hooks: [],
    skills: [],
    commands: [],
    extensions: [],
  });
  expect(preview.issues).toEqual([]);
});

test("the server list stops at the limit of 64 servers", async () => {
  const servers = Object.fromEntries(
    Array.from({ length: 70 }, (_, n) => [`s${String(n).padStart(2, "0")}`, { command: "node" }]),
  );
  const preview = await previewTrustResources(
    fakeFs({ texts: { [MCP_JSON]: JSON.stringify({ mcpServers: servers }) } }),
    ROOT,
  );
  expect(preview.details.mcpServers).toHaveLength(64);
  expect(preview.details.mcpServers[0]).toEqual({ name: "s00", command: "node", args: [] });
  expect(preview.details.mcpServers[63]).toEqual({ name: "s63", command: "node", args: [] });
});
