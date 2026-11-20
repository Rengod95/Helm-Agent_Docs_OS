import { describe, expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import type { CallOptions } from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ProtectedPathEntry } from "@fresnel/contracts/services";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import type { WriteAccessPort, WriteAccessRequest } from "@fresnel/core-workspace";
import { createFilesApi } from "../src/service.ts";
import { rejection } from "./support/assertions.ts";
import { depsFor } from "./support/fakes.ts";
import { memoryEnv } from "./support/memory-env.ts";

// L2.workspace.spec §4.3.1. 파일 도구(write, edit)가 작업 폴더 밖 경로를 받았을 때의 쓰기 허용 질문.
// 셸 쪽 질문과 허용 규칙은 core-workspace의 write-access.test.ts가 맡는다.

const HOME = "/Users/me";
const IDS = fixedIdFactory();
const THREAD: ThreadId = IDS.next("thr");
// 기본 보호 경로(L0.sandbox.spec §3.3, AGE-63): 자격 폴더와 이름 패턴은 쓰기만 막는다. 쓰기 질문을 묻지 않고 거부하는 것이 시험 대상이다
const PROTECTED: readonly ProtectedPathEntry[] = [
  { path: `${HOME}/.ssh`, match: "prefix", access: "write", reason: "credentials" },
  { path: `${HOME}/.claude`, match: "prefix", access: "write", reason: "agent_credentials" },
  { path: ".env", match: "basename", access: "write", reason: "credentials" },
];

type Answer = "allow" | "allow_all" | "deny";

/** 대화별 "앞으로 전부 허용"을 기억하는 승인 대역. allow_all을 받으면 그 대화는 이후 묻지 않는다 */
function asker(answer: Answer) {
  const requests: WriteAccessRequest[] = [];
  const grantedThreads = new Set<string>();
  const port: WriteAccessPort = {
    ask: (request) => {
      requests.push(request);
      if (answer === "allow_all") grantedThreads.add(request.threadId);
      return Promise.resolve(ok(answer));
    },
    granted: (threadId) => Promise.resolve(grantedThreads.has(threadId)),
  };
  return { port, requests, grantedThreads };
}

function human(interactive = true, threadId: ThreadId = THREAD): CallOptions {
  return {
    context: {
      threadId,
      toolCallId: "call_1",
      caller: { kind: "model", agent: "main" },
      interactive,
    },
  };
}

function filesSetup(answer: Answer) {
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  env.mkdir(`${HOME}/notes`);
  const { port, requests, grantedThreads } = asker(answer);
  const files = createFilesApi(
    depsFor(env, { protectedPaths: PROTECTED, writeAccess: port, homeDir: HOME }),
  );
  return { env, files, requests, grantedThreads };
}

describe("file tools outside the workspace", () => {
  test("write outside the workspace is asked, and written once allowed", async () => {
    const { env, files, requests } = filesSetup("allow");
    await files.write({ path: `${HOME}/notes/a.txt`, content: "hi" }, human());
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ via: "write", roots: [`${HOME}/notes/a.txt`] });
    const read = await env.readTextFile(`${HOME}/notes/a.txt`, { abortSignal: undefined });
    expect(read.ok && read.value).toBe("hi");
  });

  test("a denied write is refused as outside_root and nothing is written", async () => {
    const { env, files } = filesSetup("deny");
    const error = await rejection(
      files.write({ path: `${HOME}/notes/a.txt`, content: "hi" }, human()),
    );
    expect(error.data.code).toBe("denied");
    expect(error.data.detail).toMatchObject({ reason: "outside_root" });
    expect((await env.exists(`${HOME}/notes/a.txt`, { abortSignal: undefined })).ok).toBe(true);
  });

  test("a protected path outside the workspace is refused without asking", async () => {
    const { files, requests } = filesSetup("allow");
    const error = await rejection(
      files.write({ path: `${HOME}/.ssh/authorized_keys`, content: "x" }, human()),
    );
    expect(error.data.detail).toMatchObject({ reason: "outside_root" });
    expect(requests).toHaveLength(0);
  });

  test("an unattended write outside the workspace is refused without asking", async () => {
    const { files, requests } = filesSetup("allow");
    const error = await rejection(
      files.write({ path: `${HOME}/notes/a.txt`, content: "hi" }, human(false)),
    );
    expect(error.data.detail).toMatchObject({ reason: "outside_root" });
    expect(requests).toHaveLength(0);
  });
});

describe("file tools allow-all", () => {
  test("allow all covers file tools too", async () => {
    const { env, files, requests } = filesSetup("allow_all");
    env.mkdir(`${HOME}/other`);
    await files.write({ path: `${HOME}/notes/a.txt`, content: "1" }, human());
    await files.write({ path: `${HOME}/other/b.txt`, content: "2" }, human());
    expect(requests).toHaveLength(1);
    const read = await env.readTextFile(`${HOME}/other/b.txt`, { abortSignal: undefined });
    expect(read.ok && read.value).toBe("2");
  });
});
