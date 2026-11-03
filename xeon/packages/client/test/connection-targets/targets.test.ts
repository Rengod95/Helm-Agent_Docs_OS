import { describe, expect, test } from "bun:test";
import {
  addTarget,
  attachErrorKey,
  type AttachFailureKind,
  filterTargets,
  parseTargetAddress,
  removeTarget,
  TARGET_SEARCH_THRESHOLD,
  TARGETS_KEY,
  targetsStorageOf,
  type TargetEntry,
} from "../../src/connection-targets/index.ts";

// 원격 대상 주소(P-08)와 대상 목록. 주소 문법은 endpoint.ts가 맡고, 여기서는 형식 사유와 루프백 검사를 시험한다.

describe("parseTargetAddress: accepted formats", () => {
  test("unix:/abs gives a unix target", () => {
    expect(parseTargetAddress("unix:/run/user/1000/fresnel/fresnel.sock")).toEqual({
      ok: true,
      target: { kind: "unix", path: "/run/user/1000/fresnel/fresnel.sock" },
    });
  });

  test("ssh with user and port", () => {
    expect(parseTargetAddress("ssh://me@build.local:2222/run/fresnel.sock")).toEqual({
      ok: true,
      target: {
        kind: "ssh",
        user: "me",
        host: "build.local",
        port: 2222,
        socket: "/run/fresnel.sock",
      },
    });
  });

  test("ssh without user or port has null for both", () => {
    expect(parseTargetAddress("ssh://build/run/fresnel.sock")).toEqual({
      ok: true,
      target: { kind: "ssh", user: null, host: "build", port: null, socket: "/run/fresnel.sock" },
    });
  });

  test("tcp to 127.0.0.1, localhost and bracketed ::1 (brackets dropped) is accepted", () => {
    expect(parseTargetAddress("tcp://127.0.0.1:7421")).toEqual({
      ok: true,
      target: { kind: "tcp", host: "127.0.0.1", port: 7421 },
    });
    expect(parseTargetAddress("tcp://localhost:7421")).toEqual({
      ok: true,
      target: { kind: "tcp", host: "localhost", port: 7421 },
    });
    expect(parseTargetAddress("tcp://[::1]:7421")).toEqual({
      ok: true,
      target: { kind: "tcp", host: "::1", port: 7421 },
    });
  });

  test("surrounding spaces are ignored", () => {
    expect(parseTargetAddress("  unix:/tmp/a.sock  ")).toEqual({
      ok: true,
      target: { kind: "unix", path: "/tmp/a.sock" },
    });
  });

  test("port 1 and 65535 are the port bounds and both pass", () => {
    expect(parseTargetAddress("tcp://127.0.0.1:1")).toEqual({
      ok: true,
      target: { kind: "tcp", host: "127.0.0.1", port: 1 },
    });
    expect(parseTargetAddress("tcp://127.0.0.1:65535")).toEqual({
      ok: true,
      target: { kind: "tcp", host: "127.0.0.1", port: 65_535 },
    });
  });
});

describe("parseTargetAddress: reason empty", () => {
  test("an empty or blank text is empty", () => {
    expect(parseTargetAddress("")).toEqual({ ok: false, reason: "empty" });
    expect(parseTargetAddress("   ")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("parseTargetAddress: reason bad_format", () => {
  test("a bare absolute path or an unknown scheme is bad_format", () => {
    expect(parseTargetAddress("/run/fresnel.sock")).toEqual({ ok: false, reason: "bad_format" });
    expect(parseTargetAddress("http://127.0.0.1:7421")).toEqual({
      ok: false,
      reason: "bad_format",
    });
  });

  test("unix: with no path is bad_format", () => {
    expect(parseTargetAddress("unix:")).toEqual({ ok: false, reason: "bad_format" });
  });

  test("a unix path with a space is bad_format, not relative_path", () => {
    expect(parseTargetAddress("unix:/run/my fresnel.sock")).toEqual({
      ok: false,
      reason: "bad_format",
    });
  });

  test("ssh without a socket path is bad_format", () => {
    expect(parseTargetAddress("ssh://build")).toEqual({ ok: false, reason: "bad_format" });
    expect(parseTargetAddress("ssh://me@build:2222")).toEqual({
      ok: false,
      reason: "bad_format",
    });
  });

  test("tcp without a port or with a port out of 1..65535 is bad_format", () => {
    expect(parseTargetAddress("tcp://127.0.0.1")).toEqual({ ok: false, reason: "bad_format" });
    expect(parseTargetAddress("tcp://127.0.0.1:0")).toEqual({ ok: false, reason: "bad_format" });
    expect(parseTargetAddress("tcp://127.0.0.1:65536")).toEqual({
      ok: false,
      reason: "bad_format",
    });
  });

  test("tcp with a path after the port is bad_format", () => {
    expect(parseTargetAddress("tcp://127.0.0.1:7421/run")).toEqual({
      ok: false,
      reason: "bad_format",
    });
  });
});

describe("parseTargetAddress: reason relative_path", () => {
  test("unix: followed by a path that does not start with / is relative_path", () => {
    expect(parseTargetAddress("unix:run/fresnel.sock")).toEqual({
      ok: false,
      reason: "relative_path",
    });
    expect(parseTargetAddress("unix:./fresnel.sock")).toEqual({
      ok: false,
      reason: "relative_path",
    });
  });
});

describe("parseTargetAddress: reason non_loopback", () => {
  test("a tcp host that is not loopback is non_loopback", () => {
    expect(parseTargetAddress("tcp://10.0.0.5:7421")).toEqual({
      ok: false,
      reason: "non_loopback",
    });
    expect(parseTargetAddress("tcp://build.tailnet.ts.net:7421")).toEqual({
      ok: false,
      reason: "non_loopback",
    });
    expect(parseTargetAddress("tcp://[fd7a::1]:7421")).toEqual({
      ok: false,
      reason: "non_loopback",
    });
  });

  test("ssh and unix are not checked for loopback", () => {
    expect(parseTargetAddress("ssh://me@10.0.0.5/run/fresnel.sock")).toEqual({
      ok: true,
      target: {
        kind: "ssh",
        user: "me",
        host: "10.0.0.5",
        port: null,
        socket: "/run/fresnel.sock",
      },
    });
  });
});

describe("addTarget and the target list", () => {
  const LOCAL: TargetEntry = { id: "t1", label: "로컬 서비스", address: "unix:/tmp/a.sock" };
  const BUILD: TargetEntry = {
    id: "t2",
    label: "build-box",
    address: "ssh://me@build/run/fresnel.sock",
  };

  test("adds a valid target with its address trimmed", () => {
    expect(
      addTarget([LOCAL], { id: "t3", label: "맥미니", address: " tcp://127.0.0.1:7421 " }),
    ).toEqual({
      ok: true,
      list: [LOCAL, { id: "t3", label: "맥미니", address: "tcp://127.0.0.1:7421" }],
    });
  });

  test("a duplicate address is rejected with reason duplicate", () => {
    expect(
      addTarget([LOCAL], { id: "t9", label: "다른 이름", address: "unix:/tmp/a.sock" }),
    ).toEqual({ ok: false, reason: "duplicate" });
  });

  test("a duplicate id is rejected with reason duplicate", () => {
    expect(addTarget([LOCAL], { id: "t1", label: "x", address: "unix:/tmp/b.sock" })).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  test("an address that does not parse is rejected with its reason", () => {
    expect(addTarget([LOCAL], { id: "t4", label: "x", address: "tcp://10.0.0.5:7421" })).toEqual({
      ok: false,
      reason: "non_loopback",
    });
    expect(addTarget([LOCAL], { id: "t5", label: "x", address: "unix:tmp/a.sock" })).toEqual({
      ok: false,
      reason: "relative_path",
    });
  });

  test("removeTarget drops the entry with that id", () => {
    expect(removeTarget([LOCAL, BUILD], "t1")).toEqual([BUILD]);
    expect(removeTarget([LOCAL, BUILD], "none")).toEqual([LOCAL, BUILD]);
  });

  test("filterTargets matches label or address, ignoring case; a blank query gives all", () => {
    const list = [LOCAL, BUILD];
    expect(filterTargets(list, "BUILD")).toEqual([BUILD]);
    expect(filterTargets(list, "/TMP/")).toEqual([LOCAL]);
    expect(filterTargets(list, "  ")).toEqual(list);
    expect(filterTargets(list, "없는")).toEqual([]);
  });

  test("the search box threshold is 20 and the storage key is the desktop key", () => {
    expect(TARGET_SEARCH_THRESHOLD).toBe(20);
    expect(TARGETS_KEY).toBe("l4.desktop.targets");
  });
});

describe("targetsStorageOf", () => {
  test("a valid stored list comes back as it is", () => {
    const stored = [
      { id: "t1", label: "로컬 서비스", address: "unix:/tmp/a.sock" },
      { id: "t2", label: "build-box", address: "ssh://me@build/run/fresnel.sock" },
    ];
    expect(targetsStorageOf(stored)).toEqual(stored);
  });

  test("a value that is not an array gives an empty list", () => {
    expect(targetsStorageOf(undefined)).toEqual([]);
    expect(targetsStorageOf({ id: "t1" })).toEqual([]);
    expect(targetsStorageOf("unix:/tmp/a.sock")).toEqual([]);
  });

  test("malformed entries, unparsable and non-loopback addresses, and duplicates are dropped", () => {
    const stored: unknown[] = [
      { id: "t1", label: "ok", address: "unix:/tmp/a.sock" },
      { id: "", label: "빈 id", address: "unix:/tmp/b.sock" },
      { id: "t3", label: "주소 없음" },
      { id: "t4", label: "원격 평문", address: "tcp://10.0.0.5:7421" },
      { id: "t5", label: "깨진 주소", address: "unix:tmp/c.sock" },
      { id: "t6", label: "같은 주소", address: "unix:/tmp/a.sock" },
      "문자열 항목",
      null,
      { id: "t7", label: "loopback", address: "tcp://localhost:7421" },
    ];
    expect(targetsStorageOf(stored)).toEqual([
      { id: "t1", label: "ok", address: "unix:/tmp/a.sock" },
      { id: "t7", label: "loopback", address: "tcp://localhost:7421" },
    ]);
  });

  test("extra fields on a stored entry are not kept", () => {
    expect(
      targetsStorageOf([{ id: "t1", label: "ok", address: "unix:/tmp/a.sock", extra: true }]),
    ).toEqual([{ id: "t1", label: "ok", address: "unix:/tmp/a.sock" }]);
  });
});

describe("attachErrorKey", () => {
  test("each connection failure kind has its own message key", () => {
    const kinds: readonly AttachFailureKind[] = ["tunnel", "auth", "protocol", "other"];
    expect(kinds.map((kind) => attachErrorKey(kind))).toEqual([
      "desktop.connection.error.tunnel",
      "desktop.connection.error.auth",
      "desktop.connection.error.protocol",
      "desktop.connection.error.other",
    ]);
  });
});
