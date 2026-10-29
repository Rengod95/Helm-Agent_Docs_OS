---
id: eng.operations.recovery
layer: eng
domain: operations
kind: guide
status: draft
depends_on: [L0.store.spec, L1.persistence.spec, L2.schedule.spec, L4.cli.spec, L4.host-service.spec, L4.settings-ui.spec, F.records.spec, F.wire-settings.spec, X.operations.spec, eng.operations.runbook]
binds: []
---

# 복구 런북

이 문서는 증상별로 원인과 조치를 적습니다. 데이터를 건드리기 전에 §1의 복사를 먼저 합니다. 복원 절차가 소스에 정해지지 않은 부분은 `[미결]`로 표시했고, 문서 끝 "미결 사항"에 모았습니다.

설치, 로그 위치, `xeon doctor`, 오류 kind 표는 `eng.operations.runbook`을 봅니다.

## 1. 복구 전에 할 일

### 1.1 증상

- 데이터가 깨진 것 같습니다.
- 엔진이 열리지 않습니다.
- 같은 오류가 반복됩니다.

### 1.2 조치

1. `xeon doctor`를 실행해 출력을 보관합니다. 오류 문구에 `traceId`가 있으면 그 값도 보관합니다(`L4.cli.spec` §4.10, `internal`).

   ```
   xeon doctor
   xeon doctor --json
   ```

2. 데이터를 복사합니다. 가능하면 `xeon db export`를 씁니다. 자세한 방법은 §2입니다.
3. 데이터 디렉터리를 직접 복사할 때는 엔진을 멈춘 뒤 복사하는 것을 권장합니다. 엔진이 떠 있으면 WAL에 있는 최근 내용이 사본에 빠질 수 있습니다 [가정]. 데이터 디렉터리의 위치는 `eng.operations.runbook` §2입니다.

   ```
   cp -a <데이터 디렉터리> <백업 폴더>/
   ```

4. 복사본을 확보하기 전에는 데이터 디렉터리의 파일을 덮어쓰거나 지우지 않습니다. `store.corrupt`의 해결 문구도 같은 순서를 요구합니다(`L4.cli.spec` §4.10).

## 2. DB 내보내기 (`xeon db export`)

### 2.1 증상

- 백업이나 보관용 사본이 필요합니다.
- 엔진이 열리지 않아서 데이터를 꺼낼 수 없습니다.

### 2.2 원인과 성격

`xeon db export`는 데이터 디렉터리의 `xeon.db`를 읽기 전용으로 열어 사본을 만듭니다(`L0.store.spec` §4.10, `L4.cli.spec` §4.13).

- 엔진을 띄우지 않습니다. 엔진이 떠 있어도 됩니다.
- DB를 만든 버전과 상관없이 내보냅니다. 더 새 버전이 만든 DB도 내보낼 수 있습니다(§3).
- 실패하면 이 호출이 만든 파일과 디렉터리만 지웁니다. 원래 있던 빈 폴더는 지우지 않습니다.

### 2.3 조치

```
xeon db export <폴더>
xeon db export <폴더> --json
```

1. `<폴더>`가 없으면 만듭니다. 있으면 비어 있어야 합니다. 상대 경로는 `-C`로 정한 작업 폴더 기준입니다.
2. 성공하면 `exported <N> blobs to <절대 경로>`를 씁니다. `--json`이면 `destDir`, `exportedAt`, `blobCount`, `missingBlobs`를 담은 JSON을 씁니다.
3. 블롭 파일이 없으면 `경고: 블롭 파일이 없어 빠졌다: <sha256>` 줄을 stderr에 씁니다. 열 줄을 넘으면 앞의 열 줄만 쓰고 나머지 개수를 한 줄로 알립니다. 누락이 있어도 종료 코드는 0입니다. 누락 목록은 `manifest.json`의 `missingBlobs`에 있습니다. `--json`이면 이 경고는 stderr에 쓰지 않습니다.
4. 데이터 디렉터리를 `XEON_HOME`으로 옮겨 두었다면 같은 값을 줍니다. `XEON_HOME`은 절대 경로여야 합니다.

   ```
   XEON_HOME=<절대 경로> xeon db export <폴더>
   ```

### 2.4 사본의 구성

| 경로 | 내용 | 모드 |
|---|---|---|
| `<폴더>/xeon.sqlite` | `VACUUM INTO`로 만든 복사본. WAL 내용을 포함하고 저널 모드는 delete입니다 | 0600 |
| `<폴더>/blobs/<ab>/<나머지>` | `sys_blobs`의 행마다 원본 블롭을 복사한 파일 | 디렉터리 0700, 파일 0600 |
| `<폴더>/manifest.json` | 내보내기 기록 | 0600 |

`manifest.json`의 형식은 다음과 같습니다. `format`은 디렉터리 구조의 버전입니다.

```json
{ "format": 1, "exportedAt": 1767571200000, "sqliteFile": "xeon.sqlite", "blobCount": 1, "missingBlobs": [] }
```

사본의 DB 파일 이름은 `xeon.sqlite`입니다. 원본 데이터 디렉터리의 `xeon.db`와 다릅니다.

### 2.5 실패 문구

| kind | 문구 | 해결 | 종료 코드 |
|---|---|---|---|
| `dest_not_empty` | 내보낼 폴더가 비어 있지 않다 (아무것도 바꾸지 않았다) | 비어 있거나 없는 폴더를 지정한다 | 2 |
| `foreign_database` | Xeon 데이터베이스가 아니다 (`application_id`) | `XEON_HOME`으로 데이터 디렉터리를 확인한다. `xeon.db`가 다른 프로그램의 파일이면 옮긴다 | 3 |
| `not_a_database` | 데이터베이스 파일이 없거나 SQLite 파일이 아니다 | `xeon chat`을 한 번 실행해 데이터베이스를 만든 뒤 다시 실행한다. 위치는 `XEON_HOME`으로 바꾼다 | 3 |
| `busy` | 데이터베이스가 다른 쓰기로 바쁘다 | 잠시 뒤 다시 실행한다 | 3 |
| `disk_full` | 저장 공간이 가득 찼다 | 디스크 공간을 비우고 다시 실행한다 | 3 |
| `io`(`code`) | 내보내기 중 입출력 오류가 났다(`code`) | 대상 폴더와 데이터 디렉터리의 권한과 디스크 상태를 확인한다 | 3 |
| 데이터 디렉터리 위치를 정하지 못함 | 데이터 디렉터리 위치를 정하지 못했다 | HOME(Windows는 USERPROFILE)과 XEON_HOME 설정을 확인한다 | 3 |

출처는 `L0.store.spec` §4.10의 `ExportError`와 `apps/cli/src/errors.ts`입니다. 오류 값의 `code`는 파일 시스템의 원래 코드(예: `EACCES`)이고 값은 싣지 않습니다.

### 2.6 되돌리기

내보낸 사본을 데이터 디렉터리로 되돌리는 절차는 `xeon db export`가 하지 않습니다(`L4.cli.spec` §4.13). 되돌리는 절차는 정해지지 않았습니다 [미결 1].

## 3. `future_version`: 더 새 버전이 만든 DB

### 3.1 증상

- `xeon chat`이 열리지 않습니다. 현재 CLI 문구는 다음과 같습니다(`apps/cli/src/engine.ts`).

  ```
  xeon: 세션 저장소를 열지 못했다
    해결: 데이터 디렉터리와 디스크 상태를 확인하고 다시 실행한다
  ```

  종료 코드는 3입니다. 버전이 원인이라는 문구는 나오지 않습니다 [미결 3].

  호스트 쪽 분류는 `storeFutureVersion`(분류 `future_version`)입니다. 이 값을 CLI가 구별해 안내해야 한다고 `L4.host-service.spec` §3.3.5(HS-68)가 정합니다.

### 3.2 원인

`xeon.db`의 sys 마이그레이션 버전이 이 빌드의 코드 버전보다 높습니다. 더 새 빌드로 만든 DB를 옛 빌드로 열었습니다. 앱을 되돌린 경우입니다(`L0.store.spec` §4.6 3번, `F.records.spec` §3.7의 `migration_future_version`).

### 3.3 되는 것과 안 되는 것

| 동작 | 결과 |
|---|---|
| 엔진 열기(`xeon chat` 등 엔진을 쓰는 명령) | 열지 않습니다. 마이그레이션도 하지 않습니다 |
| `xeon db export` | 됩니다. 버전과 상관없이 사본을 만듭니다 |
| 읽기 전용 열기(`openStore({ readOnly: true })`) | L0 API로는 열립니다. `warnings`에 `read_only`(`future_version`)가 남고 쓰기는 모두 거절합니다(`L0.store.spec` §4.11). 제품 명령이 이 열기를 쓰는지는 확인하지 못했습니다 [미결 4] |

### 3.4 조치

1. 현재 빌드 버전을 확인합니다.

   ```
   xeon version
   ```

2. DB를 만든 버전과 같거나 더 새 빌드를 받아 실행합니다. 설치 절차는 `eng.operations.runbook` §1입니다.
3. 새 빌드에서 엔진이 열리는지 확인합니다.

   ```
   xeon doctor
   ```

4. 옛 빌드로 되돌아가야 하면 먼저 §2의 사본을 만듭니다. 옛 빌드에서 DB를 되돌리는 절차는 정해지지 않았습니다 [미결 1].

DB가 어느 버전으로 만들어졌는지 보여 주는 명령은 없습니다 [미결 4].

## 4. 손상된 예약 상태 (`schedule/state.json`)

### 4.1 증상

```
xeon schedule list --all
xeon: 예약 상태 파일을 읽거나 쓰지 못했다
  해결: 상태 디렉터리의 schedule/state.json을 고치거나 지운다. 지우면 예약이 모두 사라진다
```

- 종료 코드는 3입니다(`L4.cli.spec` §4.14).
- `schedule add`, `schedule cancel`, `schedule run`도 같은 오류로 끝납니다. `cancel`은 상태를 먼저 읽으므로 손상된 상태에서는 쓸 수 없습니다.
- 서비스 모드에서는 상태를 읽지 못하면 틱과 파일 감시가 켜지지 않습니다(`L2.schedule.spec` §4.4.9).

### 4.2 원인

- 파일이 JSON이 아닙니다. 또는 최상위 형태가 맞지 않습니다. 또는 파일을 읽지 못했습니다(권한, 입출력). 이 세 경우의 호스트 내부 메시지는 `state file is not JSON`, `state file has an invalid shape at …`, `state file cannot be read`입니다(`apps/host/src/assembly/schedule-store.ts`).
- 엔진은 읽지 못한 파일을 빈 상태로 덮어쓰지 않습니다. 파일은 그대로 남습니다(`L2.schedule.spec` §4.4.9, `apps/host/src/assembly/schedule-store.ts`).
- 파일이 없으면 예약이 없는 상태로 봅니다.
- CLI 문구는 원인의 위치를 싣지 않습니다. 호스트가 준 메시지 원문은 문구에 넣지 않습니다(`L4.cli.spec` §4.14). 위치는 파일을 직접 열어서 찾습니다.

### 4.3 조치

1. 파일 위치를 확인합니다. 상태 디렉터리는 `<state>/schedule/state.json`입니다. OS별 위치는 `eng.operations.runbook` §2입니다.
2. 고치기 전에 사본을 만듭니다.

   ```
   cp <state>/schedule/state.json <백업 폴더>/
   ```

3. 파일 형식을 확인합니다. 최상위는 `version`(값 1), `entries`(배열), `runs`(배열)입니다. 항목의 필드는 `apps/host/src/assembly/schedule-store.ts`의 스키마에 있습니다.
4. 둘 중 하나를 고릅니다.
   - 고치기: JSON을 스키마에 맞춥니다. 검사하는 명령은 없습니다 [미결 5].
   - 지우기: 파일을 지우면 모든 예약이 사라집니다. 사본을 만든 뒤에만 합니다.

     ```
     rm <state>/schedule/state.json
     xeon schedule list --all
     ```

     지운 뒤에는 `예약이 없다`가 나옵니다(`L4.cli.spec` §4.14).
5. 파일이 정상으로 읽히면 예약을 확인하고, 끌 예약은 `cancel`로 끕니다.

   ```
   xeon schedule list --all
   xeon schedule cancel <id>
   ```

6. 필요한 예약을 다시 만듭니다. 형식은 `xeon help schedule`로 확인합니다.

## 5. 투영기 실패 격리

### 5.1 증상

- 코어 투영기가 실패하면 턴이 `internal` 오류(`traceId`)로 끝납니다. 원문은 로그에만 남습니다. 커밋은 롤백됩니다.
- 확장이나 능력(`cap.*`) 투영기가 실패하면 세션은 계속됩니다. 로그에 `session.projector_suspended`가 남습니다. 확장이면 X가 자동으로 끌 수 있습니다.

### 5.2 원인

- 투영기의 `apply`가 오류를 돌려주거나 예외를 던졌습니다. 실패 알림의 모양(`ProjectorFailure`)과 등록 인터페이스는 `packages/contracts/src/records/projector.ts`에 있습니다.
- `core` 투영기의 예외는 코드 결함으로 봅니다. 커밋을 롤백하고 Bug `store.projection_failed`를 다시 던집니다. 정지하지 않습니다(`L1.persistence.spec` §4.5.2).
- 확장과 능력 투영기의 예외는 세션을 멈추지 않습니다. 트랜잭션을 롤백하고, 그 투영기만 멈춘 뒤, 멈춘 투영기를 뺀 채 같은 커밋을 다시 시도합니다(`L1.persistence.spec` §4.5.2).
- 멈춘 투영기의 테이블은 낡은 채로 남습니다. 멈춘 뒤의 커밋은 그 투영기의 `last_seq`를 올리지 않습니다.
- X는 확장 투영기가 실패하면 자동 끄기를 판정합니다. 끌 수 없는 것은 `guard`와 `core` 계층, `essential: true` 확장입니다(`X.operations.spec` §4.3.3, §5 6번).
- 능력 투영기(`cap.*`)에도 같은 격리를 적용하는지는 정해지지 않았습니다. 코드는 코어가 아닌 투영기를 같은 경로로 다룹니다 [미결 7].

### 5.3 조치

1. 로그 파일에서 사건을 찾습니다. 로그 위치는 `eng.operations.runbook` §3입니다.

   ```
   grep -E 'session\.projector_|store\.projection_failed' <로그 파일>
   ```

2. 멈춤 표시는 프로세스 안에만 있습니다. 재시작하면 표시가 사라지고, 투영기를 다시 등록할 때 이벤트에서 다시 만듭니다(`L1.persistence.spec` §4.5.2).
   - 서비스 모드라면 서비스를 다시 띄웁니다.

     ```
     xeon service stop
     xeon service start
     ```

   - 대화형 `chat`은 실행할 때마다 엔진을 새로 엽니다.
3. 멈춘 투영기는 다음 쓰기 열기에서 다시 만들어집니다. 그 세션을 쓰기 모드로 여는 명령을 씁니다.

   ```
   xeon chat --resume <세션 id>
   ```

   다시 만들기에 성공하면 멈춤이 풀립니다. 실패하면 `session.projector_rebuild_failed`가 남고 멈춘 상태가 유지됩니다(`L1.persistence.spec` §4.5.2).
4. 다시 만들기도 실패하면 로그의 줄과 `xeon doctor` 출력을 보고합니다.
5. 코어 투영기 실패(`internal`)는 `xeon doctor`를 실행하고 `traceId`를 보고합니다(`L4.cli.spec` §4.10).
6. 자동으로 꺼진 확장을 다시 켜는 CLI 명령은 구현되지 않았습니다 [미결 6]. 재시작하면 장부가 비워지고 확장을 다시 싣습니다(`X.operations.spec` §4.3.5).

### 5.4 코어 투영 버전 올림

- 투영 규칙의 테이블 모양이나 규칙이 바뀌면 `CORE_PROJECTOR_VERSION`을 올립니다. 현재 값은 5입니다(`packages/core-persistence/src/projector/core.ts`).
- 저장소를 열 때 저장된 투영 버전과 다르면 코어 투영기만 이벤트에서 다시 만듭니다. 사용자가 할 일은 없습니다.
- 재생성은 투영기마다 한 트랜잭션입니다. 테이블을 지우고, DDL을 실행하고, 이벤트를 seq 순으로 다시 적용합니다. 이벤트가 많으면 첫 열기가 오래 걸립니다(`L1.persistence.spec` §4.5.3).
- 이벤트가 많을 때 청크로 나눠 다시 만드는 규칙은 [제안]이고 구현 여부를 확인하지 못했습니다 [미결 7].

## 6. 설정 충돌

### 6.1 증상

- 설정한 값이 적용되지 않습니다. `xeon config get`에 `pending:`이 보입니다.
- 값이 예상과 다릅니다. 다른 범위의 값이 이깁니다.
- `settings.locked`: 관리 설정이 잠근 키입니다. 해결은 관리자에게 요청하는 것입니다.
- `settings.scopeNotAllowed`: 그 범위에 쓸 수 없는 키입니다. 해결은 `allowedScopes`를 확인하는 것입니다(`L4.cli.spec` §4.10).
- 시작할 때 `설정 키 정의가 충돌한다 (<키>)`가 나오고 종료 코드는 1입니다(`catalogConflict`).

### 6.2 원인

- 우선순위는 높은 쪽부터 관리(잠금), 세션, 로컬, 프로젝트, 사용자, 기본값입니다. 값을 정한 가장 높은 범위가 이깁니다. 가려진 값은 `shadowed`로 보입니다(`F.wire-settings.spec` §4.7, [제안]).
- 값의 병합 단위는 키 하나입니다. 객체나 배열도 깊게 합치지 않고 통째로 바꿉니다(`F.wire-settings.spec` §4.7 규칙 2).
- 키의 `allowedScopes`에 없는 범위에 있는 값은 무시하고 경고를 남깁니다(`F.wire-settings.spec` §4.7 규칙 4).
- 파일의 값이 스키마에 맞지 않으면 그 범위의 값만 건너뛰고 진단을 남깁니다(`L4.host-service.spec` §5). 진단은 경고 로그로 남습니다(`apps/host/src/assemble.ts`).
- `settings.set`에는 버전 조건이 없습니다. 두 곳에서 같은 키를 쓰면 나중 쓰기가 남습니다(`L4.settings-ui.spec` §4.5.3). 데스크톱 화면은 초안이 있는 항목에 `remoteChanged` 안내를 보입니다. CLI에는 초안이 없습니다.
- `catalogConflict`는 같은 설정 키를 두 확장이나 설치본이 정의했다는 뜻입니다(`apps/cli/src/engine.ts`).

### 6.3 조치

1. 값과 출처를 봅니다.

   ```
   xeon config get <키>
   ```

   출력의 `source:`는 이기는 범위와 파일 경로입니다. `shadowed:`는 가려진 범위입니다. `[locked: <범위>]`는 잠금이고 `pending:`은 적용 시점입니다(`apps/cli/src/commands/config.ts`).
2. 이기는 값을 지우거나 원하는 범위에 씁니다. 범위를 생략하면 `user`입니다.

   ```
   xeon config reset <키> --scope user
   xeon config set <키> <값> --scope user
   ```

   `project`와 `local`은 `--scope project`, `--scope local`로 씁니다. 파일은 작업 폴더의 `.xeon/settings.json`과 `.xeon/settings.local.json`입니다. 신뢰하지 않은 작업 폴더의 프로젝트 설정은 읽기 전용입니다(`apps/host/src/assembly/settings-store.ts`). 작업 폴더를 CLI에서 어떻게 정하는지는 확인하지 못했습니다 [미결 8].
3. 다시 확인합니다.

   ```
   xeon config get <키>
   ```

4. 비밀 키에는 값 대신 참조만 씁니다. 형식은 `secret://<이름>`입니다. 참조가 아닌 값은 `settings.secretValue`로 거부됩니다(`L4.cli.spec` §4.10).
5. `managed` 범위는 CLI에서 쓸 수 없습니다. `--scope managed`는 사용법 오류입니다. 호스트에 `managed` 범위 쓰기가 오면 `settings.scopeNotAllowed`(3103)에 `reason: managedReadOnly`로 거부합니다(`L4.host-service.spec` §4.14, `apps/host/src/handlers/settings.ts`). 잠긴 키는 관리자에게 요청합니다. 관리 정책 파일의 위치는 정해지지 않았습니다 [미결 9].
6. `catalogConflict`가 나오면 같은 키를 정의한 확장이나 설치본을 찾아 한쪽을 제거하거나 맞춥니다. 오류의 `(<키>)` 목록이 충돌한 키입니다.

## 7. 저장된 데이터가 스키마와 다름 (`store.corrupt`)

### 7.1 증상

```
xeon: 저장된 데이터가 스키마와 다르다 (<표>.<열>)
  해결: xeon doctor를 실행하고 보고한다. 데이터 디렉터리를 복원하기 전에 복사해 둔다
```

종료 코드는 1입니다. `where`는 문제가 있는 위치입니다(`L4.host-service.spec` §5, `L4.cli.spec` §4.10).

### 7.2 원인

저장된 행이 현재 스키마와 맞지 않습니다(`row_invalid`).

### 7.3 조치

1. `xeon doctor` 출력과 `where` 값을 보관합니다.
2. §1과 §2에 따라 데이터 디렉터리와 사본을 확보합니다.
3. 보고합니다. 손상된 행을 고치는 절차는 정해지지 않았습니다 [미결 2].

## 8. 마이그레이션 전 스냅샷

### 8.1 증상

- 업그레이드 뒤 로그에 `store.migration_snapshot`(info)이 남습니다.
- 데이터 디렉터리의 `backups/` 폴더에 파일이 생겼습니다.
- 스냅샷을 만들지 못하면 엔진이 열리지 않습니다. CLI 문구는 `세션 저장소를 열지 못했다`이고 종료 코드는 3입니다.

### 8.2 원인과 동작

- 기존 DB의 owner가 적용된 버전 1 이상이고 올릴 단계가 남아 있으면, 단계를 실행하기 직전에 `VACUUM INTO`로 스냅샷을 만듭니다(`L0.store.spec` §4.6.1). 처음 만드는 DB, 최신 상태의 호출, 처음 등록하는 owner에서는 만들지 않습니다.
- 이름은 `xeon.db.pre-<UTC 시각>-<owner>-v<from>-to-v<to>.sqlite`입니다. 시각은 `YYYYMMDDTHHMMSSmmmZ` 형식이라 이름순이 시간순입니다.
- 위치는 `<데이터 디렉터리>/backups/`입니다. 디렉터리는 0700, 파일은 0600입니다.
- 같은 DB의 스냅샷은 최근 3개만 남깁니다. 오래된 것을 지우지 못하면 `store.snapshot_prune_failed`(warn)을 남기고 계속합니다.
- 스냅샷을 만들지 못하면 마이그레이션 단계를 하나도 실행하지 않습니다. 디스크가 가득 찼으면 `disk_full`, 바쁘면 `busy`, 그 밖은 `migration_failed`이고 코드는 `snapshot_failed:<코드>`입니다(`L0.store.spec` §4.6.1).

### 8.3 조치

1. 스냅샷 목록을 봅니다.

   ```
   ls <데이터 디렉터리>/backups/
   ```

2. 스냅샷을 만들지 못한 경우는 디스크 공간을 확보한 뒤 다시 실행합니다.
3. 스냅샷으로 되돌리는 절차는 정해지지 않았습니다 [미결 1].

## 미결 사항

1. 되돌리는 절차가 소스에 없습니다. `xeon db export` 사본이나 마이그레이션 스냅샷을 데이터 디렉터리로 되돌리는 방법, 엔진을 멈추는 순서, WAL 파일(`xeon.db-wal`, `xeon.db-shm`)의 처리를 정해야 합니다(`L4.cli.spec` §4.13이 M3 복구 런북에 맡겼습니다).
2. `store.corrupt`로 판정된 데이터를 고치는 절차가 없습니다.
3. 저장소 열기 실패 문구가 `future_version`, `corrupt`, `migration_failed`를 구별하지 않습니다. `apps/cli/src/engine.ts`의 `storeError`는 `fts5Missing`과 `dataDirPermission`만 구별하고 나머지는 `세션 저장소를 열지 못했다`로 씁니다. `L4.host-service.spec` §3.3.5는 이 값을 구별한다고 씁니다.
4. 읽기 전용 열기(`openStore({ readOnly: true })`)를 쓰는 제품 명령이 없습니다. DB의 버전 번호를 보여 주는 명령도 없습니다.
5. 예약 상태 파일을 검사하거나 고치는 도구가 없습니다. 파일 스키마는 소스에서만 확인할 수 있습니다.
6. 자동으로 꺼진 확장을 다시 켜는 CLI 명령(`xeon ext enable`)이 없습니다(`X.operations.spec` §4.3.5의 제안).
7. `cap.*` 능력 투영기에 같은 격리를 적용할지 정해지지 않았습니다(`L1.persistence.spec` §10 19번). 청크 재생성(`L1.persistence.spec` §4.5.3)의 구현 여부를 확인하지 못했습니다.
8. 프로젝트와 로컬 설정을 CLI에서 쓸 때 작업 폴더를 정하는 방법을 확인하지 못했습니다.
9. 관리 정책 파일의 위치가 정해지지 않았습니다(`F.wire-settings.spec` §3.9).
