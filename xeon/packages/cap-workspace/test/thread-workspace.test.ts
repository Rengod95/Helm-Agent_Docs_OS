import { describe, expect, test } from "bun:test";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import type { CallOptions } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { WorkspaceEnv } from "../src/env.ts";
import type { ThreadWorkspaces } from "../src/ports/threads.ts";
import { scopedDeps } from "../src/scope.ts";
import { createFilesApi, createWorkspaceService } from "../src/service.ts";
import { rejection } from "./support/assertions.ts";
import { depsFor } from "./support/fakes.ts";
import { memoryBlobs, pngBytes } from "./support/images.ts";
import { memoryEnv, type MemoryEnv } from "./support/memory-env.ts";

// open-issues M-06, plan DG.4. thread.started의 workspace가 root 계산과 상대 경로의 기준이 된다.

const ids = fixedIdFactory();
const ALPHA: ThreadId = ids.next("thr");
const BETA: ThreadId = ids.next("thr");
const OLD: ThreadId = ids.next("thr");
const UNKNOWN: ThreadId = ids.next("thr");

function callOptions(id: ThreadId): CallOptions {
  return { context: { threadId: id, caller: { kind: "host" } } };
}

function fixture(map: Readonly<Record<string, string | null>> = {}) {
  const env = memoryEnv({ cwd: "/engine" });
  env.mkdir("/engine");
  env.mkdir("/projects/alpha");
  env.mkdir("/projects/beta");
  env.put("/engine/who.txt", "engine\n");
  env.put("/projects/alpha/who.txt", "alpha\n");
  env.put("/projects/beta/who.txt", "beta\n");
  env.put("/projects/secret.txt", "outside both roots\n");
  const lookups: string[] = [];
  const threads: ThreadWorkspaces = {
    workspaceOf: (id) => {
      lookups.push(id);
      return map[id] ?? null;
    },
    envAt: (cwd): WorkspaceEnv => env.withCwd(cwd),
  };
  const deps = depsFor(env, { threads, blobs: memoryBlobs() });
  return { env, deps, threads, lookups };
}

const MAP = { [ALPHA]: "/projects/alpha", [BETA]: "/projects/beta", [OLD]: null };

describe("thread workspace roots", () => {
  test("a relative path resolves against the thread workspace", async () => {
    const { deps } = fixture(MAP);
    const files = createFilesApi(deps);
    const alpha = await files.read({ path: "who.txt" }, callOptions(ALPHA));
    expect(alpha).toMatchObject({ kind: "text", text: "alpha\n", path: "/projects/alpha/who.txt" });
    const beta = await files.read({ path: "who.txt" }, callOptions(BETA));
    expect(beta).toMatchObject({ kind: "text", text: "beta\n" });
  });

  test("threads without a workspace or without a call context use the engine cwd", async () => {
    const { deps } = fixture(MAP);
    const files = createFilesApi(deps);
    const results = await Promise.all(
      [callOptions(OLD), callOptions(UNKNOWN), undefined].map((options) =>
        files.read({ path: "who.txt" }, options),
      ),
    );
    for (const result of results) expect(result).toMatchObject({ kind: "text", text: "engine\n" });
  });

  test("the thread workspace is the only root: another project and the engine cwd are denied", async () => {
    const { deps } = fixture(MAP);
    const files = createFilesApi(deps);
    const sibling = await rejection(files.read({ path: "../beta/who.txt" }, callOptions(ALPHA)));
    expect(sibling.data).toMatchObject({ code: "denied", detail: { reason: "outside_root" } });
    const engine = await rejection(files.read({ path: "/engine/who.txt" }, callOptions(ALPHA)));
    expect(engine.data).toMatchObject({ code: "denied", detail: { reason: "outside_root" } });
    // 엔진 cwd 대화는 thread 작업 폴더에 접근하지 못한다
    const reverse = await rejection(files.read({ path: "/projects/alpha/who.txt" }));
    expect(reverse.data.code).toBe("denied");
  });

  test("ls lists the thread workspace", async () => {
    const { deps } = fixture(MAP);
    const files = createFilesApi(deps);
    const listed = await files.list({}, callOptions(BETA));
    expect(listed.path).toBe("/projects/beta");
    expect(listed.entries.map((entry) => entry.name)).toEqual(["who.txt"]);
  });

  test("bash starts in the thread workspace and the sandbox may write only there", async () => {
    const { deps, env } = fixture(MAP);
    const service = createWorkspaceService(deps);
    env.reply({ chunks: [{ text: "ok\n" }], exitCode: 0 });
    await service.shell.run({ command: "pwd" }, callOptions(ALPHA));
    expect(env.calls.at(-1)?.options?.cwd).toBe("/projects/alpha");
    const sandbox = deps.sandbox;
    const policy = sandbox?.defaultPolicy({ workspaceRoots: ["/projects/alpha"], tempDir: "/tmp" });
    expect(policy?.writeRoots).toContain("/projects/alpha");
    expect(policy?.writeRoots).not.toContain("/engine");
  });

  test("images load relative to the thread workspace", async () => {
    const { deps, env } = fixture(MAP);
    env.put("/projects/alpha/pic.png", pngBytes(4, 3, 64));
    const service = createWorkspaceService(deps);
    const image = await service.images.load({ path: "pic.png" }, callOptions(ALPHA));
    expect(image.mimeType).toBe("image/png");
    const elsewhere = await rejection(service.images.load({ path: "pic.png" }, callOptions(BETA)));
    expect(elsewhere.data.code).toBe("not_found");
  });

  test("a workspace that does not exist fails with not_found, not with the engine cwd", async () => {
    const { deps } = fixture({ [ALPHA]: "/projects/gone" });
    const files = createFilesApi(deps);
    const error = await rejection(files.read({ path: "who.txt" }, callOptions(ALPHA)));
    expect(error.data.code).toBe("not_found");
  });

  test("scopedDeps looks the workspace up once per call and leaves deps alone without a port", () => {
    const { deps, lookups } = fixture(MAP);
    const scoped = scopedDeps(deps, ALPHA);
    expect(scoped.env.cwd).toBe("/projects/alpha");
    expect(scoped.roots.env).not.toBe(deps.roots.env);
    expect(lookups).toEqual([ALPHA]);
    const plain = { ...deps };
    delete plain.threads;
    expect(scopedDeps(plain, ALPHA)).toBe(plain);
    expect(scopedDeps(deps, undefined)).toBe(deps);
  });
});

describe("protected paths follow the scoped roots", () => {
  test("a protected path inside the thread workspace is still denied", async () => {
    const env: MemoryEnv = memoryEnv({ cwd: "/engine" });
    env.mkdir("/engine");
    env.put("/projects/alpha/.git/config", "x");
    const threads: ThreadWorkspaces = {
      workspaceOf: () => "/projects/alpha",
      envAt: (cwd) => env.withCwd(cwd),
    };
    const files = createFilesApi(
      depsFor(env, {
        threads,
        protectedPaths: [
          {
            path: "/projects/alpha/.git",
            match: "prefix",
            access: "read_write",
            reason: "git_exec",
          },
        ],
      }),
    );
    const error = await rejection(files.read({ path: ".git/config" }, callOptions(ALPHA)));
    expect(error.data).toMatchObject({ code: "denied", detail: { reason: "protected_path" } });
  });
});
