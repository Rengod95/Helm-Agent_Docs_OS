import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { attempt, attemptAsync } from "@fresnel/contracts";
import type { ScanFs, ScanRead, ScanStat } from "@fresnel/plugin-migration";
import type { Stats } from "node:fs";

// 훑기의 읽기 전용 파일 포트(migration.md §7.4, 수용 기준 4·5·6·19). 라이브러리의 `ScanFs`를 `node:fs`의 읽기 호출만으로 구현한다:
// lstat, readdir, readFile, realpath. 쓰기, 삭제, 이름 바꾸기, 프로세스 생성, 네트워크는 이 파일에 없다(시험이 import를 본다).
// 읽을 수 있는 자리는 호출자가 고른 루트(정규 경로) 아래뿐이다. 루트 밖을 가리키는 심볼릭 링크와 `..`는 따라가지 않는다.
// 감지(`detectForeignFormats`)는 존재만 보므로 `createExistenceFs`를 쓴다. 상위 폴더의 `.agents/skills`를 보려고 lstat만 상위까지 허용한다.

/** 한 번 훑기에서 건드릴 항목(lstat, 목록의 이름, 읽은 파일)의 상한 [제안]. 넘으면 그 훑기는 일부만 낸 결과를 내지 않는다 */
const SCAN_ENTRY_LIMIT = 20_000;

/** 읽기 포트와 그 항목 상한 표시 */
export interface ScanGuard {
  readonly fs: ScanFs;
  /** 항목 상한을 넘었는가. 넘었으면 이후의 읽기는 모두 빈 결과다 */
  readonly limitReached: () => boolean;
}

/** `..`와 `.`를 정리한다. 절대 경로가 아니거나 루트 위로 나가면 undefined */
function lexicalOf(path: string): string | undefined {
  if (!path.startsWith("/")) return undefined;
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return undefined;
      out.pop();
    } else {
      out.push(part);
    }
  }
  return `/${out.join("/")}`;
}

/** 정리한 경로가 루트 가운데 하나 아래(또는 같음)인가 */
function within(roots: readonly string[], path: string): boolean {
  return roots.some(
    (root) => path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`),
  );
}

function kindOf(stat: Stats): ScanStat["kind"] {
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "dir";
  return "other";
}

function statOf(stat: Stats | null): ScanStat | null {
  return stat === null ? null : { kind: kindOf(stat), size: stat.size };
}

/** 없는 것은 `ENOENT`나 `ENOTDIR`다. 그 밖의 오류는 그대로 다시 던진다(TY-25 3) */
function isMissing(caught: unknown): boolean {
  return (
    caught instanceof Error &&
    "code" in caught &&
    (caught.code === "ENOENT" || caught.code === "ENOTDIR")
  );
}

/** 심볼릭 링크를 따라가지 않는 lstat. 없으면 null */
async function lstatAt(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (caught) {
    if (isMissing(caught)) return null;
    throw caught;
  }
}

/** 폴더 이름들. 없으면 빈 목록이다 */
async function readdirAt(path: string): Promise<readonly string[]> {
  try {
    return await readdir(path);
  } catch (caught) {
    if (isMissing(caught)) return [];
    throw caught;
  }
}

/** 바이트를 텍스트로 본다. NUL이 있거나 UTF-8이 아니면 이진이다(어댑터는 이진을 JSON이나 머리말로 읽지 않는다) */
function textOf(bytes: Uint8Array): ScanRead {
  if (bytes.includes(0)) return { kind: "binary", bytes };
  const decoded = attempt(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return decoded.ok ? { kind: "text", text: decoded.value } : { kind: "binary", bytes };
}

/**
 * 호출자가 고른 루트 아래만 읽는 읽기 전용 포트를 만든다. `readRoots`는 정규 경로(심볼릭 링크를 푼 값)의 절대 경로다.
 * 항목 상한 `maxEntries`를 넘으면 `limitReached()`가 참이고 그 뒤의 읽기는 모두 빈 결과다.
 */
export function createScanFs(
  readRoots: readonly string[],
  maxEntries: number = SCAN_ENTRY_LIMIT,
): ScanGuard {
  const roots = readRoots.flatMap((root) => {
    const lexical = lexicalOf(root);
    return lexical === undefined ? [] : [lexical];
  });
  let entries = 0;
  let reached = false;

  /** 항목 `count`개를 쓴다. 상한을 넘으면 이번 것도 허용하지 않는다 */
  function admit(count: number): boolean {
    if (reached) return false;
    entries += count;
    if (entries > maxEntries) {
      reached = true;
      return false;
    }
    return true;
  }

  /** 정리한 경로의 정규 경로. 루트 밖이거나 풀 수 없으면 undefined */
  async function insideReal(lexical: string): Promise<string | undefined> {
    const real = await attemptAsync(() => realpath(lexical));
    if (!real.ok || !within(roots, real.value)) return undefined;
    return real.value;
  }

  return {
    limitReached: () => reached,
    fs: {
      async lstat(path: string): Promise<ScanStat | null> {
        const lexical = lexicalOf(path);
        if (lexical === undefined || !within(roots, lexical) || !admit(1)) return null;
        // 마지막 조각은 풀지 않는다(lstat). 그 앞의 폴더는 루트 안의 정규 경로로 바꿔 본다
        if (roots.includes(lexical)) return statOf(await lstatAt(lexical));
        const parent = await insideReal(dirname(lexical));
        if (parent === undefined) return null;
        return statOf(await lstatAt(join(parent, basename(lexical))));
      },

      async listDir(path: string): Promise<readonly string[]> {
        const lexical = lexicalOf(path);
        if (lexical === undefined || !within(roots, lexical)) return [];
        const real = await insideReal(lexical);
        if (real === undefined) return [];
        const names = await readdirAt(real);
        return admit(names.length) ? names : [];
      },

      async readBounded(path: string, maxBytes: number): Promise<ScanRead> {
        const lexical = lexicalOf(path);
        if (lexical === undefined || !within(roots, lexical)) return { kind: "unreadable" };
        const real = await insideReal(lexical);
        if (real === undefined || !admit(1)) return { kind: "unreadable" };
        const stat = await attemptAsync(() => lstat(real));
        if (!stat.ok || !stat.value.isFile()) return { kind: "unreadable" };
        if (stat.value.size > maxBytes) return { kind: "too_large" };
        const bytes = await attemptAsync(() => readFile(real));
        if (!bytes.ok) return { kind: "unreadable" };
        if (bytes.value.length > maxBytes) return { kind: "too_large" };
        return textOf(bytes.value);
      },

      // 라이브러리 계약이 `Promise<string>`을 요구해서 루트 밖이면 던진다. 어댑터는 `attemptAsync`로 받는다
      async realpath(path: string): Promise<string> {
        const lexical = lexicalOf(path);
        const real = lexical === undefined ? undefined : await insideReal(lexical);
        if (real === undefined) throw new Error("path is outside the chosen roots");
        return real;
      },
    },
  };
}

/**
 * 감지용 포트. 존재만 본다: `lstat`만 쓰고 상위 폴더까지 본다(라이브러리의 표지 규칙, §6.1). 목록과 내용은 읽지 않는다.
 * 읽기 호출이 있으면 감지 시험이 세어서 잡는다.
 */
export function createExistenceFs(): ScanFs {
  return {
    async lstat(path: string): Promise<ScanStat | null> {
      return statOf(await lstatAt(path));
    },
    listDir(): Promise<readonly string[]> {
      return Promise.resolve([]);
    },
    readBounded(): Promise<ScanRead> {
      return Promise.resolve({ kind: "unreadable" });
    },
    realpath(): Promise<string> {
      return Promise.reject(new Error("the existence check does not resolve paths"));
    },
  };
}
