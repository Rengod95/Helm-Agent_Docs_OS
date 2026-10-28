---
id: L0.secrets.plan
layer: L0
domain: secrets
kind: plan
status: draft
depends_on: [L0.secrets.spec, L0.exec.spec, eng.testing.guide]
binds: [xeon/packages/platform-secrets/**]
---

# L0 비밀 (platform-secrets) 구현 계획

패키지: `xeon/packages/platform-secrets` (현재 스캐폴드: `package.json`, `src/index.ts`, `test/smoke.test.ts`, `xeon.layer = "L0"`, `xeon.domain = "secrets"`). 이 계획은 코드를 바꾸지 않는다. 구현 작업자가 이 순서대로 만든다.

## 1. 목표와 마일스톤 배치

목표: `L0.secrets.spec`의 `xeon.secrets`(`SecretService`)와 `xeon.secretAdmin`(`SecretAdminService`, [결정: review.decisions-2 D-04])을 구현한다. 값은 부모 프로세스의 lease 안에만 있고, 모델 컨텍스트·이벤트·로그·도구 자식 env에 나오지 않아야 한다.

[결정] 마일스톤 M1에 "SOPS 비밀 참조 1종"이 `xeon chat` 도구 호출에서 해석된다(`_research/foundation-plan.md` §5 P4 M1). `L0.readme` §2.2도 M1에 secrets(SOPS 참조 1종)를 둔다.

| 단계 | 범위 | 근거 |
|---|---|---|
| M0 | 코드 없음. 선행 조건: contracts에 spec 8.3절 R1의 참조 형식·순수 함수·값 타입(`capabilities/secrets.ts`, `F.capabilities.spec` §3.10, `F.capabilities.plan` P8)과 R1-a·R2의 서비스 인터페이스·이름 상수(`services/secrets.ts`, `services/secret-admin.ts`, `F.capabilities.spec` §3.12, `F.capabilities.plan` P9)가 들어간다. `platform-os`의 경로·Clock·RandomSource 최소형(`L0.readme` §2.2 os M0 행) | `_research/foundation-plan.md` §5 P4 M0 |
| M1 | `SecretProvider` 인터페이스 구현 틀, SOPS 제공자(목록·lease), 메타 파일 읽기, lease, 모드 M1 에이전트 env 주입(`withEnv`, bash 도구, 실행마다 승인. exec 쪽은 `L0.exec.plan` EX-13) [결정: review.decisions-2 U-19], 모드 M3(`withHttp`), 마스킹 기본 계층(`Redactor` 규칙 1~3, 계층 2·4·5 연결), 자식 env 필터, 감사 훅(`onAudit`), 키 획득은 OS 1종 이상 + 파일 폴백, `diagnose()` 안내문 | spec §4.3 단계 열, `_research/foundation-plan.md` §5, review.decisions-2 U-19 |
| M2 | 관리 서비스 전체(`ls`, `add`, `set`, `meta`, `rotate`, `rm`, `test`, `run`, `references`, `usage`, `reveal`. `reveal`은 CLI `xeon secret reveal`이 먼저 쓰고 데스크톱 화면은 M3다 [결정: review.decisions-2 U-20]), 모드 M4(`withBrowserInput`), 마스킹 5계층 전체 연결(1·3계층 포함), 키체인 provider 3 OS(Windows는 [미결] 해소 뒤), 감사 파일 | `product.scope.spec` §4.4 M2 행(비밀 관리 명령), spec §6.3 |
| 후속 | 모드 M2 sentinel 프록시(`xeon.sandbox` 프록시 훅 `L0.sandbox.plan` SB-16, TLS 종단), 값 저장 제공자 플러그인(1Password `op`, Bitwarden `bws`, 키체인 `keychain`) | spec §4.3, §10 6·7번 |

- [제안] M1 키 획득: Linux(Secret Service)와 파일 폴백을 먼저 만든다. 개발과 CI가 Linux·WSL이고, WSL에는 Secret Service가 대부분 없기 때문이다. macOS Keychain은 M1 안에서 명령 구성만 만들고 실기 확인은 M2 완료 기준에 둔다.
- [결정: review.decisions-2 U-19] M1 검증 모드는 `env` 주입(bash 도구, 실행마다 승인)이다(spec §10 2번). SC-15와 SC-22를 M1에 둔다. 승인 증거 전달은 M2 승인 프로토콜 작업에서 완성한다. 모델 provider 키는 M1부터 `runtime-http`로 lease하고 `policy.test.ts`가 이 허용을 확인한다(spec §9 14번).

## 2. 패키지와 파일 배치

```
xeon/packages/platform-secrets/
  package.json                 # dependencies: @xeon/contracts, @xeon/ext-host(서비스 등록 API), typebox, age-encryption 0.3.1
                               # exports: "." → src/index.ts, "./testing" → src/testing/index.ts
  src/
    index.ts                   # secretsPlugin만 export (SC-12)
    plugin.ts                  # PlatformModule(ext-host registerPlatform): xeon.secrets, xeon.secretAdmin 등록, 설정 등록 (SC-12)
    settings.ts                # defineSettings("l0.secrets", …) spec §6.1 (SC-12)
    ref.ts                     # 입력 단계 검사 연결: F parseSecretRef·findForeignSecretSyntax를 메타 name·설정 값에 적용 (SC-01)
    meta.ts                    # 메타 파일 스키마 검증, 읽기·쓰기(0600), 디렉터리 열거 (SC-02)
    provider.ts                # SecretProvider 레지스트리, 내장 sops 고정, registerProvider (SC-12)
    providers/
      sops.ts                  # sops 호출 래퍼: 버전 확인, decrypt --extract, 오류 매핑 (SC-03)
      sops-keys.ts             # SOPS 파일 키 이름 평문 파싱(YAML·JSON·dotenv), 복호화 없음 (SC-04)
    key/
      provider.ts              # KeyProvider 인터페이스, shlex 인용 함수 (SC-05)
      darwin.ts                # security find-generic-password 명령 구성, probe (SC-05)
      linux.ts                 # secret-tool lookup 명령 구성, D-Bus probe (SC-05)
      win32.ts                 # 미구현 스텁: probe → not_implemented (SC-05)
      file-fallback.ts         # 0600 키 파일, age-encryption으로 provision, 권한 검사 (SC-13)
    select.ts                  # KeyProvider 선택. process.platform·WSL 판정은 이 파일에만 (SC-05)
    lease.ts                   # SecretLease: 클로저 값, TTL·횟수, use 재검사, dispose 0 덮기, toJSON·inspect (SC-06)
    policy.ts                  # 정책 판정 순서(spec §4.2), 호스트·origin·명령 패턴 일치 (SC-07)
    modes/
      http.ts                  # withHttp: 핸들 토큰 치환, 에코 검사 (SC-07)
      browser.ts               # withBrowserInput: origin 검사 (M2, SC-17)
    env-filter.ts              # sops 호출용 env 구성. F 상수 SENSITIVE_ENV_PATTERNS로 거른다 (SC-11)
    protected-paths.ts         # protectedPaths(): SOPS 파일, <config>/secrets/, 파일 폴백 키 경로 (SC-21)
    redactor.ts                # Redactor: 알려진 값 변형, 접두 패턴, 키-값 문맥 (SC-08)
    audit.ts                   # SecretAuditRecord 생성, onAudit 배포, 감사 파일 쓰기(M2) (SC-09)
    service.ts                 # SecretService 조립: resolve, list, check, lease (SC-10)
    admin.ts                   # SecretAdminService (M2, SC-14)
    diagnose.ts                # SecretDiagnostics, 등록 안내문(just secret-add / xeon secret add) (SC-16)
    errors.ts                  # SecretError 생성 도우미, stderr 마스킹 500자 (SC-03)
    testing/
      index.ts                 # memorySecrets, fakeSopsBinary 경로 도우미 (SC-12, eng.testing.guide TS-05)
  test/
    ref.test.ts  meta.test.ts  lease.test.ts  policy.test.ts  redactor.test.ts  redactor.prop.test.ts
    sops-keys.test.ts  sops.int.test.ts  key-select.test.ts  env-filter.test.ts  audit.test.ts
    service.test.ts  http-mode.test.ts  admin.test.ts  no-leak.test.ts  static-checks.test.ts
    protected-paths.test.ts
    fixtures/                  # SOPS 형식 픽스처. 값 자리는 가짜 ENC[...] 문자열뿐. 실제 키·비밀 없음
```

- `memorySecrets`(TS-05): `SecretService`와 `SecretAdminService`를 구현하는 메모리 가짜다. 테스트가 넣은 가짜 값만 다루고, 정책 판정·lease·`Redactor`는 운영 구현을 그대로 쓴다. 그래서 다른 패키지 테스트도 마스킹과 호스트 거부를 실제 규칙으로 확인한다.
- `fakeSopsBinary`: 테스트 임시 디렉터리에 만드는 셸 스크립트 경로를 돌려준다. 호출 횟수와 인자를 파일에 기록하고 가짜 값을 출력한다. 진짜 sops와 age 키를 쓰지 않는다.

## 3. 작업 분해

| id | 내용 | 선행 | 규모 | 단계 |
|---|---|---|---|---|
| SC-01 | 참조 입력 검사: F 순수 함수 `parseSecretRef`, `secretRef`(위반 시 `Bug`), `findForeignSecretSyntax`(구현은 `F.capabilities.plan` P8)를 메타 `name`과 설정 값 검사에 연결하고, spec §3.1 표 결과를 이 패키지 입력 경로로 다시 확인한다 | F R1 | S | M1 |
| SC-02 | 메타 스키마와 파일 읽기·쓰기: TypeBox 검증, 비밀별 YAML 파일, 0600 쓰기, 사용자 범위만 읽기, `meta_invalid` 격리 | SC-01 | M | M1(읽기), M2(쓰기) |
| SC-03 | sops 호출 래퍼와 오류 매핑: `xeon.os`로 경로 해석, `--version` 파싱(3.10.0 하한), `decrypt --extract`, 종료 코드·stderr → `provider_unavailable`(`binary_missing`, `version_too_old`) / `key_unavailable` / `decrypt_failed`. stderr 마스킹 | SC-11 | M | M1 |
| SC-04 | 키 이름 목록: SOPS YAML·JSON·dotenv 평문 파싱, `ENC[` 값만, `sops` 블록 제외, 중첩 경로, `sops:<env>/<KEY>` 참조 생성. sops를 부르지 않는다 | SC-02 | S | M1 |
| SC-05 | `SOPS_AGE_KEY_CMD` 구성과 OS별 명령 3종: `KeyProvider`, shlex 인용 함수, darwin·linux 명령, win32 스텁, `select.ts`(auto·keychain·file) | — | M | M1(linux, darwin 구성), M2(darwin 실기, win32 [미결]) |
| SC-06 | lease 수명과 폐기: 클로저 값, `use` 재검사, TTL(주입 `Clock`), 횟수, `dispose` 0 덮기, `toJSON`·inspect 차단, 도구 호출 종료 일괄 폐기 API | SC-01 | M | M1 |
| SC-07 | 도메인 바인딩 검사와 M3: 정책 판정 6단계(spec §4.2), 호스트 와일드카드·포트 규칙, `withHttp` 토큰 치환·URL 핸들 거부·에코 검사 | SC-06, SC-08 | M | M1 |
| SC-08 | `Redactor` 규칙과 변형 값 등록: 원문, base64 3종 정렬, URL, hex, JSON 이스케이프, 접두 패턴, 키-값 문맥, `containsKnown`, `forget`, 8바이트 하한 | — | M | M1 |
| SC-09 | 감사 이벤트 훅: `SecretAuditRecord` 생성, `onAudit` 배포, `commandHash`. M2에 감사 파일(추가 전용, fsync, 0600, 보관 기간 정리) | SC-06 | S(M1), S(M2) | M1, M2 |
| SC-10 | 서비스 조립: `resolve`, `list`(메타 + 제공자 합치기, 상태 계산), `check`, `lease`(판정 → 제공자 → 등록 → 감사) | SC-02~SC-09 | M | M1 |
| SC-11 | 자식 env 필터: sops 호출 env(F 상수 `SENSITIVE_ENV_PATTERNS`로 거른 env + 키 변수 하나). 별도 거부 목록은 두지 않는다(spec §4.5) | F `SENSITIVE_ENV_PATTERNS` | S | M1 |
| SC-12 | 서비스 등록: `PlatformModule`(ext-host `registerPlatform`), `l0.secrets.*` 설정 정의, 제공자 레지스트리, `testing` 서브패스(`memorySecrets`, `fakeSopsBinary`) | SC-10 | S | M1 |
| SC-13 | 키 파일 폴백: `age-encryption` 0.3.1로 identity 생성, 0600 쓰기, 소유 uid·모드 검사, 고지 문구, 첫 사용 확인 플래그 | SC-05 | S | M1 |
| SC-14 | 관리 명령 서비스 메서드: `ls`, `usage`, `add`, `set`, `meta`, `rotate`(lease 폐기), `references`, `rm`(`in_use`), `test`(길이·해시 8자), `run`(사람 전용 M1) | SC-10, SC-09 | L | M2 |
| SC-15 | exec 연동 테스트: `L0.exec`가 F 상수 `SENSITIVE_ENV_PATTERNS`로 비밀 제공자 변수를 지우는지 `fakeExec`가 아닌 실제 자식 프로세스로 확인(int, spec §9 1번). 시험 파일은 `platform-exec`에 둔다(DR-02). `withEnv` 주입 경로 연동은 SC-22 | SC-11, `L0.exec.plan` EX-12 | S | M1 |
| SC-16 | `just secret-add` 안내문과 doctor 점검: `diagnose()`가 sops 유무·버전, 키 provider 상태, 파일 폴백 고지, 메타 없는 키(`orphaned`), 등록 경로 두 줄 안내를 낸다 | SC-03, SC-05, SC-10 | S | M1 |
| SC-17 | M4 `withBrowserInput`: origin 정확 일치, `fill` 콜백만 값 수신, 콜백 뒤 0 덮기 | SC-07 | S | M2 |
| SC-18 | SOPS `put`·`remove`: sops `set`의 stdin 입력 지원 확인 뒤에만 켠다(spec §10 5번). 지원이 없으면 `capabilities().put = false` | SC-03, [미결] | M | M2 |
| SC-19 | 키체인 provider 3 OS 실기 확인: darwin Keychain(승인 대화상자 횟수 기록), linux Secret Service, win32 헬퍼([미결] 해소 뒤) | SC-05 | M | M2 |
| SC-20 | M2 sentinel 프록시: sentinel 발급, `xeon.sandbox` 프록시 훅으로 헤더 치환, 허용 호스트 밖 차단 | `L0.sandbox.plan` SB-16 프록시 훅(후속) | L | 후속 |
| SC-22 | 모드 M1 `withEnv`: `mode: "env"` 판정(명령 패턴, `per-use` 승인 필수, `target.kind` 검사), lease 발급, 8바이트 미만 거부, 감사 훅. `L0.exec.plan` EX-13과 실제 자식 프로세스 int 테스트로 연결 확인 | SC-06, SC-10, `L0.exec.plan` EX-13 | M | M1 |
| SC-23 | `reveal`: `HumanReauth` 검사(60초, `os-auth` 우선, OS 인증을 쓸 수 없는 터미널만 `tty-confirm`), `show` 콜백 1회 뒤 0 덮기, `secret.revealed` 감사 파일 기록 | SC-14 | S | M2 |
| SC-24 | 첫 쓰기 자동 준비(spec §4.6 8번, §4.7 7번, §4.8): 기본 SOPS 파일 `user`, 키·수신자 기록·암호화한 빈 파일 만들기, 파일 잠금, macOS `provision`, 실패 원인별 `write_failed` | SC-18, SC-13, SC-19 | M | M2 |
| SC-21 | `protectedPaths()`: `l0.secrets.sops.files` 경로, `<OsDirs.config>/secrets/`, 파일 폴백 age 키 경로(`l0.secrets.ageKey.filePath` 또는 기본값)를 절대 경로로 돌려준다. 값 없음 | SC-02, SC-13 | S | M1 |

- SC-24는 M2 첫 실행(macOS M-12)에서 "깨끗한 기기에서 `xeon secret add`가 설정 없이 실패한다"는 결과가 나와 더했다. 순서는 SC-18, SC-13 뒤다.
- 순서: SC-01·SC-05·SC-08·SC-11 → SC-02·SC-06·SC-13 → SC-03·SC-04·SC-07·SC-09·SC-21 → SC-10 → SC-12·SC-15·SC-16·SC-22 (M1) → SC-14·SC-17·SC-18·SC-19·SC-23 (M2) → SC-20 (후속).
- 규모: S는 반나절 이하, M은 1~2일, L은 3일 이상 [가정: 구현자 1명 기준].

## 4. 채택 코드

| 대상 | 버전 | 방식 | 쓰는 곳 | 근거·메모 |
|---|---|---|---|---|
| `sops` 바이너리 | 하한 3.10.0(`SOPS_AGE_KEY_CMD` 도입), 권장 3.12.0 이상, 실사용 확인 3.13.3 | 외부 바이너리 호출. 번들 여부는 `L0.os.spec`의 외부 바이너리 해석·설치 안내에 따른다 [미결] | `providers/sops.ts` | `_research/notes/L0-3.md` §2.1, §4. 하한 확정은 spec §10 3번 |
| `age` | 별도 바이너리 불필요 [제안] | sops가 age 형식을 내장한다. identity 생성은 아래 라이브러리로 한다 | — | DR-07 표의 `age` 바이너리 소유는 유지한다. 나중에 `age-keygen`이 필요해져도 이 패키지만 부른다 |
| `age-encryption`(typage, npm·JSR `@age/age-encryption`) | 0.3.1 정확 고정 | npm 의존 그대로 | `key/file-fallback.ts`의 identity 생성과 수신자 계산에만 | `_research/packages.md` §4.2 L0-c 행. 값 암복호화에는 쓰지 않는다 |
| `@napi-rs/keyring` | 2.1.2 | 후보로만 기술. 채택하지 않는다 | — | Bun 로드는 [미확인](`_research/notes/L0-3.md` §5). 채택하려면 격리 디렉터리에서 Bun `require`와 `Entry` set·get·delete를 Linux(Secret Service 있음·없음), WSL, macOS에서 확인해야 한다(research 질문 3). 채택 시 Linux 스토어를 `secret-service`로 고정한다 |
| `sops-age`(npm 3.0.0) | — | 채택하지 않는다 | — | 조사 권장은 sops 바이너리 호출이다(`_research/secrets.md` §3.3). 순수 JS 구현은 KMS·PGP와 메타데이터 처리 범위가 좁고 관리 주체와 감사 여부가 확인되지 않았다 |
| omp `coding-agent/src/secrets/`(약 4.4k줄) | — | 포크하지 않는다. 규칙만 참조한다 | `redactor.ts` 설계 참고 | Bun·pi-utils 결합(`_research/packages.md` §4.2 L0-c 마스킹 행). 알려진 값 치환이 핵심이라 자체 구현이 작다 |
| hermes redact | — | 규칙만 참조 | `redactor.ts` | 같은 행 |
| `docs/design/18-security.md` §3.10.4 | — | 규칙 이식(문장 수준, 코드 없음) | `redactor.ts` | 엔트로피 검사 제외, 접두 패턴 표지에서 해시 제외(spec §3.5) |
| `typebox` | 1.4(catalog) | 그대로 | 메타 스키마 검증 | `_research/foundation-plan.md` §2 스키마 행 |

- YAML 파싱: [가정] Bun 1.4 내장 YAML 파서를 쓴다. 쓸 수 없으면 새 의존을 들이지 않고 메타 형식을 JSON으로 바꾸며, SOPS YAML 파일 키 목록은 최상위 키 줄만 읽는 제한 파서로 처리한다. 새 YAML 라이브러리를 들이려면 DR-07 표에 행을 더하는 변경과 함께 한다.

## 5. 단위 테스트 목록

모든 비밀 값은 테스트 안에서 `seededRandom`으로 만든 가짜 값이다. 픽스처 파일에 값이나 키를 쓰지 않는다.

| 파일 | 테스트 이름 | 확인할 동작 |
|---|---|---|
| `ref.test.ts` | `accepts secret://github-token` | 허용 예가 이름을 돌려준다 |
| | `rejects bad names and schemes` | spec §3.1 표의 `invalid_ref` 행 전부 |
| | `rejects foreign syntaxes` | `$VAR`, `${VAR}`, `{{secret:x}}`, `%x%`, `op://…`, `sops:dev/KEY`가 `unsupported_ref_syntax` |
| | `secretRef throws Bug on invalid name` | 호출 결함은 `Bug` |
| `meta.test.ts` | `validates schema and isolates invalid file` | 잘못된 메타 하나가 다른 비밀 목록을 막지 않는다 |
| | `ignores project-scoped meta locations` | 저장소 안 메타 디렉터리를 읽지 않는다 |
| | `writes with mode 0600` | 쓰기 권한 |
| `sops-keys.test.ts` | `lists keys without decrypt` | YAML·JSON·dotenv 픽스처에서 `ENC[` 키만, `sops` 블록 제외 |
| `service.test.ts` | `list does not call sops` | `fakeSopsBinary` 호출 기록 0회 |
| | `lease emits secret.used without value` | 감사 레코드 필드, 값 없음 |
| `lease.test.ts` | `expires after ttl` | 수동 시계 1001 ms 뒤 `lease_expired` |
| | `exhausts after maxUses` | 세 번째 `use`가 `lease_exhausted` |
| | `dispose zeroes bytes` | 콜백 밖에 남긴 `bytes` 참조가 0으로 덮인다 |
| | `serialization never shows value` | `JSON.stringify`, `Bun.inspect`, 템플릿 문자열, `String()`, `Error` cause에 값과 변형이 없다 |
| `policy.test.ts` | `denies host outside allowlist` | `host_mismatch`, 제공자 미호출, `secret.denied` 1건 |
| | `wildcard host matches subdomain only` | `*.example.test`가 `example.test`와 맞지 않는다 |
| | `env mode requires per-use approval` | 메타 `none`이어도 `approval_missing` |
| | `expired secret denied` | 메타 `expiresAt` 지남 → `expired` |
| | `runtime-http lease for model provider key` | spec §9 14번. 허용 호스트면 lease, 다른 호스트면 `host_mismatch`, 모드 미허용이면 `mode_not_allowed`(review.decisions-2 U-19 보충) |
| `http-mode.test.ts` | `substitutes handle in header only for allowed host` | 치환된 요청이 `send`에만 간다 |
| | `rejects handle in url` | `invalid_ref` |
| | `flags echoed response` | 응답 본문에 값 → `echoed: true` |
| `admin.test.ts` | `rotate revokes active leases` | `revokedLeases`, 이후 `use` 거부, 이전 값 `forget` |
| | `rm refuses when in use` | `in_use` |
| | `test prints length and hash prefix only` | 결과 필드 4개뿐, 값 없음 |
| | `add rejects values shorter than 8 bytes` | `value_too_short` |
| `redactor.test.ts` | `masks known value variants` | 원문, base64 표준·URL-safe·무패딩, Basic 인증 정렬 3종, URL 인코딩, hex 대소문자, JSON 이스케이프 |
| | `masks prefix patterns and kv context` | 18 §3.10.4 규칙 2·3 예 |
| | `does not apply entropy check to tool output` | UUID·git 해시가 그대로 남는다 |
| | `registerKnown rejects short values` | 7바이트 → `value_too_short`, 같은 비밀의 `env` lease → `mode_not_allowed` |
| `redactor.prop.test.ts` | `no registered value survives mask` | 고정 시드 무작위 값과 무작위 앞뒤 문맥에서 원문과 변형이 남지 않는다 |
| `env-filter.test.ts` | `strips SOPS_AGE_ and provider tokens` | sops 호출 env에서 `SOPS_AGE_*`, `AGE_*`, `OP_*`, `BWS_*`, `BW_SESSION`, `XEON_SECRET_*` 제거. 거른 기준이 F `SENSITIVE_ENV_PATTERNS`와 같은 값 |
| | `sops env carries exactly one key variable` | sops 호출 env에 키 변수가 하나뿐 |
| `platform-exec/test/service.int.test.ts`(`L0.exec.plan` §5) | `child env drops secret provider variables` | SC-15. 부모 env에 spec §9 1번 이름들을 넣고 실제 `xeon.exec`로 `env`를 실행하면 출력에 그 이름이 없다. L0 패키지끼리 import하지 않으므로(DR-02) 시험은 exec 패키지에 두고, 이 패키지는 이름 목록(spec §9 1번)만 정한다 |
| `protected-paths.test.ts` | `protected paths list secret files without values` | SC-21. 설정한 SOPS 파일, `<config>/secrets/`, 파일 폴백 키 경로가 절대 경로로 나오고 값·파일 내용이 없다 |
| `key-select.test.ts` | `auto falls back to file when secret service missing` | probe `no_secret_service` → 파일, 고지 문구 |
| | `quotes key command for shlex` | 공백·백슬래시가 든 경로를 작은따옴표로 감싼다 |
| `sops.int.test.ts` | `maps missing binary` | `provider_unavailable`(`binary_missing`) |
| | `maps old version` | `version_too_old` |
| | `maps locked keychain and decrypt failure` | 가짜 키 명령 실패 → `key_unavailable` 또는 `decrypt_failed`, stderr 마스킹 |
| `no-leak.test.ts` | `five redaction layers` | spec §9 3번을 계층별 테스트 5개로 |
| `static-checks.test.ts` | `no argv value path` | `admin.ts`의 `add`·`set`·`rotate`에 문자열 값 인자가 없고, `providers/sops.ts`의 spawn 인자 배열이 lease 값에서 오지 않는다(소스 검사) |
| | `platform branch only in select.ts` | `process.platform` 참조 위치 |

- 태그는 `eng.testing.guide` TS-01을 따른다. 실제 자식 프로세스를 쓰는 `sops.int.test.ts`와 SC-15 연동 테스트는 `int`이고, 파일당 10초 이하로 둔다.

## 6. 완료 기준

1. `just verify`가 종료코드 0이다.
2. M1 스모크 [결정: review.decisions-2 U-19]: 모델 테이프로 `xeon chat` 한 턴을 돌릴 때 bash 도구가 `secret://` 참조 1개를 env 주입으로 쓴다(사용 모드 M1, 실행마다 승인, 메타 `use.commands`에 시험 명령 등록). 시험 명령은 받은 env 값의 길이와 해시 비교 결과만 출력한다. 다음 검사를 통과한다.
   - 시험 명령이 기대한 값을 받았다고 보고한다(종료 코드 0).
   - 이벤트 DB 전체, blob, 운영 로그, 모델 요청 본문(테이프 기록), CLI stdout·stderr에 값과 변형(base64, URL, hex, JSON 이스케이프)이 없다.
   - 승인을 거부한 같은 시나리오는 `secret.denied`(`approval_missing`) 레코드를 남기고 자식 프로세스를 띄우지 않는다. 명령 패턴 밖 명령은 `command_mismatch`다.
3. 픽스처: gitleaks 대상 경로(`test/fixtures/**`)에 실제 비밀과 age 키가 없다. lefthook pre-commit gitleaks가 통과한다.
4. spec §9 수용 기준 1~14가 아래 표의 테스트로 대응된다.

| spec §9 | 테스트 |
|---|---|
| 1 | `exec child env drops secret provider variables`(SC-15), `strips SOPS_AGE_ and provider tokens` |
| 2 | `denies host outside allowlist`, `substitutes handle in header only for allowed host` |
| 3 | `five redaction layers` |
| 4 | `serialization never shows value`, `lease emits secret.used without value` |
| 5 | `list does not call sops`, `lists keys without decrypt` |
| 6 | `expires after ttl`, `exhausts after maxUses` |
| 7 | `rotate revokes active leases` |
| 8 | `rejects bad names and schemes`, `rejects foreign syntaxes` |
| 9 | `env mode requires per-use approval` |
| 10 | `no argv value path` |
| 11 | `registerKnown rejects short values` |
| 12 | `platform branch only in select.ts` |
| 13 | `withEnv opens lease for matching command`, `withEnv denies command outside pattern`(SC-22) |
| 14 | `runtime-http lease for model provider key` |
5. M2: 관리 서비스 메서드 전부와 M4가 테스트를 통과하고, macOS와 Linux 데스크톱에서 키체인 provider 실기 확인 기록(대화상자 횟수 포함)을 남긴다. 실기 확인은 수동 항목이다.

## 7. 위험과 대응

| 위험 | 대응 | 확인 방법 |
|---|---|---|
| macOS Keychain 승인 대화상자 반복(키 명령이 복호화마다 실행) | 항목 생성 때 신뢰 앱 목록(`-T`)에 sops 경로를 넣는 방안과, lease 하나에 복호화 한 번 원칙을 둔다. 반복이 심하면 lease 기본 TTL 안에서 같은 핸들 복호화를 묶는 방안을 검토한다 | macOS 실기에서 lease 5회에 뜬 대화상자 수를 세어 SC-19 기록에 남긴다 |
| Linux Secret Service 부재(WSL·헤드리스)에서 파일 폴백의 보안 수준 하락 | 0600·소유 검사, 키 경로 샌드박스 읽기 거부(요구), 첫 사용 확인, `diagnose()` 고지 | WSL에서 `diagnose()` 출력에 파일 폴백 고지가 있고, 확인 전 lease가 거부되는지 int 테스트로 본다 |
| Windows 자격 증명 읽기 수단 미확정(`cmdkey` 불가) | win32 provider를 스텁으로 두고 Windows 네이티브 착수 때 정한다(spec §10 7번) | `key-select.test.ts`에서 win32 모의 플랫폼이 `not_implemented`를 돌려주는지 본다 |
| sops 바이너리 배포(번들 대 설치 요구) | 1차는 설치 요구 + `diagnose()` 안내. 번들 여부는 `L0.os.spec` 외부 바이너리 정책과 함께 정한다 | sops가 없는 환경에서 `diagnose()`가 설치 안내와 등록 경로 안내를 내는지 int 테스트로 본다 |
| sops 버전 차이(3.10.x 키 명령 실패 처리, 3.12 수신자 변수) | 하한 3.10.0 검사, 권장 3.12.0 이상 안내, 실패 경로 테스트 | `fakeSopsBinary`가 버전 문자열 3.9.4·3.10.0·3.13.3을 낼 때의 판정을 테스트로 본다 |
| M2 sentinel의 TLS 종단 복잡도 | 후속으로 미룬다. sandbox 프록시 훅이 생긴 뒤 SC-20에서 정한다 | `L0.sandbox.plan`에 프록시 훅 작업이 생겼는지 계획 검토 때 확인한다 |
| 마스킹을 보장으로 오해하는 사용자 문구 | 문서·화면·`diagnose()` 문구에 "보조"를 쓴다. 설정 키는 읽기 전용 표시 | `L4.settings-ui` 문구 검토와 이 패키지 문자열에 "보장"이 없는지 정적 검사로 본다 |
| JS 문자열로 바뀐 값이 힙에 남음(`text()`) | `text()` 호출을 M1 env 주입, M3 헤더 치환, M4 입력으로 제한하고 나머지는 `bytes`만 쓴다 | `static-checks.test.ts`에서 `text()` 호출 위치를 허용 목록과 대조한다 |
| 세션 이벤트 기록이 L1 작업에 묶여 늦어짐 | 이 패키지는 M1에 `onAudit` 훅과 레코드 타입까지만 만든다. 세션 이벤트 `secret.*` 기록은 (a)안(`F.records.spec` §3.3.1, 생산자 `core.tools`)대로 `L1.tools.plan`이 붙인다 | M1 스모크가 `onAudit` 수신 레코드로 `secret.used`·`secret.denied`를 확인하는지 본다 |

## 8. M2 구현 기록 (m2-plan SEC.1~SEC.5)

구현은 브랜치 `m2/sec`에서 했다. 시험 환경은 WSL2(sops 3.13.3, age 1.3.2, Secret Service 없음, macOS·Windows 없음)다. 시험 값은 모두 `seededRandom`이나 일회용 age 키로 만든 가짜이고, 값 비교는 불리언으로만 해서 실패 메시지에 값이 찍히지 않게 했다.

### 8.1 작업별 상태

| m2-plan ID | plan ID | 상태 | 내용과 시험 |
|---|---|---|---|
| SEC.1 | SC-02(쓰기), SC-09(감사 파일) | 구현 | `meta.ts`의 `write`·`remove`(0600 임시 파일 → fsync → 이름 바꿈, 새로 만들 때는 hard link로 덮어쓰기 경쟁 차단). `audit-file.ts`(추가 전용, 기록마다 fsync, 0600, 보관 기간 정리는 프로세스당 첫 쓰기 전 한 번). `meta-write.test.ts`, `audit-file.test.ts` |
| SEC.2 | SC-14 | 구현 | `admin.ts`의 `ls`, `usage`, `add`, `set`, `meta`, `rotate`, `references`, `rm`, `test`, `run`. `admin.test.ts`(메모리), `admin.int.test.ts`(조립한 서비스와 실제 파일, 실제 sops) |
| SEC.3 | SC-23 | 구현 | `reveal`. 재인증 60초 이내, `os-auth` 우선, OS 인증을 쓸 수 있는 환경에서는 `tty-confirm` 거부, `passphrase`는 M2에 경로가 없어 거부. 감사 기록이 디스크에 남은 뒤에만 `show`를 부르고 호출 뒤 값을 0으로 덮는다. `reveal.test.ts` |
| SEC.4 | SC-17 | 구현 | `withBrowserInput`. origin 정확 일치(대소문자와 기본 포트 표기만 같게 본다), `fill` 콜백에서만 값을 주고 호출 뒤 lease를 닫는다. `browser-input.test.ts` |
| SEC.4 | SC-18 | 구현 | SOPS `put`은 `sops set --value-stdin`일 때만 켠다(`refreshCapabilities`가 `set --help`로 판정). 값은 JSON 문자열 바이트로 stdin에만 보내고 호출 뒤 버퍼를 0으로 덮는다. `remove`는 `sops unset`(값을 받지 않는다)이라 `put` 지원과 따로 켠다. `sops-real.int.test.ts` |
| SEC.5 | SC-13, open-issues M-04 | 구현 | `age-encryption` 0.3.1을 `platform-secrets/package.json`에 연결(`bun.lock`의 워크스페이스 항목과 전이 의존 5개가 따라 들어왔다). `key/file-fallback.ts`의 `provision()`이 identity를 만들어 0600 파일로 쓰고 수신자만 돌려준다. `key-provision.test.ts` |
| SEC.5 | SC-19(Linux) | 부분 | `secret-tool` 대역과 실제 sops로 `SOPS_AGE_KEY_CMD` 구성(공백·작은따옴표가 든 경로의 shlex 인용 포함)과 복호화를 확인했다. 진짜 Secret Service 조회는 이 기기에 없어 확인하지 못했다 |

### 8.2 확인하지 못한 항목 (미확인)

| 항목 | 이유 | 확인 방법 |
|---|---|---|
| `reveal`의 `os-auth` 경로(M3b: `os-auth.ts`, macOS osascript provider와 가짜 provider 시험을 더했다. 아래는 M2 시점 기록이다) | 이 기기에 OS 인증 수단이 없다. `osAuthAvailable`은 조립 루트가 넘기는 값이고 기본은 `false`다. 서비스는 `os-auth` 증거의 시각만 검사하고, 인증이 실제로 일어났는지는 L4·L0.os가 책임진다. 시험은 `tty-confirm` 경로와 "OS 인증 가능 환경에서 `tty-confirm` 거부" 규칙까지 확인했다 | macOS·Windows·Linux 데스크톱 실기에서 L4의 OS 인증 연결 뒤 `xeon secret reveal` |
| macOS Keychain | macOS 기기 없음. 명령 구성(`security find-generic-password -s xeon.age -a default -w`)만 단위 시험이 있다. 접근 승인 대화상자 횟수(위험 표 1행)도 기록하지 못했다 | macOS 실기에서 lease 5회에 뜬 대화상자 수를 세어 기록 |
| Windows 자격 증명 관리자 | 스텁(`not_implemented`)이다. 읽기 수단은 [미결](spec §10 7번)이다 | Windows 네이티브 착수 때 |
| Linux Secret Service 실기 | `secret-tool`과 D-Bus 서비스가 없다. 대역으로 명령 인용과 sops 연동만 확인했다 | GNOME Keyring나 KWallet이 있는 Linux 데스크톱 |
| 감사 파일의 프로세스 간 동시 정리 | 정리(prune)가 파일을 다시 쓰므로, 같은 시각에 다른 프로세스가 붙인 줄이 사라질 수 있다. 같은 사용자의 CLI와 호스트가 동시에 첫 쓰기를 하는 경우에만 생긴다 | 파일 잠금을 넣을지 M3 운영 로그 설계 때 정한다 |

### 8.3 문서와 다르게 정한 점

- `add`: 제공자에 `meta.ref` 항목이 이미 있으면(예: `just secret-add`가 만든 SOPS 키) 값을 읽지 않고 메타만 붙인다(`secret.created`의 `fields`는 `["meta"]`). 계약에 "항목에 메타 붙이기" 메서드가 없어 `add`에 넣었다. 값 통로(`SecretValueSource`)는 호출되지 않는다.
- `rm`: 제공자가 지울 수 있으면 값까지 지우고(`fields`가 `["meta","value"]`), 지울 수 없으면 메타만 지운다. 항목은 `orphaned`로 남는다.
- `meta`: `use`, `approval`, `scope`, `expiresAt`가 바뀌면 활성 lease를 닫는다. 좁힌 정책이 이미 열린 lease에 적용되지 않는 틈을 없애기 위해서다. `ttlSeconds`와 `maxUses` 변경은 새 lease에만 적용한다.
- `run`: 사람이 명령을 입력한 것을 승인으로 보아 사용 정책(모드, 도구, 대상, 승인)을 건너뛰고 만료만 검사한다. `secret.used`(`mode: "env"`, `threadId: null`)는 남긴다. 자식 프로세스를 띄우지 못하면 종료 코드 127을 돌려준다. 환경 변수 이름 규칙 위반은 `invalid_ref`(`name_pattern`)로 돌려준다.
- `ls --usage`: 감사 파일에서 마지막 사용 시각만 채운다. 결정별 개수를 실을 필드가 `SecretListing`에 없어 `usage()`로 따로 센다.
- 감사 파일의 `secret.used`·`secret.denied`·`secret.approved`·`secret.masked`도 같은 파일에 쓴다(spec §3.9 제안). 이 쓰기는 대기열에 넣고 실패를 로그에만 남겨 비밀 사용 경로를 막지 않는다. `reveal`만 기록이 실패하면 값을 보이지 않는다.
- 문체: 이 문서와 `_templates/README.md`가 한다체이므로 같은 문체로 적었다.

### 8.4 다른 레인에 요청 (F 계약)

소유 경로 밖이라 고치지 않았다. 지금은 아래 대체 값으로 돌려준다.

| 요청 | 지금 대체 | 원천 |
|---|---|---|
| (해소, M2 F 레인) `SecretError`에 `audit_unwritable` 변형(감사 파일을 쓸 수 없음) | 반영됨. `auditUnavailable`이 `audit_unwritable{path, code}`를 돌려준다 | spec §3.10, §3.9 |
| (해소, M2 F 레인) `SecretError`에 "키 파일을 만들 수 없음 또는 덮어쓰기 거부" 변형 | 반영됨. `provision`이 `write_failed{target:"key_file", path, code}`를 돌려주고 덮어쓰기 거부는 `code: "EEXIST"`다 | spec §3.10, §4.7 |
| `SecretError`에 환경 변수 이름 오류 변형 | `invalid_ref`(`name_pattern`) | spec §3.10, §4.7 |
| `SecretListing`에 결정별 사용 개수(`--usage`) | 없음. `usage()`로 센다 | spec §4.9 `ls` |
| 설정 저장소의 비밀 참조 조회(`references`의 `settingKeys`) | `settingKeysFor` 주입(기본은 빈 목록) | spec §3.8 |
| 조립 루트(HOST.3)에 `createSecretsRuntime`의 `osAuthAvailable`, `settingKeysFor` 연결 | 기본값 `false`와 빈 목록 | m2-plan HOST.3 |

### 8.5 M2 첫 실행 기록 (m2r sec)

macOS 깨끗한 기기의 첫 실행에서 `xeon secret add`가 `not_registered`로 실패했다(`l0.secrets.sops.files`의 기본값이 빈 목록이라 값을 놓을 파일이 없었다). 아래로 고쳤다. 시험 환경은 WSL2(sops 3.13.3, age 1.3.2)이고 macOS 실기는 없다.

| 항목 | 내용과 시험 |
|---|---|
| SC-24 기본 파일 | `config.ts`의 `withDefaultSopsFile`이 빈 `sops.files`에 `{ env: "user", path: "<config>/secrets/sops/user.yaml" }`를 채운다. 조립(`assemble.ts`)이 모든 설정 읽기에 이 유효 설정을 쓰고, 호스트의 `newMeta`도 같은 유효 설정을 쓴다. `default-sops.test.ts` |
| SC-24 첫 파일 만들기 | `providers/sops-create.ts`가 `sops encrypt --age`로 빈 문서를 암호화해 0600 파일로 둔다. `providers/sops.ts`의 `put`이 잠금 안에서 파일이 없으면 만든다. `first-write.int.test.ts`(실제 sops와 age, 임시 홈) |
| SC-24 키와 수신자 | `key/recipient.ts`가 수신자 기록을 읽고 쓴다. `assemble.ts`의 `recipient()`가 기록 → `provision` 순으로 수신자를 얻는다. 실패 뒤 재시도, 기록 없는 키, 확인 전 파일 폴백을 `first-write.int.test.ts`가 본다 |
| SC-24 macOS `provision` | `key/darwin.ts`. `security -i` stdin으로 항목을 만든다. 가짜 `security`로 호출 순서, argv에 identity 없음, stdin 0 덮기, EEXIST, add_failed를 본다. `key-darwin-provision.test.ts`. 실기 확인은 [미결] |
| SC-24 잠금 | `providers/lock.ts`의 `SecretFileLock`을 조립 루트가 `OsServiceHandle.fileLock`으로 채운다. 없으면 프로세스 안 직렬화다. 동시 첫 `add` 두 개가 키와 파일을 하나만 만든다(`first-write.int.test.ts`). 프로세스 사이 잠금 자체의 시험은 `L0.os`가 한다 |
| 두 클라이언트 공유 | `OsDirs`가 사용자 하나에 하나라 메타, 감사 파일, 키, 기본 파일이 같다(spec §4.8). CLI용·사이드카용 두 조립이 한 비밀을 등록·교체·열람하는 시험이 `first-write.int.test.ts`에 있다 |
| 오류 정확도 | sops가 없을 때 `put` 불가를 `read_only_provider`가 아닌 `binary_missing`으로 돌려준다(`readOnlyReason`). F의 `write_failed.target`에 `key_store`, `sops_file`을 더했다 |
