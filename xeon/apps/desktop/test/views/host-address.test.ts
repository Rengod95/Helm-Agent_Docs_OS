import { describe, expect, test } from "bun:test";
import type { TargetEntry } from "@fresnel/client";
import {
  blankFieldsOf,
  checkHostForm,
  composeAddress,
  fieldErrorsOf,
  fieldsOfAddress,
  hostKindOf,
  suggestLabel,
  switchKind,
  type HostFormValue,
} from "../../src/views/pages/connection/host-address.ts";

// 연결 주소 칸 모델의 값 시험. 조립·분해·이름 제안·칸 오류를 문자열과 객체 값으로 비교한다.
// 검사 규칙은 `@fresnel/client`의 `parseTargetAddress`·`pinAddress`·`addTarget`이 가지므로 여기서는 칸이 그 검사에
// 어떻게 들어가고 어느 칸 탓으로 돌아오는지만 본다.

const PIN = "ab".repeat(32);
/** 대문자와 `:`가 섞인 지문. 저장할 때는 소문자 64자리로 바뀌어야 한다 */
const PIN_TYPED = "AB:".repeat(31) + "AB";

describe("composeAddress", () => {
  test("ssh: 사용자와 포트가 있으면 둘 다 붙는다", () => {
    expect(
      composeAddress("ssh", { user: "me", host: "box", port: "2222", socket: "/run/x.sock" }),
    ).toBe("ssh://me@box:2222/run/x.sock");
  });

  test("ssh: 사용자만 있으면 포트 자리는 없다", () => {
    expect(
      composeAddress("ssh", { user: "me", host: "box", port: "", socket: "/run/x.sock" }),
    ).toBe("ssh://me@box/run/x.sock");
  });

  test("ssh: 포트만 있으면 사용자 자리는 없다", () => {
    expect(
      composeAddress("ssh", { user: "", host: "box", port: "2222", socket: "/run/x.sock" }),
    ).toBe("ssh://box:2222/run/x.sock");
  });

  test("ssh: 사용자와 포트가 없으면 호스트와 소켓만 남는다", () => {
    expect(composeAddress("ssh", { user: "", host: "box", port: "", socket: "/run/x.sock" })).toBe(
      "ssh://box/run/x.sock",
    );
  });

  test("ssh: 호스트가 비면 조립하지 않는다", () => {
    expect(composeAddress("ssh", { user: "me", host: "  ", port: "", socket: "/run/x.sock" })).toBe(
      "",
    );
  });

  test("wss: https://와 wss://는 wss://로 바꾸고 포트가 없으면 8443을 붙인다", () => {
    expect(
      ["https://example.com", "wss://example.com", "example.com"].map((address) =>
        composeAddress("wss", { address, pin: "" }),
      ),
    ).toEqual(["wss://example.com:8443", "wss://example.com:8443", "wss://example.com:8443"]);
  });

  test("wss: 포트가 있으면 그대로 두고, 지문이 있으면 소문자 64자리로 /pin/에 붙인다", () => {
    expect(composeAddress("wss", { address: "example.com:9443", pin: PIN_TYPED })).toBe(
      `wss://example.com:9443/pin/${PIN}`,
    );
  });

  test("wss: 지문 형식이 틀리면 지문 없는 주소를 돌려준다(오류는 칸 검사가 준다)", () => {
    expect(composeAddress("wss", { address: "example.com:9443", pin: "abc" })).toBe(
      "wss://example.com:9443",
    );
  });

  test("unix는 unix:/abs, tcp는 127.0.0.1 루프백 주소로 조립한다", () => {
    expect(composeAddress("unix", { path: "/run/x.sock" })).toBe("unix:/run/x.sock");
    expect(composeAddress("tcp", { port: "7000" })).toBe("tcp://127.0.0.1:7000");
  });
});

describe("fieldsOfAddress", () => {
  test("ssh 주소를 방식과 네 칸으로 풀다", () => {
    expect(fieldsOfAddress("ssh://me@box:2222/run/x.sock")).toEqual({
      ok: true,
      fields: { kind: "ssh", user: "me", host: "box", port: "2222", socket: "/run/x.sock" },
    });
  });

  test("사용자와 포트가 없는 ssh 주소는 그 두 칸을 비운다", () => {
    expect(fieldsOfAddress("ssh://box/run/x.sock")).toEqual({
      ok: true,
      fields: { kind: "ssh", user: "", host: "box", port: "", socket: "/run/x.sock" },
    });
  });

  test("지문이 붙은 wss 주소는 호스트:포트와 지문 칸으로 푼다", () => {
    expect(fieldsOfAddress(`wss://example.com:9443/pin/${PIN}`)).toEqual({
      ok: true,
      fields: { kind: "wss", address: "example.com:9443", pin: PIN },
    });
  });

  test("https 주소를 붙이면 wss 칸으로 바꾸고 포트 8443을 채운다", () => {
    expect(fieldsOfAddress("https://example.com")).toEqual({
      ok: true,
      fields: { kind: "wss", address: "example.com:8443", pin: "" },
    });
  });

  test("unix와 루프백 tcp를 푼다", () => {
    expect(fieldsOfAddress("unix:/run/x.sock")).toEqual({
      ok: true,
      fields: { kind: "unix", path: "/run/x.sock" },
    });
    expect(fieldsOfAddress("tcp://127.0.0.1:7000")).toEqual({
      ok: true,
      fields: { kind: "tcp", port: "7000" },
    });
  });

  test("이 기기 밖의 평문 tcp는 거절한다", () => {
    expect(fieldsOfAddress("tcp://10.0.0.5:7000")).toEqual({ ok: false, reason: "non_loopback" });
  });

  test("상대 경로 unix는 거절한다", () => {
    expect(fieldsOfAddress("unix:run/x.sock")).toEqual({ ok: false, reason: "relative_path" });
  });

  test("절대 경로만 적은 것은 전체 주소가 아니라서 거절한다", () => {
    expect(fieldsOfAddress("/run/x.sock")).toEqual({ ok: false, reason: "bad_format" });
  });

  test("조립한 주소는 같은 칸으로 다시 풀린다", () => {
    const sshFields = { user: "me", host: "box", port: "2222", socket: "/run/x.sock" };
    const address = composeAddress("ssh", sshFields);
    expect(fieldsOfAddress(address)).toEqual({ ok: true, fields: { kind: "ssh", ...sshFields } });
  });
});

describe("suggestLabel", () => {
  test("ssh는 호스트 이름을 쓰고, 호스트가 없으면 소켓의 마지막 조각을 쓴다", () => {
    expect(suggestLabel("ssh", { user: "", host: "box", port: "", socket: "/run/x.sock" })).toBe(
      "box",
    );
    expect(suggestLabel("ssh", { user: "", host: "", port: "", socket: "/run/x.sock" })).toBe(
      "x.sock",
    );
  });

  test("wss는 포트를 뗀 호스트 이름을 쓰고, IPv6는 대괄호 안을 쓴다", () => {
    expect(suggestLabel("wss", { address: "https://example.com:8443", pin: "" })).toBe(
      "example.com",
    );
    expect(suggestLabel("wss", { address: "[::1]:9000", pin: "" })).toBe("::1");
  });

  test("unix는 경로의 마지막 조각을, tcp는 127.0.0.1:<포트>를 쓴다", () => {
    expect(suggestLabel("unix", { path: "/run/x.sock" })).toBe("x.sock");
    expect(suggestLabel("tcp", { port: "7000" })).toBe("127.0.0.1:7000");
  });
});

describe("fieldErrorsOf", () => {
  test("맞는 칸은 오류가 없다", () => {
    expect(
      fieldErrorsOf({ kind: "ssh", user: "me", host: "box", port: "2222", socket: "/run/x.sock" }),
    ).toEqual([]);
    expect(fieldErrorsOf({ kind: "wss", address: "example.com", pin: "" })).toEqual([]);
  });

  test("ssh 호스트가 비면 호스트 칸이 empty다", () => {
    expect(
      fieldErrorsOf({ kind: "ssh", user: "", host: "", port: "", socket: "/run/x.sock" }),
    ).toEqual([{ field: "host", reason: "empty" }]);
  });

  test("ssh 호스트에 @가 섞이면 호스트 칸이 bad_format이다", () => {
    expect(
      fieldErrorsOf({ kind: "ssh", user: "", host: "a@b", port: "", socket: "/run/x.sock" }),
    ).toEqual([{ field: "host", reason: "bad_format" }]);
  });

  test("ssh 포트에 /가 섞이면 포트 칸이 bad_format이다", () => {
    expect(
      fieldErrorsOf({ kind: "ssh", user: "", host: "box", port: "1/2", socket: "/run/x.sock" }),
    ).toEqual([{ field: "port", reason: "bad_format" }]);
  });

  test("ssh 소켓이 /로 시작하지 않으면 소켓 칸이 relative_path다", () => {
    expect(
      fieldErrorsOf({ kind: "ssh", user: "", host: "box", port: "", socket: "run/x.sock" }),
    ).toEqual([{ field: "socket", reason: "relative_path" }]);
  });

  test("ssh 소켓에 공백이 있으면 소켓 칸이 bad_format이다", () => {
    expect(
      fieldErrorsOf({ kind: "ssh", user: "", host: "box", port: "", socket: "/run/a b.sock" }),
    ).toEqual([{ field: "socket", reason: "bad_format" }]);
  });

  test("웹 주소가 비면 주소 칸이 empty다", () => {
    expect(fieldErrorsOf({ kind: "wss", address: "", pin: "" })).toEqual([
      { field: "address", reason: "empty" },
    ]);
  });

  test("지문이 64자리 16진수가 아니면 지문 칸이 bad_fingerprint다", () => {
    expect(fieldErrorsOf({ kind: "wss", address: "example.com", pin: "abc" })).toEqual([
      { field: "pin", reason: "bad_fingerprint" },
    ]);
  });

  test("지문은 콜론과 대문자, 공백을 받는다", () => {
    expect(fieldErrorsOf({ kind: "wss", address: "example.com", pin: PIN_TYPED })).toEqual([]);
    expect(
      fieldErrorsOf({ kind: "wss", address: "example.com", pin: PIN.replace(/(..)/g, "$1 ") }),
    ).toEqual([]);
  });

  test("unix 경로가 상대 경로면 경로 칸이 relative_path다", () => {
    expect(fieldErrorsOf({ kind: "unix", path: "run/x.sock" })).toEqual([
      { field: "path", reason: "relative_path" },
    ]);
  });

  test("tcp 포트가 비면 포트 칸이 empty이고, 범위를 넘으면 bad_format이다", () => {
    expect(fieldErrorsOf({ kind: "tcp", port: "" })).toEqual([{ field: "port", reason: "empty" }]);
    expect(fieldErrorsOf({ kind: "tcp", port: "70000" })).toEqual([
      { field: "port", reason: "bad_format" },
    ]);
  });
});

describe("checkHostForm", () => {
  const empty: readonly TargetEntry[] = [];

  test("칸이 맞으면 이름 칸을 비워도 호스트 이름을 제안 이름으로 저장한다", () => {
    const value: HostFormValue = {
      label: "",
      fields: { kind: "ssh", user: "", host: "box", port: "", socket: "/run/x.sock" },
    };
    expect(checkHostForm(value, empty, "t1")).toEqual({
      ok: true,
      entry: { id: "t1", label: "box", address: "ssh://box/run/x.sock" },
      list: [{ id: "t1", label: "box", address: "ssh://box/run/x.sock" }],
    });
  });

  test("이름을 적었으면 제안 이름 대신 그 이름을 쓴다", () => {
    const value: HostFormValue = {
      label: " 운영 ",
      fields: { kind: "tcp", port: "7000" },
    };
    const checked = checkHostForm(value, empty, "t2");
    expect(checked.ok && checked.entry.label).toBe("운영");
  });

  test("같은 주소가 이미 있으면 칸 밖의 중복 오류를 낸다", () => {
    const items: readonly TargetEntry[] = [
      { id: "t0", label: "box", address: "ssh://box/run/x.sock" },
    ];
    const value: HostFormValue = {
      label: "",
      fields: { kind: "ssh", user: "", host: "box", port: "", socket: "/run/x.sock" },
    };
    expect(checkHostForm(value, items, "t1")).toEqual({
      ok: false,
      errors: [{ field: "target", reason: "duplicate" }],
    });
  });

  test("칸 오류가 있으면 주소를 만들지 않고 그 칸 오류를 돌려준다", () => {
    const value: HostFormValue = {
      label: "",
      fields: { kind: "ssh", user: "", host: "", port: "", socket: "/run/x.sock" },
    };
    expect(checkHostForm(value, empty, "t1")).toEqual({
      ok: false,
      errors: [{ field: "host", reason: "empty" }],
    });
  });
});

describe("방식 바꾸기", () => {
  test("방식의 빈 칸은 그 방식의 모든 칸이 빈 값이다", () => {
    expect(blankFieldsOf("ssh")).toEqual({ kind: "ssh", user: "", host: "", port: "", socket: "" });
    expect(blankFieldsOf("wss")).toEqual({ kind: "wss", address: "", pin: "" });
    expect(blankFieldsOf("unix")).toEqual({ kind: "unix", path: "" });
    expect(blankFieldsOf("tcp")).toEqual({ kind: "tcp", port: "" });
  });

  test("같은 방식을 고르면 값을 그대로 둔다", () => {
    const value: HostFormValue = {
      label: "x",
      fields: { kind: "unix", path: "/run/x.sock" },
    };
    expect(switchKind(value, "unix")).toBe(value);
  });

  test("다른 방식을 고르면 이름은 남고 칸은 그 방식의 빈 칸이 된다", () => {
    const value: HostFormValue = {
      label: "x",
      fields: { kind: "unix", path: "/run/x.sock" },
    };
    expect(switchKind(value, "tcp")).toEqual({ label: "x", fields: { kind: "tcp", port: "" } });
  });

  test("고르기 글을 방식으로 바꾼다. 목록에 없는 글은 undefined다", () => {
    expect(hostKindOf("wss")).toBe("wss");
    expect(hostKindOf("ftp")).toBeUndefined();
  });
});
