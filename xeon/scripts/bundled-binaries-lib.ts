// 묶은 앱에 넣는 외부 바이너리(sops, age)의 순수 부분(L0.os.spec §3.6 OS-11·OS-12, L4.desktop.spec §11.7). 시험은 test/binaries-lib.test.ts.
// 엔진(해석기 resolve.ts)이 읽는 `binaries.lock.json`을 같은 모양으로 만든다: { binaries: [{ name, platform, arch, path, sha256, version }] }.
// 이 파일은 워크스페이스 패키지를 import하지 않는다(scripts 규칙). 해석기와 같은 모양은 시험이 맞춘다.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** 앱에 넣는 도구. `age-keygen`은 코드가 부르지 않아 넣지 않는다(해석기 BinaryName에도 없다) */
export const BUNDLED_TOOLS = ["sops", "age"] as const;
export type BundledTool = (typeof BUNDLED_TOOLS)[number];

/** 고정 버전. scripts/release-bundle.json의 bundledBinaries와 같아야 한다(시험이 맞춘다) */
export const PINNED_VERSIONS: Readonly<Record<BundledTool, string>> = {
  sops: "3.13.3",
  age: "1.3.2",
};

/** 번들 안의 위치: Resources 기준 상대 경로 */
export function bundledPath(tool: BundledTool): string {
  return path.posix.join("binaries", tool);
}

export interface LockRow {
  readonly name: BundledTool;
  readonly platform: string;
  readonly arch: string;
  readonly path: string;
  readonly sha256: string;
  readonly version: string;
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `binaries.lock.json` 본문. 이름 순, 2칸 들여쓰기, 끝 줄바꿈(scripts/release.ts lockBody와 같은 모양) */
export function lockText(rows: readonly LockRow[]): string {
  const sorted = rows.toSorted((a, b) => a.name.localeCompare(b.name));
  const binaries = sorted.map((r) => ({
    name: r.name,
    platform: r.platform,
    arch: r.arch,
    path: r.path,
    sha256: r.sha256,
    version: r.version,
  }));
  return `${JSON.stringify({ binaries }, null, 2)}\n`;
}

/** `--version` 출력에서 처음 나오는 x.y.z */
export function versionOfOutput(text: string): string | null {
  const m = /(\d+)\.(\d+)\.(\d+)/u.exec(text);
  return m === null ? null : `${m[1]}.${m[2]}.${m[3]}`;
}

function versionKey(name: string): readonly number[] {
  return name.split(/[^0-9]+/u).flatMap((p) => (p === "" ? [] : [Number(p)]));
}

/** 버전 폴더 이름을 큰 것부터 */
export function newestFirst(names: readonly string[]): readonly string[] {
  return names.toSorted((a, b) => {
    const l = versionKey(a);
    const r = versionKey(b);
    for (let i = 0; i < Math.max(l.length, r.length); i += 1) {
      const d = (r[i] ?? 0) - (l[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
}

function isExecutable(file: string): boolean {
  if (!existsSync(file)) return false;
  const info = statSync(file);
  return info.isFile() && (info.mode & 0o111) !== 0;
}

export interface FindInput {
  readonly tool: BundledTool;
  /** env FRESNEL_BINARIES_DIR: sops와 age가 이미 있는 폴더(릴리스 `--binaries-dir`와 같다) */
  readonly binariesDir: string | undefined;
  /** 사용자 홈. mise 설치 폴더를 볼 때 쓴다 */
  readonly home: string | undefined;
  /** PATH 값 */
  readonly pathEnv: string | undefined;
  /** 고정하려는 버전. 있으면 mise 설치 폴더에서 이 버전을 먼저 본다 */
  readonly wantVersion: string | undefined;
}

/** 빌드하는 기계에서 도구를 찾는다. 새로 내려받지 않는다. 순서: FRESNEL_BINARIES_DIR, mise 설치 폴더(고정 버전 먼저), PATH */
export function findOnBuildMachine(input: FindInput): { path: string; via: string } | null {
  const { tool, binariesDir, home, pathEnv, wantVersion } = input;
  if (binariesDir !== undefined && binariesDir !== "") {
    const file = path.join(binariesDir, tool);
    if (isExecutable(file)) return { path: file, via: "FRESNEL_BINARIES_DIR" };
  }
  if (home !== undefined && home !== "") {
    const root = path.join(home, ".local", "share", "mise", "installs", tool);
    if (existsSync(root)) {
      const all = readdirSync(root);
      const ordered =
        wantVersion !== undefined && all.includes(wantVersion)
          ? [wantVersion, ...newestFirst(all.filter((v) => v !== wantVersion))]
          : newestFirst(all);
      for (const v of ordered) {
        for (const rel of [[tool], [tool, tool], ["bin", tool]]) {
          const file = path.join(root, v, ...rel);
          if (isExecutable(file)) return { path: file, via: "mise" };
        }
      }
    }
  }
  for (const dir of (pathEnv ?? "").split(path.delimiter)) {
    if (dir === "" || !path.isAbsolute(dir)) continue;
    const file = path.join(dir, tool);
    if (isExecutable(file)) return { path: file, via: "PATH" };
  }
  return null;
}

/** 못 찾았을 때 종료코드 2와 함께 내는 안내 */
export function missingToolMessage(tool: BundledTool, wantVersion: string | undefined): string {
  const want = wantVersion === undefined ? "" : ` ${wantVersion}`;
  return (
    `package: ${tool}${want} is not on this build machine. Install it (mise use -g ${tool}${wantVersion === undefined ? "" : `@${wantVersion}`}, or brew install ${tool}) ` +
    "or point FRESNEL_BINARIES_DIR at a folder that holds sops and age. The build never downloads them (a download needs the user's approval)."
  );
}

function fieldOf(item: object, key: string): unknown {
  return key in item ? Object.getOwnPropertyDescriptor(item, key)?.value : undefined;
}

/** lock 본문의 sha256을 `hashOf(상대 경로)`로 바꿔 다시 쓴다. 모양이 틀리면 null이다 */
export function relockText(text: string, hashOf: (relativePath: string) => string): string | null {
  const json: unknown = JSON.parse(text);
  if (typeof json !== "object" || json === null || !("binaries" in json)) return null;
  const list: unknown = json.binaries;
  if (!Array.isArray(list)) return null;
  const items: readonly unknown[] = list;
  const rows: LockRow[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) return null;
    const name = fieldOf(item, "name");
    const platform = fieldOf(item, "platform");
    const arch = fieldOf(item, "arch");
    const rel = fieldOf(item, "path");
    const version = fieldOf(item, "version");
    if (
      (name !== "sops" && name !== "age") ||
      typeof platform !== "string" ||
      typeof arch !== "string" ||
      typeof rel !== "string" ||
      typeof version !== "string"
    ) {
      return null;
    }
    rows.push({ name, platform, arch, path: rel, sha256: hashOf(rel), version });
  }
  return lockText(rows);
}
