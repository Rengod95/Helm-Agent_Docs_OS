import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../base/schema-proof.ts";
import { SemVerSchema } from "../capabilities/index.ts";

// F.extensions.spec §3.1.4 도구 종류 플러그인(AGE-76 질문 2). 매니페스트 `externalTool`은 "이 플러그인은 외부 도구 하나를 나타낸다"는 선언이다.
// 선언은 데이터일 뿐 명령이 아니다: 엔진은 선언된 실행 파일 이름 하나를 PATH와 알려진 설치 자리에서 찾고, 닫힌 목록의 인자(`versionArgs`)로만
// 버전을 읽는다. 플러그인이 임의 명령이나 인자를 낼 길은 없다. 상태는 엔진이 점검해 카드에 싣는다(`PluginCard.externalTool.status`).

/** 실행 파일 이름. 경로 구분자와 공백, 셸 문자를 허용하지 않는다 */
export const EXTERNAL_TOOL_BINARY_PATTERN = "^[a-z][a-z0-9_-]{0,31}$";

/** 버전 확인에 쓸 수 있는 인자. 닫힌 목록이다(임의 인자 금지). 생략하면 `--version`이다 */
export const EXTERNAL_TOOL_VERSION_ARGS = ["--version", "version", "-V", "-version"] as const;
export type ExternalToolVersionArgs = (typeof EXTERNAL_TOOL_VERSION_ARGS)[number];

export const EXTERNAL_TOOL_PLATFORMS = ["darwin", "linux", "win32"] as const;
export type ExternalToolPlatform = (typeof EXTERNAL_TOOL_PLATFORMS)[number];

/** 설치 안내 글의 상한(글자). 앱이 대신 설치하지 않으므로 사용자가 복사해 쓰는 한두 줄이다 */
export const EXTERNAL_TOOL_INSTALL_MAX = 300;

/** 설치 안내 글. 화면 언어에 따라 `ko`나 `en`을 보인다 */
export interface ExternalToolInstall {
  readonly ko: string;
  readonly en: string;
}

/** 매니페스트 `externalTool`. 이름은 영어 기반이다 */
export interface ExternalToolDecl {
  /** 실행 파일 이름(경로 아님) */
  readonly binary: string;
  /** 최소 버전. 없으면 어느 버전이든 된다 */
  readonly minVersion?: string;
  /** 버전 확인 인자. 생략하면 `--version` */
  readonly versionArgs?: ExternalToolVersionArgs;
  /** 설치 안내 글 */
  readonly install: ExternalToolInstall;
  /** 앱이 이 도구를 묶어 온다(없는 것으로 판정되면 앱 문제다). 생략하면 거짓 */
  readonly bundled?: boolean;
  /** 이 도구를 쓰는 OS. 생략하면 모든 OS. 목록에 없는 OS에서는 이 플러그인이 보이지 않는다 */
  readonly platforms?: readonly ExternalToolPlatform[];
}

const installShape = Type.Object(
  {
    ko: Type.String({ minLength: 1, maxLength: EXTERNAL_TOOL_INSTALL_MAX }),
    en: Type.String({ minLength: 1, maxLength: EXTERNAL_TOOL_INSTALL_MAX }),
  },
  { additionalProperties: false },
);

const versionArgsShape = Type.Union(EXTERNAL_TOOL_VERSION_ARGS.map((arg) => Type.Literal(arg)));
const platformShape = Type.Union(EXTERNAL_TOOL_PLATFORMS.map((name) => Type.Literal(name)));

const declShape = Type.Object(
  {
    binary: Type.String({ pattern: EXTERNAL_TOOL_BINARY_PATTERN }),
    minVersion: Type.Optional(SemVerSchema),
    versionArgs: Type.Optional(versionArgsShape),
    install: installShape,
    bundled: Type.Optional(Type.Boolean()),
    platforms: Type.Optional(Type.Array(platformShape, { minItems: 1, maxItems: 3 })),
  },
  { additionalProperties: false },
);
export const ExternalToolDeclSchema: TUnsafe<ExternalToolDecl> = Type.Unsafe<ExternalToolDecl>(
  declShape satisfies SchemaProof<ExternalToolDecl, typeof declShape>,
);

/**
 * 도구 점검 상태. `ready`는 시스템에서 찾았다, `bundled`는 앱에 들어 있는 것을 쓴다, `missing`은 없다, `too_old`는 버전이 낮다,
 * `unusable`은 찾았지만 쓸 수 없다(`reason`은 점검 오류 종류). 경로는 싣지 않는다(홈 폴더 값을 담을 수 있다)
 */
export type ExternalToolStatus =
  | { readonly kind: "ready"; readonly version: string }
  | { readonly kind: "bundled"; readonly version: string }
  | { readonly kind: "missing" }
  | { readonly kind: "too_old"; readonly found: string; readonly required: string }
  | { readonly kind: "unusable"; readonly reason: string };

const statusShape = Type.Union([
  Type.Object(
    { kind: Type.Literal("ready"), version: Type.String({ maxLength: 64 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("bundled"), version: Type.String({ maxLength: 64 }) },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("missing") }, { additionalProperties: false }),
  Type.Object(
    {
      kind: Type.Literal("too_old"),
      found: Type.String({ maxLength: 64 }),
      required: Type.String({ maxLength: 64 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("unusable"), reason: Type.String({ maxLength: 64 }) },
    { additionalProperties: false },
  ),
]);
export const ExternalToolStatusSchema: TUnsafe<ExternalToolStatus> =
  Type.Unsafe<ExternalToolStatus>(
    statusShape satisfies SchemaProof<ExternalToolStatus, typeof statusShape>,
  );

/**
 * 카드의 도구 칸. 선언을 그대로 옮기고(생략값은 채운다) 엔진이 점검한 `status`를 더한다. `status`는 엔진이 점검한 플러그인(내장 도구 플러그인)에만 있고,
 * 아직 점검 전이거나 엔진이 점검하지 않는 선언이면 없다. 저장된 카드가 아니라 응답 값이다
 */
export interface CardExternalTool {
  readonly binary: string;
  readonly minVersion?: string;
  readonly versionArgs: ExternalToolVersionArgs;
  readonly install: ExternalToolInstall;
  readonly bundled: boolean;
  readonly platforms?: readonly ExternalToolPlatform[];
  readonly status?: ExternalToolStatus;
}

const cardShape = Type.Object(
  {
    binary: Type.String({ pattern: EXTERNAL_TOOL_BINARY_PATTERN }),
    minVersion: Type.Optional(SemVerSchema),
    versionArgs: versionArgsShape,
    install: installShape,
    bundled: Type.Boolean(),
    platforms: Type.Optional(Type.Array(platformShape, { minItems: 1, maxItems: 3 })),
    status: Type.Optional(statusShape),
  },
  { additionalProperties: false },
);
export const CardExternalToolSchema: TUnsafe<CardExternalTool> = Type.Unsafe<CardExternalTool>(
  cardShape satisfies SchemaProof<CardExternalTool, typeof cardShape>,
);

/** 선언에서 카드의 도구 칸을 만든다(점검 전이라 `status`가 없다) */
export function cardExternalToolOf(decl: ExternalToolDecl): CardExternalTool {
  return {
    binary: decl.binary,
    ...(decl.minVersion === undefined ? {} : { minVersion: decl.minVersion }),
    versionArgs: decl.versionArgs ?? "--version",
    install: decl.install,
    bundled: decl.bundled === true,
    ...(decl.platforms === undefined ? {} : { platforms: decl.platforms }),
  };
}

/** 이 OS에서 보이는 선언인가. `platforms`를 생략하면 모든 OS다 */
export function externalToolAppliesOn(
  decl: Pick<ExternalToolDecl, "platforms">,
  platform: ExternalToolPlatform,
): boolean {
  return decl.platforms === undefined || decl.platforms.includes(platform);
}
