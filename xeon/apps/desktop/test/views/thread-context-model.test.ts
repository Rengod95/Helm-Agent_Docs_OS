import { describe, expect, test } from "bun:test";
import type { HostClientView } from "@fresnel/contracts/wire";
import {
  contextLineOf,
  folderNameOf,
  hostOf,
  otherClientsOf,
  pathTailOf,
  type ContextInput,
} from "../../src/views/thread-context-model.ts";

// 대화 맥락 줄(DP-71)이 무엇을 보이고 숨기는지

function client(patch: Partial<HostClientView>): HostClientView {
  return {
    connectionId: "c1",
    transport: "socket",
    writeThreads: 0,
    observedThreads: 0,
    self: false,
    ...patch,
  };
}

const BASE: ContextInput = {
  workspace: "/Users/me/projects/fresnel",
  missing: false,
  target: { kind: "local" },
  webHost: null,
  clients: [],
  git: null,
};

describe("folder name and path tail", () => {
  test("the name is the last segment and the tail keeps two parents", () => {
    expect(folderNameOf("/Users/me/projects/fresnel")).toBe("fresnel");
    expect(folderNameOf("/Users/me/projects/fresnel/")).toBe("fresnel");
    expect(folderNameOf("C:\\work\\api")).toBe("api");
    expect(folderNameOf("/")).toBe("/");
    expect(pathTailOf("/Users/me/projects/fresnel")).toBe("…/me/projects");
    expect(pathTailOf("/work/api")).toBe("/work");
    expect(pathTailOf("/a/b/c")).toBe("/a/b");
    expect(pathTailOf("/api")).toBeNull();
  });
});

describe("contextLineOf", () => {
  test("a thread without a work folder has no line", () => {
    expect(contextLineOf({ ...BASE, workspace: null })).toBeNull();
    expect(contextLineOf({ ...BASE, workspace: "  " })).toBeNull();
  });

  test("a local folder thread shows the folder and this computer, and hides git and clients", () => {
    expect(contextLineOf(BASE)).toEqual({
      folder: {
        name: "fresnel",
        path: "/Users/me/projects/fresnel",
        missing: false,
        isDefault: false,
      },
      git: null,
      host: { kind: "local", name: null, detail: null },
      clients: [],
    });
  });

  test("a missing folder and git data pass through", () => {
    const line = contextLineOf({
      ...BASE,
      missing: true,
      git: { repo: "fresnel", branch: "m4/cyX" },
    });
    expect(line?.folder.missing).toBe(true);
    expect(line?.git).toEqual({ repo: "fresnel", branch: "m4/cyX" });
  });

  test("other attached clients show, this app does not", () => {
    const line = contextLineOf({
      ...BASE,
      clients: [
        client({ connectionId: "me", self: true, name: "fresnel-desktop" }),
        client({ connectionId: "w", name: "fresnel-web" }),
      ],
    });
    expect(line?.clients).toEqual([{ name: "fresnel-web", transport: "socket" }]);
  });
});

describe("hostOf", () => {
  test("local, ssh with and without a label, other remote, and the web shell", () => {
    expect(hostOf({ kind: "local" }, null)).toEqual({ kind: "local", name: null, detail: null });
    expect(
      hostOf({ kind: "remote", address: "ssh://me@devbox/run/fresnel.sock", label: "" }, null),
    ).toEqual({
      kind: "ssh",
      name: "devbox",
      detail: "ssh://me@devbox/run/fresnel.sock",
    });
    expect(
      hostOf(
        { kind: "remote", address: "ssh://me@devbox/run/fresnel.sock", label: "작업 서버" },
        null,
      ),
    ).toEqual({ kind: "ssh", name: "작업 서버", detail: "ssh://me@devbox/run/fresnel.sock" });
    expect(
      hostOf({ kind: "remote", address: "wss://studio.local:8443", label: "스튜디오" }, null),
    ).toEqual({ kind: "remote", name: "스튜디오", detail: "wss://studio.local:8443" });
    expect(hostOf({ kind: "local" }, "studio.local")).toEqual({
      kind: "web",
      name: "studio.local",
      detail: null,
    });
  });
});

describe("otherClientsOf", () => {
  test("drops this app, counts a name once, and falls back to the transport", () => {
    expect(
      otherClientsOf([
        client({ connectionId: "1", self: true }),
        client({ connectionId: "2", name: "cli" }),
        client({ connectionId: "3", name: "cli" }),
        client({ connectionId: "4", transport: "stdio" }),
        client({ connectionId: "5", transport: "stdio", name: " " }),
      ]),
    ).toEqual([
      { name: "cli", transport: "socket" },
      { name: null, transport: "stdio" },
    ]);
  });
});

test("a default folder is flagged so the chip shows words instead of the thread id", () => {
  const line = contextLineOf({
    ...BASE,
    workspace: "/d/default-project/thr_01ABC",
    threadId: "thr_01ABC",
  });
  expect(line?.folder).toEqual({
    name: "thr_01ABC",
    path: "/d/default-project/thr_01ABC",
    missing: false,
    isDefault: true,
  });
});
