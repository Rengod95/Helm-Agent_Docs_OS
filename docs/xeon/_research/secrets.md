# 에이전트 런타임 L0 비밀 관리 조사

- 작성일: 2026-10-21. 목적: L0 비밀 관리 하위 층 설계 자료 수집.
- 방법과 제약: 공식 문서를 WebFetch와 WebSearch로 확인한다. 사용자의 실제 비밀 파일과 키(`~/.config/sops`, `keys.txt`, `.env`)는 읽지 않았고, 내려받은 코드는 실행하지 않았다. 제3자 자료와 미러는 2차로 표기한다.
- 대조 자료: 내부 설계 `/home/user/projects/helm/code/helm/docs/design/18-security.md` §3.10, `17-daemon-and-operations.md` D17-07, `09-event-store.md`.
- 표기: **[원문]** 공식 문서를 직접 확인함. **[2차]** 검색 요약, 제3자 문서, 미러. **[미확인]** 확인하지 못했거나 문서에 없음. **[추측]** 조사자의 추론 또는 설계 제안.
- 출처는 [S#] 번호로 표기하며 마지막 절에 모은다.

## 0. 요약

1. 모델이 값을 아예 보지 않는 방식이 가장 강하다. Claude Code 샌드박스의 sentinel 치환과 Lightpanda의 프로세스 내 치환이 여기에 든다 [S23][S17].
2. env 주입(`op run`, `bws run`, `infisical run`, `doppler run`, `sops exec-env`)은 편리하지만, 같은 셸에서 에이전트가 `env`로 값을 읽을 수 있다. 에이전트가 제어하는 명령에는 기본값으로 쓰지 않는다.
3. 출력 마스킹은 백스톱이다. 인코딩 변형, 분할, 모델의 재인코딩으로 우회된 사례가 보고되어 있다 [S28][S30].
4. SOPS는 키 이름이 평문이라 복호화 없이 키 목록을 볼 수 있다 [2차 S43]. age 키는 `SOPS_AGE_KEY_CMD`로 키체인이나 1Password에서 받을 수 있다 [S15].
5. 사용 이력은 Infisical 감사 로그, Doppler 비밀별 접근 로그, 1Password Events API가 제공한다. SOPS 파일 단독으로는 사용 이력이 없다 [추측].
6. 기존 helm 설계(18 §3.10)는 "도구 프로세스에 비밀을 주지 않는다"를 원칙으로 둔다. 사용자 요구(에이전트가 API 호출, 배포, 로그인에 자연스럽게 쓴다)와 충돌하므로 경계 치환 모드를 추가해야 한다.

## 1. 값을 노출하지 않고 비밀을 쓰는 패턴

### 1.1 CLI 주입기

| 도구 | 주입 방식 | 값 노출 통제 | 출력 마스킹 | 관리 명령 | 출처 |
|---|---|---|---|---|---|
| 1Password `op run` | `op://` 참조가 든 env를 실행 시점에 치환하고 자식 프로세스에만 전달한다. "only for the duration of the process" | 참조 자체는 값이 아니다. `--environment`, `--env-file` 지원 | 기본으로 가린다. `--no-masking`으로 끈다 [원문] | `op item` list, get, create, edit, delete | [S1][S2][S3] |
| Bitwarden `bws run` | `bws run -- '<cmd>'`. `--project-id`로 범위를 제한하고 `--no-inherit-env`는 PATH만 남긴다 | 머신 계정이 접근 가능한 비밀로 제한 [원문] | 문서에 언급 없음 [미확인] | `bws secret` create, get, list, edit, delete | [S6] |
| Infisical `infisical run` | 프로젝트 비밀을 env로 주입한다. 셸 변수보다 우선한다. HOME, PATH, SHELL, XDG_*, LC_*는 제외한다 [원문] | 문서에 명시 없음 | `secrets set` 결과 표만 기본으로 가린다. `run` 출력은 [미확인] | `infisical sm` get, set, delete, `--show-values` | [S8][S9] |
| Doppler `doppler run` | 비밀을 "as environment variables into the running process"로 주입한다 [원문] | 대시보드 가시성 Masked와 Restricted [2차 S13] | 확인 실패 [미확인] | `doppler secrets` get, set, download [원문 일부] | [S11][S13] |
| `sops exec-env` | `sops exec-env <파일> '<cmd>'`. 복호화 내용을 자식 env로 준다 | 디스크에 쓰지 않는다는 것이 문서의 사용 사례다 [원문] | 문서에 없음 [미확인] | sops 자체에 관리 UI 없음 | [S14] |
| `sops exec-file` | 기본은 FIFO로 전달한다. `--no-fifo`일 때만 임시 파일을 쓴다. `--user`로 권한을 낮춘다 [원문] | 기본은 메모리 경유 | 없음 | 동일 | [S14] |

### 1.2 브라우저와 에이전트의 치환

| 도구 | 참조 형식 | 치환 위치 | 모델에 값이 가나 | 도메인 제한 | 출처 |
|---|---|---|---|---|---|
| Lightpanda | `$LP_*` 환경 변수. fill에서 `value='$LP_HN_USERNAME'`처럼 쓴다 | 브라우저 서브프로세스 내부 | 가지 않는다 [원문] | 문서에 없음 [미확인]. `getEnv`는 `LP_` 접두사만 허용 [원문] | [S17] |
| Stagehand | `%name%`, `agent.execute({variables})`. 모델에는 이름과 설명만 보인다 | act, type, fillForm 도구 실행 직전 | 설명상 가지 않는다. PR 병합 [원문], 실험 플래그 필요 [2차] | 확인 실패 [미확인] | [S18][S41] |
| Skyvern | 볼트 연동 플레이스홀더. 필드 입력 때만 실제 값으로 바뀐다 | 자동화 계층 | "placeholders, not your values" [원문] | 문서에 도메인 제한 기능이 없다고 나온다 [원문]. "Mask Secrets"는 옵션 [원문]. CredentialReleaseGuard는 확인 실패 [미확인] | [S19] |
| Playwright MCP | `--secrets <dotenv>`, `PLAYWRIGHT_MCP_SECRETS_FILE` | 도구 응답의 평문을 치환한다 | 응답 쪽 평문은 가려진다. 입력 치환 문서는 없다 | "not a security boundary" [원문] | [S20] |
| scout `{{secret:handle}}` | - | - | - | 확인 실패. 검색된 Scout 계열 프로젝트에 해당 문법이 없다 [미확인] | - |

### 1.3 에이전트 런타임의 env 정책

| 런타임 | 정책 | 근거 | 출처 |
|---|---|---|---|
| Claude Code 설정 | 세션 `env`는 설정 키다. 프로젝트 설정의 `env`는 폴더 신뢰 뒤에만 적용된다. `deny` 규칙은 즉시 적용된다 [원문] | 설정 문서 | [S21] |
| Claude Code 샌드박스 | 기본으로 Claude Code 프로세스의 env를 상속한다. 표에 "including any secrets in its environment"라고 적혀 있다 [원문] | 샌드박스 문서 | [S23] |
| Claude Code `credentials.envVars` | `deny`는 명령 실행 전에 변수를 unset한다. `mask`는 sentinel을 주고, 프록시가 `injectHosts`로 허용된 호스트에만 실제 값을 넣는다. TLS 종단이 필요하다 [원문] | 샌드박스 문서 | [S23] |
| Claude Code `credentials.files` | `deny`는 샌드박스 안의 읽기를 막는다. 프로젝트·로컬 설정의 항목은 무시한다(v2.1.246 이상). mask와 tlsTerminate는 사용자, 관리, `--settings`에서만 받는다 [원문] | 샌드박스 문서 | [S23] |
| Codex | `shell_environment_policy`의 `inherit`은 none, core, all을 받는다. all은 이 문서에 설명이 없다. `ignore_default_excludes`의 기본값은 true이므로 KEY, SECRET, TOKEN 자동 제외가 꺼져 있다. 적용 순서는 자동 제외, 사용자 제외, set, include 허용 목록이다 [원문] | 설정 문서 | [S24] |
| opencode | 셸은 `SHELL` 또는 `/bin/bash`이고 프로세스 env를 상속한다. `.env` 읽기를 거부하는 설정 예가 있다 | 구버전 문서와 제3자 가이드 | [S26] [2차] |
| Goose | macOS 키체인(항목 "goose"), Linux 키링, Windows 자격 증명 관리자, 파일 폴백 `~/.config/goose/secrets.yaml`. `GOOSE_DISABLE_KEYRING=1`로 파일을 강제한다. Windows 키링 신뢰성은 자료마다 다르다 | 미러 문서 | [S25] [2차] |

### 1.4 패턴 분류

| 패턴 | 예 | 모델이 값을 보나 | 자식 프로세스 env에 값이 있나 | 주된 한계 |
|---|---|---|---|---|
| A. 환경 주입 | op run, bws run, infisical run, sops exec-env, Codex와 Claude Code env | 명령으로 `env`를 출력하면 본다 | 있다 | 같은 셸의 모든 명령이 읽을 수 있다 |
| B. 프로세스 내 치환 | Lightpanda | 보지 않는다 | 없다 | 브라우저 도구에 한정된다 |
| C. 경계 치환(sentinel과 프록시) | Claude Code `credentials.envVars` mask | sentinel만 본다 | sentinel만 있다 | HTTP에 한정, TLS 종단과 호스트 목록이 필요하다 |
| D. 플레이스홀더 후 입력 | Skyvern, Stagehand | 플레이스홀더만 본다 | 해당 없음 | 입력한 값이 이후 스크린샷에 남을 수 있다 [원문] |
| E. 응답 후 치환 | Playwright MCP `--secrets` | 응답의 평문을 보지 않는다 | 있다 | 보안 기능이 아니다 [원문] |

## 2. 위협과 대응

### 2.1 유출 경로

| 경로 | 예 | 1차 대응 | 남는 문제 |
|---|---|---|---|
| 환경 출력 | `env`, `printenv`, `echo $TOKEN` | 에이전트 셸 env에 값을 두지 않는다(C 패턴). env 주입은 명령 단위로만 한다 | Bash 권한 규칙은 경계가 아니다. 명령 형태를 바꾸면 우회된다 [원문 S22] |
| 파일 읽기 | `cat .env`, `cat secrets/*.yaml` | Read 거부 규칙, 샌드박스 denyRead | Read 거부는 `grep -r`처럼 파일명을 적지 않는 명령에는 적용되지 않는다 [원문 S22] |
| 프로세스 환경 | `/proc/<pid>/environ`, `ps auxe` | 같은 uid 프로세스의 env는 노출된다고 가정한다. `ps`의 env 출력 옵션은 승인을 받는다 [원문 S22] | OS 한계다. 같은 uid는 막을 수 없다 |
| 셸 기록 | `secret add x <값>` | 값은 argv로 받지 않고 stdin이나 파일로 받는다 | Infisical도 셸 기록에 값이 남는다고 경고한다 [원문 S9] |
| 디버그와 로그 출력 | 스택 트레이스, `curl -v`의 Authorization 헤더 | 로그 출력 직전 마스킹 | 아래 2.3 참조 |
| 모델 컨텍스트 | 도구 결과가 다음 턴의 투영에 들어감 | 투영 전 마스킹, 정본 기록 전 치환 [원문 S28] | 과거 기록에 이미 남은 값 |
| 인코딩 우회 | base64나 URL 인코딩 후 출력 | 등록 값의 인코딩 변형을 함께 등록 | 임의 변형은 막지 못한다 |
| 외부 전송 | 허용되지 않은 호스트로 POST. 외부 채널은 여러 가지다 [2차 S31] | 도메인 바인딩(C 패턴, M3 모드) | 허용 호스트가 값을 에코하는 경우 |
| 프롬프트 주입 | 외부 문서가 "비밀을 출력하라"고 지시 | 비밀별 승인과 허용 도구 제한 | 승인 피로 [추측] |

### 2.2 대응 비교

| 대응 | 막는 것 | 못 막는 것 | 설계상 역할 |
|---|---|---|---|
| 출력 마스킹, 정확 일치 | 실수로 출력된 원문 | 변형된 값 | 백스톱 |
| 출력 마스킹, 인코딩 변형 | base64, URL, hex, JSON 이스케이프 형태 | 분할과 재인코딩 | 백스톱 |
| 명령 단위 주입 | 세션 전체에 env가 퍼지는 것 | 명령 내부의 env 출력 | 허용된 명령에만 |
| 승인 | 무단 사용 | 승인된 명령 안의 남용 | 비밀별 정책 |
| 도메인 바인딩 | 엉뚱한 호스트로의 전송 | 허용 호스트의 에코 응답, 비HTTP 프로토콜 | sentinel 주입 호스트, M3 호스트 목록 |
| 값 미노출(sentinel, 플레이스홀더) | 모델, 로그, 기록에 값이 가는 것 | 자식 프로세스가 실제 값을 직접 쓰는 경우 | 기본 모드 |

### 2.3 마스킹의 한계

- 정확 일치 마스킹은 base64, URL 인코딩, 공백 분할에 뚫린다. GitHub Actions의 `add-mask`는 공백으로 나뉜 단어를 `*`로 바꾸고, 출력 전에 등록해야 한다고만 명시한다. 인코딩 변형은 문서에 없다 [원문 S27].
- NVIDIA OpenShell 연구는 네트워크 쪽 치환만으로는 부족하다고 보고한다. 네 모델 모두 도구로 세션 기록을 읽어 값을 재인코딩해 유출했다. 기록 자체를 입력 시점에 치환하면 복구가 불가능했다 [원문 S28].
- Cursor 포럼 보고는 값을 비인접 바이트로 나눠 쓰면 리터럴 필터를 통과한다고 전한다. 벤더는 알려진 한계로 인정했다 [2차 S30].
- PRISM은 생성 시점 탐지를 제안하며 자체 벤치마크에서 F1 0.832, 재현율 0.712를 보고한다. 재현율로 보면 약 29%의 누출이 잡히지 않는다 [추측: 재현율로부터 계산, 원문 S29].
- 결론: 마스킹은 값이 모델에 가지 않도록 설계한 뒤의 백스톱으로만 둔다. 보장은 치환 경계 설계에서 나온다.

## 3. SOPS와 age

### 3.1 파일 구조와 키 목록

| 항목 | 내용 | 확인도 |
|---|---|---|
| 값만 암호화하고 키 이름은 평문 | 여러 2차 자료가 같은 내용을 전한다. 공식 README는 직접 확인하지 못했다 | [2차 S43], 공식 원문 [미확인] |
| 복호화 없이 키 목록 보기 | 키 이름이 평문이므로 파일을 파싱하면 된다 | [추측] |
| 메타데이터 블록 | `sops:` 블록에 수신자 공개키, MAC, 수정 시각이 들어간다 | [추측] |
| 부분 암호화 옵션 | `encrypted_regex`, `unencrypted_regex` | [2차 S43] |

### 3.2 age 키 보관 방법

| 방법 | 설정 | 확인도 | 출처 |
|---|---|---|---|
| 기본 파일 | Linux는 `$XDG_CONFIG_HOME/sops/age/keys.txt`, macOS는 `~/Library/Application Support/sops/age/keys.txt` | [원문] | [S15] |
| 파일 지정 | `SOPS_AGE_KEY_FILE` | [원문] | [S15] |
| 값 직접 지정 | `SOPS_AGE_KEY`. 자식 프로세스에 노출될 위험이 있다 | [원문] 위험은 [추측] | [S15] |
| 명령 출력 | `SOPS_AGE_KEY_CMD`가 키를 출력한다. 수신자는 `SOPS_AGE_RECIPIENT`로 전달된다. SOPS 3.10.0 이상이 필요하다 | [원문], 버전은 [2차] | [S15][S37] |
| SSH 키 | `SOPS_AGE_SSH_PRIVATE_KEY_FILE`, `SOPS_AGE_SSH_PRIVATE_KEY_CMD`, `~/.ssh/id_ed25519` | [원문] | [S15] |
| YubiKey 플러그인 | age-plugin-yubikey가 공식 플러그인 목록에 있다고 전한다. SOPS 이슈에 `age1yubikey` 거부 보고가 있다 | [2차] | [S35][S38] |
| Secure Enclave 플러그인 | age-plugin-se. 키 생성과 복호화에 Secure Enclave가 있는 Mac이 필요하다. 암호화는 Linux와 Windows에서도 된다 | [2차]. SOPS 연동은 [미확인] | [S34] |
| 분할 키 플러그인 | age-plugin-sss는 초안 스펙이며 실험 단계다 | [2차] | [S36] |

- 설계 시사점: 키 획득은 런타임의 부모 프로세스에서만 한다. 도구의 자식 env에는 `SOPS_AGE_*`를 넘기지 않는다 [추측].

### 3.3 실행 방식과 Node 구현

- 바이너리 호출이 일반적이다. `sops exec-env`가 공식 경로이고, 제3자 래퍼로 sops-run(Python), secenv(Go), env-sops(npm)가 있다 [2차 S39].
- Node에서 쓸 수 있는 구현은 아래와 같다.

| 패키지 | 역할 | 확인 상태 | 출처 |
|---|---|---|---|
| sops-age (npm, 3.0.0) | SOPS의 .env, .json, .yaml 복호화. `decryptSops(경로 또는 URL, age 비밀 키)`. Node, 브라우저, Deno, Bun | npm 목록 요약 [2차]. 관리 주체와 감사 여부는 미확인 | [S32] |
| age-encryption (typage, JSR `@age/age-encryption`) | age 형식의 암복호화. Node 20 이상 | 저수준 빌딩 블록. SOPS 연동 없음 [2차] | [S33] |

- 권장: `sops` 바이너리를 부모 런타임이 호출한다. 메타데이터, KMS, PGP까지 지원 범위가 넓다 [추측]. 순수 Node 구현은 age 전용 최소 기능에만 검토한다 [추측].

## 4. 관리 UX 사례

### 4.1 기능 비교

| 제품 | 목록 | 추가 | 조회 | 수정 | 삭제 | 회전 | 출처 |
|---|---|---|---|---|---|---|---|
| 1Password `op item` | list(태그, 범주, 볼트 필터. 아카이브 기본 제외) | create(대입문 또는 JSON 템플릿) | get(`--fields`), 값은 `op read` | edit(제목, 태그, 비밀번호 생성) | delete(30일 휴지통, `--archive`) | 전용 명령 없음 [미확인] | [S3][S4] |
| 1Password 공유 | share 링크 | - | 기본 7일 후 만료(`--expires-in`) | - | - | - | [S4] |
| Bitwarden `bw` | list(폴더, 컬렉션, 조직 필터) | create(인코딩한 JSON) | get item, password, notes | edit(JSON 전체 교체) | delete(30일 휴지통, `--permanent`) | [미확인] | [S7] |
| Bitwarden `bws` | list(프로젝트 필터) | create(`--note` 포함) | get | edit(key, value, note, project) | delete(여러 ID) | [미확인] | [S6] |
| Infisical `sm` | list(환경 옵션) | set(없으면 생성) | get(없으면 `*not found*`) | set | delete(`--type`으로 개인/공유 구분) | 문서에 회전 없음. 동적 비밀은 리스 단위이며 갱신과 조기 삭제가 가능하다 [원문 S8] | [S9][S10] |
| Doppler | `secrets` 목록 | set(설정 가이드) | get(`--plain`), download | set | [미확인] | [미확인] | [S11] |
| macOS 키체인 | `find-generic-password`(단건) | `add-generic-password -a -s -w -j -l -U -A` | `find-generic-password -w`, `-g`(속성 포함) | `-U`로 갱신 | `delete-generic-password`(플래그 미확인) | 없음 | [S40] [2차] |
| Goose | 키링과 파일 저장소 | `goose configure` | [미확인] | [미확인] | [미확인] | 없음 | [S25] [2차] |

### 4.2 메타데이터와 사용 이력

| 항목 | 1Password | Bitwarden | Infisical | Doppler | 키체인 | 우리 설계 |
|---|---|---|---|---|---|---|
| 설명 | 태그, 범주 | 메모(notes), 폴더 | 댓글(예시 파일 명령에 표시) [원문] | [미확인] | `-j` 댓글, `-l` 라벨 | 필수 필드 |
| 범위 | 볼트 | 폴더, 컬렉션, 조직 | 환경, 경로, 개인/공유 | 프로젝트, 설정 | 접근 허용 목록(`-T`) [2차] | 프로젝트와 세션 |
| 만료 | 공유 링크 7일 기본 | [미확인] | 동적 비밀 리스(갱신과 조기 삭제 가능) | [미확인] | 없음 | 필수, 정책의 ttl |
| 사용 이력 | Events API item usage: 사용자, IP, 시각, 볼트. 120일 보존, Business 계정 필요 [2차 S5] | [미확인] | 감사 로그: get-secret, reveal-secret 등. 행위자, IP, 시각. append-only. 보존 기간은 요금제별 [원문 S10] | 비밀별 접근 로그: 행위자, 방식, 최초와 최근 읽기 시각 [2차 S12]. 값이 응답에 실제로 실릴 때만 기록 | 없음 | 필수 |


## 5. 기존 helm 설계와의 대조

| 항목 | 기존 설계(18 §3.10, 17 D17-07) | 이번 조사의 시사점 | 판정 |
|---|---|---|---|
| 원본 | `prod.sops.yaml` 하나. 서버에 별도 비밀 저장소를 두지 않는다. 클라이언트는 OS 키체인 | SOPS와 키체인 연동이 가능하다 [S15] | 일치 |
| 실행 중 위치 | 데몬 메모리의 SecretStore. 자식 로더 `secrets run`으로 받는다 | `sops exec-env`는 env로 준다. 메모리 보관은 별도 설계다 | 일치 |
| 도구 프로세스 | 비밀을 주지 않는다(§3.10.2). 사용자 작업에 비밀이 필요하면 needs-human | 사용자 요구는 에이전트가 자연스럽게 쓰는 것이다. 원칙과 충돌한다 | 충돌. M2, M3, M4 모드 추가 필요 |
| 마스킹 지점 | 입력, 도구 결과, 모델 응답, 로그 등 9곳(§3.10.3) | 정본 기록 전 치환이 핵심이다 [S28] | 일치. 기록 전 치환을 명시 |
| 알려진 값 마스킹 | base64와 URL 형태 포함(§3.10.4) | 분할과 재인코딩 한계를 명시해야 한다 | 보완 |
| 비밀 사용 이벤트 | 없음. `secrets.reloaded`(이름만)뿐이다 [원문 09] | 비밀 사용 감사가 필요하다 | 보완 |
| 비밀별 정책 | 없음. 도구 허용 목록과 needs-human뿐이다 | 도구, 호스트, 승인 정책이 필요하다 | 보완 |
| 같은 uid 위협 | age 키로 원본을 복호화할 수 있다(T-H2) | 같은 한계이고 env 노출도 같은 위협이다 | 일치 |

- 사용자 메모리에 따르면 2026-10-19 제품 방향이 대화형 런타임 앱으로 바뀌었다. helm 설계의 데몬(helmd) 전제는 재검토 대상이다 [추측].

## 6. 설계 초안: L0 비밀 하위 층

### 6.1 비밀 참조 형식

- 핸들은 `secret://<name>`이다. name은 `[a-z][a-z0-9-]{1,63}`을 따른다. 예: `secret://github-token`.
- 모델은 핸들만 다룬다. 핸들은 값이 아니므로 대화, 이벤트, 로그에 남아도 된다.
- 핸들과 제공자 참조의 매핑은 값 없는 평문 메타 파일에 둔다. 예: `github-token`은 `sops:prod/GITHUB_TOKEN`.
- `$VAR`, `%key%`, `{{secret:...}}` 같은 다른 형식은 입력 단계에서 거부한다 [추측].

### 6.2 주입 시점

- 원칙: 도구 실행 직전, 해당 ExecutionEnv를 만드는 단계에서만 해석한다. 정책 검사 뒤에 한 번 더 확인한다(검사와 사용 사이의 간극 방지) [추측].
- lease 객체는 값을 가지며 TTL과 사용 횟수 제한을 둔다. 명령이 끝나면 폐기한다.
- 값은 부모 런타임 프로세스의 메모리에만 둔다. 모델 컨텍스트, 이벤트 저장소, 도구 자식 env의 기본값에는 두지 않는다.

| 모드 | 대상 | 모델과 셸에 보이는 것 | 실제 값의 위치 | 통제 수단 |
|---|---|---|---|---|
| M1 env | 허용된 CLI 명령(`gh`, `kubectl` 등) | 값(자식 env) | 자식 프로세스 env | 명령 패턴, 승인, 출력 마스킹 |
| M2 sentinel | HTTPS 토큰을 쓰는 CLI와 도구 | sentinel 문자열 | 런타임 프록시 메모리 | 호스트 바인딩, TLS 종단 |
| M3 런타임 HTTP | 런타임 내장 HTTP 도구 | 핸들 | 전송 직전 헤더와 본문에서 치환 | 호스트 바인딩, 응답 에코 검사 |
| M4 브라우저 입력 | 로그인 폼 | 핸들 | 드라이버가 입력할 때만 | origin 바인딩, 스크린샷 마스킹 |

- 기본값은 M3(HTTP)와 M2(HTTPS 토큰 CLI)다. M1은 승인과 명령 패턴이 있을 때만 쓴다. M1은 에이전트 셸이 값을 에코할 수 있어 가장 약하다 [추측].

### 6.3 마스킹 계층 위치

| 순서 | 위치 | 대상 | 시점 |
|---|---|---|---|
| 1 | 사람 입력 | 답, 메모, 붙여넣기 | 커널 입력 전. 해시 체인에 들어가면 지울 수 없다 |
| 2 | 도구 결과 | stdout, stderr, 구조화 결과, blob | 정본과 blob 저장 전 |
| 3 | 외부 전송 | 웹 검색 질의, 제공자 호출 | 호출 전 |
| 4 | 모델 투영 | 컨텍스트 구성 | 투영 생성 때 한 번 더 |
| 5 | 운영 로그 | 로거 훅 | 출력 직전 |

- 등록 대상은 알려진 값(길이 8 이상)의 원문, base64, URL, hex, JSON 이스케이프 형태다.
- 한계: 분할과 임의 변형은 잡지 못한다. 그래서 M2, M3, M4는 값이 모델에 들어오는 경로 자체를 없앤다. 마스킹은 보장이 아니라 보조다.

### 6.4 비밀별 사용 정책

```yaml
# 메타 파일(값 없음, 평문 저장 가능)
name: github-token
desc: "GitHub API 토큰(이슈, PR 조회, 배포 워크플로)"
provider: sops            # sops | op | bws | keychain
ref: prod/GITHUB_TOKEN
scope: project:helm
expiresAt: 2027-01-31
use:
  modes: [M2, M3]         # M1은 별도 명시가 있을 때만
  tools: [http.request, bash:gh]
  hosts: [api.github.com] # 주입 가능 호스트(도메인 바인딩)
  commands: ["gh api *"]  # M1일 때만 적용
approval: per-session     # never | per-session | per-use
ttlSeconds: 900
maxUses: 200
```

- 읽기 전용 호스트는 per-session 승인이 기본이다. 배포와 쓰기 호스트는 per-use다 [추측].
- 승인 없는 M1은 금지한다. 허용 호스트에 없는 주입은 실패하고 `secret.denied`를 남긴다.

### 6.5 사용 감사 로그

| 이벤트 | 필드 | 값 포함 |
|---|---|---|
| `secret.used` | handle, mode, toolCallId, host 또는 명령 해시, decision, leaseId, ts | 없음 |
| `secret.denied` | handle, 사유 코드(host_mismatch, approval_missing, expired), tool | 없음 |
| `secret.approved` | handle, scope, 승인자(사람), expiresAt | 없음 |
| `secret.created`, `secret.updated`, `secret.deleted`, `secret.rotated` | handle, 바뀐 필드 이름, actor | 없음. 값의 해시도 남기지 않는다 [추측] |
| `secret.revealed` | handle, 재인증 여부, actor | 없음. 사람 전용 |
| `secret.masked` | handle 또는 kind, count | 없음. helm의 `maskedSecrets`와 맞춘다 |


### 6.6 관리 명령

| 명령 | 동작 | 값 입력 | 비고 |
|---|---|---|---|
| `secret ls [--meta]` | 목록. 값은 없다 | 없음 | 마지막 사용과 만료 열. `--usage`로 감사 로그 조회 |
| `secret add <name> --provider sops --desc --hosts --expires` | 생성 | stdin 또는 프롬프트. argv 금지 | 사용자 전역 규칙에 따라 `just secret-add <키> [env]` 레시피와 연결 |
| `secret set <name>` | 값 교체 | stdin | 이력 기록 |
| `secret meta <name> --desc --scope --expires --hosts` | 메타 수정 | 없음 | 값과 무관 |
| `secret rotate <name>` | 새 값으로 교체하고 기존 lease를 폐기 | 사람이 입력 | 에이전트는 생성과 열람을 하지 않는다(helm 3.10.5와 맞춘다) |
| `secret rm <name>` | 삭제. 참조하는 정책을 보여준 뒤 확인 | 없음 | 사용 중이면 거부 |
| `secret test <name>` | 존재와 복호화 가능 여부 | 없음 | 값 대신 길이와 해시 앞 8자만 출력 |
| `secret run -- <cmd>` | 사람이 직접 실행할 때만 M1 주입 | 없음 | `sops exec-env`에 대응 |

### 6.7 UI 항목

| 화면 요소 | 내용 | 비고 |
|---|---|---|
| 목록 | 이름, 제공자, 설명, 범위, 허용 호스트, 마지막 사용, 만료, 상태(유효, 임박, 폐기) | 값 열 없음 |
| 추가 | 이름, 제공자, 설명, 범위, 호스트, 만료, 승인 정책 | 값 입력란은 가린다 |
| 값 보기 | 재인증 뒤 한 번 표시하고 자동으로 숨긴다 | `secret.revealed`를 남긴다. 사람 전용 |
| 메타 편집 | 설명, 범위, 만료, 호스트 | 값 교체는 별도 "회전" 동작 |
| 사용 이력 | 감사 로그 목록 | 도구, 호스트, 결정별 필터 |
| 정책 편집 | 허용 도구, 호스트, 모드, 승인 | 기본은 거부 |
| 삭제 | 참조하는 정책과 세션을 보여준 뒤 확인 | 사용 중이면 거부 |
| 승인 요청 | "무엇에, 어느 호스트에, 몇 분간" | 승인 근거를 기록 |

### 6.8 제공자 교체 구조

```ts
interface SecretProvider {
  readonly id: "sops" | "op" | "bws" | "keychain";
  capabilities(): { list: boolean; put: boolean; remove: boolean; usage: boolean };
  list(): Promise<SecretMeta[]>;                          // 값 없음
  lease(ref: string, ctx: UseCtx): Promise<SecretLease>;  // 값은 lease 안에만
  put?(ref: string, value: Uint8Array): Promise<void>;
  remove?(ref: string): Promise<void>;
}
```

| 제공자 | 목록 | lease 방법 | 쓰기 | 사용 이력 |
|---|---|---|---|---|
| sops (기본) | YAML 키 파싱. 복호화 불필요 [추측] | 부모 프로세스에서 복호화. 키는 파일 또는 `SOPS_AGE_KEY_CMD` | sops 편집 명령 [추측] | 자체 로그 |
| op | `op item list` | `op read` | `op item create`, `op item delete` | Events API로 보강 |
| bws | `bws secret list` | `bws secret get` | create, delete | 미확인. 자체 로그 |
| keychain | `security` 조회 | `find-generic-password -w` | `add-generic-password`, `delete-generic-password` | 없음. 자체 로그 |

- lease 호출은 부모 런타임 프로세스에서만 한다. 자식 env에 `OP_*`, `SOPS_AGE_*`, 제공자 토큰을 넘기지 않는다 [추측].

## 7. 미확인 항목과 다음 조사

- scout `{{secret:handle}}`, Skyvern `CredentialReleaseGuard`, Stagehand `variables`의 실험 플래그 현재 상태는 공식 문서와 소스를 찾지 못했다. 확인이 필요하다.
- bws run, Infisical run, Doppler run의 출력 마스킹은 문서로 확인하지 못했다. 가짜 값으로 실험하면 확인할 수 있다.
- SOPS 공식 README의 값 암호화 문장, key_groups, shamir_threshold, `op item get --reveal`의 동작, Bitwarden과 Doppler의 회전 기능은 직접 확인하지 못했다.
- age-plugin-se, age-plugin-yubikey와 SOPS의 실제 연동은 검증하지 않았다.
- Claude Code 샌드박스 구조는 참고만 한다. 우리 런타임의 HTTP 도구에 맞는지 설계로 검증해야 한다.
- 작업 환경 메모: `/home/user/projects/helm`에 justfile이 없어 사용자 전역 규칙의 `just verify`는 실행하지 못했다. 이 조사는 프로젝트 파일을 바꾸지 않았다.

## 8. 출처

- [S1] 1Password `op run` 가이드 https://www.1password.dev/cli/secrets-environment-variables/ (구 developer.1password.com에서 301 이동)
- [S2] 1Password 비밀 참조 https://www.1password.dev/cli/secret-references/
- [S3] `op run` 명령 레퍼런스 https://www.1password.dev/cli/reference/commands/run
- [S4] `op item` 레퍼런스 https://www.1password.dev/cli/reference/management-commands/item
- [S5] 1Password Events API https://developer.1password.com/docs/events-api/reference [2차 검색 확인]
- [S6] Bitwarden Secrets Manager CLI https://bitwarden.com/help/secrets-manager-cli/
- [S7] Bitwarden CLI https://bitwarden.com/help/cli/
- [S8] Infisical `run` https://infisical.com/docs/cli/commands/run
- [S9] Infisical `sm` 비밀 명령 https://infisical.com/docs/cli/commands/secrets
- [S10] Infisical 감사 로그 https://infisical.com/docs/documentation/platform/audit-logs
- [S11] Doppler CLI https://docs.doppler.com/docs/cli
- [S12] Doppler 접근 로그 https://docs.doppler.com/docs/access-logs [2차]
- [S13] Doppler 가시성 https://docs.doppler.com/docs/visibility-types [2차]
- [S14] SOPS 고급 사용법 https://getsops.io/docs/usage/advanced/
- [S15] SOPS age 식별자 https://getsops.io/docs/usage/identities/age/
- [S16] SOPS 문서 https://www.getsops.io/docs/ , 저장소 https://github.com/getsops/sops
- [S17] Lightpanda 에이전트 튜토리얼 https://lightpanda.io/docs/guides/lightpanda-agent-tutorial
- [S18] Stagehand PR #1580 https://github.com/browserbase/stagehand/pull/1580 (미러 https://cubic.dev/pr/browserbase/stagehand/pull/1580)
- [S19] Skyvern 자격 증명 개요 https://www.skyvern.com/docs/cloud/managing-credentials/credentials-overview
- [S20] Playwright MCP https://github.com/microsoft/playwright-mcp
- [S21] Claude Code 설정 https://code.claude.com/docs/en/settings
- [S22] Claude Code 권한 https://code.claude.com/docs/en/permissions
- [S23] Claude Code 샌드박스 https://code.claude.com/docs/en/sandboxing
- [S24] Codex 고급 설정 https://learn.chatgpt.com/docs/config-file/config-advanced (구 developers.openai.com/codex/config-advanced에서 308 이동)
- [S25] Goose FAQ https://mintlify.com/block/goose/troubleshooting/faq [2차 미러], 설정 https://mintlify.com/block/goose/configuration [2차]
- [S26] opencode 권한 가이드 https://developers.intility.com/docs/internal/ai/opencode-permissions/ [2차], 셸 설정 https://www.mintlify.com/opencode-ai/opencode/advanced/shell-configuration [2차, 구버전]
- [S27] GitHub 워크플로 명령 https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands
- [S28] NVIDIA OpenShell 연구 노트 https://nvidia.github.io/OpenShell-Research/dev-notes/posts/2026-09-26-network-redaction-is-not-enough/
- [S29] PRISM https://arxiv.org/abs/2605.10614
- [S30] Cursor 포럼 https://forum.cursor.com/t/agent-was-able-to-print-runtime-secret/161553 [2차]
- [S31] DZone, 코딩 에이전트의 유출 경로 https://dzone.com/articles/ways-your-ai-coding-agent-exfiltrates-secrets [2차]
- [S32] sops-age (npm) https://npmjs.com/package/sops-age [2차]
- [S33] typage https://github.com/FiloSottile/typage , JSR https://jsr.io/@age/age-encryption [2차]
- [S34] age-plugin-se https://github.com/remko/age-plugin-se , Homebrew https://formulae.brew.sh/formula/age-plugin-se [2차]
- [S35] Clan의 age 플러그인 가이드 https://clan.lol/docs/26.05/guides/vars/sops/age-plugins [2차]
- [S36] age-plugin-sss 스펙 https://github.com/olastor/age-plugin-sss/blob/main/SPEC.md [2차]
- [S37] Ansible community.sops https://docs.ansible.com/projects/ansible/13/collections/community/sops/sops_encrypt_module.html [2차]
- [S38] clan-core 이슈 #6799 https://git.clan.lol/clan/clan-core/issues/6799 [2차]
- [S39] sops-run https://awesome.ecosyste.ms/projects/github.com%2Fbelthesar%2Fsops-run , secenv https://pkg.go.dev/go.spiff.io/secenv , env-sops https://npmjs.com/package/env-sops [2차]
- [S40] macOS security 명령 해설 https://daleseo.com/mac-security/ [2차]. man 페이지 미러 https://git.saurik.com/apple/security.git/blob/HEAD:/SecurityTool/macOS/security.1 는 503으로 확인 실패
- [S41] Stagehand 프롬프트 가이드 https://docs.stagehand.dev/v4/best-practices/prompting-best-practices [2차]
- [S42] 내부 설계 `/home/user/projects/helm/code/helm/docs/design/18-security.md` §3.10, `17-daemon-and-operations.md` D17-07, `09-event-store.md`
- [S43] SOPS 부분 암호화 설명 https://docs.opencenter.cloud/docs/gitops-config/secrets-sops-ref [2차]
