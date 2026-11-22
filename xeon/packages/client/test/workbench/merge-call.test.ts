import { describe, expect, test } from "bun:test";
import { wireError, type WireParams, type WireResult } from "@fresnel/contracts/wire";
import { fakeConnection } from "../settings/fixtures.ts";
import { mergeMembers } from "../../src/workbench/index.ts";

// 구성원 합치기 호출 틀(merge-call.ts) 시험. 연결은 구성원 시험과 같은 `fakeConnection`을 쓴다.

const MERGE: WireParams<"ext.members.merge"> = {
  dirs: ["/work/alpha", "/work/beta"],
  outDir: "/work/pair",
  name: "pair",
  title: "Pair",
};

const MERGED: WireResult<"ext.members.merge"> = {
  outDir: "/work/pair",
  name: "pair",
  members: [
    {
      id: "alpha",
      registrationId: "pair/alpha",
      title: null,
      layer: "plugin",
      hooks: ["boundary.settle.after"],
      drives: false,
      defaultEnabled: false,
      blockIds: [],
      injects: [],
      tools: [],
    },
  ],
  changedFiles: [".fresnel-plugin/plugin.json"],
  issues: [],
  profileMove: [{ from: "alpha", to: "pair/alpha" }],
};

describe("구성원 합치기 호출 틀", () => {
  test("mergeMembers sends the merge and returns the new folder, its members and the profile moves", async () => {
    const host = fakeConnection({ "ext.members.merge": () => Promise.resolve(MERGED) });
    expect(await mergeMembers(host.connection, MERGE)).toEqual({ ok: true, value: MERGED });
    expect(host.calls).toEqual([{ method: "ext.members.merge", params: MERGE }]);
  });

  test("a wire refusal is a host failure that keeps the error, and a lost response is a transport failure", async () => {
    const refused = wireError("jsonrpc.invalidParams", {
      details: { issues: [{ path: "/dirs", message: "denied: installed copy" }] },
    });
    const refusing = fakeConnection({ "ext.members.merge": () => Promise.reject(refused) });
    expect(await mergeMembers(refusing.connection, MERGE)).toEqual({
      ok: false,
      error: { kind: "host", error: refused },
    });
    const cut = new Error("connection closed");
    const closed = fakeConnection({ "ext.members.merge": () => Promise.reject(cut) });
    expect(await mergeMembers(closed.connection, MERGE)).toEqual({
      ok: false,
      error: { kind: "transport", cause: cut },
    });
  });
});
