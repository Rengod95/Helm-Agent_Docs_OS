---
id: eng.onboarding.guide
layer: eng
domain: onboarding
kind: guide
status: draft
depends_on: [eng.toolchain.guide, eng.testing.guide, xeon.routing]
binds: []
---

# 기여자 온보딩

## 1. 적용 범위

- Xeon 저장소에서 처음 코드를 고치는 사람과 에이전트가 첫날에 할 일을 순서대로 적습니다. 마일스톤 재점검 G3-05의 M2 부분입니다. 운영 런북, 용어집, 구현 상태 지도는 M3입니다(`review.m3-plan`).
- 규칙의 정본은 각 engineering 문서입니다. 이 문서는 순서와 연결만 둡니다.

## 2. 규칙

### ON-01 도구는 mise와 just로 받는다

- 필요한 것: `mise`, `just` 1.58 이상. `mise`가 `xeon/mise.toml`의 bun 1.4.3과 Rust 1.99.1을 설치합니다(`cd xeon && mise install`).
- `bun`을 직접 부르지 않습니다. mise 심이 전역 판을 몰라 실패합니다. 항상 `just <레시피>`로 부릅니다.
- 선택 도구와 쓰는 곳은 아래와 같습니다. 없으면 해당 시험이나 기능만 종료코드 2로 알리거나 건너뜁니다.

| 도구 | 쓰는 곳 | 없으면 |
|---|---|---|
| `sops` 3.13.3, `age` 1.3.2 | 비밀 기본 provider, `platform-secrets` 실제 시험(E7) | 실제 시험이 건너뛰어지고 `just exit-tests`가 실패 |
| `bubblewrap`, `socat`(Linux) | 샌드박스 `bash`(M1 종료 조건) | 셸 도구가 꺼짐, 샌드박스 int 시험 종료코드 2 |
| `rg` | 파일 검색(`@vscode/ripgrep`이 기본 제공) | 내장 바이너리 사용 |
| Tauri 시스템 패키지(Linux `libwebkit2gtk-4.1`) | `just desktop-*` | 종료코드 2 |
| `gitleaks`, `lefthook` | 커밋 전 훅 | 훅이 돌지 않음. `lefthook install`로 설치 |

- 외부 바이너리의 필수·선택 표와 첫 실행 점검의 정본은 `L0.os.spec`입니다(G2-07, PLT 트랙).

### ON-02 첫 실행은 setup과 verify다

```bash
just setup          # bun install --frozen-lockfile
just verify         # 검사 전부 + ws check (빠른 길: turbo 캐시, type-aware 없는 lint). 병합·push 전에 통과시킨다
just verify-full    # 캐시 없이 type-aware lint까지 전부. 마일스톤 마감과 CI만
```

- `just verify`는 기기에서 한 번에 하나만 돕니다(`WS_GUARD_SLOTS=1`). 단계를 차례로 돌고 단계마다 메모리 2G, 시험은 패키지마다 1.5G가 상한입니다. 슬롯이 차 있으면 기다립니다(`eng.toolchain.guide` §3.1). 작업 중에는 `just check <패키지>`만 돌리고 `just verify`는 마지막 병합 단계에서 돌립니다.
- 마지막 단계 `ws check`는 저장소 주인 기기의 dotfiles 도구입니다. `ws`가 없는 기기에서는 `verify`의 마지막 줄이 실패합니다. 이때는 `just _verify-steps`로 검사 단계만 돌리고, 작업 보고에 "ws check 미실행(환경)"을 적습니다. 코드를 고치지 않습니다(종료코드 2 규칙).
- CI(`.github/workflows/xeon-ci.yml`)는 `ws check`를 뺀 같은 단계를 돕니다.

### ON-03 시험은 패키지 하나씩 돌린다

```bash
just test packages/core-loop     # 패키지 하나
just test scripts                # xeon/scripts
just exit-tests                  # 종료 조건 시험, 건너뜀이 있으면 실패
```

- `just test`는 대상마다 `scripts/guard.sh run`의 메모리 상한(기본 1.5G)과 시간 상한(기본 300초) 아래에서 돕니다. 여러 시험, 빌드, cargo, 브라우저를 동시에 돌리지 않습니다. 작은 기기에서는 VM이 멈춥니다.
- 시험은 값을 비교합니다. 수정이 없으면 실패해야 합니다(`eng.testing.guide`).

### ON-04 읽을 문서는 라우팅으로 고른다

```bash
just docs-route --task implement packages/core-loop/src/turn.ts
just docs-route --task docs L1/loop
```

- 문서와 코드가 다르면 코드를 문서에 맞춥니다. 문서가 틀렸다고 보이면 고치지 말고 `[미결]`로 보고합니다(`xeon.routing`).
- 열린 결정과 미결은 `review.unresolved`, 남은 M2 일은 `review.m2-plan` §10, M3로 넘긴 일은 `review.m3-plan`에 있습니다.

### ON-05 커밋은 한 층, 문서는 같은 커밋

- 한 커밋은 한 층만 고칩니다(`eng.best-practices.guide` BP-11). 코드가 바꾼 계약과 동작은 같은 커밋에서 문서를 고칩니다(BP-10).
- `git add`는 경로를 지정합니다. 루트 레거시 파일(`package.json`, `apps/`, `experiments/`, `packages/helm-*`)은 더하지 않습니다.
- 검사가 실패하면 메시지대로 고칩니다. 검사를 끄거나 `--no-verify`로 넘기지 않습니다(TC-07).

### ON-06 종료코드를 읽는다

| 코드 | 할 일 |
|---|---|
| 1 | 고칩니다 |
| 2 | 환경 문제입니다. 코드를 고치지 않고 보고합니다 |
| 3 | 사람이 확인한 뒤 `--yes`로 다시 부릅니다(`just tape-record`, `just bench --first-token`) |

### ON-07 macOS 작업은 원격으로 한다

- macOS가 필요한 확인(Seatbelt, 키체인, WKWebView, IME)은 `ws on mac -- just <레시피>`나 수동 CI job `xeon-macos.yml`로 합니다. 목록은 `review.macos-checklist`입니다.

## 3. 강제 수단

- `just verify`와 CI가 ON-02, ON-03의 검사를 강제합니다.
- 리뷰: 커밋 단위(ON-05), 종료코드 처리(ON-06).

## 4. 예외와 미결 사항

- [미결] `xeon/README.md`와 `xeon/AGENTS.md`의 검사 명령 표를 이 문서에 맞출지. 두 파일은 Z 트랙 소유가 아니어서 이번에 고치지 않았습니다(open-issues D-14).
