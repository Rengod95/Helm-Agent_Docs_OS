import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { previewTrustResources, type TrustPreviewFs } from "../../src/assembly/trust-preview.ts";
import { createLoaderFs } from "../../src/assembly/trust.ts";

// 신뢰 카드 미리 보기(X.loading-trust.spec §4.7.4). 가짜 파일 시스템 위에서 돈다. 읽은 경로와 본 디렉터리를 기록해
// 이름 말고는 아무것도 읽지 않았음을 값으로 확인한다. 마지막의 실제 디스크 시험은 조립 루트의 `createLoaderFs`를 쓴다.

const ROOT = "/work/proj";
/** 정의 파일 읽기 상한(바이트). `trust-preview.ts`의 `MAX_DEFINITION_BYTES`와 같다 */
const LIMIT = 256 * 1024;

type Entry = { readonly name: string; readonly kind: "file" | "dir" | "symlink" };

interface FakeInput {
  readonly texts?: Readonly<Record<string, string>>;
  /** 읽을 때 던지는 경로 */
  readonly broken?: readonly string[];
  readonly dirs?: Readonly<Record<string, readonly Entry[]>>;
  /** 심볼릭 링크: 경로 → 가리키는 실제 경로 */
  readonly links?: Readonly<Record<string, string>>;
}

function fakeFs(input: FakeInput): TrustPreviewFs & {
  readonly reads: string[];
  readonly listed: string[];
  readonly bounds: number[];
} {
  const reads: string[] = [];
  const listed: string[] = [];
  const bounds: number[] = [];
  const texts = input.texts ?? {};
  const dirs = input.dirs ?? {};
  const broken = input.broken ?? [];
  const links = input.links ?? {};
  return {
    reads,
    listed,
    bounds,
    exists: (path) =>
      Promise.resolve(
        Object.hasOwn(texts, path) || Object.hasOwn(links, path) || broken.includes(path),
      ),
    realpath: (path) => Promise.resolve(links[path] ?? path),
    listDir(path) {
      listed.push(path);
      return Promise.resolve(dirs[path] ?? null);
    },
    readBoundedText(path, maxBytes) {
      reads.push(path);
      bounds.push(maxBytes);
      if (broken.includes(path)) return Promise.reject(new Error("EACCES: permission denied"));
      const text = texts[path];
      if (text === undefined) return Promise.resolve({ kind: "missing" });
      if (Buffer.byteLength(text) > maxBytes) return Promise.resolve({ kind: "too_large" });
      return Promise.resolve({ kind: "text", text });
    },
  };
}

const MCP_JSON = `${ROOT}/.mcp.json`;
const FRESNEL_MCP_JSON = `${ROOT}/.fresnel/mcp.json`;

/** 정확히 `total`바이트인 MCP 정의. 서버 `docs` 하나에 `pad` 문자열로 길이를 맞춘다 */
/** `prefix`와 번호로 이름을 붙인 서버 60개의 정의 */
function sixtyServers(prefix: string): Record<string, { command: string }> {
  return Object.fromEntries(
    Array.from({ length: 60 }, (_, n) => [`${prefix}${n}`, { command: "node" }]),
  );
}

function mcpOfBytes(total: number): string {
  const base = JSON.stringify({ mcpServers: { docs: { command: "npx" } }, pad: "" });
  return JSON.stringify({
    mcpServers: { docs: { command: "npx" } },
    pad: "x".repeat(total - base.length),
  });
}

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
  // url만 있는 원격 서버는 실행 명령이 없어 목록에 싣지 않는다. 아무것도 잘리지 않았으므로 truncated는 없다
  expect(preview.details.mcpServers).toEqual([
    { name: "docs", command: "npx", args: ["-y", "docs-server"] },
  ]);
  expect(preview.details).not.toHaveProperty("truncated");
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
  // 내용을 못 본 정의 파일이 있으므로 목록은 전부가 아니다
  expect(preview.details.truncated).toBe(true);
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

test("the preview reads only the MCP definition files, and lists only the four directories", async () => {
  // canary: 훅 파일이 있어도 그 내용을 읽거나 실행하지 않는다. 읽은 경로는 MCP 정의 파일뿐이고, 없는 `.fresnel/mcp.json`은 존재 확인에서 끝나 읽지 않는다
  const fs = fakeFs({
    texts: { [MCP_JSON]: JSON.stringify({ mcpServers: {} }) },
    dirs: { [`${ROOT}/.fresnel/hooks`]: [{ name: "canary.sh", kind: "file" }] },
  });
  await previewTrustResources(fs, ROOT);
  expect(fs.reads).toEqual([MCP_JSON]);
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
  const fs: TrustPreviewFs = {
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

test("a definition file lists at most 50 servers and the list is marked truncated", async () => {
  const servers = Object.fromEntries(
    Array.from({ length: 60 }, (_, n) => [`s${String(n).padStart(2, "0")}`, { command: "node" }]),
  );
  const preview = await previewTrustResources(
    fakeFs({ texts: { [MCP_JSON]: JSON.stringify({ mcpServers: servers }) } }),
    ROOT,
  );
  expect(preview.details.mcpServers).toHaveLength(50);
  expect(preview.details.mcpServers[0]).toEqual({ name: "s00", command: "node", args: [] });
  expect(preview.details.mcpServers[49]).toEqual({ name: "s49", command: "node", args: [] });
  expect(preview.details.truncated).toBe(true);
});

test("each definition file keeps its own 50 servers, so the two files together list up to 100", async () => {
  const preview = await previewTrustResources(
    fakeFs({
      texts: {
        [MCP_JSON]: JSON.stringify({ mcpServers: sixtyServers("p") }),
        [FRESNEL_MCP_JSON]: JSON.stringify({ mcpServers: sixtyServers("f") }),
      },
    }),
    ROOT,
  );
  const names = preview.details.mcpServers.map((server) => server.name);
  expect(names).toHaveLength(100);
  expect(names.filter((name) => name.startsWith("p"))).toHaveLength(50);
  expect(names.filter((name) => name.startsWith("f"))).toHaveLength(50);
  expect(preview.details.truncated).toBe(true);
});

test("a command or argument longer than 512 characters is cut to 512 with an ellipsis, and the list is marked truncated", async () => {
  const long = "a".repeat(2000);
  const preview = await previewTrustResources(
    fakeFs({
      texts: {
        [MCP_JSON]: JSON.stringify({
          mcpServers: { docs: { command: long, args: [long, "short"] } },
        }),
      },
    }),
    ROOT,
  );
  const cut = `${"a".repeat(511)}…`;
  expect(preview.details.mcpServers).toEqual([
    { name: "docs", command: cut, args: [cut, "short"] },
  ]);
  expect(preview.details.truncated).toBe(true);
});

test("the cut counts characters, not UTF-16 units, so an emoji is never split", async () => {
  const emoji = "😀".repeat(600);
  const preview = await previewTrustResources(
    fakeFs({
      texts: { [MCP_JSON]: JSON.stringify({ mcpServers: { docs: { command: emoji } } }) },
    }),
    ROOT,
  );
  expect(preview.details.mcpServers[0]?.command).toBe(`${"😀".repeat(511)}…`);
});

test("an argument list longer than 64 keeps its first 64 and the list is marked truncated", async () => {
  const args = Array.from({ length: 70 }, (_, n) => `arg${n}`);
  const preview = await previewTrustResources(
    fakeFs({
      texts: { [MCP_JSON]: JSON.stringify({ mcpServers: { docs: { command: "npx", args } } }) },
    }),
    ROOT,
  );
  expect(preview.details.mcpServers).toEqual([
    { name: "docs", command: "npx", args: args.slice(0, 64) },
  ]);
  expect(preview.details.truncated).toBe(true);
});

test("a directory lists at most 100 names and the list is marked truncated", async () => {
  const entries = Array.from({ length: 120 }, (_, n): Entry => ({
    name: `hook${String(n).padStart(3, "0")}.sh`,
    kind: "file",
  }));
  const preview = await previewTrustResources(
    fakeFs({ dirs: { [`${ROOT}/.fresnel/hooks`]: entries } }),
    ROOT,
  );
  expect(preview.details.hooks).toHaveLength(100);
  expect(preview.details.hooks[0]).toBe("hook000.sh");
  expect(preview.details.hooks[99]).toBe("hook099.sh");
  expect(preview.details.truncated).toBe(true);
});

test("a definition file over 256 KiB is not parsed: no servers, too_large, and the list is marked truncated", async () => {
  const fs = fakeFs({ texts: { [MCP_JSON]: mcpOfBytes(LIMIT + 1) } });
  const preview = await previewTrustResources(fs, ROOT);
  expect(preview.details.mcpServers).toEqual([]);
  expect(preview.details.truncated).toBe(true);
  expect(preview.issues).toEqual([{ path: ".mcp.json", reason: "too_large" }]);
  // 읽기는 상한을 넘겨 요청하지 않는다
  expect(fs.bounds.every((bound) => bound === LIMIT)).toBe(true);
});

test("a definition file of exactly 256 KiB is still parsed", async () => {
  const preview = await previewTrustResources(
    fakeFs({ texts: { [MCP_JSON]: mcpOfBytes(LIMIT) } }),
    ROOT,
  );
  expect(preview.details.mcpServers).toEqual([{ name: "docs", command: "npx", args: [] }]);
  expect(preview.issues).toEqual([]);
});

test("a symlink that points out of the project is not followed: unreadable, and nothing outside is read", async () => {
  const outside = "/elsewhere/secret/mcp.json";
  const fs = fakeFs({
    links: { [MCP_JSON]: outside },
    texts: { [outside]: JSON.stringify({ mcpServers: { leaked: { command: "npx" } } }) },
  });
  const preview = await previewTrustResources(fs, ROOT);
  expect(preview.details.mcpServers).toEqual([]);
  expect(preview.issues).toEqual([{ path: ".mcp.json", reason: "unreadable" }]);
  expect(fs.reads).not.toContain(outside);
});

test("a symlink that stays inside the project is followed", async () => {
  const inside = `${ROOT}/configs/mcp.json`;
  const preview = await previewTrustResources(
    fakeFs({
      links: { [MCP_JSON]: inside },
      texts: { [inside]: JSON.stringify({ mcpServers: { inner: { command: "node" } } }) },
    }),
    ROOT,
  );
  expect(preview.details.mcpServers).toEqual([{ name: "inner", command: "node", args: [] }]);
  expect(preview.issues).toEqual([]);
});

// 실제 디스크: 조립 루트의 `createLoaderFs`가 상한과 심볼릭 링크 판정을 실제 파일 시스템 위에서 맞게 하는지 본다
const cleanup: string[] = [];

afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function diskProject(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "xh-preview-")));
  cleanup.push(dir);
  return dir;
}

test("on disk, a definition file of exactly 256 KiB is parsed and one byte more is refused", async () => {
  const dir = diskProject();
  writeFileSync(join(dir, ".mcp.json"), mcpOfBytes(LIMIT));
  const exact = await previewTrustResources(createLoaderFs(), dir);
  expect(exact.details.mcpServers).toEqual([{ name: "docs", command: "npx", args: [] }]);

  writeFileSync(join(dir, ".mcp.json"), mcpOfBytes(LIMIT + 1));
  const over = await previewTrustResources(createLoaderFs(), dir);
  expect(over.details.mcpServers).toEqual([]);
  expect(over.issues).toEqual([{ path: ".mcp.json", reason: "too_large" }]);
});

test("on disk, a symlink from the project to a file outside it is not followed", async () => {
  const dir = diskProject();
  const outside = diskProject();
  writeFileSync(
    join(outside, "mcp.json"),
    JSON.stringify({ mcpServers: { leaked: { command: "npx" } } }),
  );
  symlinkSync(join(outside, "mcp.json"), join(dir, ".mcp.json"));
  const preview = await previewTrustResources(createLoaderFs(), dir);
  expect(preview.details.mcpServers).toEqual([]);
  expect(preview.issues).toEqual([{ path: ".mcp.json", reason: "unreadable" }]);
});

test("on disk, a symlink that stays inside the project is followed", async () => {
  const dir = diskProject();
  mkdirSync(join(dir, "configs"));
  writeFileSync(
    join(dir, "configs", "mcp.json"),
    JSON.stringify({ mcpServers: { inner: { command: "node" } } }),
  );
  symlinkSync(join(dir, "configs", "mcp.json"), join(dir, ".mcp.json"));
  const preview = await previewTrustResources(createLoaderFs(), dir);
  expect(preview.details.mcpServers).toEqual([{ name: "inner", command: "node", args: [] }]);
});
