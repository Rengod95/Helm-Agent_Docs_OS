import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { attemptAsync, err, ok, type Result } from "@xeon/contracts";
import type { KeyProviderIdPublic } from "@xeon/contracts/services";
import { SECRETS_SUBDIR } from "../config.ts";
import { errorCode } from "../errors.ts";

// L0.secrets.spec §4.7 7번. age 수신자(공개키) 기록. 공개 정보라 평문 파일이고, 키를 만든 직후 쓴다.
// 키는 Keychain에 있고 이 패키지는 identity를 읽지 않으므로(§4.7 1번), 첫 쓰기가 SOPS 파일을 만들다 실패해도
// 다음 시도가 수신자를 이 파일에서 되찾는다. 키 저장 방식(provider id)마다 따로 둔다: 다른 키의 수신자를 섞지 않는다.

const RECIPIENT_PATTERN = /^age1[0-9a-z]{20,100}$/;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export function recipientPath(configDir: string, keyId: KeyProviderIdPublic): string {
  return join(configDir, SECRETS_SUBDIR, "age", `recipient.${keyId}.txt`);
}

/** 없거나 모양이 틀리면 null. 없는 것은 오류가 아니다 */
export async function readRecipient(path: string): Promise<string | null> {
  const read = await attemptAsync(() => readFile(path, "utf8"));
  if (!read.ok) return null;
  const text = read.value.trim();
  return RECIPIENT_PATTERN.test(text) ? text : null;
}

let counter = 0;

/** 같은 디렉터리의 임시 파일(0600)에 쓰고 이름을 바꾼다. 실패하면 OS 오류 코드를 돌려준다 */
export async function writeRecipient(
  path: string,
  recipient: string,
): Promise<Result<void, { readonly code: string }>> {
  counter += 1;
  const tmp = `${path}.${String(process.pid)}.${String(counter)}.tmp`;
  const written = await attemptAsync(async () => {
    await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
    await writeFile(tmp, `${recipient}\n`, { mode: FILE_MODE });
    await rename(tmp, path);
  });
  if (written.ok) return ok(undefined);
  await attemptAsync(() => rm(tmp, { force: true }));
  return err({ code: errorCode(written.error.cause) });
}
