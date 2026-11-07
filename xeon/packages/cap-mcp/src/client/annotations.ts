import type { ToolHints } from "@fresnel/contracts/capabilities";
import type { JsonObject } from "@fresnel/contracts/conversation";
import type { McpDeclaredHints } from "@fresnel/contracts/services";
import type { RawToolAnnotations } from "../adapter.ts";

// L2.mcp.spec §3.4. 서버가 광고한 annotations를 ToolHints로 옮긴다. annotations는 서버의 자기 선언이라
// `trustAnnotations`가 거짓(기본)이면 정책 입력으로 쓰지 않는다: hints를 비우고 원본은 details에 둔다.

export interface MappedAnnotations {
  readonly hints: ToolHints;
  /** 표시 이름: 도구 `title` > `annotations.title` > 서버 도구 이름 */
  readonly label: string;
  /** 신뢰하지 않을 때 원본을 담는 details 조각. 신뢰하면 없다 */
  readonly details: JsonObject | undefined;
}

/** MCP 사양 기본값: readOnly 아님, destructive, idempotent 아님, openWorld [가정: MCP 사양의 기본값] */
const MCP_DEFAULTS: Required<ToolHints> = {
  readOnly: false,
  destructive: true,
  idempotent: false,
  openWorld: true,
};

function rawDetails(annotations: RawToolAnnotations): JsonObject {
  return {
    ...(annotations.readOnlyHint === undefined ? {} : { readOnlyHint: annotations.readOnlyHint }),
    ...(annotations.destructiveHint === undefined
      ? {}
      : { destructiveHint: annotations.destructiveHint }),
    ...(annotations.idempotentHint === undefined
      ? {}
      : { idempotentHint: annotations.idempotentHint }),
    ...(annotations.openWorldHint === undefined
      ? {}
      : { openWorldHint: annotations.openWorldHint }),
  };
}

export function mapAnnotations(
  name: string,
  title: string | undefined,
  annotations: RawToolAnnotations | undefined,
  trust: boolean,
): MappedAnnotations {
  const label = (title ?? annotations?.title ?? name).slice(0, 64);
  if (!trust) {
    return {
      label,
      hints: {},
      details: annotations === undefined ? undefined : { mcpAnnotations: rawDetails(annotations) },
    };
  }
  return {
    label,
    hints: {
      readOnly: annotations?.readOnlyHint ?? MCP_DEFAULTS.readOnly,
      destructive: annotations?.destructiveHint ?? MCP_DEFAULTS.destructive,
      idempotent: annotations?.idempotentHint ?? MCP_DEFAULTS.idempotent,
      openWorld: annotations?.openWorldHint ?? MCP_DEFAULTS.openWorld,
    },
    details: undefined,
  };
}

/**
 * 서버가 알린 성질 가운데 값이 있는 것. 신뢰 여부와 상관없이 원본을 싣는다: 승인 카드와 도구 행이 "서버가 알린 성질"로 보인다.
 * 정책 입력은 `mapAnnotations`의 힌트뿐이라, 이 값은 정책을 바꾸지 않는다.
 */
export function declaredHintsOf(
  annotations: RawToolAnnotations | undefined,
): McpDeclaredHints | undefined {
  if (annotations === undefined) return undefined;
  const declared: McpDeclaredHints = {
    ...(annotations.readOnlyHint === undefined ? {} : { readOnlyHint: annotations.readOnlyHint }),
    ...(annotations.destructiveHint === undefined
      ? {}
      : { destructiveHint: annotations.destructiveHint }),
    ...(annotations.idempotentHint === undefined
      ? {}
      : { idempotentHint: annotations.idempotentHint }),
    ...(annotations.openWorldHint === undefined
      ? {}
      : { openWorldHint: annotations.openWorldHint }),
  };
  return Object.keys(declared).length === 0 ? undefined : declared;
}
