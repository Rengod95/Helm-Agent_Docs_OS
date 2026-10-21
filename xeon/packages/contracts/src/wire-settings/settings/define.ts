import type { TSchema } from "typebox";
import {
  KEY_PREFIX_LAYERS,
  checkSettingDef,
  type SettingDef,
  type SettingDefIssue,
  type SettingDefRule,
  type SettingKey,
  type SettingLayer,
} from "./def.ts";

export type SettingNamespace =
  | `${"f" | "x" | "l0" | "l1" | "l2" | "l3" | "l4"}.${string}`
  | `ext.${string}`;

/** 이름 부분만 적는 입력 형태. key는 namespace와 이름으로 만들고 layer는 namespace에서 정한다. */
export type SettingDefInput<S extends TSchema = TSchema> = Omit<SettingDef<S>, "key" | "layer">;

export interface SettingGroup<
  N extends SettingNamespace,
  D extends Readonly<Record<string, SettingDefInput>>,
> {
  readonly namespace: N;
  readonly defs: {
    readonly [K in keyof D & string]: SettingDef<D[K]["type"]> & { readonly key: `${N}.${K}` };
  };
}

/** 선언 결함(규칙 위반)을 알리는 오류. 호출 결함과 선언 결함은 Result 대신 예외로 알린다(eng.typescript.guide TY-11). */
export class SettingDefError extends Error {
  override readonly name: string = "SettingDefError";
  readonly key: string;
  readonly issues: readonly SettingDefIssue[];

  constructor(key: string, issues: readonly SettingDefIssue[]) {
    super(
      `invalid setting definition ${key}: ${issues.map((i) => `${i.rule} ${i.message}`).join("; ")}`,
    );
    this.key = key;
    this.issues = issues;
  }
}

const NAMESPACE_REGEX = /^(?:(?:f|x|l[0-4])|ext)\.[a-z][a-z0-9-]*$/;

/** 이름 부분: 소문자로 시작하는 낙타 표기 마디를 점으로 이은 것 */
const NAME_REGEX = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/;

function layerOf(namespace: string): SettingLayer {
  const prefix = namespace.split(".")[0] ?? "";
  // ext.<이름>은 층을 접두로 정하지 않는다. 매니페스트가 층을 선언하기 전까지 플러그인의 L2로 본다 [가정].
  return KEY_PREFIX_LAYERS[prefix] ?? "L2";
}

/**
 * 선언만 한다. 등록(카탈로그에 넣기)은 X·L1의 로딩 경로가 buildCatalog로 한다.
 * 규칙 D1~D8을 어기면 SettingDefError를 던진다.
 */
export function defineSettings<
  const N extends SettingNamespace,
  const D extends Readonly<Record<string, SettingDefInput>>,
>(namespace: N, defs: D): SettingGroup<N, D> {
  if (!NAMESPACE_REGEX.test(namespace)) {
    throw new SettingDefError(namespace, [
      { rule: "D1", message: `namespace "${namespace}" is not <layer>.<domain> or ext.<name>` },
    ]);
  }
  const layer = layerOf(namespace);
  const built: Record<string, SettingDef> = {};
  for (const [name, input] of Object.entries(defs)) {
    const key = `${namespace}.${name}`;
    if (!NAME_REGEX.test(name)) {
      throw new SettingDefError(key, [
        { rule: "D1", message: `setting name "${name}" must be lower camel case segments` },
      ]);
    }
    const def: SettingDef = { ...input, key, layer };
    const issues = checkSettingDef(def);
    if (issues.length > 0) throw new SettingDefError(key, issues);
    built[name] = def;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 키별 리터럴 타입은 입력 D에서 오고 위 루프가 모든 키를 채웠다 (선언 함수, F.readme §1 예외 4)
  return { namespace, defs: built } as SettingGroup<N, D>;
}

export type SettingCatalog = ReadonlyMap<SettingKey, SettingDef>;

export type CatalogIssue =
  | { readonly code: "duplicateKey"; readonly key: SettingKey; readonly owners: readonly string[] }
  | {
      readonly code: "invalidDef";
      readonly key: string;
      readonly rule: SettingDefRule;
      readonly message: string;
    }
  | { readonly code: "foreignNamespace"; readonly key: SettingKey; readonly owner: string };

export interface CatalogGroupInput {
  /** 그룹을 내놓은 쪽(패키지 이름, 확장 이름 등) */
  readonly owner: string;
  readonly namespace: SettingNamespace;
  readonly defs: readonly SettingDef[];
}

/**
 * 순수 함수. 여러 그룹을 합친다. 키 중복, 네임스페이스 침범, 규칙 위반(D1~D9)을 모아 돌려준다.
 * 키가 그룹의 namespace 밖이면 foreignNamespace다(확장이 l1. 키를 정의하는 경우 포함).
 * 이슈가 하나라도 있으면 카탈로그를 만들지 않는다.
 */
export function buildCatalog(
  groups: readonly CatalogGroupInput[],
):
  | { readonly ok: true; readonly catalog: SettingCatalog }
  | { readonly ok: false; readonly issues: readonly CatalogIssue[] } {
  const issues: CatalogIssue[] = [];
  const owners = new Map<SettingKey, string[]>();
  const seen = new Map<SettingKey, SettingDef>();

  for (const group of groups) {
    for (const def of group.defs) {
      if (!def.key.startsWith(`${group.namespace}.`)) {
        issues.push({ code: "foreignNamespace", key: def.key, owner: group.owner });
        continue;
      }
      for (const issue of checkSettingDef(def)) {
        issues.push({ code: "invalidDef", key: def.key, rule: issue.rule, message: issue.message });
      }
      const list = owners.get(def.key) ?? [];
      list.push(group.owner);
      owners.set(def.key, list);
      if (!seen.has(def.key)) seen.set(def.key, def);
    }
  }
  for (const [key, list] of owners) {
    if (list.length > 1) issues.push({ code: "duplicateKey", key, owners: list });
  }
  // D9: deprecated.replacedBy는 같은 카탈로그에 있어야 한다
  for (const def of seen.values()) {
    const target = def.deprecated?.replacedBy;
    if (target !== undefined && !seen.has(target)) {
      issues.push({
        code: "invalidDef",
        key: def.key,
        rule: "D9",
        message: `deprecated.replacedBy "${target}" is not in the catalog`,
      });
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, catalog: seen };
}
