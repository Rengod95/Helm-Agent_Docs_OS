import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { attempt, parse, parseJson } from "@fresnel/contracts";
import { Type } from "typebox";
import { compareUtf8 } from "./content-hash.ts";

// 원본 폴더 탐색(M5c §4.5.2). 위치 순서대로 폴더 후보를 모은다. 위가 먼저다.
// 이 모듈은 ext-host의 탐색을 가져오지 않고 독립으로 둔다. 읽기 단계(folder-reader)가 폴더를 검사한다.

/** 후보의 출처. 추가 경로(extraPaths)는 사용자 설정이라 `user`다 */
type PluginLocationOrigin = "user" | "project" | "managed" | "bundled";

export interface DiscoverInput {
  /** 사용자 설정 폴더(`OsDirs.config`). 아래 `plugins/`와 기존 `extensions/`를 본다 */
  readonly configDir: string;
  /** 설정이 주는 추가 경로. 각 경로의 하위 폴더가 후보다 */
  readonly extraPaths: readonly string[];
  /** 프로젝트 루트 목록. 신뢰가 허용된 뒤에만 준다. 빈 목록이면 프로젝트 위치를 보지 않는다 */
  readonly projectRoots: readonly string[];
  /** 관리 폴더. 아래 `plugins/`를 본다 */
  readonly managedDir: string | null;
  /** 기본 제공 번들 폴더. 아래 하위 폴더가 후보다 */
  readonly bundleDir: string | null;
}

interface PluginCandidate {
  readonly origin: PluginLocationOrigin;
  /** 폴더 실제 경로(심볼릭 링크는 풀었다) */
  readonly dir: string;
  /** 기존 위치다. 읽기만 하고 새로 쓰지 않는다 */
  readonly legacy: boolean;
}

type DiscoverDiagnosticCode = "name_conflict" | "outside_root" | "unreadable_entry";

interface DiscoverDiagnostic {
  readonly code: DiscoverDiagnosticCode;
  readonly dir: string;
  readonly message: string;
}

export interface DiscoverResult {
  readonly candidates: readonly PluginCandidate[];
  readonly diagnostics: readonly DiscoverDiagnostic[];
}

interface Container {
  readonly origin: PluginLocationOrigin;
  readonly dir: string;
  readonly legacy: boolean;
  /** 프로젝트 위치면 참. 하위 폴더의 실제 경로가 이 폴더 밖이면 거절한다 */
  readonly bounded: boolean;
}

const PeekSchema = Type.Object({ name: Type.String() });

function containersOf(input: DiscoverInput): readonly Container[] {
  const containers: Container[] = [
    { origin: "user", dir: join(input.configDir, "plugins"), legacy: false, bounded: false },
    { origin: "user", dir: join(input.configDir, "extensions"), legacy: true, bounded: false },
    ...input.extraPaths.map((dir): Container => ({
      origin: "user",
      dir,
      legacy: false,
      bounded: false,
    })),
  ];
  for (const root of input.projectRoots) {
    containers.push(
      {
        origin: "project",
        dir: join(root, ".fresnel", "plugins"),
        legacy: false,
        bounded: true,
      },
      {
        origin: "project",
        dir: join(root, ".fresnel", "extensions"),
        legacy: true,
        bounded: true,
      },
    );
  }
  if (input.managedDir !== null) {
    containers.push({
      origin: "managed",
      dir: join(input.managedDir, "plugins"),
      legacy: false,
      bounded: false,
    });
  }
  if (input.bundleDir !== null) {
    containers.push({ origin: "bundled", dir: input.bundleDir, legacy: false, bounded: false });
  }
  return containers;
}

/** 판정용 이름: 매니페스트 `name`, 없거나 읽지 못하면 폴더 이름. 읽지 못한 것은 진단으로 남긴다 */
function judgeName(dir: string, folderName: string, diagnostics: DiscoverDiagnostic[]): string {
  const manifestPath = join(dir, ".fresnel-plugin", "plugin.json");
  if (!existsSync(manifestPath)) return folderName;
  const text = attempt(() => readFileSync(manifestPath, "utf8"));
  if (!text.ok) {
    diagnostics.push({
      code: "unreadable_entry",
      dir,
      message: "manifest could not be read; judged by folder name",
    });
    return folderName;
  }
  const json = parseJson(text.value);
  if (json.ok) {
    const peek = parse(PeekSchema, json.value);
    if (peek.ok) return peek.value.name;
  }
  diagnostics.push({
    code: "unreadable_entry",
    dir,
    message: "manifest has no readable name; judged by folder name",
  });
  return folderName;
}

interface ChildDir {
  readonly dir: string;
  readonly folderName: string;
}

/** 위치 하나의 하위 폴더. 점으로 시작하는 이름은 건너뛴다. 이름 순서다 */
function childDirsOf(container: Container, diagnostics: DiscoverDiagnostic[]): ChildDir[] {
  if (!existsSync(container.dir)) return [];
  const listed = attempt(() => readdirSync(container.dir, { withFileTypes: true }));
  if (!listed.ok) {
    diagnostics.push({
      code: "unreadable_entry",
      dir: container.dir,
      message: "location could not be listed",
    });
    return [];
  }
  let containerReal: string | undefined;
  if (container.bounded) {
    const real = attempt(() => realpathSync(container.dir));
    if (!real.ok) {
      diagnostics.push({
        code: "unreadable_entry",
        dir: container.dir,
        message: "location could not be resolved",
      });
      return [];
    }
    containerReal = real.value;
  }

  const children: ChildDir[] = [];
  const entries = listed.value.toSorted((a, b) => compareUtf8(a.name, b.name));
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const child = join(container.dir, entry.name);
    let dir = child;
    // 프로젝트 위치는 링크가 아니어도 실제 경로로 비교해야 한다(macOS의 /var → /private/var)
    if (entry.isSymbolicLink() || containerReal !== undefined) {
      const real = attempt(() => realpathSync(child));
      if (!real.ok) {
        diagnostics.push({
          code: "unreadable_entry",
          dir: child,
          message: "entry could not be resolved",
        });
        continue;
      }
      dir = real.value;
    }
    if (containerReal !== undefined && !dir.startsWith(containerReal + sep)) {
      diagnostics.push({
        code: "outside_root",
        dir: child,
        message: "resolved path is outside the location",
      });
      continue;
    }
    const meta = attempt(() => statSync(dir));
    if (!meta.ok) {
      diagnostics.push({
        code: "unreadable_entry",
        dir: child,
        message: "entry could not be read",
      });
      continue;
    }
    if (!meta.value.isDirectory()) continue;
    children.push({ dir, folderName: entry.name });
  }
  return children;
}

/**
 * 플러그인 폴더 후보를 찾는다. 같은 이름이 둘 이상이면 먼저 발견된 것만 후보이고 나머지는 `name_conflict`다.
 * 결과 순서는 위치 순서, 같은 위치 안에서는 폴더 이름의 UTF-8 바이트(코드 포인트) 순이다.
 * 동기 호출이다. 나열 결과가 파일 시스템 순서에 기대지 않도록 정렬한다.
 */
export function discoverPluginFolders(input: DiscoverInput): DiscoverResult {
  const candidates: PluginCandidate[] = [];
  const diagnostics: DiscoverDiagnostic[] = [];
  const claimed = new Map<string, string>();
  for (const container of containersOf(input)) {
    for (const child of childDirsOf(container, diagnostics)) {
      const name = judgeName(child.dir, child.folderName, diagnostics);
      const winner = claimed.get(name);
      if (winner !== undefined) {
        diagnostics.push({
          code: "name_conflict",
          dir: child.dir,
          message: `plugin name "${name}" is already found at ${winner}`,
        });
        continue;
      }
      claimed.set(name, child.dir);
      candidates.push({ origin: container.origin, dir: child.dir, legacy: container.legacy });
    }
  }
  return { candidates, diagnostics };
}
