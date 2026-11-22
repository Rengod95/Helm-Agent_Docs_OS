import { describe, expect, test } from "bun:test";
import { wireError, type WireParams, type WireResult } from "@fresnel/contracts/wire";
import { fakeConnection } from "../settings/fixtures.ts";
import { detachMember } from "../../src/workbench/index.ts";

// 구성원 떼기 호출 틀(detach-call.ts) 시험. 연결은 구성원 시험과 같은 `fakeConnection`을 쓴다.

const DETACH: WireParams<"ext.members.detach"> = {
  dir: "/work/pilot",
  member: "sync",
  outDir: "/work/pilot-sync",
  keepDependency: true,
};

const DETACHED: WireResult<"ext.members.detach"> = {
  outDir: "/work/pilot-sync",
  name: "pilot-sync",
  changedFiles: [".fresnel-plugin/plugin.json", "src/index.ts", "src/root.ts"],
  issues: [],
  profileMove: { from: "pilot/sync", to: "pilot-sync" },
};

describe("구성원 떼기 호출 틀", () => {
  test("detachMember sends the detach and returns the new folder, its name and the profile move", async () => {
    const host = fakeConnection({ "ext.members.detach": () => Promise.resolve(DETACHED) });
    expect(await detachMember(host.connection, DETACH)).toEqual({ ok: true, value: DETACHED });
    expect(host.calls).toEqual([{ method: "ext.members.detach", params: DETACH }]);
  });

  test("a wire refusal is a host failure that keeps the error, and a lost response is a transport failure", async () => {
    const refused = wireError("jsonrpc.invalidParams", {
      details: { issues: [{ path: "/dir", message: "denied: installed copy" }] },
    });
    const refusing = fakeConnection({ "ext.members.detach": () => Promise.reject(refused) });
    expect(await detachMember(refusing.connection, DETACH)).toEqual({
      ok: false,
      error: { kind: "host", error: refused },
    });
    const cut = new Error("connection closed");
    const closed = fakeConnection({ "ext.members.detach": () => Promise.reject(cut) });
    expect(await detachMember(closed.connection, DETACH)).toEqual({
      ok: false,
      error: { kind: "transport", cause: cut },
    });
  });
});
