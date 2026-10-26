import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { attemptAsync, err, ok, type Result } from "@xeon/contracts";
import type { SecretError } from "@xeon/contracts/services";
import { buildPlainEnv } from "../env-filter.ts";
import { errorCode } from "../errors.ts";
import { formatOfPath, parseSopsKeys } from "./sops-keys.ts";
import type { ProcessRunner } from "./process.ts";

// L0.secrets.spec §4.8 (c). 첫 쓰기가 SOPS 파일을 만든다. 빈 문서(`{}`)를 age 수신자로 암호화한 결과를 0600 파일로 둔다.
// 평문은 sops의 stdin으로만 가고 디스크에 쓰이지 않는다(문서에는 값이 없다). 암호문은 stdout으로 받아 임시 파일에 쓰고 이름을 바꾼다.

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const TIMEOUT_MS = 30_000;
/** 빈 YAML·JSON 문서. 둘 다 같은 글자로 읽힌다 */
const EMPTY_DOCUMENT = "{}\n";

export interface CreateSopsFileInput {
  readonly sops: string;
  readonly path: string;
  /** age 수신자(공개키) */
  readonly recipient: string;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly runner: ProcessRunner;
  readonly signal: AbortSignal;
}

function sopsFileFailure(path: string, code: string): SecretError {
  return { kind: "write_failed", target: "sops_file", path, code };
}

export async function sopsFileExists(path: string): Promise<boolean> {
  const found = await attemptAsync(() => stat(path));
  return found.ok;
}

let counter = 0;

/**
 * 암호화한 빈 SOPS 파일을 만든다. 호출자가 파일 잠금 안에서 파일이 없음을 확인한 뒤 부른다.
 * 형식은 확장자로 정한다. dotenv는 빈 문서를 암호화할 수 없어 `unsupported_format`이다.
 */
export async function createSopsFile(
  input: CreateSopsFileInput,
): Promise<Result<void, SecretError>> {
  const format = formatOfPath(input.path);
  if (format === "dotenv") return err(sopsFileFailure(input.path, "unsupported_format"));

  const made = await attemptAsync(() =>
    mkdir(dirname(input.path), { recursive: true, mode: DIR_MODE }),
  );
  if (!made.ok) return err(sopsFileFailure(input.path, errorCode(made.error.cause)));

  const run = await input.runner({
    argv: [
      input.sops,
      "encrypt",
      "--age",
      input.recipient,
      "--input-type",
      format,
      "--output-type",
      format,
      "--filename-override",
      input.path,
      "/dev/stdin",
    ],
    env: buildPlainEnv(input.parentEnv),
    timeoutMs: TIMEOUT_MS,
    signal: input.signal,
    stdin: new TextEncoder().encode(EMPTY_DOCUMENT),
  });
  if (!run.ok) {
    return err(
      run.error.kind === "cancelled"
        ? { kind: "cancelled" }
        : sopsFileFailure(input.path, run.error.code),
    );
  }
  if (run.value.exitCode !== 0 || run.value.stdout.length === 0) {
    return err(sopsFileFailure(input.path, "sops_encrypt_failed"));
  }
  // 만든 파일을 우리 파서가 읽을 수 있어야 한다. 아니면 이후 목록과 lease가 모두 실패한다
  const text = new TextDecoder().decode(run.value.stdout);
  if (!parseSopsKeys(text, format).ok) {
    return err(sopsFileFailure(input.path, "sops_encrypt_failed"));
  }

  counter += 1;
  const tmp = `${input.path}.${String(process.pid)}.${String(counter)}.tmp`;
  const written = await attemptAsync(async () => {
    const handle = await open(tmp, "wx", FILE_MODE);
    try {
      await handle.chmod(FILE_MODE);
      await handle.writeFile(run.value.stdout);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, input.path);
  });
  if (!written.ok) {
    await attemptAsync(() => rm(tmp, { force: true }));
    return err(sopsFileFailure(input.path, errorCode(written.error.cause)));
  }
  return ok(undefined);
}
