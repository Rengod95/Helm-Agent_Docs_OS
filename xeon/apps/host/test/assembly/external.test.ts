import { describe, expect, test } from "bun:test";
import { loadAllOptionsOf } from "../../src/assembly/external.ts";

// 외부 확장 로더에 넘기는 `loadAll` 입력(X.loading-trust §4.3.4). 조립이 정한 화면 앱 정책이 로더까지 그대로 가는지 본다.
const signal = new AbortController().signal;

describe("loadAllOptionsOf", () => {
  test("the screen app policy reaches loadAll unchanged, with the search paths", () => {
    const options = loadAllOptionsOf({
      cwd: "/work",
      extraPaths: ["/opt/ext"],
      uiPolicy: { apps: false, allowProjectApps: true },
      signal,
    });
    expect(options.uiPolicy).toEqual({ apps: false, allowProjectApps: true });
    expect(options.extraPaths).toEqual(["/opt/ext"]);
    expect(options.cwd).toBe("/work");
  });

  test("an empty policy goes down as empty, so the loader's own defaults apply", () => {
    const options = loadAllOptionsOf({ cwd: "/work", extraPaths: [], uiPolicy: {}, signal });
    expect(options.uiPolicy).toEqual({});
  });

  test("the service mode's on-demand project loading is passed through, and omitted when not given", () => {
    expect(
      loadAllOptionsOf({
        cwd: "/work",
        extraPaths: [],
        uiPolicy: {},
        projects: "on_demand",
        signal,
      }).projects,
    ).toBe("on_demand");
    expect(
      loadAllOptionsOf({ cwd: "/work", extraPaths: [], uiPolicy: {}, signal }),
    ).not.toHaveProperty("projects");
  });
});
