import { describe, expect, test } from "bun:test";
import { pathThreadIdOf, shortenHome } from "../../src/views/pages/settings/settings-file-paths.ts";
import { thr } from "../state/helpers.ts";

describe("shortenHome", () => {
  test("replaces a macOS or Linux home prefix with ~", () => {
    expect(shortenHome("/Users/user/.fresnel/settings.json")).toBe("~/.fresnel/settings.json");
    expect(shortenHome("/home/me/code/fresnel/.fresnel/settings.json")).toBe(
      "~/code/fresnel/.fresnel/settings.json",
    );
  });

  test("a bare home directory becomes ~, and a trailing slash is kept", () => {
    expect(shortenHome("/Users/user")).toBe("~");
    expect(shortenHome("/home/me")).toBe("~");
    expect(shortenHome("/home/me/")).toBe("~/");
  });

  test("keeps paths that are not under a home directory", () => {
    expect(shortenHome("/etc/fresnel/managed.json")).toBe("/etc/fresnel/managed.json");
    expect(shortenHome("/private/tmp/claude-501/-Users-user/settings.json")).toBe(
      "/private/tmp/claude-501/-Users-user/settings.json",
    );
    expect(shortenHome("/Users/")).toBe("/Users/");
    expect(shortenHome("/Users//x")).toBe("/Users//x");
    expect(shortenHome("/homes/me/x")).toBe("/homes/me/x");
    expect(shortenHome("relative/Users/me/x")).toBe("relative/Users/me/x");
  });
});

describe("pathThreadIdOf", () => {
  test("uses the open conversation even when it has no folder", () => {
    expect(
      pathThreadIdOf(thr(1), [
        { threadId: thr(2), workspace: "/a", updatedAt: "2026-11-06T09:00:00.000Z" },
      ]),
    ).toBe(thr(1));
    expect(pathThreadIdOf(thr(1), [])).toBe(thr(1));
  });

  test("with none open, takes the most recently updated conversation that has a folder", () => {
    expect(
      pathThreadIdOf(null, [
        { threadId: thr(1), workspace: null, updatedAt: "2026-11-06T09:00:00.000Z" },
        { threadId: thr(2), workspace: "/a", updatedAt: "2026-11-06T03:00:00.000Z" },
        { threadId: thr(3), workspace: "/b", updatedAt: "2026-11-06T05:00:00.000Z" },
        { threadId: thr(4), workspace: "/c", updatedAt: "2026-11-06T04:00:00.000Z" },
      ]),
    ).toBe(thr(3));
  });

  test("a tie in the update time keeps the conversation listed first", () => {
    expect(
      pathThreadIdOf(null, [
        { threadId: thr(5), workspace: "/a", updatedAt: "2026-11-06T05:00:00.000Z" },
        { threadId: thr(6), workspace: "/b", updatedAt: "2026-11-06T05:00:00.000Z" },
      ]),
    ).toBe(thr(5));
  });

  test("is null when no conversation has a folder, or there is none", () => {
    expect(
      pathThreadIdOf(null, [
        { threadId: thr(1), workspace: null, updatedAt: "2026-11-06T05:00:00.000Z" },
      ]),
    ).toBeNull();
    expect(pathThreadIdOf(null, [])).toBeNull();
  });
});
