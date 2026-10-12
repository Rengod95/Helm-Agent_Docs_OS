# 17. 데몬과 운영

- 작성: 2026-10-11, P11(데몬)
- 상태: 2a단계 통합판(2026-10-12). 브리프 결정 41~46과 조정자 판정(`process/rulings-stage2a.md`)을 반영하고 01~16·19~21의 요구를 처리했다. 1단계 초안 머리말: 06(P3)·16(P10)·19(P12)·20(P13)의 1단계 초안을 읽고 맞췄다. 08·09(P5), 10·11(P6), 12·13(P7)은 이 문서를 쓰는 동안 아직 없었다. 그 문서들이 소유하는 이름(이벤트 이름, 테이블, 복구 알고리즘 세부)은 브리프 §3 공통 계약과 `<대상>.<과거형 동사>` 점 표기로 임시로 쓰고 §5.2에 요구로 적었다.
- 소유: `helmd` 프로세스 모델, 수명주기(시작·종료 순서, 신호, 단일 인스턴스), WSL 운영(systemd 단위, 재시작 정책, Windows 쪽 사건별 동작), 저장 위치, 백업·복구·복구 훈련의 운영 절차, 업그레이드와 되돌리기, 상태 확인·진단, 운영 로그, 리소스 한도, 데몬 관련 `justfile` 레시피, 관리 CLI(`@helm/cli`) 명령 목록, 리스너 주소·소켓 경로.
- 소유하지 않음: 보안 정책 전부(인증, 페어링, 토큰, 비밀 마스킹, 도구 격리 요구)는 짝 문서 18이 소유한다. 이벤트 envelope·DDL·마이그레이션 내용·백업 파일의 DB 수준 형식은 09, 크래시 복구 알고리즘과 스케줄러는 12, 도구 실행·프로세스 생성은 13, 프로토콜 메시지·메서드 이름·핸드셰이크 형식은 19, 앱 쪽 SSH 실행·키체인은 20이 소유한다.
- 출처 표기: "facts-2 §8"은 `docs/design/process/sources/pi-api-facts-2.md` 8절, "사례 §12.1-3"은 `sources/pi-cases-notes.md` 12.1절 3번, "S4 openclaw-runtime §2.4"는 `.helm-design-work/S4/openclaw-runtime.md` 2.4절, "발췌1 E1-094"는 `sources/conversation-extracts-1.md` 항목, "oss §5"는 `docs/v0.3/audit/backend-oss-research.md` 5절, "homelab storage.md"는 `~/projects/homelab/context/storage.md`, "[실험 N]"은 §2.2 표의 N번 행이다.

## 1. 목적과 범위

### 1.1 목적

Helm 데몬 `helmd`를 제품 소유자의 WSL2 서버에서 상주시키고(결정 20·22), 클라이언트 없이도 작업을 계속하며, 망가졌을 때 되살릴 수 있게 운영하는 방법을 정한다. 구현자가 이 문서만 보고 다음을 만들 수 있어야 한다.

1. `@helm/daemon`의 프로세스 골격: 설정 로딩, 단일 인스턴스 잠금, 시작·종료 순서, 신호 처리, 크래시 루프 차단, 이벤트 루프 감시, 상태 보고, 백업·복구·훈련 실행기.
2. `@helm/cli`의 운영 명령(`helm status`, `helm doctor`, `helm ops …`, `helm diag …`).
3. 저장소의 운영 파일: systemd 단위 원본(`ops/systemd/*.in`), 설치·업그레이드·되돌리기 스크립트(`ops/bin/*`), Windows 확인 스크립트(`ops/windows/check-helm-host.ps1`), `justfile`의 `daemon-*` 레시피.

### 1.2 다루는 것

- 프로세스 모델: `helmd` 단일 프로세스, 스레드 모델, 자식 프로세스(도구 실행, 관찰 에이전트, 비밀 로더)와의 관계
- 수명주기: 시작 순서(설정 → 잠금 → DB 열기·마이그레이션 → `bootEpoch` → 복구 → 스케줄러 → 리스너), 종료 순서, 신호, 종료 코드, 단일 인스턴스 보장, 크래시 루프 차단
- 리스너 배치(주소·포트·소켓 경로). 리스너별 인증 규칙은 18
- WSL 운영: systemd 확인, user unit 선택, linger, 단위 파일 전문, 재시작 정책, Windows 절전·재부팅·WSL 종료 때 동작, keepalive, 시간
- 저장 위치: 데이터·설정·런타임·상태·캐시·릴리스 경로
- 백업·복구: 온라인 백업, restic 연계, 복구 절차와 검증, 복구 훈련
- 업그레이드: 릴리스 디렉터리, 절차, 마이그레이션 실행, 되돌리기, 다운그레이드 거부
- 상태 확인: 헬스 엔드포인트, `helm status`, `helm doctor`, 진단 묶음
- 운영 로그(journald)와 보존, 리소스 한도
- Windows 호스트 쪽 작업: `serve.table` 한 줄, 방화벽, 확인 스크립트
- `justfile` 레시피, 관리 CLI 명령 목록

### 1.3 다루지 않는 것

| 주제 | 소유 문서 |
|---|---|
| 위협 모델, 리스너별 인증, 페어링, 토큰 수명, 비밀 마스킹, 도구 격리 보안 요구, 감사, 속도·크기 한도 | 18 |
| 이벤트 envelope, 이벤트 이름 카탈로그, SQLite DDL·PRAGMA 최종값, 해시 체인, 마이그레이션 내용, 투영 재구성 | 09 |
| 크래시 복구 알고리즘(중단된 도구 호출 정리, 실행 재개, 재시도 예산), 스케줄러·타이머, 놓친 타이머 따라잡기 | 12 |
| 도구 실행과 자식 프로세스 생성, 프로세스 원장 레코드, 격리 수단의 구현 | 13 |
| 관찰 에이전트의 내부와 IPC | 16 §3.2 |
| 프로토콜 메서드 이름, 핸드셰이크 메시지, 오류 코드, `storeId` 의미, 생존 확인 주기 | 19 |
| 앱의 SSH 실행 방식, 키체인, 앱 빌드·배포 | 20 |
| 저장소 전체 `justfile`(setup, check, verify, dev, build), 패키지 경계, 설정 형식 전반, 로깅 라이브러리 | 06, 23 |
| 홈랩 저장소의 변경(백업 대상 추가, `serve.table`) | 홈랩 소유자. 이 문서는 요청 내용만 §3.7.4에 적는다 |

### 1.4 이 문서에서 쓰는 말

| 말 | 뜻 |
|---|---|
| `helmd` | Helm 데몬 프로세스. 패키지 `@helm/daemon`의 실행 진입점 |
| 릴리스 | 한 git 커밋에서 빌드한 실행 가능한 데몬·CLI 묶음. `/srv/volumes/helm/app/releases/<릴리스 ID>/` |
| `bootEpoch` | `helmd` 프로세스가 시작할 때마다 새로 만드는 ULID. 이전 프로세스가 남긴 "실행 중" 상태를 가려내는 데 쓴다 |
| `storeId` | 이벤트 저장소의 정체(19 §1.4 "저장소 ID"). 복구로 seq 연속성이 끊기면 바뀐다. 값의 저장 위치는 09 |
| 깨끗한 종료 / 비정상 종료 | 종료 순서 §3.4.3을 끝까지 마치고 `daemon.stopped`를 쓴 종료 / 그렇지 않은 모든 종료(SIGKILL, OOM, WSL 종료, 정전) |
| 안전 모드 | 크래시 루프가 감지되었을 때 실행 자동 재개와 스케줄러를 멈추고 사람의 확인을 기다리는 데몬 모드(§3.4.6) |
| 로컬 관리자 | `local` 리스너(Unix 소켓)로 붙은 같은 사용자 프로세스. 19의 `localAdmin` 주체 |

### 1.5 관련 유즈케이스

| 유즈케이스 | 이 문서에서 다루는 곳 |
|---|---|
| UC-03 여러 날 걸리는 작업 | 상주(§3.6), 재시작 정책과 복구 순서(§3.4), Windows 사건별 동작(§3.6.6) |
| UC-04 외부에서 접속해 질문에 답하기 | 리스너 배치(§3.5), `serve.table`(§3.7), 상태 확인(§3.11) |
| UC-06 복귀 요약 | 데몬이 꺼져 있던 구간을 상태와 이벤트로 남김(`daemon.booted`의 이전 종료 정보, §3.4.2) |
| UC-08 반복 마찰 제안 | 관찰 에이전트 자식 프로세스의 자원·격리(§3.1.3, §3.13) |

## 2. 전제와 결정

### 2.1 브리프 결정에서 오는 전제

| 결정 | 이 문서에 미치는 것 |
|---|---|
| 20 | `helmd`는 Windows PC 안의 WSL2 Ubuntu에서 돈다 [결정] |
| 21, 26 | 외부 접속은 Windows 호스트의 `tailscale serve`(HTTPS/WSS)로 한다. `helmd`는 127.0.0.1에만 바인딩한다. Funnel은 쓰지 않는다 [결정 21, 26은 조정자 기본값] |
| 22 | 클라이언트가 없어도 작업이 계속된다. 데몬은 상주하고, 꺼졌다 켜져도 이어 간다 [결정] |
| 29 | 기준 원본은 SQLite 이벤트 로그(WAL, WSL ext4)다. 백업 대상의 중심은 이 파일 하나다 |
| 30 | 크래시 복구는 "실행 의도 → 실행 → 결과" 기록에 기대고, 재시작 시 중단된 도구 호출을 "중단됨"으로 정리한다. 복구는 DB의 성질이고 종료 훅의 성질이 아니다. 그래서 종료 순서는 "최선을 다하는 기록"이고, 정확성은 시작 때의 복구가 책임진다 |
| 31 | 클라이언트는 재접속 때 `lastSeq`부터 다시 받는다. 데몬이 재시작해도 seq는 이어진다(SQLite에 있음). 복구로 seq가 되돌아가면 `storeId`가 바뀐다 |
| 33, 38, 39 | 데스크톱 앱은 tailscale serve WSS와 SSH 두 경로로, TUI는 SSH로 WSL에 들어가 로컬 리스너로 붙는다. 리스너 배치는 이 셋을 받는다(§3.5) |
| 36, 44 | Node 24 LTS, TypeScript 6.0(결정 44가 결정 36의 Node 22·TS 5.x를 대체), pnpm, `better-sqlite3`(동기, WAL). pi 기준은 태그 `v1.1.0`(커밋 `abe508e1`, npm 1.1.0과 같음) |
| 45 | 데몬은 시작 단계에서 `secrets run`을 자식 로더로 써서 비밀을 받아 메모리에만 둔다(ADR-17-3을 브리프가 채택) |
| 46 | 루프백 바인딩은 격리 경계가 아니다. 모든 리스너는 자격 증명을 요구하고 도구는 격리한다(18 D18-04) |
| §2.5 | 런타임 데이터는 `~/projects` 밖(`/srv/volumes/helm/`), restic 백업, just + systemd, SOPS + `secrets`, Windows 호스트 변경은 사람이 `.ps1`로, `just verify` 통과 = 완료 |

### 2.2 이 서버에서 확인한 사실 [실험]

2026-10-11 이 서버에서 읽기 전용 명령으로 확인했다. 시스템 설정은 바꾸지 않았다. 일시 실행(`systemd-run --user` 일회성 단위, scratchpad의 임시 age 키)은 설정에 흔적을 남기지 않는다. 기록: `.helm-design-work/P11/notes.md`.

| N | 확인한 것 | 명령 | 결과 |
|---|---|---|---|
| 1 | systemd 동작 | `systemctl is-system-running`, `cat /etc/wsl.conf` | `running`. `[boot] systemd=true` |
| 2 | linger | `loginctl show-user user` | `Linger=yes` (`/var/lib/systemd/linger/user` 있음) |
| 3 | systemd 버전, user manager 위임 컨트롤러 | `systemctl --user --version`, `cat /sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/cgroup.controllers` | systemd 255. `cpu memory pids` |
| 4 | WSL 쪽 사용 중 포트 | `ss -ltn` | 127.0.0.1: 1411, 2019, 3000, 3080, 4443, 5984, 8384, 9200. 0.0.0.0: 22, 22000. 7840·7841 비어 있음 |
| 5 | Windows 쪽 사용 중 포트 | `netstat.exe -ano -p TCP` | tailnet 주소의 443, 8443~8447(tailscale serve), 0.0.0.0:2222 등. 7840·7841·8448 비어 있음 |
| 6 | mirrored 루프백 공유 | Windows `curl.exe http://127.0.0.1:3080/` | 200. WSL에서 127.0.0.1에 바인딩한 서비스를 Windows 프로세스가 연다 |
| 7 | 도구 버전 | `node --version` 등 | Node v24.19.0(mise), pnpm 11.21.0, just 1.58.0, sops 3.13.3, restic, age 1.3.2. `sqlite3` CLI 없음. `bwrap`·`pasta` 없음. `choom`·`prlimit`·`systemd-run` 있음 |
| 8 | Node 플래그 | `node --help` | `--disable-sigusr1` 있음(24.19) |
| 9 | 파일 시스템 종류 | `fs.statfsSync(p).type` | `/srv/volumes` ext4(0xEF53), `/mnt/c` v9fs(0x01021997), `/run/user/1000` tmpfs(0x01021994) |
| 10 | user unit 샌드박스 | `systemd-run --user --wait --pipe -p PrivateUsers=yes -p ProtectSystem=strict -p ProtectHome=read-only -p InaccessiblePaths=/srv/volumes …` | `/srv/volumes` 접근 거부, `/tmp` 쓰기 거부, uid 1000 유지. user unit에서 이 설정들이 동작한다 |
| 11 | `.wslconfig` | `cat /mnt/c/Users/*/.wslconfig` | `memory=10GB`, `swap=8GB`, `networkingMode=mirrored`, `firewall=true`, `vmIdleTimeout=-1`, `instanceIdleTimeout=-1`, `autoMemoryReclaim=dropCache`, `sparseVhd=true`, `hostAddressLoopback=true` |
| 12 | WSL 버전 | `wsl.exe --version` | WSL 2.7.14.0, 커널 6.18.33.2-2, Windows 10.0.26200 |
| 13 | WSL 유지 작업 | `schtasks.exe /query` + dotfiles `profiles/windows/bootstrap.ps1:257-279` [원문] | `\WSL-Autostart`: 로그온 트리거, `conhost --headless wsl.exe -d Ubuntu-24.04 --exec sleep infinity`, 실패 시 1분 간격 5회 재시작 |
| 14 | 전원 | dotfiles `bootstrap.ps1:283-300` [원문] | AC에서 대기·최대 절전 안 함, 덮개 닫기 무시, `powercfg /h off`(빠른 시작 끔) |
| 15 | Windows Tailscale CLI 호출 | homelab `scripts/lib/ts version`, `ts whois --json 100.113.29.73` | WSL interop으로 호출된다. 0.86초 / 0.07초. whois 결과 키 `Node`, `UserProfile{LoginName, DisplayName, ID}`, `CapMap`. 서버 노드 태그 `tag:server` |
| 16 | 시간 | `timedatectl` | NTP active, synchronized, Asia/Seoul |
| 17 | journald | `journalctl --user --disk-usage`, `/etc/systemd/journald.conf` | 영속 저장(`/var/log/journal`), 기본 설정, 50.8 MB |
| 18 | sshd | `/etc/ssh/sshd_config`, `sshd_config.d/10-dotfiles.conf` | 키 인증만, root 로그인 금지. 포워딩 관련 설정 없음(OpenSSH 기본값 허용). OpenSSH 9.6p1 |
| 19 | `sops exec-env`의 신호 전달 | scratchpad 임시 키로 `sops exec-env` 아래 자식을 띄우고 sops PID에 SIGTERM | sops는 143으로 끝나고 자식은 신호를 받지 못한 채 남는다. `--same-process`도 `sh -c`가 자식을 fork해 같다. 그래서 `ExecStart=secrets run … -- helmd`로 감싸면 systemd의 SIGTERM이 node에 전달되지 않는다(§3.8) |
| 20 | 홈랩 백업 범위 | homelab `scripts/backup` `collect_paths` [원문] | `/srv/volumes/<svc>`는 docker 라벨 `backup=true` 서비스만 넣는다. docker가 없을 때만 전체를 넣는다. 그래서 `/srv/volumes/helm`은 지금 restic에 들어가지 않는다 |
| 21 | 홈랩 경보 단위 | `systemctl --user list-unit-files` | `alert@.service`는 홈랩 저장소에는 있으나 user manager에 설치되어 있지 않다 |
| 22 | WSL interop 차단 | `systemd-run --user … -p InaccessiblePaths=/run/WSL -p PrivateNetwork=yes` 안에서 `cmd.exe` 실행 | 실패. 인터페이스는 `lo`만. 일회성 단위 기동 전체 73 ms |
| 23 | 일회성 단위의 환경·프로세스 분리 | `systemd-run --user -p PrivateUsers=yes -p ProtectProc=invisible …` 안에서 `env`, `ls /proc`, 다른 프로세스의 `/proc/<pid>/environ`, `kill -0` | user manager 환경(`DBUS_SESSION_BUS_ADDRESS`, `SSH_AUTH_SOCK`, `XDG_RUNTIME_DIR` 등)이 섞인다 → `env -i`로 감싸면 `PATH PWD`만. 같은 uid 프로세스가 숨겨지지 않음(`ProtectProc`가 같은 uid에는 효과 없음). `environ` 읽기는 거부, 신호는 가능 |

### 2.3 홈랩 문서에서 가져온 사실 [원문]

| 사실 | 출처 |
|---|---|
| `tailscale serve`는 Windows 호스트에서 돌고, 새 서비스는 `tailscale/serve.table`에 `<ts.net 포트> http://127.0.0.1:<포트> <서비스>` 한 줄을 먼저 더한 뒤 `just serve-apply`로 적용한다. 적용은 WSL interop으로 Windows CLI를 부르므로 관리자 권한이 필요 없다 | homelab `runbooks/add-service.md` 1번, `scripts/serve-apply` 머리 주석, `context/network.md` |
| 서비스 포트 8443~8447, 443(Caddy TCP 패스스루), Funnel 10000 사용 중 | `tailscale/serve.table`, `context/network.md` |
| restic 매일 04:00(로컬 D: + 오프사이트), 볼트 스냅샷 03:30, 복원 시험 매월 1일 05:30. 보존 일 7·주 4·월 6 | `context/storage.md` 백업 절, `systemd/backup.timer` |
| 백업 제외 목록에 `/srv/volumes/*/secrets`, `/srv/volumes/*/cache` | `scripts/backup.exclude` |
| CouchDB는 일시 중지 후 `/srv/volumes/_staging/couchdb`로 복사해 그 복사본을 백업한다 | `context/storage.md`, `scripts/backup` |
| 상시 작업 엔진은 just + systemd. 타이머 서비스는 user unit이고 `OnFailure=alert@%n.service` | `context/decisions.md`, `context/storage.md` |
| 서버 전원: AC 절전·최대 절전 안 함, Windows Update 사용 시간 08–02 | `context/decisions.md` 추가 결정 |
| 로그인 전 자동 시작은 확실한 방법이 없다. 필요하면 Windows 자동 로그온(물리 보안과 절충) | oss §5.2 [지식], 홈랩도 다른 방법을 채택하지 않았다 |
| 홈랩 기각 안: n8n·Node-RED, Docker Desktop, 서비스별 Tailscale 사이드카, Tailscale SSH, `/mnt/c` 아래 코드 | `context/decisions.md`. 이 문서는 다시 제안하지 않는다 |

### 2.4 이 문서의 주요 설계 결정

| ID | 내용 | 표시·근거 |
|---|---|---|
| D17-01 | `helmd`는 Node 프로세스 하나다. 커널·저장소·런타임·스케줄러·리스너가 모두 이 프로세스의 주 스레드 이벤트 루프에서 돈다. DB 쓰기는 주 스레드의 연결 하나로만 한다(단일 writer). 무거운 읽기 전용 작업(전체 해시 체인 검증, 백업 검증, 진단 묶음)만 `worker_threads`의 읽기 전용 연결로 돈다 | [제안]. 06 §2.2(single writer), 사례 §12.2-10(거대 다중 프로세스 구조를 피함) |
| D17-02 | 단일 인스턴스는 데이터 디렉터리의 잠금 전용 SQLite 파일에 배타 쓰기 트랜잭션을 프로세스 수명 동안 잡아 보장한다. 프로세스가 죽으면 커널이 잠금을 푼다. pid 파일로 판정하지 않는다 | [제안]. 사례 §12.1-4(happy-agent `AgentSQLiteProcessLock.ts:22-50`, pi-fabric `storage.ts:54-67`) |
| D17-03 | 시작 순서는 설정 → 잠금 → DB 열기·마이그레이션 → `bootEpoch` 발급과 `daemon.booted` 기록 → 복구(12) → 투영 따라잡기 → 스케줄러 → 리스너다. 리스너는 복구가 끝난 뒤에만 연다 | [제안], 결정 30 |
| D17-04 | 크래시 루프 차단기: 10분 안에 비정상 종료 뒤 시작이 3번이면 안전 모드로 시작한다. systemd 쪽에도 10분에 5번 시작 한도를 둔다 | [제안]. 사례 §12.1-3(openclaw `restart-recovery.md:981-1003`) |
| D17-05 | systemd **user unit**으로 돌린다. linger가 켜져 있어 로그인 세션 없이도 돈다. 재시작 정책은 `Restart=on-failure`, 환경 문제 종료 코드(2~5)는 재시작하지 않는다 | [제안]. [실험 1·2·3], 홈랩 타이머도 user unit |
| D17-06 | 종료는 `KillMode=mixed`, `TimeoutStopSec=45s`. 데몬이 직접 순서대로 정리(새 요청 거절 → 스케줄러 정지 → 진행 중 실행 20초 유예 → 도구 프로세스 SIGTERM, 5초 뒤 SIGKILL → 마지막 이벤트·체크포인트 → 잠금 해제)하고, 시간을 넘기면 systemd가 남은 프로세스를 SIGKILL한다 | [제안]. S4 openclaw-runtime §2.4(`KillMode=mixed`, 종료 예산) |
| D17-07 | 비밀은 `ExecStart`를 `secrets run`으로 감싸 넣지 않는다. `helmd`가 시작 단계에서 `secrets run <scope> -- <비밀 내보내기 도구>`를 자식으로 실행해 표준 출력 파이프로 값을 받아 메모리에만 둔다. 이렇게 하면 주 PID가 node이고(신호 전달), 데몬 환경 변수(`/proc/<pid>/environ`)에 비밀이 남지 않는다 | [제안]. [실험 19]. 진입점은 `secrets` 하나라는 SECRETS.md 규칙은 지킨다 |
| D17-08 | 데이터·상태·릴리스는 `/srv/volumes/helm/`, 설정은 `~/.config/helm/`, 소켓은 `$XDG_RUNTIME_DIR/helm/`에 둔다 | [제안]. 비교는 §3.2.1 |
| D17-09 | 리스너: `tailnet`(127.0.0.1:7840, tailscale serve 전용), `loopback`(127.0.0.1:7841, SSH `-W` 전용, 19 P-01의 이름), `local`(Unix 소켓). serve 쪽 포트는 8448 | [제안]. [실험 4·5]. 리스너 셋을 두는 보안 이유는 18 §3.4 |
| D17-10 | 백업은 데몬이 SQLite 온라인 백업으로 `/srv/volumes/helm/backups/`에 검증된 스냅샷을 만들고(매일 03:40, 마이그레이션·업그레이드 직전), 홈랩 restic(04:00)이 그 디렉터리를 가져가게 한다. 살아 있는 DB 파일은 restic에 넣지 않는다 | [제안]. 홈랩 CouchDB 방식과 같은 모양. 홈랩 쪽 변경 요청은 §3.7.4 |
| D17-11 | 릴리스는 git 커밋에서 빌드한 불변 디렉터리로 두고 `current` 심볼릭 링크를 원자적으로 바꾼다. 작업 트리에서 바로 실행하지 않는다 | [제안]. 동기화 폴더(`~/projects`)의 변경이 실행 중 코드에 섞이지 않게 한다. 되돌리기 단순화 |
| D17-12 | 마이그레이션은 앞으로만 간다. DB 스키마가 코드보다 새로우면 시작을 거부한다(종료 코드 4). 되돌리기는 "이전 릴리스 + 업그레이드 직전 스냅샷 복구"다 | [제안] |
| D17-13 | 운영 로그는 표준 출력 JSON 줄 → journald. 파일 로그를 만들지 않는다. 운영 로그는 진단용이며 정본이 아니다 | [제안]. 06이 정한 관측 흐름 분리(06 §2.2 "관측 흐름 4개를 섞지 않는다") |
| D17-14 | Windows 호스트 쪽 변경은 없다. 필요한 것은 홈랩 `serve.table` 한 줄과 `just serve-apply`(관리자 권한 불필요)뿐이다. 방화벽 규칙은 더하지 않는다. 확인용 `.ps1`(읽기 전용, 관리자 권한 불필요)만 둔다 | [제안]. §3.7 |
| D17-15 | 관찰 에이전트는 16 OB-1대로 데몬이 띄우는 일회성 자식 프로세스다. 17은 그 자식의 자원 한도와 격리 실행 방식만 정한다(§3.1.3) | 16 §3.2.1 수용 |

### 2.5 원천 체크리스트 반영표

0단계 원천 정리의 체크리스트·끝 목록에서 17에 배정되었거나 17과 관련된 항목과 그 처리다. 18에 배정된 항목은 18 §2.5에 있다.

| 원천 항목 | 처리 | 위치 |
|---|---|---|
| 발췌4 (d) d22: 외부 런타임 어댑터에서 데몬이 꺼졌을 때 변경 도구를 막을지, 기록을 쌓아 나중에 보낼지 (담당 13, 17) | 17 쪽 사실을 제공한다: 데몬이 꺼져 있는 동안 어댑터가 판정을 받을 길이 없다. 데몬 쪽 기본 요구는 "판정 불가 = 변경 도구 차단(fail closed)"이다. 어댑터의 기록 보관 방식은 13이 정한다 | §5.2(13), §4 F-27 |
| 발췌4 20-20: 클라이언트 쪽 기기가 잠자기·오프라인이면 쓰기가 실패하던 사례 → 데몬 상주 배경 | 반영. 데몬은 클라이언트 상태와 무관하게 상주한다 | §3.6 |
| 발췌1 E1-094·E1-100: queue·inbox 파일 + 별도 관찰자 데몬 + 이벤트/주기 스캔 이중 트리거, 스케줄러는 pi 밖 | queue·inbox 파일은 쓰지 않는다(결정 29). 이중 트리거는 16 §3.3이 반영했고, 17은 그 실행 주체가 `helmd` 스케줄러(12)라는 것과 데몬이 꺼진 동안의 따라잡기를 시작 순서에 넣는다 | §3.4.2 14단계 |
| 발췌1 E1-096: 분석 로직을 pi 확장 안에 넣지 않고 관찰자는 독립 프로세스 | 16 OB-1의 자식 프로세스 + 17의 격리 실행 | §3.1.3 |
| facts-1 §0-9, §7.4: pi-durable은 `node:sqlite`, WAL, `synchronous=NORMAL`, 저장소당 프로세스 하나·프로세스 간 락 없음 | Helm은 `better-sqlite3`(결정 36). 프로세스 간 배타는 D17-02의 잠금 파일로 보장한다. `synchronous` 최종값은 09 | §3.1.4, §5.2(09) |
| facts-2 §0-6, §1.1: 모든 pi 패키지 `engines.node >=22.19.0` | 릴리스 매니페스트에 Node 경로·버전·ABI를 적고 시작 때 확인한다 | §3.10.1 |
| facts-2 §8, §13: pi-env의 ping 5초·무수신 30초 종료, SSH 부트스트랩 규칙 | 연결 생존 확인은 19가 정한다. 17은 SSH 경로의 서버 쪽 리스너(`loopback`)와 sshd 조건만 정한다 | §3.5, §3.6.7 |
| oss §5.1: `.wslconfig` timeout 두 개 -1, 로그온 keepalive 작업, 절전 끄기, `helm-daemon.service (Restart=always)` | 이미 적용된 것을 확인했다 [실험 11·13·14]. 단위 이름은 `helmd.service`, 재시작은 `on-failure` + 환경 오류 제외로 바꿨다(이유 §3.6.5) | §3.6 |
| oss §5.2: 절전, Windows Update 재부팅, 정전, WSL 업데이트, 로그인 전 자동 시작 | 사건별 동작 표로 반영 | §3.6.6 |
| oss §2.2: SQLite는 `/mnt/c`가 아니라 ext4 | 시작 때 파일 시스템 종류를 검사해 거부한다 | §3.2.3 |
| 사례 §12.1-3: 데몬 epoch로 이전 epoch의 "실행 중"·"승인 대기"·"스케줄 실행 중" 행을 한 단계에서 `interrupted`로, 영속 재시도 예산, 크래시 루프 차단기 | `bootEpoch` 발급과 복구 호출 위치, 크래시 루프 차단기는 17이 정한다. 정리 대상 행과 재시도 예산은 12가 정한다(§5.2) | §3.4.2, §3.4.6 |
| 사례 §12.1-4: OS가 쥐는 SQLite 쓰기 트랜잭션으로 단일 writer | 반영(D17-02) | §3.1.4 |
| 사례 §12.1-9: 타이머 최대 60초 상한, 재시작 때 실행 중 작업 interrupted, 놓친 실행 상한·지연 | 12 소유. 17은 시작 순서에서 스케줄러를 복구 뒤에 켜는 것과, WSL 일시정지 때의 동작 표에 반영 | §3.4.2, §3.6.6 |
| 사례 §12.1 그 밖(P11): graceful drain과 `TimeoutStopUSec`에 맞춘 종료 예산 | 반영(D17-06) | §3.4.3 |
| 사례 §12.1 그 밖(P11): SQLite 운영값(WAL, `busy_timeout=5000`, `foreign_keys=ON`), 네트워크 FS에서 WAL 거부, 시작 시 쓰기 트랜잭션 한 번으로 복구 대기, `user_version` 이중 확인 | 파일 시스템 검사와 시작 시 쓰기 트랜잭션은 17이 반영. PRAGMA 최종값과 버전 표식은 09에 요구 | §3.2.3, §3.4.2, §5.2(09) |
| 사례 §12.2-6: 대기 중 권한·질문을 메모리에만 두지 않기 | 17 쪽: 종료 때 대기 상태를 메모리에서 버리지 않고 정본에 둔 채 끝낸다. 재시작 뒤 유지·취소는 11·12 | §3.4.3 |
| S4 openclaw-runtime §2.3: 시작 시 고아 표시, 5초 뒤 재디스패치, 크래시 루프 5분 3회 | 차단기 수치를 10분 3회로 잡았다(1인 서버, 재시작 지연이 지수 증가하므로 5분 창은 짧다). 재디스패치 지연은 12 | §3.4.6 |
| S4 pi-web §1: 데이터 디렉터리 소유 마커, 종료 순서표 | 마커 대신 D17-02 잠금을 쓰고, 진단용으로 `helmd.owner.json`만 둔다. 종료 순서표 반영 | §3.1.4, §3.4.3 |
| S4 paseo §5: 관리 프로세스 원장(PID + 프로세스 신원), 스케줄 실행 중 재시작 → failed | 원장 레코드는 13, 시작 때 원장 대조와 고아 종료의 위치는 17 | §3.4.2 11단계 |
| mastra-review §9: 크래시에도 지켜지는 절대 시각 `sleepUntil` | 12 소유. 17은 시간 동기화 사실만 제공 | §3.6.8 |
| v0.3 12 §15-2: 워크스페이스당 SQLite 파일 하나 vs 전체 하나 | 17은 데이터 디렉터리 하나에 정본 DB 하나를 전제로 운영 절차를 쓴다. 최종은 09 | §3.2.2, §7 Q17-08 |

### 2.6 가정

| ID | 가정 | 확인 방법 |
|---|---|---|
| A17-1 [가정] | Windows가 재부팅하거나 `wsl --shutdown`이 실행되면 WSL VM 안의 systemd가 정상 종료 순서를 다 밟지 못할 수 있다. 설계는 항상 "비정상 종료"를 전제한다 | 구현 단계에서 `wsl --shutdown` 뒤 `journalctl --user -u helmd -b -1`로 종료 기록이 남는지 본다(§6 T17-30) |
| A17-2 [가정] | `tailscale serve`의 HTTP 프록시는 WebSocket 업그레이드를 넘기고, `Tailscale-User-Login`과 `X-Forwarded-For`를 붙인다 | [지식] + openclaw가 이 헤더를 전제로 검증한다(S4 openclaw-gateway §2.5). `just daemon-probe`로 확인(§3.14) |
| A17-3 | Node 24에는 `--disable-sigusr1`이 있다 | 24.19에서 확인 [실험 8]. 릴리스 빌드 때 `node --help`로 다시 확인하고, 없으면 빌드를 거부한다 |
| A17-4 [가정] | `better-sqlite3`의 `backup()`은 같은 연결로 들어오는 쓰기와 함께 진행되어 일관된 스냅샷을 만든다 | [지식: SQLite 온라인 백업 API는 같은 연결의 변경을 반영하며 진행한다]. 09가 확정하고 §6 T17-16으로 검증 |
| A17-5 [가정] | 하루 이벤트 수천 건, DB 크기 첫 해 1 GB 이하 | 16 AS-4와 같다. 첫 달 실측 |

## 3. 명세 본문

### 3.1 프로세스 모델

#### 3.1.1 구성도

```text
systemd --user (linger, WSL 부팅 시 시작)
 ├─ helmd.service ──────────────────────────────────────────────────────────────┐
 │   node (주 PID, --disable-sigusr1)                                            │
 │   ├─ 주 스레드 이벤트 루프                                                       │
 │   │   리스너: tailnet 127.0.0.1:7840 · loopback 127.0.0.1:7841 · local Unix 소켓 │
 │   │   프로토콜 처리기(19) → engine/kernel(10) → store(09, better-sqlite3 쓰기 연결 1개)
 │   │   runtime: 에이전트 루프·모델 스트림(12), 스케줄러(12), 투영(12)              │
 │   │   ops: 상태·헬스·백업 실행기·감시                                           │
 │   ├─ worker_threads (필요할 때만): 전체 해시 체인 검증, 백업 검증, 진단 묶음,      │
 │   │   이벤트 루프 감시자                                                        │
 │   └─ 자식 프로세스                                                             │
 │       ├─ 비밀 로더: secrets run <scope> -- helm-secret-export (시작·재적재 때 한 번)  │
 │       └─ 관찰 에이전트(16 OB-1): systemd-run --user 일회성 단위 또는 fork         │
 ├─ helm-tools.slice                                                              │
 │   └─ helm-tool-<tc_id>.service × N  (13이 띄우는 도구 실행, 18 §3.11 격리)        │
 ├─ helm-backup.timer → helm-backup.service (helm ops backup)                      │
 ├─ helm-restore-drill.timer → helm-restore-drill.service (helm ops drill)         │
 └─ helm-alert@<unit>.service (OnFailure)                                          │
                                                                                   │
/srv/volumes/helm/data/helm.sqlite (+ -wal, -shm)  ◀── 쓰기는 helmd 주 스레드만 ────┘
```

#### 3.1.2 `helmd` 안의 구성 요소와 스레드 모델 [제안]

| 구성 요소 | 스레드 | 하는 일 | 소유 문서 |
|---|---|---|---|
| `lifecycle` | 주 | 시작·종료 순서, 신호, 모드 전이, 잠금 | 17 |
| `listeners` | 주 | HTTP/WebSocket 서버 셋, 연결 수락, 리스너별 사전 검사 | 17(배치), 18(인증), 19(프로토콜) |
| `protocol` | 주 | 핸드셰이크, 구독, 재전송, 디스패치 | 19 |
| `engine`/`kernel` | 주 | 명령 검증과 상태 전이, 이벤트 append | 10 |
| `store` | 주(쓰기), 워커(읽기 전용) | SQLite 연결, 마이그레이션, 투영 테이블, 백업 API | 09 |
| `runtime` | 주 | 에이전트 루프, 모델 호출, 도구 실행 요청, 스케줄러, 복구 | 12, 13 |
| `ops` | 주 + 워커 | 상태 보고, 헬스 점검, 백업·복구·훈련 실행, 진단 묶음 | 17 |
| `secrets` | 주 | 비밀 로더 실행과 메모리 보관, 마스킹 등록 | 17(로딩), 18(정책) |

규칙:

1. **단일 writer**: DB 쓰기는 주 스레드의 쓰기 연결 하나로만 한다. `better-sqlite3`가 동기이므로 쓰기는 자연히 직렬화된다. 쓰기 트랜잭션 하나는 평상시 50 ms를 넘기지 않게 09·12가 나눈다(넘으면 이벤트 루프 지연 점검에 걸린다, §3.11.2).
2. **워커는 읽기 전용**: 워커 스레드는 `readonly: true` 연결만 연다. WAL 모드에서 읽기 연결은 쓰기를 막지 않는다 [지식].
3. **긴 동기 작업 금지 구간**: 리스너가 열린 뒤에는 전체 `integrity_check`, 전체 해시 체인 검증, `VACUUM`을 주 스레드에서 돌리지 않는다. 시작 단계(리스너 열기 전)의 마이그레이션·투영 재구성은 주 스레드에서 돌려도 된다.
4. **모델 스트림·HTTP**: 모두 비동기 I/O라 주 스레드에서 돈다. 모델 응답 조각은 정본에 쓰지 않는다(19 P-08, 사례 §12.1-6).
5. **Node 실행 옵션**: `--disable-sigusr1`(같은 사용자의 다른 프로세스가 SIGUSR1로 inspector를 여는 것을 막음, 18 §3.2 T-H3), `--max-old-space-size=768`, `--enable-source-maps`. 단위 환경에서 `NODE_OPTIONS`를 비워 외부 주입을 막는다.

#### 3.1.3 자식 프로세스 [제안]

| 자식 | 띄우는 방법 | 수명 | 자원·격리 | 데몬이 죽으면 |
|---|---|---|---|---|
| 비밀 로더 | `child_process.spawn("secrets", ["run", scope, "--", releaseDir+"/bin/helm-secret-export", ...keys])`, stdin 닫음, stdout 파이프 | 시작 단계와 `helm ops reload-secrets` 때 한 번, 10초 제한 | 출력은 JSON 한 개. 데몬이 읽고 즉시 버퍼를 비운다 | 같이 끝난다(짧은 수명) |
| 도구 실행(bash 등) | 13이 정한다. 18 §3.11.2 순서: bubblewrap S1(13 §3.6.2, 자원 한도는 `systemd-run --user --scope --slice=helm-tools.slice`), 없으면 `systemd-run --user --unit=helm-tool-<tc_id> --slice=helm-tools.slice --property=PartOf=helmd.service --pipe --wait …` | 도구 호출 하나 | 단위별 `MemoryMax`, `RuntimeMaxSec`, 슬라이스 합계 한도(§3.13). 격리 속성은 18 §3.11 | bubblewrap은 `--die-with-parent`, 일회성 단위는 `PartOf=helmd.service`로 데몬과 함께 끝난다. 크래시 뒤에는 시작 단계의 원장 대조(§3.4.2 11단계)가 남은 것을 정리한다 |
| 관찰 에이전트 | 16 OB-1(`child_process.fork`, Node IPC). 격리 실행이 켜져 있으면 `systemd-run --user --unit=helm-observer-<or_id> --slice=helm-tools.slice --property=PartOf=helmd.service --pipe --wait`로 띄우고 IPC는 표준 입출력의 JSON 줄로 바꾼다(16에 요구, §5.2) | 관찰 실행 하나 | `MemoryMax=1G`, `Nice=10`, `PrivateNetwork=yes`(모델 호출은 데몬을 거친다, 16 OB-3), `ProtectSystem=strict`, `ProtectHome=read-only`, `ReadWritePaths=/srv/volumes/helm/observer`, `InaccessiblePaths=/run/WSL %t/helm /srv/volumes/helm/private`(복귀 점검 기대 답을 관찰이 보지 않게, 16 §3.24) | 같은 규칙 |

자식 프로세스 원장: 도구·관찰 실행을 띄우기 직전에 원장 레코드(단위 이름 또는 PID, 프로세스 시작 시각 `/proc/<pid>/stat` 22번째 필드, `bootEpoch`, 도구 호출 ID)를 이벤트로 남긴다. 레코드 형식과 이벤트 이름은 13이 정한다. 17은 시작 단계에서 이전 `bootEpoch`의 원장 항목을 대조해 살아 있는 것을 끝낸다(§3.4.2 11단계).

#### 3.1.4 단일 인스턴스 보장 [제안]

```ts
// packages/store/src/admin/instance-lock.ts — `@helm/store/admin`에서 내보낸다(조정자 판정 J-101).
// SQLite 드라이버(better-sqlite3)를 import하는 패키지는 store 하나다(06 R6). daemon과 cli는 이 함수만 부른다.
import Database from "better-sqlite3";

export interface InstanceLock { release(): void; readonly path: string }

export class InstanceLockedError extends Error { readonly exitCode = 3 }

/** 데이터 디렉터리 안의 잠금 전용 SQLite 파일에 배타 트랜잭션을 프로세스 수명 동안 잡는다.
 *  SQLite는 POSIX 레코드 잠금을 쓰므로 프로세스가 어떻게 죽든 커널이 잠금을 푼다. */
export function acquireInstanceLock(dataDir: string): InstanceLock {
  const path = `${dataDir}/helmd.lock`;
  const db = new Database(path, { timeout: 0 });          // busy 대기 없음
  db.pragma("journal_mode = DELETE");
  try {
    db.exec("BEGIN EXCLUSIVE");                            // 다른 프로세스가 잡고 있으면 SQLITE_BUSY
  } catch (e) {
    db.close();
    throw new InstanceLockedError(`another helmd holds ${path}`);
  }
  return { path, release: () => { try { db.exec("ROLLBACK"); } finally { db.close(); } } };
}

// packages/daemon/src/lifecycle/boot.ts 3단계: import { acquireInstanceLock } from "@helm/store/admin";
```

규칙:

1. 잠금 파일은 데이터 디렉터리마다 하나다. 정식 데몬(`/srv/volumes/helm/data`)과 개발 데몬(`/srv/volumes/helm/dev/data`)은 서로 다른 잠금을 쓴다.
2. 잠금 연결 외에 같은 프로세스에서 `helmd.lock`을 다시 열지 않는다(POSIX 잠금은 프로세스 안의 어느 디스크립터든 닫히면 풀린다 [지식]).
3. 진단용 정보는 `helmd.owner.json`에 쓴다: `{ pid, procStartTime, bootEpoch, releaseId, startedAt, state: "running" | "stopped" }`. tmp에 쓰고 rename한다. 이 파일은 판정에 쓰지 않는다. 이전 프로세스가 `state: "running"`을 남겼으면 비정상 종료의 보조 증거다(정본 판정은 §3.4.2 10단계의 `boots` 기록).
4. CLI의 오프라인 작업(`helm ops restore`, 데몬이 꺼져 있을 때의 `helm ops backup`)도 같은 잠금을 잡은 뒤에만 DB를 연다. 잠금을 못 잡으면 "데몬이 실행 중"으로 보고 멈춘다(종료 코드 3).
5. 관찰 에이전트의 읽기 전용 연결(16 OB-2)은 이 잠금을 잡지 않는다.

### 3.2 저장 위치

#### 3.2.1 `/srv/volumes/helm`과 XDG 경로 비교

| 기준 | `/srv/volumes/helm/` | XDG (`~/.local/share/helm`, `~/.local/state/helm`, `~/.config/helm`, `~/.cache/helm`) |
|---|---|---|
| 홈랩 관례 | 맞음. "런타임 데이터는 동기화 루트 밖 `/srv/volumes/<서비스>/`"(homelab storage.md 첫 절, 브리프 §2.5, 사용자 CLAUDE.md 폴더 절) | 홈랩 서비스 중 이 위치를 쓰는 것이 없다 |
| 동기화 | 동기화 루트 밖(WSL 전용) | 동기화 루트 밖 |
| 파일 시스템 | ext4 [실험 9], 소유자 `user` | ext4 |
| restic 백업 | 경로 패턴은 홈랩 백업이 이미 다룬다(`_staging`, `*/cache`·`*/secrets` 제외). 다만 docker 서비스만 자동 포함 [실험 20] → 한 줄 변경 필요 | 홈랩 백업 대상(`~/projects`, `~/data`, `~/vault`, `/srv/volumes`)에 없다. 새 경로 추가 필요 |
| 에이전트 쓰기 허용 | `/srv/volumes`는 사용자 규칙의 쓰기 허용 루트다(`guard-paths`) | `~/.local/share`, `~/.local/state`, `~/.cache`는 허용 루트가 아니다. `~/.config`만 허용 |
| 한곳에 모임 | 데이터·백업·상태·릴리스가 한 디렉터리. 슬러그 `helm` 하나(홈랩 R9) | 네 곳으로 흩어진다 |

결정 [제안]: 데이터·백업·상태·캐시·릴리스는 `/srv/volumes/helm/`, 사람이 고치는 설정은 `~/.config/helm/`, 소켓은 `$XDG_RUNTIME_DIR/helm/`(= `/run/user/1000/helm/`, tmpfs, 부팅마다 비워짐).

#### 3.2.2 디렉터리 배치

데이터 디렉터리 안쪽의 DB·blob 배치는 09 §3.6.1이 소유한다. 아래는 09·13·15·16·19와 맞춘 전체 배치다.

```text
/srv/volumes/helm/                      0700 user:user   (HELM_ROOT)
  app/                                  릴리스(§3.10)
    releases/<릴리스 ID>/                불변. 예: 0.1.0+bad4d2d
      bin/helmd  bin/helm  bin/helm-secret-export   실행 래퍼(sh, exec node …)
      daemon/  cli/                     pnpm deploy 결과(dist/, node_modules/)
      manifest.json                     §3.10.1
    current -> releases/<ID>            원자적으로 바꾼다
    previous -> releases/<ID>
    bin/helm-alert                      릴리스와 무관한 고정 스크립트(§3.6.4)
  data/                                 정본(09 §3.6.1)
    helm.sqlite  -wal  -shm             정본 DB
    helmd.lock                          단일 인스턴스 잠금(§3.1.4, 09 D09-7)
    helmd.owner.json                    진단용 소유 정보
    blobs/sha256/<2자>/<2자>/<해시>       256 KiB 넘는 blob. 내용 주소, 쓰기 후 불변
    blobs/staged/<uploadId>             업로드 중 파일(19). 24시간 뒤 정리(§3.9.7)
    blobs/.tmp/                         blob 쓰기 임시
    quarantine/<UTC 시각>/               복원으로 밀려난 이전 DB. 사람이 지운다
  backups/<kind>/<backupId>/            검증된 스냅샷(09 §3.14.1). kind = daily | pre-migrate | pre-upgrade | manual | pre-restore
    helm.sqlite  manifest.json
  private/                              0700. 모델·도구·관찰 프로세스가 보면 안 되는 값(비밀 원본은 아님)
    resumption-checks/<checkId>.json    0600. 복귀 점검의 기대 답(16 §3.24, 이벤트에는 해시만)
  observer/                             관찰 캐시와 소금 파일 `salt`(16 §3.8.4, §3.20)
  sandbox/<workspaceId>/home/          도구 샌드박스의 작업 공간별 홈(13 §3.6.2, npm·pnpm 캐시)
  sandbox/empty                         가림용 빈 파일(13 §3.6.2)
  drafts/<concernId>/                   `draft_only` 범위의 초안 영역(13 §3.7.9)
  worktrees/<runId>/<n>/                검증 실행용 격리 작업 트리(13 §3.7.9). 실행 끝에 지운다
  tool-output/                          잘린 도구 출력의 전체 파일(07 T5). 13이 blob으로 옮긴 뒤 지운다
  scratch/inquiry/                      탐구 작업 공간(15 §5.2)
  eval/                                 탐구 평가 산출물(15 §5.2)
  state/                                운영 상태(작음)
    server-id                           설치마다 한 번 만드는 고정 ID(UUIDv4 소문자). 19 `hello.challenge.serverId`. 복원해도 바뀌지 않는다
    exports/                            JSONL 내보내기(09 §3.14.3)
    alerts/<unit>.json  drills/<시각>.json  maintenance/<날짜>.json
    diag/helm-diag-<시각>.tar.gz          0600
  cache/                                재생성 가능(홈랩 제외 패턴 `/srv/volumes/*/cache`)
  tmp/                                  복구 훈련·업그레이드 작업 공간
  dev/                                  `just daemon-dev`의 루트(같은 하위 구조)

~/.config/helm/                         0700. dotfiles가 관리(06 §3.10.1)
  helmd.toml                            선택. dotfiles에서 추적
  helmd.local.toml                      선택. 이 기계만의 덮어쓰기, 추적 안 함
~/.config/systemd/user/                 단위 파일(§3.6.4). `just daemon-install`이 생성
/run/user/1000/helm/                    0700. systemd RuntimeDirectory
  rpc.sock                              0600. 로컬 관리자·TUI(19 §3.2.1)
~/.local/bin/helm -> /srv/volumes/helm/app/current/bin/helm
```

- 권한: `helmd`는 `UMask=0077`로 돈다. 모든 파일은 0600, 디렉터리는 0700이다. 시작 때와 `helm doctor`가 `data/`, `backups/`, `private/`, `state/`, `observer/`의 소유자·권한을 검사하고(18 §3.9, 09 §3.6.2), 다르면 고치고 경고를 남긴다(`data/helm.sqlite`가 다른 uid 소유면 고치지 않고 종료 코드 2).
- 프로젝트 작업 공간(`~/projects/<제품>/code/...`)은 데몬 데이터가 아니다. Helm 상태를 프로젝트 폴더에 쓰지 않는다(06 §2.4 비목표 9).

백업 포함 여부(홈랩 H-2·H-3의 근거, 18 §3.16):

| 경로 | restic | 이유 |
|---|---|---|
| `backups/` | 포함 | 검증된 정본 스냅샷 |
| `data/blobs/sha256/` | 포함 | 내용 주소 파일, 스냅샷이 참조 |
| `private/` | 포함 | 복귀 점검 기대 답. 잃으면 점검을 채점할 수 없다 |
| `drafts/` | 포함 | 사람이 볼 초안(작업 산출물) |
| `state/`(`diag/`, `exports/` 제외) | 포함 | `server-id`, 훈련·경보 기록 |
| `eval/` | 포함 | 평가 결과(작음) |
| `data/helm.sqlite*`, `data/blobs/staged`, `data/blobs/.tmp`, `data/quarantine` | 제외 | 살아 있는 DB는 스냅샷으로만. 임시 |
| `app/`, `tmp/`, `dev/`, `cache/`, `observer/`, `sandbox/`, `worktrees/`, `tool-output/`, `scratch/`, `state/diag/`, `state/exports/` | 제외 | 재생성 가능하거나 임시. 관찰 캐시는 지워지면 다시 만든다(16 §3.20) |

#### 3.2.3 파일 시스템 검사 [제안]

시작 단계 2에서 `data/`, `backups/`에 대해 `fs.statfsSync(path).type`을 본다.

| `type` | 처리 |
|---|---|
| `0xEF53`(ext2/3/4), `0x9123683E`(btrfs), `0x58465342`(xfs) | 허용 |
| `0x01021994`(tmpfs) | 테스트 설정(`HELM_ALLOW_TMPFS=1`)에서만 허용 |
| `0x01021997`(v9fs, `/mnt/c` 등 drvfs), `0x6969`(NFS), `0xFF534D42`(CIFS/SMB) 등 그 밖 | 거부, 종료 코드 2. 메시지: "WAL DB는 WSL ext4에만 둔다" |

근거: WAL은 네트워크·9p 파일 시스템에서 공유 메모리 잠금을 보장하지 않는다(사례 §12.1 그 밖 P11, openclaw `sqlite-wal-filesystem.ts:278-303`; oss §2.2).

### 3.3 설정

설정 형식과 최상위 구조, 핫 리로드 분류는 06 §3.10(ADR-06-11)이 소유한다. 17은 운영 절(`paths`, `listeners`, `secrets`, `shutdown`, `crashLoop`, `watchdog`, `backup`, `health`, `log`, `tools`, `maintenance`)의 필드와 기본값을 정한다.

#### 3.3.1 원천과 우선순위

낮은 것부터 높은 것 순서로 덮어쓴다(06 §3.10.2).

| 순위 | 원천 | 위치 |
|---|---|---|
| 1 | 코드 기본값 | `packages/daemon/src/config/defaults.ts`. `HELM_ROOT`로 정식·개발·테스트 루트가 나뉜다 |
| 2 | 설정 파일 | `$HELM_CONFIG` 또는 `~/.config/helm/helmd.toml`(dotfiles가 관리) |
| 3 | 로컬 덮어쓰기 | 같은 디렉터리의 `helmd.local.toml`(추적하지 않음) |
| 4 | 환경 변수 | 아래 목록만 |
| 5 | 명령행 인자 | `--config`, `--log-level` |

- 형식은 TOML(파서 `smol-toml`), 키는 `camelCase`, 합친 결과를 TypeBox로 검증한다. 모르는 키와 비밀처럼 보이는 키 이름(`token`, `secret`, `password`, `apiKey`, `privateKey`)은 오류이고, 검증 실패는 종료 코드 2다(§3.4.5).
- 설정 파일이 없어도 기본값으로 동작한다. 데몬은 설정 파일을 읽기만 한다. 다이얼·모드·정책 같은 의미 설정은 설정 파일이 아니라 정본 이벤트다(06 §3.10.1).
- 환경 변수(06 §3.10.2 순위 4와 같은 목록): `HELM_CONFIG`, `HELM_ROOT`(→ `paths.root`와 그 하위 기본값), `HELM_LOG_LEVEL`, `HELM_SECRETS_SCOPE`, `HELM_SECRETS_FROM_ENV`, `HELM_LISTEN_TAILNET_PORT`, `HELM_LISTEN_SSH_PORT`(`loopback` 리스너 포트. 이름은 06·`.env.example`과 맞춰 그대로 둔다), `HELM_ALLOW_TMPFS`. 그 밖의 `HELM_*`는 무시하고 경고한다.

예(정식 데몬은 이 파일 없이도 같은 값으로 돈다):

```toml
# ~/.config/helm/helmd.toml (dotfiles)
[listeners.tailnet]
publicOrigin = "https://server.tail7ad0b4.ts.net:8448"

[auth.tailscale]
allowedLogins = ["<소유자 Tailscale 로그인>"]   # helm doctor가 whois로 찾아 안내한다(18 §3.6.1)

[user]
timeZone = "Asia/Seoul"                           # 12의 cron·일일 예산 기준(06에 최상위 절 추가 요구)

[log]
level = "info"
```

#### 3.3.2 운영 절 스키마

```ts
// packages/daemon/src/config/ops-schema.ts — 06 §3.10.3 DaemonConfig의 운영 절. TypeBox로 같은 모양을 정의한다
export interface PathsConfig {
  root: string;            // "/srv/volumes/helm" (HELM_ROOT)
  dataDir: string;         // "<root>/data"
  backupDir: string;       // "<root>/backups"
  stateDir: string;        // "<root>/state"
  privateDir: string;      // "<root>/private"
  cacheDir: string;        // "<root>/cache"
  tmpDir: string;          // "<root>/tmp"
  observerDir: string;     // "<root>/observer"
  sandboxDir: string;      // "<root>/sandbox"   (13)
  draftsDir: string;       // "<root>/drafts"    (13)
  worktreesDir: string;    // "<root>/worktrees" (13)
  toolOutputDir: string;   // "<root>/tool-output" (07 T5)
  scratchDir: string;      // "<root>/scratch"   (15)
  evalDir: string;         // "<root>/eval"      (15)
  runtimeDir: string;      // "$XDG_RUNTIME_DIR/helm". 없으면 시작 거부(종료 코드 2)
}
export interface ListenersConfig {
  tailnet: { enabled: boolean; host: "127.0.0.1"; port: number /* 7840 */; publicOrigin: string /* "https://server.tail7ad0b4.ts.net:8448" */ };
  loopback: { enabled: boolean; host: "127.0.0.1"; port: number /* 7841. 환경 변수 HELM_LISTEN_SSH_PORT로 덮을 수 있다 */ };   // 키 이름은 리스너 이름과 같다(J-102)
  local:   { enabled: true;    socketName: string /* "rpc.sock" */ };
}
export interface SecretsConfig {
  scope: string;           // "product:helm/prod". 개발: "product:helm/dev"
  command: string;         // "secrets"
  keys: string[];          // 데몬이 읽는 비밀 키 이름. `.env.example`의 `KEY=` 항목과 같아야 한다. 접두사 패턴 `HELM_LEDGER_HMAC_KEY_*` 허용(이전 키, 18 §3.10.5)
  required: string[];      // 없으면 시작 거부(종료 코드 2). 기본 ["HELM_LEDGER_HMAC_KEY"](09 §3.8.2 3단계). 모델 키는 넣지 않는다(없어도 데몬은 뜨고 공급자만 사용 불가, 02 UC-11 E3)
  fromEnv: boolean;        // true면 로더 대신 process.env에서 읽는다(just daemon-dev 전용)
}
export interface ShutdownConfig { drainTimeoutMs: number /* 20000 */; toolKillGraceMs: number /* 5000 */ }
export interface CrashLoopConfig { windowMs: number /* 600000 */; maxUncleanStarts: number /* 3 */ }   // 판정 규칙은 12 §3.7.6
export interface WatchdogConfig { enabled: boolean /* true */; warnLagMs: number /* 200 */; fatalLagMs: number /* 120000 */ }
export interface BackupConfig {
  keep: { daily: number /* 3 */; preMigrate: number /* 3 */; preUpgrade: number /* 3 */; manual: number /* 5 */; preRestore: number /* 3 */ };
}
export interface HealthConfig {
  diskWarnBytes: number;         // 5 GiB
  diskCriticalBytes: number;     // 1 GiB (09 §3.6.2 시작 거부 기준과 같다)
  backupMaxAgeMs: number;        // 26시간
  walWarnBytes: number;          // 512 MiB
  memoryWarnFraction: number;    // 0.8 (cgroup MemoryHigh 대비)
}
export interface LogConfig { level: "trace" | "debug" | "info" | "warn" | "error" }
export interface ToolsExecConfig { slice: string /* "helm-tools.slice" */; sandbox: "auto" | "off" }   // auto = S1 → S1b → execute 끔(13 §3.6.1, 18 §3.11.2). off = S0(운영자만)
export interface MaintenanceConfig {          // §3.9.7
  sandboxHomeIdleDays: number;   // 30
  scratchRetentionDays: number;  // 14
  toolOutputRetentionHours: number; // 24 (blob으로 옮긴 뒤 남은 파일)
  worktreeOrphanHours: number;   // 6
}
```

#### 3.3.3 다시 읽기

SIGHUP 또는 `helm ops reload`로 다시 읽는다. 절별로 즉시·다음 실행부터·재시작 필요가 나뉜다(06 §3.10.5 표). 운영 절 중 즉시 적용은 `log`, `health`, `backup.keep`, `maintenance`이고, `paths`, `listeners`, `secrets`, `shutdown`, `crashLoop`, `watchdog`, `tools`는 재시작이 필요하다. 다시 읽은 설정은 먼저 전체를 검증하고 실패하면 이전 설정을 유지한다. 재시작이 필요한 항목이 바뀌었으면 적용하지 않고 상태에 "재시작 필요"(`config_pending_restart`)를 띄운다. 다시 읽기마다 `config.reloaded`(바뀐 키 이름만, 값은 넣지 않음)를 남긴다.

### 3.4 수명주기

#### 3.4.1 데몬 모드 상태 기계 [제안]

내부 모드는 `starting`, `recovering`, `ready`, `safe_mode`, `read_only`, `draining`, `stopped`다. 클라이언트에 보이는 모드는 19의 `DaemonMode`(`normal` | `readOnly` | `draining`)이고 대응은 아래 표 끝 열과 같다. `safe_mode`는 19에 값 `safeMode`를 더해 달라고 요구한다(§5.2). 그 전까지는 `normal`로 보이고 `daemon.status.warnings`에 `crash_loop` 키를 싣는다.

| 현재 \ 사건 | 시작 단계 성공 | 복구 끝 | 크래시 루프 감지 | 안전 모드 해제(로컬 관리자 `helm ops safe-mode off`) | 읽기 전용 조건(아래) | 읽기 전용 해제 | SIGTERM/SIGINT, `admin.drain` | 시작 단계 실패 | 종료 순서 끝 | 19 모드 |
|---|---|---|---|---|---|---|---|---|---|---|
| `starting` | → `recovering` | - | 안전 모드 표시를 세우고 계속 | - | - | - | 진행 중 단계를 마치고 정리 후 `stopped`(0) | 종료(2~5, §3.4.5) | - | (연결 없음) |
| `recovering` | - | 표시 없음 → `ready`, 있음 → `safe_mode` | - | - | - | - | → `draining` | 종료(1 또는 5) | - | (연결 없음) |
| `ready` | - | - | - | 무시 | → `read_only` | 무시 | → `draining` | - | - | `normal` |
| `safe_mode` | - | - | - | → `ready`(스케줄러 시작, 재개 허용, `daemon.safe_mode_exited`) | → `read_only`(안전 모드 표시 유지) | 무시 | → `draining` | - | - | `safeMode`(요구) |
| `read_only` | - | - | - | 표시만 지움 | 사유 추가 | 남은 사유 없음 → 안전 모드 표시 있으면 `safe_mode`, 없으면 `ready` | → `draining` | - | - | `readOnly` |
| `draining` | - | - | - | 무시 | 무시 | 무시 | 두 번째 신호: 유예 생략, 강제 정리로 | - | → `stopped`, 종료 코드 0 | `draining` |

읽기 전용 조건(하나라도 있으면 `read_only`, 사유 목록으로 관리):
- `disk_critical`: `data/` 여유 < `diskCriticalBytes`(1 GiB). 여유가 2 GiB 이상으로 돌아오면 사유 해제.
- `integrity_suspect`: 시작 단계 7의 무결성 검사 실패(읽기 전용 복구 시작) 또는 실행 중 `SQLITE_CORRUPT`. 이 사유가 있으면 이벤트를 쓰지 않는다(02 AC-10-09). 복원(§3.9.4) 또는 `helm ops verify --full` 통과 후 재시작으로만 풀린다. 주간 전체 검사나 백업 사본 검사가 실패한 경우는 이 사유를 세우지 않는다. 그때는 헬스 `db_integrity` critical, 백업 회전 정지, 경보만 한다(09 §3.10.4 표).
- `operator`: `admin.setMode { mode: "readOnly" }`(19). `admin.setMode { mode: "normal" }`로 해제.

부수 효과:
- `starting`·`recovering`은 리스너를 열기 전 단계라 연결을 받지 않는다(§3.4.2). 그래도 프로토콜 처리기는 모드가 `ready`·`safe_mode`가 아닐 때 들어온 상태 변경 명령을 거절한다(방어 규칙. `read_only`면 19의 `5003 daemon.readOnly`, `draining`이면 `5001`).
- `safe_mode`: 리스너를 연다(사람이 상태를 보고 판단해야 하므로). 실행을 자동으로 재개하지 않고, 에이전트 실행을 시작하는 타이머 발화를 보류하며(알림 계열 타이머는 발화), 관찰 실행을 띄우지 않는다(12 §3.7.6). 사람의 명령(질문 답, 결과 확인 등)은 받는다. 상태 화면에 안전 모드 사유와 최근 비정상 종료 목록을 보인다.
- `read_only`: 스케줄러를 멈추고 진행 중 실행은 다음 턴 경계에서 멈춘다(12의 `pause`). 상태를 바꾸는 명령은 거절하고 조회·구독은 받는다. 사유가 `disk_critical`·`operator`뿐이면 데몬 자신의 운영 이벤트(`daemon.*`, `backup.*`)는 디스크가 허락하면 쓴다. `integrity_suspect`면 아무것도 쓰지 않는다. 전이마다 `daemon.mode_changed { from, to, reasons }`를 남기고 19의 `server.modeChanged`를 보낸다.
- `bootEpoch`는 19 `HelloResult.server.bootId`와 같은 값이다.

#### 3.4.2 시작 순서 [제안]

저장소 쪽 단계는 09 §3.8.2 `openStore`, 런타임 쪽 단계는 12 §3.7.3 `boot()`, 오케스트레이터는 14가 소유한다. 아래 표는 그것들을 데몬 시작 순서 하나로 엮은 것이다(09 §5.2 요구 (1): 무결성 → 마이그레이션 → 투영 → 복구, 14 §5.2: 저장소 → 복구 → 오케스트레이터 → 스케줄러). 각 단계가 실패하면 표의 종료 코드로 끝낸다. 리스너를 열기 전이라 클라이언트는 연결 실패만 본다.

| 단계 | 하는 일 | 소유 | 실패 시 |
|---|---|---|---|
| 0 | 프로세스 제목 `helmd`. 신호 처리기 설치(이 단계부터 SIGTERM은 "시작 중단 후 정리"). 처리되지 않은 예외·거부 처리기(로그 후 종료 코드 1) | 17 | - |
| 1 | 설정 읽기와 검증(§3.3). 릴리스 매니페스트 읽기, `process.versions.modules`(ABI)와 매니페스트의 ABI 비교(§3.10.1) | 17, 06 | 2 |
| 2 | 경로 준비: 디렉터리 생성·권한(§3.2.2), 위치 검사(09 §3.6.2: 동기화 폴더 아님, `/mnt/` 아님, 파일 시스템 종류, 여유 ≥ 1 GiB), `runtimeDir` 존재 | 17, 09 | 2 |
| 3 | 단일 인스턴스 잠금(§3.1.4, 09 §3.8.1 겹 2) | 17 | 3 |
| 4 | 비밀 로딩(§3.8). `required`(기본 `HELM_LEDGER_HMAC_KEY`)가 없으면 실패 | 17, 18 | 2 |
| 5 | DB 열기(09 §3.8.2 4단계): PRAGMA(09 §3.6.3), 쓰기 트랜잭션을 한 번 열고 닫아 이전 크래시의 WAL 복구를 끝낸다(happy-agent `openAgentSQLiteDatabase.ts:40-63`), `application_id` 확인. 파일을 열 수 없으면(`SQLITE_NOTADB` 등) 종료 코드 5 | 09 | 5 |
| 6 | `user_version`이 코드보다 높으면 다운그레이드 거부(09 §3.13.1) | 09 | 4 |
| 7 | 무결성 검사 tail(09 §3.10.4). 이전 종료가 비정상이었으면(`helmd.owner.json`의 `state: running`으로 미리 추정) `PRAGMA quick_check`도 한다. 실패하면 **읽기 전용 복구 시작**(아래) | 09 | (읽기 전용 복구) |
| 8 | 마이그레이션(09 §3.13): 필요하면 `pre-migrate` 백업(§3.9) 후 적용 | 09, 17 | 백업·마이그레이션 실패 1(같은 실패 두 번째부터 2, §3.10.3) |
| 9 | 이벤트 버전 확인(모르는 type·typeVersion이 있으면 거부, 09 §3.8.2 8단계)과 투영 따라잡기(09 §3.8.2 9단계) | 09 | 모르는 버전 4, 그 밖 1 |
| 10 | `bootEpoch = ULID` 발급과 `daemon.booted { epoch, pid, procStartTime, version, releaseId, gitSha, node, prevEpoch, prevClean }`(09 §3.8.2 10단계, 12 §3.7.3 1단계). 이전 세대 판정은 `boots` 테이블의 `clean` 값. 마이그레이션이 있었으면 `store.migrated`, 복원 직후면 `store.restored`(§3.9.4). 크래시 루프 판정(12 §3.7.6, §3.4.6). `helmd.owner.json` 갱신 | 09, 12, 17 | 1 |
| 11 | 고아 정리: 13의 자식 프로세스 원장에서 이전 epoch의 항목을 대조한다. systemd 단위면 `systemctl --user stop helm-tool-*`(이미 멈췄으면 아무 일 없음), PID면 `/proc/<pid>/stat`의 시작 시각이 같을 때만 프로세스 그룹에 SIGTERM, 5초 뒤 SIGKILL. 남은 `worktrees/` 정리는 §3.9.7 | 13, 17 | 경고만(계속) |
| 12 | 런타임 복구(12 §3.7.3 3~5단계: `runtime.recover({ epoch, prevEpoch, safeMode })`). 이전 epoch의 실행·도구 호출 정리, 효과 outbox 재계산 | 12 | 1 |
| 13 | 오케스트레이터 루프 시작(14). 안전 모드면 새 실행을 시작하지 않는 상태로 시작 | 14 | 1 |
| 14 | 스케줄러 재구성·시작(12 `scheduler.rebuild(boot=true)`, 09 §3.8.2 12단계). 안전 모드면 에이전트 실행 타이머를 보류(알림 타이머는 발화) | 12 | 1 |
| 15 | 리스너 열기: `local` → `loopback` → `tailnet` 순. 포트가 사용 중이면 실패. `local` 소켓은 임시 경로에 bind 후 rename(죽은 소켓이 있으면 먼저 지움, facts-2 §4.3) | 17 | 2 |
| 16 | 모드 `ready`(또는 `safe_mode`). 재개 예약(12 §3.7.5, 5초 뒤부터 하나씩), 이벤트 루프 감시자 시작, 로그 `helmd ready` | 12, 17 | - |

**읽기 전용 복구 시작**(7단계 실패, 02 UC-10 B5): 8·9·10·11·12·13·14단계를 건너뛰고 15단계 리스너만 연다. 모드 `read_only`(사유 `integrity_suspect`). 이 경우 데몬은 **이벤트를 하나도 쓰지 않는다**(02 AC-10-09, 09 §3.10.5: 모든 쓰기를 `path.store_read_only`로 거부). `daemon.booted`도 쓰지 않고 부팅 사실은 `helmd.owner.json`과 운영 로그에만 남긴다. 사람이 원격에서도 상태를 보고 §3.9.4 복원을 결정할 수 있게 하는 것이 목적이다.

`ExecStartPost=helm ops wait-ready`가 16단계를 확인하면 systemd가 단위를 `active`로 본다(§3.6.4). 시작 제한 시간은 180초(`TimeoutStartSec`). 재시작부터 복구 완료까지 목표는 30초다(01 NFR-A-1, 02 AC-10-07). 대규모 마이그레이션이 이보다 길 것 같으면 업그레이드 절차가 미리 `helm ops migrate`를 오프라인으로 돌린다(§3.10.2).

#### 3.4.3 종료 순서 [제안]

`SIGTERM`(systemd stop/restart), `SIGINT`(전경 실행), 로컬 관리자의 정지 명령이 들어오면:

1. 모드 `draining`. 새 연결을 받지 않는다. 기존 연결에 종료 예고 알림(19 `server.shutdown { reason: "restart" | "upgrade" | "stop", restartExpectedMs?, drainDeadline }`)을 보낸다. 이후 상태를 바꾸는 요청은 19의 `5001` 오류로 거절하고 읽기 요청은 받는다.
2. 스케줄러 정지(새 타이머 발화 없음). 관찰 실행 감독기에 `job.cancel { reason: "shutdown" }`(16 §3.2.3).
3. 진행 중 실행 유예: `drainTimeoutMs`(20초) 동안 진행 중 모델 호출·도구 호출이 끝나기를 기다린다. 새 턴은 시작하지 않는다. 사람 대기 중인 실행은 기다리지 않는다(정본에 대기 상태로 남는다).
4. 강제 정리: 남은 모델 요청은 `AbortController`로 끊는다. 남은 도구 프로세스는 SIGTERM(단위면 `systemctl --user kill --signal=SIGTERM`), `toolKillGraceMs`(5초) 뒤 SIGKILL. 끊긴 도구 호출을 12의 규칙대로 `interrupted { reason: "daemon_shutdown" }`로 기록한다. 이 기록이 빠져도 다음 시작의 복구가 같은 결과를 만든다(결정 30).
5. 연결 닫기: WebSocket 닫기 코드 1012(서비스 재시작) 또는 1001.
6. `daemon.stopped { bootEpoch, reason, drainedRuns, interruptedToolCalls }` append. `PRAGMA wal_checkpoint(TRUNCATE)`. DB 닫기.
7. `helmd.owner.json`에 `state: "stopped"`. 잠금 해제. 종료 코드 0.

시간 예산: 1~3단계 최대 20초, 4단계 최대 6초, 5~7단계 보통 1초 이하. 합계 약 27초로 `TimeoutStopSec=45s`(§3.6.4) 안에 들어온다. 45초를 넘기면 systemd가 cgroup 안의 남은 프로세스를 SIGKILL한다(`KillMode=mixed`).

#### 3.4.4 신호 처리 [제안]

| 신호 | 처리 |
|---|---|
| `SIGTERM` | 종료 순서 시작. 시작 단계 중이면 진행 중 단계를 마치고(트랜잭션 중간에 끊지 않음) 정리 후 종료 코드 0 |
| `SIGINT` | `SIGTERM`과 같다(`just daemon-dev` 전경 실행용) |
| 두 번째 `SIGTERM`/`SIGINT` | 3단계 유예를 건너뛰고 4단계로 |
| `SIGHUP` | 설정 다시 읽기(§3.3.3). 종료하지 않는다 |
| `SIGUSR1` | `--disable-sigusr1`로 inspector 열기를 막는다. 처리기는 두지 않는다 |
| `SIGUSR2` | 진단 스냅샷(상태 JSON + 힙 통계, 비밀 없음)을 `state/diag/`에 쓴다 |
| `SIGPIPE` | 무시(Node 기본) |
| `SIGKILL`, OOM | 처리 불가. 다음 시작의 복구가 책임진다 |

#### 3.4.5 종료 코드

| 코드 | 뜻 | systemd 재시작 | 사람이 할 일 |
|---|---|---|---|
| 0 | 깨끗한 종료 | 하지 않음(`on-failure`) | - |
| 1 | 예상하지 못한 오류(처리되지 않은 예외, 복구 실패) | 함(지수 지연) | 반복되면 안전 모드·경보 확인 |
| 2 | 환경 문제(설정 오류, 경로·파일 시스템, 비밀 누락, 포트 사용 중, `runtimeDir` 없음) | 하지 않음 | `helm doctor`. CLAUDE.md의 "종료 코드 2 = 환경 문제" 관례와 같다 |
| 3 | 다른 `helmd`가 잠금을 쥐고 있음 | 하지 않음 | `helm status`로 실행 중인 쪽 확인 |
| 4 | DB 스키마가 코드보다 새로움(다운그레이드 거부) | 하지 않음 | `just daemon-upgrade` 또는 `just daemon-rollback`(§3.10.4) |
| 5 | DB를 열 수 없음(`SQLITE_NOTADB`, `SQLITE_CORRUPT`로 열기 실패). 열리지만 검사가 실패한 경우는 종료하지 않고 읽기 전용 복구 시작(§3.4.2 7단계) | 하지 않음 | §3.9.4 복구 절차 |
| 134/137/143 | abort/SIGKILL/SIGTERM 신호 종료(코드가 아닌 신호) | 신호 종료는 `on-failure` 대상(SIGTERM으로 인한 정상 정지는 제외) | - |

#### 3.4.6 크래시 루프 차단 [제안]

판정 규칙과 안전 모드의 런타임 동작은 12 §3.7.6이 소유한다(같은 수치: 10분에 3회). 17은 판정 결과로 데몬 모드를 바꾸는 일, 해제 명령, systemd 쪽 한도를 맡는다.

```text
uncleanStarts = 지난 crashLoop.windowMs(10분) 안의 daemon.booted 중 prevClean = false 인 것의 수
                (이번 시작 포함)
if uncleanStarts >= crashLoop.maxUncleanStarts (3):
    안전 모드로 시작
    daemon.safe_mode_entered { bootEpoch, uncleanStarts, recentReasons } append
    상태 health = critical, 사유 "crash_loop"
```

- 안전 모드는 재시작해도 풀리지 않는다. `daemon.safe_mode_exited`가 기록될 때까지 다음 시작도 안전 모드로 시작한다. 풀기: 로컬 관리자 `helm ops safe-mode off` 또는 기기 주체의 같은 명령(19가 메서드를 정한다).
- systemd 쪽 한도(`StartLimitBurst=5`, `StartLimitIntervalSec=600`)는 데몬이 아예 시작 단계를 못 넘기는 경우(종료 코드 1이 반복)를 막는다. 한도에 걸리면 단위가 `failed`가 되고 `OnFailure`로 경보가 간다(§3.6.4).
- 12의 실행 단위 재시도 예산(실행 하나가 재시작마다 다시 시작되어 데몬을 죽이는 경우)은 이 차단기와 별개로 12가 둔다(사례 §12.1-3).

#### 3.4.7 이벤트 루프 감시 [제안]

- 주 스레드 지연은 `perf_hooks.monitorEventLoopDelay`로 잰다. p99가 `warnLagMs`(200 ms)를 넘으면 헬스 `degraded`.
- 감시 워커: 주 스레드가 1초마다 `SharedArrayBuffer`의 심장 박동 값을 올린다. 워커는 값이 `fatalLagMs`(120초) 동안 변하지 않으면 주 스레드 스택을 얻을 수 없으므로 `process.report.writeReport()` 대신 자기 쪽 기록(마지막 박동 시각, 진행 중이던 작업 이름 — 주 스레드가 긴 작업 전에 공유 버퍼에 이름 ID를 써 둔다)을 남기고 `process.kill(process.pid, "SIGABRT")`로 끝낸다. systemd가 재시작하고 복구가 이어 간다.
- 시작 단계(마이그레이션·투영 재구성)와 오프라인 작업 동안에는 감시 워커를 켜지 않는다.

### 3.5 리스너 배치 [제안]

| 이름 | 주소 | 받는 연결 | 인증(18) | 프로토콜 |
|---|---|---|---|---|
| `tailnet` | TCP `127.0.0.1:7840` | Windows `tailscale serve`(`https://server.tail7ad0b4.ts.net:8448`)가 넘긴 연결만 | Tailscale 신원 헤더 + whois 대조 + 기기 토큰(AND) | HTTP/1.1 + WebSocket(19) |
| `loopback` | TCP `127.0.0.1:7841` | 데스크톱 앱의 `ssh -W 127.0.0.1:7841 server`(20 APP-D03)가 sshd를 거쳐 여는 연결 | 기기 토큰 필수. Tailscale 헤더는 보지 않는다. 로컬 관리자 주체 불가 | 같음 |
| `local` | Unix `/run/user/1000/helm/rpc.sock`(0600, 디렉터리 0700) | 서버 안의 관리 CLI, TUI(결정 33·39) | 파일 권한(같은 uid). 로컬 관리자 주체 허용, 기기 토큰도 받음 | 같음 |

- 세 리스너 모두 같은 HTTP + WebSocket 스택과 같은 프로토콜 처리기를 쓴다(19 P-01). 다른 것은 연결 수락 직후의 리스너별 사전 검사와 허용 주체뿐이다(18 §3.4).
- `loopback` 리스너를 `tailnet`과 따로 두는 이유: `tailnet`의 인증은 신원 헤더를 요구하는데 SSH로 들어온 연결에는 헤더가 없다. 한 포트에서 "헤더가 없으면 다른 규칙"을 허용하면 헤더 검사를 건너뛰는 길이 생긴다(18 §3.4.2). 19 P-02와 20 APP-D03은 `ssh -W 127.0.0.1:7841`(B3)로 맞췄고 18 ADR-18-2가 보안 조건을 정리했다. `-L`(Unix 소켓 포워딩)을 택하는 경우의 대상은 `rpc.sock`이 아니라 별도 소켓 `remote.sock`(로컬 관리자 불가, 기기 토큰 필수)이어야 한다.
- 포트 선택 근거: WSL과 Windows 양쪽에서 비어 있다 [실험 4·5]. mirrored 모드라 WSL의 127.0.0.1 포트 공간을 Windows와 함께 쓴다 [실험 6]. 홈랩 관례처럼 serve 포트(8448)와 뒤쪽 포트(7840)를 다르게 둔다.
- `0.0.0.0`, tailnet 주소, LAN 주소에는 바인딩하지 않는다. 설정 검증기가 `host`가 `127.0.0.1`(또는 `::1`)이 아니면 거부한다.
- 헬스 엔드포인트 `GET /healthz`는 세 리스너 모두에 있다(§3.11.3).

### 3.6 WSL 운영

#### 3.6.1 systemd 사용 여부 확인

`helm doctor`와 `just daemon-install`이 다음을 확인한다. 하나라도 실패하면 종료 코드 2로 멈추고 고칠 방법을 출력한다.

| 검사 | 명령 | 기대 | 실패 시 안내 |
|---|---|---|---|
| WSL 안인가 | `grep -qi microsoft /proc/sys/kernel/osrelease` | 참 | (WSL 밖이면 경고만. 개발 PC 테스트용) |
| systemd가 PID 1 | `systemctl is-system-running` | `running` 또는 `degraded` | `/etc/wsl.conf`에 `[boot]\nsystemd=true` 후 Windows에서 `wsl --shutdown` (사람) |
| user manager | `systemctl --user is-system-running` | `running`/`degraded` | 위와 같음 |
| linger | `loginctl show-user "$USER" -p Linger` | `Linger=yes` | `sudo loginctl enable-linger "$USER"` (사람) |
| cgroup 위임 | `cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/cgroup.controllers` | `memory`와 `pids` 포함 | 경고만(리소스 한도 없이 동작) |
| `XDG_RUNTIME_DIR` | `test -d /run/user/$(id -u)` | 참 | linger 확인 |

현재 서버는 모두 통과한다 [실험 1·2·3].

#### 3.6.2 user unit과 system unit [제안]

| 기준 | user unit (`systemctl --user`) | system unit (`/etc/systemd/system`, `User=user`) |
|---|---|---|
| 설치 권한 | 사용자. `~/.config/systemd/user`에 파일 생성 | root 필요(에이전트가 할 수 없고 `/etc` 쓰기는 금지) |
| 로그인 없이 동작 | linger로 됨 [실험 2] | 됨 |
| 리소스 한도 | `cpu memory pids` 위임으로 됨 [실험 3] | 됨 |
| 샌드박스 속성 | `PrivateUsers=yes`를 함께 쓰면 `ProtectSystem`, `InaccessiblePaths` 등이 됨 [실험 10] | 전부 됨 |
| 홈랩 관례 | 홈랩 타이머가 모두 user unit | 없음 |
| 도구 격리 단위 생성 | `systemd-run --user`로 sudo 없이 일회성 단위 생성 가능 [실험 10·22] | system manager에 일회성 단위를 만들려면 권한 필요 |
| 로그 | `journalctl --user -u helmd` | `journalctl -u helmd` |

결정: user unit. `helmd.service` 자체에는 `PrivateUsers`를 걸지 않는다. 도구 격리 단위를 `systemd-run --user`로 만들고, 사용자 프로젝트 폴더에 쓰고, `~/.config/sops`의 age 키로 비밀 로더를 돌려야 하기 때문이다. 대신 `NoNewPrivileges=yes`, `UMask=0077`만 건다.

#### 3.6.3 linger

linger가 켜져 있으면 WSL 배포판이 부팅할 때 user manager가 로그인 세션 없이 시작되고 `default.target`에 걸린 `helmd.service`가 뜬다. 배포판 부팅 시점은 §3.6.6의 Windows 쪽 사건이 정한다.

#### 3.6.4 단위 파일 전문 [제안]

원본은 저장소 `ops/systemd/*.in`이다. `just daemon-install`이 `@HELM_ROOT@`를 `/srv/volumes/helm`으로 바꿔 `~/.config/systemd/user/`에 쓰고 `systemctl --user daemon-reload` 한다. `%h`(홈)와 `%t`(`$XDG_RUNTIME_DIR`)는 systemd가 푼다.

`helmd.service`:

```ini
[Unit]
Description=Helm daemon (helmd)
Documentation=file://%h/projects/helm/code/helm/docs/design/17-daemon-and-operations.md
# 10분에 5번 넘게 시작하면 멈추고 경보(데몬 안의 크래시 루프 차단기와 별개, §3.4.6)
StartLimitIntervalSec=600
StartLimitBurst=5
OnFailure=helm-alert@%n.service

[Service]
Type=exec
WorkingDirectory=@HELM_ROOT@/app/current
Environment=PATH=%h/.local/share/mise/shims:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=
Environment=HELM_CONFIG=%h/.config/helm/helmd.toml
Environment=HELM_ROOT=@HELM_ROOT@
ExecStart=@HELM_ROOT@/app/current/bin/helmd
# 복구가 끝나고 리스너가 열릴 때까지 기다린 뒤에 active로 본다(§3.4.2 16단계)
ExecStartPost=@HELM_ROOT@/app/current/bin/helm ops wait-ready --timeout 170
TimeoutStartSec=180s
Restart=on-failure
RestartSec=5s
RestartSteps=4
RestartMaxDelaySec=60s
# 환경 문제·다른 인스턴스·다운그레이드·무결성 실패는 재시작해도 같으므로 멈춘다(§3.4.5)
RestartPreventExitStatus=2 3 4 5
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=45s
SendSIGKILL=yes
# 도구 프로세스가 OOM으로 죽어도 데몬을 멈추지 않는다
OOMPolicy=continue
RuntimeDirectory=helm
RuntimeDirectoryMode=0700
UMask=0077
NoNewPrivileges=yes
LimitNOFILE=16384
MemoryHigh=1G
MemoryMax=1536M
TasksMax=512
CPUWeight=100
SyslogIdentifier=helmd
LogRateLimitIntervalSec=30s
LogRateLimitBurst=5000

[Install]
WantedBy=default.target
```

`helm-tools.slice`(13이 도구를 `systemd-run --slice=helm-tools.slice`로 띄울 때의 합계 한도):

```ini
[Unit]
Description=Helm tool executions (sandboxed transient units)

[Slice]
MemoryHigh=2560M
MemoryMax=3G
TasksMax=1024
CPUWeight=50
```

`helm-backup.service`, `helm-backup.timer`:

```ini
# helm-backup.service
[Unit]
Description=Helm online SQLite backup (verified snapshot for restic)
OnFailure=helm-alert@%n.service

[Service]
Type=oneshot
Environment=PATH=%h/.local/share/mise/shims:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=HELM_ROOT=@HELM_ROOT@
ExecStart=@HELM_ROOT@/app/current/bin/helm ops backup --kind daily --wait
TimeoutStartSec=30min
Nice=10
IOSchedulingClass=idle
```

```ini
# helm-backup.timer  — 홈랩 vault-snapshot(03:30) 뒤, restic(04:00) 전
[Unit]
Description=Daily Helm backup at 03:40

[Timer]
OnCalendar=*-*-* 03:40:00
Persistent=true

[Install]
WantedBy=timers.target
```

`helm-restore-drill.service`, `helm-restore-drill.timer`:

```ini
# helm-restore-drill.service
[Unit]
Description=Helm restore drill (restore latest snapshot to tmp and verify)
OnFailure=helm-alert@%n.service

[Service]
Type=oneshot
Environment=PATH=%h/.local/share/mise/shims:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=HELM_ROOT=@HELM_ROOT@
ExecStart=@HELM_ROOT@/app/current/bin/helm ops drill
TimeoutStartSec=1h
Nice=15
IOSchedulingClass=idle
```

```ini
# helm-restore-drill.timer — 홈랩 restore-test(매월 1일 05:30) 뒤
[Unit]
Description=Monthly Helm restore drill

[Timer]
OnCalendar=*-*-01 05:45:00
Persistent=true

[Install]
WantedBy=timers.target
```

`helm-verify.service`·`.timer`, `helm-maintenance.service`·`.timer`(§3.9.7):

```ini
# helm-verify.service
[Unit]
Description=Helm weekly full ledger verification
OnFailure=helm-alert@%n.service

[Service]
Type=oneshot
Environment=PATH=%h/.local/share/mise/shims:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=HELM_ROOT=@HELM_ROOT@
ExecStart=@HELM_ROOT@/app/current/bin/helm ops verify --full --if-running
TimeoutStartSec=2h
Nice=15
IOSchedulingClass=idle
```

```ini
# helm-verify.timer
[Unit]
Description=Weekly Helm ledger verification (Sunday 04:30)

[Timer]
OnCalendar=Sun *-*-* 04:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

```ini
# helm-maintenance.service
[Unit]
Description=Helm daily maintenance (retention pruning, blob GC, temp cleanup)
OnFailure=helm-alert@%n.service

[Service]
Type=oneshot
Environment=PATH=%h/.local/share/mise/shims:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=HELM_ROOT=@HELM_ROOT@
ExecStart=@HELM_ROOT@/app/current/bin/helm ops maintain --if-running
TimeoutStartSec=1h
Nice=15
IOSchedulingClass=idle
```

```ini
# helm-maintenance.timer
[Unit]
Description=Daily Helm maintenance at 04:45

[Timer]
OnCalendar=*-*-* 04:45:00
Persistent=true

[Install]
WantedBy=timers.target
```

`helm-alert@.service`(실패 경보. 릴리스가 망가져도 돌도록 릴리스 밖의 고정 스크립트를 부른다):

```ini
[Unit]
Description=Helm alert: %i failed

[Service]
Type=oneshot
Environment=PATH=%h/.local/share/mise/shims:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=HELM_ROOT=@HELM_ROOT@
Environment=HOMELAB_ROOT=%h/projects/homelab
ExecStart=@HELM_ROOT@/app/bin/helm-alert %i
TimeoutStartSec=2min
```

`helm-alert`가 하는 일: (1) `state/alerts/<unit>.json`에 `{ at, unit, result, lastLogLines }`(마지막 50줄, 18 §3.10 마스킹 적용)를 쓴다. (2) `$HOMELAB_ROOT/scripts/alert`가 실행 가능하면 `scripts/alert <unit>`을 부른다(홈랩이 ntfy 전송과 6시간 1회 제한을 한다 [원문 homelab storage.md 백업 절]). (3) 둘 다 실패해도 0으로 끝낸다(경보 단위가 경보를 부르지 않게).

설치 뒤 활성화: `systemctl --user enable --now helmd.service helm-backup.timer helm-restore-drill.timer helm-verify.timer helm-maintenance.timer`. `helm-tools.slice`와 `helm-alert@.service`는 enable하지 않는다(필요할 때 쓰인다).

#### 3.6.5 재시작 정책 해설

- `Restart=on-failure`를 쓴다. oss §5.1의 `Restart=always`는 정상 정지(`helm daemon stop` → 코드 0)까지 되살리므로 사람이 일부러 멈춘 데몬이 다시 뜬다.
- 재시작 지연: 5초에서 시작해 4단계에 걸쳐 60초까지 늘린다(`RestartSteps`, `RestartMaxDelaySec`, systemd 254 이상 [지식], 서버는 255 [실험 3]).
- 재시작마다 데몬 쪽에서는 비정상 종료가 기록되고, 10분에 3번이면 안전 모드다(§3.4.6). systemd 쪽에서는 10분에 5번 시작하면 단위가 `failed`가 된다. 순서상 데몬 안전 모드가 먼저 걸린다. 안전 모드에서는 실행을 재개하지 않으므로 같은 실행이 데몬을 다시 죽이는 고리가 끊긴다.
- `failed` 상태에서 다시 시작: `systemctl --user reset-failed helmd && systemctl --user start helmd`(= `just daemon-start`).

#### 3.6.6 Windows·WSL 사건별 동작

| 사건 | 일어나는 일 | 데몬 쪽 결과 | 사람이 볼 것 |
|---|---|---|---|
| Windows 절전·최대 절전 | AC에서 꺼 두었다 [실험 14]. 그래도 일어나면 WSL VM이 멈춘다 | 깨어나면 그대로 이어진다. 벽시계가 크게 뛴다. 스케줄러는 타이머를 절대 시각으로 다시 계산하고 최대 60초 단위로 깨어나므로 지난 타이머를 따라잡는다(12, 사례 §12.1-9). 원격 연결은 TCP가 끊겨 클라이언트가 `lastSeq`로 다시 붙는다 | 상태의 "마지막 시계 점프"(§3.11.1) |
| Windows Update 재부팅 | 사용 시간 08–02 밖에서 일어난다 [원문 homelab decisions]. WSL VM이 종료된다(A17-1: 정상 종료를 보장하지 않음) | 비정상 종료로 기록된다. 재부팅 뒤 **사용자가 Windows에 로그온해야** `WSL-Autostart` 작업이 배포판을 띄우고 `helmd`가 시작한다 [실험 13]. 로그온 전까지 데몬은 꺼져 있다 | 복귀 요약에 "데몬 꺼짐 구간"(이전 `daemon.booted`/마지막 이벤트 시각과 새 `daemon.booted` 사이) |
| `wsl --shutdown`, `wsl --terminate` | VM 또는 배포판 종료 | 비정상 종료. 다음 배포판 기동 때 시작·복구 | 같음 |
| WSL 유휴 종료 | `vmIdleTimeout=-1`, `instanceIdleTimeout=-1`, `sleep infinity` 유지 작업으로 막혀 있다 [실험 11·13] | 일어나지 않아야 한다. 일어나면 위와 같다 | WSL 업데이트 뒤 `helm doctor`(oss §5.2: 2.5.7에서 유휴 동작이 바뀐 사례 [지식]) |
| WSL 업데이트 | 배포판 재시작을 동반할 수 있다 | 같음 | `just daemon-status` |
| 정전 | 홈랩 범위(BIOS 설정) | 비정상 종료. WAL은 마지막 커밋까지 보존(`synchronous` 값에 따라 마지막 트랜잭션 몇 개를 잃을 수 있다, 09) | 같음 |
| Wi-Fi 끊김 | tailnet 연결 끊김 | 데몬은 계속 돈다(결정 22). 모델 호출이 실패하면 12의 재시도 규칙 | 원격 접속 불가(SSH 22도 tailnet 전용) |
| Windows Tailscale 정지 | serve 정지, tailnet 끊김 | 계속 돈다. whois 실패 → `tailnet` 리스너의 새 인증이 실패(18 §3.6) | 서버 PC 앞에서는 `local`로 쓸 수 있다 |
| WSL interop 고장 | `tailscale.exe whois` 호출 실패 | `tailnet` 새 인증 실패(fail closed). `loopback`(SSH) 경로는 영향 없음 | 헬스 `whois` 점검 실패 |
| Windows 메모리 부족 | WSL 10 GB 상한 안에서 압박 | cgroup `MemoryHigh`로 먼저 늦춰지고 `MemoryMax`에서 OOM. `OOMPolicy=continue`라 도구가 죽어도 데몬은 남는다 | 헬스 `memory` |

로그인 전 자동 시작은 지금 방법이 없다(§2.3). 미결 Q17-01에 선택지를 둔다.

#### 3.6.7 keepalive

두 층이 있다.

1. **WSL 인스턴스 유지**: dotfiles가 만든 `WSL-Autostart`(로그온 시 `sleep infinity`)와 `.wslconfig`의 유휴 시간 -1로 이미 되어 있다 [실험 11·13]. Helm은 아무것도 더하지 않는다. `helm doctor`가 두 설정을 읽어 확인한다(`/mnt/c/Users/*/.wslconfig`, `schtasks.exe /query /tn WSL-Autostart`).
2. **연결 유지**: WebSocket 생존 확인(서버 ping과 앱 수준 `tick`)은 19 P-12가 정한다. 데몬은 TCP 소켓에 `setKeepAlive(true, 30_000)`을 건다. SSH 경로는 앱이 `ServerAliveInterval=15`, `ServerAliveCountMax=3`을 쓴다(20에 요구, S4 openclaw 앱 설정과 같다). sshd 쪽 설정은 바꾸지 않는다.

#### 3.6.8 시간

- WSL 시계는 NTP로 맞춰져 있다 [실험 16]. 데몬은 시작 때와 1시간마다 `timedatectl show -p NTPSynchronized`를 읽어 헬스 `clock`에 반영한다.
- 저장은 epoch ms(브리프 §3.3). 타이머·가정 만료점·기대 레코드 기한은 절대 시각으로 저장한다(12, mastra-review §9).
- 시계가 뒤로 가는 것을 감지하면(이번 이벤트 시각 < 마지막 이벤트 시각 − 5초) 이벤트 시각은 단조성을 지키도록 09의 규칙을 따르고, 상태에 `clockJumps`를 기록한다.

### 3.7 Windows 호스트 쪽 작업

#### 3.7.1 `serve.table` 한 줄과 적용

홈랩 저장소에 더할 줄(홈랩 소유자가 한다. 이 저장소에서 쓰지 않는다):

```text
8448  http://127.0.0.1:7840   helm
```

적용 절차(홈랩 `runbooks/add-service.md` 1번과 6번 일부):

1. `~/projects/homelab/tailscale/serve.table`에 위 줄 추가.
2. `cd ~/projects/homelab && just serve-apply` — WSL interop으로 `tailscale.exe serve --bg --https=8448 http://127.0.0.1:7840`을 실행한다. 관리자 권한이 필요 없다 [원문 `scripts/serve-apply`].
3. `just ctx`로 `context/network.md`의 표를 갱신.
4. 확인: Mac에서 `curl -s https://server.tail7ad0b4.ts.net:8448/healthz` → `{"status":"ok"}`. 이 저장소에서 `just daemon-probe`(§3.14).

`just daemon-serve-line`이 위 줄을 출력한다(포트를 바꿨을 때 설정에서 다시 만든다).

Windows 호스트에서 관리자 권한으로 실행할 Helm 전용 스크립트는 없다. 02 UC-11 3단계의 "Windows 호스트 쪽 설정"은 (1) 홈랩 `serve.table` 한 줄과 `just serve-apply`(WSL에서 실행, 관리자 권한 불필요), (2) 이미 적용된 dotfiles `bootstrap.ps1`의 keepalive 작업·전원 설정 확인(`ops/windows/check-helm-host.ps1`, 읽기 전용)뿐이다(02에 반영 요구).

#### 3.7.2 방화벽

변경하지 않는다. 이유:
- 뒤쪽 포트 7840·7841은 127.0.0.1에만 바인딩한다. 외부에서 열 길이 없다.
- tailnet 쪽 8448은 Windows의 `tailscaled`가 듣는다. 기존 8443~8447과 같은 경로로 이미 동작한다(같은 규칙을 쓴다) [실험 5].
- Tailscale grants는 소유자 기기 → `tag:server` 전체를 허용한다 [원문 homelab `tailscale/policy.hujson`]. `tag:vps`, `tag:ci`는 443·8448에 접근할 수 없다(정책 tests).
- WSL Hyper-V 방화벽은 22와 22000만 연다. 7840·7841을 열 필요가 없다(루프백 경로).

#### 3.7.3 확인 스크립트 `ops/windows/check-helm-host.ps1` [제안]

읽기 전용이고 관리자 권한이 필요 없다. 사람이 Windows PowerShell에서 실행한다. 바꾸는 것이 없으므로 `-WhatIf`가 필요 없다. 홈랩 스크립트 규칙(단계별 출력, 비밀 출력 없음)을 따른다.

```powershell
# ops/windows/check-helm-host.ps1 — Helm이 기대하는 Windows 호스트 상태를 읽기만 한다. 관리자 권한 불필요.
# 종료 코드: 0 모두 정상, 1 경고 있음, 2 Tailscale CLI 없음.
[CmdletBinding()] param([int]$ServePort = 8448, [int]$BackendPort = 7840)
$ErrorActionPreference = 'Stop'; $warn = 0
function Ok($m)   { Write-Host "OK      $m" }
function Warn($m) { Write-Host "WARN    $m"; $script:warn++ }

$ts = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
if (-not (Test-Path $ts)) { Write-Host "FAIL    tailscale.exe 없음: $ts"; exit 2 }
$serve = & $ts serve status --json | ConvertFrom-Json
$tcp = $serve.TCP."$ServePort"
if (-not $tcp) { Warn "serve $ServePort 없음 (homelab serve.table + just serve-apply)" }
elseif ($tcp.TCPForward) { Warn "serve $ServePort 가 TCP 패스스루다 (https 이어야 함)" }
else {
  $proxy = $serve.Web.PSObject.Properties | Where-Object { $_.Name -like "*:$ServePort" } |
           ForEach-Object { $_.Value.Handlers.PSObject.Properties.Value.Proxy } | Select-Object -First 1
  if ($proxy -eq "http://127.0.0.1:$BackendPort") { Ok "serve $ServePort -> $proxy" } else { Warn "serve $ServePort -> $proxy (기대: http://127.0.0.1:$BackendPort)" }
}
if ($serve.AllowFunnel -and $serve.AllowFunnel.PSObject.Properties.Name -match ":$ServePort$") { Warn "Funnel이 $ServePort 에 켜져 있다 (끌 것)" } else { Ok "Funnel 꺼짐" }

$task = Get-ScheduledTask -TaskName 'WSL-Autostart' -ErrorAction SilentlyContinue
if ($task -and $task.State -ne 'Disabled') { Ok "작업 WSL-Autostart ($($task.State))" } else { Warn "작업 WSL-Autostart 없음 또는 꺼짐 (dotfiles bootstrap.ps1 7단계)" }

$cfg = Join-Path $env:USERPROFILE '.wslconfig'
$text = if (Test-Path $cfg) { Get-Content $cfg -Raw } else { '' }
foreach ($k in 'vmIdleTimeout=-1','instanceIdleTimeout=-1','networkingMode=mirrored') {
  if ($text -match [regex]::Escape($k)) { Ok ".wslconfig $k" } else { Warn ".wslconfig 에 $k 없음" }
}
$standby = (powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String 'AC Power Setting Index|AC 전원 설정 인덱스') -replace '.*:\s*',''
if ($standby -and [Convert]::ToInt32($standby.Trim(),16) -eq 0) { Ok "AC 대기 안 함" } else { Warn "AC 대기 시간이 0이 아니다 ($standby)" }
if ($warn -gt 0) { exit 1 } else { exit 0 }
```

#### 3.7.4 홈랩 쪽 변경 요청

이 문서가 홈랩에 요구하는 변경이다. 홈랩 소유자가 홈랩 규칙(결정 기록, `just ctx-lint`)에 맞게 반영한다. 반영 전까지 Helm은 restic 백업이 없는 상태로 본다(헬스 `backup_offsite` = `degraded`).

| 요청 | 내용 | 이유 |
|---|---|---|
| H-1 `serve.table` | §3.7.1의 한 줄 | 원격 접속 |
| H-2 restic 대상 | `scripts/backup`의 `collect_paths`가 docker가 아닌 서비스의 경로도 넣게 한다. 제안: `/srv/volumes/<svc>/.backup-paths`(한 줄에 상대 경로 하나) 표식 파일을 읽는다. Helm은 §3.2.2 백업 표의 "포함" 행(`backups`, `data/blobs/sha256`, `private`, `drafts`, `state`, `eval`)을 적는다 | [실험 20]. 살아 있는 DB(`data/helm.sqlite*`)는 넣지 않고 검증된 스냅샷만 넣는다(CouchDB `_staging`과 같은 생각) |
| H-3 제외 목록 | `scripts/backup.exclude`에 §3.2.2 백업 표의 "제외" 행 경로(`/srv/volumes/helm/data/helm.sqlite*`, `…/data/blobs/staged`, `…/data/blobs/.tmp`, `…/data/quarantine`, `…/app`, `…/tmp`, `…/dev`, `…/observer`, `…/sandbox`, `…/worktrees`, `…/tool-output`, `…/scratch`, `…/state/diag`, `…/state/exports`) | H-2가 디렉터리 단위로 넣을 때를 대비 |
| H-4 `ctx-lint` | docker 스택이 없는 `serve.table` 줄을 허용하거나, systemd 서비스용 메타데이터(`context/services.md` 손으로 쓰는 행)를 둔다 | `ctx-gen`은 compose 라벨에서 문서를 만든다 |
| H-5 Caddy 관리 API | 홈랩 범위의 발견: `127.0.0.1:2019`(Caddy 관리 API)가 인증 없이 열리고 Windows 프로세스에서도 응답한다 [실험: `curl.exe http://127.0.0.1:2019/config/` → 200]. Helm 도구 격리(18 §3.11)는 기본으로 네트워크를 끊지만, 네트워크를 허용한 도구 실행은 이 포트에 접근할 수 있다. 홈랩이 `admin` 소켓을 Unix 소켓으로 바꾸거나 `admin off`를 검토할 것 | 18 §3.2 T-M5 |

### 3.8 비밀 로딩 [제안]

정책(어떤 비밀이 어디에 있고 어떻게 가리는지)은 18 §3.10이 정한다. 17은 로딩 절차만 정한다.

1. 원본: `~/projects/helm/secrets/prod.sops.yaml`(제품 비밀, SECRETS.md 레이어 표). 아직 없다 [실험: `~/projects/helm`에 `code/`만 있음]. 첫 설치 전에 사람이 `cd ~/projects/helm && secrets init`, `secrets edit prod`로 만든다. 저장소 `code/helm/.env.example`에 데몬이 읽는 키를 `KEY=`로 적는다(키 목록: 12 §3.3.4의 `ANTHROPIC_API_KEY=`, `OPENAI_API_KEY=`, `GEMINI_API_KEY=`, `OPENROUTER_API_KEY=`, 09·18 §3.10.5의 `HELM_LEDGER_HMAC_KEY=`).
2. 시작 단계 4: `helmd`가 `secrets run product:helm/prod -- <릴리스>/bin/helm-secret-export <키…>`를 자식으로 띄운다. `helm-secret-export`는 인자로 받은 키만 환경에서 골라 `{"KEY":"값",…}` JSON 한 줄을 표준 출력에 쓰고 끝난다. 표준 오류는 데몬 로그로 보내되 값이 섞이지 않게 키 이름 외에는 버린다.
3. 데몬은 출력을 `SecretStore`(18 §3.10)에 넣고 버퍼를 0으로 덮어쓴 뒤 버린다. 받은 값을 마스킹기에 등록한다. `process.env`에는 넣지 않는다. 그래서 자식 프로세스(도구 실행)가 환경을 물려받아도 비밀이 없고, `/proc/<helmd pid>/environ`에도 없다.
4. `secrets`의 종료 코드 2(sops·yq 없음, 원본 없음)는 데몬 종료 코드 2로 이어진다. `required`에 없는 키가 비어 있으면 그 기능만 저하로 표시한다(헬스 `secrets`).
5. 값을 바꾸면: 사람이 `secrets edit prod` 뒤 `helm ops reload-secrets`(로컬 관리자). 데몬이 2~3단계를 다시 하고 `secrets.reloaded { keys }`(키 이름만)를 남긴다. 재시작이 필요 없다.
6. 개발: `just daemon-dev`는 저장소 관례대로 `_with-secrets dev`로 환경 변수에 주입하고 `HELM_SECRETS_FROM_ENV=1`로 띄운다. 데몬은 읽은 직후 해당 키를 `process.env`에서 지운다.

이 방식이 `ExecStart=secrets run … -- helmd`보다 나은 이유: `secrets run`은 `exec sops exec-env`이고 sops는 명령을 자식으로 돌리며 SIGTERM을 전달하지 않는다 [실험 19]. 그러면 systemd의 주 PID가 sops가 되어 `KillMode=mixed`의 정상 종료 신호가 node에 가지 않는다.

### 3.9 백업·복구

#### 3.9.1 백업 종류와 보관 [제안]

스냅샷 하나를 만드는 절차와 매니페스트 형식은 09 §3.14.1이 소유한다(헤드 HMAC 체크포인트 → `db.backup()` → 사본 `integrity_check`와 체인 전체 검사 → `manifest.json` → 원자 rename → `backup.created`). 17은 언제 만들고 얼마나 남기고 어디로 내보내는지를 정한다.

| 종류 | 언제 | 로컬 보관(`backup.keep`) | restic |
|---|---|---|---|
| `daily` | `helm-backup.timer` 매일 03:40 | 최근 3개 | 포함(홈랩 04:00, 보존 일 7·주 4·월 6) |
| `pre-migrate` | 시작 단계 8에서 마이그레이션 직전 | 최근 3개 | 포함 |
| `pre-upgrade` | `just daemon-upgrade` 4단계 | 최근 3개 | 포함 |
| `pre-restore` | 복원 직전(현재 DB가 열리면) | 최근 3개 | 포함 |
| `manual` | `just daemon-backup`, `helm ops backup` | 최근 5개 | 포함 |

- 위치: `backups/<kind>/<backupId>/{helm.sqlite, manifest.json}`, `backupId = <UTC YYYYMMDDTHHMMSSZ>-seq<N>`(09 §3.14.1).
- 정리 규칙: 종류별로 오래된 것부터 지우고 `backup.pruned`를 남긴다. 가장 최근의 검증 통과 스냅샷은 종류와 무관하게 지우지 않는다. 디스크 여유가 `diskWarnBytes` 미만이면 `daily` 보관을 1개로 줄이고 경고한다. 주간 전체 검사나 백업 사본 검사가 실패한 동안에는 정리를 멈춘다(09 §3.10.4).
- 백업 전 디스크 확인: 여유 < DB 크기 × 2 + `diskCriticalBytes`이면 만들지 않고 `backup.failed { reason: "disk" }`.
- blob은 스냅샷에 복사하지 않는다. `data/blobs/sha256/`을 restic이 직접 가져간다(H-2). 참조 없는 blob 행의 GC 유예는 35일(restic 일 7 + 주 4의 최장 보존 창)이다(09 §3.12).
- 실행 위치: 데몬 안(`helm-backup.service`가 `helm ops backup --kind daily --wait`로 요청). 데몬이 꺼져 있으면 CLI가 잠금을 잡고 같은 코드를 오프라인으로 실행한다.

#### 3.9.2 매니페스트에 17이 더하는 것

09의 매니페스트(`backupId, kind, createdAt, storeId, upToSeq, headHash, hmacHead, userVersion, projectorVersion, releaseId, dbSha256, dbBytes, blobCount`)에 운영 필드 두 개를 더해 달라고 09에 요구한다: `verify: { integrity: "ok", chain: "ok", checkedEvents, durationMs }`(상태 화면과 15분 경고에 씀), `producer: { gitSha, bootEpoch, host }`. `headHash`·`hmacHead`는 체인 재작성 감지의 외부 기준점이다(18 §3.13.3).

#### 3.9.3 restic 연계

- Helm은 restic을 직접 부르지 않는다. 홈랩 `scripts/backup`이 04:00에 §3.2.2 백업 표의 "포함" 경로를 가져간다(H-2 반영 뒤). 03:40 백업이 04:00 전에 끝나야 한다. DB 1 GB 기준 백업 API와 전체 검사는 수 분 안에 끝난다 [가정 A17-5. 실측을 상태에 기록하고 15분을 넘으면 경고].
- 홈랩 백업 성공 여부는 `~/.local/state/homelab/backup.status`(마지막 성공 시각) [원문 homelab storage.md]를 읽어 헬스 `backup_offsite`에 반영한다. 이 파일이 26시간보다 오래되었거나 H-2가 반영되지 않았으면(`grep -q backup-paths ~/projects/homelab/scripts/backup`으로 확인) `degraded`.
- restic 저장소 자체가 암호화된다(홈랩). 스냅샷에는 기기 토큰 해시와 이벤트 로그 전체가 들어 있다(18 §3.16).

#### 3.9.4 복원 절차 (runbook) [제안]

DB 수준 절차는 09 §3.14.2 `restore(backupId)`다. `just daemon-restore <backupId 또는 경로>`가 아래 운영 단계로 그것을 감싼다(`ops/bin/daemon-restore` → `helm ops restore`). 인자를 주지 않으면 로컬 스냅샷 목록을 보여 주고 고르게 한다.

```text
0. 어디서 가져오나
   - 로컬: /srv/volumes/helm/backups/<kind>/<backupId>/
   - restic: cd ~/projects/homelab && sops exec-env secrets/restic.sops.yaml 'bash' 안에서
       restic restore latest --host homelab --target /srv/volumes/helm/tmp/restic-<시각> \
         --include /srv/volumes/helm/backups --include /srv/volumes/helm/data/blobs/sha256
     (homelab runbooks/restore.md의 "파일/폴더 하나" 방식). blob이 사라졌으면 함께 되살린다
1. systemctl --user stop helmd.service          (도구·관찰 실행은 함께 멈춘다)
2. 잠금 획득(§3.1.4). 실패하면 중단(종료 코드 3)
3. 09 restore 1~5단계: 백업 검증(dbSha256, integrity_check, verify(full), headHash, hmacHead),
   가능하면 pre-restore 스냅샷, 현재 DB를 data/quarantine/<시각>/로 이동, 백업 DB 복사, 새 storeId와 meta.restored_from
   - user_version > 현재 코드면 중단: "이 스냅샷은 더 새 릴리스가 만든 것"(릴리스를 먼저 맞춘다)
4. 기기 보안 처리(18 §3.16): 현재(격리된) DB를 열 수 있으면 그 DB의 폐기·만료 기기와 무효 페어링 코드를
   복원본에 병합한다. 열 수 없으면 복원본의 모든 기기 토큰을 무효로 표시한다. 결과는 9단계의 store.restored에 싣는다
5. 잠금 해제, systemctl --user start helmd.service
6. 시작 단계 10에서 daemon.booted 다음에 store.restored { previousStoreId, storeId, backupId, upToSeq,
   devicesMerged, devicesInvalidated }(09 §3.14.2 6단계). 손상 복구였으면 integrity.recovered도 남긴다
7. 런타임 복구(12)가 스냅샷 시점에 진행 중이던 실행을 이전 세대의 중단 실행으로 정리한다
8. 검증(§3.9.5) 결과와 "없는 blob 목록"(restic에서 되살릴 것)을 출력
```

- blob만 잃은 경우: DB는 그대로 두고 restic에서 `data/blobs/sha256`만 되살린 뒤 `helm ops verify --blobs`.
- 서버 전체를 다시 세울 때: 홈랩 `runbooks/restore.md` "서버 전체 재구축"의 2단계 폴더별 복원에 §3.2.2 "포함" 경로를 더하고, 이 저장소를 받아 `just daemon-install` 뒤 위 절차로 최신 `daily`를 복원한다. `state/server-id`도 되살려야 클라이언트가 같은 서버로 인식한다(없으면 새로 만들고 모든 앱이 `wrong_server`로 멈춘다. 그때는 다시 페어링).

#### 3.9.5 복구 검증

`helm ops verify [--full] [--blobs] [--anchors]`(검사 알고리즘은 09 §3.10.4 `verify(db, mode)`):

| 검사 | 기본 | `--full` |
|---|---|---|
| `PRAGMA quick_check` | O | `integrity_check` |
| 해시 체인과 HMAC 체크포인트 | tail(마지막 1만 건 또는 마지막 전체 검사 이후) | 전체. 성공하면 `integrity.verified` |
| 투영 일관성 | - | 투영을 임시 DB에 재구성해 `projectionDigest` 비교(09) |
| 스키마·메타 | O | O |
| 블롭 참조 | `--blobs`: 참조된 블롭 파일 존재와 해시 | 같음 |
| 외부 기준점 | `--anchors`: 로컬 백업 매니페스트들의 `(upToSeq, headHash)`가 현재 체인의 같은 seq 해시와 같은지(18 §3.13.3) | 같음 |

결과는 표 형태로 출력하고 실패가 있으면 종료 코드 1.

#### 3.9.6 복구 훈련 [제안]

`helm ops drill`(매월 1일 05:45 타이머, 수동 `just daemon-drill`):

```text
1. 최신 daily 스냅샷과 매니페스트를 고른다(없으면 실패)
2. sha256 확인 → tmp/drill-<시각>/helm.sqlite 로 복사
3. 데몬 코드의 store를 그 경로에 "훈련 모드"(읽기 전용 + 투영은 임시 DB)로 연다. 데몬 잠금과 무관
4. integrity_check, 09 verify(full)(HMAC 포함), 투영을 임시 DB에 재구성해 09 `projectionDigest()`가 스냅샷 안 투영 테이블의 값과 같은지
5. 참조 블롭 중 최대 200개 표본이 data/blobs 에 있는지
6. 각 단계 소요 시간 측정. state/drills/<시각>.json 에 결과 기록, drill.completed { ok, snapshot, durations } append
   (데몬이 꺼져 있으면 이벤트 대신 상태 파일만)
7. tmp/drill-<시각> 삭제
실패: 종료 코드 1 → OnFailure 경보
```

- 분기마다 한 번은 restic에서 꺼낸 스냅샷으로 사람이 `just daemon-drill --file <restic에서 꺼낸 파일>`을 돌린다(홈랩 `restore-test offsite`와 같은 주기). 미결 Q17-05.
- 훈련은 데몬을 멈추지 않는다. 정본 DB에 쓰지 않는다(이벤트 append 하나 제외).

#### 3.9.7 정기 유지 작업 [제안]

09·13·15·19가 요구한 정리 작업을 systemd 타이머 둘로 묶는다(09 §5.2 요구 (2)). 둘 다 실행 중인 데몬에 요청하고, 데몬이 꺼져 있으면 아무것도 하지 않고 0으로 끝낸다(정리는 급하지 않다).

| 타이머 | 시각 | 명령 | 하는 일 |
|---|---|---|---|
| `helm-verify.timer` | 매주 일요일 04:30(restic 04:00 뒤, 홈랩 docker-prune 05:00 전) | `helm ops verify --full` | 09 §3.10.4 전체 검사. 실패하면 헬스 `db_integrity` critical, 백업 정리 정지, 경보(§4 F-22) |
| `helm-maintenance.timer` | 매일 04:45 | `helm ops maintain` | (1) 09 §3.15.3 보존 정책의 가지치기(명령 inbox, 요청 blob, 컨텍스트 투영 blob, trace, 큰 도구 출력 blob). (2) blob GC: 행 없는 파일 1시간, 참조 없는 행 35일(09 §3.12). (3) 업로드 대기 파일 24시간(19 staged). (4) `tool-output/`에서 blob으로 옮긴 뒤 24시간 넘은 파일(07 T5). (5) `worktrees/`의 고아(실행이 끝났거나 이전 epoch, 6시간 넘음). (6) `sandbox/<ws>/home`의 30일 넘게 안 쓴 홈(13). (7) `scratch/inquiry/`의 14일 넘은 항목(15). (8) `tmp/`의 1일 넘은 항목. 결과를 `state/maintenance/<날짜>.json`에 쓴다 |

- 가지치기는 정본 이벤트를 지우지 않는다(이벤트는 영구, 09 §3.15.3). 내용만 지운 blob은 행과 해시가 남는다.
- 사용자 시간대(`user.timeZone`) 기준이 아니라 서버 시각(KST) 기준이다. 서버와 사용자 시간대가 같다 [실험 16].

### 3.10 업그레이드

#### 3.10.1 릴리스 디렉터리와 매니페스트 [제안]

```ts
// <릴리스>/manifest.json
export interface ReleaseManifest {
  format: 1;
  releaseId: string;          // `${version}+${shortSha}`, 예 "0.1.0+bad4d2d"
  version: string;            // 루트 package.json
  gitSha: string;             // 빌드한 커밋 전체 해시
  builtAt: string;            // ISO 8601 UTC
  dirty: false;               // 작업 트리 변경이 섞였으면 빌드 거부
  node: { path: string; version: string; abi: string };   // `mise which node`, process.version, process.versions.modules
  schema: { min: number; max: number };   // 이 코드가 열 수 있는 DB 스키마 범위(09). min은 마이그레이션 시작 가능 최솟값
  protocol: { current: number; accepts: number[] };        // 19 P-14
  pi: { vendorCommit: string; npm: Record<string, string> }; // 07의 고정 버전 기록. 지금 값: vendorCommit "abe508e1b89912adde45528136c3221eb69acdd7"(태그 v1.1.0), npm 고정 의존 4개 모두 "1.1.0"
  tools: { rg: string; fd: string; git: string; bwrap?: string };  // 빌드 때 `--version`으로 기록(07 T3, 13). 다르면 helm doctor가 경고
  files: { sha256: string };  // daemon/ cli/ bin/ 전체 파일 목록 해시(정렬된 경로+해시의 해시). helm doctor가 변조를 확인
}
```

실행 래퍼 `bin/helmd`(빌드 때 생성):

```sh
#!/bin/sh
# 생성됨: releases/0.1.0+bad4d2d — Node 경로는 빌드 때 `mise which node`로 고정한다(아래 경로는 예시)
DIR="$(dirname "$(readlink -f "$0")")/.."
exec "/home/user/.local/share/mise/installs/node/24.19.0/bin/node" \
  --disable-sigusr1 --max-old-space-size=768 --enable-source-maps \
  "$DIR/daemon/dist/main.js" "$@"
```

`exec`로 넘기므로 systemd의 주 PID가 node가 된다. Node 경로의 버전 디렉터리가 mise 정리로 사라지면 시작이 실패한다(종료 코드 127 → 재시작 → systemd 한도). `helm doctor`가 매니페스트의 `node.path` 존재를 확인한다.

#### 3.10.2 업그레이드 절차 [제안]

`just daemon-upgrade [--when-idle] [--force]` → `ops/bin/daemon-upgrade`:

```text
1. 준비 검사
   - git 작업 트리 깨끗(빌드는 커밋에서만). HEAD 커밋을 대상
   - just verify 통과 기록 확인(같은 커밋에서 통과했는지. 없으면 실행)
   - 현재 데몬 상태: 진행 중 실행 수. --when-idle 이면 0이 될 때까지 최대 30분 기다림.
     0이 아니고 --force 가 없으면 중단(진행 중 실행은 재시작 때 중단되어 복구 규칙을 탄다)
2. 빌드(데몬을 멈추지 않는다)
   - git archive HEAD | tar -x -C tmp/build-<id>
   - pnpm install --frozen-lockfile ; pnpm -r build
   - pnpm --filter @helm/daemon deploy --prod releases/<id>.staging/daemon
   - pnpm --filter @helm/cli    deploy --prod releases/<id>.staging/cli
   - bin/ 래퍼 생성, manifest.json 작성(node 경로, ABI, schema 범위, files 해시)
3. 자체 시험: releases/<id>.staging/bin/helmd --self-test
   - 모듈 로드, better-sqlite3 네이티브 바인딩, 설정 검증
   - 현재 DB의 복사본(backup API로 tmp에)을 대상으로 마이그레이션 시험(helm ops migrate --dry-run --db <복사본>)
   실패하면 staging 삭제 후 중단. 운영 데몬은 그대로
4. pre-upgrade 백업(실행 중 데몬에 요청, §3.9.1). 실패하면 중단
5. 전환: rename releases/<id>.staging → releases/<id>
         previous ← current 의 대상, current ← releases/<id> (ln -sfn 임시 링크 후 mv -T 로 원자 교체)
6. systemctl --user restart helmd.service   (ExecStartPost 가 준비 완료까지 기다린다)
7. 확인: helm status --json 의 releaseId = <id>, mode ∈ {ready}, health ≠ critical
8. 실패(6 또는 7)하면 자동 되돌리기(§3.10.4) 후 종료 코드 1
9. 성공: 오래된 릴리스 정리(current, previous, 그 밖 최근 1개만 남김). daemon.upgraded { from, to } 는
   새 데몬의 daemon.booted(prevEpoch, version) 와 releaseId 비교로 충분하므로 따로 쓰지 않는다
```

- 큰 마이그레이션: 3단계 시험에서 마이그레이션이 60초를 넘으면, 6단계 전에 데몬을 멈추고 `helm ops migrate --db data/helm.sqlite`를 오프라인으로 돌린 뒤 시작한다(시작 제한 시간 180초 회피).
- pi 포크(`vendor/`) 갱신도 같은 절차를 탄다(07).
- 관찰 캐시(`observer/`)와 샌드박스 홈(`sandbox/`)은 마이그레이션하지 않는다. 새 릴리스의 관찰 캐시 버전(16 §3.20 `meta.cache_version`)이 다르면 관찰 자식이 캐시를 지우고 다시 만든다(16). 업그레이드 절차는 이 디렉터리를 건드리지 않는다.
- 업그레이드 대상 판단에 `just verify`(06 §3.16)와 07의 `vendor-verify`가 포함된다.

#### 3.10.3 마이그레이션 실행

- 마이그레이션 정의와 순서는 09가 소유한다. 17은 실행 위치만 정한다: 시작 단계 6, 또는 오프라인 `helm ops migrate`.
- 실행 전 `pre-migrate` 백업이 성공해야 한다. 각 마이그레이션은 트랜잭션 하나다. 끝나면 `store.migrated { from, to, durationMs }`(09 이름)를 append.
- 마이그레이션 중 실패하면 트랜잭션이 되돌려지고 데몬은 종료 코드 1로 끝난다. systemd가 재시작해도 같은 실패를 반복하므로, 마이그레이션 실패는 `helmd.owner.json`에 `lastFailure: "migration"`을 남기고 두 번째부터는 종료 코드 2로 끝낸다(재시작 멈춤).

#### 3.10.4 되돌리기 [제안]

`just daemon-rollback` → `ops/bin/daemon-rollback`:

```text
1. systemctl --user stop helmd.service
2. current ← previous (원자 교체), previous ← 실패한 릴리스
3. 스키마 비교: data/helm.sqlite 의 스키마 버전 > previous 릴리스의 schema.max 이면
   - 가장 최근 pre-upgrade 스냅샷(그 릴리스 전환 직전)을 §3.9.4 절차로 복구한다
   - 그 사이에 쌓인 이벤트(업그레이드 후 시작~실패 사이)는 quarantine 에 남은 DB에만 있다.
     이벤트 수를 출력하고 사람에게 알린다
4. systemctl --user start helmd.service, helm status 확인
```

자동 되돌리기(업그레이드 8단계)도 같은 스크립트를 쓴다. 업그레이드 직후 시작이 실패한 경우라 3단계에서 잃는 이벤트는 `daemon.booted`, `store.migrated` 정도다.

#### 3.10.5 다운그레이드 거부

- DB 스키마 버전 > 코드의 `schema.max` → 종료 코드 4, 메시지 `"DB schema N is newer than this release (max M). Upgrade, or roll back with a matching snapshot: just daemon-rollback"`.
- 이벤트 로그에 코드가 모르는 이벤트 버전이 있으면(09의 업캐스터가 없음) 같은 종료 코드 4.
- 오래된 스키마는 `schema.min` 이상이면 앞으로 마이그레이션한다. `schema.min` 미만이면 중간 릴리스를 거쳐야 한다(종료 코드 4, 메시지에 필요한 릴리스 범위).

#### 3.10.6 클라이언트 호환

- 데몬을 먼저 올리고 앱을 나중에 올린다. 프로토콜은 추가 변경은 버전을 올리지 않고, 서버는 현재와 직전 버전을 받는다(19 P-14). 앱은 hello에서 호환 범위를 보고 맞지 않으면 갱신 안내를 한다(20 APP-D14).
- 업그레이드로 재시작할 때 종료 예고 알림의 `reason: "upgrade"`, `restartExpectedMs: 30000`(19 `server.shutdown`).

### 3.11 상태 확인

#### 3.11.1 상태 모델 [제안]

```ts
// packages/daemon/src/ops/status.ts — 운영 상태. `helm status --json`(local 리스너, 로컬 관리자)이 쓴다.
// 19의 `daemon.status`(모든 기기, read scope)는 이 값에서 19 §3.7.8 `DaemonStatus` 모양으로 줄여 만든다(경로·자원 상세 제외).
export type OpsMode = "starting" | "recovering" | "ready" | "safe_mode" | "read_only" | "draining";
export type HealthLevel = "ok" | "degraded" | "critical";

export type HealthCheckId =
  | "disk" | "memory" | "event_loop" | "wal_size" | "db_integrity"
  | "backup_local" | "backup_offsite" | "drill"
  | "secrets" | "whois" | "sandbox" | "clock" | "release_integrity"
  | "listener_tailnet" | "listener_loopback" | "listener_local"
  | "safe_mode" | "scheduler" | "config_pending_restart"
  | "tool_binaries" | "models" | "permissions";

export interface HealthCheckResult {
  id: HealthCheckId;
  level: HealthLevel;
  message: string;               // 개발자용 영어. 화면 문구는 05가 id에서 만든다(19 §2.1 결정 37 행과 같은 규칙)
  since?: string;                // 이 수준이 된 시각
  detail?: Record<string, string | number | boolean>;  // 값만. 비밀·경로 밖 정보 없음
}

export interface OpsStatus {
  mode: OpsMode;
  readOnlyReasons: Array<"disk_critical" | "integrity_suspect" | "operator">;
  safeMode?: { since: string; reason: "crash_loop" | "operator"; recentUncleanBoots: Array<{ epoch: string; startedAt: string; lastEventAt?: string }> };  // 05 요구
  health: HealthLevel;           // checks 중 가장 나쁜 수준
  checks: HealthCheckResult[];
  release: { releaseId: string; gitSha: string; node: string; protocol: number };
  process: { pid: number; bootEpoch: string; startedAt: string; uptimeMs: number; previousShutdown: "clean" | "unclean"; uncleanStartsInWindow: number };
  store: { schemaVersion: number; storeId: string; lastSeq: number; sizeBytes: number; walBytes: number; lastCheckpointAt?: string };
  backups: {
    lastDaily?: { at: string; file: string; verified: boolean; lastSeq: number };
    lastAny?: { at: string; kind: string };
    localCount: number;
    offsite: { lastHomelabBackupAt?: string; included: boolean };
    lastDrill?: { at: string; ok: boolean };
  };
  runs: { active: number; waitingHuman: number; nextScheduledAt?: string };   // 수치는 12가 제공
  models: Array<{ provider: string; status: "ok" | "missing_key" | "unavailable" }>;   // 12 gateway.health()
  tools: { sandboxLevel: "S1" | "S1b" | "S0" | "none"; rg?: string; fd?: string; git?: string; bwrap?: string };   // 13 §3.6.1
  connections: { total: number; devices: Array<{ deviceId: string; name: string; transport: "tailnet" | "loopback" | "local" }>; localAdmin: number };
  listeners: Array<{ name: "tailnet" | "loopback" | "local"; address: string; state: "listening" | "disabled" | "error"; publicOrigin?: string }>;
  resources: { rssBytes: number; heapUsedBytes: number; cgroupMemoryBytes?: number; toolsSliceMemoryBytes?: number; eventLoopLagP99Ms: number; diskFreeBytes: number };
  clock: { ntpSynchronized: boolean; lastJumpAt?: string; lastJumpMs?: number };
}
```

#### 3.11.2 점검 항목과 수준 [제안]

| id | `degraded` 조건 | `critical` 조건 | 주기 |
|---|---|---|---|
| `disk` | `data/` 파일 시스템 여유 < 5 GiB | < 1 GiB(모드 `read_only`, §3.4.1) | 1분 |
| `memory` | cgroup 사용량 > `MemoryHigh` × 0.8 | `memory.events`의 `oom_kill` 증가 | 1분 |
| `event_loop` | p99 지연 > 200 ms(5분 창) | 감시 워커가 10초 넘는 정지를 기록 | 연속 |
| `wal_size` | WAL > 512 MiB(체크포인트가 막힘) | WAL > 2 GiB | 5분 |
| `db_integrity` | - | 시작 단계 5의 quick_check 또는 체인 검증 실패(읽기 전용 복구 시작). 파일을 열 수 없어 데몬이 뜨지 않으면 오프라인 `helm status`가 표시 | 시작 |
| `backup_local` | 마지막 검증 통과 백업이 26시간보다 오래됨 | 72시간 또는 한 번도 없음 | 10분 |
| `backup_offsite` | 홈랩 백업 상태가 26시간보다 오래됨, 또는 Helm 경로가 백업 대상에 없음(H-2) | - | 1시간 |
| `drill` | 마지막 훈련이 40일보다 오래됨 | 마지막 훈련 실패 | 1시간 |
| `secrets` | `keys` 중 값이 없는 것이 있음(해당 기능 저하) | `required` 키 없음(시작 거부라 오프라인 표시) | 재적재 때 |
| `whois` | 최근 10분 whois 실패 ≥ 3(18 §3.6) | 최근 10분 모두 실패 | 연속 |
| `sandbox` | S1b로 동작 중(bubblewrap 없음, 신호 격리 없음) | 격리 수단을 쓸 수 없어 실행 도구가 꺼짐, 또는 운영자가 S0을 켬(18 §3.11.4) | 시작, 1시간 |
| `clock` | NTP 미동기 또는 1시간 안에 60초 넘는 시계 점프 | - | 1시간 |
| `release_integrity` | `manifest.files.sha256` 불일치(릴리스 파일 변조 또는 손상) | - | 시작, 하루 |
| `listener_*` | - | 리스너가 `error` | 연속 |
| `safe_mode` | - | 안전 모드 | 연속 |
| `scheduler` | 타이머가 예정보다 5분 넘게 늦게 발화 | - | 연속 |
| `config_pending_restart` | 다시 읽은 설정 중 재시작이 필요한 항목이 바뀜 | - | 다시 읽기 때 |
| `tool_binaries` | `rg`·`fd`·`git` 중 없는 것(해당 도구만 오류, 07 T3) 또는 매니페스트 기록 버전과 다름 | - | 시작, 하루 |
| `models` | 설정에서 켠 공급자 중 키가 없거나 시험 호출 실패(12 `gateway.health()`) | 켠 공급자가 모두 사용 불가 | 시작, 1시간 |
| `permissions` | `data/`·`backups/`·`private/`·`state/` 권한이 0700/0600이 아님(고친 뒤 경고) | 소유자가 다른 uid | 시작, 하루 |

#### 3.11.3 헬스 엔드포인트

- `GET /healthz`: 세 리스너 모두. 인증 없이 응답한다. 본문은 `{"status":"ok"|"degraded"|"critical"|"starting"|"draining"}` 한 필드뿐이다(버전, 프로토콜 범위, 기기·경로·점검 상세를 넣지 않는다). 프로토콜 범위는 인증 직후 `hello.challenge.protocols`(19 §3.4.2)로 알 수 있으므로 넣지 않는다. 이 형식이 정본이고 19 §3.2(262행 표)와 20 §3.8의 연결 진단이 따른다(조정자 판정 §2). HTTP 코드: `ok`·`degraded` 200, 나머지 503. `tailnet` 리스너에서도 18 §3.4의 Host·Origin 검사를 똑같이 적용한다. 읽기 전용 모드는 `degraded`로 보인다(상세는 인증 뒤 `daemon.status`).
- `GET /healthz?probe=ingress`: `tailnet` 리스너에서만. 들어온 요청에 Tailscale 신원 헤더와 `X-Forwarded-*`가 있었는지를 **참·거짓으로만** 돌려준다(값은 넣지 않는다). `just daemon-probe`가 가정 A17-2를 확인하는 데 쓴다.
- 상세 상태는 인증된 연결의 상태 조회 메서드(이름은 19, 제안 `daemon.status`)와 로컬 CLI `helm status`로만 본다.

#### 3.11.4 `helm status` 출력

로컬 소켓으로 상세 상태를 받는다. 데몬이 꺼져 있으면 systemd 상태, `helmd.owner.json`, 마지막 백업 매니페스트, journald 마지막 오류 줄을 읽어 "꺼짐" 화면을 만든다. 사람이 읽는 출력은 한국어(결정 37), `--json`은 `OpsStatus`.

```text
$ helm status
helmd      준비됨 · 저하 1                릴리스 0.1.0+bad4d2d   pid 41231   가동 3일 4시간
부트 세대  01JA7Q3S5M8YH2V0K9C4T6N1PZ    시작 2026-10-11 09:12 KST   이전 종료: 정상
저장소     스키마 7   seq 128,441   로그 세대 01J9ZB…   크기 412 MB   WAL 3.1 MB
백업       일일 2026-10-12 03:40 (8시간 전, 전체 검증 통과)   로컬 9개   restic: 포함, 04:02 성공
훈련       2026-10-01 05:45 통과 (복구 41초)
실행       진행 중 2   사람 대기 3   다음 예약 10-12 18:00
연결       기기 2 (MacBook · tailnet, Windows PC · loopback(SSH))   로컬 1
리스너     tailnet 127.0.0.1:7840 ← https://server.tail7ad0b4.ts.net:8448
           loopback 127.0.0.1:7841
           local   /run/user/1000/helm/rpc.sock
자원       RSS 312 MB   도구 슬라이스 0 MB   이벤트 루프 p99 4 ms   디스크 여유 939 GB
점검       저하  whois   최근 10분 whois 실패 3회 (WSL interop 확인: helm doctor)
```

종료 코드: 0 `ok`, 1 `degraded`·`critical`·꺼짐, 2 환경 문제(소켓 디렉터리 없음, systemd 없음).

#### 3.11.5 `helm doctor` 검사 목록

데몬 없이도 돈다. 각 줄 `OK`/`WARN`/`FAIL`과 고칠 방법. 종료 코드: FAIL이 있으면 2(환경), WARN만 있으면 1, 아니면 0.

| 묶음 | 검사 |
|---|---|
| systemd | §3.6.1 표 전체, 단위 파일 설치·`enabled` 여부, 단위 파일이 저장소 원본에서 생성된 그대로인지(해시) |
| 릴리스 | `current` 링크, 매니페스트, `node.path` 존재, ABI 일치, `--disable-sigusr1` 지원, 파일 해시 |
| 도구 실행 파일 | `rg`, `fd`, `git`이 PATH(데몬과 샌드박스의 PATH)에 있는지와 버전(매니페스트 `tools`와 비교, 07 T3·13 §3.3.6) |
| 경로 | §3.2.2의 디렉터리 소유자·권한(0700/0600, 18 §3.9), 파일 시스템 종류, 디스크 여유, `~/projects` 아래가 아닌지 |
| 비밀 | `~/projects/helm/secrets/prod.sops.yaml` 존재, `secrets ls`로 `keys`의 키 이름이 원본에 있는지(값은 보지 않는다), `.env.example`과 `keys` 일치 |
| 원격 | 홈랩 `serve.table`에 Helm 줄, `scripts/lib/ts serve status --json`에서 8448 → `http://127.0.0.1:7840`, Funnel 꺼짐, `ts whois`가 응답하는지(소유자 기기 IP 하나로), `/mnt/c/Users/*/.wslconfig` 값, `schtasks.exe /query /tn WSL-Autostart` |
| SSH | sshd가 22에서 듣는지, `AllowTcpForwarding`이 `no`가 아닌지(`sshd -T`는 root가 필요하므로 설정 파일 grep), 호스트 키 지문 출력(`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`, 공개 키만 읽는다). 앱이 처음 접속할 때 사람이 이 지문과 대조한다(20 §3.8.3 요구) |
| 격리 | `bwrap --version`이 0.9 이상인지(없으면 WARN: "`sudo apt install bubblewrap`을 사람이 실행", 13 S1), 18 §3.11.4의 격리 시험(사용 중인 수단으로 `/srv/volumes/helm` 접근 거부, `rpc.sock` 접근 거부, `cmd.exe` 실행 실패, 네트워크 끊김, 환경 허용 목록) |
| 백업 | 마지막 로컬 백업, 홈랩 백업 상태 파일, H-2 반영 여부 |
| 시간 | NTP 동기 |

#### 3.11.6 진단 묶음

`helm diag bundle` → `state/diag/helm-diag-<UTC>.tar.gz`(0600). 사람이 문제를 보고하거나 다른 에이전트에게 넘길 때 쓴다.

| 넣는 것 | 빼는 것 |
|---|---|
| `helm status --json`, `helm doctor` 출력 | 이벤트 payload, 대화·프롬프트·도구 출력 본문 |
| 릴리스 매니페스트, 설정(값은 비밀이 아닌 것만. 설정에는 비밀이 없다) | 비밀 값, 토큰, 토큰 해시 |
| `journalctl --user -u helmd -n 5000 -o json`(18 §3.10 마스킹 적용 후) | 기기 이름 이외의 기기 정보(IP는 마지막 옥텟 가림) |
| `systemctl --user show helmd helm-backup helm-restore-drill` | |
| DB 통계: 스키마 버전, 페이지 수, WAL 크기, 이벤트 수, 마지막 seq, 이벤트 종류별 개수 | |
| `daemon.*`, `store.*`, `backup.*`, `drill.*` 이벤트 최근 200건(payload 포함, 이 종류에는 비밀이 없다) | |
| `free -h`, `df -h`, `.wslconfig`, `wsl.exe --version`, `node --version` | |

묶음을 만든 뒤 마스킹기(18 §3.10)로 전체를 한 번 더 훑어 알려진 비밀·토큰 패턴이 남아 있으면 묶음을 지우고 실패한다.

### 3.12 로그

- 출력: `helmd`는 JSON 줄을 표준 출력(`info` 이하)과 표준 오류(`warn` 이상)에 쓴다. systemd가 journald로 보낸다(`SyslogIdentifier=helmd`). 파일 로그를 만들지 않는다. 로거 라이브러리와 공통 필드는 06이 정한다. 17의 운영 요구는 아래다.
- 필드(최소): `ts`, `level`, `msg`, `component`, `bootEpoch`. 해당 시 `connId`, `principal`(`device:<dv_id>` 또는 `localAdmin`), `reqId`, `method`, `runId`, `toolCallId`, `seq`, `durationMs`, `err{name,message,code,stack}`.
- 쓰지 않는 것: 모델 입출력 본문, 도구 출력 본문, 사용자 입력 본문, 비밀·토큰·토큰 해시, 신원 헤더 값 전체(로그인은 마스킹된 형태 `in.***@gmail.com`). 모든 로그 줄은 마스킹기(18 §3.10)를 거친다.
- 양: `info`에서 요청마다 한 줄을 쓰지 않는다. 연결 열림·닫힘, 인증 실패(요약), 모드 전이, 실행 시작·끝, 백업, 경보만 쓴다. 목표 하루 10 MB 이하.
- 보존: journald 전역 설정을 따른다(영속, 기본 한도 = 파일 시스템의 10%와 4 GiB 중 작은 것 [지식]) [실험 17]. Helm 전용 보존 설정을 두지 않는다. 오래 보관할 운영 사실(시작·종료·백업·복구·경보)은 정본 이벤트에 있으므로 journald 보존에 기대지 않는다.
- 보는 법: `just daemon-logs -f`(= `journalctl --user -u helmd.service -f -o cat | jq -c`), 특정 실행: `journalctl --user -u helmd -o cat | jq -c 'select(.runId=="rn_…")'`.
- 운영 로그는 정본이 아니다. 지표(16)는 정본 이벤트에서 계산하고 로그를 읽지 않는다(06 §2.2 관측 흐름 분리).

### 3.13 리소스 한도 [제안]

WSL 상한 10 GB + swap 8 GB [실험 11]. 홈랩 상시 서비스 1.5 GB 안쪽, 나머지는 개발 여유(Claude·Codex 세션, TS 서버 등)다 [원문 homelab machines.md 메모리 예산].

| 대상 | 한도 | 근거 |
|---|---|---|
| `helmd` 단위(데몬 + 비밀 로더 + fork형 관찰 자식) | `MemoryHigh=1G`, `MemoryMax=1536M`, `TasksMax=512`, Node 힙 768 MiB(`--max-old-space-size=768`). 01 NFR-C-4(상주 1 GB 이하, 도구 자식 제외)에 맞춘다. fork형 관찰 자식(힙 768 MiB, 16 §3.2.1)은 같은 cgroup이라 실행 중에는 `MemoryHigh`에 걸려 늦춰질 수 있다. 그래서 관찰 자식을 `helm-tools.slice`의 일회성 단위로 옮기는 Q17-02를 권한다 | 데몬 RSS 평시 300 MB 안팎 예상 [가정]. 관찰 자식 768 MB(16 §3.2.1) |
| `helm-tools.slice`(도구 실행 합계) | `MemoryHigh=2560M`, `MemoryMax=3G`, `TasksMax=1024`, `CPUWeight=50` | 빌드·테스트 도구가 1~2 GB를 쓸 수 있다 |
| 도구 실행 단위 하나 | `MemoryMax=2G`, `RuntimeMaxSec`(13의 도구별 제한 + 30초), `TasksMax=256`, `Nice=5`, OOM 점수 +500(`OOMScoreAdjust=500`) | 커널 OOM이 데몬보다 도구를 먼저 고르게 |
| Helm 전체 최악 | 약 4.5 GB(데몬 1.5 GB + 도구 슬라이스 3 GB) | WSL 10 GB의 절반. 평시 1 GB 미만 |
| 디스크 | 정본 DB + 백업 9개 + 블롭. DB 1 GB면 백업 포함 약 10 GB | 여유 939 GB [실험: `df -h /`] |
| 파일 디스크립터 | `LimitNOFILE=16384` | 연결·SQLite·자식 파이프 |

한도에 걸렸을 때: 도구 단위가 OOM으로 죽으면 13이 도구 결과를 오류(`oom`)로 기록한다. `helmd`가 OOM으로 죽으면 재시작·복구. 둘 다 헬스 `memory`에 남는다.

### 3.14 `justfile` 레시피 [제안]

06·23이 저장소 전체 `justfile`을 합친다. 아래는 데몬 묶음이다. 실제 로직은 `ops/bin/*`(bash, `set -euo pipefail`, 종료 코드 0/1/2 규칙)에 두고 레시피는 얇게 둔다(홈랩 방식).

```just
# ---- daemon (docs/design/17-daemon-and-operations.md) ----
helm_root := env_var_or_default("HELM_ROOT", "/srv/volumes/helm")

# 환경 검사(systemd, linger, 경로, 비밀 원본, serve, 격리). FAIL이면 종료 코드 2
daemon-doctor:
    ops/bin/helm-doctor

# 처음 설치: doctor → 릴리스 빌드(HEAD) → 단위 파일 생성 → enable --now → 준비 대기 → status
daemon-install: daemon-doctor
    ops/bin/daemon-install

# 새 릴리스로 올리기. --when-idle: 진행 중 실행이 없을 때까지 대기, --force: 진행 중 실행을 중단하고 올림
daemon-upgrade *ARGS:
    ops/bin/daemon-upgrade {{ARGS}}

# 이전 릴리스로 되돌리기(필요하면 pre-upgrade 스냅샷 복구)
daemon-rollback:
    ops/bin/daemon-rollback

daemon-start:
    systemctl --user reset-failed helmd.service || true
    systemctl --user start helmd.service

daemon-stop:
    systemctl --user stop helmd.service

daemon-restart:
    systemctl --user restart helmd.service

daemon-status:
    {{helm_root}}/app/current/bin/helm status

# 예: just daemon-logs -f   /   just daemon-logs --since "1 hour ago"
daemon-logs *ARGS:
    journalctl --user -u helmd.service -o cat {{ARGS}}

daemon-backup:
    {{helm_root}}/app/current/bin/helm ops backup --kind manual --wait

# 파일을 생략하면 목록에서 고른다
daemon-restore FILE="":
    ops/bin/daemon-restore {{FILE}}

daemon-verify *ARGS:
    {{helm_root}}/app/current/bin/helm ops verify {{ARGS}}

daemon-drill *ARGS:
    {{helm_root}}/app/current/bin/helm ops drill {{ARGS}}

daemon-diag:
    {{helm_root}}/app/current/bin/helm diag bundle

# tailscale serve 경로 확인: https://server.<tailnet>.ts.net:8448/healthz 와 ?probe=ingress
daemon-probe:
    ops/bin/daemon-probe

# 홈랩 serve.table에 넣을 줄을 출력(쓰지 않는다)
daemon-serve-line:
    @echo "8448  http://127.0.0.1:7840   helm"

# 단위 비활성화·삭제. 데이터(/srv/volumes/helm)는 남긴다
daemon-uninstall:
    ops/bin/daemon-uninstall

# 개발 데몬: 전경 실행, 데이터는 {{helm_root}}/dev, tailnet 리스너 끔, 비밀은 dev 원본에서 환경 주입.
# node --watch를 쓰지 않는다(pi-codemode worker가 깨진다, 07 E14). 파일 감시가 필요하면 ops/bin/dev-restart가 프로세스를 다시 띄운다
daemon-dev:
    @"{{ just_executable() }}" --justfile "{{ justfile() }}" _with-secrets dev \
      "HELM_ROOT={{helm_root}}/dev HELM_SECRETS_FROM_ENV=1 ops/bin/dev-restart pnpm --filter @helm/daemon start"

# JSONL 내보내기(09 §3.14.3). 예: just daemon-export --from 1
daemon-export *ARGS:
    {{helm_root}}/app/current/bin/helm export --out {{helm_root}}/state/exports {{ARGS}}

# 시스템 테스트(§6.2 시스템 종류). 이 서버에서만, 일회성 user unit을 쓴다. CI에서는 건너뛴다
daemon-systest:
    ops/test/run-systest
```

- `rg`·`fd`(07 T3)는 저장소 `.mise.toml`의 `[tools]`에 `ripgrep = "15.2.0"`, `fd = "10.5.0"`로 고정하고 템플릿 `just setup`의 `mise install`이 설치한다. sudo가 필요 없다. 이 서버에는 dotfiles mise로 같은 버전이 이미 있다 [실험: `rg 15.2.0`, `fd 10.5.0`]. `git`은 시스템 패키지(2.43.0 [실험]). `bubblewrap`은 apt 패키지라 사람이 `sudo apt install bubblewrap`을 한다(`helm doctor`가 안내, 13 §3.6.1).
- 06 §3.16이 정한 대로 별도 `store-*` 레시피는 두지 않는다. 09 §5.2가 예로 든 이름은 `store-verify` → `daemon-verify --full`, `store-backup` → `daemon-backup`, `store-restore` → `daemon-restore`, `store-export` → `daemon-export`로 대응한다.
- `ops/bin/daemon-install`: (1) `helm-doctor`(FAIL이면 2로 끝) (2) `ops/bin/build-release HEAD` (3) `@HELM_ROOT@` 치환으로 `~/.config/systemd/user/`에 단위 생성 (4) `app/bin/helm-alert` 복사 (5) `~/.local/bin/helm` 링크 (6) `systemctl --user daemon-reload && enable --now helmd.service helm-backup.timer helm-restore-drill.timer helm-verify.timer helm-maintenance.timer` (7) `helm status`. 이미 설치되어 있으면 단위 파일만 다시 쓰고 `daemon-upgrade`를 쓰라고 안내한다.
- 종료 코드 2를 받은 레시피는 코드를 고치지 않고 그대로 보고한다(사용자 CLAUDE.md 규칙).
- `daemon-dev`는 `_with-secrets`(저장소 템플릿 레시피, SECRETS.md "자주 하는 일")를 쓴다. 정식 데몬과 데이터 디렉터리·잠금·소켓 디렉터리(`$XDG_RUNTIME_DIR/helm-dev`)가 다르므로 함께 돌 수 있다. 개발 데몬의 `loopback` 포트는 7851, `tailnet`은 끈다.

### 3.15 관리 CLI(`@helm/cli`) 명령 목록 [제안]

`helm`은 로컬 소켓(`rpc.sock`)에 로컬 관리자로 붙는다. 오프라인 명령은 데몬이 꺼져 있을 때 잠금을 잡고 직접 실행한다. 프로토콜 메서드 이름은 19가 정한다(아래 "메서드"는 의미).

| 명령 | 하는 일 | 데몬 필요 | 메서드(의미) |
|---|---|---|---|
| `helm status [--json]` | 상태(§3.11.4) | 아니요(꺼짐 화면) | 상태 조회 |
| `helm doctor` | 환경 검사(§3.11.5) | 아니요 | - |
| `helm version` | CLI·릴리스·프로토콜 버전 | 아니요 | - |
| `helm daemon start\|stop\|restart` | `systemctl --user` 래퍼 | 아니요 | - |
| `helm daemon logs [-f] [--since …]` | `journalctl` 래퍼 | 아니요 | - |
| `helm pair [--name <이름>] [--ttl <초>] [--qr]` | 페어링 코드 발급(18 §3.7 흐름 A). 코드, 만료 시각, 접속 주소와 링크 `helm://pair?v=1&url=<https://server.tail7ad0b4.ts.net:8448>&code=<코드>&sid=<serverId>`(20 §3.8.7)를 출력. `--qr`이면 같은 링크를 터미널 QR로(모바일 페어링, 26) | 예 | `device.createPairingCode` |
| `helm pair --cancel-all` | 유효한 페어링 코드를 모두 무효로 | 예 | 같음(19) |
| `helm device issue --json --name <이름> --platform <p> --client <k>` | SSH 경로 페어링(18 §3.7 흐름 B). 표준 출력에 `HELM-DEVICE/1 {"serverId":…,"deviceId":…,"deviceToken":…}` 한 줄만 쓰고 다른 출력은 표준 오류로 보낸다(20 §3.8.7). 토큰은 이 출력에만 한 번 나온다. 앱은 비대화 SSH에서 절대 경로 `~/.local/bin/helm`(로그인 셸이 `~`를 편다)으로 부른다 | 예 | `admin.issueDevice` |
| `helm device [list]` | 기기 목록(이름, 플랫폼, 클라이언트 종류, 페어링 경로, 마지막 사용 시각·경로, 만료 예정, 상태) | 예 | `device.list` |
| `helm device rename <dv_id> <이름>` | 이름 변경 | 예 | `device.rename` |
| `helm device revoke <dv_id> [--reason …]` | 즉시 폐기, 해당 연결 끊기(02 UC-11 A2의 이름) | 예 | `device.revoke` |
| `helm device expire-tokens <dv_id>` | 토큰 만료를 지금으로(다시 페어링 필요) | 예 | 19에 요구 |
| `helm device rebind <dv_id>` | tailnet 노드 묶기를 풀어 다음 WSS 접속에서 다시 묶음(18 §4 S-03) | 예 | 19에 요구 |
| `helm audit [--since …] [--device …] [--kind auth\|device\|ops]` | 보안 감사 기록 보기(18 §3.13) | 예 | 이벤트 조회(필터) |
| `helm ops backup [--kind manual] [--wait]` | 백업(§3.9.1) | 아니요(꺼져 있으면 오프라인) | `admin.backupNow` |
| `helm ops backups` | 로컬 스냅샷 목록과 매니페스트 요약 | 아니요 | - |
| `helm ops restore --from <backupId 또는 경로> [--yes]` | 복원(§3.9.4). 데몬이 돌고 있으면 거부 | 아니요(꺼져 있어야 함) | - |
| `helm ops verify [--full] [--blobs] [--anchors] [--if-running]` | 검증(§3.9.5). 데몬이 돌면 워커로, 꺼져 있으면 오프라인. 09 §3.10.4의 `helm store verify`는 이 명령으로 통일한다 | 아니요 | `admin.verify` |
| `helm ops maintain [--if-running]` | 정기 유지 작업(§3.9.7) | 예 | 19에 요구(`admin.maintain`) |
| `helm export --out <dir> [--from <seq>] [--to <seq>] [--with-blobs] [--db <path>]` | JSONL 내보내기(06 §3.11.4, 09 §3.14.3. 09의 `helm store export`와 같은 명령) | 아니요 | - |
| `helm ops drill [--file <스냅샷>]` | 복구 훈련(§3.9.6) | 아니요 | - |
| `helm ops migrate --status\|--dry-run [--db <경로>]\|--apply` | 마이그레이션 상태·시험·오프라인 적용 | 아니요(`--apply`는 꺼져 있어야 함) | - |
| `helm ops wait-ready [--timeout <초>]` | 준비 완료까지 대기(단위 `ExecStartPost`) | 예 | 상태 조회 반복 |
| `helm ops reload` | 설정 다시 읽기(§3.3.3) | 예 | 설정 재적재 |
| `helm ops reload-secrets` | 비밀 다시 읽기(§3.8) | 예 | 비밀 재적재 |
| `helm ops safe-mode on\|off` | 안전 모드 진입·해제(§3.4.6). 해제는 10 `runtime.exit_safe_mode` 명령(19 의도 `daemon.exitSafeMode`)과 같다 | 예 | 19 `admin.safeMode` |
| `helm ops read-only on\|off [--reason …]` | 읽기 전용 전환(§3.4.1 사유 `operator`) | 예 | `admin.setMode` |
| `helm daemon drain [--reason …]` | 종료 예고 후 정지(업그레이드 스크립트가 씀) | 예 | `admin.drain` |
| `helm ops alert <unit>` | 내부용(경보 단위). 사람이 쓰지 않는다 | 아니요 | - |
| `helm diag bundle` | 진단 묶음(§3.11.6) | 아니요(있으면 더 많이 담음) | 상태 조회 |
| `helm attach --stdio` | (예비) SSH exec 경로 브리지. 18 ADR-18-2의 대안 C를 택할 때만 쓴다 | 예 | - |
| `helm observer run <kind>` | 관찰 실행 수동 시작(16 §3.3.1 T8) | 예 | 16·19 |

출력 규칙: 사람이 읽는 출력은 한국어, `--json`은 기계용. 오류 메시지는 무엇이 안 되었는지와 다음 명령을 함께 적는다.

## 4. 실패·예외·경계 사례

| ID | 상황 | 처리 | 확인 테스트 |
|---|---|---|---|
| F-01 | 같은 데이터 디렉터리로 두 번째 `helmd`(예: 정식 데몬이 도는데 누가 `bin/helmd`를 직접 실행) | 잠금 실패 → 종료 코드 3, 메시지에 소유 정보(`helmd.owner.json`) | T17-03 |
| F-02 | 이전 `helmd`가 SIGKILL로 죽어 잠금 파일·소켓 파일이 남음 | SQLite 잠금은 커널이 이미 풀었다. 죽은 소켓 파일은 시작 단계 12에서 지우고 다시 만든다 | T17-04 |
| F-03 | 시작 중 SIGTERM(예: 업그레이드가 곧바로 재시작) | 진행 중 단계를 끝까지(트랜잭션 단위) 마치고 정리 후 0. 마이그레이션 중이면 마이그레이션 트랜잭션이 끝날 때까지 기다린다 | T17-08 |
| F-04 | DB 파일이 `/mnt/c`로 설정됨 | 종료 코드 2 | T17-05 |
| F-05 | 디스크 가득 참(쓰기 중 `SQLITE_FULL`) | 해당 트랜잭션 실패. 모드 `read_only`(사유 `disk_critical`), 헬스 `disk` critical. 종료하지 않는다(종료하면 재시작마다 같은 실패) | T17-12 |
| F-06 | WAL이 계속 자람(장기 읽기 트랜잭션이 체크포인트를 막음) | 헬스 `wal_size`. 워커 읽기 연결의 트랜잭션은 30초 상한(09에 요구). 넘으면 워커를 끝내고 `PRAGMA wal_checkpoint(RESTART)` | T17-13 |
| F-07 | 비밀 로더가 10초 안에 끝나지 않음(sops가 키 파일을 기다림 등) | 로더 SIGKILL, 종료 코드 2 | T17-10 |
| F-08 | age 키·원본 없음 | `secrets` 종료 코드 2 → 데몬 2. `helm doctor`가 원인을 보인다 | T17-10 |
| F-09 | 포트 7840이 다른 프로세스에 잡혀 있음 | 시작 단계 12 실패, 종료 코드 2. 메시지에 `ss -ltnp` 안내 | T17-11 |
| F-10 | `runtimeDir`(`/run/user/1000`)이 없음(linger 꺼짐 + 로그인 없음) | 종료 코드 2. user manager가 없으면 애초에 단위가 돌지 않는다 | doctor 시험 |
| F-11 | 마이그레이션 중 크래시 | 트랜잭션이 되돌려진다. 다음 시작이 다시 시도. 같은 마이그레이션이 두 번 실패하면 종료 코드 2로 멈추고 경보(§3.10.3) | T17-15 |
| F-12 | `pre-migrate` 백업 실패(디스크 부족 등) | 마이그레이션하지 않고 종료 코드 1. 두 번째부터 2 | T17-15 |
| F-13 | DB 스키마가 코드보다 새로움 | 종료 코드 4, 재시작 안 함 | T17-14 |
| F-14 | quick_check 실패 또는 해시 체인 끝 불일치 | 읽기 전용 복구 시작(§3.4.2 7단계). 헬스 `db_integrity` critical. 사람이 §3.9.4로 복구. 파일을 아예 열 수 없으면 종료 코드 5 | T17-16 |
| F-15 | 10분에 3번 비정상 시작 | 안전 모드. 경보는 systemd 한도에서도 따로 간다 | T17-09 |
| F-16 | 안전 모드에서 사람이 해제했는데 다시 크래시 | 해제 뒤의 비정상 시작만 센다(해제 이벤트 이후 창). 다시 3번이면 다시 안전 모드 | T17-09 |
| F-17 | 종료 유예 중 도구가 SIGTERM을 무시 | 5초 뒤 SIGKILL(단위면 `systemctl --user kill --signal=SIGKILL`). 45초 안에 끝나지 않으면 systemd가 cgroup 전체 SIGKILL | T17-07 |
| F-18 | 종료 중 `daemon.stopped` 쓰기 실패(디스크 가득 등) | 로그만 남기고 계속 종료. 다음 시작은 비정상 종료로 본다(안전한 쪽) | T17-07 |
| F-19 | 이벤트 루프가 120초 정지 | 감시 워커가 SIGABRT, systemd 재시작, 비정상 종료로 기록 | T17-18 |
| F-20 | 백업 중 데몬 종료 요청 | 백업은 `.tmp`에서 진행되므로 중단하고 지운다. 종료를 미루지 않는다 | T17-17 |
| F-21 | 03:40 백업이 04:00 restic 시작까지 끝나지 않음 | restic은 이전 날 스냅샷을 가져간다(`.tmp`는 제외). 15분 넘으면 경고 | 수동 확인 |
| F-22 | 백업 사본 검사 또는 주간 전체 검사 실패(원본 DB 손상 의심) | `backup.failed { stage: "verify" }` 또는 운영 로그, 경보. 헬스 `db_integrity` critical, 백업 회전(오래된 스냅샷 삭제)을 멈춘다(좋은 백업을 지우지 않게, 09 §3.10.4). 데몬은 계속 쓴다. 사람에게 `helm ops verify --full`과 §3.9.4 복원 판단을 권한다 | T17-16 |
| F-23 | 복구할 스냅샷이 더 새 릴리스에서 만든 것 | 복구 중단(§3.9.4 3단계) | T17-20 |
| F-24 | 복구 후 클라이언트가 예전 `lastSeq`로 재접속 | 새 `storeId`라 19의 스냅샷 경로로 간다 | T17-21 + 19 적합성 |
| F-25 | 업그레이드 자체 시험 실패 | 운영 데몬은 그대로, staging 삭제, 종료 코드 1 | T17-22 |
| F-26 | 업그레이드 재시작 후 준비되지 않음(`ExecStartPost` 시간 초과) | 자동 되돌리기(§3.10.4) | T17-23 |
| F-27 | 데몬이 꺼져 있는 동안 외부 런타임 어댑터(이후 단계)가 도구 판정을 요청 | 판정 불가. 17의 요구는 변경 도구 차단(fail closed). 어댑터 쪽 처리는 13 | 13 |
| F-28 | Windows 재부팅 후 아무도 로그온하지 않음 | 데몬 꺼짐. 원격 앱은 연결 실패만 본다. 로그온 후 복구(§3.6.6). 복귀 요약에 꺼짐 구간 | 수동 |
| F-29 | mise가 릴리스가 쓰는 Node 버전을 지움 | 실행 실패(127) → 재시작 반복 → systemd 한도 → 경보. `helm doctor`가 원인 표시. `just daemon-upgrade`로 새 릴리스 빌드 | T17-24 |
| F-30 | 사람이 저장소 작업 트리에서 코드를 바꾸고 Mac에서 동기화된 변경이 섞임 | 실행 중 릴리스와 무관(D17-11). 업그레이드는 커밋만 빌드 | T17-22 |
| F-31 | 시계가 크게 뒤로 감 | §3.6.8. 헬스 `clock` | T17-19 |
| F-32 | `helm-alert`가 홈랩 `scripts/alert`를 못 찾음 | 상태 파일만 남기고 0 | T17-25 |
| F-33 | `~/.config/helm/helmd.toml`에 비밀처럼 보이는 키 | 설정 검증 실패, 종료 코드 2 | T17-02 |
| F-34 | 관찰 자식이 메모리 한도 초과 | 그 실행만 실패(16 §3.19.3). 데몬 무관 | 16 |
| F-35 | 개발 데몬과 정식 데몬 동시 실행 | 데이터·잠금·소켓·포트가 다르므로 함께 돈다. 개발 데몬은 `tailnet` 리스너를 열지 않는다 | T17-26 |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 받는 문서 | 제공 |
|---|---|
| 01 | NFR-A-1(재시작 5초 시작·최대 60초 지연, 복구 30초 목표, §3.6.5·§3.4.2), NFR-A-2(keepalive 확인 방법, §3.6.7), NFR-A-3(로그온 뒤 시작, §3.6.6), NFR-A-6(상태 항목, §3.11), NFR-D-3(매일 03:40 백업, 최대 손실 24시간, §3.9), NFR-D-6(§3.2), NFR-O-4(데몬 없이 `helm status`·`helm doctor`·복원, §3.15) |
| 02 | UC-10 B1(비정상 종료 → systemd 재시작 + 복구), B2(재부팅 → 로그온 뒤 시작, §3.6.6), B5(읽기 전용 복구 시작, 이벤트 없음, §3.4.2), UC-11 설치(`just daemon-install`, 멱등, §3.14)와 Windows 쪽 작업(관리자 스크립트 없음, §3.7) |
| 04, 05, 21 | 상태 항목(`OpsStatus`, §3.11.1: 시작 시각, 진행 중 실행 수, 다음 예약, 저장소 크기, 마지막 백업, 디스크 여유, 모드와 사유, 안전 모드의 최근 비정상 부팅 목록), 점검 id 목록(§3.11.2, 문구 키는 05), 페어링 코드 명령 `helm pair`, 읽기 전용·안전 모드에서 사람이 할 일(§3.4.1, §3.9.4) |
| 06 | 프로세스 배치, 저장 위치 표(§3.2), 운영 절 설정 스키마(§3.3.2), 데몬 레시피(§3.14), 운영 로그 요구(§3.12) |
| 07 | 릴리스 매니페스트의 `pi`·`tools` 기록(§3.10.1), `rg`·`fd` 설치(`.mise.toml`)와 `helm doctor` 확인(§3.11.5), `tool-output/` 위치와 24시간 정리(§3.9.7), `node --watch` 금지(§3.14) |
| 09 | 시작 순서 안의 저장소 단계 위치(§3.4.2 2~10단계), 백업 일정·보관·정리 정지 규칙(§3.9.1), 복원 운영 단계(§3.9.4), 주간 전체 검사와 일일 유지 타이머(§3.9.7), 데이터 디렉터리 배치와 권한(§3.2.2) |
| 12 | 복구·오케스트레이터·스케줄러 시작 시점(§3.4.2 12~14단계), 종료 유예(§3.4.3), 크래시 루프·안전 모드 데몬 쪽 처리(§3.4.6), 사용자 시간대 설정(`user.timeZone`, §3.3.1), 시계 점프(§3.6.8) |
| 13 | 도구 실행 단위의 슬라이스·한도·`PartOf` 규칙(§3.1.3, §3.13), 고아 정리 위치(§3.4.2 11단계), 경로 `sandbox/`·`drafts/`·`worktrees/`와 정리 정책(§3.2.2, §3.9.7), `bwrap`·`systemd-run` 확인(§3.11.5) |
| 14 | 오케스트레이터 시작 위치(§3.4.2 13단계) |
| 15 | `scratch/inquiry/`(14일 정리, 백업 제외), `eval/`(백업 포함) |
| 16 | 관찰 자식의 자원 한도와 격리 실행(§3.1.3), `observer/`(백업 제외), `private/resumption-checks/`(0700/0600, 백업 포함, 관찰 자식에게 숨김), 업그레이드 때 캐시 처리(§3.10.2) |
| 18 | 리스너 배치(§3.5), 데몬 모드, 비밀 로딩 절차(§3.8), 복원 절차(18 §3.16이 보안 조건을 덧붙임), 진단 묶음 제외 규칙 |
| 19 | 리스너 주소·소켓 경로(§3.5), 데몬 모드 대응(§3.4.1), 종료 예고 사유(§3.4.3), `OpsStatus`와 줄이는 규칙(§3.11.1), `/healthz` 정본 형식(§3.11.3), 복원 때 `storeId` 교체(§3.9.4), `serverId` 위치(`state/server-id`), 업로드 대기 파일 24시간 정리(§3.9.7), `admin.*` 의미(§3.15) |
| 20 | 접속 주소: WSS `https://server.tail7ad0b4.ts.net:8448`, SSH `ssh -W 127.0.0.1:7841 server`. `helm device issue --json` 출력 계약, `helm pair` 링크(§3.15), 업그레이드 순서(§3.10.6), sshd 포워딩 유지(아래 결정), `helm doctor`의 호스트 키 지문(§3.11.5) |
| 22, 23 | §6의 테스트 목록과 구현 단위 |

20 §5.2 요구 (3)에 대한 답: sshd의 TCP 포워딩은 OpenSSH 기본값(허용)을 그대로 둔다 [실험 18]. 좁히려면 dotfiles `sshd_config.d/10-dotfiles.conf`에 `PermitOpen 127.0.0.1:7841`을 더할 수 있으나, 사용자의 다른 포워딩(홈랩 Sunshine 웹 UI 등)도 함께 막히므로 1차에는 하지 않는다(사람 결정, 미결 Q17-11).

### 5.2 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 02 | UC-11 3단계의 "Windows 호스트 쪽 설정을 사람이 관리자 권한으로 실행"을 "홈랩 `serve.table` 한 줄 + `just serve-apply`(관리자 권한 불필요), 읽기 전용 확인 스크립트"로 고친다(§3.7). 1단계 이벤트 이름 `daemon.started`를 09의 `daemon.booted`로 |
| 05 | §3.11.2 점검 id(`tool_binaries`, `models`, `permissions` 추가)마다 문구 키 |
| 06 | (1) §3.10.3 최상위 구조에 `maintenance`(17)와 `user { timeZone }`(12의 사용자 시간대) 절을 더한다. (2) §3.9.3 4번의 "`secrets.required` 기본 `[]`"를 `["HELM_LEDGER_HMAC_KEY"]`로 고친다(09 §3.8.2 3단계와 맞춤. 모델 키는 여전히 필수 아님). (3) §3.7.4 4번의 "격리 없을 때 로컬 관리자 명령을 막을지"는 18 R-10(격리 없으면 `execute` 자체를 끔)으로 답했다 |
| 09 | (1) §3.8.1 겹 1의 단위 이름 `helm-daemon.service`를 `helmd.service`로. (2) §3.10.5의 "읽기 전용 복구 모드(17의 safe 모드, `daemon.safe_mode_entered`)"를 "17의 `read_only` 모드(사유 `integrity_suspect`), 이벤트 없음"으로 고친다. 안전 모드는 크래시 루프 전용이다. (3) 매니페스트에 `verify`, `producer` 필드(§3.9.2). (4) `helm store verify`·`helm store export`를 17의 `helm ops verify`·`helm export`로 맞춘다. (5) `synchronous=FULL` 유지 |
| 10 | 데몬 모드가 `ready`·`safe_mode`가 아닐 때 상태 변경 명령은 프로토콜 계층(19 `5001`·`5003`)에서 거절된다. 커널 쪽 거부 분류에 같은 사유를 둘지는 10이 정한다(10 E-23) |
| 12 | (1) §3.3.4 키 주입을 브리프 결정 45대로 고친다: `EnvCredentialStore` 대신 17 §3.8의 `SecretStore`(메모리)에서 읽는 자격 저장소. 데몬은 `secrets run`으로 띄우지 않는다. §2.1 표 §2.5 행도 같이. (2) `boot()` 3~7단계를 `runtime.recover({ epoch, prevEpoch, safeMode })`와 `scheduler.start()`로 나눠 노출한다. (3) `runtime.drain(timeoutMs)`, `runtime.abortAll(reason)`, `runtime.pause()`. (4) 상태용 수치와 `gateway.health()` 결과 |
| 13 | (1) 자식 프로세스 원장 레코드와 이벤트, 대조 함수 `reapOrphans(prevEpochs)`. (2) §3.6.2의 데몬 포트 `127.0.0.1:7801`을 7840·7841로 고친다(조정자 판정 §2). (3) 샌드박스 홈 정리는 17 §3.9.7(30일)을 쓴다 |
| 16 | (1) 격리 실행 IPC를 전송과 분리(§3.1.3). `systemd-run` 실패 때 `fork`로 몰래 낮추지 않는다. (2) 관찰 자식 격리를 켤 때 `private/`를 숨긴다 |
| 19 | (1) `/healthz` 본문을 17 §3.11.3 형식 하나로 확정(20 §5.2 (3)이 지적한 `{"ok":true,"protocols":[1]}` 흔적 제거). (2) `admin.maintain`, `admin.verify { full, blobs, anchors }`, `device.expireTokens`, `device.rebind` 메서드. (3) `DaemonMode` 값과 17 내부 모드 대응(§3.4.1)을 한 표로 |
| 20 | (1) SSH 경로 대상 `127.0.0.1:7841`, `ServerAliveInterval=15`, `ServerAliveCountMax=3`. (2) 종료 예고(`server.shutdown`)를 받으면 `restartExpectedMs` 동안 "데몬 재시작 중"으로 표시. (3) `helmCliPath` 기본값을 `~/.local/bin/helm`으로 |
| 23 | 구현 순서: 잠금·시작 순서·종료 순서(M1과 함께) → 백업·복원(첫 실제 사용 전 필수) → 업그레이드 → 훈련·유지 타이머. 구현 시작 전 사람 작업: `~/projects/helm` 뼈대와 `secrets init`, `secrets edit prod`(모델 키, `HELM_LEDGER_HMAC_KEY`), `sudo apt install bubblewrap` |
| 홈랩 | §3.7.4 H-1~H-5 |

## 6. 구현 단위와 완료 기준

### 6.1 모듈·파일

| 위치 | 내용 |
|---|---|
| `packages/daemon/src/main.ts` | 진입점, 시작 순서 실행기 |
| `packages/daemon/src/config/{schema,load}.ts` | §3.3 |
| `packages/daemon/src/lifecycle/{boot,shutdown,signals,modes,crash-loop,watchdog,owner-file}.ts`, `packages/store/src/admin/instance-lock.ts`(`@helm/store/admin`) | §3.1.4, §3.4 |
| `packages/daemon/src/listeners/{index,tailnet,ssh,local,healthz}.ts` | §3.5, §3.11.3 (인증 검사는 18의 `auth/` 모듈 호출) |
| `packages/daemon/src/secrets/{loader,export-main}.ts` | §3.8 |
| `packages/daemon/src/ops/{status,health-checks,backup,restore,verify,drill,maintain,diag,reload}.ts` | §3.9, §3.11 |
| `packages/daemon/src/process/{systemd-run,orphans}.ts` | §3.1.3 (13과 공유) |
| `apps/cli/src/commands/{status,doctor,daemon,pair,devices,audit,ops/*,diag,attach,observer}.ts` | §3.15 |
| `ops/systemd/{helmd.service,helm-tools.slice,helm-backup.service,helm-backup.timer,helm-restore-drill.service,helm-restore-drill.timer,helm-verify.service,helm-verify.timer,helm-maintenance.service,helm-maintenance.timer,helm-alert@.service}.in` | §3.6.4 |
| `ops/bin/{helm-doctor,daemon-install,daemon-upgrade,daemon-rollback,daemon-restore,daemon-uninstall,daemon-probe,build-release,helm-alert,dev-restart}`, `ops/test/run-systest` | §3.10, §3.14 |
| `ops/windows/check-helm-host.ps1` | §3.7.3 |

### 6.2 테스트 목록

단위·통합 테스트는 Vitest, 시스템 테스트는 `ops/test/`의 bash + 일회성 user unit(실제 서버에서 `just daemon-systest`로만, CI에서는 건너뜀).

| ID | 조건 | 종류 |
|---|---|---|
| T17-01 | 설정 우선순위: 기본값 < 파일 < 허용된 `HELM_*` < 인자. 허용되지 않은 `HELM_*`는 경고 | 단위 |
| T17-02 | 설정에 `apiKey`·`token`류 키가 있으면 거부(종료 코드 2) | 단위 |
| T17-03 | 같은 데이터 디렉터리로 두 프로세스: 두 번째가 종료 코드 3 | 통합(자식 프로세스 둘) |
| T17-04 | 첫 프로세스를 SIGKILL한 직후 두 번째가 잠금을 얻고 죽은 소켓을 정리해 시작 | 통합 |
| T17-05 | tmpfs(`HELM_ALLOW_TMPFS` 없이)·v9fs 경로면 종료 코드 2. `statfs` 값을 주입해 확인 | 단위 |
| T17-06 | 시작 순서: 리스너가 복구 완료 전에 열리지 않음(복구를 지연시키고 그 사이 연결 시도 → 연결 거부) | 통합 |
| T17-07 | 종료 순서: SIGTERM → 새 연결 거부, 종료 예고 알림, 진행 중 가짜 도구 20초 유예 후 SIGTERM, 5초 후 SIGKILL, `daemon.stopped` 기록, 종료 코드 0, 총 30초 이내. 도구가 신호를 무시해도 45초 안에 끝남 | 통합 |
| T17-08 | 시작 중 SIGTERM: 마이그레이션 트랜잭션이 끝난 뒤 0으로 종료, DB 일관 | 통합 |
| T17-09 | 크래시 루프: `prevClean=false` 부팅 3번(10분 창) → 안전 모드, 스케줄러 미시작, 재개 없음. 해제 후 창 재계산 | 통합(가짜 시계) |
| T17-10 | 비밀 로더: 정상 JSON → 메모리에만, `process.env`·자식 환경에 없음, `/proc/self/environ`에 없음. 로더 시간 초과·종료 코드 2 → 데몬 2 | 통합 |
| T17-11 | 포트 사용 중 → 종료 코드 2 | 통합 |
| T17-12 | 디스크 가득(작은 루프백 이미지 대신 `SQLITE_FULL` 주입) → 데몬 생존, 헬스 critical, 새 실행 거부 | 통합 |
| T17-13 | 긴 읽기 트랜잭션으로 WAL 성장 → 헬스 `wal_size`, 30초 상한 후 체크포인트로 줄어듦 | 통합 |
| T17-14 | DB 스키마 > 코드 max → 종료 코드 4 | 통합 |
| T17-15 | 마이그레이션 실패 주입 → 되돌림, 코드 1, 두 번째 2. `pre-migrate` 백업 존재 | 통합 |
| T17-16 | 백업: 쓰기 부하 중 `backup()` → 스냅샷 integrity ok, 체인 ok, 매니페스트 sha256 일치, 스냅샷 lastSeq ≤ 원본. DB 페이지를 일부러 손상 → 검증 실패 → `backup.failed` | 통합 |
| T17-17 | 백업 중 SIGTERM → `.tmp` 정리, 종료 지연 없음 | 통합 |
| T17-18 | 이벤트 루프 130초 차단(테스트 훅) → 감시 워커가 SIGABRT | 통합(짧은 임계값 설정) |
| T17-19 | 시계 뒤로 10분 → `clock` degraded, 이벤트 시각 단조(09 규칙) | 단위 |
| T17-20 | 복구: 더 새 스키마 스냅샷 거부. 정상 스냅샷 → quarantine에 이전 DB, 새 `storeId`, `store.restored`, 폐기 목록 병합, 현재 DB를 못 열면 기기 토큰 전부 무효 | 통합 |
| T17-21 | 복구 후 이전 `lastSeq`로 접속한 클라이언트가 스냅샷 경로를 탐(19 적합성과 함께) | 통합 |
| T17-22 | 업그레이드: 작업 트리가 더러우면 거부, 자체 시험 실패 시 운영 데몬 무변경, 성공 시 `current` 원자 교체와 releaseId 변경 | 시스템 |
| T17-23 | 업그레이드 후 준비 실패 → 자동 되돌리기, 스키마가 올라갔으면 pre-upgrade 스냅샷 복구 | 시스템 |
| T17-24 | 매니페스트의 Node 경로가 없으면 `helm doctor` FAIL | 단위 |
| T17-25 | `helm-alert`: 상태 파일 작성, 홈랩 스크립트 없으면 0 | 단위(bash) |
| T17-26 | 개발 데몬과 정식 데몬 동시 실행: 잠금·소켓·포트 충돌 없음 | 시스템 |
| T17-27 | 단위 파일: `systemd-analyze --user verify ~/.config/systemd/user/helmd.service` 통과, `@HELM_ROOT@` 남지 않음 | 시스템 |
| T17-28 | 재시작 정책: 코드 1 → 재시작, 2·3·4·5 → 재시작 안 함, 10분 6번째 시작 → `failed` + `helm-alert@` 실행 | 시스템 |
| T17-29 | 복구 훈련: 정상 스냅샷 통과, 투영 요약 불일치 주입 시 실패와 경보 | 통합 |
| T17-30 | (수동) `wsl --shutdown` 뒤 재기동: 비정상 종료 기록, 복구, 클라이언트 재접속. A17-1 결과 기록 | 수동 |
| T17-31 | (수동) `just daemon-probe`: tailscale serve 경유 `/healthz` 200, `?probe=ingress`에서 신원 헤더 존재 true(A17-2) | 수동 |
| T17-32 | `helm diag bundle`: 알려진 비밀 값과 토큰 패턴을 심은 로그에서 묶음이 그것을 포함하지 않음 | 통합 |
| T17-33 | `helm status` 꺼짐 화면: 데몬이 없을 때 owner 파일·마지막 백업·journald 마지막 오류로 출력, 종료 코드 1 | 통합 |
| T17-34 | 읽기 전용 복구 시작(무결성 tail 실패 주입): 리스너는 열리고 `daemon.booted`를 포함해 이벤트가 하나도 추가되지 않음(02 AC-10-09), 모든 쓰기 명령 `5003` | 통합 |
| T17-35 | `helm ops maintain`: 24시간 넘은 staged 업로드, 35일 넘은 참조 없는 blob 행, 30일 안 쓴 샌드박스 홈, 고아 worktree가 지워지고 정본 이벤트 수는 그대로 | 통합 |
| T17-36 | 주간 전체 검사 실패 주입 → 헬스 `db_integrity` critical, 백업 정리 정지(오래된 스냅샷이 남음), 데몬은 계속 쓰기 | 통합 |
| T17-37 | `helm doctor`: `rg`·`fd`·`git` 하나를 PATH에서 빼면 WARN과 해당 도구 이름, `bwrap` 없으면 S1b 안내 | 단위(bash) |
| T17-38 | 설정: `helmd.toml` < `helmd.local.toml` < 허용된 환경 변수 순서, TOML 문법 오류·모르는 키·`apiKey` 키 → 종료 코드 2 | 단위 |
| T17-39 | `helm device issue --json`: 표준 출력이 `HELM-DEVICE/1 ` 한 줄뿐이고 셸 시작 잡음은 표준 오류로 | 통합 |

완료 기준: 위 테스트(수동 제외)가 `just verify`(단위·통합)와 `just daemon-systest`(시스템)에서 통과하고, `just daemon-install` → `just daemon-status`가 이 서버에서 `ok`를 보이며, T17-30·31을 한 번 수행해 결과를 이 문서 §7에 반영한다.

## 7. 미결 사항

| ID | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| Q17-01 | Windows 재부팅 후 로그온 전 자동 시작 | (a) 그대로 둔다(로그온 후 시작) (b) Windows 자동 로그온 (c) `WSL-Autostart`를 "로그온 여부와 관계없이 실행"(S4U) 작업으로 바꾸는 시험 | (a). 사용 시간 08–02라 재부팅은 새벽에 일어나고 아침 로그온 전까지만 꺼진다. (c)는 동작이 확인되지 않았고 dotfiles 소관이다 [가정] |
| Q17-02 | 관찰 에이전트 격리 실행(`systemd-run`)을 처음부터 켤지 | (a) 켠다(16 IPC를 표준 입출력으로) (b) 16 원안(fork + Node IPC)으로 시작하고 나중에 | (b)로 시작하되 IPC 계층을 전송 독립으로 둔다. 관찰 자식은 비밀이 없고 쓰기 권한이 없다(16 OB-2·3) |
| Q17-03 | 도구 격리 수단 | (a) bubblewrap(13 S1, 설치 필요) (b) `systemd-run --user` 일회성 단위(지금 가능 [실험 10·22]) | 18 §7 Q18-03과 같음. (a), 설치 전에는 (b) |
| Q17-04 | `synchronous` 값 | `FULL` / `NORMAL` | `FULL`(09가 최종) |
| Q17-05 | restic에서 꺼낸 스냅샷으로 하는 훈련 주기 | 분기 수동 / 월 자동(홈랩 restic 비밀 필요) | 분기 수동(`just daemon-drill --file`) |
| Q17-06 | 업그레이드 시 진행 중 실행이 있으면 | 거부(기본) / `--when-idle` 대기 / `--force` | 거부 + 옵션 둘 |
| Q17-07 | 이벤트 루프 치명 임계값 | 60초 / 120초 / 끔 | 120초. 첫 달 실측 지연 분포로 조정 |
| Q17-08 | 정본 DB를 하나로 둘지 워크스페이스별로 둘지(v0.3 12 §15-2) | 하나 / 여럿 | 하나(09). 운영 절차는 하나를 전제로 썼다 |
| Q17-09 | 홈랩 H-2의 구현 모양 | `.backup-paths` 표식 / 홈랩 스크립트에 정적 목록 / Helm이 `_staging`에 복사 | 홈랩 소유자가 정한다. Helm 쪽은 어느 것이든 `backups/`, `data/blobs/`, `state/`만 내보낸다 |
| Q17-10 | 정식 데몬에 healthchecks.io 같은 외부 생존 신호를 둘지 | 홈랩 `heartbeat`에 맡김 / Helm 백업 성공 때 핑 | 홈랩 heartbeat에 맡긴다(서버 생존). Helm은 경보 단위로 실패만 알린다 |
| Q17-11 | sshd 포워딩을 `PermitOpen 127.0.0.1:7841`로 좁힐지 | 그대로(기본 허용) / 좁힘(다른 포워딩도 막힘) | 그대로. dotfiles 소유라 사람이 정한다 |

## 8. 출처

- 브리프: `docs/design/process/00-design-brief.md` 결정 20~22, 26, 29~31, 33, 36, 38, 39, §2.5, §3.
- 0단계 원천: `sources/pi-api-facts-2.md` §0, §1.1, §4.3, §8, §13; `sources/pi-api-facts-1.md` §0-9, §7.3~7.5; `sources/conversation-extracts-1.md` §6~7, §15(E1-094, E1-096, E1-100); `sources/conversation-extracts-4.md` §17, §20, §21(d22); `sources/pi-cases-notes.md` §1, §3.5, §6.5, §11.3, §11.4, §12, §14.
- 사례 메모: `.helm-design-work/S4/openclaw-runtime.md`(§1.5 PRAGMA, §2.3 재시작 복구, §2.4 종료 예산, §3.1 cron), `openclaw-gateway.md`(§2.5 serve 전용 리스너), `pi-web.md`(§1 소유 마커, §5 종료 순서), `paseo.md`(§5 관리 프로세스 원장, 스케줄 재시작).
- v0.3: `docs/v0.3/audit/backend-oss-research.md` §2.2, §5; `mastra-review.md` §2.2, §9; `docs/v0.3/12-implementation-architecture.md` §2, §12.3, §15.
- 다른 설계 문서(1단계 초안): `docs/design/06-system-architecture.md` §2, `16-observer-and-metrics.md` §2.2, §3.2, `19-client-protocol.md` §1~§2.3, `20-desktop-app-architecture.md` §2.
- 홈랩(읽기 전용): `~/projects/homelab/context/{index,machines,network,storage,decisions,remote}.md`, `tailscale/{README.md,policy.hujson,serve.table}`, `runbooks/{add-service,restore}.md`, `scripts/{backup,backup.exclude,serve-apply,lib/ts}`, `systemd/{backup.service,backup.timer,alert@.service,cert-renew.service}`, `scripts/windows/README.md`.
- dotfiles(읽기 전용): `~/.dotfiles/docs/SECRETS.md`, `~/.dotfiles/profiles/windows/{bootstrap.ps1,wslconfig}`, `~/.local/bin/secrets`(→ `shared/bin/secrets` `cmd_run`).
- 이 서버 확인: §2.2 표(명령과 결과), 기록 `.helm-design-work/P11/notes.md`.

## ADR 후보

### ADR-17-1 데몬을 systemd user unit으로 운영한다

- 상태: 제안
- 맥락: `helmd`는 WSL2 안에서 상주해야 한다(결정 22). 홈랩의 상시 작업 엔진은 just + systemd이고 타이머는 user unit이다. 에이전트는 `/etc`에 쓸 수 없고 sudo를 쓰지 않는다.
- 결정: `~/.config/systemd/user/helmd.service`(+ 백업·훈련 타이머, 도구 슬라이스, 경보 템플릿)로 운영한다. linger로 로그인 없이 돈다. `Restart=on-failure`, `RestartPreventExitStatus=2 3 4 5`, `KillMode=mixed`, `TimeoutStopSec=45s`.
- 근거: [실험 1·2·3·10] systemd·linger·cgroup 위임·user unit 샌드박스가 이 서버에서 동작한다. sudo 없이 설치·갱신할 수 있다. 도구 격리 단위를 `systemd-run --user`로 만들 수 있다.
- 기각한 대안: system unit(`User=user`) — root 설치가 필요하고 사람 개입이 업그레이드마다 생긴다. Docker 컨테이너 — 사용자 프로젝트 폴더·mise 도구·SSH 키 접근이 필요하고 홈랩의 compose 스택 규칙(라벨, `ctx-gen`)과 데몬 성격이 맞지 않는다. pm2 같은 Node 프로세스 관리자 — 홈랩 원칙(just + systemd) 밖이고 기능이 겹친다. `Restart=always` — 사람이 일부러 멈춘 데몬이 되살아난다.
- 결과: 로그는 `journalctl --user`. 로그온 전 자동 시작은 WSL 기동 방식에 묶인다(Q17-01).

### ADR-17-2 단일 인스턴스를 잠금 전용 SQLite 파일의 배타 트랜잭션으로 보장한다

- 상태: 제안
- 맥락: 정본 DB는 쓰기 프로세스가 하나여야 한다(결정 29, 06 single writer). 개발 데몬, 오프라인 CLI 작업, systemd 재시작이 겹칠 수 있다.
- 결정: `data/helmd.lock`에 `BEGIN EXCLUSIVE`를 프로세스 수명 동안 잡는다.
- 근거: 프로세스가 어떻게 죽든 커널이 풀므로 stale 정리가 필요 없다. 이미 쓰는 의존(`better-sqlite3`)만으로 된다. 두 사례가 같은 방식이다(사례 §12.1-4: happy-agent `AgentSQLiteProcessLock.ts:22-50`, pi-fabric `storage.ts:54-67`).
- 기각한 대안: pid 파일 + 생존 확인(pid 재사용, 정리 절차 필요. pi-chat의 실패 사례, 사례 §10.5), 정본 DB에 `locking_mode=EXCLUSIVE`(같은 프로세스의 읽기 워커·관찰 자식의 읽기 연결까지 막는다), `flock` 네이티브 모듈(의존 추가).
- 결과: 잠금 파일을 같은 프로세스에서 다시 열면 안 된다(POSIX 잠금 의미). 테스트 T17-03·04로 고정.

### ADR-17-3 비밀을 데몬이 자식 로더로 받아 메모리에만 둔다

- 상태: 제안
- 맥락: 홈랩·dotfiles 규칙은 비밀을 `secrets run`으로 자식 프로세스에만 주입한다. 그런데 `secrets run`은 `sops exec-env`로 명령을 자식으로 돌리고 SIGTERM을 전달하지 않는다 [실험 19]. 단위의 `ExecStart`를 이것으로 감싸면 정상 종료가 깨지고, 비밀이 데몬 환경 변수에 남아 도구 자식에게 물려진다.
- 결정: `helmd`가 시작 때 `secrets run <scope> -- helm-secret-export <키…>`를 실행해 표준 출력 JSON으로 값을 받고 메모리에만 둔다. 재적재 명령으로 무중단 갱신한다.
- 근거: 주 PID = node(신호 정상), 데몬 `environ`과 자식 환경에 비밀 없음, 진입점은 여전히 `secrets` 하나(SECRETS.md 규칙), 서버에 별도 비밀 저장소를 만들지 않음(브리프 §2.5).
- 기각한 대안: `ExecStart=secrets run … -- helmd`(신호 문제), `ExecStartPre`로 복호화한 평문 파일을 `RuntimeDirectory`에 두기(평문 파일이 생김), systemd `LoadCredential`(평문 원본 파일이 필요), `secrets` 스크립트에 `--same-process` 추가 요청(dotfiles 변경이고 `sh -c`가 여전히 fork한다 [실험 19]).
- 결과: `helm-secret-export`가 데몬 패키지의 진입점이 된다. 값 변경 후 `helm ops reload-secrets`.

### ADR-17-4 백업은 데몬의 검증된 온라인 스냅샷을 restic이 가져가게 한다

- 상태: 제안
- 맥락: 홈랩 restic은 매일 04:00에 파일을 가져간다. 살아 있는 WAL DB를 파일 복사로 가져가면 일관성이 보장되지 않는다. 홈랩 백업은 지금 docker 서비스 볼륨만 넣는다 [실험 20].
- 결정: 데몬이 03:40에 SQLite 온라인 백업 API로 스냅샷을 만들고 무결성·해시 체인·투영 요약을 검증한 뒤 매니페스트와 함께 `backups/`에 둔다. 홈랩이 `backups/`, `data/blobs/`, `state/`를 restic에 넣는다(H-2). 매월 복구 훈련으로 스냅샷이 되살아나는지 확인한다.
- 근거: 홈랩 CouchDB `_staging` 방식과 같은 생각. 검증된 스냅샷만 오프사이트로 간다. restic이 버전 이력을 맡으므로 로컬 보관은 짧게 둔다.
- 기각한 대안: restic 직전에 데몬 정지(클라이언트 없이도 작업 지속이라는 결정 22와 충돌), `VACUUM INTO`(주 연결을 수 초 막음), restic이 살아 있는 DB를 직접 가져감(일관성 없음), Litestream류 연속 복제(새 상시 구성 요소, 홈랩 원칙 밖).
- 결과: 홈랩 변경 전까지는 오프사이트 백업이 없는 상태로 경고한다. 블롭 삭제 규칙이 restic 보존 창에 묶인다.

### ADR-17-5 릴리스를 git 커밋에서 빌드한 불변 디렉터리로 운영한다

- 상태: 제안
- 맥락: 작업 트리(`~/projects/helm/code/helm`)는 Syncthing으로 Mac과 양방향 동기화된다. 실행 중 데몬이 작업 트리 코드를 쓰면 동기화된 미완성 변경이 재시작 때 섞인다. 되돌리기도 필요하다.
- 결정: `just daemon-upgrade`가 HEAD 커밋을 `git archive`로 꺼내 빌드하고 `pnpm deploy`로 `releases/<id>/`를 만들어 `current` 링크를 원자 교체한다. 이전 릴리스는 `previous`로 남긴다. Node 경로·ABI·스키마 범위를 매니페스트에 적는다.
- 근거: 커밋된 코드만 운영에 들어간다. 되돌리기가 링크 교체다. 매니페스트 해시로 릴리스 변조·손상을 확인할 수 있다.
- 기각한 대안: 작업 트리에서 `node dist/main.js` 직접 실행(동기화 변경 혼입, 되돌리기 어려움), npm 전역 설치(버전 관리·되돌리기가 약함), Docker 이미지(ADR-17-1의 이유).
- 결과: 업그레이드마다 빌드 시간과 디스크(릴리스 3개 유지)가 든다. 네이티브 모듈(`better-sqlite3`)은 매니페스트의 Node ABI에 묶인다.
