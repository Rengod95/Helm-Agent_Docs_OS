---
id: eng.operations.data-privacy
layer: eng
domain: operations
kind: guide
status: draft
depends_on: [architecture.security.spec, F.records.spec, F.wire-settings.spec, X.loading-trust.spec, L0.os.spec, L0.store.spec, L0.secrets.spec, L0.exec.spec, L0.sandbox.spec, L0.process.spec, L1.persistence.spec, L1.context.spec, L1.models.spec, L2.web.spec, L2.schedule.spec, L2.knowledge.spec, L4.cli.spec, L4.host-service.spec, adr.0004, adr.0005, adr.0011, adr.0019, eng.operations.recovery, eng.operations.runbook]
binds: []
---

# 데이터와 개인정보

이 문서는 Xeon이 사용자 기기에 무엇을 저장하고, 무엇을 밖으로 보내며, 얼마나 두고, 어떻게 지우는지 정리합니다. 디렉터리와 파일 이름, 설정 키, 명령은 소스와 스펙에서 확인했습니다. 확인하지 못한 항목은 `[미결]`로 표시하고 문서 끝에 모았습니다.

이 문서는 법적 고지나 개인정보 처리방침을 대신하지 않습니다. 기본 설정을 기준으로 적었습니다. 설정을 바꾸면 결과가 달라질 수 있습니다.

## 1. 저장 위치

### 1.1 디렉터리

Xeon은 `OsDirs`의 다섯 디렉터리를 씁니다. 값은 `L0.os.spec` §3.2와 `xeon/packages/platform-os/src/dirs.ts`에서 가져왔습니다. `~`는 홈 디렉터리입니다.

| 디렉터리 | macOS | Linux(WSL2 포함) |
|---|---|---|
| data | `~/Library/Application Support/xeon` | `${XDG_DATA_HOME:-~/.local/share}/xeon` |
| config | `~/Library/Application Support/xeon/config` | `${XDG_CONFIG_HOME:-~/.config}/xeon` |
| state | `~/Library/Application Support/xeon/state` | `${XDG_STATE_HOME:-~/.local/state}/xeon` |
| runtime | `$TMPDIR/xeon`(길이 규칙을 넘으면 `/tmp/xeon-<uid>`) | `$XDG_RUNTIME_DIR/xeon`(변수가 없으면 `/tmp/xeon-<uid>`) |
| cache | `~/Library/Caches/xeon` | `${XDG_CACHE_HOME:-~/.cache}/xeon` |

- 데이터, 설정, 상태, 런타임 디렉터리는 `0700`으로 만듭니다. 이미 있으면 소유자가 현재 사용자인지, 그룹과 기타 권한이 열려 있지 않은지 확인합니다. 어긋나면 시작하지 않습니다(`L0.os.spec` §3.2).
- WSL에서 data, state, cache, runtime이 `/mnt/` 아래에 있으면 `data_dir_on_drvfs` 오류로 거부합니다(`L0.os.spec` §3.2).
- 환경 변수 `XEON_HOME`이 있으면 data, config, cache, state, runtime을 그 아래 `data`, `config`, `cache`, `state`, `run` 폴더로 바꿉니다. 값은 절대 경로여야 하고, 상대 경로이면 `not_absolute` 오류입니다 `[제안]`(`L0.os.spec` §3.2, eng.operations.runbook §2.2).
- cache 디렉터리에 어떤 내용을 두는지는 스펙에 없습니다 `[미결]`.

### 1.2 파일별 내용

| 파일 | 위치 | 담는 것 | 근거 |
|---|---|---|---|
| `xeon.db` | data | 세션 이벤트, 투영 테이블, 확장 접두 테이블, 블롭 참조. 대화 내용, 도구 호출과 결과, 승인 기록, 예약 실행 기록이 들어갑니다 | adr.0004, L1.persistence.spec |
| `blobs/<ab>/<나머지>` | data | 내용 주소(SHA-256) 파일. 이벤트 envelope 256 KiB를 넘는 값, 도구 결과 원문, 웹 원문, 지식 원장의 전후 내용이 들어갑니다 | L0.store.spec §4.9, L2.knowledge.spec §2 |
| `backups/*.sqlite` | data | 마이그레이션 전 스냅샷입니다. 같은 DB의 스냅샷은 최근 3개만 남깁니다 | L0.store.spec §4.6.1 |
| `settings.json` | config | 사용자 설정 값 | apps/host/src/assemble.ts |
| `trust.json` | config | 프로젝트 폴더별 신뢰 결정(`verdict`, `decidedAt`, `via`) | X.loading-trust.spec §4.7, apps/host/src/assemble.ts |
| `secrets/sops/user.yaml` | config | 기본 SOPS 파일. 값은 age로 암호화되어 있습니다 | L0.secrets.spec §4.8, platform-secrets/src/config.ts |
| `secrets/meta/<이름>.yaml` | config | 비밀의 메타 정보. 값은 없습니다 `[제안]` | L0.secrets.spec §3.2 |
| `secrets/age/keys.txt` | config | age 개인 키 파일(`0600`). 키체인이나 Secret Service를 쓰면 만들지 않습니다 | L0.secrets.spec §4.7 |
| `secrets/audit.log` | config | 비밀 감사 기록. 값, 값의 일부, 값의 해시를 싣지 않습니다 | L0.secrets.spec §3.9 |
| `logs/<모드>.log` | state | 엔진 로그. 한 줄이 JSON 객체 하나이고 마스킹을 거칩니다 | L0.os.spec §3.5, eng.operations.runbook §3 |
| `schedule/state.json` | state | 예약 상태 | L2.schedule.spec, apps/host/src/assembly/schedule-store.ts |
| `cli/state.json` | state | CLI가 마지막 세션과 스트림 위치를 적어 두는 파일입니다. 깨지면 버립니다 | L4.cli.spec §3.7 |
| `spill/` | state | 명령 출력이 임계를 넘을 때 쓰는 전체 출력 임시 파일 | L0.exec.spec §3.8, apps/host/src/assembly/data-ops.ts |
| `telemetry/spans-<날짜>.jsonl` | state | 텔레메트리 exporter가 `file`일 때만 씁니다. 기본은 꺼져 있습니다 | L0.os.spec §3.9 |
| `service.json` | runtime | 서비스 등록 파일(`0600`). 토큰 필드가 있습니다 | L4.host-service.spec §3.5, platform-process/src/service/registration.ts |
| `xeon.sock` | runtime | 서비스 소켓 | L4.host-service.spec §3.5 |
| `<작업 폴더>/.xeon/settings.json`, `.xeon/settings.local.json` | 작업 폴더 | 프로젝트 공유 설정과 개인 설정. 프로젝트 파일이므로 버전 관리에 들어갈 수 있습니다. `local`은 버전 관리 제외가 의도입니다 | X.loading-trust.spec §4.7.2, F.wire-settings.spec §4.7 |

### 1.3 대화와 실행 기록

- 세션 이벤트는 내구 이벤트로 DB에 커밋됩니다. 토큰 델타처럼 조각난 출력은 저장하지 않는 휘발 이벤트입니다(F.records.spec, adr.0004).
- 도구 결과는 저장 전에 마스킹 계층 2를 거칩니다(L0.secrets.spec §4.4).
- 사람이 입력한 내용은 계층 1에서 접두 패턴과 키-값 문맥만 가립니다. 알려진 비밀 값이 아니면 가리지 못할 수 있습니다. 내구 이벤트에 들어간 뒤에는 지울 수 없습니다(L0.secrets.spec §4.4).
- 이미 기록된 이벤트의 비밀 사후 가림은 M3-REQ-59 행입니다. 구현 상태는 `eng.operations.status-map`을 봅니다. 저장된 이벤트에서 비밀을 지우는 경로는 `[미결]`입니다(architecture.security.spec §10).
- 웹 원문 캐시(`cap_web_raw`)는 원문과 본문을 블롭으로 저장합니다. 캐시 행마다 `retention`이 `session` 또는 `persist`입니다(L2.web.spec §4.3.2).
- 지식 원장은 스킬과 메모리의 모든 변경을 전후 내용과 함께 기록합니다(L2.knowledge.spec §2).

## 2. 보존 기간

기본 설정에서 지우는 자동 정리는 웹 캐시와 spill 파일의 일부뿐입니다. 나머지는 사용자가 지우기 전까지 남습니다.

| 대상 | 기본 동작 | 설정 키 | 근거 |
|---|---|---|---|
| 대화 이벤트(thread) | 지우지 않음 | `l1.persistence.retention.maxAgeDays` 0, `maxCount` 0 | L1.persistence.spec §6.1 |
| spill 파일 | 지우지 않음 | `l0.exec.spillRetentionDays` 0 (0이면 아무것도 지우지 않음), `l0.exec.spillMaxBytes` | L0.exec.spec §3.8.2, §6 |
| 블롭 | 참조 없는 블롭을 지우지 않음(GC 꺼짐) | `l0.store.blobGcEnabled` false, `l0.store.blobGraceMs` 86400000 `[제안]` | L0.store.spec §6, §4.9, HS-102 |
| 웹 원문 캐시 | 세션 종료 뒤 `session` 행을 다음 시작 때 지움. 전체 상한을 넘으면 `expires_at` 오름차순으로 지움 | `l2.web.cache.maxMegabytes` 256 | L2.web.spec §4.3.1, §3.8 |
| 비밀 감사 기록 | 90일 `[제안]` | `l0.secrets.audit.retentionDays` 90 | L0.secrets.spec §6.1 |
| 마이그레이션 스냅샷 | 최근 3개 | `MIGRATION_SNAPSHOT_KEEP`(상수) | L0.store.spec §4.6.1 |
| 로그 | 회전 규칙이 스펙에 있지만 호스트에 연결되지 않아 한 파일에 덧붙임 | `l0.os.log.level`(기본 `info`) | L0.os.spec §3.5, eng.operations.runbook §3.1 |
| 예약 상태, CLI 상태 | 보존 기간 규칙이 없음 `[미결]` | 없음 | L2.schedule.spec, L4.cli.spec §3.7 |
| 텔레메트리 파일 | 보존 규칙이 없음 `[미결]` | 없음 | L0.os.spec §3.9 |

- 대화 정리(`prune`)는 엔진을 열 때 한 번 돕니다. 기본 값에서는 아무것도 지우지 않습니다(L1.persistence.spec §6.1).
- 블롭 GC의 실행 조건은 §6에 있습니다.

## 3. 비밀

### 3.1 저장

- 기본 제공자는 SOPS입니다. 값은 `secrets/sops/user.yaml`에 age로 암호화되어 있고, 설정이 비어 있으면 이 파일을 씁니다(L0.secrets.spec §4.6, §4.8, adr.0019).
- age 개인 키는 제공자마다 다른 곳에 있습니다. macOS는 키체인 항목 `xeon.age`/`default`입니다. Linux는 Secret Service가 있으면 그곳에, 없으면 `secrets/age/keys.txt`(`0600`)에 둡니다(L0.secrets.spec §4.7).
- 파일 폴백은 같은 사용자 권한으로 도는 모든 프로세스가 읽을 수 있습니다. 키 파일 경로는 샌드박스 보호 경로로 등록합니다. 처음 쓸 때 이 위험을 알립니다(L0.secrets.spec §4.7 5번).
- 복호화한 값은 디스크에 쓰지 않습니다. 부모 프로세스가 `sops decrypt`를 실행해 메모리에서만 받습니다(L0.secrets.spec §4.6 4번).

### 3.2 다루는 규칙

- 값은 명령 인자로 받지 않습니다. `xeon secret add`, `set`, `rotate`는 stdin이나 프롬프트로만 값을 받습니다. 인자에 값을 넣으면 종료 코드 2의 사용법 오류입니다(L4.cli.spec §4.7, eng.operations.runbook §8).
- 설정 파일에는 비밀 값이 없습니다. 비밀 값을 담는 설정 키는 없고, 설정에는 `secret://<이름>` 참조만 씁니다(L0.secrets.spec §6.1).
- 대화, 이벤트, 로그, 설정에는 참조만 남습니다. `secret://` 핸들은 값이 아닙니다(L0.secrets.spec §2).
- 로그와 이벤트는 마스킹을 거칩니다. 마스킹은 끌 수 없습니다. `l0.secrets.redaction.enabled`는 읽기 전용 표시 키입니다(L0.secrets.spec §4.4, §6.1).
- 자식 프로세스의 환경 변수에서 비밀 이름 패턴을 지웁니다(`SENSITIVE_ENV_PATTERNS`, L0.secrets.spec §4.5).
- 비밀 값은 메타에 허용한 호스트 밖으로 주입하지 않습니다(도메인 바인딩, L0.secrets.spec §2).
- 모델 키는 `runtime-http` 모드로 그 provider 호스트에만 주입합니다(L0.secrets.spec §4.2).
- 감사 기록에는 값을 싣지 않습니다. 명령줄은 SHA-256 앞 16자로만 남깁니다(L0.secrets.spec §3.9).

### 3.3 열람

- `xeon secret reveal <이름>`은 사람만 쓰고 TTY에서만 동작합니다. OS 인증 재확인을 쓸 수 있으면 재확인합니다(L4.cli.spec §4.7).
- 재인증 증거는 60초 안이어야 합니다 `[제안]`. 재인증 방법은 `os-auth`가 우선이고, 없으면 `tty-confirm`입니다(L0.secrets.spec §3.8, architecture.security.spec T-06).
- 서비스에 붙은 연결에서는 값 입력과 열람 창이 아직 없어 `xeon secret add`, `set`, `rotate`, `reveal`이 실패합니다(L4.cli.spec §3, §10 22번). `[미결]`로 남은 항목입니다.

### 3.4 원격 토큰

- 원격 서비스 토큰은 환경 변수 `XEON_REMOTE_TOKEN`에서만 읽습니다. 명령 인자와 설정에는 두지 않습니다(apps/host/src/service/launch-mode.ts, L4.host-service.spec §3.3.4).
- 토큰을 클라이언트로 옮기는 공식 절차와 토큰을 바꾸는 명령은 없습니다 `[미결]`(eng.operations.runbook §5.2).

## 4. 밖으로 나가는 것

| 대상 | 나가는 것 | 조건과 제한 | 근거 |
|---|---|---|---|
| 모델 provider | 모델 요청 본문. 기본 프롬프트, 프로젝트 지침(`AGENTS.md`, `CLAUDE.md` 포함), 스킬 인덱스, 메모리, 날짜와 작업 디렉터리 상태, 대화 항목, 도구 정의, 도구 결과(파일 내용 포함) | 모델을 부를 때마다 보냅니다. 요청 본문은 마스킹 계층 3과 4를 거칩니다. 모델 키는 provider 호스트에만 주입합니다 | L1.context.spec §2, L1.models.spec, X.loading-trust.spec §4.7.2, L0.secrets.spec §4.4 |
| 웹 검색 provider | 검색 질의 | 사용자가 설정한 provider 체인에 있는 것만 씁니다. 자동으로 찾는 provider는 없습니다. 알려진 비밀이 질의에 있으면 보내지 않고 거부합니다 | adr.0005 §3.3, L2.web.spec §4.1, architecture.security.spec T-08 |
| 웹 가져오기(`web.fetch`) | 요청하는 URL | 기본은 승인 요청입니다. 대화에 나온 URL만 허용합니다. 사설망과 메타데이터 주소는 막습니다 | architecture.security.spec T-01, T-07, L2.web.spec §4.6 |
| 키가 필요한 웹 provider | 검색 질의와 provider 키 | 첫 사용 때 고지합니다(`first_use_notice`). 고지 문구의 시점은 `[미결]`입니다 | L2.web.spec §4.8.2, adr.0005 개정 |
| MCP 서버 | stdio 서버는 사용자 권한으로 돌고 도구 결과와 요청을 주고받습니다. HTTP 서버에는 요청이 네트워크로 나갑니다 | 비밀 env를 쓰는 서버는 승인 뒤에만 띄웁니다. 샌드박스는 MCP stdio 출처별로 정합니다 | architecture.security.spec B-05, T-04, adr.0011 |
| 원격 서비스 | 클라이언트와 호스트 사이의 계약 메시지 | SSH 터널이나 사설망을 거칩니다. 서비스는 비루프백 리스너를 만들지 않습니다 | L4.host-service.spec HS-87, architecture.security.spec T-10 |
| 텔레메트리(OpenTelemetry) | 추적(span) | 기본은 꺼져 있습니다. exporter가 `file`이면 기기 안 파일에만 씁니다. `otlp-http`는 `l0.os.telemetry.endpoint`로 보냅니다. 기본 endpoint는 `http://localhost:4318/v1/traces`입니다. span에 담는 내용의 범위는 `[미결]`입니다 | L0.os.spec §3.9, §6 |

- 스펙에서 위 항목 말고 제품이 자동으로 밖으로 보내는 기능은 찾지 못했습니다. 사용 통계를 보내는 기능은 스펙에 없습니다 `[확인: 스펙 검색 기준]`.
- 자동 업데이트는 M3b에 없습니다(eng.operations.runbook §1.3).

## 5. 신뢰와 프로젝트 파일 읽기

- 프로젝트 폴더는 판정 전에 신뢰 판정을 받습니다. 판정 전에는 프로젝트 확장을 불러오지 않고, `.mcp.json`, 스킬, 설정을 읽지 않습니다(architecture.security.spec T-03).
- 신뢰가 필요한 자원은 `.xeon/extensions/`, `.xeon/settings.json`, `.xeon/settings.local.json`, `.xeon/mcp.json`, `.mcp.json`, `.xeon/hooks/`, `.xeon/skills/`, `.xeon/commands/`, `.xeon/prompts/`, `.xeon/agents/`, `.xeon/SYSTEM.md`, `.xeon/APPEND_SYSTEM.md`, `.agents/skills/`입니다(X.loading-trust.spec §4.7.2).
- `AGENTS.md`와 `CLAUDE.md`는 신뢰와 관계없이 읽힙니다. 이 내용은 모델 입력으로만 쓰이고 코드로 실행되지 않습니다. 그래도 신뢰되지 않은 입력으로 취급합니다(X.loading-trust.spec §4.7.2, architecture.security.spec §5).
- 판정 순서는 다음과 같습니다. 재정의 값, 자원 없음, 이번 세션 기억, 세션 신뢰 지점, 저장된 결정, 기본 설정 `x.loading-trust.defaultProjectTrust`(기본 `ask`), 헤드리스 불신, 프롬프트입니다(X.loading-trust.spec §4.7.3).
- 헤드리스 실행(print, JSON)에서는 프롬프트를 띄우지 않고 불신으로 처리합니다. 이때 결정을 저장하지 않습니다(X.loading-trust.spec §4.7.3 7번).
- 신뢰 결정은 `trust.json`에 폴더마다 저장합니다. 파일이 깨졌으면 불신으로 처리하고, 덮어쓰지 않습니다(X.loading-trust.spec §4.7.5).
- 신뢰 상태는 `xeon trust [status] [--json]`으로 봅니다(L4.cli.spec).

## 6. 블롭 GC 기본값

- `l0.store.blobGcEnabled`의 기본값은 끔입니다(M3-REQ-84, 오케스트레이터 기본값). 꺼져 있으면 GC를 부르지 않습니다(L0.store.spec §4.9, §6).
- 켜도 서비스 모드에서만 돕니다. 첫 실행은 열고 1분 뒤이고, 그 뒤는 하루마다입니다. 참조 집합은 `p_blob_refs`에서 모읍니다(HS-102, HS-40).
- 참조 없는 블롭은 유예 시간(`l0.store.blobGraceMs`, 기본 24시간)이 지나야 지웁니다. 한 번에 지우는 수는 1000개로 제한합니다(L0.store.spec §4.9).
- 켜는 것은 모든 소비자가 블롭을 고정한 뒤에만 안전합니다. 아직 고정하지 않는 소비자는 cap-mcp, cap-dialog, cap-workspace입니다. 이들의 블롭은 이벤트 참조로만 보존됩니다(L0.store.spec §6, S-15 해소 근거).
- 이월 목록에서도 "GC 켜기는 넓은 감사와 장시간 시험이 필요하다"고 적었습니다.
- 따라서 기본 설정에서는 참조가 사라진 블롭도 파일로 남습니다.

## 7. 지우는 방법과 백업

### 7.1 지우기

| 무엇 | 명령 | 지워지는 것 | 남는 것 |
|---|---|---|---|
| 세션 | `xeon sessions rm <id> [--yes]`. TTY에서는 확인을 받고, 비TTY에서는 `--yes`가 없으면 종료 코드 2입니다 | thread의 이벤트, 요청 기록, 투영 행(한 트랜잭션). 다른 thread가 이 thread에서 분기했으면 거부합니다 | 블롭 파일. 블롭을 정리한다는 문장이 `threads.remove` 설명에 없습니다 `[가정]`. GC가 꺼져 있으면 파일이 그대로 남습니다. 웹 캐시의 `session` 행은 다음 시작 때 정리합니다 |
| 비밀 | `xeon secret rm <이름> [--yes]`. 참조하는 설정 키, 활성 lease, 최근 세션을 보인 뒤 확인합니다. 활성 lease가 있으면 거부합니다 | 비밀 항목(세부 범위는 `[미결]`) | 감사 기록(값 없음) |
| 설정 값 | `xeon config reset <키> [--scope …]` | 해당 범위의 값 | 다른 범위의 값 |
| 신뢰 결정 | 보기만 있습니다(`xeon trust [status]`). 결정을 지우거나 바꾸는 명령은 스펙에 없습니다 `[미결]` | 없음 | `trust.json` |
| 데이터 디렉터리 전체 | 제품 명령이 없습니다. 직접 지우는 절차도 스펙에 없습니다 `[미결]` | 없음 | 전부 |

- 세션 삭제 절은 `L1.persistence.spec`의 `threads.remove` 설명을 따릅니다. 블롭을 지운다는 문장은 없습니다.

### 7.2 백업

- `xeon db export <폴더> [--json]`은 데이터 디렉터리의 DB와 블롭을 엔진을 띄우지 않고 읽기 전용으로 복사합니다. 대상 폴더는 비어 있어야 합니다(L4.cli.spec, eng.operations.recovery §2).
- 사본은 `xeon.sqlite`, `blobs/`, `manifest.json`입니다. 설정, 신뢰 결정, 비밀 파일은 사본에 없습니다(eng.operations.recovery §2.4).
- 사본은 파일 모드만 `0600`과 `0700`으로 맞춥니다. 사본 구성에 암호화 단계는 없습니다. 보관할 때 암호화는 사용자가 정합니다 `[미결]`.
- 사본을 데이터 디렉터리로 되돌리는 명령은 없습니다(eng.operations.recovery §2.6).
- `XEON_HOME`으로 데이터 위치를 바꾸었다면 같은 값을 주고 내보냅니다(eng.operations.recovery §2.3).

## 8. 미결 사항

1. cache 디렉터리에 저장하는 내용이 스펙에 없습니다(§1.1).
2. 예약 상태와 CLI 상태, 텔레메트리 파일의 보존 규칙이 없습니다(§2).
3. 저장된 이벤트에서 비밀을 지우는 경로가 없습니다(architecture.security.spec §10, G2-16).
4. 비밀 감사 기록의 `retentionDays` 정리가 구현되었는지 확인하지 않았습니다(§2).
5. 로그 회전 sink를 호스트에 연결할지 정합니다(eng.operations.runbook §3.1 미결 3).
6. 서비스에 붙은 연결의 비밀 입력 창을 만들지 정합니다(L4.cli.spec §3, §10 22번).
7. 키 파일 폴백 고지와 키 플러그인 첫 사용 고지의 시점을 정합니다(§3.1, §4).
8. 텔레메트리 span에 담는 내용의 범위를 정합니다(§4).
9. 신뢰 결정을 지우거나 바꾸는 명령을 둘지 정합니다(§7.1).
10. 데이터 디렉터리 전체를 지우는 절차를 정합니다(§7.1).
11. 백업 사본의 암호화와 되돌리기 절차를 정합니다(§7.2).
12. 관리 설정 파일의 위치가 정해지지 않았습니다(eng.operations.runbook 미결 9).
