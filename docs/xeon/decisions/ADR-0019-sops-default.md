---
id: adr.0019
layer: adr
domain: secrets
kind: adr
status: accepted
depends_on: [adr.0001, L0.secrets.spec, L4.settings-ui.spec, F.capabilities.spec, review.m3-design-inputs]
binds: [xeon/packages/platform-secrets/**]
---

# ADR-0019 비밀 기본 저장소: SOPS(age)와 참조 사용

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-26
- [결정] 비밀 기본값은 SOPS(age)다. 에이전트는 값을 모른 채 참조(`secret://이름`)로 쓰고, 사용자는 목록·등록·열람·삭제를 한다(`_research/decisions-log.md` 2026-10-21 2차, `_research/foundation-plan.md` §2 비밀 행).
- [결정] 이 결정을 ADR로 승격한다(사용자 결정 2026-10-26, `review.m3-design-inputs` D-M3-31 행 6). 승격 기준은 `adr.readme` §4다. L0(secrets), L4(설정 화면 비밀 탭, CLI `xeon secret`), F(비밀 참조 형식)에 걸린다.
- 기본 파일 규칙은 M2 마감 구현을 옮긴 것이다(`L0.secrets.spec` §4.8, [결정: m2r sec]).

## 2. 맥락

- 비밀은 모델 키, MCP 서버 env, 웹 검색 키 플러그인 헤더처럼 여러 층에서 쓴다. 쓰는 쪽은 참조만 들고 값은 L0.secrets가 사용 시점에 해석한다(`L0.secrets.spec` §3.1, §3.6).
- 저장 형식이 바뀌면 참조 형식(F), 등록 경로(L4 화면과 CLI), 마스킹·감사(L0)가 함께 바뀐다.
- M2 마감에서 첫 `add`가 설정 없이 동작하도록 기본 SOPS 파일을 정했다. `l0.secrets.sops.files`가 비어 있으면 `{ env: "user", path: "<OsDirs.config>/secrets/sops/user.yaml" }` 하나를 쓰고, 파일과 age 키가 없으면 첫 `add` 때 만든다(`L0.secrets.spec` §4.6 8번, §4.7 7번, §4.8).

## 3. 결정

1. [결정] 기본 제공자는 SOPS 파일 제공자이고 암호화는 age다.
2. [결정] 에이전트와 확장은 값 대신 참조 `secret://<이름>`을 쓴다. 값 해석은 L0.secrets의 사용 맥락(lease)과 정책 판정을 거친다.
3. [결정] 사용자 관리 동작은 목록, 등록, 열람(재인증), 삭제다. CLI `xeon secret`(M2)과 설정 화면 비밀 탭(M3, `review.decisions-2` U-20)이 같은 관리 서비스를 쓴다.
4. [결정] 기본 파일은 `<OsDirs.config>/secrets/sops/user.yaml`, env 이름은 `user`다. `l0.secrets.sops.files`에 항목이 하나라도 있으면 기본 파일을 쓰지 않는다. 첫 `add` 때 파일과 age 키가 없으면 만든다.
5. [결정] 기본 파일, 메타, 감사 파일, age 키는 모두 `<OsDirs.config>/secrets/` 아래에 두고 샌드박스 보호 행이 이 디렉터리를 덮는다. `OsDirs`는 사용자마다 하나라 CLI와 데스크톱이 같은 비밀을 본다.
6. [제안] 키체인(macOS Keychain, Secret Service)은 age 키 보관 위치로만 쓴다(`L0.secrets.spec` §3.7). 비밀 값 저장소로 쓰는 제공자는 2차 선택 기능이다.

## 4. 결과

### 4.1 좋은 점

- 비밀 파일이 암호화된 텍스트라 백업과 기기 이전이 쉽다.
- 에이전트 경로에 값이 나타나지 않아 마스킹 대상이 줄어든다.
- 첫 등록이 설정 없이 동작한다.

### 4.2 감수할 점

- 외부 바이너리 `sops`, `age`가 필요하다. macOS는 번들·서명하고 Linux는 시스템 패키지를 요구한다(D-M3-25 행 5, M3-26).
- age 키를 잃으면 파일을 복호화할 수 없다. 키 백업 안내는 L4가 한다.

## 5. 대안

| 대안 | 내용 | 판정 | 이유 |
|---|---|---|---|
| 각 spec의 [결정]으로 둠 | ADR 없이 `L0.secrets.spec`에 둔다 | 채택하지 않음 | 사용자 결정 D-M3-31 행 6. 참조 형식이 F에 걸린다 |
| OS 키체인을 값 저장소로 | 값마다 키체인 항목 | 채택하지 않음(2차 선택) | Linux 헤드리스와 원격 호스트에서 Secret Service가 없을 수 있다. 파일 이전이 어렵다 |
| 평문 `.env` | 파일 권한만으로 보호 | 채택하지 않음 | 백업·동기화 경로로 값이 새어 나간다 |

## 6. 미결 사항

- [미결] 원격 호스트(D-M3-17 형태 1)에서 age 키 획득 방법. 키체인이 없는 서버에서는 파일 폴백(`L0.secrets.spec` §4.7)을 쓰는지 M3 서비스·원격 작업에서 확인한다.
