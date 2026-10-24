import type { EnvReader } from "./dirs.ts";

/** process.env를 EnvReader로 감싼다. 빈 문자열도 그대로 돌려준다(비어 있는지는 읽는 쪽이 판단한다) */
export function processEnvReader(): EnvReader {
  return {
    get(name: string): string | undefined {
      return process.env[name];
    },
  };
}
