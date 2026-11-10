import { dirname } from "node:path";
import type { AutostartDeps, AutostartRunResult } from "../../src/service/autostart.ts";
import type { ServiceCommand } from "../../src/service/ensure.ts";

// 자동 시작 시험의 가짜 기기: 메모리 파일, 디렉터리 목록, 호출을 쌓는 `run`. 실제 홈과 launchctl·systemctl을 건드리지 않는다.
// `reply`가 한 줄(`실행 파일 인자…`)을 보고 답을 고른다. 답이 없으면 종료 코드 0, 출력 없음이다.

const FAKE_HOME = "/Users/tester";
const FAKE_UID = 501;
export const FAKE_COMMAND: ServiceCommand = {
  command: "/opt/fresnel/bin/fresnel",
  args: ["service", "run"],
};

export interface FakeAutostart {
  readonly deps: AutostartDeps;
  /** 호출한 외부 명령을 `실행 파일 인자…` 한 줄로 쌓은 목록 */
  readonly calls: readonly string[];
  /** 등록 파일 내용. 비어 있으면 아무 파일도 없다 */
  readonly files: Map<string, string>;
  /** 만든 디렉터리 목록(지우지 않는다) */
  readonly dirs: Set<string>;
}

export interface FakeAutostartOptions {
  readonly platform: string;
  readonly home?: string;
  readonly reply?: (line: string) => AutostartRunResult;
  /** 파일 쓰기가 실패하는 기기(권한 없음 흉내) */
  readonly failWrites?: boolean;
}

const NO_REPLY: AutostartRunResult = { exitCode: 0, stdout: "" };

export function fakeAutostart(options: FakeAutostartOptions): FakeAutostart {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const calls: string[] = [];
  const deps: AutostartDeps = {
    platform: options.platform,
    home: options.home ?? FAKE_HOME,
    uid: FAKE_UID,
    command: FAKE_COMMAND,
    fs: {
      mkdir(path) {
        dirs.add(path);
      },
      writeFile(path, text) {
        if (options.failWrites === true) throw new Error(`EACCES: ${path}`);
        if (!dirs.has(dirname(path))) throw new Error(`ENOENT: ${dirname(path)}`);
        files.set(path, text);
      },
      readFile(path) {
        return files.get(path) ?? null;
      },
      remove(path) {
        if (!files.delete(path)) throw new Error(`ENOENT: ${path}`);
      },
      exists(path) {
        return files.has(path);
      },
    },
    run(cmd, args) {
      const line = [cmd, ...args].join(" ");
      calls.push(line);
      return Promise.resolve(options.reply?.(line) ?? NO_REPLY);
    },
  };
  return { deps, calls, files, dirs };
}
