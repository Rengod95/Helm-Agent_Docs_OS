import { ModelsError, type CredentialInfo, type CredentialStore } from "@earendil-works/pi-ai";
import { err, ok, type Result } from "@xeon/contracts";
import { parseSecretRef } from "@xeon/contracts/capabilities";
import type { SecretRefString, SecretService, UseCtx } from "@xeon/contracts/services";

// L1.models.spec §3.9, §4.7, L1.models.plan M-6. core-models 내부이고 공개하지 않는다.
// 값은 read() 안에서만 얻어 반환 객체에만 둔다. 캐시하지 않고, 요청 직전(Models.getAuth가 부를 때)마다 해석한다.
// 오류와 로그에는 비밀 이름이나 오류 종류만 싣고 값은 싣지 않는다.

export interface ProviderCredentialRefs {
  /** providerId → 비밀 참조. l1.models.providers 설정에서 만든다 */
  get(providerId: string): SecretRefString | null;
  /** 참조가 있는 provider id. list()가 메타만 돌려주는 데 쓴다(spec의 인터페이스에 더한 메서드) */
  ids(): readonly string[];
}

/** 값을 쓰는 요청의 목적지. SecretService 정책(runtime-http의 호스트 일치)이 본다 */
export interface SecretTarget {
  readonly host: string;
  readonly port: number | null;
}

/** 해석 실패의 기록. 값은 없다 */
export interface CredentialFailure {
  /** 종결 메시지의 접두 kind. 해석 자체가 실패하면 secret_unresolved, 가드가 막으면 oauth_token_on_default_provider */
  readonly kind: "secret_unresolved" | "oauth_token_on_default_provider";
  readonly providerId: string;
  /** 참조 구문이 틀렸으면 null */
  readonly secretName: string | null;
  readonly reason: string;
}

export interface SecretBridgeOptions {
  /** provider의 요청 목적지. 모르면 null */
  readonly targetOf?: (providerId: string) => SecretTarget | null;
  /** read()가 실패하기 직전에 부른다. 파이프라인이 secret_unresolved 종결 메시지를 만드는 데 쓴다 */
  readonly onFailure?: (failure: CredentialFailure) => void;
}

/** L1.models.spec §3.9 위장 경로 가드: 기본 anthropic provider에서 해석한 값이 구독 OAuth 토큰 모양인지 */
const DEFAULT_ANTHROPIC = "anthropic";
const OAUTH_TOKEN_MARK = "sk-ant-oat";

/** 기본 anthropic provider로 가는 구독 OAuth 토큰이면 참. pi-ai 기본 경로는 키 접두만으로 위장 분기에 들어간다 */
export function isOauthTokenOnDefaultProvider(providerId: string, key: string): boolean {
  return providerId === DEFAULT_ANTHROPIC && key.includes(OAUTH_TOKEN_MARK);
}

/** 가드에 걸렸을 때의 실패 기록 */
export function oauthGuardFailure(providerId: string): CredentialFailure {
  return {
    kind: "oauth_token_on_default_provider",
    providerId,
    secretName: null,
    reason: `provider ${providerId} does not accept subscription OAuth tokens`,
  };
}

/** 비밀 참조를 요청 직전에 해석한다. 값은 반환 값에만 있고 어디에도 남기지 않는다 */
export interface SecretResolver {
  /** purpose는 `model.provider:<id>` 같은 사용 목적, providerId는 목적지 조회에 쓴다 */
  resolve(
    ref: SecretRefString,
    providerId: string,
    purpose: string,
  ): Promise<Result<string, CredentialFailure>>;
}

export function createSecretResolver(
  secrets: SecretService,
  options: Pick<SecretBridgeOptions, "targetOf">,
): SecretResolver {
  return {
    async resolve(ref, providerId, purpose) {
      const parsed = parseSecretRef(ref);
      if (!parsed.ok) {
        return err({
          kind: "secret_unresolved",
          providerId,
          secretName: null,
          reason: `reference for ${providerId} is malformed (${parsed.error.kind})`,
        });
      }
      const target = options.targetOf?.(providerId) ?? null;
      const ctx: UseCtx = {
        mode: "runtime-http",
        purpose,
        target: { kind: "host", host: target?.host ?? "", port: target?.port ?? null },
        actor: "runtime",
        threadId: null,
        toolCallId: null,
        projectId: null,
        approval: null,
      };
      const name = parsed.value.name;
      const leased = await secrets.lease(parsed.value.handle, ctx);
      if (!leased.ok) {
        return err({
          kind: "secret_unresolved",
          providerId,
          secretName: name,
          // 정책이 거부했으면 사유(mode_not_allowed, host_mismatch 등)도 싣는다: 사람이 `secret meta`나 provider 연결로 고칠 곳을 안다
          reason: `secret ${name} could not be leased (${
            leased.error.kind === "denied" ? `denied: ${leased.error.reason}` : leased.error.kind
          })`,
        });
      }
      const lease = leased.value;
      try {
        const used = await lease.use((view) => view.text());
        if (!used.ok) {
          return err({
            kind: "secret_unresolved",
            providerId,
            secretName: name,
            reason: `secret ${name} could not be used (${used.error.kind})`,
          });
        }
        return ok(used.value);
      } finally {
        lease.dispose();
      }
    },
  };
}

/** pi-ai CredentialStore 구현. read()가 요청마다 참조를 해석한다. list()는 메타만, modify·delete는 거부 */
export function secretBackedCredentialStore(
  refs: ProviderCredentialRefs,
  secrets: SecretService,
  options: SecretBridgeOptions = {},
): CredentialStore {
  const resolver = createSecretResolver(secrets, options);
  // CredentialStore 계약이 실패를 reject로 요구한다(eng.typescript.guide TY-11 허용 3). Models가 ModelsError("auth")로 감싼다.
  function fail(failure: CredentialFailure): never {
    options.onFailure?.(failure);
    throw new ModelsError("auth", `${failure.kind}: ${failure.reason}`);
  }

  return {
    async read(providerId) {
      const ref = refs.get(providerId);
      if (ref === null) return undefined;
      const resolved = await resolver.resolve(ref, providerId, `model.provider:${providerId}`);
      if (!resolved.ok) return fail(resolved.error);
      if (isOauthTokenOnDefaultProvider(providerId, resolved.value)) {
        return fail(oauthGuardFailure(providerId));
      }
      return { type: "api_key", key: resolved.value };
    },
    list() {
      const infos: CredentialInfo[] = refs.ids().map((providerId) => ({
        providerId,
        type: "api_key",
      }));
      return Promise.resolve(infos);
    },
    modify() {
      // 키 등록과 삭제는 비밀 관리 경로(just secret-add, 설정 화면 secrets 탭)로만 한다
      return Promise.reject(
        new ModelsError("auth", "credentials are managed through secret references only"),
      );
    },
    delete() {
      return Promise.reject(
        new ModelsError("auth", "credentials are managed through secret references only"),
      );
    },
  };
}
