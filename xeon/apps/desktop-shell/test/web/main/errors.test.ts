import { describe, expect, test } from "bun:test";
import { describeError } from "../../../src/web/main/errors.ts";

describe("describeError listen_failed", () => {
  test("a TLS port already in use names the cause and the setting to change", () => {
    const described = describeError({
      kind: "gateway",
      error: { kind: "listen_failed", listener: "tls", code: "EADDRINUSE" },
    });
    expect(described).toEqual({
      exitCode: 2,
      message:
        "the tls port is already in use by another program (EADDRINUSE); change l4.remote.web.listenTls to a free port",
    });
  });

  test("a privileged port names the permission problem", () => {
    const described = describeError({
      kind: "gateway",
      error: { kind: "listen_failed", listener: "loopback", code: "EACCES" },
    });
    expect(described.message).toBe(
      "no permission to listen on the loopback address (EACCES); change l4.remote.web.listen to a port above 1024",
    );
  });
});
