// PATH 보강(env_path.rs, L4.desktop.spec E7). Finder로 띄운 macOS 앱의 PATH는 `/usr/bin:/bin:/usr/sbin:/sbin`뿐이라
// sops, age, rg 같은 도구를 찾지 못한다. 기존 항목과 순서는 그대로 두고, 없는 도구 디렉터리만 뒤에 붙인다.
// 엔진과 `fresnel secret` 자식의 환경에만 적용한다(lib/env-path.ts engineEnv). 셸 프로세스 자신의 PATH는 바꾸지 않는다(Rust와 같다).
import path from "node:path";

/** 기존 PATH 뒤에 붙이는 고정 디렉터리(Homebrew, /usr/local) */
const FIXED_DIRS: readonly string[] = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"];

/**
 * PATH를 보강한다. 붙이는 순서는 Homebrew 두 개, `/usr/local/bin`, `<home>/.local/bin`, `<home>/.nix-profile/bin`이다
 * (뒤의 두 개는 home이 있을 때만). 빈 항목은 버리고, 이미 있는 디렉터리는 다시 붙이지 않는다.
 * 붙일 수 없는 값(구분자가 든 홈 경로 등)이면 원래 값을 그대로 돌려준다.
 */
export function augmentPath(
  current: string | undefined,
  home: string | null,
  platform: NodeJS.Platform,
): string {
  const delimiter = platform === "win32" ? ";" : ":";
  const api = platform === "win32" ? path.win32 : path.posix;
  const entries = current === undefined ? [] : current.split(delimiter).filter((e) => e !== "");
  const wanted = [...FIXED_DIRS];
  if (home !== null)
    wanted.push(api.join(home, ".local", "bin"), api.join(home, ".nix-profile", "bin"));
  const separator = platform === "win32" ? /[\\/]+/u : /\/+/u;
  for (const dir of wanted) {
    if (!entries.some((entry) => sameDir(entry, dir, separator))) entries.push(dir);
  }
  const unjoinable = entries.some(
    (entry) => entry.includes(delimiter) || (platform === "win32" && entry.includes('"')),
  );
  if (unjoinable) return current ?? "";
  return entries.join(delimiter);
}

/** 환경 변수 묶음의 PATH를 보강한 값. 엔진 환경과 시험이 같은 함수를 쓴다 */
export function augmentEnvPath(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  home: string | null,
): string {
  return augmentPath(env["PATH"], home, platform);
}

/** 두 디렉터리가 같은가. Rust `Path` 동등성처럼 구성 요소로 비교한다(중복 구분자와 가운데 `.`은 무시한다) */
function sameDir(a: string, b: string, separator: RegExp): boolean {
  const left = a.split(separator).filter((part) => part !== "" && part !== ".");
  const right = b.split(separator).filter((part) => part !== "" && part !== ".");
  return left.length === right.length && left.every((part, index) => part === right[index]);
}
