import { describe, expect, test } from "bun:test";
import { computeProtectedPaths, defaultAgeKeyPath } from "../src/protected-paths.ts";

describe("protectedPaths (SC-21)", () => {
  test("protected paths list secret files without values", () => {
    const paths = computeProtectedPaths({
      files: [
        { env: "dev", path: "/home/u/projects/secrets/dev.sops.yaml" },
        { env: "prod", path: "/home/u/projects/secrets/prod.sops.yaml" },
      ],
      configDir: "/home/u/.config/xeon",
      ageKeyFilePath: null,
    });
    expect(paths).toEqual([
      "/home/u/projects/secrets/dev.sops.yaml",
      "/home/u/projects/secrets/prod.sops.yaml",
      "/home/u/.config/xeon/secrets",
      "/home/u/.config/xeon/secrets/age/keys.txt",
    ]);
    for (const path of paths) expect(path.startsWith("/")).toBe(true);
  });

  test("uses the configured key file path and removes duplicates", () => {
    const paths = computeProtectedPaths({
      files: [{ env: "dev", path: "/k/keys.txt" }],
      configDir: "/c",
      ageKeyFilePath: "/k/keys.txt",
    });
    expect(paths).toEqual(["/k/keys.txt", "/c/secrets"]);
    expect(defaultAgeKeyPath("/c")).toBe("/c/secrets/age/keys.txt");
  });

  test("resolves relative file paths to absolute ones", () => {
    const [first] = computeProtectedPaths({
      files: [{ env: "dev", path: "rel/dev.sops.yaml" }],
      configDir: "/c",
      ageKeyFilePath: null,
    });
    expect(first?.startsWith("/")).toBe(true);
    expect(first?.endsWith("/rel/dev.sops.yaml")).toBe(true);
  });
});
