import { describe, expect, test } from "bun:test";
import {
  secretChoicesOf,
  secretNameOf,
  secretRefOf,
} from "../../src/views/pages/settings/settings-secret-model.ts";

// 시크릿 참조 모델. 값은 `secret://<이름>` 글이고, 이름만 다룬다.

describe("secretNameOf and secretRefOf", () => {
  test("a reference reads back to its name and a name makes the reference", () => {
    expect(secretNameOf("secret://github-token")).toBe("github-token");
    expect(secretRefOf("github-token")).toBe("secret://github-token");
  });

  test("a value that is not a reference, or a reference without a name, has no name", () => {
    expect(secretNameOf("github-token")).toBeNull();
    expect(secretNameOf("secret://")).toBeNull();
    expect(secretNameOf(null)).toBeNull();
    expect(secretNameOf(3)).toBeNull();
  });
});

describe("secretChoicesOf", () => {
  test("the names are sorted and unique", () => {
    expect(secretChoicesOf(["b", "a", "a"], null)).toEqual(["a", "b"]);
  });

  test("the current name is shown even when the list does not have it", () => {
    expect(secretChoicesOf(["b", "a"], "c")).toEqual(["a", "b", "c"]);
    expect(secretChoicesOf(["a"], "a")).toEqual(["a"]);
    expect(secretChoicesOf([], null)).toEqual([]);
  });
});
