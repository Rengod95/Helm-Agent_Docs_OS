import { describe, expect, test } from "bun:test";
import { wireError, type WireParams, type WireResult } from "@fresnel/contracts/wire";
import { fakeConnection } from "../settings/fixtures.ts";
import { editMembers, membersFailureOf, readMembers } from "../../src/workbench/index.ts";

// 구성원 호출 틀(members-call.ts) 시험. 연결은 turn-record 시험과 같은 `fakeConnection`을 쓴다.

const EDIT: WireParams<"ext.members.edit"> = {
  dir: "/work/pilot",
  ops: [{ kind: "add", id: "sync", mode: "hook" }],
};

const EDITED: WireResult<"ext.members.edit"> = {
  members: [
    {
      id: "sync",
      registrationId: "pilot/sync",
      title: null,
      layer: "L3",
      hooks: ["boundary.settle.after"],
      drives: false,
      defaultEnabled: false,
      blockIds: [],
    },
  ],
  issues: [],
  changedFiles: ["src/members/sync.ts", ".fresnel-plugin/plugin.json"],
  entryWiring: "manual",
};

describe("구성원 호출 틀", () => {
  test("editMembers sends the edit and returns the host's members, issues and changed files", async () => {
    const host = fakeConnection({ "ext.members.edit": () => Promise.resolve(EDITED) });
    expect(await editMembers(host.connection, EDIT)).toEqual({ ok: true, value: EDITED });
    expect(host.calls).toEqual([{ method: "ext.members.edit", params: EDIT }]);
  });

  test("readMembers sends only the folder and returns the member summaries", async () => {
    const host = fakeConnection({ "ext.members.read": () => Promise.resolve({ members: [] }) });
    expect(await readMembers(host.connection, "/work/pilot")).toEqual({
      ok: true,
      value: { members: [] },
    });
    expect(host.calls).toEqual([{ method: "ext.members.read", params: { dir: "/work/pilot" } }]);
  });

  test("a wire refusal is a host failure that keeps the error, and a lost response is a transport failure", async () => {
    const refused = wireError("jsonrpc.invalidParams", {
      details: { issues: [{ path: "/dir", message: "denied: installed copy" }] },
    });
    const refusing = fakeConnection({ "ext.members.edit": () => Promise.reject(refused) });
    expect(await editMembers(refusing.connection, EDIT)).toEqual({
      ok: false,
      error: { kind: "host", error: refused },
    });
    const cut = new Error("connection closed");
    const closed = fakeConnection({ "ext.members.read": () => Promise.reject(cut) });
    expect(await readMembers(closed.connection, "/work/pilot")).toEqual({
      ok: false,
      error: { kind: "transport", cause: cut },
    });
  });

  test("membersFailureOf tells a wire error from anything else", () => {
    const refused = wireError("store.io");
    expect(membersFailureOf(refused)).toEqual({ kind: "host", error: refused });
    expect(membersFailureOf("boom")).toEqual({ kind: "transport", cause: "boom" });
  });
});
