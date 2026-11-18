import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { WireError } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// W-29 (int, 실제 엔진): 제작 wire. `ext.kinds`는 종류 카탈로그를 주고, `ext.scaffold`는 골격 폴더를 쓰고,
// `ext.validate`는 폴더를 검사하고, `ext.package`는 묶음 폴더를 만든다. 시험은 모두 임시 폴더에서 하고, 쓴 파일의 목록과 글을 디스크와 맞춘다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const TIMEOUT_MS = 120_000;
const NAME = "scaffold-kit";

/** 폴더 안의 모든 파일을 상대 경로와 바이트로 모은다 */
function bytesOf(root: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else files[rel] = readFileSync(join(dir, entry.name));
    }
  };
  walk(root, "");
  return files;
}

/** 묶음 해시를 시험이 따로 계산한다: 정렬한 파일 경로와 내용 해시를 `경로\0해시\n`으로 이어 sha256을 낸다 */
function packageHashOf(root: string, files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    const digest = createHash("sha256")
      .update(readFileSync(join(root, file)))
      .digest("hex");
    hash.update(`${file}\0${digest}\n`);
  }
  return hash.digest("hex");
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

realTest(
  "ext.kinds lists the single plugin kind as stable, with its layers, checks and security rules",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const bundles = mkdtempSync(join(tmpdir(), "ext-devkit-bundles-"));
    const host = await startInProcessHost({
      devChecks: true,
      pluginHost: { disabled: true },
      defaultPluginsDir: bundles,
      extraPlugins: [],
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      expect(await connection.request("ext.kinds", {})).toEqual({
        kinds: [
          {
            id: "single-plugin",
            title: "Single plugin",
            layers: ["L1", "L2", "L3", "plugin"],
            status: "stable",
            since: "0.1.0",
            requires: { contracts: "^0.0.0" },
            template: "plugin-builder/templates/single-plugin",
            checks: ["AU-001", "AU-002", "AU-003", "AU-009"],
            decisions: ["layer", "ui.mode"],
            security: ["trust.noBuiltin", "secrets.noLiteral"],
          },
        ],
      });
    } finally {
      await connection.close();
      await host.close();
      rmSync(bundles, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

realTest(
  "ext.scaffold writes the folder it reports, with no placeholder left; ext.validate accepts it; ext.package packs it into dist/package with the hash it reports",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const bundles = mkdtempSync(join(tmpdir(), "ext-devkit-bundles-"));
    const base = realpathSync(mkdtempSync(join(tmpdir(), "xh-devkit-")));
    const dir = join(base, NAME);
    const host = await startInProcessHost({
      devChecks: true,
      pluginHost: { disabled: true },
      defaultPluginsDir: bundles,
      extraPlugins: [],
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const scaffolded = await connection.request("ext.scaffold", {
        kind: "single-plugin",
        name: NAME,
        dir,
      });
      expect(scaffolded.dir).toBe(dir);
      // 응답의 파일 목록은 디스크에 실제로 있는 파일과 같다
      const onDisk = bytesOf(dir);
      expect(scaffolded.files.toSorted()).toEqual(Object.keys(onDisk).toSorted());
      // 골격의 자리(`__ID__` 등)는 모두 채워졌다
      for (const bytes of Object.values(onDisk)) {
        const text = new TextDecoder().decode(bytes);
        expect(text).not.toMatch(/__ID__|__TITLE__|__VERSION__/);
      }
      const manifest: unknown = JSON.parse(
        readFileSync(join(dir, ".fresnel-plugin", "plugin.json"), "utf8"),
      );
      expect(manifest).toMatchObject({ name: NAME, version: "0.1.0" });

      // 검사는 통과한다: 오류가 없다
      const validated = await connection.request("ext.validate", { dir });
      expect(validated.ok).toBe(true);
      expect(validated.issues.filter((issue) => issue.severity === "error")).toEqual([]);

      // 묶음: 기본 출력은 `<dir>/dist/package`다. 응답의 파일과 해시가 디스크와 시험의 계산과 같다
      const packed = await connection.request("ext.package", { dir });
      expect(packed.path).toBe(join(dir, "dist", "package"));
      const packedBytes = bytesOf(packed.path);
      expect(packed.files.toSorted()).toEqual(Object.keys(packedBytes).toSorted());
      expect(packed.sha256).toBe(packageHashOf(packed.path, packed.files));
      // 묶음의 매니페스트는 번들 엔트리를 가리키고, 그 파일은 묶음에 있다
      const packedManifest: unknown = JSON.parse(
        readFileSync(join(packed.path, ".fresnel-plugin", "plugin.json"), "utf8"),
      );
      expect(packedManifest).toMatchObject({ name: NAME, entry: "./dist/index.js" });
      expect(packed.files).toContain("dist/index.js");
      expect(readFileSync(join(packed.path, "dist", "index.js")).length).toBeGreaterThan(0);

      // 묶음을 만들어도 원본 골격은 그대로다(`dist/` 밖의 파일은 골격과 같다)
      const sourceAfterPack = Object.fromEntries(
        Object.entries(bytesOf(dir)).filter(([path]) => !path.startsWith("dist/")),
      );
      expect(sourceAfterPack).toEqual(onDisk);
    } finally {
      await connection.close();
      await host.close();
      rmSync(bundles, { recursive: true, force: true });
      rmSync(base, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

realTest(
  "ext.package writes to the out folder it is given, and refuses a non-empty out folder",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const bundles = mkdtempSync(join(tmpdir(), "ext-devkit-bundles-"));
    const base = realpathSync(mkdtempSync(join(tmpdir(), "xh-devkit-")));
    const dir = join(base, NAME);
    const out = join(base, "out");
    const host = await startInProcessHost({
      devChecks: true,
      pluginHost: { disabled: true },
      defaultPluginsDir: bundles,
      extraPlugins: [],
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("ext.scaffold", { kind: "single-plugin", name: NAME, dir });

      const packed = await connection.request("ext.package", { dir, out });
      expect(packed.path).toBe(out);
      expect(packed.files.toSorted()).toEqual(Object.keys(bytesOf(out)).toSorted());
      expect(packed.sha256).toBe(packageHashOf(out, packed.files));
      // 기본 출력 자리에는 아무것도 만들지 않았다
      expect(existsSync(join(dir, "dist", "package"))).toBe(false);

      // 이미 든 출력 폴더는 덮지 않는다
      const refused = await wireErrorOf(connection.request("ext.package", { dir, out }));
      expect(refused.data.kind).toBe("jsonrpc.invalidParams");
      expect(refused.data.details).toEqual({
        issues: [{ path: "/dir", message: `exists: ${out} is not empty` }],
      });
      // 그 폴더의 파일은 그대로다
      expect(packed.files.every((file) => existsSync(join(out, file)))).toBe(true);
    } finally {
      await connection.close();
      await host.close();
      rmSync(bundles, { recursive: true, force: true });
      rmSync(base, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

realTest(
  "ext.scaffold refuses a non-empty folder, a relative folder and a bad name, and writes nothing; ext.validate reports a folder without a manifest as not ok",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const bundles = mkdtempSync(join(tmpdir(), "ext-devkit-bundles-"));
    const base = realpathSync(mkdtempSync(join(tmpdir(), "xh-devkit-")));
    const busy = join(base, "busy");
    mkdirSync(busy);
    writeFileSync(join(busy, "keep.txt"), "keep me\n");
    const host = await startInProcessHost({
      devChecks: true,
      pluginHost: { disabled: true },
      defaultPluginsDir: bundles,
      extraPlugins: [],
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const before = bytesOf(busy);

      const notEmpty = await wireErrorOf(
        connection.request("ext.scaffold", { kind: "single-plugin", name: NAME, dir: busy }),
      );
      expect(notEmpty.data.kind).toBe("jsonrpc.invalidParams");
      expect(notEmpty.data.details).toEqual({
        issues: [{ path: "/dir", message: `exists: ${busy} is not empty` }],
      });
      expect(bytesOf(busy)).toEqual(before);

      const relative = await wireErrorOf(
        connection.request("ext.scaffold", {
          kind: "single-plugin",
          name: NAME,
          dir: "relative/kit",
        }),
      );
      expect(relative.data.details).toEqual({
        issues: [{ path: "/dir", message: "invalid_input: dir must be an absolute path" }],
      });
      expect(existsSync(join(process.cwd(), "relative"))).toBe(false);

      const badName = join(base, "bad-name");
      const badNameError = await wireErrorOf(
        connection.request("ext.scaffold", {
          kind: "single-plugin",
          name: "Bad Name",
          dir: badName,
        }),
      );
      expect(badNameError.data.details).toEqual({
        issues: [{ path: "/dir", message: 'invalid_input: AU-001: name "Bad Name" is not valid' }],
      });
      expect(existsSync(badName)).toBe(false);

      // 매니페스트가 없는 폴더는 검사 결과가 아니라 입력 거절이다(`no_manifest`)
      const bare = join(base, "bare");
      mkdirSync(join(bare, "src"), { recursive: true });
      writeFileSync(join(bare, "src", "index.ts"), "export {};\n");
      const noManifest = await wireErrorOf(connection.request("ext.validate", { dir: bare }));
      expect(noManifest.data.kind).toBe("jsonrpc.invalidParams");
      expect(noManifest.data.details).toEqual({
        issues: [{ path: "/dir", message: "no_manifest: .fresnel-plugin/plugin.json is missing" }],
        reasons: [{ code: "no_manifest" }],
      });

      // 매니페스트가 규칙을 어기면 `ok`가 거짓인 검사 결과다. builtin 등급은 저작 확장이 요청하지 못한다(AU-002)
      const forged = join(base, "forged");
      mkdirSync(join(forged, ".fresnel-plugin"), { recursive: true });
      writeFileSync(
        join(forged, ".fresnel-plugin", "plugin.json"),
        JSON.stringify({
          schemaVersion: 2,
          name: "forged-kit",
          version: "1.0.0",
          purpose: "Asks for the builtin level",
          trust: { level: "builtin" },
        }),
      );
      const checked = await connection.request("ext.validate", { dir: forged });
      expect(checked.ok).toBe(false);
      expect(checked.issues).toContainEqual({
        severity: "error",
        code: "AU-002",
        path: "/trust/level",
        message: "an authored extension cannot request the builtin trust level",
      });
      // 검사에 걸린 폴더는 묶지 않는다: 거절하고 묶음 폴더를 만들지 않는다
      const packRefused = await wireErrorOf(connection.request("ext.package", { dir: forged }));
      expect(packRefused.data.kind).toBe("jsonrpc.invalidParams");
      expect(existsSync(join(forged, "dist"))).toBe(false);
    } finally {
      await connection.close();
      await host.close();
      rmSync(bundles, { recursive: true, force: true });
      rmSync(base, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);
