import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "@xeon/contracts";
import { SecretMetaSchema, type SecretMeta, type SecretName } from "@xeon/contracts/capabilities";
import type { SecretError } from "@xeon/contracts/services";
import { errorCode } from "./errors.ts";
import { handleForName } from "./ref.ts";

// L0.secrets.spec §3.2. 메타 파일은 비밀 하나에 YAML 파일 하나(`<dir>/<name>.yaml`)이고 값이 없다.
// 1차는 사용자 범위 디렉터리 하나만 읽는다. 프로젝트 저장소 안의 메타는 읽지 않는다.
// 쓰기(0600)는 마일스톤 M2(관리 서비스)다.

type MetaInvalid = Extract<SecretError, { kind: "meta_invalid" }>;

export type MetaEntry =
  | { readonly kind: "ok"; readonly name: SecretName; readonly meta: SecretMeta }
  | { readonly kind: "invalid"; readonly error: MetaInvalid };

export interface MetaStore {
  /** 읽을 수 없거나 스키마에 맞지 않는 파일은 invalid 항목이 되고 다른 비밀을 막지 않는다 */
  list(): Promise<readonly MetaEntry[]>;
  get(name: SecretName): Promise<MetaEntry | null>;
}

const EXTENSION = ".yaml";

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

  let raw: unknown;
  try {
    raw = Bun.YAML.parse(text);
  } catch {
    // 파싱 오류 메시지에 파일 내용 조각이 들어갈 수 있어 싣지 않는다
    return invalid(stem, path, ["not valid YAML"]);
  }

  const checked = parse(SecretMetaSchema, raw);
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

export function createMetaStore(dir: string): MetaStore {
  return {
    async list(): Promise<readonly MetaEntry[]> {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return [];
      }
      const stems = names
        .filter((n) => n.endsWith(EXTENSION))
        .map((n) => n.slice(0, -EXTENSION.length))
        .toSorted();
      const entries = await Promise.all(stems.map((stem) => readMetaFile(dir, stem)));
      return entries.filter((entry) => entry !== null);
    },
    get(name: SecretName): Promise<MetaEntry | null> {
      return readMetaFile(dir, name);
    },
  };
}
