import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TLiteral,
  type TObject,
  type TString,
  type TUnion,
} from "typebox";
import type { CapabilityApi, CapabilityDef } from "../capability.ts";
import type { MethodDef } from "../method.ts";
import { defineCapability } from "../capability.ts";
import { serviceKey, type ServiceKey } from "../service-key.ts";
import type { ToolContent, ToolSpec } from "../tool-spec.ts";

// [제안, AGE-63] 기능 `workspace.protection`. [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"]
// 셸과 파일 도구가 읽고 쓰지 못할 경로를 사용자 범위 설정 `l0.sandbox.protectedPaths.extra`에 더한다. 더하기만 한다.
// 막기를 푸는 메서드, 인자, 설정 쓰기는 없다. 모델이 보호를 낮출 수 없게 하려는 것이다.
// 정의는 이 파일 하나다. 구현은 `@fresnel/cap-workspace`(`protect/`)이고, 쓰기는 조립 루트가 넘기는 설정 저장소가 한다.

// ── 입력 ────────────────────────────────────────────────────────────────

/** 보호할 경로 한 줄. 절대 경로이거나 `~`·`~/`로 시작해야 한다. `/`와 홈 폴더 자체의 거부는 구현이 한다 */
const ProtectPathSchema: TString = Type.String({
  minLength: 1,
  maxLength: 4096,
  description: "Absolute path, or a path starting with ~/",
});

export const ProtectInputSchema: TObject<{ paths: TArray<TString> }> = Type.Object(
  {
    paths: Type.Array(ProtectPathSchema, {
      minItems: 1,
      maxItems: 32,
      description: "Paths to protect (reads and writes blocked)",
    }),
  },
  { additionalProperties: false },
);
export type ProtectInput = Static<typeof ProtectInputSchema>;

const PathListSchema = (maxItems: number): TArray<TString> =>
  Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems });

export const ProtectOutputSchema: TObject<{
  added: TArray<TString>;
  alreadyProtected: TArray<TString>;
  protected: TArray<TString>;
  effective: TLiteral<"next_shell_or_file_call">;
}> = Type.Object(
  {
    /** 이번 호출로 새로 더한 경로(저장된 모양) */
    added: PathListSchema(32),
    /** 이미 보호 중이라 그대로 둔 경로 */
    alreadyProtected: PathListSchema(32),
    /** 쓴 뒤의 사용자 범위 전체 목록(저장된 그대로) */
    protected: PathListSchema(256),
    /** 적용 시점. 셸 호출과 파일 도구 호출이 다음에 읽는 값이며 같은 턴 안에서도 적용된다 */
    effective: Type.Literal("next_shell_or_file_call"),
  },
  { additionalProperties: false },
);
export type ProtectOutput = Static<typeof ProtectOutputSchema>;

// ── 목록 ────────────────────────────────────────────────────────────────

export const ProtectedListInputSchema: TObject<Record<string, never>> = Type.Object(
  {},
  { additionalProperties: false },
);

/**
 * 지금 막힌 경로 한 줄. `path`는 표시용 문자열이다(홈 아래는 `~/`로 줄인다). `origin`은 `user`(사용자가 더한 것)와
 * `fixed`(Fresnel 자신의 고정 시크릿·데이터 경로)다. 쓰기만 막힌 기본 자격 폴더는 여기 없고 `suggested`에 있다.
 */
export const BlockedPathSchema: TObject<{
  path: TString;
  origin: TUnion<[TLiteral<"user">, TLiteral<"fixed">]>;
}> = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 4096 }),
    origin: Type.Union([Type.Literal("user"), Type.Literal("fixed")]),
  },
  { additionalProperties: false },
);

/** 제안 목록의 이 기기 줄. `blocked`는 사용자 범위 extra에 이미 있는지(읽기와 쓰기가 막혔는지)다 */
export const SuggestedPathSchema: TObject<{
  path: TString;
  label: TString;
  blocked: TBoolean;
}> = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 4096 }),
    label: Type.String({ minLength: 1, maxLength: 200 }),
    blocked: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const ProtectedListOutputSchema: TObject<{
  blocked: TArray<typeof BlockedPathSchema>;
  suggested: TArray<typeof SuggestedPathSchema>;
}> = Type.Object(
  {
    blocked: Type.Array(BlockedPathSchema, { maxItems: 256 }),
    suggested: Type.Array(SuggestedPathSchema, { maxItems: 64 }),
  },
  { additionalProperties: false },
);
export type ProtectedListOutput = Static<typeof ProtectedListOutputSchema>;

// ── 오류 ────────────────────────────────────────────────────────────────

const StoreFailedDetailSchema: TObject<{ code: TString }> = Type.Object(
  { code: Type.String({ maxLength: 64 }) },
  { additionalProperties: false },
);

// ── 정의 ────────────────────────────────────────────────────────────────

export type ProtectionMethods = {
  readonly protect: MethodDef<typeof ProtectInputSchema, typeof ProtectOutputSchema>;
  readonly list: MethodDef<typeof ProtectedListInputSchema, typeof ProtectedListOutputSchema>;
};

/** 더한 결과를 모델에 한두 문장으로 돌려준다. 적용 시점은 `effective`가 정한 문장이다 */
function renderProtect(out: ProtectOutput): ToolContent {
  const added =
    out.added.length === 0 ? "Nothing new was added." : `Added: ${out.added.join(", ")}.`;
  const already =
    out.alreadyProtected.length === 0
      ? ""
      : ` Already protected: ${out.alreadyProtected.join(", ")}.`;
  const now = ` Protected now: ${out.protected.length === 0 ? "none" : out.protected.join(", ")}.`;
  const timing =
    " Blocked for reading and writing from the next shell or file call, including later in this turn.";
  return {
    content: [{ type: "text", text: `${added}${already}${now}${timing}` }],
    structuredContent: out,
  };
}

/** 지금 막힌 것과 제안 목록을 모델에 돌려준다. 제안 줄은 기본으로 막혀 있지 않다(읽기도 쓰기도 된다)는 것을 함께 적는다 */
function renderList(out: ProtectedListOutput): ToolContent {
  const blocked =
    out.blocked.length === 0
      ? "none"
      : out.blocked
          .map((item) =>
            item.origin === "user" ? item.path : `${item.path} (Fresnel's own, fixed)`,
          )
          .join(", ");
  const suggested =
    out.suggested.length === 0
      ? "none"
      : out.suggested
          .map((item) => `${item.path} (${item.label})${item.blocked ? " [protected]" : ""}`)
          .join(", ");
  const text =
    `Blocked now (reads and writes): ${blocked}. ` +
    `Suggested (not blocked by default, reads and writes both work; add with sandbox_protect to block them): ${suggested}.`;
  return { content: [{ type: "text", text }], structuredContent: out };
}

/**
 * 보호 경로 더하기와 목록. 모델 도구는 둘이고 둘 다 지연 노출이다(cap-workspace가 등록한다).
 * ADR-0015 분류: `list`만 읽기 전용이다. `protect`는 사용자 설정을 쓰므로 분류하지 않는다(replay unsafe).
 */
export const WorkspaceProtection: CapabilityDef<
  ProtectionMethods,
  readonly [
    ToolSpec<"protect", typeof ProtectInputSchema, ProtectionMethods["protect"]>,
    ToolSpec<"list", typeof ProtectedListInputSchema, ProtectionMethods["list"]>,
  ]
> = defineCapability({
  id: "workspace.protection",
  version: "1.0.0",
  description:
    "Adds paths to the protected list that the shell and file tools can neither read nor write, and lists what is protected. Add-only: nothing can remove protection.",
  service: {
    methods: {
      protect: {
        description:
          "Adds paths to the user's protected paths (setting l0.sandbox.protectedPaths.extra, user scope). Add-only: paths are never removed. A path already protected is kept as it is. Each path must be absolute or start with ~/, and / or the home folder itself is refused. All paths are checked before anything is written.",
        input: ProtectInputSchema,
        output: ProtectOutputSchema,
        errors: {
          locked: {
            description: "The setting is locked by a managed policy",
            retryable: false,
          },
          store_failed: {
            description: "Could not write the user settings file",
            retryable: false,
            detail: StoreFailedDetailSchema,
          },
        },
      },
      list: {
        description:
          "Returns the paths blocked now (the user's and Fresnel's own fixed paths) and the folders suggested for this machine. Read-only.",
        input: ProtectedListInputSchema,
        output: ProtectedListOutputSchema,
        replay: "safe",
        readOnly: true,
      },
    },
  },
  tools: [
    {
      name: "sandbox_protect",
      label: "Protect Paths",
      description:
        "Adds paths to the protected list so the shell and file tools can neither read nor write them. Use only when the user asks. This tool only adds: it cannot remove protection.",
      method: "protect",
      parameters: ProtectInputSchema,
      toContent: renderProtect,
      outputSchema: ProtectOutputSchema,
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    },
    {
      name: "sandbox_protected",
      label: "Protected Paths",
      description:
        "Lists the paths blocked now and the folders suggested for protection on this machine.",
      method: "list",
      parameters: ProtectedListInputSchema,
      toContent: renderList,
      outputSchema: ProtectedListOutputSchema,
      replay: "safe",
      hints: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    },
  ],
});
export const WorkspaceProtectionKey: ServiceKey<CapabilityApi<typeof WorkspaceProtection>> =
  serviceKey(WorkspaceProtection);
