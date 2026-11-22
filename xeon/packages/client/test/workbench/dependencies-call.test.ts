import { describe, expect, test } from "bun:test";
import { wireError, type WireParams, type WireResult } from "@fresnel/contracts/wire";
import { fakeConnection } from "../settings/fixtures.ts";
import { editDependencies, readDependencies } from "../../src/workbench/index.ts";

// 의존 호출 틀(dependencies-call.ts) 시험. 연결은 구성원 시험과 같은 `fakeConnection`을 쓴다.

const EDIT: WireParams<"ext.dependencies.edit"> = {
  dir: "/work/pilot",
  ops: [{ kind: "add", from: "sync", dependency: { plugin: "base-kit", kind: "hard" } }],
};

const EDITED: WireResult<"ext.dependencies.edit"> = {
  dependencies: [{ from: "pilot/sync", target: "base-kit", kind: "hard", range: null }],
  issues: [],
  changedFiles: [".fresnel-plugin/plugin.json"],
};

describe("의존 호출 틀", () => {
  test("editDependencies sends the edit and returns the dependency lines, issues and changed files", async () => {
    const host = fakeConnection({ "ext.dependencies.edit": () => Promise.resolve(EDITED) });
    expect(await editDependencies(host.connection, EDIT)).toEqual({ ok: true, value: EDITED });
    expect(host.calls).toEqual([{ method: "ext.dependencies.edit", params: EDIT }]);
  });

  test("readDependencies sends only the folder and returns the dependency lines", async () => {
    const host = fakeConnection({
      "ext.dependencies.read": () => Promise.resolve({ dependencies: [] }),
    });
    expect(await readDependencies(host.connection, "/work/pilot")).toEqual({
      ok: true,
      value: { dependencies: [] },
    });
    expect(host.calls).toEqual([
      { method: "ext.dependencies.read", params: { dir: "/work/pilot" } },
    ]);
  });

  test("a wire refusal is a host failure that keeps the error, and a lost response is a transport failure", async () => {
    const refused = wireError("jsonrpc.invalidParams", {
      details: { issues: [{ path: "/dir", message: "denied: installed copy" }] },
    });
    const refusing = fakeConnection({ "ext.dependencies.edit": () => Promise.reject(refused) });
    expect(await editDependencies(refusing.connection, EDIT)).toEqual({
      ok: false,
      error: { kind: "host", error: refused },
    });
    const cut = new Error("connection closed");
    const closed = fakeConnection({ "ext.dependencies.read": () => Promise.reject(cut) });
    expect(await readDependencies(closed.connection, "/work/pilot")).toEqual({
      ok: false,
      error: { kind: "transport", cause: cut },
    });
  });
});
