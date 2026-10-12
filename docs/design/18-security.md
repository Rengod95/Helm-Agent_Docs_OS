# 18. 보안

- 작성: 2026-10-11, P11(데몬)
- 상태: 2a단계 통합판(2026-10-12). 브리프 결정 42·44~46과 조정자 판정(J-17 등)을 반영하고 01~16·19~21의 요구를 처리했다. 모바일 문서 26은 아직 없어 §3.18을 요구로 남겼다. 1단계 초안 머리말: 06(P3)·12(P7)·16(P10)·19(P12)·20(P13)의 1단계 초안을 읽고 맞췄다. 09(P5), 11(P6), 13(P7)은 이 문서를 쓰는 동안 아직 없었다. 그 문서가 소유하는 이름은 임시로 쓰고 §5.2에 요구로 적었다.
- 소유: 위협 모델, 리스너별 연결 정책, 주체(principal)와 권한, 인증(Tailscale 신원 + whois + 기기 토큰, SSH 경로, 로컬), 기기 페어링 규칙, 토큰 형식·수명·회전·폐기·저장, 비밀 저장·주입 정책과 마스킹, 도구 실행 격리의 보안 요구(13과 맞춤), 보호 경로, 감사 기록, 속도·크기 한도의 보안 상한, 공급망, 백업·복구의 보안 조건, 보안 테스트 목록.
- 소유하지 않음: 핸드셰이크 메시지 형식·오류 코드·메서드 이름(19), 리스너 주소·소켓 경로·데몬 수명주기·비밀 로딩 절차(17), 격리 수단의 구현과 도구 목록·범위 검사 알고리즘(13), 키체인 사용과 SSH 실행(20), 이벤트 이름 카탈로그와 해시 체인 형식(09), 권리 게이트의 묻기 흐름(11).
- 출처 표기는 17과 같다. "[실험 N]"은 `17-daemon-and-operations.md` §2.2 표의 N번 행이다.

## 1. 목적과 범위

### 1.1 목적

1인용 Helm이 외부 접속(결정 21)과 상주 실행(결정 22)을 하면서도 다음을 지키게 한다.

1. 소유자만 Helm을 조작한다. 특히 사람의 결정(합의, 결과 확인, 답, 이의)은 소유자의 기기나 서버 셸에서만 들어온다(결정 14, 불변조건).
2. 모델이 실행하는 도구와 기록 속의 문장(프롬프트 주입)이 Helm 자신의 권한·비밀·정본을 건드리지 못한다.
3. 모델 API 키와 기기 토큰이 로그·이벤트·투영·백업 사본으로 새지 않는다.
4. 사고가 나면 무엇이 일어났는지 기록으로 알 수 있다.

### 1.2 다루는 것

위협 모델(자산·공격자·경로), 리스너별 연결 정책, 주체와 scope, 인증 세 경로, 페어링, 토큰 수명·회전·폐기·저장, 비밀 저장·주입·마스킹, 도구 실행 격리 요구와 보호 경로, 프롬프트 주입 대응, 감사 기록, 속도·크기 한도, 공급망, 백업·복구 보안, 보안 테스트.

### 1.3 다루지 않는 것

| 주제 | 소유 문서 |
|---|---|
| Effect class·가역성 판별 | Helm 범위 밖(결정 2). 이 문서의 보호 경로·네트워크 규칙은 권한 레이어의 고정 기준선이다(§3.11.6) |
| 권리 게이트 질문의 생성·전달 | 11 |
| 메시지 형식, 오류 코드 번호, scope 이름 | 19 |
| 격리 수단 구현, 도구별 실행 정책, bash 우회 범위 검사 | 13 |
| 앱 쪽 키체인, SSH 프로세스, 호스트 키 정책 구현 | 20 |
| Windows·Tailscale·홈랩 인프라 보안(ACL, 방화벽) | 홈랩. 이 문서는 전제로 쓴다 |
| 다중 사용자, 조직 정책 | 비목표(결정 24, 06 §2.4) |

### 1.4 관련 유즈케이스

| 유즈케이스 | 보안 관심 |
|---|---|
| UC-04 외부에서 접속해 질문에 답하기 | tailnet 경로 인증, 도난 기기, 사람 결정의 출처 기록 |
| UC-03 여러 날 걸리는 작업 | 무인 실행 중 도구 격리, 비밀 보호 |
| UC-07 되돌리기 비싼 선택 | 사람 결정 권한이 모델 경로로 위조되지 않음 |
| UC-08 반복 마찰 제안 | 외부 세션 로그의 프롬프트 주입, 비밀 마스킹, 자동 설치 금지 |
| UC-01 취향형 작업 | 큰 파일(자극 이미지) 전송 경로 |

## 2. 전제와 결정

### 2.1 브리프 결정에서 오는 전제

| 결정 | 이 문서에 미치는 것 |
|---|---|
| 2 | 가역성·effect class는 Helm이 판별하지 않는다. 보안 기준선(보호 경로, 비밀 파일, 네트워크)은 권한 레이어의 고정 규칙으로 둔다 |
| 14, 17 | 모델은 제안하고 커널이 상태를 바꾼다. 사람 결정은 사람 채널로만 들어온다. 이 문서는 "사람 채널"이 무엇인지(주체)를 정한다 |
| 21, 22, 26 | 외부 접속은 Windows `tailscale serve`, 데몬은 127.0.0.1, 인증은 Tailscale 신원 헤더 + 기기 bearer 토큰, Funnel 금지 |
| 24 | 1인용. 역할 분리는 최소로 둔다 |
| 35 | 관찰 에이전트가 외부 에이전트 세션 로그를 읽는다. 신뢰할 수 없는 입력이다 |
| 38 | 데스크톱 앱은 SSH로도 붙는다. SSH 경로의 인증을 이 문서가 정한다 |
| §2.5 | 비밀은 SOPS 원본 하나와 `secrets` 진입점. 서버에 별도 비밀 저장소를 두지 않는다. 클라이언트 기기는 OS 키체인 |
| 42 | 휴대폰에서도 질문에 답한다. 모바일 기기의 페어링·토큰·분실·푸시 요구는 §3.18(구체 방식은 26) |
| 44 | pi 기준 태그 `v1.1.0`(커밋 `abe508e1`), Node 24, TS 6.0 |
| 45 | 데몬 비밀은 시작 단계의 `secrets run` 자식 로더로 받아 메모리에만(ADR-17-3) |
| 46 | 루프백 바인딩은 격리 경계가 아니다(D18-04, §3.4) |

### 2.2 확인한 사실

17 §2.2의 [실험] 표를 그대로 쓴다. 보안에 직접 쓰는 것:

| 사실 | 근거 |
|---|---|
| WSL의 127.0.0.1 TCP 포트는 Windows 프로세스에서도 열린다(mirrored) | [실험 6] |
| Caddy 관리 API `127.0.0.1:2019`가 인증 없이 응답한다(홈랩) | [실험: `curl.exe http://127.0.0.1:2019/config/` → 200] |
| Windows `tailscale.exe whois`를 WSL에서 부를 수 있다. 0.07~0.9초 | [실험 15] |
| user unit 일회성 단위에서 `PrivateUsers`, `ProtectSystem=strict`, `InaccessiblePaths`, `PrivateNetwork`가 동작하고, `/run/WSL`을 막으면 Windows 실행 파일(interop)이 실행되지 않는다 | [실험 10·22] |
| `bwrap`·`pasta`는 설치되어 있지 않다. 비특권 user namespace는 된다 | [실험 7], `unshare -Ur true` 성공 |
| `kernel.yama.ptrace_scope = 1` | `sysctl` |
| `secrets run`(= `sops exec-env`) 아래 프로세스는 비밀을 환경 변수로 받는다. 이 환경은 같은 uid가 `/proc/<pid>/environ`으로 읽을 수 있다 | [지식] + [실험 19] |
| sshd: 키 인증만, root 금지, tailnet에서만(Hyper-V 방화벽) | [실험 18], 홈랩 `context/network.md` |
| Tailscale grants: 소유자 기기 → `tag:server` 전체 허용. `tag:vps`·`tag:ci` → 443 등 금지(정책 tests) | [원문] 홈랩 `tailscale/policy.hujson` |

### 2.3 이 문서의 주요 설계 결정

| ID | 내용 | 표시·근거 |
|---|---|---|
| D18-01 | 기기 토큰이 원격 인증의 필수 요소다. Tailscale 신원 헤더와 whois는 `tailnet` 리스너에서만 보는 추가 조건이고 토큰을 대신하지 않는다. 세 조건은 AND다 | [결정 26] + 세부 [제안]. 사례 §12.1-7(openclaw `ingress-attribution.ts:126-202`) |
| D18-02 | 기기 토큰을 페어링 때 본 tailnet 노드(whois `Node.StableID`)에 묶는다. 다른 노드에서 같은 토큰이 오면 거부한다 | [제안]. 같은 호스트에서 헤더를 위조할 수 있으므로 whois 대조만으로는 약하다. 노드 묶기는 토큰이 새도 다른 기기에서 쓰기 어렵게 한다 |
| D18-03 | SSH 경로는 SSH 키(전송) + 기기 토큰(Helm)을 함께 요구한다. SSH 유래 연결은 `tailnet`과 다른 `loopback` 리스너로 받고, 그 리스너는 로컬 관리자 주체를 받지 않는다 | [제안], 결정 38. 19 P-01~03, 20 APP-D03·04와 같은 결론. ADR-18-2 |
| D18-04 | 로컬 관리자(Unix 소켓, 같은 uid)는 토큰 없이 모든 권한을 갖는다. 같은 uid의 셸을 가진 자는 어차피 DB와 코드를 직접 바꿀 수 있기 때문이다. 대신 Helm이 띄우는 도구 프로세스는 이 소켓과 Helm 데이터를 볼 수 없게 격리한다 | [제안]. 보안 경계를 "같은 uid"가 아니라 "Helm이 띄운 도구 샌드박스"에 둔다 |
| D18-05 | 도구 실행은 기본으로 격리한다. 1순위는 13의 S1(bubblewrap, PID·네트워크·마운트 네임스페이스)이다. bubblewrap이 없으면 `systemd-run --user` 일회성 단위(이 서버에서 바로 됨)로 격리한다. 둘 다 없으면 `execute` 도구를 끈다(fail closed). 13의 S0(격리 없음)은 합의 플래그만으로 켤 수 없고 데몬 설정(운영자)으로만 켠다 | [제안]. [실험 10·22], 13 §3.6.1. ADR-18-4 |
| D18-06 | 서버는 토큰의 SHA-256만 저장한다. 토큰은 256비트 무작위이므로 소금이 필요 없다. 비교는 해시 조회 후 상수 시간 비교 | [제안]. 사례 §12.1-7(pi-fabric `grants.ts:1-14`), §12.2-7(openclaw 평문 저장을 피함) |
| D18-07 | 1차에는 기기 키 서명(Ed25519 challenge)을 요구하지 않는다(`proofRequired=false`). 형식은 19에 예약되어 있고, 켜는 조건을 §3.8.5에 둔다 | [제안]. ADR-18-3 |
| D18-08 | 비밀은 데몬 메모리에만 있다(17 §3.8). 알려진 비밀 값과 비밀 패턴을 로그·이벤트·투영·진단·도구 출력에서 지운다. 도구 출력은 정본에 쓰기 전에 지운다 | [제안] |
| D18-09 | 비밀이 담긴 파일(보호 경로)을 모델 컨텍스트로 읽는 것은 정보가 밖(모델 공급자)으로 나가는 행동이다. 기본 거부, 사람이 경로별로 허용 | [제안]. 발췌4 d3에 대한 답 |
| D18-10 | 보안 감사는 별도 저장소가 아니라 정본 이벤트로 남긴다. 인증 실패는 출처별로 묶어 기록한다. 백업 매니페스트의 마지막 해시를 외부 기준점으로 써서 체인 재작성을 감지한다 | [제안] |
| D18-11 | 복구로 되살아난 DB가 폐기된 토큰을 되살리지 않게 한다(폐기 목록 병합, 못 하면 전체 무효) | [제안] |
| D18-12 | pi 포크와 npm 의존은 정확한 버전·잠금 파일·빌드 스크립트 허용 목록으로 고정하고, 운영 릴리스는 커밋에서만 빌드한다 | [제안]. facts-2 §13 공통, 17 ADR-17-5 |

### 2.4 원천 체크리스트 반영표

| 원천 항목 | 처리 | 위치 |
|---|---|---|
| 발췌4 (d) d1: 권리 게이트를 Helm 묻기에 둘지 권한 레이어에 둘지 (담당 11, 18) | 18의 답: 판정(이 행동은 사람만 정할 권리가 있다)은 권한 레이어의 고정 규칙(§3.11.6)과 13의 판정에서 나오고, 묻기(언제·어떻게 사람에게 전하나)는 11이 한다. 권한 레이어는 "needs-human"만 돌려주고 질문을 직접 만들지 않는다 | §3.11.6, §5.2(11·13) |
| 발췌4 (d) d3: 정보가 밖으로 나가는 행동(시크릿, 메일)을 권한 레이어에서 고정 규칙으로 둘지 (담당 18, 13) | 고정 규칙으로 둔다. (1) 보호 경로 읽기는 기본 거부(D18-09), (2) `send` 원시 행동은 항상 작업 합의 필요(결정 15) + 고정 needs-human, (3) 네트워크는 도구 기본 차단 | §3.11 |
| 발췌4 b1: 정보 유출 행동은 고정으로 남김(사용자는 effect class 전체 제외) | d3과 같이 처리. effect class는 쓰지 않고(결정 2) 보호 경로·`send`·네트워크 세 규칙만 고정 | §3.11.6 |
| 발췌1 (d) Q7: 로그 속 비밀 정보 마스킹 규칙과 세션 기록 속 지시문(프롬프트 주입) 처리 (담당 16, 18) | 16 §3.8~3.9가 관찰 입력 쪽 마스킹·의심 표시를 정했다. 18은 공통 마스킹기(§3.10.4)와 신뢰 등급 원칙(§3.12)을 정하고 16이 그것을 쓴다 | §3.10.4, §3.12 |
| 발췌1 E1-076: 세션 기록은 신뢰할 수 없는 데이터, 오염된 스킬 제안, 자동 설치 금지 | 반영. 관찰 제안의 적용은 사람 채택 + 일반 작업 경로(16 OB-6). 18은 금지를 보안 요구로 고정 | §3.12 |
| 발췌1 E1-077: 비밀이 로그에 섞임, 정규화 단계에서 마스킹 | 반영 | §3.10.4 |
| 발췌1 E1-060·E1-063: bash 우회, 범용 도구를 런타임이 감싸야 한다 | 범위 검사는 13. 18은 "bash가 무엇을 하든 넘을 수 없는 바깥 경계"(샌드박스)를 요구한다. 범위 검사가 뚫려도 보호 경로·소켓·비밀은 보이지 않는다 | §3.11 |
| 발췌1 E1-187: codemode 격리는 스크립트만 가둔다. 도구는 도구 권한만큼 위험 | 반영. codemode 안의 도구 호출도 같은 격리·검사를 탄다(13) | §3.11.1 R-9 |
| facts-1 §0-5: coding-agent 도구는 경로를 제한하지 않는다. pi에는 권한 시스템이 없다 | 반영. 보호 경로 검사(§3.11.5)는 도구 안이 아니라 Helm 래퍼와 샌드박스 두 곳에서 한다 | §3.11 |
| facts-1 §0-7: grep/find가 rg/fd를 실행 중 내려받는다 | 공급망 규칙: 실행 중 내려받기 금지(`PI_OFFLINE=1` 또는 tools-manager 제거, 07). 설치된 rg/fd만 쓴다 | §3.15 |
| facts-2 §1.2, §13 공통: 정확한 버전 고정, LICENSE 고지, 업스트림 차이 기록 | 반영 | §3.15 |
| facts-2 §3.1, §4.1: pi-protocol·pi-server는 인증이 없고 리스너 몫이다 | 같은 경계: 인증은 리스너·핸드셰이크에서 끝내고 프로토콜 처리기는 인증된 연결만 받는다 | §3.4 |
| 사례 §12.1-7: Tailscale 헤더는 serve 전용 loopback 리스너에서만, whois 대조, 기기 토큰을 대신하지 않음, nonce 서명 선택지, 서버는 토큰 해시만 | 반영(D18-01, -03, -06, -07) | §3.6, §3.8, §3.9 |
| 사례 §11.3 인증 비교 표 | 각 사례의 선택과 Helm의 선택을 §3.6.5 표로 대조 | §3.6.5 |
| 사례 §12.2-7: 비밀 평문 저장, 웹 저장소의 개인키 | 피한다. 서버는 해시, 클라이언트는 OS 키체인(20) | §3.9 |
| 사례 §12.2-8: loopback 자동 승인을 기본으로 켜기 | 쓰지 않는다. "127.0.0.1에서 왔다"는 신뢰 근거가 아니다. 로컬 관리자는 Unix 소켓 파일 권한으로만 인정 | §3.4, §3.5 |
| 사례 §12.2-9: 데몬이 serve를 소유·sudo fallback, Tailscale IP 직접 바인딩 | 쓰지 않는다. serve는 홈랩이 선언적으로 관리(17 §3.7) | §3.4 |
| S4 openclaw-gateway §1.3: 사전 인증 한도(64 KiB, IP당 128, 큐 16, 15초) | 19 §3.4.5가 1인 사용에 맞게 줄인 값을 채택. 18은 그 값을 보안 상한으로 확인 | §3.14 |
| S4 openclaw-gateway §2.4: 페어링 대기 소켓, 이벤트 자체는 권한을 주지 않음 | 흐름 B(SSH 발급)와 흐름 A(코드)로 대신한다. 승인 대기 소켓은 두지 않는다(§3.7.4) | §3.7 |
| S4 paseo §4: DNS rebinding 방어(Host 허용 목록), relay 세션 재전송 방지 없음, 로컬 자격증명이 같은 사용자 프로세스에 노출 | Host·Origin 허용 목록 반영. 로컬 자격증명 노출은 D18-04로 받아들이고 도구 격리로 줄인다 | §3.4.3, §3.11 |

### 2.5 가정

| ID | 가정 | 확인 방법 |
|---|---|---|
| A18-1 [가정] | `tailscale serve`(HTTPS 모드)는 사용자 소유(태그 없는) 노드에서 온 요청에 `Tailscale-User-Login`, `Tailscale-User-Name`을 붙이고, 태그 노드에서 온 요청에는 붙이지 않는다. 클라이언트가 보낸 같은 이름의 헤더는 지우거나 덮어쓴다 | [지식] + openclaw가 이를 전제로 함. `just daemon-probe`(17 §3.14)와 T18-05로 확인. 덮어쓰지 않는다면 whois 대조와 노드 묶기가 남는다 |
| A18-2 [가정] | serve는 `X-Forwarded-For`에 클라이언트의 tailnet 주소를 넣는다 | 위와 같음 |
| A18-3 [가정] | WSL2에서는 Windows 프로세스가 WSL 안의 Unix 소켓에 연결할 수 없다 | [지식: AF_UNIX interop은 WSL1 기능]. T18-12로 확인(Windows에서 `\\wsl$` 경로의 소켓 연결 시도) |
| A18-4 [가정] | 같은 uid의 프로세스는 Helm 데이터·코드·소켓에 접근할 수 있다. Helm은 이를 막지 않는다(D18-04) | 설계 전제 |

## 3. 명세 본문

### 3.1 보호 대상(자산)

| ID | 자산 | 왜 중요한가 | 있는 곳 |
|---|---|---|---|
| AS-DB | 정본 이벤트 로그와 투영 | 모든 결정·근거·작업 내용. 변조되면 판단이 틀어진다 | `/srv/volumes/helm/data/helm.sqlite*` |
| AS-DEC | 사람 결정 권한 | 합의·결과 확인·답·이의의 진위. 불변조건의 기반 | 리스너 주체와 커널 경로 |
| AS-TOK | 기기 토큰(클라이언트 쪽 원본), 토큰 해시(서버 쪽) | 원격 조작 권한 | 앱 OS 키체인 / DB |
| AS-KEY | 모델 API 키 | 금전 피해, 공급자 계정 | SOPS 원본, 데몬 메모리 |
| AS-WS | 사용자 프로젝트 파일 | 도구가 쓰는 대상. 손상·유출 | `~/projects/…` |
| AS-OTHER | 서버의 다른 비밀(age 키, SSH 개인 키, 다른 제품·인프라 SOPS 원본의 복호화 능력, `.env`) | Helm 밖 전체로 번진다 | `~/.config/sops`, `~/.ssh`, `~/projects/*/code/*/.env` 등 |
| AS-BAK | 백업 스냅샷 | AS-DB 전체와 토큰 해시 사본 | `/srv/volumes/helm/backups`, restic(D:, 오프사이트) |
| AS-CODE | 데몬 릴리스 코드 | 바뀌면 모든 것이 뚫린다 | `/srv/volumes/helm/app/releases` |
| AS-EXT | 외부 세션 로그(관찰 입력) | 사용자의 다른 작업 내용과 비밀이 섞여 있다 | 허용 폴더의 pi·Claude Code·Codex 로그 |

### 3.2 공격자와 경로

| ID | 공격자 / 경로 | 노리는 자산 | 대응 | 남는 위험 |
|---|---|---|---|---|
| T-N1 | tailnet 안의 다른 기기(감염된 Mac·iPhone, 공유하지 않지만 소유한 다른 기기) | AS-DEC, AS-DB | 8448은 기기 토큰 필수(D18-01). 토큰은 노드에 묶임(D18-02). tailnet 접근 규칙은 소유자 기기만 허용, `tag:vps`·`tag:ci` 차단 [원문 policy.hujson] | 감염된 기기가 자기 토큰을 그대로 쓰면 막을 수 없다 → 폐기(§3.8.4)와 감사(§3.13)로 대응 |
| T-N2 | tailnet 밖(인터넷) | 전부 | Funnel 금지(결정 26), 데몬은 127.0.0.1, 공유기 포트포워딩 없음 [원문 network.md]. Funnel 켜짐을 `check-helm-host.ps1`과 `helm doctor`가 경고 | Tailscale 계정 탈취(계정 보안은 범위 밖) |
| T-H1 | 같은 호스트의 Windows 프로세스(악성 프로그램, 브라우저 페이지의 DNS rebinding) | AS-DEC | TCP 리스너 둘 다 토큰 필수, Host·Origin 허용 목록(§3.4.3), 로컬 관리자는 Unix 소켓에서만(A18-3) | Windows 쪽 악성 프로그램이 Windows 사용자 권한으로 할 수 있는 다른 일(`\\wsl$`로 파일 접근 등)은 범위 밖 [가정: Windows 사용자는 WSL 파일에 접근할 수 있다 [지식]] |
| T-H2 | 같은 호스트의 WSL 프로세스, 같은 uid(다른 에이전트 세션, 사용자 스크립트) | 전부 | 막지 않는다(D18-04, A18-4). 감사로 흔적을 남기고(로컬 관리자 명령도 기록), 체인 기준점(§3.13.3)으로 사후 변조를 감지 | 같은 uid는 DB·코드를 바꿀 수 있다 |
| T-H3 | 같은 uid가 데몬 프로세스를 조작(SIGUSR1 inspector, ptrace) | AS-KEY | `--disable-sigusr1`(17 §3.1.2), `ptrace_scope=1`(부모만 ptrace) [실험], `NODE_OPTIONS` 비움 | `/proc/<pid>/mem` 등 같은 uid 공격은 남는다(T-H2와 같음) |
| T-H4 | 다른 uid·root | 전부 | 범위 밖 | - |
| T-L1 | 도난·분실 노트북(앱이 설치된 Mac·Windows) | AS-TOK, AS-DEC | 토큰은 OS 키체인(잠금 시 보호), 노드 묶기(그 노트북의 Tailscale을 함께 써야 함), 다른 기기나 서버에서 즉시 폐기(`helm device revoke`), SSH 키는 사용자가 별도 폐기 | 잠기지 않은 상태로 도난되면 폐기 전까지 조작 가능 |
| T-P1 | 프롬프트 주입: 웹·도구 출력·이슈 본문·외부 세션 로그의 문장 | AS-DEC, AS-WS, AS-KEY | 모델은 결정 권한이 없다(결정 14). 쓰기·보내기는 합의 필요(결정 15). 도구는 격리. 관찰 제안은 사람 채택만(§3.12) | 모델이 합의 범위 안에서 잘못된 쓰기를 하는 것은 작업 품질 문제로 남는다(A 루프·검증) |
| T-P2 | 외부 에이전트 세션 로그(관찰 입력, 결정 35): 제3자가 쓴 내용(이슈·웹 발췌), 사용자 다른 작업의 비밀, 주입 문장 | AS-EXT, AS-KEY, 관찰 제안의 오염 | 관찰 자식은 비밀이 없고(16 OB-3) 쓰기 권한이 없다(16 OB-2). 정규화 단계 마스킹(16 §3.8, 공통 규칙 §3.10.4)과 엔트로피 검사, 지시문 의심 표시(16 §3.9.3). 모델로 보내는 외부 발췌는 `sendExternalExcerpts`(기본 true)일 때 사람·에이전트 문장만, 도구 출력 제외(16 §3.5.3). 제안 적용은 사람 채택 + 일반 작업 경로. 허용 폴더 밖 세션은 읽지 않는다(J-08) | 마스킹이 놓친 비밀이 모델 공급자로 갈 수 있다 → 프로젝트별로 `sendExternalExcerpts=false`를 고를 수 있게 한다(16 설정) |
| T-M1 | 모델이 실행하는 도구(bash 등) | AS-OTHER, AS-KEY, AS-DB, AS-DEC | 샌드박스: 보호 경로 숨김, 소켓 숨김, 비밀 없는 환경, PID 분리, interop 차단, 네트워크 기본 차단(§3.11) | 네트워크를 허용한 실행은 같은 호스트의 루프백 서비스에 접근할 수 있다(T-M5). PID 네임스페이스가 없는 1차 구성에서는 같은 uid 프로세스(데몬 포함)에 신호를 보낼 수 있다(서비스 거부. 재시작·복구가 받는다) |
| T-M2 | 도구가 Windows 실행 파일을 실행(WSL interop)해 샌드박스 밖으로 나감 | 전부(Windows 사용자 권한) | `/run/WSL` 숨김 → interop 실패 [실험 22], `WSL_INTEROP` 환경 제거, `/mnt/c` 등 바인딩 안 함 | - |
| T-M3 | 도구가 `helm` CLI나 소켓으로 사람 결정을 위조 | AS-DEC | 소켓 디렉터리 숨김, 토큰은 서버에 없음(로컬 TUI·CLI는 토큰 없이 소켓 권한으로 인정) | 격리를 끈 설정에서는 막지 못한다 → 격리 없으면 실행 도구를 끈다(D18-05) |
| T-M4 | 도구 출력에 비밀이 섞여 정본·모델 공급자·클라이언트로 퍼짐 | AS-KEY, AS-OTHER | 출력 마스킹(§3.10.4), 보호 경로 읽기 거부(D18-09) | 알려지지 않은 형식의 비밀 |
| T-M5 | 네트워크를 허용한 도구가 루프백의 다른 서비스(Caddy 관리 API 2019 무인증 [실험], Syncthing GUI, Dockhand)를 조작 | 홈랩 전체 | 기본 네트워크 차단. 허용은 합의의 명시 항목. 홈랩에 2019 정리 요청(17 H-5) | 허용한 실행 동안 남는다 |
| T-S1 | 공급망: pi 포크 갱신, npm 의존, 빌드 스크립트 | AS-CODE | 정확한 버전, 잠금 파일, 빌드 스크립트 허용 목록, 커밋 빌드, 실행 중 내려받기 금지(§3.15) | 고정한 버전 안의 악성 코드 |
| T-S2 | 동기화 폴더 변경(Mac이 감염되어 `~/projects/helm/code` 수정) | AS-CODE | 운영은 커밋에서 빌드한 릴리스만 실행(17 ADR-17-5). 커밋·업그레이드는 사람이 서버에서 한다 | 사람이 변조된 커밋을 그대로 업그레이드하면 들어온다 |
| T-B1 | 백업 사본 유출(D: 파티션, 오프사이트) | AS-BAK | restic 저장소 암호화(홈랩). 스냅샷에 비밀 값이 없다(토큰 해시만, 키 없음) | 정본 내용 자체는 restic 비밀번호에 기댄다 |
| T-R1 | 복구로 폐기된 토큰이 되살아남 | AS-DEC | D18-11, §3.16 | - |

### 3.3 신뢰 경계

```text
[인터넷] ── (Funnel 금지) ──X
[tailnet: 소유자 기기]                         [같은 호스트 Windows 프로세스]
   │ HTTPS/WSS :8448 (tailscale serve, TLS)        │ TCP 127.0.0.1:7840/7841 (mirrored)
   │ SSH :22 (키 인증, Hyper-V 방화벽)               │
   ▼                                               ▼
┌──────────────── WSL2, uid=user ───────────────────────────────────────────────┐
│  sshd ──direct-tcpip──▶ loopback 리스너 127.0.0.1:7841 ─┐                       │
│  tailscale serve(Windows) ─▶ tailnet 리스너 127.0.0.1:7840 ─┤ 경계 B: 기기 토큰   │
│  같은 uid 프로세스 ──▶ local 리스너 rpc.sock(0600) ────────┤ 경계 A: 파일 권한   │
│                                                          ▼                     │
│   helmd (비밀은 메모리, 커널이 사람 결정 경로를 검사)                               │
│     │ 도구 실행                                                                │
│     ▼ 경계 C: 샌드박스(systemd-run 일회성 단위)                                  │
│   [도구] 보이는 것: 합의 범위 작업 공간(rw), 도구 체인(ro), 시스템(ro)            │
│          안 보이는 것: /srv/volumes, /run/user/<uid>, /run/WSL, ~/.ssh,          │
│                       ~/.config/sops, 다른 비밀 원본, Windows 드라이브            │
│          네트워크: 기본 없음                                                     │
└────────────────────────────────────────────────────────────────────────────────┘
```

- 경계 A(같은 uid): 넘으면 모든 것이 가능하다. Helm은 이 경계를 지키지 않는다(D18-04).
- 경계 B(기기 토큰): 원격·같은 호스트의 다른 OS 사용자 공간에서 오는 연결의 경계.
- 경계 C(도구 샌드박스): Helm이 직접 만든 가장 중요한 경계. 모델이 실행하는 코드가 경계 A 안으로 들어오지 못하게 한다.

### 3.4 리스너와 연결 정책

리스너 주소는 17 §3.5. 연결 수락부터 `hello` 판정까지의 보안 규칙을 정한다. 메시지 형식은 19 §3.4.

#### 3.4.1 리스너별 정책 표

| 항목 | `tailnet` (127.0.0.1:7840) | `loopback` (127.0.0.1:7841) | `local` (`rpc.sock`) |
|---|---|---|---|
| 받는 출처 | tailscale serve가 넘긴 연결 | sshd가 `-W`로 연 연결. 같은 호스트의 아무 프로세스도 열 수 있다 | 같은 uid 프로세스 |
| HTTP 업그레이드 전 검사 | Host, Origin, Tailscale 신원 헤더, `X-Forwarded-For`, whois(§3.6) | Host, Origin | 없음 |
| 받는 주체 | `device` | `device` | `device`, `localAdmin` |
| 기기 토큰 | 필수 | 필수 | 선택(있으면 그 기기로 인정) |
| 노드 묶기(D18-02) | 검사 | 검사하지 않음(sshd 연결은 출처 IP를 알 수 없다) | 검사하지 않음 |
| 페어링 `POST /pair` | 받음 | 받지 않음(SSH 경로는 흐름 B) | 받지 않음 |
| `/healthz` | 받음(Host·Origin 검사 후) | 받음 | 받음 |
| 인증 실패 속도 한도 출처 | `X-Forwarded-For`의 tailnet 주소(whois로 확인된 것) | 리스너 전체 | 해당 없음 |

#### 3.4.2 리스너를 나누는 이유

- `tailnet`의 추가 조건(신원 헤더)은 serve를 거친 연결에만 있다. SSH 연결을 같은 포트로 받으면 "헤더가 없으면 다른 규칙"이 필요해지고, 같은 호스트의 아무 프로세스나 헤더를 빼고 붙어 그 규칙을 탈 수 있다. 포트를 나누면 각 포트의 규칙에 예외가 없다(사례 §12.1-7, openclaw `server-runtime-state.ts:399-404`의 serve 전용 리스너).
- 신원 헤더는 같은 호스트의 프로세스가 위조할 수 있다(127.0.0.1에서 오는 연결은 serve와 구별되지 않는다). 그래서 헤더는 기기 토큰의 대체가 아니고, whois 대조와 노드 묶기로 "토큰 + 그 토큰의 원래 기기"를 함께 확인하는 데 쓴다.
- `localAdmin`을 TCP에서 받지 않는 이유: mirrored 모드에서 TCP 루프백은 Windows 프로세스도 연다 [실험 6]. Unix 소켓은 파일 권한으로 같은 uid만 연다(A18-3).

#### 3.4.3 업그레이드 전 검사(TCP 리스너) [제안]

```text
preflight(req, listener):
  if listener == tailnet:
     host ∈ { cfg.listeners.tailnet.publicHost }              # "server.tail7ad0b4.ts.net:8448"
  if listener == loopback:
     host ∈ { "127.0.0.1:7841", "localhost:7841" }
  else → 403 (DNS rebinding 방어, S4 paseo §4. 19 §3.2: Host·Origin 불일치는 403)
  if req.headers.origin 있음:                                  # 브라우저에서 온 요청
     origin ∈ cfg.auth.allowedOrigins                          # 기본 [] : 데스크톱 앱은 Origin을 보내지 않는다(20 §3.8.5)
     아니면 403
  if listener == tailnet: tailscaleIngress(req) (§3.6) 실패 → 401
  업그레이드 요청이면: Authorization: Bearer 가 없으면 401 (19 P-03: 토큰은 헤더로만)
  인증 전 연결 수 한도(§3.14) 초과 → 429
  통과 → 101, 연결 상태 awaitingHello (19 §3.4.7). 토큰 판정은 hello에서(19 §3.4.3 5단계)
```

- 토큰 판정을 `hello`에서 하는 것은 19 P-03의 순서다. 업그레이드 단계에서 토큰 헤더가 **있는지**만 보고, 형식이 틀리면(접두사·길이) 401로 바로 끊는다. 해시 조회와 폐기 확인은 `hello`에서 한다.
- `localAdmin`은 `local` 리스너의 `hello`에서만 인정한다. 다른 리스너에서 `localAdmin`을 주장하면 19 `1008 auth.methodNotAllowed`, 감사 기록 `auth.denied { reason: "method_not_allowed" }`.

#### 3.4.4 19 `SecurityForProtocol` 구현 [제안]

19 §3.15가 요구한 인터페이스를 이 절의 규칙으로 채운다.

| 함수 | 구현 | 비고 |
|---|---|---|
| `checkTransport(req, listener)` | §3.4.3 `preflight` + `tailnet`이면 §3.6.1 `tailscaleIngress`. 실패: Host·Origin 403, 신원·헤더 없음 401, 한도 429 | 반환에 `tailnetNodeId`를 더해 달라고 19에 요구(노드 묶기, D18-02) |
| `verifyDevice(a)` | §3.6.1 `helloDeviceAuth`. 토큰 없음·형식 틀림·해시 불일치 1004, 모르는 기기 1006, 폐기·만료 1005(`details.reason`: `revoked` \| `expired_absolute` \| `expired_idle`), 기기 ID·노드·방식 불일치 1008(`details.reason`: `device_mismatch` \| `node_mismatch` \| `method_not_allowed`), 서명 nonce·시각 불일치 1007 | scope는 §3.5 표 |
| `redactEvent(e, conn)` | 09 `EVENT_META.sensitiveFields`(`tokenHash`, `newTokenHash`, `codeHash` 등)를 모든 연결의 사본에서 지우고 이름을 envelope `redactions`에 적는다(09 §3.2 규칙 10). 기기 주체도 예외 없음 | 원본 해시 계산은 저장본으로 |
| `proofRequired(listener)` | 1차 `false`. 기기별 `proofRequired`가 켜진 기기면 `true`(§3.8.5) | 모바일(§3.18) |

### 3.5 주체와 권한

```ts
// packages/daemon/src/auth/principal.ts
export type Principal =
  | { kind: "device"; deviceId: string; listener: "tailnet" | "loopback" | "local"; tailnetLogin?: string; tailnetNodeId?: string }
  | { kind: "localAdmin"; uid: number; pid?: number }      // pid는 알 수 있을 때만(감사용)
  | { kind: "observer"; runId: string }                   // 관찰 자식 IPC(16 §3.2.3). 리스너가 아니다
  | { kind: "runtime" };                                  // 데몬 내부(스케줄러, 런타임)
```

| 주체 | scope(19 §3.4.6) | 사람 결정(행위자 `human`) | 비고 |
|---|---|---|---|
| `device` | `read`, `decide`, `devices` | 예. 커널 제출에 `actor: { kind: "human", deviceId }` | 1인 앱이라 기기별로 줄이는 정책은 1차에 없다. 이후 "읽기 전용 기기"가 필요하면 `scopes`로 줄인다 |
| `localAdmin` | 위 + `admin` | 예. `actor: { kind: "human" }`, `via: "localAdmin"` | 서버 셸의 소유자 |
| `observer` | 없음(IPC 전용 메서드) | 아니요. 행위자 `agent:observer` 고정(16 §3.2.3 규칙 3) | 제안만 |
| `runtime` | - | 아니요 | 모델이 낸 것은 모두 `agent:<role>` 행위자로 커널에 제안 |

규칙:
1. 사람 결정 명령은 `device`나 `localAdmin` 연결에서 온 것만 행위자 `human`이 된다. 행위자는 서버가 연결에서 채운다. 클라이언트가 보낸 행위자 값은 받지 않는다(19 §3.7.5와 같다).
2. 모델 도구 경로(런타임)에는 사람 결정 명령이 없다(결정 14, 19 §2.1).
3. 모든 사람 결정 이벤트는 출처 `{ principalKind, deviceId?, listener, connectionId }`를 담는다(감사, §3.13).
4. 08 `Via`의 `local_cli`(10의 `human_client` 채널) 인정 조건: (a) 연결이 `local` 리스너(`rpc.sock`)로 들어왔고, (b) 소켓 디렉터리 0700·소켓 0600·소유자 = 데몬 uid가 시작 때 확인되었고(아니면 데몬이 뜨지 않는다), (c) `hello.auth.method = "localAdmin"`이다. `uid`에는 데몬 자신의 uid를 적는다(Node가 피어 uid를 주지 않으므로 파일 권한이 근거다, 08 §3.3.2). 도구 샌드박스가 이 소켓을 가리는 것이 전제다(R-3). 격리가 없는 S0 운영에서는 이 전제가 깨지므로 상태 `sandbox` critical과 화면 경고로 알린다(06 §3.7.4 4번에 대한 답).
5. `pairing.code_created`, `device.revoked`의 사람 행위자는 `local_cli` 또는 `active` 기기, `device.paired`는 같은 트랜잭션의 코드 소비(행위자 `runtime`) 또는 SSH 발급(`local_cli`)이다(08 R-45와 같다).

### 3.6 인증

#### 3.6.1 `tailnet` 리스너: 신원 헤더 + whois + 기기 토큰 [결정 26 + 세부 제안]

```text
tailscaleIngress(req):                                     # 업그레이드 전(§3.4.3)
  login = req.headers["tailscale-user-login"]              # A18-1
  xff   = 마지막 hop의 X-Forwarded-For 값                   # A18-2. 여러 값이면 serve가 붙인 마지막 것
  if !login or !xff:                      → deny("ingress_headers_missing")
  if req.headers 에 funnel 표식(Tailscale-Funnel-Request 등) 있음 → deny("funnel")     # [지식] openclaw ingress-attribution.ts:166-174
  if lower(login) ∉ cfg.auth.tailscale.allowedLogins   → deny("login_not_allowed")      # 기본: 설치 때 whois로 얻은 소유자 로그인 하나
  w = whois(xff)                                          # 캐시: 성공 60초, 실패 5초
  if w.error:                             → deny("whois_unavailable")                   # fail closed. SSH 경로는 영향 없음
  if w.node.tags 비어 있지 않음:            → deny("tagged_node")                         # 소유자 기기는 태그 없음, 서버·CI·VPS는 태그
  if lower(w.userProfile.loginName) != lower(login) → deny("whois_mismatch")
  req.ingress = { login, nodeId: w.node.stableId, nodeName: w.node.name, ip: xff }

helloDeviceAuth(conn, auth):                              # hello 판정(19 §3.4.3 5단계가 부름)
  tok = conn.bearer                                       # 업그레이드 때 보관
  if !matchesFormat(tok)                  → 1004
  rec = devices.byTokenHash(sha256(tok))                  # 현재 해시 또는 회전 유예 중인 이전 해시
  if !rec                                 → 1006 (알 수 없는 기기) 또는 1004
  if !constantTimeEqual(rec.matchedHash, sha256(tok)) → 1004
  if rec.revokedAt                        → 1005
  if rec.expiresAt <= now or rec.idleExpiresAt <= now  → 1005 (사유 expired)
  if rec.deviceId != auth.deviceId        → 1008
  if conn.listener == tailnet:
     if cfg.auth.bindTailnetNode and rec.tailnetNodeId and rec.tailnetNodeId != conn.ingress.nodeId → 1008 (사유 node_mismatch)
     if !rec.tailnetNodeId: 이번 nodeId로 묶고 device.bound_to_node 기록      # SSH 발급 기기가 처음 WSS로 붙을 때
  if proofRequired: verifyProof(...)      (§3.8.5, 1차 꺼짐)
  rec.lastSeenAt, lastSeenListener, lastSeenIp 갱신(쓰기는 1분에 한 번으로 묶음)
  principal = device
```

- whois 호출: 17이 쓰는 홈랩 래퍼와 같은 방식으로 `/mnt/c/Program Files/Tailscale/tailscale.exe whois --json <ip>`를 자식 프로세스로 부른다(`TAILSCALE_EXE`로 경로 변경). 5초 제한. 동시에 같은 IP로 여러 번 부르지 않는다(진행 중 호출 공유). 결과 중 `UserProfile.LoginName`, `Node.StableID`, `Node.Name`, `Node.Tags`만 쓴다 [실험 15].
- `allowedLogins` 기본값: 설치 때 `helm doctor`가 소유자 기기 IP 하나로 whois를 불러 로그인 이름을 설정 파일에 적도록 안내한다. 로그인 이름은 비밀이 아니지만 로그에는 마스킹해 쓴다(17 §3.12).
- whois 실패 시 fail closed가 기본이다(`auth.tailscale.whoisFailure = "deny"`). WSL interop이 고장 나면 원격 WSS 접속이 막히고 SSH 경로로 대신한다. `"token-only"`로 바꿀 수 있지만(설정, 감사 기록 `auth.policy_relaxed`) 권하지 않는다.

#### 3.6.2 `loopback` 리스너(SSH 경로): SSH 키 + 기기 토큰 [제안]

- 전송: 앱이 시스템 OpenSSH로 `ssh -W 127.0.0.1:7841 server`(20 APP-D03, 19 P-02). sshd는 키 인증만 받고 tailnet에서만 열린다 [실험 18].
- 인증: `hello`의 기기 토큰(§3.6.1의 `helloDeviceAuth`에서 노드 묶기 제외). 토큰 없는 연결은 `hello` 전에 끊는다.
- 왜 SSH 키만으로 충분하다고 보지 않나: (1) `loopback` 포트는 sshd 말고도 같은 호스트의 모든 프로세스(Windows 포함)가 연다. SSH를 거쳤다는 사실을 데몬이 확인할 길이 없다. (2) 기기별 폐기·감사·이름이 필요하다. (3) 두 경로의 인증 로직이 같아야 앱이 단순하다(20 APP-D04).
- 정직한 한계: SSH 키를 가진 자는 서버 셸을 얻으므로 `local` 리스너(로컬 관리자)로 무엇이든 할 수 있다. SSH 경로에서 토큰을 요구하는 것은 SSH 키 도난에 대한 방어가 아니라 기기 식별과 경로 일관성을 위한 것이다. SSH 키 도난 대응은 사용자의 `authorized_keys` 관리다.
- SSH 경로의 클라이언트 요구(20): `BatchMode=yes`, `StrictHostKeyChecking=yes`(기본), 사용자 known_hosts, 처음 접속 때 `helm doctor`가 출력한 호스트 키 지문과 대조(17 §3.11.5), 포워딩·에이전트 전달 끔(`-W`가 `ClearAllForwardings`를 포함 [원문 `man ssh`]), `ForwardAgent=no`.

#### 3.6.3 `local` 리스너: 파일 권한 [제안]

- 소켓 `/run/user/<uid>/helm/rpc.sock`, 디렉터리 0700, 소켓 0600(17 §3.5). 연결할 수 있으면 같은 uid(또는 root)다.
- Node는 `SO_PEERCRED`를 제공하지 않는다 [지식]. 파일 권한이 유일한 근거다. 시작 때 디렉터리·소켓 권한을 확인하고 다르면 시작을 거부한다(17 종료 코드 2).
- `localAdmin` 연결의 명령도 감사 기록에 남긴다(`via: "localAdmin"`).

#### 3.6.4 비교: 다른 방식을 고르지 않은 이유

| 방식 | 기각 이유 |
|---|---|
| Tailscale 헤더만으로 인증(토큰 없음, openclaw의 tokenless Control UI) | 같은 호스트의 프로세스가 헤더를 위조할 수 있다(127.0.0.1에서 온 연결은 serve와 구별되지 않는다). openclaw도 기기 신원을 대신하지 않는다 |
| SSH 키만으로 인증(SSH 경로 토큰 없음) | §3.6.2 |
| 127.0.0.1에서 오면 신뢰(loopback 자동 승인) | serve와 sshd가 넘긴 원격 연결도 127.0.0.1에서 온다(사례 §12.2-8) |
| Unix 소켓 하나로 모든 경로(SSH `-L`로 소켓 포워딩) | 클라이언트 쪽에 루프백 포트가 열린다(Mac·Windows의 다른 프로세스가 연다). 대상 소켓을 로컬 관리자 소켓과 같게 두면 그 포트가 토큰 없는 관리자 통로가 된다. 쓰더라도 대상은 로컬 관리자를 받지 않는 별도 소켓이어야 한다(ADR-18-2) |
| mTLS(클라이언트 인증서) | tailscale serve가 TLS를 끝내므로 뒤쪽에서 클라이언트 인증서를 볼 수 없다 |
| OIDC(Pocket ID) | 홈랩에 있으나(8443) 데스크톱 앱·SSH 경로·무인 재접속에 맞지 않고, 의존이 하나 늘어난다. 1인 기기 토큰으로 충분하다 |

#### 3.6.5 사례와 대조 (사례 §11.3)

| 사례 | 로컬 | 원격 | 기기 식별 | 토큰 저장 | Helm이 가져온 것 / 다르게 한 것 |
|---|---|---|---|---|---|
| openclaw | token/password + Ed25519 기기 서명 | serve + 헤더 whois 대조, SSH | Ed25519 키 | 평문(SQLite 0600) | serve 전용 리스너, whois 대조, 헤더가 토큰을 대신하지 않음을 가져옴. 서명은 1차에 두지 않음(D18-07). 평문 저장 대신 해시 |
| happy-agent | Unix 소켓 0600 + 토큰 파일 0600(회전 안 함) | Tailcat, E2E relay | 없음 | 평문 파일 | Unix 소켓 0600을 로컬 관리자 근거로 씀. 토큰 파일을 서버 디스크에 두지 않음 |
| paseo | 비밀번호(bcrypt) | E2E relay, SSH 터널, Tailscale IP 직접 바인딩 | relay 임시 키 | bcrypt 해시 | Host 허용 목록을 가져옴. IP 직접 바인딩은 쓰지 않음 |
| pi-web | 없음(소켓 권한) | VPN·SSH 권장 | 없음 | 0600 파일 | 인증 없음은 쓰지 않음 |
| pi-fabric | 파일 접근 | 없음 | 없음 | SHA-256 해시 | 해시 저장을 가져옴 |

### 3.7 기기 페어링

#### 3.7.1 흐름 [제안]

| 흐름 | 시작하는 곳 | 신뢰 근거 | 쓰는 메서드·경로 |
|---|---|---|---|
| A. 코드 | 서버 셸(`helm pair`) 또는 이미 페어링된 기기(`device.createPairingCode`) | 코드를 만든 쪽이 이미 인증되어 있다 | 새 기기가 `POST /pair`(`tailnet` 리스너만, 19 §3.7.7) |
| B. SSH 발급 | 새 기기의 앱이 `ssh server helm device issue …`(20 `pairing_via_ssh`) | SSH 키로 서버 셸에 들어왔다(= 로컬 관리자) | `admin.issueDevice`(로컬 관리자, 19 §3.7.8) |

승인 대기 소켓(openclaw 방식: 미승인 기기가 연결을 열어 두고 서버 쪽 승인을 기다림)은 두지 않는다. 두 흐름 모두 신뢰 근거가 이미 있는 쪽에서 시작하므로 대기 상태가 필요 없다.

#### 3.7.2 페어링 코드 규칙

```ts
export interface PairingCodeRecord {
  codeId: string;              // `pc_<ULID>` (08에 접두사 요구)
  codeHash: string;            // sha256(정규화한 코드). 코드 원문은 저장하지 않는다
  createdBy: { kind: "localAdmin" } | { kind: "device"; deviceId: string };
  intendedName?: string;
  createdAt: number; expiresAt: number;   // 기본 10분, 최대 60분(19 ttlSec 상한 3,600)
  attemptsLeft: number;        // 5
  consumedAt?: number; consumedByDeviceId?: string;
}
```

- 코드: 무작위 60비트를 Crockford base32 12자로, 표시 `XXXX-XXXX-XXXX`. 19 예시(`K7Q-4XM-92P`, 9자 45비트)보다 길게 한다. 시도 5회·10분 제한이 있어도, 코드가 화면·클립보드·QR로 옮겨 다니는 동안 노출을 고려해 추측 여유를 크게 둔다 [제안]. 19에 형식 변경을 요구한다(§5.2).
- 정규화: 대문자, `-`·공백 제거, Crockford 혼동 문자(`O→0`, `I/L→1`) 치환.
- 한 번만 쓴다. 틀린 시도마다 `attemptsLeft--`, 0이면 무효. 출처별 분당 5회(19 §3.7.7)와 별개로 코드별 한도.
- 동시에 유효한 코드는 3개까지. 넘으면 가장 오래된 것을 무효로 한다.
- `POST /pair`는 `tailnet` 리스너에서만 받고 §3.6.1의 `tailscaleIngress`를 통과해야 한다(신원 헤더·whois). 그래서 코드가 새도 tailnet 밖이나 다른 Tailscale 계정에서는 쓸 수 없다.
- 성공: 기기 레코드 생성, 토큰 발급(§3.8.1), 이번 요청의 whois `Node.StableID`로 노드 묶기, 응답에 토큰을 한 번만 싣는다. 응답에는 `Cache-Control: no-store`.
- 기록: `pairing.code_created { codeId, createdBy, expiresAt }`, `pairing.code_consumed { codeId, deviceId }`, `pairing.code_failed { codeId?, reason, sourceIp }`(묶어서, §3.13.2), `device.paired { deviceId, name, platform, clientKind, via: "code" | "ssh", tailnetNodeId?, tokenId }`.

#### 3.7.3 SSH 발급 규칙

- `helm device issue --name <이름> --platform <p> --client <k> --json`은 로컬 관리자로 `admin.issueDevice`를 부르고 `HELM-DEVICE/1 {json}` 한 줄을 표준 출력에 쓴다(20 §3.8.7). 토큰은 이 출력에만 한 번 나온다.
- SSH 세션의 출처를 기록한다: CLI가 `SSH_CONNECTION` 환경 변수의 첫 필드(클라이언트 IP)를 `admin.issueDevice`의 진단 필드로 넘기고, 데몬이 그 IP로 whois를 불러 `tailnetNodeId`를 미리 묶는다(실패하면 묶지 않고 첫 WSS 접속 때 묶는다, §3.6.1). CLI가 보낸 값은 같은 uid가 만든 값이므로 감사 정보이지 보안 근거가 아니다.
- 설정 `auth.sshIssue.enabled`(기본 true). 끄면 흐름 A만 남는다.

#### 3.7.4 페어링 상태 기계(코드)

| 상태 \ 사건 | 올바른 코드로 `POST /pair` | 틀린 코드 | 만료 시각 | 생성자가 취소 | 새 코드로 개수 초과 |
|---|---|---|---|---|---|
| `active` | → `consumed`(기기 생성) | `attemptsLeft--`, 0이면 → `exhausted` | → `expired` | → `cancelled` | 가장 오래된 것 → `cancelled` |
| `consumed`·`expired`·`exhausted`·`cancelled` | 1009(코드 무효, 사유 구분 없이 같은 응답) | 같음 | - | - | - |

응답은 사유를 구분하지 않는다(코드 존재 여부를 알려 주지 않기 위해). 감사 기록에는 사유를 남긴다.

### 3.8 토큰 형식·수명·회전·폐기

#### 3.8.1 형식

- 토큰 = `helm_dt_` + base64url(32바이트 `crypto.randomBytes`). 접두사로 비밀 탐지기·마스킹기가 찾을 수 있다(§3.10.4).
- `tokenId` = sha256(토큰) 16진수 앞 12자. 로그·감사·화면에 쓰는 식별자. 토큰 원문은 어디에도 기록하지 않는다.
- 서버 저장: `tokenHash = sha256(토큰)` 64자 16진수. 조회는 해시 색인, 비교는 `crypto.timingSafeEqual`(D18-06).

#### 3.8.2 수명 [제안]

| 항목 | 값 | 이유 |
|---|---|---|
| 절대 수명 | 365일 | 1년에 한 번 다시 페어링. 잊힌 기기의 토큰이 영원히 남지 않게 |
| 유휴 만료 | 90일 동안 한 번도 인증하지 않으면 만료 | 쓰지 않는 기기를 정리 |
| 만료 30일 전 | `daemon.status.warnings`와 기기 목록에 "곧 만료" 표시 | 사용자가 미리 다시 페어링 |
| 페어링 코드 | 10분(최대 60분), 1회 | §3.7.2 |
| 다운로드 티켓(19 P-13) | 5분, 발급한 연결에 묶임, 1회 | URL에 들어가므로 짧게 |

#### 3.8.3 회전 [제안]

- 1차: 자동 회전을 하지 않는다(20 §3.8.7: 데스크톱 1차는 회전하지 않음. happy-agent도 같다, 사례 §12.1-7). 대신 절대 수명 365일과 유휴 만료로 묶는다.
- 2차(20이 `credential_rotate`를 구현하면): HTTP `POST /devices/self/rotate`(현재 토큰 헤더로 인증, `tailnet`·`loopback` 리스너). 서버는 새 토큰을 발급하고 이전 해시를 `prevTokenHash`로 옮겨 **5분 또는 새 토큰의 첫 사용 중 먼저 오는 때까지** 함께 받는다(키체인 쓰기 전에 앱이 죽는 경우 대비). 응답은 `no-store`. 기록 `device.token_rotated { deviceId, oldTokenId, newTokenId }`. 19 `device.rotateToken`(JSON-RPC 결과로 토큰을 돌려줌)은 데스크톱에서 쓰지 않는다(웹뷰를 거치므로, 20). TUI·CLI는 토큰을 쓰지 않으므로 이 메서드가 필요 없다. 19에 `device.rotateToken`을 HTTP 경로로 바꾸도록 요구한다(§5.2).
- 강제 회전: `helm device expire-tokens <dv_id>`는 그 기기의 `expiresAt`을 지금으로 바꾼다. 1차에서는 다시 페어링하게 된다.

#### 3.8.4 폐기

- 누가: 로컬 관리자(`helm device revoke`), 다른 기기 또는 자기 자신(`device.revoke`, scope `devices`).
- 즉시 효과: 같은 트랜잭션에서 `revokedAt` 기록 → 데몬이 그 기기의 열린 연결을 모두 닫는다(19 §3.4.7: `connection.closing{kind:"auth.revoked"}` 후 4009) → 그 기기에 발급된 다운로드 티켓 무효 → 그 기기가 만든 유효 페어링 코드 무효.
- 기록: `device.revoked { deviceId, by: principal, reason }`.
- 폐기 목록은 DB에 있고, 복구 때 병합한다(§3.16).
- 도난 대응 절차(runbook): (1) 다른 기기 또는 서버 셸에서 `helm device revoke <dv_id> --reason stolen` (2) Tailscale 관리 콘솔에서 그 기기 제거(홈랩) (3) 그 기기의 SSH 키를 서버 `~/.ssh/authorized_keys`에서 지움 (4) `helm audit --device <dv_id> --since <마지막 정상 사용>`으로 그 사이 결정 확인 (5) 의심되는 사람 결정에 이의를 건다(결정 8, 11).

#### 3.8.5 기기 키 서명(1차 꺼짐) [제안]

- 형식은 19 §3.4.3 `DeviceProof`(Ed25519, `"helm-hello/1\n" + serverId + "\n" + nonce + "\n" + deviceId + "\n" + signedAt`). 서버 시각 ±120초, nonce는 그 연결의 `hello.challenge` 값과 같아야 하고 한 번만 쓴다.
- 페어링 때 앱이 공개 키를 보내면(`POST /pair`의 `device.publicKey`) 저장하고, `proofRequired`는 기기 단위로 켠다(`device.proofRequired`). 전역 기본은 false.
- 켜는 조건(미결 Q18-02): 모바일 클라이언트(이후 단계)가 생기거나, 키체인 토큰을 하드웨어 보호 키(Secure Enclave·TPM)로 대신할 수 있게 될 때. 지금 데스크톱 키체인의 일반 비밀 항목은 같은 사용자 프로세스가 꺼낼 수 있어 토큰과 개인 키가 함께 새므로 이득이 작다.

### 3.9 토큰과 자격 저장

| 위치 | 저장하는 것 | 저장하지 않는 것 | 보호 |
|---|---|---|---|
| 서버 DB | 기기 레코드(`deviceId`, 이름, 플랫폼, 경로, `tokenHash`, `prevTokenHash`+유효 시각, `tailnetNodeId`, `tailnetLogin`, 생성·마지막 사용·만료·폐기 시각, `publicKey?`) | 토큰 원문, 페어링 코드 원문 | 파일 0600, 디렉터리 0700, restic 암호화 |
| 서버 디스크 그 밖 | 없음(로컬 CLI·TUI는 토큰을 쓰지 않는다) | 토큰 파일 | - |
| 데스크톱 앱 | OS 키체인(macOS Keychain, Windows Credential Manager)에 토큰. 앱 설정 파일에 `deviceId`, `serverId` | 웹뷰 메모리·IndexedDB·로그·진단의 토큰 | 20 §3.2 `secrets.rs`, APP-D02 |
| 이벤트 로그 | `device.*` 이벤트에 `tokenId`, `tokenHash` | 토큰 원문 | `tokenHash` 필드는 19 재전송·투영·관찰 입력에서 지운다(§5.2 09·19 요구) |

- 이벤트에 `tokenHash`를 두는 이유: 결정 29(모든 상태는 로그에서 재구성 가능)를 지키기 위해서다. 해시는 토큰을 만들어 낼 수 없으므로 새도 인증에 쓸 수 없다. 그래도 클라이언트 재전송·화면 투영·관찰 입력·진단 묶음에는 넣지 않는다(필요 없는 곳에 두지 않는다).

### 3.10 비밀 저장·주입·마스킹

#### 3.10.1 비밀 목록과 위치

| 비밀 | 원본 | 실행 중 위치 | 누가 쓰나 |
|---|---|---|---|
| 모델 API 키(`ANTHROPIC_API_KEY` 등, 12 §3.3.4) | `~/projects/helm/secrets/prod.sops.yaml` | `helmd` 메모리 `SecretStore` | `@helm/ai`의 자격 저장소(12) |
| 정본 HMAC 키(`HELM_LEDGER_HMAC_KEY`) | 같은 SOPS 원본 | `helmd` 메모리 | `@helm/store` 체크포인트(09 D09-6, §3.10.5) |
| 기기 토큰 | (발급 시 생성) | 클라이언트 키체인 | 앱 Rust |
| 페어링 코드 | (생성) | 화면·QR·클립보드(짧게) | 사람 |
| 홈랩 비밀(restic 등) | 홈랩 SOPS | Helm은 쓰지 않는다 | 홈랩 |

- 서버에 Helm 전용 비밀 저장소를 만들지 않는다(브리프 §2.5). 데몬은 SOPS 원본에서 `secrets run`으로 받아 메모리에만 둔다(브리프 결정 45, 17 §3.8, ADR-17-3).
- Anthropic OAuth 토큰(`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`, 값에 `sk-ant-oat` 포함)은 데몬 비밀로 쓰지 않는다. `.env.example`에 두지 않고, 비밀 로더가 이 이름이나 이 형식의 값을 받으면 버리고 경고한다. pi-ai는 OAuth 토큰을 키로 쓰면 요청 앞에 다른 제품의 신원 문구를 붙인다(07 E24). 마스킹 패턴에 `sk-ant-oat`를 포함한다. 데몬은 SOPS 원본에서 `secrets run`으로 받아 메모리에만 둔다(17 §3.8, ADR-17-3).
- `SecretStore` 규칙: 값은 `Map<string, string>`에 두고 접근은 이름으로만. `toJSON`·`inspect`·로그 직렬화를 막는다(`[Symbol.for("nodejs.util.inspect.custom")]`이 `"[SecretStore n keys]"`를 돌려줌). 모든 값을 마스킹기에 등록한다.

#### 3.10.2 도구 프로세스에 비밀을 주지 않는다

- 도구 실행 환경은 허용 목록으로 만든다(§3.11.2 R-2). 데몬 `process.env`에는 애초에 비밀이 없다(17 §3.8).
- 사용자 작업이 비밀을 필요로 하면(예: 프로젝트 테스트가 API 키를 씀) 그 프로젝트의 관례(`just dotenv`로 만든 `.env`, `_with-secrets`)를 도구가 실행하는 명령 안에서 쓰게 되는데, 이것은 보호 경로·네트워크 규칙에 걸린다. 1차 기본: `.env*` 읽기와 `secrets run`·`sops` 실행은 needs-human(§3.11.6). 사람이 합의에 그 경로·명령을 넣으면 허용한다.

#### 3.10.3 로그·이벤트·투영에 비밀이 들어가지 않게 하는 지점

| 지점 | 무엇을 | 언제 |
|---|---|---|
| 도구 결과(13) | 표준 출력·오류, 구조화 결과의 문자열 | 정본에 쓰기 전, 휘발 스트림으로 보내기 전 |
| 모델 응답(12) | 어시스턴트 텍스트, 도구 인자 | 정본에 쓰기 전(모델이 비밀을 되풀이하는 경우) |
| 오류 메시지 | 공급자 오류 본문, 예외 메시지 | 로그·이벤트·클라이언트 오류 응답 전 |
| 운영 로그(17 §3.12) | 모든 줄 | 출력 전 |
| 진단 묶음(17 §3.11.6) | 전체 | 묶은 뒤 한 번 더 |
| 관찰 입력(16 §3.8) | 외부 세션 로그 | 정규화 단계 |
| 모델 컨텍스트 투영(12) | 도구 결과·파일 내용 | 투영 생성 때(정본에서 이미 지워졌어도 한 번 더) |

#### 3.10.4 마스킹기 [제안]

```ts
// packages/daemon/src/security/redactor.ts (16 §3.8의 규칙 목록과 같은 표를 공유한다: @helm/domain 또는 별도 @helm/security 모듈)
export interface RedactionHit { kind: string; count: number }
export interface Redactor {
  registerKnown(name: string, value: string): void;          // SecretStore 값, 길이 8 이상만
  redact(text: string): { text: string; hits: RedactionHit[] };
  redactDeep<T>(value: T): { value: T; hits: RedactionHit[] }; // 객체의 모든 문자열
}
```

규칙(순서대로 적용):

1. 알려진 값: 등록된 비밀 값과 그 base64·URL 인코딩 형태의 완전 일치 → `[REDACTED:known:<name>]`.
2. 접두사 패턴(16 §3.8.2 목록을 공통으로 쓴다. 최소): `helm_dt_[A-Za-z0-9_-]{43}`, `sk-ant-[A-Za-z0-9_-]{20,}`, `sk-(proj-)?[A-Za-z0-9_-]{20,}`, `AIza[0-9A-Za-z_-]{35}`, `ghp_[A-Za-z0-9]{36}`, `github_pat_[A-Za-z0-9_]{50,}`, `xox[abposr]-[A-Za-z0-9-]{10,}`, `AKIA[0-9A-Z]{16}`, `AGE-SECRET-KEY-1[0-9A-Z]{58}`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`…`-----END …-----`(여러 줄), `eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`(JWT) → `[REDACTED:<kind>:<sha256 앞 8자>]`. 해시 앞 8자를 남겨 같은 비밀이 여러 번 나왔는지만 알 수 있게 한다.
3. 키-값 문맥: `(api[_-]?key|secret|token|password|passwd|authorization)\s*[:=]\s*['"]?([^\s'"]{12,})` → 값 부분만 지움.
4. 엔트로피 검사는 16 §3.8.3(관찰 입력)에만 쓰고 도구 출력에는 쓰지 않는다(코드 해시·UUID를 지나치게 지운다).

- 지운 결과는 도구 결과의 `details.redactions`(13 §3.6.4)와 해당 이벤트 payload의 `maskedSecrets: RedactionHit[]`로 남긴다(무엇이 지워졌는지 사람이 알 수 있게, 값은 없음). envelope의 `redactions`(09 §3.2 규칙 10: 재전송 사본에서 지운 민감 필드 이름)와는 다른 것이다.
- 원문은 보관하지 않는다. 정본에는 지운 텍스트만 있다. 사람이 원문이 필요하면 원래 파일·명령을 다시 본다.

#### 3.10.5 정본 HMAC 키 [제안]

09 D09-6은 해시 체인에 1,000건마다와 정상 종료·백업 때 HMAC 체크포인트를 남기고, 키 관리 정책을 18에 맡겼다.

| 항목 | 규칙 |
|---|---|
| 이름·원본 | `HELM_LEDGER_HMAC_KEY`(09 §2.1), 제품 비밀 `~/projects/helm/secrets/prod.sops.yaml`. 저장소 `.env.example`에 `HELM_LEDGER_HMAC_KEY=`로 적는다. 개발 데몬은 `dev` 원본의 다른 값 |
| 만들기 | 사람이 한 번: 32바이트 무작위 base64(`openssl rand -base64 32`)를 `secrets edit prod`로 넣는다. 에이전트는 값을 만들거나 보지 않는다(SECRETS.md) |
| 필수 여부 | 17 `secrets.required`에 넣는다. 없으면 데몬이 시작하지 않는다(종료 코드 2). 체크포인트 없이 기록을 쌓으면 나중에 위조 검출 범위에 구멍이 생기기 때문이다 |
| 실행 중 | `SecretStore`에만. 도구 샌드박스·관찰 자식·로그에 없음(R-2, §3.10.3) |
| 키 식별 | 체크포인트에 `keyId = sha256(key) 앞 8자`를 함께 적는다(09) |
| 회전 | 키가 샜다고 의심될 때만. 새 값을 `HELM_LEDGER_HMAC_KEY`에, 이전 값을 `HELM_LEDGER_HMAC_KEY_<keyId>`에 둔다. 데몬은 `HELM_LEDGER_HMAC_KEY_*`를 모두 읽어 이전 체크포인트를 검증하고 새 체크포인트만 새 키로 만든다. 회전 때 `ledger.hmac_key_rotated { oldKeyId, newKeyId }` |
| 지키는 범위 | 같은 uid는 age 키로 원본을 복호화할 수 있으므로 같은 uid의 위조는 막지 못한다(T-H2). 이 키가 막는 것은 샌드박스 안 도구가 DB를 고치고 체인을 다시 계산하는 위조다(09 D09-6). 같은 uid 위조는 §3.13.3의 외부 기준점이 보완한다 |
| 백업·복구 | 키는 백업에 들어가지 않는다(SOPS 원본은 `~/projects`에 있어 restic이 따로 가져간다 [원문 homelab storage.md]). 복구한 DB의 체크포인트는 같은 키(또는 보관한 이전 키)로 검증한다 |

### 3.11 도구 실행 격리와 권한

수단과 도구별 정책은 13이 정한다. 이 절은 13이 지켜야 할 보안 요구와 권장 기본 구성이다.

#### 3.11.1 요구 [제안]

| ID | 요구 |
|---|---|
| R-1 | 모든 `execute` 원시 행동(bash, 테스트 실행 등)과 MCP stdio 서버, codemode가 부르는 실행 도구는 샌드박스 안에서 돈다 |
| R-2 | 환경 변수는 허용 목록만(조정자 판정 J-17: 목록은 18이 정한다. 07 `buildShellEnv`, 13 §3.6.4가 이 목록을 쓴다): `PATH`(도구 체인 경로만), `HOME`(샌드박스 홈, 13 §3.6.2), `USER`, `LANG=C.UTF-8`, `LC_ALL`, `TZ`, `TERM=dumb`, `NO_COLOR=1`, `CI=1`, `TMPDIR`, `HELM_RUN_ID`, `HELM_TOOL_CALL_ID`(비밀 아닌 상관 ID. `HELM_*` 중 이 둘만 허용), 합의가 명시한 이름. 합의로도 줄 수 없는 이름: 패턴 `*_TOKEN`, `*_KEY`, `*_SECRET`, `*_PASSWORD`, `*_API_KEY`, `SOPS_*`, `AWS_*`, `HELM_*`(위 둘 제외), `ANTHROPIC_*`, `OPENAI_*`, `GEMINI_*`, `OPENROUTER_*`, `SSH_AUTH_SOCK`, `WSL_INTEROP`, `WSL_DISTRO_NAME`, `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR`, `NODE_OPTIONS`. 관찰 자식(16 §3.2.1)의 허용 목록은 `PATH`, `HOME`, `TZ`, `NODE_ENV`, `HELM_OBSERVER_*`(비밀 아닌 실행 설정만) |
| R-3 | 숨기는 경로(접근 거부): §3.11.5의 보호 경로 전부, `/run/user/<uid>`(데몬 소켓과 사용자 버스), `/run/WSL`(interop), `/mnt`(Windows 드라이브) |
| R-4 | 쓰기 허용 경로: 합의 범위의 작업 공간과 실행별 임시 디렉터리만. 그 밖은 읽기 전용(`ProtectSystem=strict`, `ProtectHome=read-only` + `ReadWritePaths=<범위>`) |
| R-5 | 프로세스 분리: 도구는 데몬의 메모리·환경을 읽을 수 없어야 한다(필수). 일회성 단위의 `PrivateUsers=yes`로 다른 프로세스의 `/proc/<pid>/environ` 읽기가 거부된다 [실험, 아래]. 데몬에 신호를 보낼 수 없게 하는 것(PID 네임스페이스)은 권장이다. `PrivateUsers`만으로는 같은 uid 프로세스에 신호를 보낼 수 있고 `ProtectProc=invisible`도 같은 uid 프로세스를 숨기지 않는다 [실험]. 남는 위험은 도구가 `helmd`를 죽이는 것(서비스 거부)이고, 재시작·복구·크래시 루프 차단이 받는다 |
| R-6 | 네트워크: 기본 없음(`PrivateNetwork=yes`). 합의가 `network`를 명시한 실행만 호스트 네트워크를 쓴다. 이때 루프백의 다른 서비스에 접근할 수 있다는 경고를 합의 화면에 보인다(T-M5) |
| R-7 | 자원: 17 §3.13의 단위별 한도, 시간 제한, 출력 상한(13) |
| R-8 | 권한 상승 금지: `NoNewPrivileges=yes`. `sudo`는 실행되지 않는다(no_new_privs로 setuid 무효 [지식]) |
| R-9 | codemode·하위 호출 안에서 부른 도구도 같은 검사(13의 `runToolCall` 경로)와 같은 격리를 탄다(발췌1 E1-187) |
| R-10 | 1·2순위 수단(§3.11.2)을 모두 쓸 수 없으면 `execute`를 끈다. 상태 `sandbox` critical. 운영자 설정 `tools.sandbox="off"`로만 S0을 허용하고, 그때마다 `tools.sandbox_disabled` 감사 기록과 상태 경고(17 §3.11.2). 합의의 `allowUnscopedExecute`(13)는 S0을 여는 조건이 아니다 |
| R-11 | 도구 프로세스가 끝나면 그 단위의 모든 프로세스를 끝낸다(백그라운드로 남지 않음). 장기 프로세스(개발 서버)는 13이 별도 수명 규칙을 정한다 |
| R-12 | 데몬 안에서 도는 파일 도구(read/write/edit/grep/find/ls)는 샌드박스를 타지 않으므로 Helm 래퍼가 보호 경로 검사(§3.11.5)를 realpath 기준으로 한다(심볼릭 링크로 범위를 벗어나는 것 방지, facts-1 §0-5) |

#### 3.11.2 격리 수단의 순서 [제안]

| 순서 | 수단 | 언제 | R-5(PID 분리) |
|---|---|---|---|
| 1 | 13 §3.6.2의 bubblewrap S1(`--unshare-all`, `--die-with-parent`, `--new-session`, `--clearenv`, 최소 읽기 루트). 자원 한도는 `systemd-run --user --scope --slice=helm-tools.slice`로 감싼다(13) | `bwrap` 0.9 이상이 있을 때. 지금은 설치되어 있지 않다 [실험 7]. 사람이 `sudo apt install bubblewrap`(17 `helm doctor` 안내) | 됨 |
| 2 | 아래 `systemd-run --user` 일회성 단위 | bubblewrap이 없을 때. 이 서버에서 바로 된다 [실험 10·22] | 환경 읽기는 막힘, 신호는 가능(아래) |
| - | 13 S0(격리 없음) | `execute`에는 쓰지 않는다. 운영자가 `tools.sandbox="off"`로 명시했을 때만(감사 `tools.sandbox_disabled`, 상태 critical) | 안 됨 |

S0을 합의 플래그(13의 `allowUnscopedExecute`)만으로 허용하지 않는 이유: S0의 bash는 `rpc.sock`에 붙어 로컬 관리자로 사람 결정을 보낼 수 있다. 그 결정은 합의 범위 밖(다른 Concern의 결과 확인 등)까지 미친다. 합의에서 사람이 승인한 범위를 넘으므로 합의 한 건의 동의로 열 수 없다.

2순위 구성(단위 하나 기동 비용 약 70 ms):

```sh
systemd-run --user --quiet --pipe --wait --collect \
  --unit="helm-tool-${TC_ID}" --slice=helm-tools.slice \
  --property=PartOf=helmd.service \
  --property=PrivateUsers=yes \
  --property=ProtectSystem=strict --property=ProtectHome=read-only \
  --property=ReadWritePaths="${WORKSPACE_RW} ${RUN_TMP}" \
  --property=InaccessiblePaths="/srv/volumes /run/user/$(id -u) /run/WSL /mnt ${PROTECTED_PATHS}" \
  --property=PrivateTmp=yes \
  --property=PrivateNetwork=yes \
  --property=NoNewPrivileges=yes --property=RestrictSUIDSGID=yes \
  --property=MemoryMax=2G --property=TasksMax=256 --property=RuntimeMaxSec="${TIMEOUT}" \
  --property=OOMScoreAdjust=500 --nice=5 \
  --working-directory="${CWD}" \
  -- /usr/bin/env -i PATH="${SAFE_PATH}" HOME="${HOME}" LANG=C.UTF-8 TERM=dumb TMPDIR=/tmp \
     /bin/bash --noprofile --norc -c "${COMMAND}"
```

- `--pipe`는 표준 입출력을 `systemd-run` 프로세스(데몬의 자식)로 잇는다. 데몬은 그 출력을 읽어 잘림·마스킹을 적용한다.
- 일회성 단위는 user manager의 환경(`DBUS_SESSION_BUS_ADDRESS`, `SSH_AUTH_SOCK`, `XDG_RUNTIME_DIR` 등)을 물려받는다 [실험: 단위 안 `env`에 이 이름들이 보였다]. 그래서 명령을 `/usr/bin/env -i PATH=… HOME=… LANG=C.UTF-8 TERM=dumb TMPDIR=/tmp`로 감싼다. 감싸면 `PATH PWD`만 남는다 [실험]. 위 예시의 `--setenv`는 이 `env -i` 인자로 옮긴다.
- 같은 단위 안에서 확인한 것 [실험, 2026-10-11]: `PrivateUsers=yes`일 때 사용자 manager 프로세스의 `/proc/<pid>/environ` 읽기 거부, `kill -0 <pid>` 성공(신호 가능), `ProtectProc=invisible`을 걸어도 `/proc`의 프로세스 수가 바깥과 같음(같은 uid는 숨겨지지 않음), `InaccessiblePaths=/run/user/1000` 접근 거부.
- 신호까지 막으려면 PID 네임스페이스가 필요하다. systemd `PrivatePIDs=`는 257 이상이고 이 서버는 255다 [지식, 실험 3]. 그러므로 2단계로 bwrap `--unshare-pid`를 더한다(§7 Q18-03).
- 이 명령의 조립·인자 이스케이프·결과 처리는 13이 소유한다.

대안: bubblewrap(`sudo apt install bubblewrap`, 사람). `--unshare-all --share-net(허용 시) --die-with-parent --new-session --ro-bind / / --bind <ws> <ws> --tmpfs /srv/volumes --tmpfs /run/user/<uid> --tmpfs /run/WSL --tmpfs /mnt --proc /proc --dev /dev --clearenv`. `--new-session`이 TIOCSTI 주입을 막고 `--unshare-pid`가 PID 분리를 확실히 한다. 단, cgroup 한도는 따로 걸어야 한다.

#### 3.11.3 관찰 자식의 격리

16 OB-1의 자식은 모델 API 키가 없고(OB-3) DB를 읽기 전용으로 연다(OB-2). 17 §3.1.3의 격리 실행(`PrivateNetwork=yes`, 쓰기 경로 `/srv/volumes/helm/observer`만)을 켜면 외부 세션 로그 속 주입 문장이 관찰 프로세스를 통해 네트워크로 나가는 길도 막힌다. 켜는 시점은 17 Q17-02.

#### 3.11.4 격리 상태 확인

데몬 시작 때와 1시간마다, 그리고 `helm doctor`가 격리 시험을 한다: 일회성 단위 안에서 (1) `/srv/volumes/helm` 목록 → 거부 (2) `/run/user/<uid>/helm/rpc.sock` 접근 → 거부 (3) `cmd.exe` 실행 → 실패 (4) `ip link`에 `lo`만 (5) `env`에 R-2 밖 변수 없음 (6) 작업 공간 쓰기 → 성공. 하나라도 기대와 다르면 R-10.

#### 3.11.5 보호 경로 [제안]

도구가 읽거나 쓰거나 실행 인자로 다루면 기본 거부하는 경로. 샌드박스에서는 숨기고(R-3), 데몬 안 파일 도구는 realpath 검사로 거부한다(R-12). 목록은 설정 `security.protectedPaths`로 더할 수 있고 줄일 수는 없다(줄이려면 합의의 경로별 허용, §3.11.6).

| 경로 | 이유 |
|---|---|
| `/srv/volumes/**` | Helm 정본·백업·홈랩 서비스 데이터 |
| `~/.config/sops/**`, `**/keys.txt` | age 키 |
| `~/.ssh/**` | SSH 개인 키, known_hosts |
| `~/.dotfiles/secrets/**`, `~/projects/*/secrets/**`, `~/projects/homelab/secrets/**` | SOPS 원본(암호문이지만 키와 함께 있으면 위험하고, 모델에 넣을 이유가 없다) |
| `**/.env`, `**/.env.*`(단 `.env.example` 제외) | 평문 비밀(SECRETS.md: `.env`는 평문 사본) |
| `~/.config/helm/**`, `~/.config/systemd/user/**` | 데몬 설정·단위(바뀌면 다음 재시작에 코드 실행) |
| `~/.claude/**`, `~/.codex/**`, `~/.pi/**` | 다른 에이전트의 자격·세션(관찰 입력은 관찰 자식이 읽기 전용으로만) |
| `~/.local/bin/**`, `~/.local/share/mise/**`(쓰기만 금지, 읽기·실행 허용) | PATH 변조 |
| `~/.bashrc`, `~/.zshrc`, `~/.profile`, `~/.zshenv`(쓰기 금지) | 셸 시작 파일 변조 |
| `~/.gitconfig`, `**/.git/hooks/**`(쓰기 금지) | 다음 git 실행 때 코드 실행 |
| `/mnt/**` | Windows 드라이브(interop과 같은 이유) |

#### 3.11.6 권한 레이어의 고정 기준선 [제안]

effect class를 쓰지 않는다(결정 2). 권한 레이어(13 §3.10 `PermissionLayer.classify`)는 아래 고정 규칙을 먼저 적용하고, 남은 행동에 13의 범위 검사와 합의를 적용한다. 결과 형식은 08 §3.18 `PermissionVerdict`(`decision: allow | deny | ask`, `rightsGate`, `rightsCategories`, `reversibility`, `mutating`, `reasonCode`)다. 권리 범주 이름은 11 `RightsCategory`를 쓴다. 이 표가 13 §3.10의 "1차 기본 규칙" 표를 대체한다(13 §5.2 요구).

| 행동 | decision | rightsGate / rightsCategories | reasonCode | 근거 |
|---|---|---|---|---|
| 보호 경로(§3.11.5) 쓰기 | `deny` | - | `protected_path.write` | 경계 C |
| 보호 경로 읽기(모델 컨텍스트로 가져옴) | `ask` | true / `disclose_data` | `protected_path.read` | 정보가 모델 공급자로 나간다(D18-09, 발췌4 d3) |
| `send` 원시 행동(메일, 메시지, 원격 push, 외부 API 쓰기, 패키지 배포) | 합의 없으면 `deny`(결정 15, 커널이 막음), 합의 있으면 `ask`(1차) | true / `speak_for_user`, 대상이 다른 사람이면 `affect_others`, 돈이 들면 `spend_money` | `send.requires_human` | 01 NFR-S-7, 발췌4 b1 |
| 네트워크가 있는 실행(13 `network: 'any'`) | 합의에 `net:` 부여가 있으면 `allow`, 없으면 `ask` | 부여가 없을 때 true / `disclose_data`. 명령에 `git push`, `npm publish`, `curl -X POST\|PUT\|DELETE`, `scp`, `rsync … :`, `ssh` 형태가 보이면 `speak_for_user`를 더한다(질문을 늘리는 쪽으로만 쓴다, 13 §3.10) | `network.ungranted` | T-M5. 작업 공간 내용이 밖으로 나갈 수 있다 |
| `sudo`, `su`, `pkexec`, `doas`, `systemctl`, `loginctl`, `crontab`, `at` | `deny` | - | `privilege_or_persistence` | 경계 밖 지속 효과 |
| `secrets run`, `sops -d`, `secrets edit`, `secrets dotenv` | `ask` | true / `disclose_data` | `secrets.access` | 비밀 노출 |
| Windows 실행 파일(`*.exe`, `/mnt/**`, `cmd.exe`, `powershell.exe`, `wsl.exe`) | `deny` | - | `windows_interop` | T-M2 |
| 결과가 불명한 외부 효과 호출의 해소(12 §3.7.4) | - | true / `irreversible_external` | - | 조정자 판정 J-05: 외부 효과가 있을 수 있으면 권리 게이트 |
| 그 밖 | 13 범위 검사와 합의 | - | - | - |

- `disclose_data`는 고정 권리 범주다(10 §5.2, 11 §5.2 요구에 대한 답). 정보가 Helm·작업 공간 밖으로 나가는 행동(보호 경로를 모델에 넣기, 허가 없는 네트워크, 비밀 접근)은 다이얼과 무관하게 권리 게이트다.
- 권한 레이어는 질문을 만들지 않고 판정만 돌려준다. 묻기는 11이 한다(발췌4 d1에 대한 답, 11 §5.2 요구 행).
- 이 규칙은 모드·다이얼로 끌 수 없다(불변조건과 같은 층). 사람이 합의에서 경로·명령·네트워크를 명시하면 그 합의 범위에서만 `allow`로 바뀐다(보호 경로 쓰기, 권한 상승, Windows 실행은 합의로도 바뀌지 않는다).
- `argsPreview`(13 §3.10, 11 §3.2): 사람에게 보이는 인자 미리보기는 마스킹기(§3.10.4)를 거친다. 보호 경로의 내용은 미리보기에 넣지 않고 경로만 보인다.

#### 3.11.7 허용 폴더(프로젝트 루트) 등록 [제안]

02 UC-11 8단계의 "허용 폴더 지정"은 도구 쓰기 범위의 바깥 경계를 넓히는 일이다(08 프로젝트 `rootPaths`, 06 설정 `projects.roots`).

1. 등록·변경은 사람 결정 명령으로만 한다(`human_client`, via `device`·`local_cli`). 모델 도구에는 이 명령이 없다(결정 14, 10 `authority_expansion` 권리 범주).
2. 경로는 `realpath`로 고정한 뒤 검사한다: 설정 `projects.roots`(기본 `~/projects`) 아래여야 하고, `/`, `~`, `~/projects` 자체, 보호 경로(§3.11.5)를 포함하거나 그 아래이면 거부한다. 심볼릭 링크로 바깥을 가리키면 거부한다.
3. 등록 이벤트에 등록한 기기와 경로를 남긴다(감사, §3.13).
4. 외부 세션 로그 관찰(16, 결정 35)도 이 허용 폴더를 cwd로 하는 세션만 읽는다(조정자 판정 J-08).

#### 3.11.8 데몬이 직접 하는 네트워크 요청(`web_fetch` 등) [제안]

`web_fetch`(15 §5.2 요구)처럼 샌드박스 밖 데몬 프로세스가 직접 하는 HTTP 요청은 루프백 서비스에 접근할 수 있다(홈랩 Caddy 관리 API 2019가 무인증 [실험], 17 H-5). 그래서 다음을 지킨다.

1. 주소 차단(SSRF 방지): 이름 해석 뒤의 IP가 `127.0.0.0/8`, `::1`, `0.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`(tailnet), `fd7a:115c:a1e0::/48`(tailnet), `fc00::/7`, `fe80::/10`이면 거부한다. 리디렉션마다 다시 검사한다. 이름 해석과 연결 사이에 주소가 바뀌지 않게 해석한 IP로 직접 연결한다.
2. 방법은 `GET`·`HEAD`만, 쿠키·인증 헤더를 보내지 않는다. 크기 상한 10 MiB, 시간 상한 30초.
3. 가져온 내용은 신뢰하지 않는 자료다(§3.12). 출처 URL과 함께 관찰로 기록하고 경계 표식으로 감싼다.
4. URL에 작업 공간 내용이 실려 나가는 것은 막을 수 없다. 모델이 만든 URL의 질의 문자열이 2 KiB를 넘거나 비밀 패턴(§3.10.4)과 맞으면 `ask`(`disclose_data`)로 바꾼다.

### 3.12 프롬프트 주입 대응 [제안]

원칙: 기록 속 문장은 데이터다. 데이터가 권한을 바꾸지 못하게 구조로 막는다.

| 입력 | 신뢰 등급 | 막는 방법 |
|---|---|---|
| 사람 입력(기기·로컬 관리자 연결) | 사람 | 사람 채널(§3.5) |
| 모델 출력 | 제안 | 커널 검증, 합의 범위, 도구 격리 |
| 도구 출력, 웹 내용, 파일 내용 | 신뢰 안 함 | 투영에서 출처 표시(12의 A11 투영 규칙), 지시로 다루지 않는다는 시스템 문구, 도구 격리 |
| 외부 세션 로그(관찰 입력) | 신뢰 안 함 | 16 §3.9(출처 등급, 지시문 의심 표시, 모델 입력 형태, 초안 lint) |
| 관찰 에이전트 제안 | 제안 | 사람 채택만, 파일을 바꾸는 제안은 새 Concern의 일반 작업 경로(16 OB-6), 자동 설치 금지(E1-076) |

추가 규칙:
1. 모델에게는 권한을 바꾸는 도구가 없다: 합의 확정, 결과 확인, 다이얼·정책 변경, 기기·페어링, 격리 설정은 사람 메서드만(19 §2.1 결정 14 행).
2. 투영에 들어가는 신뢰하지 않는 내용은 경계 표식으로 감싸고, 그 안의 "이전 지시를 무시하라" 류 문장을 16 §3.9.3과 같은 규칙으로 표시한다. 표시는 차단이 아니라 모델과 사람에게 보이는 표지다.
3. 사람에게 보이는 승인 화면(합의 카드 등)은 모델이 쓴 요약이 아니라 커널이 가진 구조화된 값(경로, 명령, 네트워크 여부)을 보인다. 요약은 보조로만(04·21에 요구).

추가 규칙(16 §5.2 요구):

4. 관찰 입력의 신뢰 등급과 마스킹은 16 §3.8·§3.9가 집행하고, 규칙 표는 §3.10.4와 한 곳을 쓴다(06이 위치를 정한다. 제안: `@helm/domain`의 I/O 없는 `security/masking-rules.ts`). 16의 규칙 목록(MK)과 18의 패턴이 다르면 합집합을 쓴다.
5. 복귀 점검의 기대 답(`/srv/volumes/helm/private/resumption-checks/`, 16 §3.24)은 0700/0600이고, 도구 샌드박스와 관찰 자식에게 보이지 않으며(R-3, 17 §3.1.3), 이벤트·뷰 응답·운영 로그·진단 묶음에 나오지 않는다(이벤트에는 해시만). 백업에는 들어간다(17 §3.2.2).
6. 관찰 캐시의 소금 파일(`observer/salt`, 16 §3.8.4)은 0600이다. 비밀이 아니라 마스킹 토큰의 일관성을 위한 값이므로 SOPS에 두지 않는다. 백업하지 않는다(지워지면 캐시를 다시 만든다).
7. 데몬이 클라이언트에 보내는 텍스트(모델 출력, 도구 출력, 외부 내용)는 클라이언트에서 신뢰하지 않는 자료로 그린다: 원시 HTML 금지, 링크 스킴은 `https:`와 `helm:`만, `file:`·`javascript:`·`data:` 금지, 이미지는 `helm-blob` 경로로만, 외부 링크는 전체 URL을 보이고 시스템 브라우저로 연다(20 §5.2 (7), 21에 요구).

### 3.13 감사 기록

#### 3.13.1 무엇을 남기나 [제안]

정본 이벤트로 남긴다(별도 감사 파일 없음, D18-10). 아래 이름은 09 §3.4 카탈로그와 같다.

| 이벤트 | 내용(값 없는 필드만) |
|---|---|
| `device.paired` | `deviceId`, 이름, 플랫폼, `via`, `tailnetNodeId?`, `tokenId`, `tokenHash`(재전송 제외 필드) |
| `device.bound_to_node` | `deviceId`, `tailnetNodeId` |
| `device.token_rotated` | `deviceId`, `oldTokenId`, `newTokenId`, `newTokenHash`(제외 필드) |
| `device.revoked` | `deviceId`, `by`, `reason` |
| `device.expired` | `deviceId`, `kind: "absolute" \| "idle"` |
| `device.connected` / `device.disconnected` | `deviceId`, `listener`, `connectionId`, 마스킹한 출처 IP. 같은 기기의 1분 안 재접속은 묶음 |
| `pairing.code_created` / `pairing.code_consumed` / `pairing.code_failed` / `pairing.code_expired` / `pairing.code_cancelled` | §3.7.2 |
| `device.renamed` | `deviceId`, 이전·새 이름 |
| `integrity.verified` / `integrity.recovered` / `ledger.hmac_key_rotated` | 09 §3.10 |
| `auth.denied` | 출처별 5분 묶음: `{ listener, source, reasons: Record<reason, count>, firstAt, lastAt }` |
| `auth.policy_relaxed` | whois 실패 허용, 격리 끔 등 보안 설정 완화 |
| `tools.sandbox_disabled` / `tools.sandbox_enabled` | 사유 |
| `permission.overridden` | 사람이 합의로 보호 경로·네트워크를 허용한 기록(합의 이벤트에 포함되면 별도 이벤트 없음) |
| `secrets.reloaded`, `config.reloaded`, `store.restored`, `daemon.mode_changed` | 17 |
| 사람 결정 이벤트 전부 | 출처 `{ principalKind, deviceId?, listener, connectionId }`(§3.5 규칙 3) |

- 사람 결정이 어느 기기에서 왔는지 언제든 볼 수 있다: `helm audit --device <dv_id>`, 화면은 04가 정한다.
- 감사 이벤트는 행위자 `runtime`이고 클라이언트 재전송에 포함된다(단 `tokenHash` 필드 제외).

#### 3.13.2 인증 실패 묶음

인증 실패마다 이벤트를 쓰면 공격 중에 로그가 부푼다. 출처(§3.4.1 표의 속도 한도 출처)별로 메모리에서 5분 동안 세고, 5분이 지나거나 출처가 차단될 때 `auth.denied` 하나로 쓴다. 데몬이 종료되면 남은 묶음을 쓴다(실패해도 무시).

#### 3.13.3 체인 재작성 감지

같은 uid는 DB를 고치고 해시 체인을 다시 계산할 수 있다(T-H2). 외부 기준점으로 감지한다.
- 백업 매니페스트(09 §3.14.1, 17 §3.9.2)마다 `(upToSeq, headHash)`와 HMAC 헤드 체크포인트가 있다. restic이 이 매니페스트의 이력을 오프사이트에 보관한다.
- `helm ops verify --anchors`(17 §3.9.5)와 매월 훈련이 현재 체인의 같은 seq 해시와 로컬 매니페스트 값을 비교한다. 다르면 `integrity_suspect`(읽기 전용 모드, 17 §3.4.1).
- 오프사이트 매니페스트와의 비교는 사람이 분기 훈련 때 한다(17 Q17-05).

### 3.14 속도·크기 한도 [제안]

19가 값을 정하고 hello `policy`로 알린다(19 §3.4.4·§3.4.5). 18은 보안상 넘지 말아야 할 상한을 정한다. 19 기본값은 모두 이 상한 안에 있다.

| 항목 | 19 기본값 | 18 상한 |
|---|---|---|
| 인증 전 메시지 크기 | 16 KiB | 64 KiB |
| 인증 전 시한 | 10초 | 15초 |
| 출처별 인증 전 연결 | 8 | 16 |
| 출처별 인증 실패 | 1분 5회 → 60초 차단 | 같은 출처 10분 20회면 10분 차단(18 추가) |
| 페어링 시도 | 코드당 5회, 출처별 분당 5회 | 같음 |
| `POST /pair` 본문 | - | 4 KiB |
| 인증 후 메시지 | 1 MiB 들어옴 / 4 MiB 나감 | 8 MiB |
| 연결당 응답 대기 요청 | 32 | 64 |
| 기기당 동시 연결 | - | 8(넘으면 가장 오래된 것을 닫음) |
| 전체 연결 | - | 64 |
| 송신 대기(느린 소비자) | 8 MiB | 32 MiB |
| 파일 하나 | 64 MiB | 256 MiB |
| 명령 속도(연결당) | - | 초당 20, 순간 100(토큰 버킷). 넘으면 19 `1011 rateLimited` |
| whois 호출 | 캐시 성공 60초·실패 5초 | 출처당 동시 1, 전체 초당 5 |

### 3.15 공급망 [제안]

| 대상 | 규칙 |
|---|---|
| pi 포크(`vendor/`) | 기준 태그 `v1.1.0`(커밋 `abe508e1`, npm 1.1.0과 같음, 브리프 결정 44, 07 §3.1). 가져온 파일마다 원 경로·커밋 기록, LICENSE 고지(facts-2 §1.2). 갱신은 07 §3.18.4 업그레이드 체크리스트로만 하고, 사람이 diff를 검토한 커밋으로만 들어온다. 포크 재동기화 후 export 표면 무결성 테스트(07 §3.19.1 I1, 사례 §12.1-10) |
| npm 의존 | 정확한 버전(`^` 없음), `pnpm-lock.yaml` 커밋, `pnpm install --frozen-lockfile`. pi 패키지끼리의 `^1.1.0` 범위는 `overrides`로 한 버전에 묶는다(facts-2 §13 공통) |
| 설치 스크립트 | pnpm의 빌드 스크립트 허용 목록(`onlyBuiltDependencies`)에 `better-sqlite3`(과 07이 정한 최소 목록)만. 서버 pnpm 11.21 [실험 7] |
| 실행 중 내려받기 | 금지. coding-agent `tools-manager`의 rg/fd 자동 내려받기를 제거하거나 `PI_OFFLINE=1`(facts-1 §0-7, 07). 데몬은 실행 중 npm·바이너리를 받지 않는다 |
| 운영 릴리스 | 커밋에서만 빌드, 작업 트리 변경이 있으면 거부, 매니페스트 파일 해시로 변조 확인(17 ADR-17-5) |
| 감사 | `just verify`에 `pnpm audit --prod --audit-level=high`를 경고로 넣는다(실패로 하지 않음. 네트워크가 필요하고 오탐이 있다). 23이 정한다 |
| 데스크톱 앱 | 자동 업데이트 없음(20 APP-D14). 설치 파일은 사람이 빌드·설치한다. 서명·공증은 범위 밖(결정 24) |
| 모델 공급자 | 공급자 SDK 대신 pi-ai를 쓴다(결정 27). 공급자 쪽 데이터 보관은 공급자 정책을 따른다(범위 밖) |

### 3.16 백업·복구의 보안 조건

- 백업 스냅샷은 정본 사본이므로 같은 보호를 받는다: 파일 0600, 디렉터리 0700, restic 저장소 암호화(홈랩).
- 스냅샷에는 모델 API 키가 없다(메모리에만 있음). 기기 토큰 해시와 페어링 코드 해시는 있다.
- 복구 때(17 §3.9.4):
  1. 현재 DB를 열 수 있으면 현재 DB의 폐기·만료 기기 목록과 해시를 복원본에 병합한다(폐기는 되살리지 않는다). 복원본에 없는 새 기기(스냅샷 뒤 페어링)는 사라지므로 다시 페어링한다.
  2. 현재 DB를 열 수 없으면 복원본의 모든 기기 토큰을 무효로 한다(`device.revoked { reason: "restore_without_revocation_list" }`). 모든 기기를 다시 페어링한다. 1인 기기 몇 개라 감당할 수 있다.
  3. 유효했던 페어링 코드는 모두 무효로 한다.
  4. `store.restored`에 위 처리 결과(`devicesMerged`, `devicesInvalidated`)를 남긴다.
- 진단 묶음(17 §3.11.6)과 경보 상태 파일에는 토큰 해시도 넣지 않는다.

### 3.18 모바일 클라이언트 [결정 42 / 세부 제안, 26과 맞출 것]

브리프 결정 42는 휴대폰에서 질문에 답할 수 있게 한다. 구현 방식과 알림 경로는 26(P15)이 정하고, 이 문서를 쓰는 시점에 26은 아직 없다. 아래는 26이 지켜야 할 보안 요구다.

#### 3.18.1 위협 추가

| ID | 공격자 / 경로 | 노리는 자산 | 대응 요구 |
|---|---|---|---|
| T-L2 | 휴대폰 분실·도난(노트북보다 잦다) | AS-TOK, AS-DEC | OS 보안 저장소의 토큰(아래), 앱 잠금, 원격 폐기, 노드 묶기 |
| T-L3 | 잠금 화면 알림, 어깨 너머 보기 | 질문 내용(AS-DB 일부) | 알림 본문 기본 숨김(조정자 판정 J-03), 앱 전환 화면 가림 |
| T-N3 | 푸시 공급자(APNs·FCM·ntfy 서버)가 보는 메타데이터 | 사용 시각, 질문 수 | 푸시 본문에 내용을 넣지 않는다. 공급자는 "언제 알림이 갔는가"만 안다 |
| T-W1 | 모바일을 PWA로 만들 때 웹 저장소의 토큰을 스크립트가 읽음 | AS-TOK | 아래 3.18.2 4번 |

#### 3.18.2 요구

1. **경로**: 휴대폰은 `tailnet` 리스너(WSS)로만 붙는다. 휴대폰에 Tailscale이 켜져 있어야 한다. SSH 경로(`loopback`)는 모바일에 두지 않는다. `tailnet` 리스너의 모든 조건(신원 헤더, whois, 기기 토큰, 노드 묶기)이 그대로 적용된다.
2. **페어링**: 흐름 A(코드)만 쓴다. 데스크톱 앱이나 서버의 `helm pair --qr`이 `helm://pair?v=1&url=…&code=…&sid=…` 링크를 QR로 보이고, 휴대폰 앱이 읽어 `POST /pair`를 부른다(§3.7.2 규칙 그대로: 10분, 1회, 5회 시도, tailnet 신원 확인). `ClientInfo.platform`에 `ios`·`android`를 더한다(19에 요구).
3. **토큰 저장**: iOS는 Keychain(`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, iCloud 키체인 동기화 금지), Android는 Keystore 기반 암호화 저장. 백업(iCloud·Google 백업)에 포함되지 않게 한다.
4. **PWA를 택하는 경우**: 웹 저장소(IndexedDB·localStorage)에 bearer 토큰을 두면 같은 출처의 스크립트가 읽는다. 26이 PWA를 고르면 토큰을 `HttpOnly; Secure; SameSite=Strict` 쿠키로 바꾸는 서버 쪽 변경과 CSRF 대책이 필요하다. 18의 권장은 네이티브 저장소를 쓸 수 있는 방식(Tauri v2 모바일 등)이다.
5. **scope**: 모바일 기기는 `read`, `decide`를 받고 `devices`는 "자기 자신 폐기"와 "다른 기기 폐기"만 허용한다. 휴대폰에서 새 기기의 페어링 코드를 만들지 않는다(`device.createPairingCode` 거부). 휴대폰을 잃었을 때 그 휴대폰으로 새 기기를 들여오는 경로를 막기 위해서다. 19의 기기별 scope로 표현한다.
6. **앱 잠금**: 앱을 열 때와 사람 결정 명령(`decide`)을 보내기 전에 OS 생체 인증 또는 기기 암호를 요구하는 설정을 둔다(기본 켬, 26). 앱 전환 화면에는 내용을 가린다.
7. **기기 키 서명**: 휴대폰은 하드웨어 보호 키(Secure Enclave, StrongBox)를 쓸 수 있어 개인 키를 꺼낼 수 없다. 그래서 모바일 기기는 `proofRequired`를 켜는 것을 권한다(§3.8.5, Q18-02의 조건 충족). Secure Enclave는 P-256만 지원하므로 19 `DeviceProof.alg`에 `es256`을 더해야 한다(19에 요구) [지식].
8. **분실 대응**: §3.8.4 절차에 "Tailscale 관리 콘솔에서 휴대폰 노드 제거"를 첫 단계로 둔다. 노드가 없어지면 토큰이 있어도 `tailnet` 리스너를 통과하지 못한다(노드 묶기).
9. **푸시 알림**:
   - 보내는 시점은 11의 전달 결정이 기록된 때뿐이다(19 §3.8.3). 푸시는 알림일 뿐이고 내용은 앱이 인증된 연결로 받는다.
   - 본문에는 질문 내용·Goal 이름을 넣지 않는다. 기본 문구는 "Helm에 확인할 것이 있습니다"와 불투명 ID 하나다(J-03). 설정으로 제목 노출을 켤 수 있다.
   - 푸시 경로 후보: (a) 홈랩 ntfy(홈랩 `NTFY_URL` 경보가 이미 쓰는 방식 [원문 homelab storage.md]) (b) APNs·FCM 직접(개발자 계정과 서명 키 필요) (c) 푸시 없음(앱이 열려 있을 때만). 어느 쪽이든 공급자 자격(ntfy 토큰, APNs 키)은 SOPS 제품 비밀로 두고 `SecretStore`로 받는다.
   - 기기 푸시 토큰은 보내기 위해 원문이 필요하다. 08 Device의 `push.tokenHash`만으로는 보낼 수 없으므로 원문은 이벤트가 아닌 운영 테이블(09 `device_presence`와 같은 종류)에 0600 DB 안에 두고, 이벤트에는 해시와 끝 4자만 둔다(08·09·26에 요구). 로그·진단에 넣지 않는다. 기기를 폐기하면 원문을 지운다.
   - 데몬의 바깥 연결은 모델 공급자와 푸시 공급자뿐이다. 둘 다 설정에 이름을 적은 호스트로만 나간다.
10. **오프라인 사본**: 휴대폰의 뷰 캐시는 OS 저장소 암호화에 맡기고(§3.19), 폐기(1005·4009)를 받으면 지운다.

### 3.19 클라이언트 기기의 데이터 [제안]

20 §5.2 (5)에 대한 답.

- 데스크톱·모바일 앱의 오프라인 뷰 사본(IndexedDB, 20 APP-D10)에는 도메인 내용이 들어 있고 토큰은 없다. 앱 차원 암호화는 1차에 하지 않고 OS 디스크 암호화(FileVault, BitLocker, 휴대폰 기본 암호화)에 맡긴다. `helm doctor`가 확인할 수 없으므로 앱 첫 실행 안내에 "디스크 암호화를 켜 두세요"를 넣는다(05·20).
- 설정으로 오프라인 사본을 끌 수 있다. 끄면 앱을 닫을 때 지운다.
- 폐기(1005, 연결 종료 4009)를 받으면 앱은 그 서버의 사본과 진행 중 명령함을 지운다.
- 진단 묶음(20 `diag_bundle`)에는 사본 내용을 넣지 않는다.

### 3.17 보안 테스트 목록

| ID | 조건 | 종류 |
|---|---|---|
| T18-01 | `tailnet`: 토큰 없음 → 401. 형식 틀린 토큰 → 401. 해시 없음 → 1004/1006. 폐기 → 1005. 다른 기기 ID → 1008. 만료(절대·유휴) → 1005 | 통합 |
| T18-02 | `tailnet`: 신원 헤더 없음·`X-Forwarded-For` 없음·허용 밖 로그인·whois 불일치·태그 노드·Funnel 표식 → 401, 각 사유로 `auth.denied` 묶음 1건 | 통합(가짜 whois) |
| T18-03 | whois 실패 → 401(fail closed). 설정 `token-only`면 통과하고 `auth.policy_relaxed` 기록 | 통합 |
| T18-04 | 노드 묶기: 기기 A 토큰을 다른 `StableID`의 whois 결과로 → 1008(node_mismatch). 묶이지 않은 기기는 첫 WSS 접속에서 묶임 | 통합 |
| T18-05 | (수동) 실제 serve 경유: 클라이언트가 위조 `Tailscale-User-Login`을 보내도 serve가 덮어쓰는지(A18-1), 태그 노드(서버 자신)에서 serve URL로 접속하면 헤더가 없는지 | 수동 |
| T18-06 | `loopback`: Tailscale 헤더를 붙여도 무시, 토큰 필수, `localAdmin` 주장 → 1008. Host가 `127.0.0.1:7841`·`localhost:7841`이 아니면 403 | 통합 |
| T18-07 | Origin이 있는 업그레이드(브라우저 흉내) → 403. Host가 `evil.example` → 403 (DNS rebinding). Origin 없는 네이티브 요청은 토큰으로 판정 | 통합 |
| T18-08 | 샌드박스: §3.11.4의 여섯 시험 + `env`가 허용 목록뿐(user manager 환경이 섞이지 않음) + `/proc/<helmd pid>/environ`·`/proc/<helmd pid>/mem` 읽기 거부(R-5). PID 네임스페이스를 쓰는 구성이면 `helmd` PID가 보이지 않음 | 시스템 |
| T18-09 | 샌드박스 안에서 `curl http://127.0.0.1:7840/healthz` → 실패(`PrivateNetwork`). 네트워크 허용 실행에서는 성공하지만 토큰 없이 `hello` 불가 | 시스템 |
| T18-10 | 샌드박스 안에서 `~/.config/sops/age/keys.txt`, `~/.ssh/id_*`, 작업 공간 밖 `.env` 읽기 → 실패. 데몬 파일 도구로 같은 경로 → `deny`/`needs-human`, 심볼릭 링크로 우회 → 거부 | 시스템 + 통합 |
| T18-11 | 격리 수단을 못 쓰는 환경(`systemd-run` 없음 흉내) → `execute` 도구가 목록에서 빠지고 상태 `sandbox` critical | 통합 |
| T18-12 | (수동) Windows PowerShell에서 WSL `rpc.sock`에 연결 시도 → 실패(A18-3). Windows에서 `127.0.0.1:7840`으로 토큰 없이 업그레이드 → 401 | 수동 |
| T18-13 | 마스킹: 알려진 키 값과 §3.10.4 패턴을 넣은 도구 출력 → 정본·휘발 스트림·로그·진단 묶음 어디에도 원문 없음, `redactions` 기록 | 통합 |
| T18-14 | `/proc/<helmd pid>/environ`에 모델 키 이름·값이 없음 | 시스템 |
| T18-15 | 페어링 코드: 12자 형식, 1회 사용, 5회 실패 후 무효, 만료, 동시 3개 상한, `tailnet` 밖 리스너에서 `POST /pair` → 404/405, 응답 `no-store`, 실패 응답이 사유를 구분하지 않음 | 통합 |
| T18-16 | SSH 발급: `helm device issue`가 로컬 관리자에서만 동작, 출력 한 줄 형식, `SSH_CONNECTION`으로 노드 미리 묶기 | 통합 |
| T18-17 | 폐기: 즉시 열린 연결 4009, 그 기기 티켓·코드 무효, 이후 재접속 1005 | 통합 |
| T18-18 | 토큰 해시: DB에 원문 없음(DB 파일 전체 grep), 이벤트 재전송·투영·관찰 입력에 `tokenHash` 없음 | 통합 |
| T18-19 | 사람 결정 위조: 런타임(모델 도구 경로)에서 사람 결정 명령 제출 → 커널 거부. 관찰 IPC에서 `actor: human` 보내도 `agent:observer`로 기록 | 통합(10·16과 함께) |
| T18-20 | 속도 한도: 출처별 인증 실패 6번째 → 1011, 10분 20회 → 10분 차단. 명령 버킷 초과 → 1011 | 통합 |
| T18-21 | 크기 한도: 인증 전 17 KiB → 1009, 인증 후 상한 초과 → 1009, `POST /pair` 5 KiB → 413 | 통합 |
| T18-22 | 복구 보안: 스냅샷 뒤 폐기한 기기가 복구 후에도 폐기 상태. 현재 DB를 못 열 때 모든 토큰 무효 | 통합(17 T17-20과 함께) |
| T18-23 | 체인 기준점: 같은 uid 흉내로 과거 이벤트 하나를 고치고 체인을 다시 계산 → `verify --anchors` 실패, 모드 `read_only` | 통합 |
| T18-24 | SIGUSR1을 `helmd`에 보내도 inspector 포트(9229)가 열리지 않음 | 시스템 |
| T18-25 | 공급망: `pnpm install --frozen-lockfile`이 허용 목록 밖 빌드 스크립트를 실행하지 않음, 실행 중 rg/fd 내려받기 시도 없음(네트워크 차단 상태에서 grep 도구 동작) | 통합 |
| T18-26 | 권한 기준선: §3.11.6 표의 각 행이 해당 판정을 돌려줌, 모드·다이얼로 바뀌지 않음 | 단위 |
| T18-27 | `web_fetch`: `127.0.0.1:2019`, `100.64.x.x`, 리디렉션으로 사설 주소 → 거부. 해석 뒤 IP 고정 | 통합 |
| T18-28 | 허용 폴더 등록: 모델 도구 경로에서 불가, `~`·`/`·보호 경로·심볼릭 링크 탈출 거부 | 통합 |
| T18-29 | 도구 환경: R-2 목록 밖 이름(합의로 `ANTHROPIC_API_KEY` 부여 시도 포함)이 샌드박스 `env`에 없음, `HELM_RUN_ID`·`HELM_TOOL_CALL_ID`만 있음 | 시스템 |
| T18-30 | 비밀 로더가 `ANTHROPIC_OAUTH_TOKEN`·`sk-ant-oat` 값을 받으면 버리고 경고 | 단위 |
| T18-31 | 모바일 기기 scope: `device.createPairingCode` 거부, 다른 기기 폐기 허용. 푸시 본문에 질문 내용 없음, 푸시 토큰 원문이 이벤트·로그에 없음 | 통합(26 이후) |
| T18-32 | 클라이언트 렌더링: 모델 출력의 `<script>`, `javascript:` 링크, `file:` 링크가 그려지지 않음(21 시험과 함께) | 통합(앱) |
| T18-33 | 복귀 점검 기대 답 파일이 샌드박스·관찰 자식에서 보이지 않고 이벤트·뷰·로그·진단 묶음에 없음 | 시스템 |

## 4. 실패·예외·경계 사례

| ID | 상황 | 처리 |
|---|---|---|
| S-01 | 시계가 크게 틀어져 토큰 만료 판정이 흔들림 | 만료는 서버 시계 기준. NTP 미동기(17 `clock`)면 만료 판정을 하루 늦춘다(일찍 만료해 소유자를 막지 않음). 서명(꺼짐)은 ±120초 |
| S-02 | Tailscale 로그인 이름이 바뀜(계정 이전) | `allowedLogins` 불일치로 WSS 막힘. SSH 경로로 들어가 설정을 고친다 |
| S-03 | 기기의 Tailscale 노드가 다시 등록되어 `StableID`가 바뀜 | node_mismatch로 막힘. `helm device rebind <dv_id>`(로컬 관리자)로 다음 접속 때 다시 묶거나, 다시 페어링 |
| S-04 | 앱이 키체인 쓰기 전에 죽어 새 토큰을 잃음(2차 회전) | 이전 토큰이 5분 동안 유효. 지나면 다시 페어링 |
| S-05 | 같은 기기 이름으로 두 번 페어링 | 다른 `deviceId`. 목록에 둘 다 보이고 오래된 것을 폐기하라고 안내 |
| S-06 | 모든 기기를 폐기해 원격 접속 수단이 없음 | 서버 셸(SSH 키)에서 흐름 B 또는 `helm pair`로 다시 |
| S-07 | SSH 키까지 잃음 | 서버 PC 앞에서(물리) 또는 Windows sshd 2222(홈랩 비상 경로)로 WSL에 들어간다. Helm 범위 밖 |
| S-08 | whois가 느림(1초 이상) | 캐시 60초. 첫 업그레이드만 느리다. 5초 넘으면 실패(fail closed) |
| S-09 | 격리 단위 생성 실패(user manager 과부하) | 그 도구 호출은 오류, 다른 수단으로 몰래 낮춰 실행하지 않는다 |
| S-10 | 합의가 네트워크를 허용한 실행이 루프백 서비스에 접근 | 막지 않는다(R-6). 합의 화면 경고, 감사의 합의 기록 |
| S-11 | 마스킹이 정상 내용을 지움(오탐) | `maskedSecrets`로 표시되므로 사람이 원래 파일을 본다. 규칙 표는 16과 공유해 고친다 |
| S-12 | 관찰 입력에서 새 형식의 비밀이 지워지지 않음 | 관찰 자식이 비밀을 모델에 보낼 수 있다. 16의 엔트로피 검사가 보완. 발견하면 규칙 추가 |
| S-13 | 사용자가 `tools.sandbox="off"`로 바꿈 | 허용하되 시작마다 경고, 감사 기록, 상태 critical 유지 |
| S-14 | 페어링 코드가 채팅·스크린샷으로 샘 | tailnet 신원 조건이 있어 소유자 tailnet 밖에서는 쓸 수 없고 10분 만료. 의심되면 `helm pair --cancel-all` |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 받는 문서 | 제공 |
|---|---|
| 01 | NFR-S-1(기기별 출처 기록, §3.5 규칙 3), S-2(리스너, §3.4), S-3(페어링·즉시 폐기, §3.7·§3.8.4), S-4(비밀, §3.10), S-5(격리와 보장 수준, §3.11), S-6(신뢰하지 않는 자료, §3.12), S-7(`send` 권리 게이트, §3.11.6), S-8(사람 채널, §3.5), S-9(앱 최소 API는 19·20) |
| 02 | UC-04 두 경로의 인증(§3.6), UC-11 페어링·폐기·허용 폴더(§3.7, §3.8.4, §3.11.7), UC-08 로그 신뢰·마스킹(T-P2, §3.10.4) |
| 04, 05, 21 | 기기 화면 데이터: 이름, 플랫폼, 클라이언트 종류, 페어링 경로(`code`·`ssh`), 페어링 시각, 마지막 사용 시각·경로, 절대 만료 예정(30일 전 "곧 만료"), 상태(`active`·`expired`·`revoked`), 폐기 버튼(사유 선택 입력). 연결 진단 문장의 원인 코드(19 1004~1008의 `details.reason`), 합의 카드의 네트워크·보호 경로 경고(§3.11.6), 감사 보기(기기별 사람 결정, §3.13), 렌더링 규칙(§3.12 7번) |
| 06 | 06 §3.7.4 4번의 답(격리가 없으면 `execute`를 끔, S0은 운영자만, §3.11.1 R-10), 기기 토큰 해시 저장(§3.9), 비밀처럼 보이는 설정 키 거부 목록(`token`, `secret`, `password`, `apiKey`, `privateKey`, 17 §3.3.1) |
| 07 | 셸 환경 허용 목록 R-2(07 `buildShellEnv`), OAuth 토큰 배제(§3.10.1), 공급망 규칙(§3.15) |
| 08 | Device·PairingCode 필드(§3.9), `local_cli` 인정 조건(§3.5 규칙 4) |
| 09 | HMAC 키 정책(§3.10.5), 데이터 디렉터리 권한 감사(17 §3.2.2·§3.11.2 `permissions`), 감사 이벤트 목록(§3.13.1), 민감 필드 |
| 10, 11 | 권리 범주 판정 규칙과 `disclose_data` 고정(§3.11.6), 인자 미리보기 가림, 사람 채널 조건(§3.5) |
| 12 | `SecretStore`, 모델 출력·오류 마스킹 지점(§3.10.3), 투영의 신뢰 등급 표시(§3.12) |
| 13 | 격리 요구 R-1~R-12, 격리 순서(§3.11.2), 보호 경로(§3.11.5), 권한 기준선(§3.11.6, 13 §3.10 표 대체), 마스킹기(§3.10.4) |
| 15 | 가져온 문서·웹·세션 로그의 신뢰 규칙(§3.12), `web_fetch` 정책(§3.11.8), 자극·작업 공간의 비밀 가림(§3.10.3, 보호 경로) |
| 16 | 외부 세션 로그 위협 모델(T-P2), 마스킹 규칙 공유, `sendExternalExcerpts` 판단, 점검 키 파일 보호(§3.12 5번), 관찰 자식 환경 허용 목록(R-2) |
| 19 | `SecurityForProtocol` 구현(§3.4.4), 리스너별 Host·Origin(§3.4.3), 페어링 정책(§3.7), 토큰 수명(§3.8), 한도 상한(§3.14), 모바일 scope(§3.18.2 5번) |
| 20 | 키체인 저장 요구, SSH 클라이언트 옵션(§3.6.2), SSH 발급 권한 규칙(§3.7.3: SSH로 서버 계정에 들어올 수 있으면 기기를 발급할 수 있다), Origin 없는 네이티브 요청은 토큰으로 판정하고 브라우저 Origin은 거부(§3.4.3), 서명 보류(§3.8.5), 오프라인 사본(§3.19) |
| 26 | 모바일 보안 요구(§3.18) |
| 22 | §3.17 보안 테스트 |

### 5.2 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 08 | (1) 모바일 푸시 토큰 원문은 레코드·이벤트가 아니라 운영 테이블에 둔다(Device의 `push`는 해시·끝 4자만 유지, §3.18.2 9번). (2) 허용 폴더 등록 명령의 권리 범주 `authority_expansion` |
| 09 | (1) 푸시 토큰 원문용 운영 테이블(기기 폐기 때 삭제). (2) `maskedSecrets`(payload의 마스킹 기록)와 envelope `redactions`(재전송 사본에서 지운 필드 이름)를 구분해 카탈로그에 적는다 |
| 10 | 허용 폴더 등록·변경을 사람 전용 명령으로(§3.11.7) |
| 12 | 키를 `SecretStore`에서 읽는다(브리프 결정 45). 모델 출력·공급자 오류를 마스킹기로 지운 뒤 정본·로그에 쓴다. OAuth 토큰을 자격으로 쓰지 않는다 |
| 13 | (1) §3.6.2의 데몬 포트 7801을 7840·7841로. (2) §3.10 1차 규칙 표를 18 §3.11.6으로 대체한다고 적는다. (3) 환경 허용 목록은 18 R-2를 참조(J-17). (4) `web_fetch`가 13의 도구이면 §3.11.8을 따른다 |
| 15 | `web_fetch` 정책(§3.11.8). 자극·문서를 모델에 넣을 때 마스킹기 적용 |
| 16 | 마스킹 규칙 표를 18 §3.10.4와 한 곳에서(합집합). 프로젝트별 `sendExternalExcerpts` 끄기 |
| 19 | (1) `checkTransport` 반환에 `tailnetNodeId`(§3.4.4). (2) `DeviceProof.alg`에 `es256`(모바일 Secure Enclave, §3.18.2 7번). (3) 모바일 기기 scope: `devices` 중 `device.createPairingCode` 제외(§3.18.2 5번). (4) 1004~1008의 `details.reason` 값(§3.4.4). (5) `device.expireTokens`, `device.rebind` |
| 20 | (1) `ForwardAgent=no`, `StrictHostKeyChecking=yes` 기본, 첫 접속 지문 대조 안내. (2) 키체인 항목 이름에 `serverId`. (3) 폐기(1005·4009)를 받으면 그 서버의 오프라인 사본과 진행 중 명령함 삭제(§3.19). (4) 첫 실행 안내에 디스크 암호화 권장 |
| 21 | 렌더링 규칙(§3.12 7번), "격리 없음"(S0)·S1b 경고 배지 |
| 26 | §3.18 전체. 특히 토큰 저장소, 앱 잠금, 푸시 본문 숨김과 경로 선택, PWA를 택할 경우의 쿠키 전환 |
| 07 | 실행 중 내려받기 제거, `vendor/` 고지, 빌드 스크립트 허용 목록, OAuth 변수 미사용 |
| 홈랩 | 17 §3.7.4 H-5(Caddy 관리 API 정리) |

## 6. 구현 단위와 완료 기준

| 위치 | 내용 |
|---|---|
| `packages/daemon/src/auth/{principal,preflight,tailscale-ingress,whois,device-auth,pairing,tokens,rate-limit}.ts` | §3.4~§3.8, §3.14 |
| `packages/daemon/src/security/{redactor,secret-store,protected-paths,permission-baseline,audit-batcher,anchors}.ts` | §3.10, §3.11.5~6, §3.13 |
| `packages/tools/src/sandbox/systemd-run.ts`(13 소유, 18 요구 반영) | §3.11.2 |
| `apps/cli/src/commands/{pair,device-issue,devices,audit}.ts` | §3.7, §3.8.4, §3.13 |

완료 기준: §3.17의 통합·단위·시스템 테스트가 `just verify`와 `just daemon-systest`에서 통과하고, 수동 테스트 T18-05·T18-12를 한 번 수행해 결과(A18-1·A18-3)를 이 문서에 반영한다. 특히 T18-08~T18-11(격리)이 실패하면 `execute` 도구를 켜지 않는다.

## 7. 미결 사항

| ID | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| Q18-01 | 토큰 수명 값 | 절대 365일·유휴 90일 / 무기한 / 30일 회전 | 365일·90일, 1차 회전 없음 |
| Q18-02 | 기기 키 서명 켜기 | 1차부터 / 모바일 단계부터 / 하드웨어 키가 생기면 | 하드웨어 보호 키를 쓸 수 있을 때(§3.8.5) |
| Q18-03 | 도구 격리 수단 | bubblewrap(13 S1) / `systemd-run --user` / 둘 다 | 13 S1(bubblewrap)을 기본으로 하고 설치 전에는 `systemd-run --user`. 첫 설치 전에 `sudo apt install bubblewrap`을 사람에게 요청한다 |
| Q18-04 | 네트워크 허용 실행의 루프백 차단 | 막지 않음 / `pasta --no-map-gw`(설치 필요) / 사용자 단위 BPF(권한 문제로 불가 [지식]) | 1차 막지 않음 + 경고. 홈랩 2019 정리(H-5) |
| Q18-05 | whois 실패 시 | 거부 / 토큰만으로 허용 | 거부(SSH 경로가 대체) |
| Q18-06 | `send` 원시 행동을 합의가 있어도 매번 사람에게 물을지 | 매번 / 합의에 대상·내용 범위가 있으면 허용 | 1차 매번(사용 후 11·14와 조정) |
| Q18-07 | `localAdmin` 명령의 사람 결정을 `human`으로 인정할지(서버 셸의 다른 에이전트가 CLI를 부를 수 있음) | 인정 / 사람 결정은 기기만 / 로컬 확인 프롬프트(TTY 있을 때만) | 인정(D18-04). TUI가 사람 경로이기 때문. CLI의 결정 명령은 TTY가 없으면 거부하는 선택지를 23에서 검토 |
| Q18-08 | 페어링 코드를 이미 페어링된 기기가 만들 수 있게 할지(19 `device.createPairingCode`) | 허용 / 로컬 관리자만 | 허용(19 원안). 감사 기록 |
| Q18-09 | 모바일 푸시 경로 | 홈랩 ntfy / APNs·FCM 직접 / 푸시 없음 | 26이 정한다. 18의 권장은 홈랩 ntfy(이미 홈랩 경보에 쓰는 방식, 새 계정·키 불필요). 본문 숨김은 어느 경우든 기본 |
| Q18-10 | 모바일 클라이언트 형태가 PWA일 때 토큰 저장 | HttpOnly 쿠키 전환 / 네이티브(Tauri 모바일)만 허용 | 네이티브. PWA면 쿠키 전환과 CSRF 설계를 26·19가 함께 |
| Q18-11 | 오프라인 뷰 사본 암호화 | OS 디스크 암호화에 맡김 / 앱 키로 암호화 | OS에 맡김(§3.19) |

## 8. 출처

- 브리프: `docs/design/process/00-design-brief.md` 결정 2, 14, 15, 21, 22, 24, 26, 27, 29, 35, 38, §2.5.
- 0단계 원천: `sources/pi-cases-notes.md` §1-5, §3.4, §6.4, §11.3, §12.1-7, §12.2-7~9; `sources/pi-api-facts-1.md` §0-5, §0-7; `sources/pi-api-facts-2.md` §1.2, §3.1, §4.1~4.3, §13; `sources/conversation-extracts-1.md` E1-060, E1-063, E1-076, E1-077, E1-187, (d) Q7; `sources/conversation-extracts-4.md` (b) b1, (d) d1, d3.
- 사례 메모: `.helm-design-work/S4/openclaw-gateway.md` §1.3, §2.2~2.6, §4; `paseo.md` §4; `pi-web.md` §4.
- 다른 설계 문서(1단계 초안): `06-system-architecture.md` §2, `12-runtime-engine.md` §3.3.4, §3.7, `16-observer-and-metrics.md` §2.2, §3.2, §3.8~3.9, `19-client-protocol.md` §2.3, §3.2~3.4, §3.7.7~3.7.8, `20-desktop-app-architecture.md` §2.3, §3.2, §3.8.
- v0.3: `docs/v0.3/12-implementation-architecture.md` §10(권한 레이어 인터페이스), `docs/v0.3/audit/backend-oss-research.md` §5.
- 홈랩·dotfiles(읽기 전용): `~/projects/homelab/context/{network,machines,decisions,storage}.md`, `tailscale/policy.hujson`, `~/.dotfiles/docs/SECRETS.md`.
- 이 서버 확인: 17 §2.2, `.helm-design-work/P11/notes.md`.

## ADR 후보

### ADR-18-1 원격 인증은 기기 토큰을 필수로 하고 Tailscale 신원은 추가 조건으로만 쓴다

- 상태: 제안
- 맥락: 결정 26은 Tailscale 신원 헤더 + 기기 토큰을 정했다. 데몬은 127.0.0.1에 있고 mirrored 모드라 같은 호스트의 Windows·WSL 프로세스가 같은 포트를 연다 [실험 6]. serve가 넘긴 연결과 로컬 프로세스의 연결은 TCP 수준에서 구별되지 않는다.
- 결정: `tailnet` 리스너는 (1) 신원 헤더, (2) `X-Forwarded-For`의 whois 결과와 로그인 일치·태그 없음, (3) 기기 토큰, (4) 토큰의 tailnet 노드 묶기를 모두 요구한다. 헤더·whois만으로는 통과시키지 않는다. 서버는 토큰 SHA-256만 저장한다.
- 근거: 헤더는 로컬에서 위조할 수 있다. 토큰은 서버 디스크에 없으므로 로컬 프로세스가 얻을 수 없다. 노드 묶기는 토큰이 클라이언트에서 새도 다른 기기에서 쓰기 어렵게 한다. openclaw도 헤더가 기기 신원을 대신하지 않게 한다(사례 §12.1-7).
- 기각한 대안: 헤더만(위조 가능), 토큰만(결정 26의 두 겹 중 하나를 버림, 노드 묶기 불가), mTLS(serve가 TLS를 끝냄), OIDC(앱·SSH·무인 재접속에 맞지 않음).
- 결과: whois가 WSL interop에 의존한다. 고장 나면 WSS가 막히고 SSH 경로로 대신한다.

### ADR-18-2 SSH 경로는 `ssh -W`로 별도 `loopback` 리스너에 붙고 기기 토큰을 요구한다

- 상태: 제안(19 ADR 19-A1·19-A2, 20 ADR-20-02·03과 함께 하나로 합친다)
- 맥락: 결정 38은 데스크톱 앱의 SSH 접속과 그 인증을 P11·P12·P13에 맡겼다. 후보는 `-L` 포트·소켓 포워딩, `-W` stdio, exec 브리지였다.
- 결정: 앱은 `ssh -W 127.0.0.1:7841 server`로 데몬의 `loopback` TCP 리스너에 붙고 그 위에서 WSS와 같은 HTTP + WebSocket을 쓴다. `loopback` 리스너는 기기 토큰만 받고 로컬 관리자를 받지 않으며 Tailscale 헤더를 보지 않는다. 기기 토큰은 SSH 키에 더해 요구한다.
- 근거: `tailnet` 리스너에 SSH 연결을 섞으면 헤더 없는 예외가 생긴다. `-W`는 클라이언트 쪽 포트를 열지 않는다. `loopback` 포트는 같은 호스트의 모든 프로세스가 열 수 있으므로 토큰이 필요하다. 토큰은 기기별 폐기·감사·이름을 준다. 두 경로의 앱 로직이 같다.
- 기각한 대안: `-L` 포트 포워딩(클라이언트 쪽 루프백 포트 노출), `-L` → 로컬 관리자 소켓(클라이언트 쪽 포트가 토큰 없는 관리자 통로가 됨), exec 브리지(셸 시작 잡음 처리 필요, 예비 경로로만 둠, 19 B4), SSH 키만으로 인증(loopback 포트는 SSH를 거쳤는지 확인할 수 없음).
- 결과: SSH 키 도난은 이 설계로 막지 못한다(셸이면 로컬 관리자). 사용자의 `authorized_keys` 관리가 그 방어다.

### ADR-18-3 1차에는 기기 키 서명을 요구하지 않는다

- 상태: 제안
- 맥락: openclaw는 모든 연결에 Ed25519 nonce 서명을 요구한다. 19는 형식(`DeviceProof`)을 예약했다.
- 결정: `proofRequired=false`. 공개 키를 받으면 저장만 하고 기기 단위로 나중에 켤 수 있게 둔다.
- 근거: 데스크톱 키체인의 일반 비밀 항목은 같은 사용자 프로세스가 꺼낼 수 있어서, 토큰과 개인 키가 같은 조건에서 함께 샌다. 노드 묶기(ADR-18-1)가 "다른 기기에서 쓰기"를 이미 어렵게 한다. 서명은 앱(Rust)과 데몬 양쪽 구현과 시계 의존을 더한다.
- 기각한 대안: 1차부터 서명 필수(이득에 비해 비용이 큼).
- 결과: 하드웨어 보호 키(Secure Enclave, TPM)나 모바일 클라이언트가 생기면 다시 판단한다(Q18-02).

### ADR-18-4 도구 실행은 bubblewrap, 없으면 user manager 일회성 단위로 격리하고, 둘 다 없으면 실행 도구를 끈다

- 상태: 제안(13이 수단을 확정)
- 맥락: 모델이 실행하는 bash는 데몬과 같은 uid로 돌면 Helm 소켓(사람 결정 위조), 데몬 환경(API 키), age 키·SSH 키, Windows interop에 접근할 수 있다. pi에는 권한 시스템이 없다(facts-1 §0-5). bwrap은 설치되어 있지 않다.
- 결정: 1순위 bubblewrap(13 S1), bubblewrap이 없으면 `systemd-run --user` 일회성 단위(`PrivateUsers`, `ProtectSystem=strict`, `ProtectHome=read-only`, `InaccessiblePaths`로 Helm 데이터·소켓·`/run/WSL`·보호 경로 숨김, `PrivateNetwork` 기본, `NoNewPrivileges`, `env -i`, 자원 한도). 둘 다 없으면 `execute` 원시 행동을 끈다. 격리 없음(S0)은 운영자 설정으로만.
- 근거: bubblewrap은 PID 네임스페이스까지 있어 가장 강하다(13 실험). `systemd-run` 단위는 추가 설치 없이 이 서버에서 동작하고 interop 차단·데이터 숨김·환경 읽기 거부를 확인했다 [실험 10·22]. 격리 없는 bash는 로컬 관리자 소켓으로 사람 결정을 위조할 수 있다.
- 기각한 대안: 격리 없이 범위 검사만(bash 우회, 발췌1 E1-060), 합의 플래그로 S0 허용(합의 범위를 넘는 권한), Docker 컨테이너(도구 체인·작업 공간 마운트가 무겁고 Docker 데몬 권한이 넓다), 별도 uid(sudo 필요, 작업 공간 소유권 문제).
- 결과: bubblewrap 설치를 사람에게 요청한다. 2순위 구성에서는 도구가 같은 uid 프로세스에 신호를 보낼 수 있다(서비스 거부). 네트워크를 허용한 실행은 루프백 서비스에 접근할 수 있다(Q18-04).
