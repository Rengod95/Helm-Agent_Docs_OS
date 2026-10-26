---
id: adr.0020
layer: adr
domain: client
kind: adr
status: accepted
depends_on: [adr.0006, adr.0008, adr.0010, architecture.layers.spec, eng.dependency-rules.guide, F.wire-settings.spec, L4.host-service.spec, L4.desktop.spec, L4.cli.spec, review.m3-design-inputs]
binds: [xeon/packages/client/**, xeon/packages/contracts/src/wire-settings/**, xeon/scripts/check-layers.ts, xeon/scripts/dependency-allowlist.json]
---

# ADR-0020 L4 공유 클라이언트 패키지 `packages/client`

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-26
- [결정] CLI와 데스크톱이 함께 쓰는 연결 코드와 클라이언트 로직을 새 패키지 `xeon/packages/client`(`@xeon/client`)로 옮긴다. 이 패키지는 F에만 의존한다. F는 순수 계약으로 남긴다(사용자 결정 2026-10-26, `review.m3-design-inputs` D-M3-26 b 변형).
- 이 ADR은 `L4.host-service.spec` §10 미결 5(데스크톱이 `@xeon/host/client`를 import할지)와 `L4.cli.spec`·`L4.settings-ui.spec`의 공유 코드 위치 미결(수집 U-41, U-56)을 닫는다.
- 새 패키지의 층 배치와 같은 층 예외는 `architecture.layers.spec` §3.2 허용 목록을 바꾸므로 ADR로 남긴다(`adr.readme` §4 승격 기준).

## 2. 맥락

- M2 F.8에서 `createHostConnection`(id 발급, 대기 요청 표, 취소)과 JSON Lines 프레이밍, stdio 전송 구현을 F `@xeon/contracts/wire`의 런타임 중립 구현으로 옮겼다(`L4.desktop.spec` §10 3번, `F.wire-settings.spec` §3.1). F에 타이머와 상태를 쓰는 런타임 로직이 생겼다. `F.readme` §1은 F에 실행 코드를 거의 두지 않는다고 적는다.
- 데스크톱 TS는 호스트 조립 코드를 import하면 안 된다. `apps/host`를 import하면 엔진 전체가 WebView 번들에 들어갈 위험이 있다. 그래서 같은 층 예외 `DR-10/cli-host`만 두었다(`architecture.layers.spec` §3.2).
- 설정 화면 view-model, 오류 문장화(ADR-0016), 승인 카드 상태처럼 CLI와 데스크톱이 같은 로직을 쓰는 곳이 늘었다.
- 검토한 안(D-M3-26): a `@xeon/host/client` 서브패스와 DR-10 예외, b 새 공유 패키지, c `createHostConnection`을 F에 둠. 사용자는 b를 고르고 F를 순수 계약으로 두는 변형을 정했다.

## 3. 결정

1. [결정] 새 패키지 `xeon/packages/client`, 이름 `@xeon/client`를 만든다. 층은 L4다. `package.json`은 `xeon.layer: "L4"`, `xeon.domain: "client"`다.
2. [결정] `@xeon/client`는 F(`@xeon/contracts`)와 외부 라이브러리만 import한다. X, L0~L3, `apps/*`를 import하지 않는다. 엔진 코드가 클라이언트 번들에 들어가지 않는다.
3. [결정] 담는 것:
   - 연결: `createHostConnection`, 전송 구현(JSON Lines 프레이밍, stdio, 소켓 전송의 클라이언트 쪽), 재연결과 리플레이 커서 처리
   - 설정 화면 view-model(`L4.settings-ui.spec`)
   - CLI와 데스크톱이 함께 쓰는 표시 로직: 오류·알림 문장화와 i18n 카탈로그(ADR-0016), 승인 카드 상태
4. [결정] F `@xeon/contracts/wire`에는 타입, 스키마, 메서드 표(`WIRE_METHODS`), 적합성 사례 데이터만 남긴다. M2 F.8에서 F로 옮긴 런타임 구현(`wire/client.ts`, `framing.ts`, `stdio.ts`의 구현부)은 `@xeon/client`로 옮긴다.
5. [결정] 같은 층 예외를 둘 더한다. `DR-10/cli-client`(`apps/cli` → `packages/client`), `DR-10/desktop-client`(`apps/desktop` → `packages/client`). `apps/host`는 서버 쪽이라 `@xeon/client`를 import하지 않는다. `DR-10/cli-host`는 in-process 전송 때문에 그대로 둔다.
6. [제안] `check-layers.ts`의 `expectedLayer`는 디렉터리 이름 `client`를 L4로 본다. 허용 목록 파일(`xeon/scripts/dependency-allowlist.json`)에 두 예외 id를 올린다.
7. [제안] 데스크톱 Rust 셸은 이 패키지와 무관하다. 데스크톱 TS(WebView)만 쓴다.

## 4. 결과

### 4.1 좋은 점

- F가 계약만 담는다. F 변경이 런타임 동작을 바꾸지 않는다.
- 데스크톱이 엔진 코드 없이 연결 코드를 쓴다. WebView 번들 크기와 검사 경계가 분명하다.
- CLI와 데스크톱의 공유 로직이 한 곳에 모인다. 나중의 TUI 설정 화면(D-M3-30 행 3)이나 웹 클라이언트(D-M3-17, 범위는 M3 /plan)도 같은 패키지를 쓴다.

### 4.2 감수할 점

- 같은 층 예외가 둘 늘어난다.
- M2 F.8 이동을 되돌리는 코드 이동이 M3에 생긴다. 호스트와 CLI의 재export 경로가 바뀐다.
- 패키지가 하나 늘어 빌드 그래프(turbo)와 knip 설정이 바뀐다.

## 5. 대안

| 대안 | 내용 | 판정 | 이유 |
|---|---|---|---|
| a. `@xeon/host/client` 서브패스 | 호스트 패키지 안에 엔진 없는 서브패스를 두고 데스크톱이 import | 채택하지 않음 | 데스크톱 → 호스트 간선이 패키지 단위로 열린다. 서브패스 경계를 검사로 지켜야 한다 |
| c. F에 연결 코드 | `createHostConnection`을 F에 둔다(M2 F.8 상태 유지) | 채택하지 않음 | F에 런타임 로직이 남는다. 사용자 결정 D-M3-26 |
| 별도 층 순위 | `client`를 F와 L4 사이 새 순위로 둔다 | 채택하지 않음 | 층 표와 `RANK`가 바뀌고 다른 층이 client를 import할 이유가 없다. L4 안의 예외 둘로 충분하다 |

## 6. 미결 사항

- [미결] 소켓 전송의 클라이언트 구현(서비스 모드, 원격)을 이 패키지에 둘지 `L0.process`의 `connectServiceTransport`를 CLI가 계속 쓸지. 데스크톱은 L0를 import하지 않으므로 데스크톱 원격 접속(D-M3-17 형태 1)은 Rust 셸의 소켓 릴레이나 이 패키지 구현이 필요하다. M3 서비스·원격 작업에서 정한다.
