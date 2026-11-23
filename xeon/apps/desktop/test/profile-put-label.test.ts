import { describe, expect, test } from "bun:test";
import { catalogOf } from "@fresnel/client/i18n";
import { profileCountOf, putLabelKeyOf } from "../src/views/workbench/profile-use.ts";

// 프로필에 넣기 단추(AGE-77 S-09 마): 들어 있는 프로필 수를 세고, 0개면 "프로필에 넣기", 있으면 "프로필 N개"를 고른다.

const PROFILES = [
  { plugins: [{ name: "reading-board" }, { name: "helm" }] },
  { plugins: [{ name: "helm" }] },
  { plugins: [{ name: "shell-tools" }] },
];

describe("profile put button", () => {
  test("counts the profiles that hold the plugin", () => {
    expect(profileCountOf("helm", PROFILES)).toBe(2);
    expect(profileCountOf("reading-board", PROFILES)).toBe(1);
    expect(profileCountOf("missing", PROFILES)).toBe(0);
    expect(profileCountOf("helm", [])).toBe(0);
  });

  test("0 profiles keeps the plain put label, 1 or more shows the count", () => {
    expect(putLabelKeyOf(0)).toBe("desktop.workbench.use.put");
    expect(putLabelKeyOf(1)).toBe("desktop.workbench.use.profiles");
    expect(putLabelKeyOf(3)).toBe("desktop.workbench.use.profiles");
  });

  test("the count label reads 프로필 1개 in Korean", () => {
    const text = catalogOf("ko")["desktop.workbench.use.profiles"];
    expect(text).toBe("프로필 {count}개");
    expect(catalogOf("ko")["desktop.workbench.use.put"]).toBe("프로필에 넣기");
  });
});
