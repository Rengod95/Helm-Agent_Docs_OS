import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { attempt } from "@fresnel/contracts";
import type { OsRuntime } from "@fresnel/platform-os";

/** 동기 명령 실행(`OsRuntime.runSync`) */
export type RunCommandSync = OsRuntime["runSync"];

// L0.sandbox.spec §4.9 [결정: 2026-11-19, 사용자, AGE-58 "1-다 2-가"]. `python3` 실행기가 샌드박스 안에서 시작하려면 표준 라이브러리가 든
// 설치 폴더(`sys.base_prefix`)를 읽어야 한다. PATH의 `python3`는 shim(mise, pyenv)이나 macOS의 개발자 도구 껍데기일 수 있으므로,
// 고정 인자로 인터프리터에 한 번 물어(샌드박스 밖, 엔진 쪽) 실제 실행 파일과 설치 접두 폴더를 푼다.

/** 인터프리터에 묻는 고정 한 줄. `-I -S`라 사용자 사이트 폴더와 환경 변수 모듈을 읽지 않는다. 출력은 네 줄이다 */
const PROBE_SOURCE =
  "import sys;print(sys.executable);print(sys.base_prefix);print(sys.base_exec_prefix);print(sys.prefix)";

export interface PythonRuntime {
  /** 실제 인터프리터 파일(shim이나 껍데기가 아니다) */
  readonly command: string;
  /** 읽기만 열 경로: 설치 접두 폴더(`base_prefix`, `base_exec_prefix`)와, 가상환경이면 그 `pyvenv.cfg` 파일 하나 */
  readonly readRoots: readonly string[];
}

function realOr(path: string): string {
  const real = attempt(() => realpathSync(path));
  return real.ok ? real.value : path;
}

/** `inner`가 `outer`와 같거나 그 아래인가(둘 다 정규 경로) */
function within(inner: string, outer: string): boolean {
  return inner === outer || inner.startsWith(outer.endsWith("/") ? outer : `${outer}/`);
}

/**
 * 접두 폴더로 쓸 수 있는 값인가: 절대 경로이고, 파일 시스템 루트 같은 얕은 폴더가 아니며(깊이 2 미만이면 거른다),
 * 사용자 홈 폴더이거나 홈을 품는 폴더가 아니다(`--prefix=$HOME`으로 지은 인터프리터가 홈 전체를 읽기로 열지 못하게 한다)
 */
function usablePrefix(path: string, home: string): boolean {
  return (
    isAbsolute(path) &&
    existsSync(path) &&
    path.split("/").filter((part) => part !== "").length >= 2 &&
    !within(realOr(home), realOr(path))
  );
}

/**
 * `command`(PATH에서 찾은 `python3`)를 실제 인터프리터와 읽을 경로로 푼다. 물어서 답이 없거나 접두 폴더가 이상하면 undefined다
 * (그러면 실행기는 지금처럼 `runner_unavailable`로 답한다).
 */
export function probePython(
  command: string,
  runSync: RunCommandSync,
  home: string = homedir(),
): PythonRuntime | undefined {
  const asked = runSync([command, "-I", "-S", "-c", PROBE_SOURCE]);
  if (!asked.ok || asked.value.exitCode !== 0) return undefined;
  const [executable, basePrefix, baseExecPrefix, prefix] = asked.value.stdout
    .split("\n")
    .map((line) => line.trim());
  if (executable === undefined || basePrefix === undefined || !isAbsolute(executable)) {
    return undefined;
  }
  const roots = new Set<string>();
  for (const candidate of [basePrefix, baseExecPrefix]) {
    if (candidate !== undefined && usablePrefix(candidate, home)) roots.add(realOr(candidate));
  }
  if (roots.size === 0) return undefined;
  const isVenv = prefix !== undefined && prefix !== "" && prefix !== basePrefix;
  if (isVenv) {
    // 가상환경: 인터프리터는 링크 경로 그대로 띄워야 가상환경으로 인식한다. 시작에 읽는 설정 파일 하나만 더 연다(그 안의 site-packages는 열지 않는다)
    const cfg = join(dirname(dirname(executable)), "pyvenv.cfg");
    if (existsSync(cfg)) roots.add(cfg);
    return { command: executable, readRoots: [...roots] };
  }
  return { command: realOr(executable), readRoots: [...roots] };
}
