import { mkdir } from "node:fs/promises";
import { tempDir } from "./temp-dir.ts";

export interface IsolatedEnv {
  /** 임시 HOME */
  readonly home: string;
  /** 이 호출이 임시 경로로 바꾼 변수와 값 */
  readonly vars: Readonly<Record<string, string>>;
}

/** 비밀·계정 변수: eng.testing.guide TS-03 표 */
const SECRET_NAME_PATTERNS: readonly RegExp[] = [
  /_API_KEY$/,
  /^ANTHROPIC_/,
  /^OPENAI_/,
  /^SOPS_AGE_KEY/,
  /^SSH_AUTH_SOCK$/,
];

/**
 * HOME, XDG_*, TMPDIR, XEON_HOME을 임시 디렉터리로 바꾸고 *_API_KEY, ANTHROPIC_*, OPENAI_*, SOPS_AGE_KEY*,
 * SSH_AUTH_SOCK을 지운 채 fn을 실행한 뒤(예외가 나도) 원래 값으로 되돌린다. 프로세스 전역 process.env를
 * 바꾸므로 같은 파일 안에서 병렬로 돌리지 않는다.
 * 주의: Bun의 os.homedir()는 처음 부른 값을 기억해 HOME 변경을 따라가지 않는다. 격리된 HOME이 필요한 코드는
 * os.homedir() 대신 이 함수가 넘기는 env.home을 입력으로 받아야 한다.
 */
export async function withIsolatedEnv<T>(fn: (env: IsolatedEnv) => Promise<T>): Promise<T> {
  const dir = await tempDir("xeon-env-");
  const vars: Record<string, string> = {
    HOME: dir.join("home"),
    XDG_CONFIG_HOME: dir.join("xdg", "config"),
    XDG_DATA_HOME: dir.join("xdg", "data"),
    XDG_CACHE_HOME: dir.join("xdg", "cache"),
    XDG_STATE_HOME: dir.join("xdg", "state"),
    XDG_RUNTIME_DIR: dir.join("xdg", "run"),
    TMPDIR: dir.join("tmp"),
    XEON_HOME: dir.join("xeon"),
  };
  const cleared = Object.keys(process.env).filter((name) =>
    SECRET_NAME_PATTERNS.some((pattern) => pattern.test(name)),
  );
  const saved = new Map<string, string | undefined>();
  for (const name of [...Object.keys(vars), ...cleared]) saved.set(name, process.env[name]);
  try {
    await Promise.all(
      Object.values(vars).map((path) => mkdir(path, { recursive: true, mode: 0o700 })),
    );
    for (const [name, value] of Object.entries(vars)) process.env[name] = value;
    for (const name of cleared) Reflect.deleteProperty(process.env, name);
    return await fn({ home: dir.join("home"), vars });
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
    await dir.remove();
  }
}
