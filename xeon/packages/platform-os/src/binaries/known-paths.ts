import { posix } from "node:path";
import type { BinaryName, OsPlatform } from "@fresnel/contracts/services";
import type { BinaryFs } from "./resolve.ts";

// L0.os.spec §3.6 OS-11 시스템 후보. GUI에서 띄운 앱의 PATH는 `/usr/bin:/bin:...`뿐이라 PATH만 보면 mise, nix, asdf로 설치한 도구를 놓친다.
// PATH에서 못 찾았을 때만 이 자리들을 본다. 찾은 곳의 이름(`via`)은 진단에 보인다.

export interface KnownCandidate {
  readonly path: string;
  /** 진단에 보이는 출처 이름: homebrew, mise, mise-shim, asdf, nix, macports, local-bin, snap, system */
  readonly via: string;
}

/** 후보를 만들 때 쓰는 입력. home이 없으면 홈 아래 후보는 건너뛴다 */
export interface KnownPathInput {
  readonly platform: OsPlatform;
  readonly home: string | undefined;
  readonly name: BinaryName;
}

function parts(text: string): readonly number[] {
  return text.split(/[^0-9]+/u).flatMap((p) => (p === "" ? [] : [Number(p)]));
}

/** 버전 폴더 이름을 큰 것부터 정렬한다. 숫자 조각 단위로 비교하고 숫자가 아니면 문자열로 비교한다 */
export function sortVersionsDescending(names: readonly string[]): readonly string[] {
  return names.toSorted((a, b) => {
    const left = parts(a);
    const right = parts(b);
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      const diff = (right[i] ?? 0) - (left[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return b.localeCompare(a);
  });
}

/** 고정 디렉터리 후보(앞이 우선). 홈 아래 디렉터리는 home이 있을 때만 */
function knownDirs(
  platform: OsPlatform,
  home: string | undefined,
): readonly { readonly dir: string; readonly via: string }[] {
  if (platform === "win32") return [];
  const list: { dir: string; via: string }[] = [];
  if (platform === "darwin") {
    list.push(
      { dir: "/opt/homebrew/bin", via: "homebrew" },
      { dir: "/usr/local/bin", via: "homebrew" },
      { dir: "/opt/local/bin", via: "macports" },
    );
  } else {
    list.push(
      { dir: "/home/linuxbrew/.linuxbrew/bin", via: "homebrew" },
      { dir: "/usr/local/bin", via: "local-bin" },
      { dir: "/snap/bin", via: "snap" },
      { dir: "/usr/bin", via: "system" },
      { dir: "/bin", via: "system" },
    );
  }
  list.push(
    { dir: "/nix/var/nix/profiles/default/bin", via: "nix" },
    { dir: "/run/current-system/sw/bin", via: "nix" },
  );
  if (home !== undefined && posix.isAbsolute(home)) {
    list.push(
      { dir: posix.join(home, ".local", "bin"), via: "local-bin" },
      { dir: posix.join(home, ".nix-profile", "bin"), via: "nix" },
      { dir: posix.join(home, ".local", "share", "mise", "shims"), via: "mise-shim" },
      { dir: posix.join(home, ".asdf", "shims"), via: "asdf" },
    );
  }
  return list;
}

/**
 * 버전 폴더를 가진 설치 관리자(mise, asdf)의 후보. 큰 버전부터 `<버전>/<이름>`, `<버전>/<이름>/<이름>`, `<버전>/bin/<이름>`을 본다.
 * 폴더 목록을 읽을 수 없으면 빈 목록이다.
 */
async function versionedCandidates(
  fs: BinaryFs,
  root: string,
  via: string,
  name: BinaryName,
): Promise<readonly KnownCandidate[]> {
  if (fs.listDir === undefined) return [];
  const tool = posix.join(root, name);
  const versions = sortVersionsDescending(await fs.listDir(tool));
  return versions.flatMap((v) => [
    { path: posix.join(tool, v, name), via },
    { path: posix.join(tool, v, name, name), via },
    { path: posix.join(tool, v, "bin", name), via },
  ]);
}

/** 이 이름의 시스템 후보를 우선순위 순서로 모은다(존재 여부는 호출한 쪽이 확인한다) */
export async function knownCandidates(
  fs: BinaryFs,
  input: KnownPathInput,
): Promise<readonly KnownCandidate[]> {
  const { platform, home, name } = input;
  if (platform === "win32") return [];
  const direct = knownDirs(platform, home).map(({ dir, via }) => ({
    path: posix.join(dir, name),
    via,
  }));
  const versioned =
    home !== undefined && posix.isAbsolute(home)
      ? [
          ...(await versionedCandidates(
            fs,
            posix.join(home, ".local", "share", "mise", "installs"),
            "mise",
            name,
          )),
          ...(await versionedCandidates(fs, posix.join(home, ".asdf", "installs"), "asdf", name)),
        ]
      : [];
  // 버전이 박힌 설치 폴더를 shim보다 먼저 본다(shim은 mise가 따로 필요하다)
  const shimStart = direct.findIndex((c) => c.via === "mise-shim");
  if (shimStart < 0) return [...direct, ...versioned];
  return [...direct.slice(0, shimStart), ...versioned, ...direct.slice(shimStart)];
}
