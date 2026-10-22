import { link, mkdir, open, readdir, readFile, rename, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { attempt, attemptAsync, err, ok, parse, type Result } from "@xeon/contracts";
import { SecretMetaSchema, type SecretMeta, type SecretName } from "@xeon/contracts/capabilities";
import type { SecretError } from "@xeon/contracts/services";
import { errorCode } from "./errors.ts";
import { handleForName } from "./ref.ts";

// L0.secrets.spec §3.2. 메타 파일은 비밀 하나에 YAML 파일 하나(`<dir>/<name>.yaml`)이고 값이 없다.
// 1차는 사용자 범위 디렉터리 하나만 읽는다. 프로젝트 저장소 안의 메타는 읽지 않는다.
// 쓰기(마일스톤 M2, SC-02)는 0600 임시 파일을 fsync한 뒤 이름을 바꿔 들이는 원자 쓰기다.

type MetaInvalid = Extract<SecretError, { kind: "meta_invalid" }>;

export type MetaEntry =
  | { readonly kind: "ok"; readonly name: SecretName; readonly meta: SecretMeta }
  | { readonly kind: "invalid"; readonly error: MetaInvalid };

export interface MetaStore {
  /** 읽을 수 없거나 스키마에 맞지 않는 파일은 invalid 항목이 되고 다른 비밀을 막지 않는다 */
  list(): Promise<readonly MetaEntry[]>;
  get(name: SecretName): Promise<MetaEntry | null>;
  /**
   * 메타 파일을 쓴다(0600). overwrite가 false면 같은 이름이 있을 때 already_exists다.
   * 쓰기 실패는 meta_invalid(path는 대상 파일, errors는 "unwritable (<코드>)")로 알린다.
   */
  write(
    meta: SecretMeta,
    options: { readonly overwrite: boolean },
  ): Promise<Result<void, SecretError>>;
  /** 파일을 지운다. 없었으면 ok(false) */
  remove(name: SecretName): Promise<Result<boolean, SecretError>>;
}

const EXTENSION = ".yaml";
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const HEADER = "# Xeon 비밀 메타. 값은 들어 있지 않다. `xeon secret meta`로 고친다.\n";
let tempCounter = 0;

function invalid(name: string, path: string, errors: readonly string[]): MetaEntry {
  return { kind: "invalid", error: { kind: "meta_invalid", name, path, errors } };
}

async function readMetaFile(dir: string, stem: string): Promise<MetaEntry | null> {
  const path = join(dir, `${stem}${EXTENSION}`);
  const named = handleForName(stem);
  if (!named.ok)
    return invalid(stem, path, [`file name is not a valid secret name (${named.error.kind})`]);

  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return null;
    return invalid(stem, path, [`unreadable (${errorCode(error)})`]);
  }

  const decoded = attempt((): unknown => Bun.YAML.parse(text));
  // 파싱 오류 메시지에 파일 내용 조각이 들어갈 수 있어 cause를 싣지 않는다
  if (!decoded.ok) return invalid(stem, path, ["not valid YAML"]);

  const checked = parse(SecretMetaSchema, decoded.value);
  if (!checked.ok) {
    return invalid(
      stem,
      path,
      checked.error.issues.map((i) => `${i.path === "" ? "/" : i.path}: ${i.keyword}`),
    );
  }
  if (checked.value.name !== named.value.name) {
    return invalid(stem, path, ["/name: does not match the file name"]);
  }
  return { kind: "ok", name: named.value.name, meta: checked.value };
}

function unwritable(name: string, path: string, error: unknown): SecretError {
  return { kind: "meta_invalid", name, path, errors: [`unwritable (${errorCode(error)})`] };
}

/** 메타를 파일 내용으로 바꾼다. 읽을 때 쓰는 YAML 해석기와 같은 쪽의 stringify를 쓴다 */
export function serializeMeta(meta: SecretMeta): string {
  return `${HEADER}${Bun.YAML.stringify(meta, null, 2)}\n`;
}

async function writeMetaFile(
  dir: string,
  meta: SecretMeta,
  overwrite: boolean,
): Promise<Result<void, SecretError>> {
  const path = join(dir, `${meta.name}${EXTENSION}`);
  const named = handleForName(meta.name);
  if (!named.ok) return err(named.error);
  tempCounter += 1;
  const temp = `${path}.tmp-${process.pid}-${tempCounter}`;
  const staged = await attemptAsync(async () => {
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
    const handle = await open(temp, "wx", FILE_MODE);
    try {
      await handle.chmod(FILE_MODE);
      await handle.writeFile(serializeMeta(meta));
      await handle.sync();
    } finally {
      await handle.close();
    }
  });
  if (!staged.ok) {
    await attemptAsync(() => rm(temp, { force: true }));
    return err(unwritable(meta.name, path, staged.error.cause));
  }
  // 새로 만들 때는 hard link로 들여 같은 이름이 이미 있으면 EEXIST로 실패하게 한다(덮어쓰기 경쟁 방지)
  const placed = await attemptAsync(() => (overwrite ? rename(temp, path) : link(temp, path)));
  if (!overwrite) await attemptAsync(() => unlink(temp));
  if (placed.ok) return ok(undefined);
  await attemptAsync(() => rm(temp, { force: true }));
  if (errorCode(placed.error.cause) === "EEXIST") {
    return err({ kind: "already_exists", handle: named.value.handle });
  }
  return err(unwritable(meta.name, path, placed.error.cause));
}

export function createMetaStore(dir: string): MetaStore {
  return {
    async list(): Promise<readonly MetaEntry[]> {
      const listed = await attemptAsync(() => readdir(dir));
      if (!listed.ok) {
        // 디렉터리가 없으면 메타가 없는 것이다. 그 밖의 실패는 읽을 수 없다는 항목으로 알린다
        const code = errorCode(listed.error.cause);
        if (code === "ENOENT" || code === "ENOTDIR") return [];
        return [invalid(".", dir, [`unreadable (${code})`])];
      }
      const stems = listed.value
        .filter((n) => n.endsWith(EXTENSION))
        .map((n) => n.slice(0, -EXTENSION.length))
        .toSorted();
      const entries = await Promise.all(stems.map((stem) => readMetaFile(dir, stem)));
      return entries.filter((entry) => entry !== null);
    },
    get(name: SecretName): Promise<MetaEntry | null> {
      return readMetaFile(dir, name);
    },
    write(meta, options) {
      return writeMetaFile(dir, meta, options.overwrite);
    },
    async remove(name) {
      const path = join(dir, `${name}${EXTENSION}`);
      const removed = await attemptAsync(() => unlink(path));
      if (removed.ok) return ok(true);
      const code = errorCode(removed.error.cause);
      if (code === "ENOENT") return ok(false);
      return err(unwritable(name, path, removed.error.cause));
    },
  };
}
