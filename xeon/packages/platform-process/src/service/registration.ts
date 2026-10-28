import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, basename, join } from "node:path";
import {
  Type,
  type Static,
  type TInteger,
  type TLiteral,
  type TObject,
  type TString,
} from "typebox";
import { attempt, err, ok, parse, parseJson, type Result } from "@xeon/contracts";

// L0.process.spec §3.2 service/registration.ts, §4.4.1, §4.4.7 1번. 서비스의 소켓 경로, pid, 버전, 토큰을 담은 JSON 파일(0600).
// 쓰기는 같은 디렉터리의 임시 파일(0600으로 만든다) → fsync → rename이라 이전 내용이나 새 내용 하나가 온전하다.
// 모르는 필드는 읽고 다시 써도 남는다(새 버전 서비스가 더한 필드를 옛 버전이 지우지 않는다).

/** 토큰 한 개의 모양: 32바이트 무작위를 패딩 없는 base64url로 적은 43자 */
export const SERVICE_TOKEN_PATTERN = "^[A-Za-z0-9_-]{43}$";

const ServiceRegistrationSchema: TObject<{
  schemaVersion: TLiteral<1>;
  version: TString;
  protocolVersion: TString;
  socket: TString;
  pid: TInteger;
  startedAt: TInteger;
  token: TString;
  storeId: TString;
}> = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    /** 엔진 버전(semver) */
    version: Type.String({ minLength: 1, maxLength: 64 }),
    /** 호스트 계약 버전(SemVer) */
    protocolVersion: Type.String({ minLength: 1, maxLength: 32 }),
    /** Unix 소켓 절대 경로 */
    socket: Type.String({ minLength: 1, maxLength: 1024 }),
    pid: Type.Integer({ minimum: 1 }),
    /** 프로세스 시작 시각 지문(epoch ms). pid 재사용을 가른다 */
    startedAt: Type.Integer({ minimum: 0 }),
    token: Type.String({ pattern: SERVICE_TOKEN_PATTERN }),
    /** 같은 DB인지 확인한다 */
    storeId: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: true },
);
export type ServiceRegistration = Static<typeof ServiceRegistrationSchema>;

export type RegistrationError =
  | { readonly kind: "absent" }
  | { readonly kind: "malformed"; readonly issue: string }
  | { readonly kind: "insecure_mode"; readonly mode: number }
  | { readonly kind: "io"; readonly code: string };

export interface RegistrationStore {
  /** `<runtimeDir>/service.json` */
  readonly path: string;
  read(): Result<ServiceRegistration, RegistrationError>;
  /** 임시 파일(0600) → fsync → rename. 기존 파일의 모르는 필드는 합쳐서 보존한다 */
  write(value: ServiceRegistration): Result<void, RegistrationError>;
  /** 내용의 pid·startedAt이 자기 것일 때만 지운다. 지웠으면 true */
  removeIfOwned(pid: number, startedAt: number): Result<boolean, RegistrationError>;
}

function codeOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function ioError(caught: unknown): RegistrationError {
  return { kind: "io", code: codeOf(caught) };
}

/** 같은 호스트의 두 쓰기가 임시 이름을 나눠 쓰지 않게 pid와 호출 순번을 붙인다 */
let tmpCounter = 0;

function readParsed(path: string): Result<ServiceRegistration, RegistrationError> {
  const stat = attempt(() => lstatSync(path));
  if (!stat.ok) {
    return codeOf(stat.error.cause) === "ENOENT"
      ? err({ kind: "absent" })
      : err(ioError(stat.error.cause));
  }
  const mode = stat.value.mode & 0o777;
  // 그룹·기타에 열린 파일은 토큰이 새었을 수 있으므로 읽지 않는다
  if ((mode & 0o077) !== 0) return err({ kind: "insecure_mode", mode });
  const text = attempt(() => readFileSync(path, "utf8"));
  if (!text.ok) return err(ioError(text.error.cause));
  const json = parseJson(text.value);
  if (!json.ok) return err({ kind: "malformed", issue: "not JSON" });
  const checked = parse(ServiceRegistrationSchema, json.value);
  if (!checked.ok) {
    return err({ kind: "malformed", issue: checked.error.issues[0]?.message ?? "invalid" });
  }
  return ok(checked.value);
}

/** 기존 파일이 JSON 객체면 그 필드를 돌려준다. 없거나 깨졌으면 빈 객체다(새 내용이 덮는다) */
function existingFields(path: string): Readonly<Record<string, unknown>> {
  const text = attempt(() => readFileSync(path, "utf8"));
  if (!text.ok) return {};
  const json = parseJson(text.value);
  if (!json.ok) return {};
  const value = json.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

export function createRegistrationStore(options: { readonly path: string }): RegistrationStore {
  const { path } = options;
  return {
    path,
    read: () => readParsed(path),
    write(value) {
      const merged = { ...existingFields(path), ...value };
      tmpCounter += 1;
      const tmp = join(
        dirname(path),
        `.${basename(path)}.${String(process.pid)}.${String(tmpCounter)}.tmp`,
      );
      const written = attempt(() => {
        // 권한은 만들 때 정한다. 만든 뒤 chmod하면 그 사이에 다른 사용자가 읽을 수 있다
        const fd = openSync(tmp, "wx", 0o600);
        try {
          writeSync(fd, `${JSON.stringify(merged)}\n`);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        renameSync(tmp, path);
        // 기존 파일이 0644로 남아 있었어도 rename이 새 inode를 들이므로 모드는 0600이다. 값 확인용으로만 한 번 더 좁힌다
        chmodSync(path, 0o600);
      });
      if (!written.ok) {
        // 실패해도 임시 파일이 남지 않게 한다. 정리 실패는 원래 오류를 가리지 않는다
        attempt(() => unlinkSync(tmp));
        return err(ioError(written.error.cause));
      }
      return ok(undefined);
    },
    removeIfOwned(pid, startedAt) {
      const current = readParsed(path);
      if (!current.ok) {
        // 없거나 깨진 파일은 자기 것이 아니다. 지우지 않는다
        return current.error.kind === "io" ? err(current.error) : ok(false);
      }
      if (current.value.pid !== pid || current.value.startedAt !== startedAt) return ok(false);
      const removed = attempt(() => unlinkSync(path));
      if (!removed.ok) {
        return codeOf(removed.error.cause) === "ENOENT"
          ? ok(false)
          : err(ioError(removed.error.cause));
      }
      return ok(true);
    },
  };
}
