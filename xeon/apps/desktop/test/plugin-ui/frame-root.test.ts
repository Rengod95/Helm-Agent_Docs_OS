import { describe, expect, test } from "bun:test";
import { err } from "@fresnel/contracts";
import { buildAppUrl } from "@fresnel/client/views/app";
import { isWebDocument, resolveWebFrameRoot } from "../../src/plugin-ui/frame-root.ts";

const TOKEN = "view-token-".padEnd(43, "x");

describe("web frame root", () => {
  test("a document opened over http or https is the web, Electron's scheme is not", () => {
    expect(isWebDocument({ protocol: "https:" })).toBe(true);
    expect(isWebDocument({ protocol: "http:" })).toBe(true);
    expect(isWebDocument({ protocol: "app:" })).toBe(false);
    expect(isWebDocument({ protocol: "file:" })).toBe(false);
  });

  test("the gateway's token path becomes the root and builds the frame address", async () => {
    const asked: string[] = [];
    const root = await resolveWebFrameRoot((command) => {
      asked.push(command);
      return Promise.resolve({ path: `/view/${TOKEN}/`, expiresAt: 5 });
    }, "https://origin.example:8443");
    expect(asked).toEqual(["view_root"]);
    expect(root).toEqual({ ok: true, value: `https://origin.example:8443/view/${TOKEN}/` });
    if (!root.ok) throw new Error("no root");
    expect(buildAppUrl("helm", "1.0.0", "index.html", undefined, root.value)).toBe(
      `https://origin.example:8443/view/${TOKEN}/helm/1.0.0/index.html`,
    );
  });

  test("a rejected command or a wrong reply is view_root_unavailable", async () => {
    const unavailable = err({ kind: "view_root_unavailable" } as const);
    const rejected = await resolveWebFrameRoot(
      () => Promise.reject(new Error("unknown-command")),
      "https://x.test",
    );
    expect(rejected).toEqual(unavailable);
    const replies = [
      null,
      "path",
      {},
      { path: 5 },
      { path: "/view/short/" },
      { path: "https://evil.test/" },
    ];
    const results = await Promise.all(
      replies.map((reply) => resolveWebFrameRoot(async () => reply, "https://x.test")),
    );
    expect(results).toEqual(replies.map(() => unavailable));
  });
});
