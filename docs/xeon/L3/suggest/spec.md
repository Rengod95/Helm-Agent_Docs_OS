---
id: L3.suggest.spec
layer: L3
domain: suggest
kind: spec
status: draft
depends_on: [F.extensions.spec, F.wire-settings.spec, L2.knowledge.spec, L4.host-service.spec, L4.release.spec]
binds: [xeon/packages/plugin-suggest/**]
---

# L3 제안 플러그인 (suggest)

## 1. 목적과 범위

제안 플러그인은 지식 대기열(L2.knowledge의 `knowledge.ledger`가 가진 제안)을 화면이 읽는 목록으로 보여 주는 보통 플러그인이다. 앱에 폴더째 묶여 오는 기본 플러그인이고, Helm과 같은 길로 설치된다.

- [결정: 2026-11-24 사용자, 제안 플러그인 작업 지시] "제안"을 내장 전용 특례가 아니라 보통 플러그인 `suggest`로 만든다. 번들 → 첫 실행에 사용자 확장 위치에 설치 → `actor: "release"`로 검토 저장소에 기록, 기본 프로필에 켜짐이다. 사용자가 끄거나 프로필에서 뺄 수 있다. 리뷰를 건너뛰는 새 설치 길은 만들지 않는다.
- 정하는 것: 매니페스트, 읽기 메서드 둘(`list`, `count`), 권한 선언, 화면 한 장, 번들 등록, 호스트 wire의 켜짐 게이트(§5).
- 정하지 않는 것: 결정(승인과 거절). 사용자만 하며 호스트 wire `proposal.decide`가 한다(§5). 제안을 만드는 쪽(무엇을 제안하는지). 모델 도구와 훅은 없다.

## 2. 매니페스트

| 칸 | 값 |
|---|---|
| `name`, `version`, `displayName` | `suggest`, `0.1.0`, `제안` |
| `purpose`, `description` | 필수 칸(AU-013, F.extensions.spec 목적과 설명). 비어 있으면 안 된다 |
| `defaultEnabled`, `trust` | `true`, `{ level: "user" }`(Helm과 같다) |
| `plugins` | 루트 플러그인 하나. `layer: "L3"`, `hooks: []`, `requires: [{ id: "knowledge.ledger", range: "^1.0.0" }]` |
| `tools`, `commands`, `scripts`, `components`, `orchestration` | 없다 |
| `methods` | `list`, `count`(둘 다 `readOnly: true`, 쓰기 메서드 없음) |
| `ui` | 화면 하나: `page`, `native`, `suggest`, 제목 `suggest.page.title`, 파일 `./ui/suggest.view.json`, 글 `./locales`(`en`, `ko`) |

권한 선언은 `knowledge.ledger` 하나다. 리뷰 카드에 이 선언이 보인다.

## 3. 메서드

wire 이름은 `ext.suggest.<동사>`다.

- `list`: 입력 `status?`(상태 목록, 1~7개), `limit?`(1~200), `cursor?`(불투명). 출처(`source`)는 받지 않는다. 결과는 호스트 wire `proposal.list`의 `ProposalListResult`와 같은 모양이다(`proposals`, `nextCursor`, `unavailable`).
  - 행은 F의 `proposalRowOf`로 만든다. 지식 상태가 하나도 없는 필터는 빈 목록이다(읽지 않는다).
  - 정렬은 `createdAt` 내림차순, 같으면 id 오름차순이다. 쪽 크기는 100행으로 줄이고, 같은 시각의 행이 쪽 경계에 걸릴 때를 위해 여유 50행을 더 읽는다. 커서는 호스트와 같은 base64url JSON(`createdAt`, `source: "knowledge"`, `id`)이다.
  - 지식 기능 오류는 `unavailable: ["knowledge"]`와 빈 목록이다. 그 밖의 실패는 던진다.
- `count`: 대기(`pending`) 제안 수. 대기 목록을 상한 200 안에서 센다. 결과는 `{ ok: true, count, capped }`이고, `capped`가 참이면 그 이상이 더 있을 수 있다. 읽지 못하면 `{ ok: false, reason: "unavailable" }`다.

두 메서드의 매개변수와 결과 스키마는 TypeBox 스키마에서 옮긴 JSON Schema다. 호스트가 호출 때 매개변수를 검사하고, 결과 모양이 어긋나면 `result_invalid`로 본다.

## 4. 권한과 경계

- 읽는 것은 `knowledge.ledger`의 `proposals`뿐이다. 저장소(`g.pluginStore`), 기록, 게시, 결정(`decide`), 도구 등록, 명령 등록을 쓰지 않는다. 시험이 소스 줄을 보고 이를 확인한다.
- 대기열의 `proposals` 호출은 만료가 지난 대기 제안을 `expired`로 바꾸는 정리를 함께 한다(L2.knowledge의 목록 동작). 호스트 wire `proposal.list`도 같다.
- 호출 문맥은 확장(`caller: extension`)이다. 대기열 목록은 확장 호출을 막지 않는다. 결정은 호스트(사용자) 문맥만 받으므로 이 플러그인은 결정할 수 없다.

## 5. 켜짐 게이트 (호스트 wire)

호스트 wire `proposal.list`와 `proposal.decide`는 제안 플러그인이 켜져 있을 때만 지식 대기열을 연다(HS-79 (5)).

- 판정 원천: `ext.registrations()`의 루트 등록(이름 `suggest`)의 `status`가 `enabled`인가다. `ext.list`가 쓰는 원천과 같다. 꺼졌거나, 프로필에서 빠졌거나, 설치되지 않았으면 거짓이다. `enabling`이나 `disabling`은 거짓이다.
- 꺼짐: `proposal.list`는 `unavailable: ["knowledge"]`와 빈 목록이다(출처 `learning`의 응답은 그대로다). `proposal.decide`는 `{ ok: false, reason: "unavailable", detail: "the suggest plugin is off" }`다.
- 다시 켜면 다음 호출부터 열린다. 게이트는 호출 때마다 읽으므로 따로 알림을 받지 않는다.
- 결정 길은 내장 `host-proposals-bridge`가 주는 대기열 어댑터(`KnowledgeProposalWire`)를 그대로 쓴다. 제안 플러그인에 결정 권한을 주지 않는다.

## 6. 번들 등록

| 자리 | 내용 |
|---|---|
| `scripts/release-bundle.json` `defaultPlugins` | `{ name: "suggest", buildScript: "packages/plugin-suggest/scripts/build-plugin.ts" }` |
| `apps/host/src/assembly/default-plugins.ts` `DEFAULT_PLUGIN_NAMES` | `["helm", "suggest"]`. 이름은 `SUGGEST_PLUGIN_NAME`이다 |
| 첫 실행 설치와 검토 기록 | `installDefaultPlugins`가 사용자 확장 위치에 설치하고, `reviewStartupPlugins`가 `actor: "release"`로 검토 저장소에 넣는다(`release.test.ts`가 빌드 산출물로 확인한다) |
| 데스크톱 묶음 | `just desktop-build-electron`이 `scripts/default-plugins.ts`로 같은 목록을 빌드해 `Resources/default-plugins/`에 넣는다 |
| 아카이브 시험 | `scripts/release-smoke.ts`의 필수 경로에 `default-plugins/suggest/.fresnel-plugin/plugin.json`이 있다 |

번들 빌드 산출물은 `.fresnel-plugin/plugin.json`, `dist/index.js`, `ui/`, `locales/`다. 엔트리 번들의 외부 import는 `@fresnel/contracts`(하위 경로 포함), `@fresnel/orchestration-sdk`, `typebox`뿐이다.

## 7. 공유 규칙

- 행 변환(`proposalRowOf`)과 상태 필터(`knowledgeStatusesOf`)는 F(`@fresnel/contracts/wire`, `packages/contracts/src/wire-settings/wire/proposal-rows.ts`)에 있다. cap-knowledge의 대기열 어댑터와 이 플러그인이 같은 함수를 쓴다.
- 쪽 나누기 규칙(정렬, 커서, 여유 행)은 호스트 `assembly/proposals.ts`와 플러그인 `src/queue.ts`에 같은 값으로 있다. 두 곳의 시험이 같은 값을 고정한다. 한쪽을 고치면 다른 쪽도 고친다.

## 8. 수용 기준

1. `list`는 대기열 행을 `ProposalRow`로 바꾸고, 정렬과 쪽 나누기를 호스트와 같게 한다. 쪽 경계의 같은 시각 행은 한 번씩만 나온다(`test/unit/queue.test.ts`).
2. `count`는 `pending`만 세고, 200에서 `capped`를 참으로 준다(`test/unit/queue.test.ts`).
3. 매니페스트는 권한으로 `knowledge.ledger` 하나만 요구하고, 두 메서드는 읽기 전용이며, 도구와 훅과 저장소 쓰기가 없다(`test/unit/manifest.test.ts`, `test/unit/methods.test.ts`).
4. 번들 빌드 산출물은 매니페스트 검증을 통과하고, 외부 import 목록이 §6과 같다(`test/unit/build.test.ts`). 릴리스 검토 경로가 `actor: "release"`로 받는다(`apps/host/test/assembly/plugins/release.test.ts`).
5. 켜짐이면 호스트 wire 결과가 기존과 같고, 꺼짐이면 `unavailable`이며, 다시 켜면 열린다(`apps/host/test/assembly/proposals.test.ts`). 번들을 설치한 엔진은 열려 있고, 번들이 없는 엔진은 `unavailable`이다(`apps/host/test/int/proposals.int.test.ts`).
6. 기본 목록은 `helm`, `suggest`이고 계정 회전은 개발 모드에서만 더한다(`apps/host/test/assembly/default-plugins.test.ts`).

## 9. 미결 사항

- [미결] 데스크톱이 목록을 `ext.suggest.list`로 읽을지, 호스트 wire `proposal.list`를 계속 쓸지. 현재 데스크톱은 wire를 쓴다(다음 작업).
- [미결] 제안 플러그인이 꺼져 있을 때 제안 화면이 보여 줄 안내 문구. 데스크톱 화면 작업에서 정한다.
- [미결] 프로필에서 뺀 제안 플러그인의 등록이 적용 뒤 꺼진 상태가 되는 경로(`requestApply`, E(T))를 잇는 시험은 아직 없다. 게이트는 `ext.registrations()`의 상태를 읽으므로 이 경로에 기댄다.
