import { describe, expect, test } from "bun:test";
import type { CallOptions } from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ProtectedPathEntry } from "@fresnel/contracts/services";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createFilesApi } from "../src/service.ts";
import { rejection } from "./support/assertions.ts";
import { depsFor } from "./support/fakes.ts";
import { memoryEnv } from "./support/memory-env.ts";

// L2.workspace.spec §4.3 쓰기 root 검사, §4.3.1. 파일 도구(write, edit)는 작업 폴더 밖 경로를 사람에게 묻지 않고 `outside_root`로 거부한다.
// 보호 경로는 작업 폴더 안에 있어도 `protected_path`로 거부한다. 쓰기 허용 질문은 없다 [결정: 2026-11-21 사용자, AGE-63].

const HOME = "/Users/me";
const IDS = fixedIdFactory();
const THREAD: ThreadId = IDS.next("thr");
const PROTECTED: readonly ProtectedPathEntry[] = [
  { path: ".env", match: "basename", access: "write", reason: "credentials" },
];

function human(): CallOptions {
  return {
    context: {
      threadId: THREAD,
      toolCallId: "call_1",
      caller: { kind: "model", agent: "main" },
      interactive: true,
    },
  };
}

function filesSetup() {
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  env.mkdir(`${HOME}/notes`);
  const files = createFilesApi(depsFor(env, { protectedPaths: PROTECTED, narrowRoots: true }));
  return { env, files };
}

describe("file tools outside the workspace are refused", () => {
  test("write outside the workspace is refused as outside_root and nothing is written", async () => {
    const { env, files } = filesSetup();
    const error = await rejection(
      files.write({ path: `${HOME}/notes/a.txt`, content: "hi" }, human()),
    );
    expect(error.data.code).toBe("denied");
    expect(error.data.detail).toMatchObject({ reason: "outside_root" });
    const found = await env.exists(`${HOME}/notes/a.txt`, { abortSignal: undefined });
    expect(found.ok && found.value).toBe(false);
  });

  test("edit outside the workspace is refused as outside_root before the file is looked up", async () => {
    const { files } = filesSetup();
    const error = await rejection(
      files.edit({ path: `${HOME}/notes/a.txt`, edits: [{ oldText: "a", newText: "b" }] }, human()),
    );
    expect(error.data.detail).toMatchObject({ reason: "outside_root" });
  });

  test("a protected path inside the workspace is refused as protected_path", async () => {
    const { env, files } = filesSetup();
    const error = await rejection(files.write({ path: ".env", content: "x" }, human()));
    expect(error.data.code).toBe("denied");
    expect(error.data.detail).toMatchObject({
      reason: "protected_path",
      protectedBy: "credentials",
    });
    const found = await env.exists("/work/.env", { abortSignal: undefined });
    expect(found.ok && found.value).toBe(false);
  });
});
