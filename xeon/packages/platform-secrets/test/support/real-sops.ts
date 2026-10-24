import { chmod, mkdir, writeFile } from "node:fs/promises";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { err, ok } from "@xeon/contracts";
import { createRedactor } from "../../src/redactor.ts";
import {
  bunRunner,
  createSopsProvider,
  createSopsResolver,
  type ProcessRunner,
  type SopsKeyAccess,
  type SopsProvider,
} from "../../src/providers/sops.ts";
import { manualClock } from "./clock.ts";
import { fixedLocalIds } from "./ids.ts";
import { recordingLogger, type TempDir } from "./os.ts";

// 실제 sops 바이너리와 일회용 age 키로 만든 시험 환경. 키와 값은 시험이 만든 가짜이고 임시 디렉터리 밖에 남지 않는다.
// 바이너리가 없는 기기(CI 일부)에서는 시험이 건너뛴다.

export const REAL_SOPS: string | null = Bun.which("sops");

export interface RealSopsFixture {
  readonly sops: string;
  readonly keyFile: string;
  readonly identity: string;
  readonly yaml: string;
  /** sops에 주는 HOME. 개발자의 홈 설정이 시험에 섞이지 않도록 임시 디렉터리 안의 빈 디렉터리다 */
  readonly home: string;
}

function plainEnv(home: string): Record<string, string> {
  return { PATH: Bun.env["PATH"] ?? "/usr/bin:/bin", HOME: home };
}

async function runPlain(argv: readonly string[], home: string): Promise<number> {
  const proc = Bun.spawn([...argv], { env: plainEnv(home), stdout: "ignore", stderr: "ignore" });
  return proc.exited;
}

/** 일회용 age 키(0600)와 sops로 암호화한 YAML 파일을 만든다. initial은 키 → 가짜 값 */
export async function realSopsFixture(
  dir: TempDir,
  sops: string,
  initial: Readonly<Record<string, string>>,
): Promise<RealSopsFixture> {
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  const home = dir.join("home");
  await mkdir(home, { recursive: true });
  const keyFile = dir.join("age-keys.txt");
  await writeFile(keyFile, `# public key: ${recipient}\n${identity}\n`, { mode: 0o600 });
  await chmod(keyFile, 0o600);
  const yaml = dir.join("secrets.dev.yaml");
  const plain = Object.entries(initial)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  await writeFile(yaml, `${plain}\n`);
  const code = await runPlain([sops, "encrypt", "--age", recipient, "--in-place", yaml], home);
  if (code !== 0) throw new Error("fixture: sops encrypt failed");
  return { sops, keyFile, identity, yaml, home };
}

export interface RealProviderOptions {
  readonly runner?: ProcessRunner;
  readonly key?: SopsKeyAccess;
}

export function realProvider(fx: RealSopsFixture, options: RealProviderOptions = {}): SopsProvider {
  const clock = manualClock();
  const runner = options.runner ?? bunRunner;
  const signal = new AbortController().signal;
  const resolver = createSopsResolver({
    configured: () => fx.sops,
    resolveBinary: () =>
      Promise.resolve(err({ kind: "not_found", name: "sops", searched: [], hint: "" })),
    runner,
    signal,
    parentEnv: plainEnv(fx.home),
  });
  const key: SopsKeyAccess = options.key ?? {
    id: "file",
    env: { SOPS_AGE_KEY_FILE: fx.keyFile },
  };
  return createSopsProvider({
    files: () => [{ env: "dev", path: fx.yaml }],
    binary: () => resolver.resolve(),
    key: () => Promise.resolve(ok(key)),
    parentEnv: plainEnv(fx.home),
    runner,
    signal,
    redactor: createRedactor(),
    clock,
    scheduler: clock,
    ids: fixedLocalIds(),
    logger: recordingLogger(),
  });
}
