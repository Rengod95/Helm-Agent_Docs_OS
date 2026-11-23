import { describe, expect, test } from "bun:test";
import {
  artifactFrameRefusals,
  openArtifactFrame,
  revealArtifact,
  type ArtifactFrameErrorKind,
  type ArtifactInvoke,
} from "../../src/views/artifact/artifact-frames.ts";

// 산출물 화면 틀의 셸 호출 시험. 가짜 셸이 부른 명령과 인자를 기록하고 준비한 답이나 거절을 돌려준다.

// 셸이 주는 프레임 표지 모양(32자 16진수). 비밀이 아니라 시험 값이다
const TOKEN = "0a".repeat(16);

interface Recorded {
  readonly command: string;
  readonly args: unknown;
}

function fakeShell(reply: () => Promise<unknown>): {
  readonly invoke: ArtifactInvoke;
  readonly calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const invoke: ArtifactInvoke = (command, args) => {
    calls.push({ command, args });
    return reply();
  };
  return { invoke, calls };
}

/** 셸이 이 오류로 거절한다 */
function failing(error: Error): Promise<unknown> {
  return Promise.reject(error);
}

/** 셸이 이 답을 준다 */
function answering(reply: unknown): Promise<unknown> {
  return Promise.resolve(reply);
}

/** 답이 주어진 열기 호출 한 번 */
function openReplying(reply: unknown): ReturnType<typeof openArtifactFrame> {
  return openArtifactFrame(fakeShell(() => answering(reply)).invoke, {
    root: null,
    entry: "a.html",
    text: "<p>x</p>",
    wrap: "none",
  });
}

describe("openArtifactFrame", () => {
  test("셸이 토큰과 같은 토큰의 주소를 주면 틀을 연다. 인자는 root, entry, text, wrap이다", async () => {
    const url = `fresnel-artifact://${TOKEN}/index.html`;
    const shell = fakeShell(() => Promise.resolve({ token: TOKEN, url }));
    const result = await openArtifactFrame(shell.invoke, {
      root: "/w",
      entry: "docs/a.html",
      text: null,
      wrap: "none",
    });
    expect(result).toEqual({ ok: true, value: { token: TOKEN, url } });
    expect(shell.calls).toEqual([
      {
        command: "artifact_frame_open",
        args: { root: "/w", entry: "docs/a.html", text: null, wrap: "none" },
      },
    ]);
  });

  test("답의 모양이 틀리면 unavailable이다", async () => {
    const replies: readonly unknown[] = [
      { token: "XYZ", url: "fresnel-artifact://XYZ/a" },
      { token: TOKEN, url: "fresnel-artifact://0000/a" },
      { token: TOKEN },
      null,
    ];
    const results = await Promise.all(replies.map((reply) => openReplying(reply)));
    expect(results).toEqual(replies.map(() => ({ ok: false, error: { kind: "unavailable" } })));
  });

  test("거절된 Error의 message 또는 cause가 kind이면 그 kind로, 그 밖이면 unavailable로 바꾼다", async () => {
    const cases: readonly (readonly [Error, ArtifactFrameErrorKind])[] = [
      [new Error("too_broad"), "too_broad"],
      [new Error("wrapped", { cause: "no_source" }), "no_source"],
      [new Error("boom"), "unavailable"],
    ];
    const results = await Promise.all(
      cases.map(([error]) =>
        openArtifactFrame(fakeShell(() => failing(error)).invoke, {
          root: "/w",
          entry: "a.html",
          text: null,
          wrap: "image",
        }),
      ),
    );
    expect(results).toEqual(cases.map(([, kind]) => ({ ok: false, error: { kind } })));
  });
});

describe("artifactFrameRefusals", () => {
  test("거절된 파일 목록을 그대로 읽는다", async () => {
    const shell = fakeShell(() =>
      Promise.resolve({ refused: [{ path: "a.js", kind: "forbidden_type" }] }),
    );
    const result = await artifactFrameRefusals(shell.invoke, TOKEN);
    expect(result).toEqual({
      ok: true,
      value: [{ path: "a.js", kind: "forbidden_type" }],
    });
    expect(shell.calls).toEqual([{ command: "artifact_frame_status", args: { token: TOKEN } }]);
  });

  test("거절이 없으면 빈 목록이다", async () => {
    const shell = fakeShell(() => Promise.resolve({ refused: [] }));
    expect(await artifactFrameRefusals(shell.invoke, TOKEN)).toEqual({ ok: true, value: [] });
  });

  test("답의 모양이 틀리거나 호출이 실패하면 unavailable이다", async () => {
    const malformed = fakeShell(() => Promise.resolve({ refused: [{ path: 1, kind: "x" }] }));
    expect(await artifactFrameRefusals(malformed.invoke, TOKEN)).toEqual({
      ok: false,
      error: { kind: "unavailable" },
    });
    const failed = fakeShell(() => failing(new Error("gone")));
    expect(await artifactFrameRefusals(failed.invoke, TOKEN)).toEqual({
      ok: false,
      error: { kind: "unavailable" },
    });
  });
});

describe("revealArtifact", () => {
  test("열기가 되면 빈 값의 성공이고, 명령은 토큰을 받는다", async () => {
    const shell = fakeShell(() => Promise.resolve(undefined));
    expect(await revealArtifact(shell.invoke, TOKEN)).toEqual({ ok: true, value: null });
    expect(shell.calls).toEqual([{ command: "artifact_reveal", args: { token: TOKEN } }]);
  });

  test("실패하면 어떤 이유든 unavailable이다", async () => {
    const shell = fakeShell(() => failing(new Error("too_broad")));
    expect(await revealArtifact(shell.invoke, TOKEN)).toEqual({
      ok: false,
      error: { kind: "unavailable" },
    });
  });
});
