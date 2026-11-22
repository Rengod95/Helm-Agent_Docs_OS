import { describe, expect, test } from "bun:test";
import type { DependencyDecl, ExtensionManifest, PluginDecl } from "@fresnel/contracts/extensions";
import {
  blockingDependents,
  checkDependencies,
  dependencyViewOf,
  dependentsOf,
  enableOrder,
  missingForEnabled,
  updateBreaks,
  type DependencyNode,
} from "../../src/loading-trust/index.ts";

/** 루트 플러그인(id 없음)과 그 의존 목록 */
function root(dependsOn: readonly DependencyDecl[] = []): PluginDecl {
  return { layer: "plugin", hooks: [], dependsOn: [...dependsOn] };
}

/** 확장 한 개(설치되어 검토를 지난 판). 매니페스트는 ExtensionManifest 타입을 만족하게 직접 만든다 */
function ext(
  name: string,
  version: string,
  plugins: readonly PluginDecl[] = [root()],
): DependencyNode {
  const manifest: ExtensionManifest = {
    schemaVersion: 2,
    name,
    version,
    entry: "./src/index.ts",
    plugins: [...plugins],
  };
  return { name, version, manifest };
}

describe("checkDependencies", () => {
  test("a missing target is target_missing, and a hard one blocks", () => {
    const report = checkDependencies(
      ext("app", "1.0.0", [root([{ plugin: "core", kind: "hard" }])]),
      [],
    );
    expect(report).toEqual({
      blocking: [
        {
          code: "target_missing",
          from: "app",
          target: "core",
          kind: "hard",
          range: null,
          found: null,
        },
      ],
      warnings: [],
    });
  });

  test("a missing member is member_missing", () => {
    const report = checkDependencies(
      ext("app", "1.0.0", [root([{ plugin: "core/ui", kind: "hard" }])]),
      [ext("core", "1.0.0", [root(), { id: "tools", layer: "L3", hooks: [] }])],
    );
    expect(report).toEqual({
      blocking: [
        {
          code: "member_missing",
          from: "app",
          target: "core/ui",
          kind: "hard",
          range: null,
          found: null,
        },
      ],
      warnings: [],
    });
  });

  test("a version outside the range is range_unmet with the found version; a match is clean", () => {
    const subject = ext("app", "1.0.0", [
      root([{ plugin: "core", kind: "hard", range: "^1.0.0" }]),
    ]);
    expect(checkDependencies(subject, [ext("core", "2.1.0")])).toEqual({
      blocking: [
        {
          code: "range_unmet",
          from: "app",
          target: "core",
          kind: "hard",
          range: "^1.0.0",
          found: "2.1.0",
        },
      ],
      warnings: [],
    });
    expect(checkDependencies(subject, [ext("core", "1.4.0")])).toEqual({
      blocking: [],
      warnings: [],
    });
  });

  test("hard problems block, and soft problems only warn (soft is the default kind)", () => {
    const subject = ext("app", "1.0.0", [
      root([{ plugin: "core", kind: "hard", range: "^1.0.0" }, { plugin: "notes" }]),
    ]);
    expect(checkDependencies(subject, [])).toEqual({
      blocking: [
        {
          code: "target_missing",
          from: "app",
          target: "core",
          kind: "hard",
          range: "^1.0.0",
          found: null,
        },
      ],
      warnings: [
        {
          code: "target_missing",
          from: "app",
          target: "notes",
          kind: "soft",
          range: null,
          found: null,
        },
      ],
    });
  });
});

describe("dependentsOf", () => {
  const nodes = [
    ext("core", "1.0.0", [root(), { id: "ui", layer: "L3", hooks: [] }]),
    ext("app", "1.0.0", [root([{ plugin: "core/ui", kind: "hard" }])]),
    ext("tools", "1.0.0", [root([{ plugin: "core" }])]),
    ext("other", "1.0.0", [root([{ plugin: "core/db" }])]),
  ];

  test("an extension name also collects dependencies on its members", () => {
    expect(dependentsOf("core", nodes)).toEqual([
      {
        extension: "app",
        dependency: {
          from: "app",
          target: "core/ui",
          targetExtension: "core",
          targetMember: "ui",
          range: null,
          kind: "hard",
        },
      },
      {
        extension: "tools",
        dependency: {
          from: "tools",
          target: "core",
          targetExtension: "core",
          targetMember: null,
          range: null,
          kind: "soft",
        },
      },
      {
        extension: "other",
        dependency: {
          from: "other",
          target: "core/db",
          targetExtension: "core",
          targetMember: "db",
          range: null,
          kind: "soft",
        },
      },
    ]);
  });

  test("a member id collects only that member's dependencies and whole-extension ones", () => {
    expect(dependentsOf("core/ui", nodes).map((d) => d.extension)).toEqual(["app", "tools"]);
  });
});

describe("blockingDependents", () => {
  const nodes = [
    ext("core", "1.0.0"),
    ext("app", "1.0.0", [root([{ plugin: "core", kind: "hard" }])]),
    ext("legacy", "1.0.0", [root([{ plugin: "core", kind: "hard" }])]),
    ext("tools", "1.0.0", [root([{ plugin: "core" }])]),
  ];

  test("only enabled hard dependents block; disabled extensions and soft dependents do not", () => {
    const enabled = new Set(["core", "app", "tools"]);
    expect(blockingDependents(["core"], nodes, enabled)).toEqual([
      {
        extension: "app",
        dependency: {
          from: "app",
          target: "core",
          targetExtension: "core",
          targetMember: null,
          range: null,
          kind: "hard",
        },
      },
    ]);
  });

  test("a dependent that is removed in the same batch does not block", () => {
    const enabled = new Set(["core", "app", "tools"]);
    expect(blockingDependents(["core", "app"], nodes, enabled)).toEqual([]);
  });
});

describe("updateBreaks", () => {
  const nodes = [
    ext("core", "1.0.0", [root(), { id: "ui", layer: "L3", hooks: [] }]),
    ext("app", "1.0.0", [root([{ plugin: "core", kind: "hard", range: "^1.0.0" }])]),
    ext("tools", "1.0.0", [root([{ plugin: "core/ui" }])]),
  ];

  test("a new version that breaks a range or drops a member lists the broken expectations", () => {
    const next = ext("core", "2.0.0", [root()]);
    expect(updateBreaks(next, nodes)).toEqual([
      {
        code: "range_unmet",
        from: "app",
        target: "core",
        kind: "hard",
        range: "^1.0.0",
        found: "2.0.0",
      },
      {
        code: "member_missing",
        from: "tools",
        target: "core/ui",
        kind: "soft",
        range: null,
        found: null,
      },
    ]);
  });

  test("a compatible new version breaks nothing", () => {
    const next = ext("core", "1.2.0", [root(), { id: "ui", layer: "L3", hooks: [] }]);
    expect(updateBreaks(next, nodes)).toEqual([]);
  });
});

describe("missingForEnabled", () => {
  const app = ext("app", "1.0.0", [root([{ plugin: "core", kind: "hard" }, { plugin: "notes" }])]);
  const installed = [ext("core", "1.0.0"), ext("notes", "1.0.0"), app];

  test("a target that is installed but not in the enabled list is target_disabled", () => {
    expect(missingForEnabled(["app"], installed)).toEqual({
      blocking: [
        {
          code: "target_disabled",
          from: "app",
          target: "core",
          kind: "hard",
          range: null,
          found: null,
        },
      ],
      warnings: [
        {
          code: "target_disabled",
          from: "app",
          target: "notes",
          kind: "soft",
          range: null,
          found: null,
        },
      ],
    });
    expect(missingForEnabled(["app", "core", "notes"], installed)).toEqual({
      blocking: [],
      warnings: [],
    });
  });

  test("a target that is not installed at all is target_missing", () => {
    expect(missingForEnabled(["app"], [app])).toEqual({
      blocking: [
        {
          code: "target_missing",
          from: "app",
          target: "core",
          kind: "hard",
          range: null,
          found: null,
        },
      ],
      warnings: [
        {
          code: "target_missing",
          from: "app",
          target: "notes",
          kind: "soft",
          range: null,
          found: null,
        },
      ],
    });
  });
});

describe("enableOrder", () => {
  test("a hard target is enabled before its dependent", () => {
    const nodes = [
      ext("app", "1.0.0", [root([{ plugin: "core", kind: "hard" }])]),
      ext("core", "1.0.0"),
    ];
    expect(enableOrder(["app", "core"], nodes)).toEqual(["core", "app"]);
  });

  test("soft targets keep the input order", () => {
    const nodes = [ext("app", "1.0.0", [root([{ plugin: "core" }])]), ext("core", "1.0.0")];
    expect(enableOrder(["app", "core"], nodes)).toEqual(["app", "core"]);
  });

  test("names that are not in the input are not added", () => {
    const nodes = [
      ext("app", "1.0.0", [root([{ plugin: "core", kind: "hard" }])]),
      ext("core", "1.0.0"),
    ];
    expect(enableOrder(["app"], nodes)).toEqual(["app"]);
  });

  test("a hard cycle still lists every name once", () => {
    const nodes = [
      ext("alpha", "1.0.0", [root([{ plugin: "beta", kind: "hard" }])]),
      ext("beta", "1.0.0", [root([{ plugin: "alpha", kind: "hard" }])]),
    ];
    expect(enableOrder(["alpha", "beta"], nodes).toSorted()).toEqual(["alpha", "beta"]);
  });
});

describe("dependencyViewOf", () => {
  test("lists what the subject depends on with a problem code each, and what depends on it", () => {
    const app = ext("app", "1.0.0", [
      root([
        { plugin: "core", kind: "hard", range: "^1.0.0" },
        { plugin: "notes" },
        { plugin: "util", range: ">=1.0.0" },
      ]),
    ]);
    const nodes = [
      app,
      ext("core", "2.0.0"),
      ext("util", "1.4.0"),
      ext("dashboard", "1.0.0", [root([{ plugin: "app" }])]),
    ];
    expect(dependencyViewOf(app, nodes)).toEqual({
      dependsOn: [
        {
          from: "app",
          target: "core",
          targetExtension: "core",
          targetMember: null,
          range: "^1.0.0",
          kind: "hard",
          problem: "range_unmet",
        },
        {
          from: "app",
          target: "notes",
          targetExtension: "notes",
          targetMember: null,
          range: null,
          kind: "soft",
          problem: "target_missing",
        },
        {
          from: "app",
          target: "util",
          targetExtension: "util",
          targetMember: null,
          range: ">=1.0.0",
          kind: "soft",
          problem: null,
        },
      ],
      dependents: [
        {
          extension: "dashboard",
          dependency: {
            from: "dashboard",
            target: "app",
            targetExtension: "app",
            targetMember: null,
            range: null,
            kind: "soft",
          },
        },
      ],
    });
  });
});
