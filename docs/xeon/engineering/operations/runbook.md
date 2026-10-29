---
id: eng.operations.runbook
layer: eng
domain: operations
kind: guide
status: draft
depends_on: [L0.os.spec, L0.process.spec, L4.cli.spec, L4.host-service.spec, L4.release.spec, X.operations.spec, F.wire-settings.spec]
binds: []
---

# 운영·진단 런북

이 문서는 설치된 xeon을 운영하고 문제를 진단하는 절차를 적습니다. 데이터를 되돌리는 절차는 `eng.operations.recovery`가 맡습니다.

명령, 설정 키, 경로, 오류 문구는 `xeon/` 소스와 L0·L4·X 스펙에서 가져왔습니다. 소스에서 확인하지 못한 내용은 `[미결]`로 표시하고 문서 끝 "미결 사항"에 모았습니다.

## 1. 설치

### 1.1 릴리즈 아카이브 구성

릴리즈 한 벌은 아카이브 하나와 검사용 `.sha256` 파일 하나입니다(`L4.release.spec` §3.1).

| 파일 | 내용 |
|---|---|
| `xeon-<버전>-<triple>.tar.gz` | 최상위 폴더 `xeon-<버전>-<triple>/`를 담은 아카이브 |
| `xeon-<버전>-<triple>.tar.gz.sha256` | 아카이브의 SHA-256. 형식은 `<해시>  <파일 이름>`입니다 |

아카이브를 풀면 다음 항목이 나옵니다.

| 경로 | 내용 |
|---|---|
| `xeon` | 컴파일된 엔진과 CLI (Windows는 `xeon.exe`) |
| `group-kit/templates/` | `xeon group new`의 템플릿과 `index.json` |
| `default-plugins/` | 기본 플러그인(`helm`, `account-rotation`) |
| `binaries/`, `binaries.lock.json` | macOS 아카이브에만 있습니다. 번들 바이너리(sops, age, rg)와 목록 |
| `THIRD-PARTY-NOTICES.txt` | 번들 바이너리의 고지와 시스템 요구 목록 |
| `SHA256SUMS` | 위 모든 파일의 SHA-256(경로순) |

대상 triple은 다음과 같습니다.

| triple | 상태 | 외부 바이너리 |
|---|---|---|
| `aarch64-apple-darwin` | macOS 14 이상 arm64 | 아카이브에 번들합니다(sops 3.13.3, age 1.3.2, rg 15.0.0) |
| `x86_64-unknown-linux-gnu` | Linux x86_64 | 시스템 패키지 rg, bwrap, socat을 설치합니다 |
| `aarch64-unknown-linux-gnu` | 빌드 대상입니다. 검증하지 않았습니다 [미결 11] | 시스템 패키지 rg, bwrap, socat |

Intel macOS와 Windows는 이 릴리즈 범위 밖입니다(`L4.release.spec` §3.4).

### 1.2 설치 절차

1. 아카이브와 `.sha256` 파일을 같은 곳에서 받습니다.
2. 내용을 검사합니다. `.sha256`은 내려받는 중의 깨짐을 잡습니다. 두 파일을 같은 곳에서 받으므로 변조는 막지 못합니다(`L4.release.spec` §6).

   ```
   sha256sum -c xeon-<버전>-<triple>.tar.gz.sha256
   ```

   이 명령은 표준 도구입니다. macOS에서는 `shasum -a 256 -c`를 씁니다. 제품이 정한 절차는 아닙니다 [제안].

3. 아카이브를 풉니다.

   ```
   tar -xzf xeon-<버전>-<triple>.tar.gz
   ```

4. 엔진이 뜨는지 확인합니다.

   ```
   ./xeon-<버전>-<triple>/xeon version
   ./xeon-<버전>-<triple>/xeon doctor
   ```

5. Linux에서 시스템 패키지가 없으면 `xeon doctor`가 설치 명령을 안내합니다. 예: `apt install bubblewrap`(`L4.release.spec` §3.3).

`PATH`에 넣는 방법과 설치 위치는 정해지지 않았습니다 [미결 1].

### 1.3 업데이트

- M3b에는 자동 업데이트가 없습니다. 새 아카이브를 받아 §1.2의 검사를 한 뒤 설치 폴더를 새 것으로 바꿉니다(`L4.release.spec` §5).
- 설정과 상태는 설치 폴더 밖(§2의 OS별 위치)에 있으므로 폴더를 바꿔도 남습니다.
- 기본 플러그인은 처음 실행할 때 사용자 확장 폴더에 복사본을 둡니다. 새 아카이브의 번들 버전이 다르면 복사본을 바꿉니다. 사용자가 지운 복사본은 다시 설치하지 않습니다.

### 1.4 개발자 메모

아래 두 레시피는 저장소에서 릴리즈를 만들 때만 씁니다. 사용자는 쓰지 않습니다.

- `just release <triple> [--version x.y.z]`: 루트 `justfile`이 `xeon`의 같은 레시피를 부르고, 그 레시피가 `xeon/scripts/release.ts`를 실행합니다. 아카이브를 만듭니다.
- `just release-smoke`: 이 기기의 릴리즈를 만들어 풀고 구성, 실행, 번들을 점검합니다. X11 환경에서만 돕니다.

## 2. 데이터·상태·로그 위치

### 2.1 OS별 기본 위치

`OsDirs` 값입니다(`L0.os.spec` §3.2, `xeon/packages/platform-os/src/dirs.ts`). `~`는 홈입니다.

| 디렉터리 | macOS | Linux(WSL2 포함) | Windows |
|---|---|---|---|
| data | `~/Library/Application Support/xeon` | `${XDG_DATA_HOME:-~/.local/share}/xeon` | `%LOCALAPPDATA%\xeon\data` |
| config | `~/Library/Application Support/xeon/config` | `${XDG_CONFIG_HOME:-~/.config}/xeon` | `%APPDATA%\xeon` |
| cache | `~/Library/Caches/xeon` | `${XDG_CACHE_HOME:-~/.cache}/xeon` | `%LOCALAPPDATA%\xeon\cache` |
| state | `~/Library/Application Support/xeon/state` | `${XDG_STATE_HOME:-~/.local/state}/xeon` | `%LOCALAPPDATA%\xeon\state` |
| runtime | `$TMPDIR/xeon`. 소켓 길이 규칙을 넘으면 `/tmp/xeon-<uid>` | `$XDG_RUNTIME_DIR/xeon`. 변수가 없으면 `/tmp/xeon-<uid>` | `%LOCALAPPDATA%\xeon\run` |
| resource | 실행 파일이 든 폴더(읽기 전용) | 같음 | 같음 |

- XDG 변수가 상대 경로이면 규격대로 무시하고 기본값을 씁니다.
- 디렉터리는 `0700`으로 만듭니다. 이미 있으면 소유자가 현재 사용자인지, 그룹과 기타 권한이 열려 있지 않은지 확인합니다. 어긋나면 시작하지 않습니다(`L0.os.spec` §3.2).
- WSL에서 data, state, cache, runtime이 `/mnt/` 아래이면 `data_dir_on_drvfs` 오류로 거부합니다(`L0.os.spec` §3.2).

### 2.2 XEON_HOME

환경 변수 `XEON_HOME`이 비어 있지 않으면 다음 위치를 씁니다. 값은 절대 경로여야 합니다. 상대 경로이면 `not_absolute` 오류입니다.

| 디렉터리 | 위치 |
|---|---|
| data | `$XEON_HOME/data` |
| config | `$XEON_HOME/config` |
| cache | `$XEON_HOME/cache` |
| state | `$XEON_HOME/state` |
| runtime | `$XEON_HOME/run`. 길이 규칙을 넘으면 OS 기본 runtime을 씁니다 |

resource와 tmp는 바뀌지 않습니다.

우선순위는 `XEON_HOME` > 설정 `l0.os.dirs.override`(관리 범위) > OS 기본값입니다. 다만 `l0.os.dirs.override`는 호스트 조립이 `osPlatform`에 넘기지 않아서 지금은 적용되지 않습니다 [미결 2]. 위치를 바꿀 때는 `XEON_HOME`을 씁니다.

### 2.3 디렉터리 안의 파일

| 위치 | 파일 | 뜻 |
|---|---|---|
| data | `xeon.db` | 세션 저장소(SQLite). 이벤트와 투영 |
| data | `blobs/<ab>/<나머지>` | 큰 값(블롭) 파일 |
| data | `backups/xeon.db.pre-<시각>-<owner>-v<from>-to-v<to>.sqlite` | 마이그레이션 전 스냅샷. `eng.operations.recovery` §8 |
| state | `logs/<모드>.log` | 엔진 로그. §3 |
| state | `schedule/state.json` | 예약 상태. `eng.operations.recovery` §4 |
| state | `cli/state.json` | CLI가 세션 위치를 기억하는 캐시. 깨지면 버려집니다 |
| state | `spill/` | 명령 출력이 넘친 임시 파일 |
| config | `settings.json` | 사용자 설정 파일 |
| config | `trust.json` | 프로젝트 신뢰 결정 |
| config | `secrets/audit.log` | 비밀 감사 기록. 값은 없습니다 |
| runtime | `service.json` | 서비스 등록 파일(0600). `token` 필드가 있습니다. §5.2 |
| runtime | `xeon.sock` | 서비스 소켓 |
| runtime | `service.activation` | 서비스 기동 잠금 |

프로젝트 설정은 작업 폴더의 `.xeon/settings.json`(project)과 `.xeon/settings.local.json`(local)에 있습니다(`apps/host/src/assembly/settings-store.ts`).

`OsDirs`에는 `log` 항목이 없습니다. 로그는 `state` 아래 `logs/` 폴더입니다(`L0.os.spec` §3.2의 `state` 설명, `apps/host/src/assemble.ts`).

## 3. 로그

### 3.1 위치와 형식

- 파일은 `<state>/logs/<모드>.log`입니다. 모드는 엔진을 연 방식입니다. CLI가 같은 프로세스에서 여는 엔진은 `in-process`, `xeon host --stdio`는 `stdio`, 서비스는 `service`입니다(`apps/host/src/assemble.ts`, `apps/host/src/main.ts`).
- 파일은 0600으로 만들고 줄을 덧붙입니다. 한 줄은 JSON 객체 하나입니다. 필드는 `ts`, `level`, `event`와 사건별 필드입니다(`L0.os.spec` §3.5).
- 수준은 설정 `l0.os.log.level`입니다. `debug`, `info`, `warn`, `error` 가운데 하나이고 기본값은 `info`입니다. 이 설정은 다음 줄부터 바로 반영됩니다(live).

  ```
  xeon config set l0.os.log.level debug
  xeon config reset l0.os.log.level
  ```

- 로그 줄은 마스킹 함수를 거쳐 씁니다. 비밀 값은 로그와 이벤트에 싣지 않습니다(`L4.cli.spec` §4.7, `L0.os.spec` §3.5).
- 회전: `L0.os.spec` §3.5는 10 MiB마다 파일을 넘기는 싱크를 정합니다. 그러나 호스트 조립은 회전 없이 한 파일에 덧붙입니다(`apps/host/src/assembly/log-sink.ts`) [미결 3].

### 3.2 찾는 방법

로그는 한 줄에 사건 하나입니다. 최근 줄은 `tail -n 50 <로그 파일>`로 봅니다. 사건 이름은 `event` 필드입니다.

### 3.3 자주 보는 사건

| event | 수준 | 뜻 |
|---|---|---|
| `store.blob_gc` | info | 블롭 정리 결과(`rows`, `orphanFiles`, `tmpFiles`, `deferred`, `truncated`). 서비스 모드에서만 돕니다. `l0.store.blobGcEnabled`가 켜져 있어야 합니다(기본 꺼짐). 첫 실행은 열고 1분 뒤, 그 뒤는 하루마다입니다(`HS-102`) |
| `store.blob_gc_failed` | warn | 블롭 정리가 실패했습니다(`kind`). 호스트는 계속 돕니다 |
| `spill.pruned` | info | 보관 기간이 지난 명령 출력 임시 파일을 지웠습니다(`removed`, `bytesFreed`, `failed`). `l0.exec.spillRetentionDays`가 0이면 지우지 않습니다 |
| `spill.prune_failed` | warn | 임시 파일 정리가 실패했습니다 |
| `store.migration_snapshot` | info | 마이그레이션 전 스냅샷을 만들었습니다(`path`, `owner`, `from`, `to`) |
| `store.snapshot_prune_failed` | warn | 오래된 스냅샷을 지우지 못했습니다 |
| `store.warning` | warn | 저장소 열기 경고입니다(`kind`) |
| `session.projector_suspended` | error | 확장 또는 능력 투영기가 실패해 멈췄습니다(`projector`, `message`). `eng.operations.recovery` §5 |
| `session.projector_rebuild_failed` | error | 멈춘 투영기를 다시 만들지 못했습니다 |
| `secrets.audit.write_failed` | error | 비밀 감사 기록을 쓰지 못했습니다 |
| `log.redact_failed` | 수준 없음 | 마스킹이 실패해 원문 대신 이 한 줄만 썼습니다 |

## 4. `xeon doctor`

### 4.1 실행

```
xeon doctor
xeon doctor --json
```

엔진을 열어 점검합니다. 엔진을 열지 못하면 첫 항목이 `[실패] 엔진을 열 수 없다: <문구>`이고 해결 줄이 붙습니다. 이때도 터미널 항목은 점검합니다(`apps/cli/src/commands/doctor.ts`, `L4.cli.spec` §4.7.1).

### 4.2 출력 형식

출력은 `L4.cli.spec` §4.7.1의 형식을 따릅니다. 예는 다음과 같습니다.

```
xeon doctor (xeon 0.0.0)
진단
  [ok]   엔진을 열었다 (in-process). 세션 저장소와 FTS5를 쓸 수 있다
  [ok]   상태 디렉터리: <경로>
  [ok]   비밀 저장소: 사용할 수 있다 (등록 0개)
  [ok]   외부 바이너리 sops: 3.9.0 (시스템) — 비밀 저장소
  [경고] 외부 바이너리 bwrap: 없다 (선택) — 명령을 샌드박스 없이 실행하지 못한다
         해결: bubblewrap 패키지를 설치한다
  [참고] 서비스 모드: 사용 안 함 (in-process)
  [ok]   터미널: stdin TTY, stdout TTY, 100열, 색 사용
검색 provider
  검색 provider: auto → Built-in search (model provider) (builtin-wrapper)
  SearXNG: 주소를 설정하지 않았다 (자동 감지는 하지 않는다) — 쓰려면: xeon config set l2.web.search.searxng.url <주소>
  권장 키 플러그인: Exa(키 필요 — xeon secret add exa-api-key), Brave(설치 필요 — 플러그인을 설치한다)
웹 provider
  ...
```

- 표지: `[ok]`는 쓸 수 있다, `[경고]`는 쓸 수 없는 것이 있지만 나머지는 동작한다, `[실패]`는 필수 항목이 없거나 엔진을 열지 못했다, `[참고]`는 정보입니다.
- 해결 줄은 항목 아래에 `해결:`으로 시작합니다.
- 항목의 예: 필수 외부 바이너리가 없으면 `[실패]`, 선택 바이너리가 없으면 `[경고]`입니다. 바이너리가 `too_old`이거나 `unusable`이면 같은 규칙을 따릅니다. 로케일이 UTF-8이 아니면 터미널 항목이 `[경고]`입니다(`doctor.ts`).

### 4.3 종료 코드

| 상황 | 종료 코드 |
|---|---|
| 점검을 마쳤다. 경고와 참고가 있어도 됩니다 | 0 |
| 필수 외부 바이너리를 쓸 수 없다 | 3 |
| 엔진을 열지 못했다 | §7.2 표의 코드(예: `catalogConflict` 1, `invalidRemote` 2, `serviceUnreachable` 3) |

### 4.4 `--json`

`{ version, checks, binaries, search, web }` 문서 하나를 씁니다. `checks`의 각 항목은 `id`, `status`, `message`와 해결이 있으면 `fix`를 갖습니다. `binaries`는 호스트가 준 바이너리 보고서이고 점검 결과가 없으면 `null`입니다. `web`은 웹 provider 보고서이고 읽지 못했으면 `null`입니다(`L4.cli.spec` §4.7.1).

## 5. 서비스 모드와 원격

### 5.1 서비스 모드 켜기와 다루기

설정 `l0.process.service.enabled`는 기본값이 `false`이고 `managed`·`user` 범위에서 쓰며, 재시작 때 반영됩니다(`L0.process.spec` §6). 켜면 CLI는 시작할 때 서비스를 확인하고, 없으면 띄운 뒤 그 서비스에 붙습니다(`L4.host-service.spec` HS-37, `apps/cli/src/engine.ts`).

```
xeon service start              # 띄운다. 이미 떠 있으면 붙는다
xeon service ensure             # start와 같은 일을 한다. --json을 붙이면 한 줄 JSON을 쓴다
xeon service status [--json]    # 떠 있는지 본다
xeon service stop               # 협조 종료를 먼저 요청하고, 기다린 뒤 필요하면 SIGTERM, SIGKILL을 보낸다
```

출력과 종료 코드는 다음과 같습니다.

| 명령 | 출력 | 종료 코드 |
|---|---|---|
| `start`, `ensure` | `service <spawned\|connected\|versionWarning> (pid N, socket <경로>)` | 0 |
| `status` 떠 있음 | `service running (pid N, version V)`, `socket <경로>`, `connections N, live turns N`, `idle shutdown <시각\|none>[, safe mode]` | 0 |
| `status` 없음 | `service not running (<reason>)` | 1 |
| `stop` | 정지 결과 | 성공 0, 실패 1 |

- 서비스 명령은 종료 코드 0, 1, 2만 냅니다(`apps/cli/src/commands/service.ts`).
- 이미 떠 있는 다른 버전의 서비스가 일하는 중이면 `the running service is version <V> and is busy; run "xeon service stop" to replace it`를 stderr에 씁니다. 종료 코드는 0입니다.
- 유휴 종료: 연결이 없고, 실행 중인 작업과 대기 예약이 없으며, 기동 뒤 10초가 지나면 `l0.process.service.idleGraceMs`(기본 60000 ms) 뒤에 스스로 내려갑니다(SV-04). 승인 대기 세션은 실행 중으로 셉니다 [제안].
- 시작 실패: stderr에 `the service is not available: <사유>`를 쓰고 종료 코드 1로 끝납니다(`apps/host/src/service/commands.ts`). 사유는 다음과 같습니다.

| 사유 | 뜻 | 조치 |
|---|---|---|
| `start_timeout` | 기동 시한 안에 응답하지 않았습니다 | 서비스 로그(`logs/service.log`)를 봅니다 |
| `protocol_unsupported` | 서비스와 CLI의 계약 버전이 다릅니다 | 같은 버전의 바이너리를 씁니다 |
| `auth_failed` | 서비스 인증 검사에 실패했습니다 | 해결 문구는 소스에 없습니다 [미결 12] |
| `replace_failed` | 한가한 다른 버전의 서비스를 내리지 못했습니다 | `xeon service stop`으로 내린 뒤 다시 실행합니다. busy 안내 문구와 같은 조치입니다 |
| `insecure_registration` | 등록 파일 권한이 0600이 아닙니다 | `service.json`의 권한을 확인합니다 |
| `spawn_failed` | 서비스 프로세스를 띄우지 못했습니다(`code`) | 실행 파일과 권한을 확인합니다 |

### 5.2 TCP 리스너 (원격 사용)

서버 쪽에서 TCP 주소로 서비스를 엽니다.

```
xeon service start --listen-tcp <호스트>:<포트>
xeon service start --listen-tcp <비루프백 호스트>:<포트> --allow-non-loopback
```

- `--listen-tcp`는 `start`와 `run`에서만 받습니다. `ensure`, `status`, `stop`에 쓰면 사용법 오류(2)입니다.
- 루프백이 아닌 호스트는 `--allow-non-loopback`을 함께 써야 합니다. 없으면 사용법 오류(2)입니다. 루프백 주소는 `127.0.0.1`과 `::1`입니다.
- `--allow-non-loopback`을 `--listen-tcp` 없이 쓰면 사용법 오류(2)입니다.
- TCP 리스너는 서비스를 새로 띄울 때만 적용됩니다. 이미 떠 있는 서비스의 모드는 바뀌지 않습니다.
- 비루프백 리스너는 기본으로 만들지 않습니다(`L4.host-service.spec` SV-05, HS-87). 다른 기기에서는 SSH 터널이나 사설망으로 붙는 것을 전제로 합니다.

토큰:

- TCP 접속에는 토큰이 필요합니다. 토큰은 서비스 등록 파일 `<runtime>/service.json`의 `token` 필드에 있습니다. Unix 소켓 접속에는 토큰이 필요 없습니다(SV-05).
- 클라이언트는 토큰을 환경 변수 `XEON_REMOTE_TOKEN`에서 읽습니다. 토큰을 명령 인자나 설정 파일에 넣지 않습니다.
- 토큰 값을 화면, 로그, 문서에 옮기지 않습니다.
- 토큰을 클라이언트로 옮기는 공식 절차와 토큰을 바꾸는 명령은 없습니다 [미결 7].

클라이언트 쪽:

- 원격 주소는 플래그 `--remote <주소>`로 주거나 설정 `l0.process.service.remote`에 씁니다. 플래그가 설정보다 우선합니다. 플래그는 명령 앞에 씁니다.

  ```
  xeon --remote <주소> doctor
  xeon --remote <주소> schedule list
  xeon config set l0.process.service.remote <주소>
  ```

- 설정 `l0.process.service.remote`는 기본값이 빈 문자열이고 `managed`·`user` 범위에서 쓰며, 재시작 때 반영됩니다.
- 주소 문법은 세 가지입니다.
  - `unix:/절대/경로`
  - `tcp://호스트:포트`
  - `ssh://[사용자@]호스트[:포트]/절대/소켓/경로`
- 문법이 틀리면 로컬로 가지 않고 종료 코드 2(`invalidRemote`)로 끝납니다. 플래그 값은 보이지만 설정 값과 `@`가 든 값은 보이지 않습니다(`L4.cli.spec` §4.10).
- `XEON_REMOTE_TOKEN`은 `tcp://` 주소에서만 읽습니다.
- `ssh://` 주소는 `ssh -L` 터널로 원격 소켓에 붙습니다. `BatchMode`로 실행하므로 키나 ssh-agent로 암호 없이 접속되어야 합니다(HS-87).
- 원격 명령은 서비스 접속입니다. 연결을 닫아도 서비스와 진행 중인 turn은 계속됩니다(HS-88).
- 서버에서 상태를 볼 때는 서버에서 `xeon service status`를 씁니다.

## 6. 안전 모드

안전 모드는 외부 확장과 L3 내장 그룹을 싣지 않고 시작합니다. 확장이 원인인 장애를 좁혀 볼 때 씁니다(`X.operations.spec` §4.6).

### 6.1 켜기

| 방법 | 적용 범위 |
|---|---|
| `xeon chat --safe-mode` 또는 `xeon --safe-mode` | 이번 시작 |
| `xeon service start --safe-mode`, `xeon service ensure --safe-mode` | 새로 띄우는 서비스만 |
| 설정 `x.operations.safeMode.default`를 `true`로 설정 | 시작할 때마다. `managed`·`user` 범위, 재시작 때 반영 |

```
xeon config set x.operations.safeMode.default true
```

구현되지 않은 방법이 있습니다. `XEON_SAFE_MODE` 환경 변수, `/safe-mode` 슬래시 명령, `--disable-ext <이름>` 옵션은 CLI 소스에서 찾지 못했습니다 [미결 6].

### 6.2 꺼지는 것과 남는 것

| 대상 | 안전 모드 |
|---|---|
| 외부 확장(사용자·프로젝트 범위). 기본 플러그인 Helm 포함 | 꺼짐 |
| L3 내장 그룹(학습 그룹) | 꺼짐 |
| 외부 훅 전체 | 꺼짐 |
| `guard`, `core` 계층과 L0~L2 내장 패키지 | 켜짐 |

- 안전 모드에서 시작한 세션은 drive 임대를 갖지 않습니다(`X.operations.spec` §4.6.3).
- 확인: `xeon service status` 출력의 `idle shutdown` 줄 끝에 `, safe mode`가 붙습니다. `host.status`에는 안전 모드일 때만 `safeMode: true`가 들어갑니다(`apps/host/src/handlers/host.ts`).

### 6.3 끄기

- 플래그를 빼고, 설정 `x.operations.safeMode.default`를 되돌립니다.

  ```
  xeon config reset x.operations.safeMode.default
  ```

- 두 설정 모두 재시작 때 반영됩니다. 서비스 모드라면 서비스를 다시 띄웁니다.

## 7. 흔한 실패와 해결

### 7.1 오류 출력 형식

오류 출력은 두 줄입니다(`apps/cli/src/errors.ts`).

```
xeon: <무엇이 잘못됐다>
  해결: <한 줄>
```

### 7.2 오류 kind 표

아래 표는 `L4.cli.spec` §4.10을 옮긴 것입니다. 표 안의 `§` 번호는 `L4.cli.spec`의 절입니다.

| kind | 뜻 | 해결 | 종료 코드 |
|---|---|---|---|
| `thread.notFound` | 세션 `<id>`가 없다 | `xeon sessions ls`로 id를 확인한다 | 1 |
| `thread.locked` | 다른 프로세스(`ownerKind`)가 이 세션을 쓰고 있다 | M1: 끝날 때까지 두거나 새 세션을 연다. M2: 프롬프트(§4.11) | 4 |
| `thread.closed` | 닫힌 세션이라 쓸 수 없다 | `xeon sessions fork`로 분기하거나 새 세션을 연다 | 1 |
| `turn.busy` | 진행 중인 turn이 있다 | 끝난 뒤 다시 보낸다 | 1 |
| `thread.cancelledByExtension` | 확장이 `point`의 작업(컴팩션, 분기, 되감기, 세션 전환)을 막았다. `reason`이 있으면 붙인다 | 확장의 설정을 확인한다 | 1 |
| `thread.compactFailed` | 대화를 요약하지 못했다(`reason`) | 잠시 뒤 다시 `/compact`를 실행한다. 반복되면 `xeon doctor`를 실행하고 보고한다 | 1 |
| `request.cancelled` | 요청이 취소되었다 | 필요하면 다시 실행한다 | 1 |
| `settings.unknownKey` | 등록되지 않은 키 | `xeon config list`로 키를 확인한다 | 2 |
| `settings.invalidValue` | 값이 형식이나 범위에 맞지 않다(`issues` 첫 항목) | 허용 범위를 확인한다 | 2 |
| `settings.scopeNotAllowed` | 그 범위에 쓸 수 없는 키 | 허용 범위: `allowedScopes` | 2 |
| `settings.locked` | 관리 설정이 잠근 키 | 관리자에게 요청한다 | 1 |
| `settings.secretValue` | 비밀 키에는 참조만 쓸 수 있다 | `xeon secret add <name>` 뒤 `secret://<name>`을 쓴다 | 2 |
| `settings.reserved` | 아직 읽는 코드가 없는 예약 키다 | `xeon config list`로 쓸 수 있는 키를 확인한다 | 2 |
| `secret.*` | 비밀 오류별 문구(없음, 사용 중, 제공자·키 없음, 복호화 실패, 재확인 필요 등). 값은 싣지 않는다 | 오류별 한 줄(§4.7) | 제공자·키·쓰기 문제 3, 나머지 1 |
| `store.corrupt` | 저장된 데이터가 스키마와 다르다(`where`) | `xeon doctor`를 실행하고 보고한다. 복원하기 전에 데이터 디렉터리를 복사해 둔다 | 1 |
| `cap.dialog.commands.*` | 슬래시 명령 실패. `command_args_invalid`는 인자 선언과 다르다, `command_shell_disabled`는 셸 주입 설정이 꺼져 있다 | `/help`로 사용법을 확인한다. 셸 주입은 `l2.dialog.commands.shellInjection`을 확인한다 | 인자 오류 2, 나머지 1 |
| `protocol.unsupported` | CLI와 엔진의 계약 버전이 다르다 | 같은 버전의 바이너리를 쓰거나 서비스를 다시 띄운다 | 3 |
| `host.shuttingDown` | 엔진이 종료 중이다 | 잠시 뒤 다시 실행한다 | 1 |
| `internal` | 내부 오류(`traceId`) | `xeon doctor`를 실행하고 `traceId`를 보고한다 | 1 |
| `EngineStartError`(`catalogConflict`, `missingService`) | `message` | `fix` | 1 |
| `EngineStartError`(`invalidRemote`) | `--remote` 또는 설정 `l0.process.service.remote`의 주소 문법이 틀리다. 플래그 값은 보이고, 설정 값과 `@`가 든 값은 보이지 않는다 | `unix:/abs`, `tcp://host:port`, `ssh://[user@]host[:port]/abs/socket` 중 하나로 고친다 | 2 |
| `EngineStartError`(`serviceUnreachable`) | 서비스에 접속하지 못했다(소켓 없음, 거부, 권한, ssh 터널 실패, 토큰 불일치, 응답 없음). 원인별 문구는 §3.3 | 원인별 한 줄(§3.3) | 3 |
| `EngineStartError`(그 밖의 kind) | `message` | `fix` | 3 |
| `db export`, `dest_not_empty` | 내보낼 폴더가 비어 있지 않다. 아무것도 바꾸지 않았다 | 비어 있거나 없는 폴더를 지정한다 | 2 |
| `db export`, `foreign_database` | Xeon 데이터베이스가 아니다(`application_id`) | `XEON_HOME`으로 데이터 디렉터리를 확인하고 `xeon.db`가 다른 프로그램의 파일이면 옮긴다 | 3 |
| `db export`, `not_a_database` | 데이터베이스 파일이 없거나 SQLite 파일이 아니다 | `xeon chat`을 한 번 실행해 데이터베이스를 만든 뒤 다시 실행한다. 위치는 `XEON_HOME`으로 바꾼다 | 3 |
| `db export`, `busy` | 데이터베이스가 다른 쓰기로 바쁘다 | 잠시 뒤 다시 실행한다 | 3 |
| `db export`, `disk_full` | 저장 공간이 가득 찼다 | 디스크 공간을 비우고 다시 실행한다 | 3 |
| `db export`, `io`(`code`) | 내보내기 중 입출력 오류가 났다(`code`) | 대상 폴더와 데이터 디렉터리의 권한과 디스크 상태를 확인한다 | 3 |
| 데이터 디렉터리 위치를 정하지 못함(`db export`) | 데이터 디렉터리 위치를 정하지 못했다 | HOME(Windows는 USERPROFILE)과 XEON_HOME 설정을 확인한다 | 3 |

`thread.locked`의 해결 문구는 M1 기준입니다. 현재 대화형 `chat`은 `[o]` 관찰, `[f]` 분기, `[d]` 위임(서비스 접속일 때만)을 고르는 프롬프트를 띄우고, print 모드는 묻지 않고 바로 4로 끝납니다(`L4.cli.spec` §4.11).

### 7.3 서비스와 저장소의 코드 문구

아래 문구는 표 7.2에 없고 `apps/cli/src/engine.ts`와 `apps/cli/src/errors.ts`에서 가져왔습니다.

| 문구 | 종료 코드 | 해결 |
|---|---|---|
| `원격 접속 토큰이 없다` / `원격 접속 토큰이 맞지 않다` | 3 | `XEON_REMOTE_TOKEN을 서버의 토큰과 맞추고, 서버에서 xeon service status로 상태를 본다` |
| `서비스 소켓이 없다` / `서비스가 연결을 거부했다` | 3 | `원격 서비스가 켜져 있고 주소가 맞는지 확인한다` |
| `서비스 소켓에 접근할 수 없다` | 3 | `소켓 파일과 그 폴더의 소유자와 권한을 확인한다` |
| `서비스에 접속하지 못했다 (<코드>)` | 3 | `xeon service status로 서비스 상태를 확인한다` |
| `서비스가 시간 안에 응답하지 않았다` / `서비스 연결이 응답 전에 닫혔다` | 3 | `xeon service status로 서비스 상태를 확인한다` |
| `원격 접속 기능(ssh 터널)이 이 빌드에 없다` | 3 | `xeon을 다시 설치하거나 같은 버전의 바이너리를 쓴다` |
| `ssh 터널을 열지 못했다: <사유>` | 3 | `ssh 키나 ssh-agent로 암호 없이 접속되는지 확인한다` |
| `저장소가 읽기 전용이라 쓸 수 없다` | 1 | `다른 엔진이 쓰는 중인지 xeon service status로 확인한다` |
| `저장소 입출력에 실패했다` | 3 | `데이터 디렉터리의 권한과 디스크 상태를 확인한다` |
| `세션 저장소를 열지 못했다` | 3 | `데이터 디렉터리와 디스크 상태를 확인하고 다시 실행한다` |
| `데이터 디렉터리에 쓸 수 없다` | 3 | `디렉터리 권한과 파일 시스템 종류를 확인한다` |
| `상태 디렉터리 위치를 정하지 못했다` | 3 | `HOME(Windows는 USERPROFILE)과 XEON_HOME 설정을 확인한다` |
| `SQLite에 FTS5가 없다` | 3 | `FTS5가 들어 있는 SQLite를 설치한다 (macOS: brew install sqlite)` |
| `설정 키 정의가 충돌한다 (<키>)` | 1 | `설치본이나 확장이 같은 키를 정의하지 않는지 확인한다` |

`세션 저장소를 열지 못했다`는 여러 원인을 한 문구로 씁니다. 버전이 달라서 열지 못한 경우도 이 문구로 나옵니다. 원인 구분은 `eng.operations.recovery` §3과 그 문서의 미결 사항을 봅니다.

### 7.4 종료 코드

| 코드 | 뜻 | 예 |
|---|---|---|
| 0 | 정상 | turn이 `completed`로 끝났다. 명령이 성공했다 |
| 1 | 일반 오류 | turn이 `failed`, wire 오류(`internal`, `settings.invalidValue` 등), 없는 세션, `catalogConflict`·`missingService`, 예약의 기대한 실패 |
| 2 | 사용법 오류 | 모르는 플래그, 인자 누락, 명령 인자에 비밀 값, `--json`을 대화형에 씀, `--remote` 주소 문법 오류, `db export`의 대상 폴더가 비어 있지 않음 |
| 3 | 환경 문제 | FTS5 없음, sops 없음, 데이터 디렉터리 권한, 저장소 열기 실패, 서비스 도달 불가, 계약 버전 불일치, `db export`의 저장소·디스크 오류 |
| 4 | 세션 잠금 실패 후 사용자가 거부 | `thread.locked`에서 관찰·분기·위임을 고르지 않음. print 모드는 바로 4 |
| 129 | SIGHUP | 터미널이 닫혔다 |
| 130 | 중단 | Ctrl+C로 끝냈다 |
| 143 | SIGTERM | 체크포인트 뒤 끝냈다 |

- 제품 CLI의 종료 코드는 개발 레시피의 종료 코드와 뜻이 다릅니다. 개발 레시피의 3은 사람 확인이고 제품 CLI의 3은 환경 문제입니다(`L4.cli.spec` §3.6).
- 서비스 명령(`xeon service …`)은 0, 1, 2만 냅니다.

## 8. 비밀 키 추가

- 사용자 키는 `xeon secret add <이름>`으로 추가합니다. 값은 프롬프트(두 번 입력해 비교)나 stdin으로만 받습니다. 값을 명령 인자로 넘기면 사용법 오류(2)입니다(`L4.cli.spec` §4.7).
- 추가 옵션은 `--desc`, `--scope`, `--expires`, `--hosts`입니다. 스펙은 `--provider`에 `sops`만 받는다고 정합니다(`L4.cli.spec` §4.7). 파서는 `sops`, `op`, `bws`, `keychain`을 받으므로 나머지 값의 동작은 확인하지 못했습니다 [미결 13].
- 등록된 이름은 `xeon secret ls`로 봅니다. `xeon secret test <이름>`은 존재 여부, 복호화 가능 여부, 길이, SHA-256 앞 8자만 출력합니다. 값은 출력하지 않습니다.
- 설정 값으로 비밀을 참조할 때는 `secret://<이름>` 형식을 씁니다.
- `just secret-add <키> [env]`는 저장소 개발용 비밀에만 씁니다. 이 레시피는 저장소 `justfile`에 없고 루트 `justfile`의 주석이 가리키는 외부 레시피에서 옵니다. 제품 사용자의 키에는 쓰지 않습니다.

## 미결 사항

1. `PATH`에 넣는 방법과 설치 위치 절차가 없습니다(`L4.release.spec` 미정).
2. `l0.os.dirs.override`는 설정 카탈로그에 있지만 호스트 조립(`apps/host/src/assemble.ts`의 `osPlatform` 호출)이 `dirsOverride`를 넘기지 않습니다. 지금은 `XEON_HOME`만 적용됩니다.
3. 로그 회전: `L0.os.spec` §3.5의 회전 싱크가 호스트 조립에 연결되어 있지 않습니다. 호스트는 `appendFileSync`로 한 파일에 덧붙입니다.
4. `OsDirs`에 `log` 항목이 없습니다. 로그 위치는 `state/logs/`라는 관례로 정해져 있습니다. 문서와 코드가 같은지 확인이 필요합니다.
5. `xeon doctor`의 서비스 모드 문구("chat은 아직 서비스에 접속하지 않고 in-process로 동작한다")는 `apps/cli/src/engine.ts`의 서비스 접속 경로와 다릅니다. 설정이 켜져 있으면 CLI는 서비스에 붙습니다.
6. `XEON_SAFE_MODE` 환경 변수, `/safe-mode` 슬래시 명령, `--disable-ext` 옵션은 `X.operations.spec` §4.6.1에 있지만 CLI 소스에서 찾지 못했습니다.
7. TCP 토큰을 클라이언트로 옮기는 절차와 토큰을 바꾸는 명령이 없습니다. 호스트의 `rotateToken`은 호출하는 곳을 찾지 못했습니다.
8. `.sha256` 검사 명령은 제품이 정하지 않았습니다. 형식(`<해시>  <파일 이름>`)만 확인했습니다.
9. 관리(`managed`) 설정 파일의 위치가 정해지지 않았습니다(`F.wire-settings.spec` §3.9). 관리 범위의 값을 파일로 읽을 수 없습니다.
10. `xeon ext enable`·`disable` 같은 확장 켜기·끄기 명령이 CLI에 없습니다(`X.operations.spec` §4.3.5의 제안).
11. `aarch64-unknown-linux-gnu` 아카이브는 빌드 대상이지만 스모크 검사가 없습니다(`L4.release.spec` §8.2 7번).
12. 서비스 기동 사유 `auth_failed`의 해결 문구가 소스에 없습니다(`packages/platform-process/src/service/ensure.ts`).
13. `secret add --provider`: 스펙은 `sops`만 받고 파서는 네 값을 받습니다(`apps/cli/src/cli/command.ts`). 나머지 제공자의 동작을 확인하지 못했습니다.
