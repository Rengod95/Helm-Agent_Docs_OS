import { statSync } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { attempt, attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import type { SecretError } from "@fresnel/contracts/services";
import { errorCode } from "../errors.ts";
import {
  identityCopy,
  type KeyAvailability,
  type KeyProvider,
  type SopsKeyEnvName,
} from "./provider.ts";

// L0.secrets.spec §4.7 4번. 파일 폴백: identity 파일을 0600으로 두고 SOPS_AGE_KEY_FILE로 넘긴다.
// 이 코드는 파일 내용을 읽지 않는다. 소유자와 권한만 검사하고 틀리면 key_unavailable(file_mode)이다.
// 예외는 첫 실행의 provision과 keys.move의 readIdentity다(§4.7 1번). identity를 담은 버퍼는 쓴 직후 0으로 덮는다.

const KEY_FILE_MODE = 0o600;

interface KeyFileStat {
  readonly mode: number;
  readonly uid: number;
}

export type StatKeyFile = (path: string) => KeyFileStat | null;

const statKeyFile: StatKeyFile = (path) => {
  const stat = attempt(() => statSync(path));
  // 없거나 읽을 수 없는 키 파일은 item_missing으로 다룬다(호출자가 null을 그렇게 해석한다)
  return stat.ok ? { mode: stat.value.mode, uid: stat.value.uid } : null;
};

export interface FileKeyDeps {
  readonly path: string;
  /** POSIX uid. null(Windows)이면 소유자 검사를 건너뛴다 */
  readonly uid: number | null;
  readonly stat?: StatKeyFile;
}

type FileCheck = "ok" | "item_missing" | "file_mode";

function check(deps: FileKeyDeps): FileCheck {
  const stat = (deps.stat ?? statKeyFile)(deps.path);
  if (stat === null) return "item_missing";
  // 정확히 0600만 받는다. 더 좁은 0400도 거부해 "권한이 0600이 아니면 거부" 규칙(spec §4.7 4번)을 한 가지로 둔다
  if ((stat.mode & 0o777) !== KEY_FILE_MODE) return "file_mode";
  if (deps.uid !== null && stat.uid !== deps.uid) return "file_mode";
  return "ok";
}

const KEY_DIR_MODE = 0o700;

/**
 * 키 파일을 새로 만든다(이미 있으면 EEXIST, 덮어쓰지 않는다). 쓰다 만 새 파일은 지운다.
 * 덮어쓰기 거부(EEXIST)와 쓰기 실패는 write_failed로 돌려주고, 원인은 OS 오류 코드로 싣는다(TY-25). 키 내용은 싣지 않는다.
 */
async function createKeyFile(path: string, body: Uint8Array): Promise<Result<void, SecretError>> {
  const written = await attemptAsync(async () => {
    await mkdir(dirname(path), { recursive: true, mode: KEY_DIR_MODE });
    const handle = await open(path, "wx", KEY_FILE_MODE);
    try {
      await handle.chmod(KEY_FILE_MODE);
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close();
    }
  });
  if (!written.ok) {
    const code = errorCode(written.error.cause);
    // 이미 있던 파일(EEXIST)은 지우지 않는다
    if (code !== "EEXIST") await attemptAsync(() => rm(path, { force: true }));
    return err({ kind: "write_failed", target: "key_file", path, code });
  }
  return ok(undefined);
}

/** identity를 새로 만들어 키 파일로 쓴다(spec §4.7 1·4번). 수신자만 돌려준다 */
async function provisionKeyFile(
  path: string,
): Promise<Result<{ readonly recipient: string }, SecretError>> {
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  const body = new TextEncoder().encode(`# public key: ${recipient}\n${identity}\n`);
  try {
    const created = await createKeyFile(path, body);
    if (!created.ok) return err(created.error);
    return ok({ recipient });
  } finally {
    body.fill(0);
  }
}

/** 키 파일 본문에서 identity 줄을 찾아 복사한다. 주석 줄(`# public key:`)은 건너뛴다. 없으면 null */
function identityLineOf(body: Uint8Array): Uint8Array | null {
  let lineStart = 0;
  for (let i = 0; i <= body.length; i += 1) {
    if (i === body.length || body[i] === 0x0a) {
      const line = identityCopy(body.subarray(lineStart, i));
      if (line !== null) return line;
      lineStart = i + 1;
    }
  }
  return null;
}

export function createFileKeyProvider(deps: FileKeyDeps): KeyProvider {
  return {
    id: "file",
    probe(): Promise<KeyAvailability> {
      const state = check(deps);
      return Promise.resolve({ available: state === "ok", reason: state });
    },
    sopsKeyEnv(): Result<Readonly<Partial<Record<SopsKeyEnvName, string>>>, SecretError> {
      const state = check(deps);
      if (state === "ok") return ok({ SOPS_AGE_KEY_FILE: deps.path });
      return err({ kind: "key_unavailable", key: "file", reason: state });
    },
    provision() {
      return provisionKeyFile(deps.path);
    },
    async readIdentity(): Promise<Result<Uint8Array, SecretError>> {
      // 소유자와 권한을 먼저 본다. 틀린 파일은 내용을 열지 않는다
      const state = check(deps);
      if (state !== "ok") return err({ kind: "key_unavailable", key: "file", reason: state });
      const read = await attemptAsync(() => readFile(deps.path));
      if (!read.ok) return err({ kind: "key_unavailable", key: "file", reason: "item_missing" });
      const body = read.value;
      try {
        const identity = identityLineOf(body);
        if (identity === null) {
          return err({ kind: "key_unavailable", key: "file", reason: "item_missing" });
        }
        return ok(identity);
      } finally {
        body.fill(0);
      }
    },
    async storeIdentity(identity: Uint8Array): Promise<Result<void, SecretError>> {
      const text = new TextDecoder().decode(identity);
      const made = await attemptAsync(() => identityToRecipient(text));
      if (!made.ok) {
        return err({
          kind: "write_failed",
          target: "key_file",
          path: deps.path,
          code: "invalid_identity",
        });
      }
      const body = new TextEncoder().encode(`# public key: ${made.value}\n${text}\n`);
      try {
        return await createKeyFile(deps.path, body);
      } finally {
        body.fill(0);
      }
    },
    async removeKey(): Promise<Result<void, SecretError>> {
      const removed = await attemptAsync(() => rm(deps.path, { force: true }));
      if (removed.ok) return ok(undefined);
      return err({
        kind: "write_failed",
        target: "key_file",
        path: deps.path,
        code: errorCode(removed.error.cause),
      });
    },
  };
}
