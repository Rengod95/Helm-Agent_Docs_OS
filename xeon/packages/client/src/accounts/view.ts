import {
  ROTATION_RISK_NOTICE,
  accountsOf,
  rateLimitOf,
  type AccountRow,
  type RateLimitEntry,
} from "./accounts.ts";

// 모델 계정 화면의 view-model(L4.settings-ui.spec §4.2, M3-REQ-85). 설정 값 두 개와 플러그인 상태를 받아
// 화면이 그릴 값을 만든다. 입력은 `unknown`이라 잘못된 모양은 빈 값으로 읽힌다.

export type RotationState = "off" | "needsNotice" | "on";

export interface RotationView {
  /** off: 플러그인이 꺼져 있다. needsNotice: 켜졌지만 고지에 동의하지 않았다. on: 회전이 돈다 */
  readonly state: RotationState;
  readonly notice: string;
}

export interface ProviderAccountsRow {
  readonly provider: string;
  /** 우선순위 오름차순. 같은 우선순위는 설정 순서를 따른다 */
  readonly accounts: readonly AccountRow[];
  /** 정책이 없으면 null */
  readonly policy: RateLimitEntry | null;
}

export interface ModelAccountsView {
  /** 계정이나 정책이 있는 provider를 id 순으로 */
  readonly providers: readonly ProviderAccountsRow[];
  readonly rotation: RotationView;
}

export interface ModelAccountsInput {
  /** `l1.models.accounts`의 값 */
  readonly accounts: unknown;
  /** `l1.models.rateLimit`의 값 */
  readonly rateLimit: unknown;
  /** `ext.account-rotation.acknowledgeRisk`의 값. `true`일 때만 동의한 것이다 */
  readonly acknowledged: unknown;
  /** account-rotation 플러그인 scope가 켜져 있는가 */
  readonly pluginEnabled: boolean;
}

export function modelAccountsView(input: ModelAccountsInput): ModelAccountsView {
  const accounts = accountsOf(input.accounts);
  const rateLimit = rateLimitOf(input.rateLimit);
  const providerIds = [
    ...new Set([...accounts.map((account) => account.provider), ...Object.keys(rateLimit)]),
  ].toSorted();
  const providers = providerIds.map((provider) => ({
    provider,
    accounts: accounts
      .filter((account) => account.provider === provider)
      .toSorted((a, b) => a.priority - b.priority),
    policy: rateLimit[provider] ?? null,
  }));
  const rotation: RotationView = {
    state: rotationStateOf(input.pluginEnabled, input.acknowledged),
    notice: ROTATION_RISK_NOTICE,
  };
  return { providers, rotation };
}

/** 꺼짐이 먼저다. 켜진 뒤에만 고지 동의를 본다(M3-REQ-85, 기본 꺼짐과 첫 사용 고지) */
function rotationStateOf(pluginEnabled: boolean, acknowledged: unknown): RotationState {
  if (!pluginEnabled) return "off";
  return acknowledged === true ? "on" : "needsNotice";
}
