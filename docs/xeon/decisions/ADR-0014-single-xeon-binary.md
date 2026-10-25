---
id: adr.0014
layer: adr
domain: single-binary
kind: adr
status: accepted
depends_on: [adr.0001, adr.0006, adr.0008]
binds: [xeon/apps/cli/**, xeon/apps/desktop/**, xeon/apps/host/**]
---

# ADR-0014 엔진 바이너리는 단일 `xeon`

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-25
- [결정] `bun build --compile` 하나로 CLI와 데스크톱 사이드카를 만듭니다(ADR-0001 §4.1 단일 바이너리 항목, accepted).
- 근거 구현: 사이드카 설정 `xeon/apps/desktop/sidecar.json`(이름 `xeon`, 진입 `../cli/src/main.ts`, 인자 `host --stdio`)과 빌드 스크립트 `xeon/scripts/build-sidecar.ts`(DESK.3).
- 이 ADR은 `L4.readme` §3의 [제안] "단일 `xeon`"과 §8 미결 2번(단일 바이너리 대 `apps/host` 단독 사이드카)을 ADR-0001과 구현에 맞춰 닫습니다(마일스톤 재점검 G3-03). `L4.readme` §8 미결 2번 행의 정리는 L4 문서 소유자가 합니다.

## 2. 맥락

- CLI(`xeon chat`), 데스크톱 사이드카(`xeon host --stdio`), 서비스 모드(`xeon service …`, M3)가 같은 엔진 라이브러리를 씁니다(ADR-0006).
- 사이드카를 `apps/host` 단독 바이너리로 따로 만들면 바이너리가 둘이 되고, 같은 엔진 코드를 두 번 번들합니다.
- 제품 이름은 정하지 않았습니다. `xeon`은 임시 이름입니다(`product.scope.spec` §10 미결 2).

## 3. 결정

1. [결정] 배포하는 엔진 실행 파일은 `xeon` 하나입니다. 서브커맨드 `chat`, `host --stdio`, `config`, `secret`, `doctor`, `version`을 둡니다. M3에 `service …`를 더합니다(`L4.readme` §3 엔진 바이너리 항목).
2. [결정] 데스크톱 사이드카는 이 바이너리를 `host --stdio` 인자로 띄웁니다. Tauri `externalBin`은 `binaries/xeon`이고 파일 이름은 `xeon-<triple>`입니다(`src-tauri/tauri.conf.json`).
3. [제안] 제품 이름이 정해지면 바이너리 이름, 상태 디렉터리(`.xeon`), 설정 키 접두는 한 번에 바꿉니다. 그 전에는 `xeon`을 고정합니다.

## 4. 결과

### 4.1 좋은 점

- CLI와 사이드카가 같은 바이너리라 E2(메시지 열 동일)의 전제가 단순합니다.
- 빌드와 서명 대상이 triple마다 하나입니다.

### 4.2 감수할 점

- 사이드카에 CLI 코드(TUI, 명령 파서)가 같이 들어갑니다. 크기가 늘어나지만 ADR-0012에 따라 받아들입니다.
- 이름을 바꿀 때 바이너리, 디렉터리, 설정 키를 함께 옮겨야 합니다.

## 5. 대안

| 대안 | 내용 | 판정 | 이유 |
|---|---|---|---|
| `apps/host` 단독 사이드카 | 데스크톱용 바이너리를 따로 만듭니다 | 채택하지 않음 | 엔진을 두 번 번들하고, 빌드·서명 대상이 둘이 됩니다 |
| 사이드카 없이 Node 런타임 동봉 | Node와 JS를 리소스로 둡니다 | 채택하지 않음 | ADR-0008이 `bun build --compile` 사이드카를 정했습니다 |

## 6. 미결 사항

- [미결] 제품 이름(`product.scope.spec` §10 미결 2).
- [가정] macOS Intel(`x86_64-apple-darwin`) 바이너리는 빌드만 하고 실기 확인은 하지 않습니다(`product.scope.spec` §4.7).
