import { describe, expect, test } from "bun:test";
import { composeAddress, fieldsOfAddress } from "../../src/views/pages/connection/host-address.ts";

// 연결 주소 칸 모델의 값 시험. 조립과 분해를 문자열과 객체 값으로 비교한다.
// 검사 규칙은 `@fresnel/client`의 `parseTargetAddress`·`pinAddress`가 가지므로 여기서는 칸이 어떻게 들어가고 나오는지만 본다.

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
