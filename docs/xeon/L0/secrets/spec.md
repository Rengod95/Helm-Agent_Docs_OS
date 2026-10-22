---
id: L0.secrets.spec
layer: L0
domain: secrets
kind: spec
status: draft
depends_on: [F.wire-settings.spec, F.records.spec, L0.exec.spec, L0.os.spec, L0.sandbox.spec, adr.0001, eng.best-practices.guide, eng.anti-patterns.guide, eng.dependency-rules.guide]
binds: [xeon/packages/platform-secrets/**]
---

# L0 비밀 (platform-secrets)

## 1. 목적과 범위

### 1.1 정하는 것

- 서비스 `xeon.secrets`(`SecretService`)와 제공자 인터페이스 `SecretProvider`. `platform-secrets`가 구현해 Cordis에 등록한다(`eng.context-map.design` 5.3절). 참조 형식(`SECRET_REF_PATTERN`, `SecretRef`)의 정본은 F `capabilities/secrets.ts`(`F.capabilities.spec` §3.10)이고, 여러 층이 쓰는 값 타입 `SecretMeta`, `SecretUsePolicy`, `SecretAuditRecord`도 같은 파일에 둔다 [결정: review.decisions-2 U-08]. 서비스 인터페이스의 F 위치는 3절 첫 단락이다.
- 핵심 규칙 [결정: `_research/decisions-log.md` 2026-10-21 2차 "에이전트는 값을 모른 채 참조로 사용", 층 구성 계획 v2 L0-c note(`_research/layer-plan-v2.json`)]:
  1. 에이전트와 모델은 값을 모른 채 `secret://<name>` 참조만 쓴다. name은 `[a-z][a-z0-9-]{1,63}`이고 형식은 F `SecretRef`(`F.wire-settings.spec` §3.8.1)다.
  2. 값은 런타임 부모 프로세스 메모리에서 도구 실행 직전에만 풀린다.
  3. 값은 모델 컨텍스트, 이벤트 저장소, 도구 자식 프로세스의 기본 env에 들어가지 않는다.
- 참조 구문 분석과 거부 규칙, 값 없는 메타 파일, lease 수명, 사용 모드 4종(M1~M4)과 단계, 마스킹 5계층과 `Redactor`, 감사 기록, 관리 동작(서비스 메서드), SOPS 기본 제공자와 age 키 획득(OS 키체인 3종과 파일 폴백), 설정 키 `l0.secrets.*`.
- `sops`, `age` 바이너리 호출은 이 패키지만 한다(`eng.dependency-rules.guide` DR-07 표 "`sops`, `age` 바이너리 호출" 행).

### 1.2 다루지 않는 것

| 주제 | 담당 문서 |
|---|---|
| 도구 자식 프로세스 생성과 env 구성 | `L0.exec.spec`(`xeon.exec`) |
| 네트워크 프록시, TLS 종단, 샌드박스 정책 | `L0.sandbox.spec`(`xeon.sandbox`). sentinel 모드(M2)와의 접점은 후속이며 이 문서의 M2 요구로만 둔다 |
| 승인 요청과 기억 범위 | `L1.tools.spec`(`xeon.approvals`) |
| 감사 이벤트를 세션 이벤트로 기록하는 일 | `core-tools`(tool-runtime). kind와 payload는 `F.records.spec` §3.3.1 `secret.*`(§3.9) |
| 런타임 HTTP 요청 전송(`GuardedHttp`) | `L2.web.spec`. 이 문서는 치환 함수만 제공한다 |
| 브라우저 드라이버 | `L2.web.spec`(`web.browse`) |
| `xeon secret` 명령줄 파싱, 프롬프트, 출력 형식 | `L4.cli.spec` |
| 비밀 탭 화면, 값 입력·열람 창 | `L4.settings-ui.spec`, `L4.desktop.spec` |
| 설정 키 문법, `SettingDef` 검사(D2, D3) | `F.wire-settings.spec` |
| 외부 바이너리 경로 해석과 설치 안내 | `L0.os.spec`(`xeon.os`) |

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 핸들 | `secret://<name>` 문자열. 값이 아니므로 대화, 이벤트, 로그, 설정에 남아도 된다. F 타입 `SecretRef` |
| 이름(name) | 핸들의 `<name>` 부분. `^[a-z][a-z0-9-]{1,63}$` |
| 제공자 | 값을 실제로 보관하는 곳. `sops`(기본), `op`(1Password), `bws`(Bitwarden Secrets Manager), `keychain`(OS 키체인) |
| 제공자 참조 | 제공자 안의 위치. 표시 형식은 `<provider>:<path>`이다. 예: `sops:dev/GITHUB_TOKEN` |
| 메타 파일 | 이름과 제공자 참조를 잇고 사용 정책을 담는 평문 파일. 값이 없다(`_research/secrets.md` §6.4) |
| lease | 값 하나를 TTL과 사용 횟수 안에서 쓰게 하는 객체. 값은 lease 안에만 있다 |
| 사용 모드 | 값이 실제로 쓰이는 경로. M1 env, M2 sentinel, M3 런타임 HTTP, M4 브라우저 입력(§4.3) |
| 도메인 바인딩 | 메타의 허용 호스트(또는 origin) 밖으로는 값을 주입하지 않는 규칙 |
| 알려진 값 | 이 프로세스가 lease로 푼 값. `Redactor`가 원문과 인코딩 변형을 가린다 |
| age identity | age 개인 키 한 줄(`AGE-SECRET-KEY-1…`). sops 복호화에 쓴다 |
| 키 명령 | `SOPS_AGE_KEY_CMD`에 넣는 명령. sops가 복호화 요청마다 셸 없이 실행하고, 출력의 줄마다 identity 하나를 읽는다(`_research/notes/L0-3.md` §2) |

- 이 문서에서 "M1~M4"는 사용 모드 번호다. 마일스톤은 항상 "마일스톤 M0/M1/M2"로 쓴다. 코드는 번호 대신 모드 이름(`env`, `sentinel`, `runtime-http`, `browser-input`)을 쓴다 [제안]. 번호와 마일스톤 이름이 섞이지 않게 하기 위해서다.

## 3. 인터페이스

아래 타입의 F 위치는 둘로 나뉜다.

- 참조 형식(§3.1)과 여러 층이 함께 쓰는 값 타입(§3.2 메타, §3.5 `RedactionHit`, §3.9 감사 레코드)은 F `@xeon/contracts/capabilities`의 `capabilities/secrets.ts`(`F.capabilities.spec` §3.10)가 정본이다 [결정: review.decisions-2 U-08]. 이 문서는 그 블록을 다시 적지 않고 이름만 인용한다. 이름과 필드는 F를 따른다.
- 서비스 인터페이스와 그 부속 타입(§3.3, §3.4, §3.5의 `Redactor`, §3.6, §3.10)은 F `@xeon/contracts/services`의 `services/secrets.ts`, 관리 서비스(§3.8)는 `services/secret-admin.ts`에 둔다 [결정: review.decisions-2 D-04]. `F.capabilities.spec` §3.12 표의 `SecretService`·`SecretAdminService` 행과 파일별 이름 표가 이 배치를 정했다(8.3절 R1-a, R2). 소비자(L1 tools, L1 models, L2 web·mcp)는 DR-14 때문에 `platform-secrets`를 import할 수 없으므로 이 서브패스로 받는다. 아래 블록은 F로 옮기기 전의 초안이고, 옮긴 뒤에는 F 이름을 인용한다(`F.capabilities.spec` §3.12 규칙 1).
- `KeyProvider`, `Redactor` 구현, SOPS 래퍼는 `platform-secrets` 내부다.

### 3.1 참조 (`ref.ts`)

정본은 `F.capabilities.spec` §3.10 첫 블록이다. 이 패키지는 아래 이름을 import해 쓰고 같은 이름을 다시 정의하지 않는다.

```ts
import {
  SECRET_NAME_PATTERN, SECRET_REF_PATTERN, SecretNameSchema, SecretRef,
  parseSecretRef, secretRef, findForeignSecretSyntax,
  type SecretName, type SecretHandle, type SecretRefError,
} from "@xeon/contracts/capabilities";
```

- `SecretName`과 `SecretHandle`은 브랜드 타입이다. 문자열을 `SecretName`으로 바꾸는 경로는 `parseSecretRef`와 `SecretNameSchema` 검증 둘이다(`F.capabilities.spec` §3.10).
- `parseSecretRef`, `secretRef`, `findForeignSecretSyntax`는 순수 함수이고 구현도 F에 있다. `secretRef`는 이름 규칙 위반을 호출 결함으로 보고 `Bug`를 던진다(BP-07 예의 `secretRef("exa-key")`).
- `SecretRefError`의 두 변형(`invalid_ref`, `unsupported_ref_syntax`)이 내는 결과는 아래 표가 정한다. F §3.10은 이 표를 거부 규칙의 정본으로 가리킨다.

거부 규칙 [제안, `_research/secrets.md` §6.1]:

| 입력 | 결과 | 이유 |
|---|---|---|
| `secret://github-token` | 허용 | |
| `secret://a` | `invalid_ref`(`name_pattern`) | 이름은 2자 이상 |
| `secret://GitHub-Token` | `invalid_ref`(`name_pattern`) | 소문자만 |
| `secret://github-token/extra` | `invalid_ref`(`trailing`) | 경로 금지 |
| `secrets://x-y`, `secret:x-y` | `invalid_ref`(`scheme`) | |
| `$GITHUB_TOKEN`, `${GITHUB_TOKEN}` | `unsupported_ref_syntax`(`env_var`) | 셸 확장과 섞인다 |
| `{{secret:github-token}}` | `unsupported_ref_syntax`(`template`) | 형식이 둘이 되면 검사가 둘이 된다 |
| `%github-token%` | `unsupported_ref_syntax`(`percent`) | Stagehand 형식(`_research/secrets.md` §1.2) |
| `op://vault/item/field`, `sops:dev/KEY` | `unsupported_ref_syntax`(`provider_uri`) | 제공자 참조는 메타 파일에만 둔다 |

- "입력 단계"는 모델 도구 인자, 설정 값(`F.wire-settings.spec` §4.8), 메타 파일의 `name`이다. 도구 인자 검사는 `L1.tools.spec`이 도구 인자 검증 때 `findForeignSecretSyntax`를 부른다 [가정: L1.tools 검증 단계에 훅이 있다]. `$VAR` 거부는 비밀 인자로 선언된 필드에만 한다. bash 명령 본문 전체에 적용하면 일반 셸 변수를 막기 때문이다 [제안].

### 3.2 메타 (`meta.ts`)

정본은 `F.capabilities.spec` §3.10 둘째 블록의 메타 부분이다 [결정: review.decisions-2 U-08]. 이 패키지는 아래 이름을 import해 메타 파일을 검증하고 `SecretService.list()` 결과를 만든다.

```ts
import {
  SecretUseModeSchema, SecretProviderIdSchema, SecretApprovalSchema, SecretScopeSchema,
  SecretUsePolicySchema, SecretMetaSchema,
  type SecretUseMode, type SecretProviderId, type SecretApproval, type SecretScope,
  type SecretUsePolicy, type SecretMeta,
} from "@xeon/contracts/capabilities";
```


- 필드 구성은 `_research/secrets.md` §6.4를 따른다. 바꾼 점 [제안]:
  - `use.modes`는 번호(`M2`, `M3`) 대신 모드 이름을 쓴다(§2).
  - `approval`의 `never`를 `none`(승인 필요 없음)으로 바꾼다. `never`는 "항상 거부"로도 읽히기 때문이다.
  - `use.origins`를 더한다. M4는 호스트가 아닌 origin으로 바인딩한다(§4.3).
- 메타 파일 형식과 위치 [제안]: 비밀 하나에 YAML 파일 하나, `<OsDirs.config>/secrets/meta/<name>.yaml`. `OsDirs.config`는 `xeon.os`가 정하고 이미 `xeon`으로 끝난다(`L0.os.spec` §3.2. 예: Linux `~/.config/xeon/secrets/meta/`). 이 패키지의 파일(메타, 감사 파일, 파일 폴백 age 키 기본 위치)은 모두 `<OsDirs.config>/secrets/` 아래에 둔다. 파일에는 값이 없으므로 평문이고 권한은 0600으로 쓴다. 파싱은 [가정] Bun 1.4 내장 YAML 파서를 쓴다. 쓸 수 없으면 같은 스키마의 JSON 파일로 바꾼다.
- 범위 규칙 [제안]: 1차는 사용자 범위 메타만 읽는다. 프로젝트 저장소 안의 메타는 읽지 않는다. 저장소를 받는 것만으로 사용자 비밀의 허용 호스트가 넓어지지 않게 하기 위해서다(`F.wire-settings.spec` §4.7 규칙 4의 "범위 제한 키"와 같은 이유). `scope: project:<id>`는 "그 프로젝트의 세션에서만 쓸 수 있다"는 제한으로만 작동한다.

### 3.3 사용 맥락과 lease (`lease.ts`)

```ts
export type SecretUseTarget =
  | { readonly kind: "host"; readonly host: string; readonly port: number | null }   // runtime-http, sentinel
  | { readonly kind: "origin"; readonly origin: string }                              // browser-input
  | { readonly kind: "command"; readonly argv0: string; readonly commandLine: string }; // env

export interface ApprovalEvidence {
  readonly approvalId: string;            // L1 ApprovalService가 발급한 id
  readonly scope: "per-session" | "per-use";
  readonly grantedAt: number;
  readonly expiresAt: number | null;
}

export interface UseCtx {
  readonly mode: SecretUseMode;
  readonly purpose: string;               // 도구 이름 또는 서비스 메서드. "http.request", "bash:gh", "web.search", "model.provider:anthropic"
  readonly target: SecretUseTarget;
  readonly actor: "agent" | "runtime" | "human";
  readonly threadId: string | null;       // 세션 밖 호출(서비스 모드, 관리 명령)은 null
  readonly toolCallId: string | null;
  readonly projectId: string | null;
  readonly approval: ApprovalEvidence | null;
}

export interface SecretValueView {
  /** 값 바이트. use 콜백이 끝나면 0으로 덮인다. 콜백 밖으로 복사하지 않는다 */
  readonly bytes: Uint8Array;
  /** UTF-8 문자열로 바꾼다. 문자열은 덮어쓸 수 없으므로 헤더 치환처럼 꼭 필요한 곳에서만 부른다 */
  text(): string;
}

export interface SecretLease {
  readonly leaseId: LocalId<"sls">;       // "sls_<ULID>". F.conversation.spec §3.2.1 LocalIdPrefix
  readonly handle: SecretHandle;
  readonly mode: SecretUseMode;
  readonly expiresAt: number;
  readonly usesLeft: number;
  /** 값 사용. 매번 만료·횟수·폐기·대상을 다시 검사한다(검사와 사용 사이 간극 방지) */
  use<T>(fn: (value: SecretValueView) => Promise<T> | T): Promise<Result<T, SecretError>>;
  /** 값을 0으로 덮고 lease를 닫는다. 두 번 불러도 된다 */
  dispose(): void;
  toJSON(): string;                       // "[SecretLease <leaseId>]"
}
```

- `reveal`, `value`, `get` 같은 값 반환 메서드를 lease에 두지 않는다. 값은 `use` 콜백 인자로만 보인다.
- `SecretLease`의 값은 클로저에 두고 객체 속성으로 두지 않는다. `toJSON`과 `Symbol.for("nodejs.util.inspect.custom")`은 `"[SecretLease <leaseId>]"`를 돌려준다(`docs/design/18-security.md` §3.10.1 `SecretStore` 규칙을 옮긴다).
- `leaseId`는 도메인 지역 ID다. 접두 `sls`는 `F.conversation.spec` §3.2.1 `LocalIdPrefix` 표에 있고, 발급은 주입받은 `LocalIdFactory.next("sls")`로 한다(구현은 `platform-os`). 감사 레코드에는 문자열로 싣는다.

### 3.4 제공자 (`provider.ts`)

`_research/secrets.md` §6.8을 TypeBox·Result 형식으로 옮긴다.

```ts
export interface SecretProviderCapabilities {
  readonly list: boolean;
  readonly put: boolean;
  readonly remove: boolean;
  readonly usage: boolean;                // 제공자 자체 사용 이력(1Password Events API 등)
}

/** 제공자가 아는 항목. 값과 메타 정책이 없다 */
export interface ProviderEntry {
  readonly provider: SecretProviderId;
  readonly ref: string;                   // "dev/GITHUB_TOKEN"
  readonly updatedAt: number | null;      // sops는 파일의 sops.lastmodified [가정]
}

export interface SecretProvider {
  readonly id: SecretProviderId;
  capabilities(): SecretProviderCapabilities;
  /** 값 없는 목록. 복호화나 값 조회를 하지 않는다 */
  list(): Promise<Result<readonly ProviderEntry[], SecretError>>;
  /** 값을 lease로 연다. 부모 프로세스에서만 호출된다. 정책 검사는 SecretService가 끝낸 뒤다 */
  lease(ref: string, ctx: UseCtx, limits: { readonly ttlSeconds: number; readonly maxUses: number }): Promise<Result<SecretLease, SecretError>>;
  put?(ref: string, value: Uint8Array): Promise<Result<void, SecretError>>;
  remove?(ref: string): Promise<Result<void, SecretError>>;
}
```

- §6.8과 다른 점 [제안]: `list()`는 `SecretMeta[]` 대신 `ProviderEntry[]`를 돌려준다. `SecretProvider` 인터페이스는 설명, 허용 호스트, 승인 정책을 입력으로 받지 않는다. `SecretMeta`는 `SecretService.list()`가 메타 파일과 제공자 목록을 합쳐 만든다.
- 제공자 단계 [결정: `_research/decisions-log.md` 2026-10-21 2차 "비밀 기본값은 SOPS(age)", 층 구성 계획 v2 L0-c "1Password·Bitwarden·키체인은 플러그인"]:

| 제공자 | 단계 | 목록 | lease | put/remove | 위치 |
|---|---|---|---|---|---|
| `sops` | 1차, 기본 | 파일의 키 이름을 평문으로 읽는다(§4.6) | 부모가 `sops decrypt --extract`를 실행 | sops 편집(§4.6) [가정] | `platform-secrets` 내장 |
| `op` | 2차, 플러그인 | `op item list` | `op read` | `op item create`, `op item delete` | 플러그인 패키지 |
| `bws` | 2차, 플러그인 | `bws secret list` | `bws secret get` | create, delete | 플러그인 패키지 |
| `keychain` | 2차, 플러그인 | `security` 조회 등 | `find-generic-password -w` 등 | add, delete | 플러그인 패키지 |

- 플러그인 제공자는 `SecretProvider`를 F 타입으로 구현하고 `SecretService.registerProvider`로 등록한다. 플러그인은 `platform-secrets`를 import하지 않는다(DR-14). 플러그인이 `op`, `bws` 바이너리를 직접 부르면 DR-07 소유표에 행을 더해야 한다 [미결 §10].
- `keychain` 제공자(값 저장)와 §3.7의 `KeyProvider`(age 키 획득)는 다른 것이다. 1차의 키체인 사용은 age 키 획득뿐이다.

### 3.5 마스킹 (`redactor.ts`)

`docs/design/18-security.md` §3.10.4를 옮긴다.

`RedactionHit`(필드 `kind`, `count`)은 `F.capabilities.spec` §3.10이 정본이다. `kind`는 `"known:<name>"`, 접두 패턴 kind(`"github_pat"`, `"jwt"` 등), `"kv"` 중 하나다. 아래 `RegisterKnownError`와 `Redactor`는 F `services/secrets.ts`로 옮길 초안이다.

```ts
import type { RedactionHit, SecretName } from "@xeon/contracts/capabilities";

export type RegisterKnownError = { readonly kind: "value_too_short"; readonly minBytes: 8 };

export interface Redactor {
  /** 알려진 값과 변형을 등록한다. 8바이트 미만은 거부한다 */
  registerKnown(name: SecretName, value: Uint8Array): Result<void, RegisterKnownError>;
  forget(name: SecretName): void;         // rotate·rm 뒤 이전 값 변형을 지운다
  mask(text: string): { readonly text: string; readonly hits: readonly RedactionHit[] };
  maskDeep<T>(value: T): { readonly value: T; readonly hits: readonly RedactionHit[] };
  /** 외부 전송 판정. 알려진 값이 들어 있으면 true. 값을 고치지 않는다 */
  containsKnown(text: string): boolean;
}
```

규칙(순서대로 적용):

1. 알려진 값: 원문과 변형의 완전 일치 → `[REDACTED:known:<name>]`. 변형은 다음과 같다.
   - base64(표준, URL-safe, 패딩 있음·없음). 다른 문자열 뒤에 붙어 인코딩되는 경우(예: Basic 인증 `user:<값>`)를 위해 앞 바이트 오프셋 0·1·2의 세 정렬 변형을 만들고, 정렬이 경계 문자에 걸치는 앞뒤 글자는 뺀다 [제안].
   - URL 인코딩(`encodeURIComponent` 결과와 `+` 공백 형태).
   - hex(소문자, 대문자).
   - JSON 문자열 이스케이프(`JSON.stringify(값)`의 따옴표 안쪽).
2. 접두 패턴: 18 §3.10.4 규칙 2의 목록(`sk-ant-…`, `ghp_…`, `github_pat_…`, `AKIA…`, `AGE-SECRET-KEY-1…`, PEM 개인 키, JWT 등)을 쓴다. 헬름 전용 `helm_dt_` 패턴은 뺀다. 표지는 `[REDACTED:<kind>]`이다.
3. 키-값 문맥: 18 §3.10.4 규칙 3의 정규식(`api_key`, `token`, `password`, `authorization` 등 뒤의 8자 이상 값, 접속 문자열 사용자 정보) → 값 부분만 `[REDACTED:kv]`.
4. 엔트로피 검사는 도구 출력에 쓰지 않는다(코드 해시와 UUID를 지나치게 지운다).

- 18과 다른 점 [제안]: 접두 패턴 표지에서 SHA-256 앞 8자를 뺀다. 감사 기록에 값의 해시를 남기지 않는 규칙(§3.9)과 같은 기준을 쓰기 위해서다. 같은 값이 여러 번 나왔는지는 `count`로만 안다.
- 등록 시점: lease가 값을 처음 풀 때 `SecretService`가 `registerKnown`을 부른다. 등록부는 부모 프로세스 메모리에만 있고 직렬화하지 않는다. 변형 문자열도 값과 같은 수준으로 다룬다.
- 8바이트 미만 값: `registerKnown`이 `value_too_short`를 돌려준다. 이런 비밀은 `env` 모드 lease를 거부하고(`mode_not_allowed`), `runtime-http`·`browser-input`만 허용한다 [제안]. `env`는 출력에 값이 나올 수 있는데 가릴 수 없기 때문이다. `add`는 8바이트 미만 값을 받지 않는다.
- 한계: 마스킹은 보조 수단이다. 값을 비인접 조각으로 나눈 출력, 등록하지 않은 인코딩(rot13, gzip 변환, 역순, 모델의 재인코딩)은 잡지 못한다(`_research/secrets.md` §2.3, [S28][S30]). 보장은 값이 모델과 셸에 들어오는 경로를 없애는 M3·M4 모드 설계에서 나온다. 문서와 화면은 마스킹을 "보조"로 표기한다.

### 3.6 서비스 (`service.ts`)

```ts
export const SecretServiceName = "xeon.secrets";

export type SecretStatus = "valid" | "expiring" | "expired" | "missing" | "orphaned";
//   expiring: expiresAt까지 7일 이하 [제안]. missing: 메타는 있으나 제공자에 항목이 없음. orphaned: 제공자 항목에 메타가 없음

export interface SecretListing {
  readonly meta: SecretMeta | null;       // orphaned면 null
  readonly entry: ProviderEntry | null;   // missing이면 null
  readonly handle: SecretHandle | null;
  readonly status: SecretStatus;
  readonly lastUsedAt: number | null;
}

export type UseDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "needs_approval"; readonly approval: "per-session" | "per-use"; readonly prompt: ApprovalPrompt }
  | { readonly kind: "deny"; readonly reason: SecretDenyReason };

export interface ApprovalPrompt {
  readonly handle: SecretHandle;
  readonly desc: string;
  readonly purpose: string;
  readonly target: SecretUseTarget;       // "어느 호스트에"
  readonly ttlSeconds: number;            // "몇 분간"
}

export interface HttpTemplate {
  readonly method: string;
  readonly url: string;                   // 핸들을 넣을 수 없다
  readonly headers: Readonly<Record<string, string>>;   // 값 자리에 "secret://<name>"이 올 수 있다
  readonly body: string | Uint8Array | null;            // 문자열 본문에 핸들이 올 수 있다
}
export interface ConcreteHttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array | null;
}
export interface HttpResponseLike {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string | null;       // 에코 검사 대상. 바이너리 본문은 null
}

export interface SecretService {
  readonly redactor: Redactor;

  /** 메타 조회. 값 없음. 복호화하지 않는다 */
  resolve(handle: SecretHandle): Promise<Result<SecretListing, SecretError>>;
  list(): Promise<Result<readonly SecretListing[], SecretError>>;
  /** 정책 판정만. 승인 요청 문구를 L1이 만들 수 있게 돌려준다 */
  check(handle: SecretHandle, ctx: UseCtx): Promise<Result<UseDecision, SecretError>>;
  /** check를 다시 하고 lease를 연다. 결과와 무관하게 감사 레코드를 낸다 */
  lease(handle: SecretHandle, ctx: UseCtx): Promise<Result<SecretLease, SecretError>>;

  /** M3: 템플릿의 핸들을 값으로 바꿔 send를 부르고, 응답 에코를 검사한 뒤 lease를 닫는다 */
  withHttp<T extends HttpResponseLike>(
    template: HttpTemplate, ctx: Omit<UseCtx, "mode" | "target">,
    send: (req: ConcreteHttpRequest) => Promise<T>,
  ): Promise<Result<{ readonly response: T; readonly echoed: boolean }, SecretError>>;
  /** M1(env): 승인된 명령의 자식 env에 넣을 값을 lease로 연다. ctx.target은 { kind: "command" }여야 하고 per-use 승인 증거가 필요하다. 마일스톤 M1 [결정: review.decisions-2 U-19] */
  withEnv(handle: SecretHandle, ctx: Omit<UseCtx, "mode">): Promise<Result<SecretLease, SecretError>>;
  /** M4: origin을 검사한 뒤 fill 콜백에만 값을 준다 */
  withBrowserInput<T>(
    handle: SecretHandle, origin: string, ctx: Omit<UseCtx, "mode" | "target">,
    fill: (value: SecretValueView) => Promise<T>,
  ): Promise<Result<T, SecretError>>;

  /** 샌드박스 읽기·쓰기 거부 대상인 비밀 파일 절대 경로(SOPS 파일, 메타 디렉터리, 감사 파일, 파일 폴백 age 키). 값 없음. L0.sandbox.spec §3.3 */
  protectedPaths(): readonly string[];

  registerProvider(provider: SecretProvider): Result<Disposable, SecretError>;
  /** 감사 레코드 수신자 등록. 값은 실리지 않는다(§3.9) */
  onAudit(sink: (record: SecretAuditRecord) => void): Disposable;
  /** doctor·첫 실행 점검. 값 없음 */
  diagnose(): Promise<SecretDiagnostics>;
}
```

- `withHttp` 규칙: `template.url`의 호스트와 포트가 메타 `use.hosts`에 맞을 때만 치환한다. URL에 핸들이 있으면 `invalid_ref`로 거부한다(쿼리 문자열은 로그와 리퍼러로 새기 쉽다) [제안]. 치환된 `ConcreteHttpRequest`는 `send` 안에서만 쓰고, 호출자는 이를 로그·이벤트에 싣지 않는다.
- `withEnv` 규칙 [결정: review.decisions-2 U-19]: 마일스톤 M1의 비밀 검증 경로는 bash 도구의 `env` 주입이고 실행마다 승인을 받는다. `withEnv`는 `mode: "env"`로 `lease(handle, ctx)`와 같은 판정(§4.2)을 한다. `ctx`는 `purpose`(예: `"bash:gh"`), `toolCallId`, `target: { kind: "command", argv0, commandLine }`, `approval`(`per-use` `ApprovalEvidence`)을 싣는다. `target`이 `command`가 아니면 `denied`(`mode_not_allowed`)다. exec는 `ShellExecOptions.secretEnv`(`SecretEnvRequest`의 `ctx`)로 받은 값에 `target`을 채워 이 메서드를 부른다(`L0.exec.spec` §3.6). 사람 직접 실행(`secret run`)은 §3.8의 관리 서비스가 맡는다.
- 자식 env 거부 목록은 이 서비스에 두지 않는다. 정본은 F 상수 `SENSITIVE_ENV_PATTERNS`(`L0.exec.spec` §3.5)다(§4.5).
- [가정] `Disposable`은 TS 표준 `Disposable`(`Symbol.dispose`)이다.

### 3.7 age 키 획득 (`key/provider.ts`, 패키지 내부)

```ts
// platform-secrets 내부. F에 두지 않는다
export type KeyProviderId = "darwin-keychain" | "linux-secret-service" | "win32-credential" | "file";

export interface KeyAvailability {
  readonly available: boolean;
  readonly reason: "ok" | "no_secret_service" | "keychain_locked" | "item_missing" | "not_implemented" | "file_mode";
}

export interface KeyProvider {
  readonly id: KeyProviderId;
  /** 키 저장소 존재 여부만 본다. identity를 읽지 않는다 */
  probe(): Promise<KeyAvailability>;
  /** sops 자식 env에 넣을 변수. SOPS_AGE_KEY_CMD 또는 SOPS_AGE_KEY_FILE 하나 */
  sopsKeyEnv(): Result<Readonly<Record<"SOPS_AGE_KEY_CMD" | "SOPS_AGE_KEY_FILE", string>>, SecretError>;
  /** 첫 실행 설정: identity를 만들어 저장하고 수신자(공개키)만 돌려준다 */
  provision?(): Promise<Result<{ readonly recipient: string }, SecretError>>;
}
```

| OS provider | 파일 | 키 명령 [제안] | 근거 |
|---|---|---|---|
| macOS Keychain | `key/darwin.ts` | `security find-generic-password -s xeon.age -a default -w` | `_research/notes/L0-3.md` §3 |
| Linux Secret Service | `key/linux.ts` | `secret-tool lookup service xeon.age account default` | 같은 곳. Secret Service(D-Bus `org.freedesktop.secrets`)가 필요하다 |
| Windows 자격 증명 관리자 | `key/win32.ts` | 헬퍼 실행 파일 필요(`cmdkey`는 암호를 읽지 못한다) [미결] | 같은 곳 §3.3 |
| 파일 폴백 | `key/file-fallback.ts` | `SOPS_AGE_KEY_FILE=<경로>`(0600) | 같은 곳 §3 표 "WSL·헤드리스" |

- 키 명령은 셸 없이 실행되고 google/shlex 규칙으로 나뉜다. 인자는 작은따옴표로 감싸 만든다. Windows 경로의 백슬래시는 따옴표 밖에서 사라진다(`_research/notes/L0-3.md` §2.3).
- `SOPS_AGE_KEY`(키 값을 env로 전달)는 쓰지 않는다. sops는 부모 env를 키 명령에 그대로 넘긴다(같은 곳 §7).
- 3.12.0 이상의 `SOPS_AGE_RECIPIENT`를 쓰는 수신자별 출력은 1차에서 쓰지 않는다. 키체인 항목 하나에 identity 한 줄을 둔다 [제안].
- 선택 로직은 `src/select.ts` 한 곳에만 둔다(DR-13, `L0.readme` §3.1). `process.platform`과 WSL 판정은 이 파일 안에서만 읽는다. 순서 [제안]: `l0.secrets.ageKey.source`가 `file`이면 파일, `keychain`이면 OS provider(없으면 오류), `auto`면 OS provider의 `probe()`가 `available`일 때 그것, 아니면 파일 폴백을 쓰되 §4.7의 고지를 낸다.

### 3.8 관리 서비스 (`admin.ts`)

```ts
import type { ReauthMethod, SecretApproval, SecretScope, SecretUsePolicy } from "@xeon/contracts/capabilities";

export const SecretAdminServiceName = "xeon.secretAdmin";   // F.capabilities.spec §3.12 표, SERVICE_NAMES.secretAdmin

export interface SecretValueSource {
  /** L4가 넘기는 값 입력 통로. stdin 또는 가린 프롬프트. argv 경로는 타입에 없다 */
  read(): Promise<Result<Uint8Array, { readonly kind: "input_cancelled" | "input_empty" }>>;
}
export interface HumanReauth {
  /** tty-confirm: OS 인증 재확인을 쓸 수 없는 터미널에서 사람이 TTY로 직접 확인한 경우(CLI reveal 전용) */
  readonly method: ReauthMethod;          // "os-auth" | "passphrase" | "tty-confirm"(F.capabilities.spec §3.10)
  readonly verifiedAt: number;            // L4·L0.os가 확인한 시각. 60초 안이어야 한다 [제안]
}
export interface SecretMetaPatch {
  readonly desc?: string;
  readonly scope?: SecretScope;
  readonly expiresAt?: string | null;
  readonly use?: SecretUsePolicy;
  readonly approval?: SecretApproval;
  readonly ttlSeconds?: number;
  readonly maxUses?: number;
}
export interface SecretTestResult {
  readonly exists: boolean;
  readonly decryptable: boolean;
  readonly length: number | null;         // 바이트
  readonly sha256Prefix: string | null;   // hex 앞 8자. 사람에게만 보인다
}
export interface SecretReferenceReport {
  readonly settingKeys: readonly string[];      // 이 핸들을 값으로 가진 설정 키
  readonly activeLeases: number;
  readonly sessions: readonly string[];         // 최근 사용 threadId
}

export interface SecretAdminService {
  ls(options: { readonly usage: boolean }): Promise<Result<readonly SecretListing[], SecretError>>;
  usage(handle: SecretHandle, filter: { readonly since?: number; readonly decision?: "allow" | "deny" }): Promise<Result<readonly SecretAuditRecord[], SecretError>>;
  add(meta: SecretMeta, value: SecretValueSource): Promise<Result<SecretHandle, SecretError>>;
  set(handle: SecretHandle, value: SecretValueSource): Promise<Result<void, SecretError>>;
  meta(handle: SecretHandle, patch: SecretMetaPatch): Promise<Result<SecretMeta, SecretError>>;
  rotate(handle: SecretHandle, value: SecretValueSource): Promise<Result<{ readonly revokedLeases: number }, SecretError>>;
  references(handle: SecretHandle): Promise<Result<SecretReferenceReport, SecretError>>;
  rm(handle: SecretHandle, confirm: { readonly confirmed: true }): Promise<Result<void, SecretError>>;
  test(handle: SecretHandle): Promise<Result<SecretTestResult, SecretError>>;
  /** 사람 직접 실행 전용 M1. env 이름 → 핸들. 자식 프로세스를 띄워 종료 코드를 돌려준다 */
  run(env: Readonly<Record<string, SecretHandle>>, argv: readonly string[], io: { readonly inheritStdio: true }): Promise<Result<{ readonly exitCode: number }, SecretError>>;
  /** 사람에게 한 번 보이고 숨긴다. show 콜백은 OS 보안 창이나 TTY에만 쓴다 */
  reveal(handle: SecretHandle, reauth: HumanReauth, show: (value: SecretValueView) => Promise<void>): Promise<Result<void, SecretError>>;
}
```

- 에이전트는 생성과 열람을 하지 않는다(`_research/secrets.md` §6.6 `rotate` 행, `docs/design/18-security.md` §3.10.5와 같은 원칙). 그래서 관리 메서드를 별도 서비스 `xeon.secretAdmin`으로 나눈다 [결정: review.decisions-2 D-04]. 이 이름은 `F.capabilities.spec` §3.12 표와 `SERVICE_NAMES`, `eng.context-map.design` §5.3 표에 있다. 조립 루트(`apps/host`)가 L4 진입점에만 이 서비스를 넘기고, 확장과 모델 도구에는 주지 않는다. 신뢰 등급과 서비스 노출 규칙은 `X.loading-trust.spec`이 정한다 [가정].
- 명령과 화면의 경계는 §6.3 표다.

### 3.9 감사 레코드 (`audit.ts`)

정본은 `F.capabilities.spec` §3.10 둘째 블록의 감사 레코드 부분이다 [결정: review.decisions-2 U-08]. 이 패키지는 `onAudit`로 이 타입을 낸다.

```ts
import type {
  SecretAuditRecord, SecretDenyReason, RedactionLayer, RedactionHit, ReauthMethod,
} from "@xeon/contracts/capabilities";
```

- 변형은 `secret.used`, `secret.denied`, `secret.approved`, `secret.created`·`updated`·`deleted`·`rotated`, `secret.revealed`, `secret.masked`다. `secret.revealed.reauth`의 타입은 `ReauthMethod`이고 §3.8 `HumanReauth.method`와 같다. 거부 사유 `SecretDenyReason` 10종과 마스킹 계층 `RedactionLayer` 5종도 F 블록을 따른다.

- 어느 레코드에도 값, 값의 일부, 값의 해시를 싣지 않는다 [제안, `_research/secrets.md` §6.5 "값의 해시도 남기지 않는다"]. `commandHash`는 명령줄(값이 아닌 문자열)의 SHA-256 hex 앞 16자다.
- `secret.denied`의 사유 중 `host_mismatch`, `approval_missing`, `expired`는 `_research/secrets.md` §6.5의 세 코드다. 나머지는 이 문서가 더한 것이다 [제안].
- 이벤트 kind 소유자: (a)안으로 정해졌다(`F.records.spec` §3.3.1, 같은 문서 `secret.*` 절). `platform-secrets`는 `onAudit`로 `SecretAuditRecord`만 내고, `core-tools`(tool-runtime)가 받아 세션 이벤트 `secret.used`, `secret.denied`, `secret.approved`, `secret.masked`로 기록한다. 생산자 id는 `core.tools`다. L0는 세션 저장에 의존하지 않으므로 순위 규칙과 `eng.context-map.design` §4.1 (b)열 규칙(`platform-*`는 이벤트 kind를 소유하지 않는다)을 그대로 지킨다. 감사 레코드의 `threadId`와 `type`은 세션 이벤트로 옮길 때 envelope의 `threadId`와 `kind`가 된다.
- 도구 호출 밖의 사용(모델 키, 웹 provider 키)도 기록하려면 `model-gateway`와 `web`이 tool-runtime과 같은 방식으로 `onAudit` 레코드를 받아 자기 생산자로 기록할지 정해야 한다. 이 문서는 정하지 않는다(`L1.models.spec`, `L2.web.spec`).
- 관리 레코드(`created`, `updated`, `deleted`, `rotated`, `revealed`)는 세션 이벤트로 넣지 않는다(`F.records.spec` §3.3.1). envelope의 `threadId`를 채울 수 없기 때문이다. [제안] 관리 레코드는 `platform-secrets`가 메타 디렉터리 옆 추가 전용 파일 `<OsDirs.config>/secrets/audit.log`(줄마다 JSON 하나, 기록마다 fsync, 0600)에 쓴다. context-map 4.1절이 `platform-secrets`의 소유 데이터를 "DB 밖 SOPS 파일, OS 키체인"으로 둔 범위 안이다. 세션 레코드(`used`, `denied`, `approved`, `masked`)도 같은 파일에 함께 쓰면 `secret ls --usage`가 세션 DB 없이 동작한다 [제안]. 이 파일 방식은 단일 DB 결정(ADR-0004)과 별개의 운영 로그로 본다 [미결 §10 1번].

### 3.10 오류 (`errors.ts`)

```ts
export type SecretError =
  | SecretRefError
  | { readonly kind: "secret_missing"; readonly handle: SecretHandle; readonly where: "meta" | "provider" }
  | { readonly kind: "denied"; readonly handle: SecretHandle; readonly reason: SecretDenyReason }
  | { readonly kind: "provider_unavailable"; readonly provider: SecretProviderId; readonly reason: "binary_missing" | "version_too_old" | "not_registered" }
  | { readonly kind: "key_unavailable"; readonly key: KeyProviderIdPublic; readonly reason: "locked" | "item_missing" | "no_secret_service" | "access_denied" | "file_mode" }
  | { readonly kind: "decrypt_failed"; readonly provider: SecretProviderId; readonly exitCode: number | null; readonly stderrMasked: string }
  | { readonly kind: "meta_invalid"; readonly name: string; readonly path: string; readonly errors: readonly string[] }
  | { readonly kind: "value_too_short"; readonly minBytes: 8 }
  | { readonly kind: "in_use"; readonly handle: SecretHandle; readonly activeLeases: number }
  | { readonly kind: "already_exists"; readonly handle: SecretHandle }
  | { readonly kind: "read_only_provider"; readonly provider: SecretProviderId }
  | { readonly kind: "reauth_required" };
export type KeyProviderIdPublic = "darwin-keychain" | "linux-secret-service" | "win32-credential" | "file";
```

- 예상 가능한 실패는 모두 `Result`로 돌려준다. throw는 `Bug`(호출 결함, 불변식 위반)에만 쓴다(`eng.typescript.guide` TY-11).
- 오류 객체와 `message`에 값을 넣지 않는다. `stderrMasked`는 sops stderr를 `Redactor.mask`로 지나게 한 뒤 앞 500자만 둔다.
- `secret_missing`은 `L2.mcp.spec` §5 표 10행의 `lastError.code = "secret_missing"`과 같은 이름이다.

## 4. 동작 규칙

### 4.1 lease 수명

1. `lease(handle, ctx)` 순서: 참조 분석 → 메타 조회 → 정책 판정(§4.2) → 제공자 `lease` → `Redactor.registerKnown` → 감사 `secret.used`. 판정이 거부면 제공자를 부르지 않고 `secret.denied`를 낸다.
2. TTL과 횟수는 `min(메타 값, 설정 기본값)`이다. 기본 TTL 900초, 기본 `maxUses` 200 [제안, `_research/secrets.md` §6.4 예].
3. `use`는 부를 때마다 만료, 남은 횟수, 폐기 여부, 메타의 `expiresAt`을 다시 본다. 실패하면 `denied`(`lease_expired` | `lease_exhausted` | `expired`)다.
4. 폐기 시점: `dispose()` 호출, TTL 경과, 횟수 소진, 도구 호출 종료(`L1.tools.spec`이 도구 호출이 끝날 때 그 호출의 lease를 모두 닫는다 [가정]), `rotate`·`rm`, 호스트 종료. 폐기는 값 바이트를 0으로 덮는다.
5. 같은 핸들의 동시 lease는 허용한다. 각 lease는 따로 복호화한다 [제안]. 여러 lease가 값 캐시를 공유하면 `rotate` 때 폐기 범위가 흐려지기 때문이다.
6. 한계: `SecretValueView.text()`가 만든 JS 문자열은 덮어쓸 수 없고 GC 전까지 힙에 남는다. 같은 uid 프로세스의 메모리 읽기는 막지 못한다(`_research/secrets.md` §2.1 "프로세스 환경" 행).

### 4.2 정책 판정

순서대로 보고 처음 실패에서 멈춘다.

| 순서 | 검사 | 실패 사유 |
|---|---|---|
| 1 | 메타의 `expiresAt`이 지나지 않았다 | `expired` |
| 2 | `ctx.mode`가 `use.modes`에 있다 | `mode_not_allowed` |
| 3 | `ctx.purpose`가 `use.tools`에 있다(`*` 접미 와일드카드만) | `tool_not_allowed` |
| 4 | `scope`가 `project:<id>`면 `ctx.projectId`가 같다 | `scope_mismatch` |
| 5 | 대상 바인딩: `runtime-http`·`sentinel`은 호스트가 `use.hosts`에 맞는다. `browser-input`은 origin이 `use.origins`와 정확히 같다. `env`는 명령줄이 `use.commands` 패턴에 맞는다 | `host_mismatch` / `origin_mismatch` / `command_mismatch` |
| 6 | 승인: 메타 `approval`이 `none`이 아니면 `ctx.approval`이 있고 범위와 만료가 맞는다. `env` 모드는 메타가 `none`이어도 `per-use` 승인을 요구한다 | `approval_missing` |

- 호스트 일치 [제안]: 소문자 비교, `*.example.com`은 한 단계 이상의 하위 도메인만 맞는다(`example.com` 자신은 아니다). IP 리터럴과 `localhost`는 메타에 그대로 적혀 있을 때만 맞는다. 포트가 메타에 없으면 443만 맞는다.
- 승인 기본값 [제안, `_research/secrets.md` §6.4]: 읽기 호스트는 `per-session`, 쓰기·배포 호스트는 `per-use`. 메타를 만들 때 사람이 고르고, 고르지 않으면 `l0.secrets.approval.default`를 쓴다.
- `check`가 `needs_approval`을 돌려주면 L1이 `xeon.approvals`로 사람에게 묻고, 받은 `ApprovalEvidence`를 넣어 `lease`를 다시 부른다. L0는 L1 승인 서비스를 부르지 않는다(층 순위).
- 승인 결과를 받은 L1은 `secret.approved` 레코드를 `SecretService`에 알리지 않는다. 대신 `lease`가 승인 증거를 처음 본 때 `secret.approved`를 낸다 [제안]. 레코드 생산 위치를 한 곳으로 두기 위해서다.

### 4.3 사용 모드와 단계

층 구성 계획 v2 L0-c "사용 모드 4종"은 `_research/secrets.md` §6.2의 M1~M4와 같다. 번호 대응은 M1 env, M2 sentinel, M3 런타임 HTTP, M4 브라우저 입력이다. 계획 v2 문장의 "런타임 HTTP 치환과 브라우저 입력 치환에서는 모델이 핸들만 봅니다"는 M3과 M4를 가리킨다.

| 모드 | 대상 | 모델과 셸에 보이는 것 | 실제 값의 위치 | 통제 수단 | 단계 |
|---|---|---|---|---|---|
| M1 env | 승인된 CLI 명령(`gh`, `kubectl` 등) | 값(자식 env). 셸이 `env`로 출력할 수 있다 | 도구 자식 프로세스 env | 명령 패턴, `per-use` 승인, 출력 마스킹(2계층) | 에이전트용(bash 도구, 실행마다 승인)은 마일스톤 M1이고 M1 비밀 검증 경로다 [결정: review.decisions-2 U-19]. 사람 직접 실행 `secret run`은 마일스톤 M2 |
| M2 sentinel | HTTPS 토큰을 쓰는 CLI와 도구 | sentinel 문자열 | 런타임 프록시 메모리. 전송 직전 헤더에서 치환 | 호스트 바인딩, TLS 종단 | 설계만 이 문서에서 정하고 구현은 후속 |
| M3 런타임 HTTP | 런타임 내장 HTTP 경로(`GuardedHttp`, 모델 provider 호출, 테스트 그룹 HTTP 도구) | 핸들 | 부모 프로세스. `withHttp`가 전송 직전 헤더·본문에서 치환. 모델 provider 키는 core-models가 `lease`(purpose `model.provider:<id>`)로 열어 프로세스 안 HTTP 클라이언트에만 넘긴다 | 호스트 바인딩, 응답 에코 검사 | 마일스톤 M1(모델 provider 키, review.decisions-2 U-19 보충), 기본 안전 모드. 값은 모델 컨텍스트, 이벤트, DB에 들어가지 않는다 |
| M4 브라우저 입력 | 로그인 폼 | 핸들 | 부모 프로세스. 드라이버가 입력할 때만 | origin 바인딩, 스크린샷 마스킹 | 마일스톤 M2, 기본 안전 모드 |

- 기본 모드 [제안]: M3과 M4가 기본 안전 모드다. `_research/secrets.md` §6.2 마지막 줄은 기본값을 M3과 M2로 적었으나, M2가 후속이므로 1차 기본은 M3과 M4로 둔다.
- 승인 없는 M1은 금지한다. M1은 에이전트 셸이 값을 에코할 수 있어 가장 약하다(`_research/secrets.md` §6.4).

M3 규칙:

1. `withHttp`는 템플릿 헤더 값과 문자열 본문에서 `secret://<name>` 토큰을 찾는다. 헤더 값은 토큰 하나 또는 `Bearer secret://<name>`처럼 접두 하나를 허용한다 [제안].
2. 각 핸들에 대해 `ctx.target = { kind: "host", host: URL 호스트, port }`로 §4.2를 판정한다. 하나라도 거부면 아무 값도 치환하지 않는다.
3. 치환한 요청으로 `send`를 한 번 부른다. 리다이렉트는 `send` 쪽이 따라가지 않아야 한다. 따라간다면 새 호스트로 같은 헤더를 보내지 않는 것이 호출자의 책임이다 [가정: `L2.web.spec` `GuardedHttp`가 리다이렉트를 직접 다룬다].
4. 에코 검사: 응답 `bodyText`와 헤더에 알려진 값(변형 포함)이 있으면 `echoed: true`를 돌려주고, 호출자는 결과를 저장·투영하기 전에 `Redactor.mask`를 반드시 부른다. 에코가 감지되면 `secret.masked`(`layer: "tool-result"`)를 낸다.
5. 끝나면 lease를 닫는다. `withHttp` 한 번이 lease 사용 1회다.

M4 규칙:

1. `withBrowserInput`은 origin(스킴, 호스트, 포트)이 `use.origins`와 정확히 같을 때만 `fill`을 부른다. 하위 프레임 origin은 드라이버가 넘긴 값으로 판정한다 [가정: `L2.web.spec` `browse.act`의 `fill`이 프레임 origin을 안다].
2. 입력 뒤의 스크린샷과 DOM 스냅샷은 모델 투영 전에 마스킹한다. 입력란 값은 접근성 트리와 DOM 텍스트에서 `[REDACTED:known:<name>]`로 바꾼다. 화면 이미지 마스킹(입력란 영역 가림)은 `L2.web.spec`이 맡는다 [가정].

M2 설계(후속 구현):

1. 도구 자식 env에는 `XEON_SECRET_<NAME>=xeon-sentinel-<무작위 32 hex>` 같은 sentinel만 넣는다. sentinel은 lease 하나에 하나다.
2. 자식의 HTTPS는 `xeon.sandbox`의 프록시를 지나고, 프록시가 허용 호스트로 가는 요청의 헤더에서 sentinel을 값으로 바꾼다. 허용 호스트 밖으로 가는 요청에 sentinel이 있으면 요청을 막고 `secret.denied`(`host_mismatch`)를 낸다.
3. [미결] TLS 종단 방식은 sandbox-runtime 프록시 조사 결과에 의존한다. `@anthropic-ai/sandbox-runtime` 0.0.81(조사한 판. catalog 고정은 0.0.79, review.decisions-2 U-24. 0.0.79에도 같은 선택지가 있는지 후속에서 확인한다)은 `tlsTerminate`(실험, Bun 1.4 이상)와 `mitmProxy`(외부 Unix 소켓)를 서로 배타적으로 제공하고, `SandboxManager`가 프로세스당 정책 하나인 싱글턴이다(`_research/notes/L0-1.md`). 어느 쪽을 쓸지, 자식 프로세스에 CA를 어떻게 신뢰시킬지는 후속에서 정한다.
4. 요구: `xeon.sandbox`의 프록시 훅(후속, `L0.sandbox.spec` §10 9번, `L0.sandbox.plan` SB-16). 8.2절에 적는다.

### 4.4 마스킹 5계층

`_research/secrets.md` §6.3의 순서를 따른다. 각 계층의 호출 위치는 8.1절 제공 표에 있다.

| 순서 | 계층 | 대상 | 시점 | 호출하는 층 | `RedactionLayer` |
|---|---|---|---|---|---|
| 1 | 사람 입력 | 답, 메모, 붙여넣기, 자유 입력 | 입력이 이벤트가 되기 전. 내구 이벤트에 들어가면 지울 수 없다 | L1 loop(입력 큐) | `human-input` |
| 2 | 도구 결과 | stdout, stderr, 구조화 결과, blob, 오류 메시지 | 이벤트·blob 저장 전, 휘발 스트림 송신 전 | L1 tools | `tool-result` |
| 3 | 외부 전송 | 웹 검색 질의, URL, 제공자 호출 본문 | 호출 전. 알려진 값이 있으면 고치지 않고 거부한다 | L2 web, L1 models | `outbound` |
| 4 | 모델 투영 | 컨텍스트 구성(도구 결과, 파일 내용) | 투영 생성 때 한 번 더 | L1 context | `model-projection` |
| 5 | 운영 로그 | 모든 로그 줄 | 출력 직전 | L4 로거(Logger 구현) | `ops-log` |

- 3계층은 `mask`로 고치지 않고 `containsKnown`으로 판정만 한다. 고친 질의를 보내면 사용자가 의도하지 않은 검색이 나간다. `L2.web.spec` §4.1 3번의 `secret_in_query` 거부와 같다.
- 1계층에서 사람이 붙여 넣은 값은 아직 알려진 값이 아니므로 2·3번 규칙(접두 패턴, 키-값 문맥)만 잡는다.
- 각 계층 호출자는 `hits`가 비어 있지 않으면 `secret.masked` 레코드를 낸다(계층 하나에 레코드 하나, `count` 합산).
- 마스킹은 끌 수 없다. `l0.secrets.redaction.enabled`는 읽기 전용 표시 키다(§6.1).

### 4.5 자식 env 필터

1. 자식 env 거부 목록의 정본은 F 상수 `SENSITIVE_ENV_PATTERNS`(`@xeon/contracts/capabilities`, `L0.exec.spec` §3.5) 하나다. 이 서비스는 별도 목록(`childEnvPolicy`)을 두지 않는다 [제안]. `L0.exec.spec`은 도구 자식 프로세스 env를 만들 때 이 상수에 맞는 이름을 모두 지운다. 그래서 부모 env에 우연히 있던 `SOPS_*`, `AGE_*`, `OP_*`, `BWS_*`, `BW_SESSION`, `XEON_SECRET_*`(상수의 `XEON_*`), 제공자 토큰(`*_TOKEN`)이 `xeon.secrets` 유무와 관계없이 도구로 넘어가지 않는다.
2. `platform-secrets`가 sops를 부를 때도 같은 상수로 거른 env에 `KeyProvider.sopsKeyEnv()`의 변수 하나만 더한다.
3. 거부 목록은 허용 목록 기반 env 구성(`L0.exec.spec` §3.5)을 대신하지 않는다. 허용 목록 위에 거는 거부 목록이다.
4. 비밀 제공자가 새 env 이름을 쓰게 되면(2차 플러그인 제공자 등) `SENSITIVE_ENV_PATTERNS`에 패턴을 더하는 F 변경으로 반영한다. 이 문서에는 따로 목록을 두지 않는다.

### 4.6 SOPS 제공자

[결정] sops 바이너리와 age, `SOPS_AGE_KEY_CMD`로 OS 키체인을 쓴다(`_research/foundation-plan.md` §2 비밀 행).

1. 바이너리 해석: `xeon.os`의 `resolveBinary("sops", …)`(`L0.os.spec` §3.6)로 `sops` 경로를 받는다. `l0.secrets.sops.binary`가 있으면 그 경로를 쓴다. 시작 때 `sops --version`으로 버전을 읽고 3.10.0 미만이면 `provider_unavailable`(`version_too_old`)이다. 권장은 3.12.0 이상이다 [미결 §10]. 3.10.x에서는 키 명령이 실패하면 `SOPS_AGE_KEY_FILE`이 유효해도 복호화가 바로 실패한다(`_research/notes/L0-3.md` §2.4).
2. 목록: 설정 `l0.secrets.sops.files`의 각 파일을 읽어 키 이름을 평문으로 파싱한다. 복호화하지 않고 sops를 부르지도 않는다. YAML·JSON은 최상위 키 가운데 값이 `ENC[` 로 시작하는 문자열인 것, dotenv는 `KEY=ENC[...]` 줄이다. `sops` 메타데이터 블록은 건너뛴다. 중첩 키는 `a.b` 형식 경로로 내보낸다 [제안]. 키 이름이 평문이라는 사실은 2차 자료로만 확인했다 [가정, `_research/secrets.md` §3.1].
3. 제공자 참조 `sops:<env>/<KEY>`: `<env>`는 `l0.secrets.sops.files` 항목의 `env` 이름이고 `<KEY>`는 파일 안 키 경로다. 메타의 `ref`는 `"<env>/<KEY>"`다.
4. lease: `sops decrypt --extract '["<KEY>"]' <파일>`을 부모 프로세스가 실행하고 stdout을 `Uint8Array`로 모은다. 디스크에 쓰지 않는다. 자식 env는 §4.5 규칙 2다. 출력 끝 줄바꿈 처리 규칙은 [가정] `--extract`가 문자열 값을 줄바꿈 없이 낸다는 전제이며 int 테스트로 확인한다.
5. 키 명령 호출 횟수: sops는 복호화 요청마다 키 명령을 실행한다. lease 하나에 키체인 조회가 한 번 이상 생긴다(`_research/notes/L0-3.md` §2.2).
6. 쓰기(`put`, 마일스톤 M2): 값이 argv에 오르면 `/proc/<pid>/cmdline`으로 보인다. [가정] sops의 `set` 하위 명령이 stdin으로 값을 받는 옵션을 가진 버전에서만 `put`을 켠다. 그런 옵션이 없으면 `capabilities().put = false`로 두고 사용자에게 §4.8의 등록 경로를 안내한다 [미결 §10].
7. 순수 JS SOPS 구현(`sops-age`)은 쓰지 않는다. 메타데이터, KMS, PGP까지 지원하는 공식 바이너리 호출이 조사의 권장이다(`_research/secrets.md` §3.3).

### 4.7 age 키 획득과 파일 폴백

1. age 개인 키는 부모 프로세스만 다룬다. 이 패키지의 코드는 identity를 읽지 않는다. 키 명령을 sops에 넘길 뿐이다. 예외는 첫 실행의 `provision`이며, 생성한 identity는 저장 직후 버퍼를 0으로 덮는다.
2. macOS: Keychain 항목 `xeon.age`/`default`. 첫 조회 때 접근 승인 대화상자가 뜰 수 있고, 키 명령이 복호화마다 실행되므로 대화상자가 반복될 수 있다 [가정, `_research/notes/L0-3.md` §2.2]. 대응은 §5와 plan 위험 표다.
3. Linux: Secret Service가 있으면 `secret-tool`. `probe()`는 D-Bus 이름 `org.freedesktop.secrets` 유무로 판정한다 [제안]. WSL과 헤드리스는 대부분 없다고 보고 파일 폴백으로 간다 [가정].
4. 파일 폴백: identity 파일을 0600으로 두고 `SOPS_AGE_KEY_FILE`로 넘긴다. 생성은 `age-encryption` 0.3.1로 한다. 매번 시작할 때 소유자와 권한(0600, 소유 uid 일치)을 검사하고 틀리면 `key_unavailable`(`file_mode`)이다.
5. 파일 폴백의 위협 수준 차이 [제안]: 키체인은 사용자 로그인 세션과 OS 접근 통제 뒤에 키를 둔다. 파일 폴백은 같은 uid로 도는 모든 프로세스(도구 자식 포함)가 파일을 읽을 수 있다. 그래서 파일 폴백을 쓸 때는 다음을 지킨다.
   - 키 파일 경로를 `SecretService.protectedPaths()`에 넣어 알린다. `xeon.sandbox`가 이 목록을 보호 경로(`read_write`)에 합친다(`L0.sandbox.spec` §3.3). 기본 경로 `<OsDirs.config>/secrets/age/keys.txt`는 sandbox의 `<xeonConfig>/secrets/` 보호 행으로도 덮인다 [제안].
   - 첫 사용과 `diagnose()` 결과에 "키가 디스크 파일에 있다. 같은 사용자 권한의 프로그램은 읽을 수 있다"는 고지를 낸다.
   - `auto` 선택으로 파일 폴백에 간 경우 사람이 한 번 확인해야 사용한다(`l0.secrets.ageKey.source`를 `file`로 저장) [제안].
6. `@napi-rs/keyring` 2.1.2는 후보로만 둔다. Linux에서 Secret Service가 없으면 메모리 전용 keyutils로 조용히 넘어가므로, 쓰게 되면 스토어를 `secret-service`로 고정해야 한다(`_research/notes/L0-3.md` §0 11번). Bun 로드는 [미확인]이다.

### 4.8 사용자 등록 경로

[제안] 개발 환경에 레시피 `just secret-add <키> [env]`(외부 `secrets` 도구를 부른다)가 있으면 그 경로로 등록하도록 안내한다. 이 레시피는 이 저장소 개발자의 작업 규칙(`eng.best-practices.guide` BP-07)이고 `_research/decisions-log.md`에는 없다. 레시피의 내부 구성은 이 문서가 정하지 않는다. 공개 배포 사용자에게는 레시피가 없다고 본다 [가정].

| 경로 | 누가 | 흐름 | 이 문서의 역할 |
|---|---|---|---|
| (a) 안내 | 모든 사용자 | 메시지, 오류, doctor 안내문이 등록 방법을 보인다 | `secret_missing` 오류와 `diagnose()`의 `hint`에 `just secret-add <키> [env]`를 첫 경로로 적는다. ws 레시피가 없는 환경(공개 배포 사용자)을 위해 둘째 줄에 `xeon secret add <name>`을 적는다 [제안]. 레시피 존재 여부는 `secrets` 실행 파일이 PATH에 있는지로 판정한다 [가정] |
| (b) 레시피가 관리하는 SOPS 파일 읽기 | 레시피 사용자 | 레시피가 SOPS 파일에 키를 쓴다 → SOPS 제공자가 그 파일의 키 이름을 복호화 없이 읽는다 → `sops:<env>/<KEY>` 참조로 목록에 `orphaned`로 보인다 → 사람이 `secret meta`로 이름과 정책을 붙인다 | §4.6 2·3번. 파일 위치와 env 매핑은 `l0.secrets.sops.files` 설정이다 |
| (c) `xeon secret add` | 레시피를 쓰지 않는 사용자 | `xeon secret add <name>` → 값은 stdin 또는 가린 프롬프트 → SOPS 제공자 `put` | §3.8 `add`. `put`이 꺼진 제공자면 (a) 안내로 돌아간다 |

- [가정] `secrets` 도구는 env 이름마다 SOPS 파일 하나를 관리한다. 파일 경로와 env 이름 규약은 확인하지 못했다 [미결 §10]. 확인 전까지 `l0.secrets.sops.files`의 기본값은 빈 목록이고, 사람이 `{ env, path }`를 적는다.
- `just secret-add`의 키 이름(대문자 env 변수 형식)과 핸들 이름(소문자, 하이픈)은 다르다. 자동 변환(`GITHUB_TOKEN` → `github-token`)은 제안으로만 보이고 사람이 확정한다 [제안].
- 문서, 예시, 테스트 픽스처에는 실제 값이나 SOPS 파일 내용을 쓰지 않는다. 예시는 `secret://github-token` 같은 이름만 쓴다.

### 4.9 관리 동작 규칙

| 동작 | 규칙 |
|---|---|
| `ls [--meta \| --usage]` | 복호화 없이 메타와 제공자 목록을 합친다. `--usage`는 감사 파일에서 마지막 사용 시각과 결정별 개수를 더한다 |
| `add <name>` | 이름 규칙, 중복(`already_exists`), 메타 스키마를 먼저 본다. 값은 `SecretValueSource`로만 받는다. 8바이트 미만이면 `value_too_short`. 성공하면 `secret.created` |
| `set <name>` | 값 교체. 기존 lease를 폐기하고 `Redactor.forget` 뒤 새 값은 다음 lease 때 등록한다. `secret.updated`(fields `["value"]`) |
| `meta <name>` | 메타만 고친다. 값과 무관하다. `secret.updated`(바뀐 필드 이름) |
| `rotate <name>` | 사람이 새 값을 입력한다(`L4.cli.spec`은 TTY 프롬프트만 받는다). 기존 lease를 모두 폐기하고 개수를 돌려준다. `secret.rotated` |
| `rm <name>` | `references()`로 참조하는 설정 키, 활성 lease, 최근 세션을 보인 뒤 확인을 받는다. 활성 lease가 있으면 `in_use`로 거부한다. `secret.deleted` |
| `test <name>` | 복호화 가능 여부, 길이, SHA-256 hex 앞 8자만 돌려준다. 값은 돌려주지 않는다. 결과는 사람 출력에만 쓰고 감사 레코드에는 싣지 않는다 |
| `run -- <cmd>` | 사람이 터미널에서 직접 실행할 때 쓰는 env 주입이다. 자식 stdio는 터미널을 그대로 쓰고 런타임이 출력을 저장하지 않는다. 에이전트 도구 경로에서 부를 수 없다(관리 서비스는 에이전트에 주지 않는다) |
| 값 보기 | `reveal`. 재인증 증거가 60초 안이어야 한다. OS 인증 재확인을 쓸 수 있는 환경에서는 `os-auth`만 받고, 쓸 수 없는 터미널에서만 `tty-confirm`을 받는다 [결정: review.decisions-2 U-20]. `show` 콜백에 한 번 주고 끝나면 값을 덮는다. 자동 숨김 시간은 L4가 정한다. 에이전트 경로에는 열람이 없다(관리 서비스는 에이전트에 주지 않는다). `secret.revealed` |

## 5. 실패와 경계 사례

| 사례 | 동작 |
|---|---|
| sops가 PATH에 없다 | `provider_unavailable`(`binary_missing`). 목록은 파일 파싱이라 동작한다. `diagnose()`가 설치 안내를 낸다 |
| sops가 3.10.0 미만 | `provider_unavailable`(`version_too_old`) |
| Keychain 잠김 또는 사용자가 대화상자에서 거부 | sops가 실패한다. stderr로 원인을 가릴 수 없으면 `decrypt_failed`, 키 명령 종료 코드로 구분되면 `key_unavailable`(`locked` \| `access_denied`) [가정: 키 명령 오류가 sops stderr에 남는다] |
| Linux에 Secret Service가 없다 | `probe()`가 `no_secret_service`. `auto`면 파일 폴백 확인 절차(§4.7 5번) |
| 키 파일 권한이 0600이 아니다 | `key_unavailable`(`file_mode`). 권한을 고치는 명령을 안내한다 |
| 복호화 실패(수신자 불일치, 파일 손상) | `decrypt_failed`. stderr는 마스킹 뒤 500자 |
| 메타 파일 스키마 오류 | 그 비밀만 `meta_invalid`로 목록에 보이고 lease는 거부한다. 다른 비밀은 영향이 없다 |
| 메타가 가리키는 키가 SOPS 파일에 없다 | 목록 상태 `missing`, lease는 `secret_missing`(`provider`) |
| 허용 호스트 밖 주입 | `denied`(`host_mismatch`), 제공자를 부르지 않는다. `secret.denied` |
| 승인 없이 env 모드 요청 | `denied`(`approval_missing`) |
| lease TTL 경과 후 `use` | `denied`(`lease_expired`) |
| 횟수 소진 후 `use` | `denied`(`lease_exhausted`) |
| `rotate` 중 다른 도구가 같은 핸들 lease를 쓰는 중 | 진행 중인 `use` 콜백은 끝까지 가고, 그 뒤 `use`는 `lease_expired`다. 폐기는 콜백 경계에서 일어난다 [제안] |
| 값이 8바이트 미만 | §3.5 규칙 |
| 응답이 값을 에코 | `echoed: true`, 2계층 마스킹 필수, `secret.masked` |
| 모델이 핸들 대신 값 비슷한 문자열을 인자로 냄 | 2계층·4계층 마스킹이 알려진 값과 패턴을 가린다. 값을 모르는 모델이 값을 만들 수는 없으므로 이 경우는 이전 유출을 뜻한다. 이전 유출 기록의 가림은 범위 밖이다 [미결 §10] |
| 같은 uid의 다른 프로세스가 메모리나 키 파일을 읽음 | 막지 못한다. 한계로 문서화한다 |

### 5.1 플랫폼별 제약

| 항목 | macOS | Linux(WSL2 포함) | Windows 네이티브(이후 단계) |
|---|---|---|---|
| 지원 단계 | 1차 | 1차 | 이후. 1차에서 `select.ts`는 `win32`에서 파일 폴백만 쓰거나 `unsupported_platform`을 낸다 [미결 §10] |
| age 키 저장 | Keychain(`security find-generic-password -w`) | 데스크톱: Secret Service(`secret-tool lookup`). WSL·헤드리스: 파일 폴백 | 자격 증명 관리자. `cmdkey`는 암호를 읽지 못하고 PowerShell 내장 cmdlet에도 읽기가 없다. `CredReadW`를 부르는 헬퍼가 필요하다 [가정] |
| 접근 승인 | Keychain 접근 대화상자가 뜰 수 있고 복호화마다 반복될 수 있다 [가정] | Secret Service 잠금 해제 프롬프트가 뜰 수 있다 [가정] | [가정] 로그온 세션 안에서는 묻지 않는다 |
| Secret Service | 해당 없음 | WSL 기본 배포판과 헤드리스 서버에는 대부분 없다 [가정, `_research/notes/L0-3.md` §3] | 해당 없음 |
| sops 바이너리 | darwin amd64·arm64 릴리스 | linux amd64·arm64 릴리스 | v3.10.0, v3.13.3 릴리스에 amd64·arm64 `.exe`가 있다(`_research/notes/L0-3.md` §4). 실행 확인은 [가정] |
| 키 명령 인자 | 셸 없이 shlex 분리 | 같음 | 백슬래시가 이스케이프로 읽혀 경로가 깨진다. 작은따옴표나 `/`로 적는다 [가정] |
| 파일 권한 검사 | POSIX 모드 | POSIX 모드. WSL `/mnt/c` 아래는 모드가 의미 없으므로 키 파일을 두지 않는다 [제안] | ACL. 1차 미지원 |
| 프로세스 env 노출 | 같은 uid는 `ps eww` 등으로 볼 수 있다 | `/proc/<pid>/environ` | [가정] 같은 사용자는 읽을 수 있다 |

## 6. 설정 노출

### 6.1 설정 키 `l0.secrets.*`

키 형식은 `F.wire-settings.spec` §3.8.1이다. 비밀 값을 담는 키는 없다. 다른 층의 비밀 키 값은 `SecretRef`만 저장한다(D2, D3).

| 키 | 타입 | 기본값 | 범위(allowedScopes) | runtimeChange | L4 노출 |
|---|---|---|---|---|---|
| `l0.secrets.providers` | `string[]`(`SecretProviderId`) | `["sops"]` | managed, user | restart | secrets 탭 목록, `config` |
| `l0.secrets.defaultProvider` | `SecretProviderId` | `"sops"` | managed, user | live | secrets 탭 select |
| `l0.secrets.sops.files` | `{ env: string; path: string }[]` | `[]` [가정 §4.8] | managed, user | live | secrets 탭 table |
| `l0.secrets.sops.binary` | `string \| null` | `null`(xeon.os 해석) | managed, user | restart | advanced 탭 |
| `l0.secrets.ageKey.source` | `"auto" \| "keychain" \| "file"` | `"auto"` | managed, user | restart | secrets 탭 select |
| `l0.secrets.ageKey.filePath` | `string \| null` | `null`(기본 경로 `<OsDirs.config>/secrets/age/keys.txt`) | managed, user | restart | secrets 탭 text |
| `l0.secrets.approval.default` | `"none" \| "per-session" \| "per-use"` | `"per-session"` | managed, user | nextTurn | permissions 탭 |
| `l0.secrets.approval.writeHosts` | `"per-session" \| "per-use"` | `"per-use"` [제안] | managed, user | nextTurn | permissions 탭 |
| `l0.secrets.lease.ttlSeconds` | integer, 1~86400 | `900` | managed, user | live | secrets 탭 number |
| `l0.secrets.lease.maxUses` | integer, 1~100000 | `200` | managed, user | live | secrets 탭 number |
| `l0.secrets.redaction.enabled` | boolean | `true` | managed | restart | readonly 표시만 [제안: 끌 수 없음] |
| `l0.secrets.audit.retentionDays` | integer, 1~3650 | `90` [제안] | managed, user | live | secrets 탭 number |

- `ui.tab`은 `l0.secrets.sops.binary`만 `advanced`이고 나머지 키는 `secrets` 또는 `permissions`다(`F.wire-settings.spec` §3.8.2 `SettingsTab`).
- `project`, `local`, `session` 범위는 받지 않는다. 저장소 안 파일이 비밀 정책을 넓히지 못하게 한다(§3.2 범위 규칙).
- `l0.secrets.redaction.enabled`는 끄는 값을 거부한다. [제안] 키를 두는 이유는 화면이 "마스킹 켜짐(보조 수단)"을 보이게 하기 위해서다.
- 읽기·쓰기 호스트 구분: 메타에 `approval`이 비어 있을 때 `use.hosts`가 쓰기 호스트로 분류되면 `writeHosts`, 아니면 `default`를 쓴다. 분류는 메타를 만들 때 사람이 체크한다 [제안]. 자동 분류(HTTP 메서드 기반)는 하지 않는다.

### 6.2 화면과 파일

- 설정 화면은 설정 키만 다룬다. 메타 파일(§3.2), SOPS 파일(사용자 소유), 감사 파일(§3.9)과 비밀 목록·메타·사용 이력은 secrets 탭의 비밀 관리 패널(`L4.settings-ui.spec` §4.6.3)이 `xeon.secretAdmin`으로 다룬다.
- 화면 공통: 값 열이 없다. 마스킹을 언급하는 문구는 "보조"로 표기한다.

### 6.3 명령·화면 경계

명령 정의(의미, 입력, 실패)는 이 문서가 서비스 메서드로 정하고, 명령줄과 화면은 L4가 정한다.

| 동작 | L0 서비스 메서드 | 명령줄(`L4.cli.spec`) | 화면(`L4.settings-ui.spec`) | 단계 |
|---|---|---|---|---|
| 목록 | `ls`, `list` | `xeon secret ls [--meta \| --usage]` | 목록, 사용 이력 | 마일스톤 M2 |
| 추가 | `add` | `xeon secret add <name> [--provider …]`, 값은 stdin·가린 프롬프트 | 추가(값은 OS 입력 창, C안) | M2 |
| 값 교체 | `set` | `xeon secret set <name>` | 회전 동작에 포함 | M2 |
| 메타 수정 | `meta` | `xeon secret meta <name> …` | 메타 편집, 정책 편집 | M2 |
| 회전 | `rotate` | `xeon secret rotate <name>`(TTY만) | 회전 | M2 |
| 삭제 | `references`, `rm` | `xeon secret rm <name> [--yes]` | 삭제(참조 표시 후 확인) | M2 |
| 점검 | `test` | `xeon secret test <name>` | 상태 열 | M2 |
| 사람 실행 | `run` | [미결] `L4.cli.spec` §10 3번 | 없음 | M2 |
| 값 보기 | `reveal` | `xeon secret reveal <name>`(TTY만, OS 인증 재확인이 가능한 곳은 재확인) | 값 보기(재인증 후 한 번) | 명령줄 M2, 화면 M3 [결정: review.decisions-2 U-20] |
| 승인 | `check` → L1 | 대화형 승인 프롬프트(`L1.tools.spec`) | 승인 요청 "무엇에, 어느 호스트에, 몇 분간" | M2 |
| 등록 안내 | `diagnose`의 `hint` | `xeon doctor` 출력 | 첫 실행 설정 | M1 |

- 명령의 wire 경로(`secret.*` 메서드)는 F에 없다(`L4.cli.spec` §10 3번). 8.3절에 요청한다.

## 7. 확장 지점

- `platform-secrets`는 on 지점, post, drive를 선언하지 않는다. 확장 지점 선언은 L1과 X가 F4에 둔다(`_research/foundation-plan.md` §3).
- 제공자 추가는 확장 지점 대신 서비스 메서드 `registerProvider`로 한다. 등록할 수 있는 확장의 신뢰 등급은 `X.loading-trust.spec`이 정한다 [가정]. 같은 `id`의 제공자는 하나만 등록되고, `sops`는 내장이라 교체할 수 없다 [제안].
- 감사 수신은 `onAudit` 콜백이다. 확장이 비밀 사용을 관찰하려면 tool-runtime이 기록한 세션 이벤트(§3.9)를 읽는다. 감사 수신자를 확장에 직접 열지 않는다 [제안].
- drive와의 관계: 없음. Helm과 학습 그룹(L3 기본 그룹)은 비밀을 직접 lease하지 않고 L2 능력(`xeon.web` 등)을 거쳐 쓴다.

## 8. 다른 문서와의 인터페이스

### 8.1 제공

| 대상 문서 | 제공하는 것 |
|---|---|
| `L1.tools.spec` | `check`, `lease`, bash 도구 env 주입의 승인 판정(`check`가 돌려주는 `needs_approval`, 마일스톤 M1), `withHttp`, 2계층 `Redactor.maskDeep`, `onAudit`(감사 레코드 → 세션 이벤트 `secret.*`, §3.9), 도구 인자 검사 `findForeignSecretSyntax` |
| `L1.loop.spec` | 1계층 `Redactor.mask`(사람 입력) |
| `L1.context.spec` | 4계층 `Redactor.maskDeep`(모델 투영) |
| `L1.models.spec` | `lease`(`runtime-http`, purpose `model.provider:<id>`)와 `use`, 오류 문자열 `Redactor.mask`, 3계층 `containsKnown` |
| `L2.web.spec` | `withHttp`(M3, `GuardedHttp`), `withBrowserInput`(M4), 3계층 `containsKnown`(`secret_in_query`) |
| `L2.mcp.spec` | `lease`·`use`로 MCP 서버 env·헤더 값 해석, `secret_missing` 오류 코드, 서버 stderr 마스킹 |
| `L0.exec.spec` | env 모드 `withEnv`(§3.6, 마일스톤 M1). 자식 env 거부 목록은 F 상수 `SENSITIVE_ENV_PATTERNS`(정본, `L0.exec.spec` §3.5)이고 이 패키지도 같은 상수를 쓴다(§4.5) |
| `L0.sandbox.spec` | `protectedPaths()`: 보호 경로 `secret_key` 행에 넣을 비밀 파일 절대 경로(SOPS 파일, `<OsDirs.config>/secrets/`, 파일 폴백 age 키) |
| `L4.cli.spec`, `L4.settings-ui.spec` | `xeon.secretAdmin` 메서드, 5계층(Logger 구현이 출력 직전에 `mask`), `diagnose()` 안내문 |
| `F.wire-settings.spec` | `SecretRef` 소비 확인(`settings.secretValue` 진단과 같은 형식) |

### 8.2 요구 서비스

L0 패키지끼리 import하지 않으므로 다른 L0 기능은 서비스로 받는다(`eng.dependency-rules.guide` DR-02).

| 서비스 | 쓰는 것 | 상태 |
|---|---|---|
| `xeon.os`(`OsService`) | `dirs.config`, `resolveBinary("sops" \| "security" \| "secret-tool")`, `time.clock`, `time.random`, `logger` | `L0.os.spec` §3.2·§3.6·§3.10의 이름. `eng.context-map.design` 4.1절 `platform-secrets` 행의 (d) "없음"을 `xeon.os`로 고쳐야 한다 |
| `xeon.exec`(`ExecutionEnv`) | 없음. `platform-secrets`는 sops를 직접 실행한다(DR-07 표에서 `Bun.spawn` 소유 허용) | 해당 없음 |
| `xeon.sandbox`(`SandboxService`) | 프록시 훅(후속, sentinel 모드 요구, `L0.sandbox.plan` SB-16). 비밀 파일 경로의 읽기 거부는 등록 API 대신 sandbox가 이 서비스의 `protectedPaths()`를 읽는다 | 후속(sentinel 모드) |
| `xeon.approvals` | 부르지 않는다. L1이 승인 증거를 `UseCtx`로 넘긴다 | 해당 없음 |

### 8.3 F에 요청

| 요청 | 위치 | 내용 |
|---|---|---|
| R1 | `@xeon/contracts/capabilities` `secrets.ts` | 반영되었다. `F.capabilities.spec` §3.10에 참조 형식(`SECRET_REF_PATTERN`, `SECRET_NAME_PATTERN`, `SecretRef`, `SecretNameSchema`, `SecretName`, `SecretHandle`, `SecretRefError`), 순수 함수(`parseSecretRef`, `secretRef`, `findForeignSecretSyntax`), 값 타입(`SecretMeta`, `SecretUsePolicy`, `SecretUseMode`, `SecretProviderId`, `SecretApproval`, `SecretScope`, `SecretAuditRecord`, `SecretDenyReason`, `RedactionLayer`, `RedactionHit`, `ReauthMethod`)이 있다 [결정: review.decisions-2 U-08]. 이 문서 §3.1, §3.2, §3.5, §3.9는 그 이름을 인용한다 |
| R1-a | `@xeon/contracts/services` `services/secrets.ts` | 반영되었다. `F.capabilities.spec` §3.12 표에 `SecretService` 행(`xeon.secrets`)이 있고, 파일별 이름 표의 `services/secrets.ts` 행에 `SecretServiceName`, `UseCtx`, `SecretUseTarget`, `ApprovalEvidence`, `SecretValueView`, `SecretLease`, `SecretProvider`, `ProviderEntry`, `Redactor`, `SecretError` 등이 있다 [결정: review.decisions-2 D-04]. 필드는 이 문서 §3.3~§3.6, §3.10 블록을 F로 옮겨 확정한다(`F.capabilities.plan` P9) |
| R2 | `@xeon/contracts/services` `services/secret-admin.ts` | 반영되었다. `F.capabilities.spec` §3.12 표에 `SecretAdminService` 행(`xeon.secretAdmin`)이 있고 `SERVICE_NAMES`에 들었다. `eng.context-map.design` §5.3 표에도 행이 있다 [결정: review.decisions-2 D-04]. 필드는 이 문서 §3.8 블록을 옮겨 확정한다 |
| R3 | `F.records.spec` §3.3.1 | 반영되었다. `CoreArea`에 `secret`, `CoreEventKind`에 `secret.used`, `secret.denied`, `secret.approved`, `secret.masked`가 있고 생산자는 `core.tools`다. 관리 레코드는 세션 이벤트로 넣지 않는다 |
| R4 | `F.wire-settings.spec` 메서드 표 | 값 없는 `secret.list`, `secret.meta`, `secret.remove`, `secret.test`, `secret.beginEntry`(값 입력은 호스트 쪽 OS 창, `L4.settings-ui.spec` §4.6.4 C안). 값을 싣는 메서드는 요청하지 않는다 |
| R5 | `eng.dependency-rules.guide` DR-07 | 플러그인 제공자가 `op`, `bws` 바이너리를 부를 때의 소유 행(2차) |
| R6 | `F.capabilities.spec` §3.10 `SecretUseModeSchema` | 반영되었다. 값 옆 주석이 사용 모드 번호(M1~M4)와 마일스톤을 함께 적는다. 이전 주석 `// M3`은 사용 모드 번호였는데 마일스톤으로 읽혀 `runtime-http`가 마일스톤 M3 기능처럼 보였다. `runtime-http`는 마일스톤 M1부터 모델 provider 키에 쓴다(§4.3 표) |

## 9. 수용 기준

1. 도구 자식 env: F 상수 `SENSITIVE_ENV_PATTERNS`가 `SOPS_AGE_KEY_CMD`, `SOPS_AGE_KEY_FILE`, `SOPS_AGE_KEY`, `AGE_X`, `OP_SERVICE_ACCOUNT_TOKEN`, `BWS_ACCESS_TOKEN`, `BW_SESSION`, `XEON_SECRET_X`에 모두 맞는다. 부모 env에 이 이름들을 넣고 `L0.exec`로 띄운 도구 자식 프로세스의 env를 덤프하면 그중 어느 것도 없다(실제 자식 프로세스, `L0.secrets.plan` SC-15). 이 패키지가 sops를 부를 때의 env에도 없다.
2. 호스트 바인딩: `use.hosts: ["api.example.test"]`인 비밀로 `withHttp`를 `https://other.example.test`에 부르면 `denied`(`host_mismatch`)가 돌아오고, `send`와 제공자 `lease`가 한 번도 불리지 않으며, `secret.denied` 레코드가 정확히 하나 나온다.
3. 값 비노출(5계층 각각): 가짜 값 `S`(무작위 24바이트)를 `memorySecrets`에 넣고 각 계층 입력에 `S`, base64(`S`), base64url(`S`), URL 인코딩(`S`), hex(`S`), JSON 이스케이프(`S`), Basic 인증 형태 base64(`"user:" + S`)를 넣으면 계층 출력에 어느 형태도 남지 않는다. 계층 다섯 개를 테스트 다섯 개로 따로 확인한다.
4. 감사 기록·오류·직렬화: `SecretLease`를 `JSON.stringify`, `Bun.inspect`, 템플릿 문자열, `Error` cause에 넣은 결과와 모든 `SecretAuditRecord`, 모든 `SecretError`에 `S`와 변형이 없다. 감사 레코드에 `S`의 SHA-256 hex의 어떤 16자 이상 부분 문자열도 없다.
5. 복호화 없는 목록: 가짜 sops 실행 파일(호출 횟수를 기록)과 SOPS 형식 픽스처로 `list()`를 부르면 키 이름이 나오고 sops 호출 횟수는 0이다.
6. lease 수명: `ttlSeconds: 1`인 lease는 수동 시계를 1001 ms 진행한 뒤 `use`가 `lease_expired`다. `maxUses: 2`인 lease의 세 번째 `use`는 `lease_exhausted`다.
7. 회전: 활성 lease 2개가 있는 핸들에 `rotate`를 하면 `revokedLeases: 2`이고, 두 lease의 다음 `use`는 `lease_expired`이며, 이전 값 `S`가 등록부에서 지워지고 새 값이 다음 lease에서 등록된다.
8. 거부 구문: §3.1 표의 입력이 표의 결과를 낸다.
9. 승인 없는 env: `mode: "env"`, `approval: null`인 `lease`는 메타 `approval: "none"`이어도 `approval_missing`이다.
10. argv 경로 없음: `SecretAdminService`의 `add`, `set`, `rotate` 시그니처에 문자열 값 인자가 없고, 패키지 소스에서 sops 호출 인자 배열에 lease 값이 들어가는 경로가 없다(정적 검사 테스트).
11. 8바이트 미만: 7바이트 값의 `registerKnown`은 `value_too_short`, 같은 비밀의 `env` lease는 `mode_not_allowed`다.
12. 플랫폼 선택: `process.platform` 참조가 `src/select.ts` 밖에 없다(`check-layers` DR-13 검사).
13. env 모드(마일스톤 M1): `use.modes: ["env"]`, `use.commands: ["gh api *"]`인 비밀로 `withEnv`를 `target: { kind: "command", argv0: "gh", commandLine: "gh api user" }`와 `per-use` 승인 증거로 부르면 lease가 열린다. 같은 호출을 `commandLine: "curl …"`로 부르면 `denied`(`command_mismatch`)이고 제공자 `lease`가 불리지 않는다. `target.kind`가 `host`면 `mode_not_allowed`다.
14. 모델 provider 키(`runtime-http`, 마일스톤 M1): `use.modes: ["runtime-http"]`, `use.hosts: ["api.example.test"]`인 비밀로 `lease`를 `mode: "runtime-http"`, purpose `model.provider:example`, `target: { kind: "host", host: "api.example.test", port: null }`, `approval: null`로 부르면 lease가 열린다. 같은 호출을 다른 호스트로 하면 `denied`(`host_mismatch`)이고 제공자 `lease`가 불리지 않는다. `use.modes`에 `runtime-http`가 없으면 `mode_not_allowed`다(`policy.test.ts`, review.decisions-2 U-19 보충).

## 10. 미결 사항

1. [미결] 세션 밖 관리 레코드의 저장 위치(권고: `platform-secrets` 소유 추가 전용 파일)와 단일 DB 결정(ADR-0004)과의 관계(§3.9). 감사 이벤트 kind 소유자는 `F.records.spec` §3.3.1의 (a)안(tool-runtime 발행)으로 정해졌다.
2. [결정: review.decisions-2 U-19] 마일스톤 M1의 검증 모드는 `env` 주입(bash 도구, 실행마다 승인)이다. `withEnv`(§3.6)와 exec `secretEnv`(`L0.exec.spec` §3.6)를 M1에 둔다. `product.scope.spec` §4.4 M1 행, `L2.workspace.spec` §3.3과 같은 배치다. 모델 provider API 키는 마일스톤 M1부터 `runtime-http` 모드로 lease한다(§4.3 표, 수용 기준 14). env 경로는 아직 끝까지 이어지지 않았다. M1 코드는 승인 증거를 `null`로 넘기고 호스트 `approval.respond`가 `notImplemented`다. 마일스톤 M2 승인 프로토콜 작업(`L4.host-service.plan` H18)에서 증거 전달까지 완성한다.
3. [미결] sops 최소 버전. 이 문서는 3.10.0을 하한으로 두었다. 조사는 3.12.0 하한, 3.13.3 실사용을 제안한다(`_research/notes/L0-3.md` §2.1).
4. [미결] 사용자 `secrets` 도구(`just secret-add`)가 관리하는 SOPS 파일의 위치와 env 이름 매핑 규약. 확인 전까지 `l0.secrets.sops.files`는 사람이 적는다.
5. [미결] sops `set`이 stdin으로 값을 받는지. 받지 못하면 SOPS 제공자 `put`을 끄고 `just secret-add` 경로만 쓴다(§4.6 6번).
6. [미결] M2 sentinel의 TLS 종단 방식(`tlsTerminate`와 `mitmProxy` 중 선택, 자식 CA 신뢰). `xeon.sandbox` 프록시 훅(후속, sentinel 모드 요구, `L0.sandbox.plan` SB-16)과 함께 정한다.
7. [미결] Windows 네이티브 age 키 획득 수단(PowerShell P/Invoke 헬퍼, Bun 컴파일 헬퍼 + `@napi-rs/keyring`)과 1차 `win32` 동작(파일 폴백 허용 여부).
8. [결정: review.decisions-2 D-04] 관리 서비스는 `xeon.secretAdmin`(`SecretAdminService`)으로 나눈다. `F.capabilities.spec` §3.12 표, `SERVICE_NAMES`, `eng.context-map.design` §5.3 표에 반영되었다(8.3절 R2).
9. [미결] 이미 기록된 이벤트에 남은 값의 사후 가림. `docs/design/18-security.md` §3.10.6의 판정을 Xeon에 옮길지 정한다.
10. [미결] 플러그인 제공자(`op`, `bws`)의 바이너리 호출 소유 규칙(DR-07 행 추가).
