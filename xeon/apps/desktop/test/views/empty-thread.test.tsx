import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { emptyThreadViewOf, hidesFolderPick } from "../../src/views/empty-thread.tsx";
import { ThreadContextBarView } from "../../src/views/thread-context-bar.tsx";

// 새 대화 화면(DP-70)이 무엇을 그릴지와 맥락 줄(DP-71)의 그림

const RECENT = [{ path: "/w/fresnel", count: 3 }];

describe("emptyThreadViewOf", () => {
  test("a folder thread shows the folder name and path, no picker", () => {
    expect(
      emptyThreadViewOf({
        workspace: "/w/fresnel",
        dismissed: false,
        recent: RECENT,
        canPick: true,
      }),
    ).toEqual({ kind: "folder", name: "fresnel", path: "/w/fresnel" });
  });

  test("a thread without a folder shows the picker with the recent folders", () => {
    expect(
      emptyThreadViewOf({ workspace: null, dismissed: false, recent: RECENT, canPick: false }),
    ).toEqual({ kind: "where", recent: RECENT, canPick: false });
  });

  test("after start-without-folder the picker folds away", () => {
    expect(
      emptyThreadViewOf({ workspace: null, dismissed: true, recent: RECENT, canPick: true }),
    ).toEqual({ kind: "noFolder" });
  });
});

describe("ThreadContextBarView", () => {
  test("draws the folder and this computer, and no git or clients item without data", () => {
    const out = renderToString(
      <ThreadContextBarView
        line={{
          folder: { name: "fresnel", path: "/w/fresnel", missing: false, isDefault: false },
          git: null,
          host: { kind: "local", name: null, detail: null },
          clients: [],
        }}
      />,
    );
    expect(out).toContain("fresnel");
    expect(out).toContain("이 컴퓨터");
    expect(out).not.toContain("다른 연결");
    expect(out).not.toContain("data-missing");
  });

  test("a missing folder is a visible warning, and other clients are counted", () => {
    const out = renderToString(
      <ThreadContextBarView
        line={{
          folder: { name: "app", path: "/Users/me/moved/app", missing: true, isDefault: false },
          git: { repo: "app", branch: "main" },
          host: { kind: "ssh", name: "devbox", detail: "ssh://me@devbox/run/fresnel.sock" },
          clients: [{ name: "cli", transport: "socket" }],
        }}
      />,
    );
    expect(out).toContain("폴더를 찾을 수 없어요");
    expect(out).toContain("data-missing");
    expect(out).toContain("main");
    expect(out).toContain("devbox");
    expect(out).toContain("다른 연결 1");
  });
});

describe("which threads skip the folder picker (R-08)", () => {
  test("a test chat and a test run open straight to the conversation; others keep the picker", () => {
    expect(hidesFolderPick({ craftChat: { plugin: null } })).toBe(true);
    expect(hidesFolderPick({ testRun: { paused: false } })).toBe(true);
    expect(hidesFolderPick({})).toBe(false);
    expect(hidesFolderPick(undefined)).toBe(false);
  });
});
