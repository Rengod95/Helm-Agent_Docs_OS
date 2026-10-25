import { parse, type Result } from "@xeon/contracts";
import { SecretNameSchema, type SecretName } from "@xeon/contracts/capabilities";
import { MODEL_REF_PATTERN } from "@xeon/contracts/services";
import { Type } from "typebox";

// 최소 설정 화면의 순수 로직(G2-08, L4.desktop.spec §4.14). 화면이 보이는 값을 wire 값에서 만들고, 보내는 값을 입력에서 만든다.
// 키 값은 어디에도 없다. 이 모듈이 다루는 비밀은 이름(`secret://<이름>` 참조의 이름)뿐이다.

/** 설정 키. `core-models`의 `l1.models.*` 선언(L1.models.spec §6)과 같다 */
export const DEFAULT_MODEL_KEY = "l1.models.default";
export const PROVIDERS_KEY = "l1.models.providers";

/** 입력란에서 고르는 provider 후보. 목록은 편의일 뿐이고 어떤 provider id도 쓸 수 있다 */
export const PRESET_PROVIDERS: readonly string[] = ["anthropic", "openai", "google", "openrouter"];

const PROVIDER_ID = "^[a-z0-9][a-z0-9._-]{0,63}$";

// `l1.models.providers`의 원소 모양(core-models settings.ts providersSchema). 값은 프로세스 밖에서 오므로 읽을 때 검사한다(TY-10)
const ProviderEntrySchema = Type.Object(
  {
    id: Type.String({ pattern: PROVIDER_ID, maxLength: 64 }),
    enabled: Type.Boolean(),
    apiKeyRef: Type.Union([
      Type.String({ pattern: "^secret://[a-z][a-z0-9-]{1,63}$" }),
      Type.Null(),
    ]),
    baseUrl: Type.Union([Type.String({ minLength: 1, maxLength: 2048 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ProviderEntry = {
  readonly id: string;
  readonly enabled: boolean;
  /** `secret://<이름>` 참조. 값이 아니다 */
  readonly apiKeyRef: string | null;
  readonly baseUrl: string | null;
};

const ProvidersSchema = Type.Array(ProviderEntrySchema, { maxItems: 64 });
const DefaultModelSchema = Type.Union([
  Type.String({ pattern: MODEL_REF_PATTERN, maxLength: 265 }),
  Type.Null(),
]);

/** `settings.get`의 값을 provider 목록으로 읽는다. 모양이 맞지 않으면 빈 목록이다(설정 서비스가 쓰기 때 이미 검사했다) */
export function providersOf(value: unknown): readonly ProviderEntry[] {
  const parsed = parse(ProvidersSchema, value);
  return parsed.ok ? parsed.value : [];
}

export function defaultModelOf(value: unknown): string | null {
  const parsed = parse(DefaultModelSchema, value);
  return parsed.ok ? parsed.value : null;
}

// ── 입력 검사 ────────────────────────────────────────────────────────────

export type InputError = {
  readonly kind: "invalid";
  readonly field: "provider" | "model" | "secret";
};

const providerRegex = new RegExp(PROVIDER_ID);
const modelRefRegex = new RegExp(MODEL_REF_PATTERN);

export function checkProviderId(input: string): Result<string, InputError> {
  const id = input.trim();
  return providerRegex.test(id)
    ? { ok: true, value: id }
    : { ok: false, error: { kind: "invalid", field: "provider" } };
}

/**
 * provider의 기본 비밀 이름: `<provider>-api-key`. 비밀 이름은 소문자로 시작하고 소문자·숫자·하이픈 2~64자라서
 * provider id의 점과 밑줄은 하이픈으로 바꾼다. 규칙에 맞는 이름을 만들 수 없으면 오류다.
 */
export function providerSecretName(providerId: string): Result<SecretName, InputError> {
  const parsed = parse(SecretNameSchema, `${providerId.replaceAll(/[._]/g, "-")}-api-key`);
  return parsed.ok ? parsed : { ok: false, error: { kind: "invalid", field: "secret" } };
}

/** `provider/modelId[:추론레벨]` 형식 검사. 모델 목록은 wire에 없어 형식만 본다 */
export function checkModelRef(input: string): Result<string, InputError> {
  const ref = input.trim();
  return modelRefRegex.test(ref) && ref.length <= 265
    ? { ok: true, value: ref }
    : { ok: false, error: { kind: "invalid", field: "model" } };
}

/** provider의 키 참조를 목록에 넣는다. 같은 id가 있으면 그 원소만 바꾸고(켜고 참조를 정한다, baseUrl은 둔다) 없으면 끝에 더한다 */
export function withProviderKey(
  providers: readonly ProviderEntry[],
  providerId: string,
  secretName: SecretName,
): readonly ProviderEntry[] {
  const apiKeyRef = `secret://${secretName}`;
  const found = providers.some((entry) => entry.id === providerId);
  if (!found) return [...providers, { id: providerId, enabled: true, apiKeyRef, baseUrl: null }];
  return providers.map((entry) =>
    entry.id === providerId ? { ...entry, enabled: true, apiKeyRef } : entry,
  );
}

// ── 첫 실행 안내 ─────────────────────────────────────────────────────────

/** `secret.list` 항목 중 화면이 쓰는 부분. 상태는 값이 풀리는지가 아니라 등록 여부를 말한다 */
export type SecretRow = { readonly name: string; readonly registered: boolean };

export type SetupStep = {
  readonly id: "tools" | "key" | "model";
  readonly done: boolean;
  /** 점검 결과를 받을 수 없을 때 `done`은 거짓이고 이 값이 참이다. 막힌 것이 아니라 모르는 것이다 */
  readonly unknown: boolean;
};

export type SetupInput = {
  readonly providers: readonly ProviderEntry[];
  readonly defaultModel: string | null;
  /** null이면 비밀 목록을 읽지 못했다 */
  readonly secrets: readonly SecretRow[] | null;
  /** null이면 점검 결과를 받지 못했다 */
  readonly toolsReady: boolean | null;
};

/** 키 참조가 가리키는 비밀이 등록되어 있는 provider id 목록 */
export function providersWithKey(input: SetupInput): readonly string[] {
  const registered = new Set((input.secrets ?? []).filter((s) => s.registered).map((s) => s.name));
  return input.providers
    .filter((entry) => {
      if (!entry.enabled || entry.apiKeyRef === null) return false;
      return registered.has(entry.apiKeyRef.slice("secret://".length));
    })
    .map((entry) => entry.id);
}

/**
 * 첫 실행 안내의 세 단계: 외부 도구, 모델 키, 기본 모델. 기본 모델의 provider가 키를 가진 provider와 같아야 끝난 것으로 본다.
 * 모든 단계가 done이면 대화를 시작할 수 있다.
 */
export function setupSteps(input: SetupInput): readonly SetupStep[] {
  const withKey = providersWithKey(input);
  const modelProvider = input.defaultModel === null ? null : input.defaultModel.split("/")[0];
  return [
    {
      id: "tools",
      done: input.toolsReady === true,
      unknown: input.toolsReady === null,
    },
    {
      id: "key",
      done: withKey.length > 0,
      unknown: input.secrets === null,
    },
    {
      id: "model",
      done:
        modelProvider !== null && modelProvider !== undefined && withKey.includes(modelProvider),
      unknown: false,
    },
  ];
}

/** 모델 키와 기본 모델이 모두 끝났는가. 외부 도구는 점검 결과를 못 받는 연결이 있어 시작 가능 여부에는 넣지 않는다 */
export function readyToChat(input: SetupInput): boolean {
  const steps = setupSteps(input);
  return steps.every((step) => step.id === "tools" || step.done);
}
