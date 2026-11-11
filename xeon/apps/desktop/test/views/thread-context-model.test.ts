import { expect, test } from "bun:test";
import type { HostClientView } from "@fresnel/contracts/wire";
import {
  contextItemsOf,
  folderNameOf,
  hostOf,
  otherClientsOf,
  pathTailOf,
} from "../../src/views/thread-context-model.ts";

const client = (over: Partial<HostClientView>): HostClientView => ({
  connectionId: "c1",
  transport: "socket",
  writeThreads: 0,
  observedThreads: 0,
  self: false,
  ...over,
});

test("folder name and path tail keep the last two parent segments", () => {
  expect(folderNameOf("/Users/a/work/fresnel")).toBe("fresnel");
  expect(folderNameOf("C:\\dev\\app\\")).toBe("app");
  expect(folderNameOf("/")).toBe("/");
  expect(pathTailOf("/Users/a/work/fresnel")).toBe("…/a/work");
  expect(pathTailOf("/work/fresnel")).toBe("work");
  expect(pathTailOf("/fresnel")).toBeNull();
});

test("host: local, ssh by label, ssh by host, other remote", () => {
  expect(hostOf({ kind: "local" })).toEqual({ host: "local", name: null });
  expect(
    hostOf({ kind: "remote", address: "ssh://me@box.example/run/f.sock", label: "작업 서버" }),
  ).toEqual({ host: "ssh", name: "작업 서버" });
  expect(hostOf({ kind: "remote", address: "ssh://me@box.example/run/f.sock", label: "" })).toEqual(
    { host: "ssh", name: "box.example" },
  );
  expect(hostOf({ kind: "remote", address: "wss://gw.example:8443", label: "게이트웨이" })).toEqual(
    {
      host: "web",
      name: "게이트웨이",
    },
  );
});

test("other clients drop this app and repeated names", () => {
  expect(
    otherClientsOf([
      client({ connectionId: "a", self: true, name: "fresnel-desktop" }),
      client({ connectionId: "b", name: "vscode" }),
      client({ connectionId: "c", name: "vscode" }),
      client({ connectionId: "d", transport: "stdio" }),
    ]),
  ).toEqual([
    { name: "vscode", transport: "socket" },
    { name: null, transport: "stdio" },
  ]);
});

test("no folder means no items; a folder alone shows folder and host", () => {
  const base = { target: { kind: "local" } as const, clients: [], git: null };
  expect(contextItemsOf({ ...base, workspace: null })).toEqual([]);
  expect(contextItemsOf({ ...base, workspace: "  " })).toEqual([]);
  expect(contextItemsOf({ ...base, workspace: "/Users/a/work/fresnel" })).toEqual([
    { kind: "folder", name: "fresnel", path: "/Users/a/work/fresnel", tail: "…/a/work" },
    { kind: "host", host: "local", name: null },
  ]);
});

test("project and clients appear only when there is data", () => {
  const items = contextItemsOf({
    workspace: "/w/p",
    target: { kind: "remote", address: "ssh://box/run/s", label: "box" },
    clients: [client({ self: true }), client({ connectionId: "z", name: "web" })],
    git: { repo: "p", branch: "main" },
  });
  expect(items.map((item) => item.kind)).toEqual(["folder", "project", "host", "clients"]);
  expect(items[1]).toEqual({ kind: "project", repo: "p", branch: "main" });
  expect(items[2]).toEqual({ kind: "host", host: "ssh", name: "box" });
});
