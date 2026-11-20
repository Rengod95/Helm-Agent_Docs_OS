import { describe, expect, test } from "bun:test";
import {
  SCRIPT_LIMITS,
  isScriptFileValid,
  validateManifest,
  type ManifestScriptDecl,
  type ScriptEnvDecl,
} from "../../src/extensions/index.ts";
import { codesOf, pluginJson, validManifest } from "./helpers.ts";

// 설계 B(플러그인 자기 스크립트 실행, 이름 `scripts`·`script_*`는 [제안]): 매니페스트 선언과 위치 검사.
// 값으로 비교한다. 거부는 이슈 코드와 경로까지, 통과는 돌려준 매니페스트의 값까지 본다.

const bare = { schemaVersion: 2, name: "acme-notes", version: "1.0.0" };

const lint: ManifestScriptDecl = { name: "lint", runner: "sh", file: "scripts/lint.sh" };

/** 매니페스트 바닥(entry 없음)에 scripts만 얹는다 */
function withScripts(scripts: unknown): Record<string, unknown> {
  return { ...bare, scripts };
}

/** 한 실패가 같은 코드를 여러 번 낼 수 있어 종류만 본다 */
function distinctCodes(issues: Parameters<typeof codesOf>[0]): string[] {
  return [...new Set(codesOf(issues))];
}

describe("scripts declaration (설계 B [제안])", () => {
  test("a manifest without scripts is valid and has no scripts key", () => {
    const manifest = validManifest(bare);
    expect(manifest.scripts).toBeUndefined();
  });

  test("a full declaration passes and comes back by value", () => {
    const declared: ManifestScriptDecl = {
      name: "lint-changed",
      runner: "bash",
      file: "scripts/lint.sh",
      args: ["--changed", "--format=short"],
      timeoutMs: 30000,
      envNames: ["LINT_LEVEL"],
    };
    const result = validateManifest(withScripts([declared]));
    expect(result.issues).toEqual([]);
    expect(result.manifest?.scripts).toEqual([declared]);
  });

  test("only name, runner and file are required", () => {
    const result = validateManifest(withScripts([lint]));
    expect(result.issues).toEqual([]);
    expect(result.manifest?.scripts).toEqual([lint]);
    for (const field of ["name", "runner", "file"]) {
      const decl: Record<string, unknown> = { ...lint };
      delete decl[field];
      const missing = validateManifest(withScripts([decl]));
      expect(missing.manifest).toBeUndefined();
      expect(distinctCodes(missing.issues)).toEqual(["schema"]);
    }
  });

  test("scripts without entry are valid, because a script runs only when code calls it", () => {
    expect(validateManifest(withScripts([lint])).issues).toEqual([]);
    expect(validateManifest(pluginJson({ scripts: [lint] })).issues).toEqual([]);
  });

  test("the runner is one of the five in the fixed list, any other runner is a schema error", () => {
    for (const runner of ["sh", "bash", "bun", "node", "python3"]) {
      expect(validateManifest(withScripts([{ ...lint, runner }])).issues).toEqual([]);
    }
    for (const runner of ["ruby", "python", "SH", "", "/bin/sh"]) {
      const result = validateManifest(withScripts([{ ...lint, runner }]));
      expect(result.manifest).toBeUndefined();
      expect(distinctCodes(result.issues)).toEqual(["schema"]);
    }
  });

  test("the name is a lowercase letter then lowercase letters, digits or hyphens, at most 32 characters", () => {
    for (const name of ["a", "lint-changed", "a1-2", "a".repeat(32)]) {
      expect(validateManifest(withScripts([{ ...lint, name }])).issues).toEqual([]);
    }
    for (const name of ["", "Lint", "1lint", "lint_x", "lint.x", "a".repeat(33)]) {
      const result = validateManifest(withScripts([{ ...lint, name }]));
      expect(result.manifest).toBeUndefined();
      expect(distinctCodes(result.issues)).toEqual(["schema"]);
    }
  });

  test("a repeated name is script_duplicate at every later index and no manifest is returned", () => {
    const result = validateManifest(
      withScripts([
        lint,
        { ...lint, file: "scripts/other.sh" },
        { ...lint, runner: "node", file: "scripts/x.js" },
      ]),
    );
    expect(result.manifest).toBeUndefined();
    expect(result.issues.map((found) => [found.severity, found.code, found.path])).toEqual([
      ["error", "script_duplicate", "/scripts/1/name"],
      ["error", "script_duplicate", "/scripts/2/name"],
    ]);
  });

  test("two different names with the same file are not a duplicate", () => {
    const result = validateManifest(
      withScripts([lint, { name: "lint-all", runner: "sh", file: "scripts/lint.sh" }]),
    );
    expect(result.issues).toEqual([]);
  });

  test("args holds at most 16 items of at most 512 characters", () => {
    const sixteen = Array.from({ length: 16 }, () => "x");
    const seventeen = Array.from({ length: 17 }, () => "x");
    expect(validateManifest(withScripts([{ ...lint, args: sixteen }])).issues).toEqual([]);
    expect(
      distinctCodes(validateManifest(withScripts([{ ...lint, args: seventeen }])).issues),
    ).toEqual(["schema"]);
    expect(validateManifest(withScripts([{ ...lint, args: ["a".repeat(512)] }])).issues).toEqual(
      [],
    );
    expect(
      distinctCodes(validateManifest(withScripts([{ ...lint, args: ["a".repeat(513)] }])).issues),
    ).toEqual(["schema"]);
  });

  test("timeoutMs is an integer from 1 to the cap of 60000 ms, and omitting it is allowed", () => {
    expect(SCRIPT_LIMITS.timeoutMaxMs).toBe(60000);
    for (const timeoutMs of [1, 10000, 60000]) {
      expect(validateManifest(withScripts([{ ...lint, timeoutMs }])).issues).toEqual([]);
    }
    for (const timeoutMs of [0, -1, 1.5, 60001]) {
      const result = validateManifest(withScripts([{ ...lint, timeoutMs }]));
      expect(result.manifest).toBeUndefined();
      expect(distinctCodes(result.issues)).toEqual(["schema"]);
    }
  });

  test("envNames holds environment variable names only, at most 16", () => {
    expect(
      validateManifest(withScripts([{ ...lint, envNames: ["API_KEY", "_x9"] }])).issues,
    ).toEqual([]);
    const badNames: string[][] = [
      ["1X"],
      ["A-B"],
      [""],
      ["a".repeat(129)],
      Array.from({ length: 17 }, (_, index) => `V${index}`),
    ];
    for (const envNames of badNames) {
      const result = validateManifest(withScripts([{ ...lint, envNames }]));
      expect(result.manifest).toBeUndefined();
      expect(distinctCodes(result.issues)).toEqual(["schema"]);
    }
  });

  test("a script declaration is a closed object and the list holds at most 64", () => {
    const extra = validateManifest(withScripts([{ ...lint, shell: true }]));
    expect(distinctCodes(extra.issues)).toEqual(["schema"]);
    const many = Array.from({ length: 65 }, (_, index) => ({ ...lint, name: `s${index}` }));
    expect(distinctCodes(validateManifest(withScripts(many)).issues)).toEqual(["schema"]);
    expect(validateManifest(withScripts(many.slice(0, 64))).issues).toEqual([]);
  });
});

describe("script file must stay inside the extension root (설계 B [제안])", () => {
  test("a relative path inside the root passes, including a name that starts with two dots", () => {
    for (const file of ["scripts/lint.sh", "./lint.sh", "..lint.sh", "a/..b/c.sh"]) {
      expect(isScriptFileValid(file)).toBe(true);
    }
  });

  test("empty, absolute, parent segment, backslash, NUL and drive letter are script_path_invalid", () => {
    const badFiles = [
      "",
      "/etc/x.sh",
      "../x.sh",
      "scripts/../../x.sh",
      "scripts\\lint.sh",
      "a\u0000b.sh",
      "C:/x.sh",
      "..",
      "a/..",
    ];
    for (const file of badFiles) {
      expect(isScriptFileValid(file)).toBe(false);
      const result = validateManifest(withScripts([{ ...lint, file }]));
      expect(result.manifest).toBeUndefined();
      expect(result.issues.map((found) => [found.severity, found.code, found.path])).toEqual([
        ["error", "script_path_invalid", "/scripts/0/file"],
      ]);
    }
  });

  test("the path rule reports the index of the script that breaks it, and the others pass", () => {
    const result = validateManifest(
      withScripts([lint, { name: "clean", runner: "sh", file: "/usr/bin/rm" }]),
    );
    expect(result.issues.map((found) => [found.code, found.path])).toEqual([
      ["script_path_invalid", "/scripts/1/file"],
    ]);
  });
});

describe("environment-mode scripts (AGE-58 원칙 가, [제안])", () => {
  const hash = `sha256:${"a".repeat(64)}`;
  const env: ScriptEnvDecl = {
    command: 'python3.11 "$CLAUDE_PROJECT_DIR"/.claude/hooks/x.py --strict',
    shell: "sh",
    refs: [{ path: "/Users/u/.claude/hooks/x.py", hash }],
    refsKnown: true,
  };
  const decl = { name: "pre-guard", runner: "sh", file: "scripts/pre-guard.cmd", env };

  test("a well-formed env declaration passes and comes back by value", () => {
    const manifest = validManifest(withScripts([decl]));
    expect(manifest.scripts?.[0]?.env).toEqual(env);
  });

  test("a narrow declaration has no env key", () => {
    expect(validManifest(withScripts([lint])).scripts?.[0]?.env).toBeUndefined();
  });

  test("runner different from the shell is script_env_invalid at /scripts/0/env", () => {
    const result = validateManifest(pluginJson(withScripts([{ ...decl, runner: "bash" }])));
    expect(distinctCodes(result.issues)).toEqual(["script_env_invalid"]);
    expect(result.issues[0]?.path).toBe("/scripts/0/env");
  });

  test("args alongside env, and relative reference paths, are rejected", () => {
    const withArgs = validateManifest(pluginJson(withScripts([{ ...decl, args: ["x"] }])));
    expect(distinctCodes(withArgs.issues)).toEqual(["script_env_invalid"]);
    const relative = validateManifest(
      pluginJson(withScripts([{ ...decl, env: { ...env, refs: [{ path: "hooks/x.py", hash }] } }])),
    );
    expect(distinctCodes(relative.issues)).toEqual(["script_env_invalid"]);
  });

  test("a malformed hash is a schema issue", () => {
    const result = validateManifest(
      pluginJson(
        withScripts([{ ...decl, env: { ...env, refs: [{ path: "/a", hash: "md5:zz" }] } }]),
      ),
    );
    expect(distinctCodes(result.issues)).toEqual(["schema"]);
  });
});
