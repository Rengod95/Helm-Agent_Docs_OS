import {
  RECORD_KIND_PATTERN,
  type ExtensionManifest,
  type PluginDecl,
  type PostItem,
  type RecordKind,
} from "@fresnel/contracts/extensions";
import { orchestrationOf } from "./util.ts";

const KIND_REGEX = new RegExp(RECORD_KIND_PATTERN);

type KindOwner = Pick<ExtensionManifest, "name">;

export type RecordCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** X PrimitiveErrorCode와 같은 문자열 */
      readonly code: "record_invalid" | "record_kind_undeclared";
      readonly message: string;
    };

function ownPrefix(manifest: KindOwner): string {
  return `grp.${manifest.name}.`;
}

/**
 * `g.record`의 kind 검사(L3.group-sdk.spec §3.7). 순수 함수.
 * `plugin`은 이 Registration의 플러그인 선언이다(구성원이면 그 구성원의 선언). 생략하면 뿌리 플러그인이다.
 * 다른 플러그인 접두나 kind 형식 위반은 `record_invalid`, 자기 접두인데 그 선언의 recordKinds에 없으면 `record_kind_undeclared`다.
 */
export function checkRecordKind(
  manifest: Pick<ExtensionManifest, "name" | "plugins">,
  kind: RecordKind,
  plugin: Pick<PluginDecl, "recordKinds"> | undefined = orchestrationOf(manifest),
): RecordCheck {
  if (!kind.startsWith(ownPrefix(manifest)) || !KIND_REGEX.test(kind)) {
    return {
      ok: false,
      code: "record_invalid",
      message: `record kind ${kind} is not under ${ownPrefix(manifest)}`,
    };
  }
  if (plugin?.recordKinds?.some((decl) => decl.kind === kind) !== true) {
    return {
      ok: false,
      code: "record_kind_undeclared",
      message: `record kind ${kind} is not declared`,
    };
  }
  return { ok: true };
}

/** `g.post`의 context 항목 customType 검사. 자기 `grp.<이름>.` 접두의 kind여야 한다. user 항목은 검사하지 않는다 */
export function checkPostItem(manifest: KindOwner, item: PostItem): RecordCheck {
  if (item.kind !== "context") return { ok: true };
  if (!item.customType.startsWith(ownPrefix(manifest)) || !KIND_REGEX.test(item.customType)) {
    return {
      ok: false,
      code: "record_invalid",
      message: `post customType ${item.customType} is not under ${ownPrefix(manifest)}`,
    };
  }
  return { ok: true };
}

/**
 * 이 Registration에게 보여도 되는 kind인가(L3.group-sdk.spec §3.7 이벤트 격리 정책). 순수 함수.
 * 확장 kind(`grp.*`, `x.*`)는 자기 접두이거나 `plugin`의 `readsRecordKinds`(끝의 `*`는 접두 일치)가 덮을 때만 참이다.
 * `plugin`을 생략하면 뿌리 플러그인이다. 코어 kind는 지점 페이로드로 넘어가는 것이라 항상 참이다.
 */
export function kindVisibleTo(
  manifest: Pick<ExtensionManifest, "name" | "plugins">,
  kind: string,
  plugin: Pick<PluginDecl, "readsRecordKinds"> | undefined = orchestrationOf(manifest),
): boolean {
  if (!kind.startsWith("grp.") && !kind.startsWith("x.")) return true;
  if (kind.startsWith(ownPrefix(manifest))) return true;
  return (plugin?.readsRecordKinds ?? []).some((declared) =>
    declared.endsWith("*") ? kind.startsWith(declared.slice(0, -1)) : declared === kind,
  );
}
