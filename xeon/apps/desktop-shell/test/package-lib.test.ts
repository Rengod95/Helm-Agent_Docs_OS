import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  dirBytes,
  githubFeedText,
  isPrunableLocaleDir,
  KEPT_LOCALES,
  localeDirsOf,
  mibOf,
  pruneLocales,
} from "../scripts/package-lib.ts";

describe("isPrunableLocaleDir", () => {
  test("keeps en and ko and prunes the other locale folders", () => {
    expect(KEPT_LOCALES).toEqual(["en", "ko"]);
    expect(isPrunableLocaleDir("en.lproj")).toBe(false);
    expect(isPrunableLocaleDir("ko.lproj")).toBe(false);
    expect(isPrunableLocaleDir("fr.lproj")).toBe(true);
    expect(isPrunableLocaleDir("en_GB.lproj")).toBe(true);
    expect(isPrunableLocaleDir("af_FEMININE.lproj")).toBe(true);
  });

  test("never prunes anything that is not a locale folder", () => {
    expect(isPrunableLocaleDir("Info.plist")).toBe(false);
    expect(isPrunableLocaleDir("MainMenu.nib")).toBe(false);
    expect(isPrunableLocaleDir("fr")).toBe(false);
  });
});

describe("pruneLocales", () => {
  test("removes the pruned folders, keeps the rest and counts the removed", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "prune-"));
    try {
      for (const name of ["en.lproj", "ko.lproj", "fr.lproj", "de.lproj"]) {
        mkdirSync(path.join(dir, name));
        writeFileSync(path.join(dir, name, "locale.pak"), "x");
      }
      writeFileSync(path.join(dir, "Info.plist"), "plist");
      expect(pruneLocales(dir)).toBe(2);
      expect(readdirSync(dir).toSorted()).toEqual(["Info.plist", "en.lproj", "ko.lproj"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sizes and places", () => {
  test("dirBytes sums files below the folder", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bytes-"));
    try {
      mkdirSync(path.join(dir, "a"));
      writeFileSync(path.join(dir, "a", "one"), "12345");
      writeFileSync(path.join(dir, "two"), "123");
      expect(dirBytes(dir)).toBe(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("mibOf rounds to one decimal", () => {
    expect(mibOf(1024 * 1024 * 1.26)).toBe(1.3);
  });

  test("the locale folders are the app Resources and the Electron Framework Resources", () => {
    expect(localeDirsOf("/x/Fresnel.app")).toEqual([
      "/x/Fresnel.app/Contents/Resources",
      "/x/Fresnel.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources",
    ]);
  });
});

describe("githubFeedText", () => {
  test("builds a github feed from owner/repo", () => {
    expect(githubFeedText(" acme/fresnel.app ")).toBe(
      '{"provider":"github","owner":"acme","repo":"fresnel.app"}\n',
    );
  });

  test("anything else is null", () => {
    for (const bad of [undefined, "", "acme", "a/b/c", "a b/c", "/c", "a/"]) {
      expect(githubFeedText(bad)).toBeNull();
    }
  });
});
