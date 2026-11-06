import { describe, expect, test } from "bun:test";
import { augmentEnvPath, augmentPath } from "../src/main/env-path.ts";

const ADDED =
  "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/Users/u/.local/bin:/Users/u/.nix-profile/bin";

describe("PATH augmentation", () => {
  test("a Finder path gets the tool dirs appended in order", () => {
    expect(augmentPath("/usr/bin:/bin:/usr/sbin:/sbin", "/Users/u", "darwin")).toBe(
      `/usr/bin:/bin:/usr/sbin:/sbin:${ADDED}`,
    );
  });

  test("a dir already on the path is not repeated and keeps its place", () => {
    expect(augmentPath("/usr/local/bin:/usr/bin:/opt/homebrew/bin", "/Users/u", "darwin")).toBe(
      "/usr/local/bin:/usr/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/Users/u/.local/bin:/Users/u/.nix-profile/bin",
    );
  });

  test("user dirs stay first and a home dir already listed is kept where it is", () => {
    expect(augmentPath("/Users/u/.local/bin:/Users/u/bin:/usr/bin", "/Users/u", "darwin")).toBe(
      "/Users/u/.local/bin:/Users/u/bin:/usr/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/Users/u/.nix-profile/bin",
    );
  });

  test("without a home only the fixed dirs are added", () => {
    expect(augmentPath("/usr/bin:/bin", null, "darwin")).toBe(
      "/usr/bin:/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin",
    );
  });

  test("a missing or empty path yields only the added dirs", () => {
    expect(augmentPath(undefined, "/Users/u", "darwin")).toBe(ADDED);
    expect(augmentPath("", "/Users/u", "darwin")).toBe(ADDED);
    expect(augmentPath("/usr/bin::", null, "darwin")).toBe(
      "/usr/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin",
    );
  });

  test("a value that cannot be joined is returned unchanged", () => {
    expect(augmentPath("/usr/bin", "/Users/a:b", "darwin")).toBe("/usr/bin");
    expect(augmentPath(undefined, "/Users/a:b", "darwin")).toBe("");
  });

  test("the same directory written with a trailing slash or a doubled slash counts as present", () => {
    expect(augmentPath("/opt/homebrew/bin/:/usr//local/bin", null, "darwin")).toBe(
      "/opt/homebrew/bin/:/usr//local/bin:/opt/homebrew/sbin",
    );
  });

  test("the env record supplies PATH and the rules are the same", () => {
    expect(augmentEnvPath({ PATH: "/usr/bin:/bin", HOME: "/Users/u" }, "darwin", "/Users/u")).toBe(
      `/usr/bin:/bin:${ADDED}`,
    );
    expect(augmentEnvPath({}, "darwin", null)).toBe(
      "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin",
    );
  });
});
