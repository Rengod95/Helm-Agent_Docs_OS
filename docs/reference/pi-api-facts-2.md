# pi API 확인 자료 2: tui, protocol, server, client, chord, env, evals, telemetry

- 작성: 2026-10-11, 0단계 에이전트 S3b
- 기준 소스: `~/projects/_ref/pi-src` 커밋 `cdaf6c2` (읽기 전용). 아래에서 `pi-src/`로 줄여 쓴다. 패키지 경로는 `packages/<이름>/`이고, 파일 경로는 패키지 루트 기준으로 적는다(예: `server/src/server.ts:306`).
- 기준 배포물: npm `@earendil-works/*` 1.1.0 (2026-10-07). `experiments/pi-lab`에 설치해 확인했다.
- 표기: [원문] 소스·문서를 직접 읽음, [실험] 코드를 실행해 확인, [지식] 이번에 다시 확인하지 않음, [후보] Helm 설계에 대한 이 문서의 제안(결정 아님).
- 짝 문서: `pi-api-facts-1.md`(ai, agent, coding-agent, codemode, mcp, durable). coding-agent에 속한 주장은 여기서 필요한 만큼만 다룬다.

## 0. 요약: 설계에 영향이 큰 사실

1. **소스 `cdaf6c2`와 npm 1.1.0은 같지 않다.** 여러 패키지의 CHANGELOG에 `[Unreleased]` 항목이 있고, 소스에는 있으나 1.1.0 배포물에는 없는 API가 있다. 예: `renderFakeCursor()`는 `tui/src/tui.ts:205`에 있지만 npm 1.1.0 `pi-tui/dist/index.d.ts`에는 없다 [원문][실험]. 포크(소스 복사)와 고정 의존(npm 1.1.0)은 다른 API를 기준으로 한다. P4는 둘 중 무엇을 기준으로 할지 먼저 정해야 한다.
2. **pi-protocol/server/client는 재접속 시 이어 받기를 하지 않는다.** 연결이 끊기면 attachment가 풀리고 구독이 지워지며, 대기 중 요청은 거부된다. 다시 붙으면 상태의 현재 스냅샷을 새로 받을 뿐, 끊긴 동안의 갱신을 순서대로 다시 받지 않는다 [원문 `client/README.md`, `client/src/client.ts:345-351`][실험 exp7]. 브리프 결정 31의 `lastSeq` 재전송은 Helm이 직접 만들어야 한다.
3. **pi-protocol에는 인증이 없고, 인증은 전송 계층(`ServerListener`) 몫으로 정해져 있다** [원문 `server/src/listener.ts:3-8`, `protocol/README.md`]. 대신 전송 중립 추상(`ByteConnection`/`ServerListener`, `ByteTransport`/`ByteTransportFactory`)과 Chord 상태 복제(스냅샷 + 경로 압축 delta + 멤버별 sequence)는 잘 분리되어 있어, 설계 참고 가치가 높다 [원문][실험 exp7].
4. **pi-tui는 런타임 의존이 2개(`get-east-asian-width`, `marked`)뿐이고 OpenClaw가 이것만 남겨 쓰고 있다** [원문 `tui/package.json`, `~/projects/_ref/openclaw/package.json:2269`]. 한국어 폭 계산(한글 1자 = 2칸), 입력, 차등 렌더링이 동작한다 [실험 exp8]. 다만 pi의 채팅 화면 부품(`AssistantMessageComponent` 등)은 coding-agent에 있어서, 패키지 루트로 가져오면 coding-agent 의존 전체(chord, codemode, mcp, photon 등)가 따라온다 [원문 `coding-agent/package.json`].
5. **pi-env의 SSH 표준입출력 프레임 프로토콜은 브리프 결정 38(b)에 바로 참고할 수 있다.** 셸 시작 파일이 stdout에 찍는 잡음을 `PI-ENV <token>` 동기화 줄로 걸러 내고, 길이 접두 프레임, 5초 ping, 30초 무수신 시 종료를 정해 두었다 [원문 `env/docs/protocol.md`]. 단 패키지 자체는 pi-durable의 `ExecutionEnv` 구현이라, agent-core + coding-agent 도구 조합에 그대로 끼울 수 없다 [원문 `env/src/remote-env.ts:351`].
6. 그 밖: 모든 패키지의 `engines.node`는 `>=22.19.0`이다(브리프 결정 36의 "Node 22 LTS"는 22.19 이상이어야 한다) [원문]. npm 배포 tarball에는 LICENSE 파일이 없고 `package.json`의 `"license": "MIT"`만 있다 [실험]. pi 저장소는 TypeScript 7.0.2와 Node strip-only 문법 규칙을 쓴다(소스를 Helm으로 옮길 때 TS 5.x 설정과 맞춰야 한다) [원문 `pi-src/package.json`, `pi-src/AGENTS.md`].

## 1. 저장소 전체 수준

### 1.1 루트 구성 [원문]

| 항목 | 내용 | 출처 |
|---|---|---|
| 루트 패키지 | `pi-monorepo`, `private: true`, `type: module`, 버전 `0.0.3` | `pi-src/package.json` |
| 워크스페이스 도구 | **npm workspaces** (`workspaces: ["packages/*", ...예제 확장 5개]`), 잠금 파일 `package-lock.json`. `pnpm` 11.15.1이 devDependency에 있으나 `scripts/local-package-install.mjs`, `use-local-packages.mjs` 등 로컬 설치 검증 스크립트용이다 | `pi-src/package.json`, `scripts/*.mjs` |
| 빌드 | 패키지마다 `tsc -p tsconfig.build.json`(번들러 없음). 루트 `build`가 의존 순서대로 호출: chord → tui → telemetry → codemode → mcp → ai → durable → env → agent → protocol → client → server → coding-agent. esbuild 0.28.2는 coding-agent 번들(`scripts/build-coding-agent-bundle.mjs`)과 chord의 facet 번들러에 쓴다 | `pi-src/package.json` scripts |
| TypeScript | devDependency `typescript` **7.0.2**. `tsconfig.base.json`: `target ES2024`, `module/moduleResolution Node16`, `strict`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`. 소스의 상대 import는 `.ts` 확장자를 붙인다 | `tsconfig.base.json`, `package-lock.json:4602-4605` |
| 문법 규칙 | "Use only erasable TypeScript syntax (Node strip-only mode)": parameter property, `enum`, `namespace`, `import =` 금지. inline `await import()` 금지. 외부 의존은 정확한 버전으로 고정 | `pi-src/AGENTS.md` "Code Quality", "Dependency and Install Security" |
| 테스트 | Vitest 4.1.11(protocol, server, client, chord, env, telemetry, evals). **pi-tui만 `node --test`** (`test/*.test.ts`를 Node가 직접 실행). 루트 `vitest.base.ts`가 워크스페이스 소스 경로 alias를 준다. 각 패키지 vitest 설정은 `resolve.conditions: ["source"]` | `tui/package.json` scripts, `protocol/vitest.config.ts`, `pi-src/vitest.base.ts` |
| 린트·포맷 | Biome 2.3.5, 탭 들여쓰기, 줄 폭 120 | `pi-src/biome.json` |
| 검사 | `npm run check` = biome + 고정 의존 검사 + 런타임 의존 검사 + 상대 import 검사 + 엔트리 그래프 검사 + `tsc --noEmit` + 브라우저 스모크 | `pi-src/package.json` `check` |
| 브라우저 스모크 | `scripts/browser-smoke-entry.ts`를 esbuild `platform: "browser"`로 묶어 Node 전용 import가 섞이지 않았는지 본다. 대상에 `pi-client` 루트, `pi-protocol`의 `encodeCbor/decodeCbor`, `pi-agent-core`, `pi-ai`가 들어 있다 | `scripts/check-browser-smoke.mjs:46-48`, `scripts/browser-smoke-entry.ts` |
| Node 요구 | 루트와 7개 패키지 `engines.node: ">=22.19.0"`(evals는 `engines` 없음). CI는 `node-version: 22` | 각 `package.json`, `.github/workflows/ci.yml:23` |
| 버전 정책 | 모든 공개 패키지가 같은 버전으로 움직인다(`version:*` 스크립트 + `scripts/sync-versions.js`). 패키지 간 의존은 `^1.1.0` 범위, 외부 의존은 정확한 버전 | `pi-src/package.json`, 각 `package.json` |

### 1.2 라이선스와 서드파티 고지

| 대상 | 내용 | 확인 |
|---|---|---|
| 저장소 | 루트 `LICENSE` 하나: MIT, "Copyright (c) 2025 Mario Zechner" | [원문] `pi-src/LICENSE` |
| 8개 패키지 | 패키지 디렉터리에 LICENSE 파일이 없다. `package.json`의 `"license": "MIT"`만 있다. `author`는 tui·telemetry가 "Mario Zechner", protocol·server·client·chord·env가 "Earendil Works" | [원문] 각 `package.json` |
| npm tarball | 설치된 `@earendil-works/*` 1.1.0 12개 패키지 중 LICENSE 파일이 있는 것은 `pi-mcp`(`LICENSES/`)뿐이다 | [실험] `experiments/pi-lab/node_modules/@earendil-works/*` |
| pi-tui 내부 차용 | `src/stdin-buffer.ts:17` "MIT License - Copyright (c) 2025 opentui"(OpenTUI에서 가져옴, CHANGELOG 1148행도 같은 내용). `src/oklab.ts:6` "Copyright (c) 2021 Björn Ottosson, used under the MIT license" + 허가 문구. `src/keys.ts:6` OpenTUI `parse.keypress.ts`를 참고 출처로 적음 | [원문] |
| pi-tui 네이티브 | `native/{darwin,linux,win32}/prebuilds/*.node` 프리빌드 바이너리를 tarball에 포함(클립보드, Windows VT 입력). macOS 빌드는 Apple SDK 라이선스 조건이 붙는다고 README에 적혀 있다 | [원문] `tui/package.json` files, `tui/native/darwin/README.md:22`; [실험] 설치본에 프리빌드 존재 |
| pi-tui 런타임 의존 | `get-east-asian-width` 1.6.0 (MIT), `marked` 18.0.11 (MIT) | [실험] 설치본 `package.json` |
| pi-protocol 의존 | `typebox` 1.3.27 (MIT). npm 패키지 이름은 `typebox`다(`@sinclair/typebox` 이름 아님) | [원문][실험] |
| chord 의존 | `esbuild` 0.28.2 (MIT) | [원문][실험] |
| pi-env 데몬 | Rust 바이너리. 직접 의존 `encoding_rs =0.8.42`, `notify =8.2.0`, `serde_json =1.0.151` 외, `Cargo.lock`의 크레이트 46개. 각 크레이트 라이선스는 이번에 확인하지 않았다 | [원문] `env/daemon/Cargo.toml`, `Cargo.lock` |
| 포크 시 할 일 [후보] | MIT 조건상 저작권 고지를 사본에 포함해야 한다 [지식]. Helm `vendor/`에 루트 LICENSE 원문을 두고, 가져온 파일마다 원 경로·커밋을 적는다. pi-tui를 포크하면 OpenTUI·Ottosson 고지도 함께 옮긴다 | - |

### 1.3 1.0.0 ~ 1.1.0 사이 호환이 깨진 변경 [원문 각 `CHANGELOG.md`]

`### Breaking Changes` 절과, 절 밖이지만 동작이 바뀐 항목을 함께 적는다. 패치 버전(1.0.x)에서 깨진 것이 여러 개다. semver 보장 문구는 어디에도 없다.

| 버전 (날짜) | 패키지 | 변경 | 패치 버전 여부 |
|---|---|---|---|
| 1.0.0 (10-01) | pi-agent-core | 실험 하네스 제거: `AgentHarness`, 세션·세션 저장소, durable 런타임, pico3, 하네스 도구, 컴팩션, 스킬, 프롬프트 템플릿, 시스템 프롬프트 헬퍼, telemetry 스키마, 검색 서비스 타입, `uuidv7`·pi-telemetry 재export, `./node`·`./harness/*`·`./experimental/pico3` 하위 경로 | 메이저 |
| 1.0.0 | pi-server | `SessionMetadata`를 pi-server가 export하고 `id`만 요구. pi-agent-core 의존 제거. 테스트용 `TestServerHost`/`TestHarness` 모양 변경 | 메이저 |
| 1.0.1 (10-03) | pi-mcp | `OAuthClientProvider.clientMetadataUrl` → `clientMetadataDocument(metadata)` | **패치** |
| 1.0.1 | pi-coding-agent | 배포물에서 `npm-shrinkwrap.json` 제거(전이 의존이 더 이상 고정되지 않음). Removed 절 | **패치** |
| 1.0.1 | pi-ai | Anthropic 모델의 대화 중 도구 변경이 `inline-tools-2026-09-15` 베타(`tool_addition` 블록)로 바뀜. Changed 절(와이어 동작 변경) | **패치** |
| 1.0.3 (10-05) | pi-ai, pi-coding-agent | Azure provider 이름 `azure-openai-responses` → `azure`, export 이름·하위 경로 변경. coding-agent는 `auth.json`·`models.json`·`settings.json` 키 이름 변경 필요 | **패치** |
| 1.0.3 | pi-tui (coding-agent도 같은 내용) | `Home`/`End`가 항상 에디터 줄 처음/끝으로 이동. 전체 화면 맨 위/맨 아래는 `Ctrl+Home`/`Ctrl+End`로 이동. Changed 절(키 바인딩 변경) | **패치** |
| 1.0.3 | pi-durable | `FileSystem`이 `openBinaryReader()`, `openDirReader()`, `watch()` 필수. `BinaryReader.scanLines()` 필수. `Shell.exec()`가 argv 배열도 받고 `onOutput`에 세 번째 인자 | **패치** |
| 1.0.4 (10-05) | pi-durable | `NodeExecutionEnv.watch()` 권한 오류를 `permission_denied`로 실패. env conformance 검사 3개 추가(1.0.3 통과 구현이 실패할 수 있음) | **패치** |
| 1.1.0 (10-07) | pi-ai | stream 함수는 `AssistantMessageEventStream`을 반환해야 함(직접 만든 `EventStream` 하위 클래스는 타입 오류) | 마이너 |
| 1.1.0 | pi-tui | `Terminal` 구현은 `setProgramStatus(status)`를 제공해야 함(OSC 7501) | 마이너 |
| 1.1.0 | pi-durable | `Storage`가 query의 `order` 필드를 지켜야 함. `TaskRuntime.context()` 세 번째 인자를 옵션 객체로 | 마이너 |
| Unreleased (소스에만) | pi-tui | `Editor.render()`/`Input.render()`가 커서를 `\x1b[7m` 대신 zero-width APC 마커로 감쌈. TUI 밖에서 렌더링하면 `stripTerminalSequences()`로 지워야 함. `showHardwareCursor`의 의미 변경 | - |
| Unreleased | pi-coding-agent | 테마 JSON 스키마 경로 이동, 알 수 없는 속성 거부 | - |
| Unreleased | pi-durable | `ToolTaskInput/Result` tagged union, `content`→`output`, bash 비정상 종료 코드를 오류 결과로, storage 오류 시 Session 종료, 구독 리스너 예외 처리 변경 | - |

- 이 문서 담당 패키지 중 protocol, client, telemetry, env는 1.0.0~1.1.0 사이 Breaking 절이 없다. chord와 evals에는 CHANGELOG 파일 자체가 없어 변경 이력을 추적할 수 없다 [원문].
- `### Breaking Changes` 절 개수(파일 전체, Unreleased 포함): coding-agent 49, ai 27, agent 13, tui 8, durable 4, server 2, protocol 1, client 1, mcp 1, env·telemetry·codemode 0 [원문, grep 집계].
- npm 첫 배포일(레지스트리 조회): pi-tui 0.74.0 2026-05-07, pi-protocol·pi-client·pi-server·pi-telemetry 0.84.0 2026-08-06, chord 2026-09-04, pi-env 2026-10-05. pi-ai의 0.74.0~1.1.0 정식 버전 수는 58개 [실험 `npm view ... time`]. pi-evals는 npm에 없다(404) [실험].

## 2. pi-tui (`@earendil-works/pi-tui`)

### 2.1 패키지 [원문 `tui/package.json`]

| 항목 | 값 |
|---|---|
| 버전 | 1.1.0, MIT, author Mario Zechner |
| 진입점 | `main: dist/index.js`, `types: ./dist/index.d.ts`. **`exports` 필드가 없다**(다른 패키지와 다름). 그래서 `dist/` 하위 파일 직접 import가 막혀 있지 않다 |
| 의존 | `get-east-asian-width` 1.6.0, `marked` 18.0.11. dev: `@xterm/headless` 5.5.0, `chalk` 6.0.0. pi 내부 패키지 의존 없음 |
| engines | node >=22.19.0 |
| files | `dist`, `native/*` 프리빌드와 C/ObjC 소스, README |
| 크기 | `src/**/*.ts` 46개 파일 19,505줄, 테스트 20,072줄. 큰 파일: `components/editor.ts` 2,473, `tui-alt-screen.ts` 1,787, `tui.ts` 1,517, `latex.ts` 1,506, `keys.ts` 1,455, `utils.ts` 1,402, `components/markdown.ts` 1,025 |
| 구조 | `src/`(렌더러 `tui.ts`·`tui-main-screen.ts`·`tui-alt-screen.ts`, 터미널 `terminal.ts`·`stdin-buffer.ts`·`keys.ts`·`keybindings.ts`, 레이아웃 `layout.ts`, 이미지 `terminal-image.ts`, 색 `colors.ts`·`oklab.ts`, `components/` 18개), `native/`, `test/`(`chat-simple.ts` 예제, `virtual-terminal.ts`) |
| 사용처 | pi-coding-agent(의존), OpenClaw(`"@earendil-works/pi-tui": "1.0.0"`, 다른 pi 패키지 없음), pi-fabric |

### 2.2 컴포넌트 모델 [원문]

```ts
// tui/src/tui.ts:117-142
export interface Component {
	render(width: number): string[];          // 줄 배열. 각 줄은 width를 넘으면 안 된다(README "Component Interface")
	handleInput?(data: string): void;          // 포커스를 가진 컴포넌트가 원시 터미널 입력을 받음
	handleMouse?(event: TuiMouseEvent): TuiMouseEventResult | undefined; // TuiAltScreen에서만
	wantsKeyRelease?: boolean;                 // Kitty 프로토콜 key release 수신 여부
	invalidate(): void;                        // 캐시된 렌더 상태 비우기
}

// tui/src/tui.ts:180-183 — IME 커서 위치용
export interface Focusable { focused: boolean; }
export const CURSOR_MARKER = "\x1b_pi:c\x07"; // tui.ts:196, zero-width APC

// tui/src/tui.ts:464-493 — 두 렌더러가 공유하는 인터페이스(타입만 export)
export interface TUI extends Component {
	readonly mode: TuiMode;                    // "regular" | "fullscreen" (tui.ts:457)
	children: Component[];
	terminal: Terminal;
	onDebug?: () => void;
	readonly fullRedraws: number;
	addChild(component: Component): void;
	removeChild(component: Component): void;
	clear(): void;
	getShowHardwareCursor(): boolean;
	setShowHardwareCursor(enabled: boolean): void;
	getClearOnShrink(): boolean;
	setClearOnShrink(enabled: boolean): void;
	setFocus(component: Component | null): void;
	showOverlay(component: Component, options?: OverlayOptions): OverlayHandle;
	hideOverlay(): void;
	hasOverlay(): boolean;
	start(): void;
	stop(options?: TuiStopOptions): void;
	renderNow(force?: boolean): void;
	requestRender(force?: boolean): void;
	addInputListener(listener: TuiInputListener): () => void;   // 입력 가로채기(consume/data 치환)
	removeInputListener(listener: TuiInputListener): void;
	onTerminalColorSchemeChange(listener: (scheme: TerminalColorScheme) => void): () => void;
	setTerminalColorSchemeNotifications(enabled: boolean): void;
	queryTerminalColors(options: { timeoutMs: number; onLateReply?: (colors: TerminalColors) => void }): Promise<TerminalColors>;
}

// tui/src/tui.ts:497-504
export interface ViewportTUI extends TUI { readonly [VIEWPORT_TUI]: true; setLayoutRoot(component: Component | undefined): void; }
export function isViewportTUI(tui: TUI): tui is ViewportTUI;
```

- 구체 렌더러: `TuiMainScreen`(`tui-main-screen.ts:124`, mode `"regular"`, 터미널 scrollback 유지, 마우스 미사용)과 `TuiAltScreen`(`tui-alt-screen.ts:202`, mode `"fullscreen"`, 대체 화면 버퍼, 앱이 스크롤 소유). 둘 다 추상 클래스 `TuiBase`(`tui.ts:506`, export 안 됨)를 상속하고 생성자는 `(terminal: Terminal, showHardwareCursor?: boolean, logDirectory?: string)`(`tui.ts:543`). `TuiAltScreen`은 네 번째 인자로 `TuiAltScreenOptions`(`tui-alt-screen.ts:168-199`: `wheelScrollLines`, `mouse`, 검색 스타일, `scrollToEndIndicator`, `openUrl`, `onRightClickPaste`, `copyOnSelect`, `copySelection`)를 받는다.
- `Container`(`tui.ts:358`)가 자식 배열을 들고 `render()`에서 이어 붙인다. 레이아웃 컴포넌트 `VStack`/`HStack`/`ScrollView`의 높이 제약(`basis`, `grow`, `shrink`, `minSize`, `maxSize`, `visible`)은 `TuiAltScreen.setLayoutRoot()`에서만 의미가 있다(README "Alternate-screen viewport layouts").
- 오버레이는 별도 컴포넌트 클래스 없이 `TUI.showOverlay()` API로 띄운다. `OverlayOptions`(`tui.ts:254-290`: `width`, `minWidth`, `maxHeight`, `anchor` 9종, `offsetX/Y`, `row/col`(숫자 또는 `"50%"`), `margin`, `visible(termWidth, termHeight)`, `nonCapturing`), `OverlayHandle`(`tui.ts:309-324`: `hide`, `setHidden`, `isHidden`, `focus`, `unfocus`, `isFocused`, `getBounds`).
- 줄 끝마다 SGR reset과 OSC 8 reset을 붙이므로 스타일이 다음 줄로 이어지지 않는다(README "Component Interface").

### 2.3 렌더링 [원문]

- 렌더 요청 합치기: `requestRender()`는 `process.nextTick`으로 묶고, 최소 간격 `MIN_RENDER_INTERVAL_MS = 16`(`tui.ts:518`, `1040-1041`)으로 제한한다. 키 입력은 지연을 줄이려 throttle 경로를 건너뛴다(`tui.ts:1127-1128`). `requestRender(true)`는 렌더 상태를 초기화하고 즉시 그린다(`tui.ts:1001-1006`).
- `TuiMainScreen` 차등 렌더링 전략(`tui-main-screen.ts:247` `doRender()`): 첫 렌더는 scrollback을 지우지 않고 전체 출력(`:332-334`), 폭이 바뀌면 화면을 지우고 전체 다시 그림(`:339-341`), 높이 변화·`clearOnShrink`도 전체 다시 그림(`:350`, `:358-359`), 그 밖에는 처음 바뀐 줄(`firstChanged`, `:364-381`)로 커서를 옮겨 그 아래만 다시 그린다. 화면 위로 지나간 줄이 바뀌면 전체 다시 그림(README "Rendering modes").
- 동기 출력: 두 렌더러 모두 `\x1b[?2026h` … `\x1b[?2026l`로 감싼다(`tui-main-screen.ts:281,303`, `tui-alt-screen.ts:72-73`).
- `TuiAltScreen`: 바뀐 뷰포트 행만 갱신, 끝을 따라가는 스크롤(`follow: "end"`), OSC 133 프롬프트 마커 사이 이동, `Ctrl+Shift+F` 검색, 마우스 선택 시 OSC 52 복사, OSC 8 링크 클릭, Kitty 이미지 잘라 그리기. iTerm2 이미지는 대체 화면에서 텍스트 자리표시로 바뀐다(README "Rendering modes", "Alternate-screen image compatibility").
- [실험 exp8] 가짜 `Terminal`로 40×12에서 첫 렌더 316바이트, 한 줄(`Text.setText`)만 바꾼 두 번째 렌더 70바이트. 첫 출력에 `?2026h`/`?2026l` 둘 다 있다.

### 2.4 입력 처리와 키 바인딩 [원문]

- `ProcessTerminal`(`terminal.ts:150`)의 시작 동작: `process.stdin.setRawMode(true)`(`:199-200`), bracketed paste `\x1b[?2004h`(`:206`), Kitty keyboard protocol 질의(`:20`, `:221-`) 후 응답이 없으면 `modifyOtherKeys`(`\x1b[>4;2m`, `:403-405`)로 대체, Windows에서는 네이티브 헬퍼로 `ENABLE_VIRTUAL_TERMINAL_INPUT`(`:420-427`). 종료 시 원래대로 돌린다.
- ESC 단독 키 판정 대기: 기본 10ms, `SSH_CONNECTION`이나 `SSH_TTY`가 있으면 100ms, `PI_TUI_ESC_TIMEOUT`으로 덮어쓰기(`terminal.ts:128-144`). SSH로 TUI를 쓰는 Helm 경로(결정 33)와 직접 관련 있다.
- `Terminal.drainInput(maxMs=1000, idleMs=50)`: 느린 SSH에서 Kitty key release 이벤트가 부모 셸로 새지 않게 종료 전에 stdin을 비운다(`terminal.ts:85-91`).
- `StdinBuffer`(`stdin-buffer.ts:281`, OpenTUI에서 가져옴): 한 번에 들어온 입력을 개별 시퀀스로 나눈다.
- 키 판정: `matchesKey(data, "ctrl+c" | Key.ctrl("c"))`, `parseKey`, `isKeyRelease`, `decodeKittyPrintable`(`index.ts:97-108`).
- 키 바인딩: `interface Keybindings`(`keybindings.ts:7-59`)는 declaration merging으로 확장한다. 기본 액션 이름은 `tui.editor.*`(커서, 히스토리, 단어 이동, 삭제, yank, undo), `tui.input.*`(newLine, submit, tab, copy), `tui.select.*`, `tui.altScreen.*`(페이지, 프롬프트 이동, 검색, top/bottom). 기본값 표 `TUI_KEYBINDINGS`(`:71`), 사용자 설정 병합·충돌 검출 `KeybindingsManager(definitions, userBindings)`(`:231-237`), 전역 `setKeybindings/getKeybindings`(`:311-315`). pi는 "키 판정을 하드코딩하지 말고 기본 바인딩 표에 넣어라"를 규칙으로 둔다(`pi-src/AGENTS.md`).
- 마우스: `TuiAltScreen`만 SGR 마우스를 정규화한다. `TuiMouseEvent`(`tui.ts:25-44`)에 컴포넌트 기준 `x/y`, 절대 좌표, 버튼, 수정자, 클릭 수, 휠 delta. 결과 `{ handled, capture, focus, render }`(`tui.ts:46-58`).
- IME: 포커스된 `Focusable` 컴포넌트가 `CURSOR_MARKER`를 출력하면 하드웨어 커서를 그 위치에 둔다. 컨테이너가 입력 컴포넌트를 품으면 `focused`를 자식에게 전달해야 한다(README "Focusable Interface"). 한국어 입력과 관련 있다.
- [실험 exp8] `SelectList`에 `\x1b[B`, `\r`를 넣어 두 번째 항목이 선택됐고, `Editor`에 `"결과 확인"`과 `\r`를 넣어 `onSubmit("결과 확인")`이 불렸다.

### 2.5 재사용 가능한 컴포넌트 목록 [원문 `tui/src/index.ts`, 각 파일]

| 컴포넌트 | 위치 | 생성자·요점 |
|---|---|---|
| `Container` | `tui.ts:358` | `addChild`, `removeChild`, `clear` |
| `Text` | `components/text.ts:7` | `(text = "", paddingX = 1, paddingY = 1, customBgFn?)`, `setText`, `setPaddingX`(1.1.0) |
| `TruncatedText` | `components/truncated-text.ts:7` | `(text, paddingX = 0, paddingY = 0)` 한 줄 자르기 |
| `Box` | `components/box.ts:14` | `(paddingX = 1, paddingY = 1, bgFn?)` 패딩·배경 |
| `Spacer` | `components/spacer.ts:6` | `(lines = 1)` |
| `Input` | `components/input.ts:32` | `(options: { prompt?, placeholder?, placeholderStyle? })`, 한 줄 입력, `onSubmit`, Emacs식 키 |
| `Editor` | `components/editor.ts:297` | `(tui: TUI, theme: EditorTheme, options: { paddingX?, autocompleteMaxVisible? })`(`:243-246`, `:374`). 여러 줄, 자동완성(`/` 명령, Tab 파일 경로), 10줄 넘는 붙여넣기는 `[paste #1 +50 lines]` 표시, 히스토리(`addToHistory`), undo, kill ring, `getText/setText/insertTextAtCursor` |
| `Markdown` | `components/markdown.ts:236` | `(text, paddingX, paddingY, theme: MarkdownTheme, defaultTextStyle?, options?)`(`:254-261`), `marked` 기반, `highlightCode` 훅, 렌더 캐시 |
| `Loader` / `CancellableLoader` | `components/loader.ts:17`, `cancellable-loader.ts:13` | 스피너. Cancellable은 Escape로 `AbortSignal` 발생 |
| `SelectList` | `components/select-list.ts:40` | `(items: SelectItem[], maxVisible, theme, layout = {})`(`:53`), `onSelect`, `onCancel`, `onSelectionChange`, `setFilter` |
| `SettingsList` | `components/settings-list.ts:38` | 값 순환·하위 메뉴 설정 패널 |
| `Image` | `components/image.ts:55` | Kitty·iTerm2 인라인 이미지, 미지원 터미널은 텍스트 대체, `setImageTranscoder` |
| `MouseRegion` | `components/mouse-region.ts:12` | 렌더링을 바꾸지 않고 마우스 처리만 덧붙임 |
| `VStack` / `HStack` / `ScrollView` | `v-stack.ts:3`, `h-stack.ts:5`, `scroll-view.ts:22` | 대체 화면 레이아웃. `ScrollViewOptions { follow: "none" \| "end", primary, overscroll, scrollbar... }`(`scroll-view.ts:6-15`) |
| `CombinedAutocompleteProvider` | `autocomplete.ts:303` | `(commands, basePath, fdPath = null)` 슬래시 명령 + 파일 경로 |
| 유틸 | `utils.ts` | `visibleWidth`, `truncateToWidth`, `wrapTextWithAnsi`, `sliceByColumn`, `stripTerminalSequences`, `getOsc8LinkAtColumn` |
| 그 밖 | | `fuzzyFilter/fuzzyMatch`, `renderLatex`, 색(`parseColor`, `mixColors`, OKLCH/OKHSL), 이미지 프로토콜 함수, `formatProgramStatus`(OSC 7501), `getNativeClipboard` |

- export되지 않는 것: `TuiBase`, `VirtualTerminal`(테스트 전용 `test/virtual-terminal.ts`, `@xterm/headless` devDependency 사용. README "Terminal Interface"는 내장 구현처럼 적었지만 패키지 export에 없다), `AltScreenFlashContainer`.
- pi 채팅 화면용 부품(`AssistantMessageComponent`, `ToolExecutionComponent`, `UserMessageComponent`, `CustomEditor`, `FooterComponent`, `ModelSelectorComponent`, `initTheme`, `getMarkdownTheme`)은 **coding-agent 루트**에서 export된다(`coding-agent/src/index.ts:435-479`). 화면 조립 함수 `createInteractiveTui`(`coding-agent/src/modes/interactive/tui-renderer.ts:19-22`), `createChatViewport`(`chat-viewport.ts:22`)는 export되지 않는다. coding-agent `exports`는 `"."`, `"./rpc-entry"`, `"./client"`(source만), `"./experimental/plugin"`(source만)뿐이다.
- 예제: `tui/test/chat-simple.ts`(Editor + Markdown + Loader + 자동완성으로 만든 채팅).

### 2.6 터미널 요구

| 기능 | 쓰는 시퀀스·조건 | 없을 때 |
|---|---|---|
| raw mode TTY | `setRawMode(true)` | 키 입력 처리 불가 |
| 동기 출력 | CSI `?2026h/l` | 무시되고 깜박임 가능 [지식] |
| bracketed paste | CSI `?2004h` | 큰 붙여넣기 구분 불가 |
| 수정자 키 | Kitty keyboard protocol, 없으면 xterm `modifyOtherKeys` | Shift+Enter 등 구분 약화(README: Alt+Enter가 가장 확실) |
| 하이퍼링크 | OSC 8 | 텍스트만 |
| 프롬프트 마커 | OSC 133 (대체 화면 이동) | 이동 불가 |
| 복사 | OSC 52 (대체 화면 선택) | `copySelection` 콜백으로 대체 |
| 이미지 | Kitty graphics, iTerm2 inline | 텍스트 자리표시 |
| 마우스 | SGR 마우스(대체 화면) | 휠·선택 불가 |
| 상태 보고 | OSC 9;4 진행률, OSC 7501 프로그램 상태(지원 응답이 있을 때만) | 생략 |
| 폭 계산 | `get-east-asian-width`로 동아시아 문자 2칸 | - |

- [실험 exp8] `visibleWidth("한국어 abc") = 10`, `truncateToWidth("가나다라마", 5) = "가..."`. `wrapTextWithAnsi("질문 레코드와 가정 만료점", 10)`은 `["질문 레코","드와 가정","만료점"]`으로 한국어 단어 중간에서 줄을 바꾼다. UI 문구가 한국어(결정 37)이므로 TUI 쪽 줄바꿈 품질은 P14·TUI 설계자가 확인할 항목이다.

## 3. pi-protocol (`@earendil-works/pi-protocol`)

### 3.1 패키지 [원문 `protocol/package.json`, `README.md`]

- 1.1.0, MIT, Earendil Works. `exports: { ".": types/import }`. 의존 `@earendil-works/chord ^1.1.0`, `typebox 1.3.27`. engines node >=22.19.0.
- `src/` 8개 파일 869줄: `protocol.ts` 110(스키마), `codec.ts` 141(검증·인코딩·디코더), `framing.ts` 151(길이 접두 프레임), `cbor/{encoder 216, decoder 168, options 52, index 9}`, `index.ts` 22. 테스트 567줄.
- README 마지막 문장: "The protocol is experimental and has no compatibility guarantees." 인증: "Peer authentication and authenticated service contexts are not implemented by the experimental transport."

### 3.2 전송과 프레임 [원문]

- 프레임 = 4바이트 unsigned big-endian 길이 + definite-length CBOR 항목 하나(`framing.ts:27-39`). `FrameDecoder.push(chunk)`는 임의로 쪼개지거나 합쳐진 바이트를 프레임으로 나눈다(`framing.ts:44-130`). 길이 0 프레임도 받는다(`:80-83`). `end()`에서 잘린 프레임이면 실패(`:132-139`). 한 번 실패한 디코더는 다시 쓸 수 없다.
- 기본 한도: 프레임·CBOR 16 MiB(`framing.ts:6`, `cbor/options.ts:6`), 배열·맵 원소 1,000,000개(`:7`), 중첩 깊이 64(`:8`).
- CBOR 부분 구현: 태그 거부(`cbor/decoder.ts:79-80`), 길이 불명(indefinite) 거부(`:113`, `:138-139`), 맵 키는 문자열만·중복 키 거부(`:67-68`), 부동소수는 64비트만(`:90-108`), 안전 정수 범위 밖 거부. 프로토콜 메시지는 다시 `isJsonValue`로 strict JSON인지 검사하므로 바이트 문자열은 envelope에 실을 수 없다(`codec.ts:20-32`).
- 전송 자체는 정하지 않는다("Transports must preserve byte order"). 실제 구현은 pi-server/pi-client의 Unix 소켓뿐이다.

### 3.3 메시지 타입 전체 [원문 `protocol/src/protocol.ts`]

```ts
export const PROTOCOL_VERSION = 8 as const;                                   // :5
type ServerId = string;  // 소문자 UUIDv4 패턴                                  // :12-15
type ProtocolError = { code: string /*minLength 1*/; message: string };       // :21-26
type ServerTarget  = { serverId: ServerId };                                  // :36-38
type SessionTarget = { serverId: ServerId; sessionId: string; attachmentId: string }; // :40-45
type RpcTarget = ServerTarget | SessionTarget;                                // :46-47

// 클라이언트 → 서버 (ClientMessage, :62)
type ClientHello     = { type: "hello"; version: number /*int>=0*/ };         // :29-33 첫 프레임이어야 함
type RequestEnvelope = { type: "request"; id: string; target: RpcTarget; call: JsonValue }; // :49-54
type CancelEnvelope  = { type: "cancel";  id: string; target: RpcTarget };    // :55-59

// 서버 → 클라이언트 (ServerMessage, :98-104)
type ServerHello      = { type: "hello"; version: 8; serverId: ServerId };    // :65-69
type ServerHelloError = { type: "hello_error"; error: ProtocolError };        // :70-73
type ResponseEnvelope =
	| { type: "response"; id: string; ok: true;  result?: JsonValue }
	| { type: "response"; id: string; ok: false; error: ProtocolError };      // :74-87
type ServiceEventEnvelope = { type: "service_update"; subscriptionId: string; update: JsonValue }; // :88-92
type AttachmentEnvelope   = { type: "attachment"; attachment: SessionTarget | null };              // :94-97
```

- 모든 envelope 스키마는 `additionalProperties: false`다(`protocol.ts:9-10`). [실험 exp5] `extra` 속성을 붙인 hello는 `ProtocolValidationError`.
- 구분: 요청(request) → 응답(response, `id`로 짝), 취소(cancel), 이벤트(service_update: 구독 갱신, attachment: 라우트 변경). 서버가 먼저 보내는 요청은 없다(단방향 RPC).
- `call`과 `update`의 내용은 pi-protocol이 해석하지 않는다(opaque strict JSON). 의미는 Chord가 정한다: `call = { serviceId, instance?, member, args }`(`chord/src/types.ts:236-242`), 구독 제어는 `serviceId: "$chord.service"`의 `catalogue` / `subscribe(subscriptionId, serviceId, mode)` / `unsubscribe(subscriptionId)`(`chord/src/services/wire.ts:40-80`).
- 공개 함수(`codec.ts`): `parseClientMessage`(:20), `parseServerMessage`(:27), `encodeClientMessage(message, options?)`(:56), `encodeServerMessage`(:61), `class ClientMessageDecoder { push(chunk): ClientMessage[]; end() }`(:106), `ServerMessageDecoder`(:123), `isSupportedProtocolVersion(v)`(:139, 정확히 8만 허용), `ProtocolValidationError`(:13). 그 밖에 `encodeFrame`, `FrameDecoder`, `FrameError`, `encodeCbor`, `decodeCbor`, `isServerId`.
- 버전 관리: 정수 하나. 서버는 다른 버전이면 `hello_error { code: "version" }`를 보내고 닫는다(`server/src/server.ts:263-268`). 협상·하위 호환은 없다.

## 4. pi-server (`@earendil-works/pi-server`)

### 4.1 패키지 [원문 `server/package.json`, `README.md`]

- 1.1.0, MIT, description "experimental server package for pi". `exports`: `"."`, `"./testing"`, `"./unix"`. 의존 `chord`, `pi-protocol`. 16개 파일 1,958줄: `server.ts` 576, `transports/unix/listener.ts` 421, `session-router.ts` 312, `testing/{host 204, client 183, server 28}`, 타입·오류 파일. 테스트 1,054줄.
- 역할: 연결을 받아 hello를 처리하고, 서버 범위 서비스 호출과 Session 범위 서비스 호출을 앱이 공급한 구현으로 넘긴다. 업무 payload는 해석하지 않는다. 앱 쪽 Session·Harness·worker 수명은 pi-server 밖이다.

### 4.2 공개 API [원문]

```ts
// server/src/types.ts:4-12
export interface ServerOptions {
	listeners: readonly ServerListener[];
	serverId: string;            // 소문자 UUIDv4가 아니면 TypeError (server.ts:560-562)
	maxFrameLength?: number;     // 기본 16 MiB
	handshakeTimeoutMs?: number; // 기본 5,000 (server.ts:42)
	onConnectionCountChanged?: (count: number) => void;
	onError?: (error: Error) => void;
}
export interface SessionMetadata { readonly id: string }                       // :17-19
export interface RoutedSessionAttachment {                                    // :22-30
	invokeService(call: ServiceCall,
		publish: (subscriptionId: string, update: ServiceProviderUpdate, context: Context) => MaybePromise<void>,
		context: Context): Promise<JsonValue | undefined>;
	release(context: Context): MaybePromise<void>;
}
export interface RoutedServerPresentation {                                   // :33-38
	attachSession(sessionId: string, context: Context): Promise<void>;
	detachSession(context: Context): Promise<void>;
	prepareSessionRemoval(sessionId: string, context: Context): Promise<void>;
}
export interface RoutedServerServiceAttachment { /* invokeService, release — 위와 같은 모양 */ } // :41-48
export interface RoutedServerServiceHost {                                    // :50-52
	attachClient(presentation: RoutedServerPresentation, context: Context): MaybePromise<RoutedServerServiceAttachment>;
}
export interface RoutedSessionHandle {                                        // :55-60
	attachClient(context: Context): MaybePromise<RoutedSessionAttachment>;
	readonly terminated?: Promise<Error | undefined>;
	close(context: Context): Promise<void>;
}
export interface ServerHost<TMetadata extends SessionMetadata = SessionMetadata> { // :63-68
	readonly serverServices: RoutedServerServiceHost;
	resolveSession(sessionId: string, context: Context): Promise<TMetadata>;
	openSession(metadata: TMetadata, context: Context): Promise<RoutedSessionHandle>;
}

// server/src/listener.ts:3-8 — 인증은 여기 몫
/** Supplies established byte connections after any required transport authentication. */
export interface ServerListener { start(accept: ByteConnectionAcceptor): Promise<void>; close(): Promise<void>; }

// server/src/connection.ts:7-19
export interface ByteConnection { readonly closed: boolean; send(chunk: Uint8Array): Promise<void>; close(finalChunk?: Uint8Array): MaybePromise<void>; }
export interface ByteConnectionHandler { onData(chunk: Uint8Array): void; onClose(): void; onError(error: Error): void; }
export type ByteConnectionAcceptor = (connection: ByteConnection) => ByteConnectionHandler;

// server/src/server.ts:46-
export class Server<TMetadata extends SessionMetadata = SessionMetadata> {
	readonly serverId: string;
	readonly closed: Promise<void>;
	constructor(host: ServerHost<TMetadata>, options: ServerOptions);
	start(): Promise<this>;
	accept(connection: ByteConnection): ByteConnectionHandler;
	close(): Promise<void>;
}

// server/src/transports/unix/*
export function getUnixSocketPath(serverId: string, serverDirectory: string): string;   // address.ts:4, "<dir>/<serverId>.sock"
export function createUnixListener(options: UnixListenerOptions): ServerListener;      // listener.ts:388
export function createUnixServer<T extends SessionMetadata>(host: ServerHost<T>, options: UnixServerOptions): Server<T>; // preset.ts:7
// UnixListenerOptions (types.ts:3-13): path, mode(기본 0o600), maxPendingBytes(기본 maxFrameLength×4), gracefulCloseTimeoutMs(기본 5,000), maxFrameLength, onError
```

- 오류 코드: Chord `RemoteServiceErrorCode` 8종(`service_not_allowed`, `service_not_found`, `service_mode_mismatch`, `service_member_not_found`, `service_member_mismatch`, `service_instance_not_found`, `service_stale_instance`, `service_invalid_value`; `chord/src/services/errors.ts:1-10`) + 서버 코드 `wrong_server`, `session_not_found`, `session_ambiguous`, `session_not_attached`, `server_draining`(`server/src/errors.ts:3-9`) + `invalid_request`, `cancelled`, `version`, `internal_error`(`server.ts`). 알 수 없는 예외는 `internal_error` / "Internal server error"로 바꿔 내부 정보를 숨긴다(`server.ts:512-521`).
- 테스트 도구(`./testing`): `createTestServer`, `TestServerHost`(`seed(id)`, 게이트로 경합 재현), `TestHarness`, `ProtocolTestClient`, `connectUnixTestClient`, `Deferred`.

### 4.3 연결·세션·구독 동작 [원문 `server/src/server.ts`, `session-router.ts`]

- 연결 상태: `awaitingHello → handshaking → ready → closing → closed`(`connection.ts:21`). 첫 메시지가 hello가 아니면, 또는 hello가 두 번 오면 `invalid_request`로 끊는다(`server.ts:223-245`). 5초 안에 hello가 없으면 끊는다(`:147-153`). 핸드셰이크 중 도착한 요청은 hello가 끝난 뒤 처리한다(`:252-259`).
- 프로토콜 위반 처리: `failProtocol()`은 **핸드셰이크 이후에도** `hello_error`를 마지막 프레임으로 보내고 연결을 닫는다(`server.ts:474-487`).
- 요청 처리: 같은 연결에서 진행 중인 `id`를 재사용하면 거부(`:307-315`). 요청마다 `AbortController`를 두고, `cancel`(같은 target일 때만, `:298-304`)이나 연결 종료(`:422-424`)로 중단한다. 중단된 요청의 응답은 `cancelled`.
- 구독: `subscribe` 제어 호출의 응답(스냅샷)을 보내기 전에 생긴 갱신은 버퍼에 두었다가 응답 직후 보낸다(`:333-344`, `:375-382`). 연결마다·구독마다 Chord `ServiceStateEncoder`를 두어 delta 경로 사전을 따로 관리한다(`:361-363`, `:438-450`). 연결이 끊기면 인코더를 모두 버린다(`:426`).
- Session attachment: 한 연결은 동시에 Session 하나에만 붙는다(`attachmentsByClient: Map<client, attachment>`, `session-router.ts:38`). 같은 Session에 다시 attach하면 아무 일도 하지 않는다(`:163`). 붙을 때마다 서버가 `attachmentId = randomUUID()`를 만들고(`:168`) `attachment` 메시지로 알린다(`:192-196`). Session 요청은 `{serverId, sessionId, attachmentId}`가 현재 attachment와 정확히 같아야 하고, 다르면 `session_not_attached`(`:224-232`). 한 Session에는 여러 연결이 각자 attachment로 붙을 수 있다(`HostedSession.attachments: Set`, `:20-24`).
- 해제: attachment를 풀 때 이미 받아들인 서비스 호출이 끝날 때까지 기다린다(`session-router.ts:234-252`). Session 핸들의 `terminated`가 끝나면 그 Session의 attachment를 모두 푼다(`:293-311`).
- 재접속·재전송: 서버 쪽에 연결을 넘어 남는 상태가 없다. 구독, attachment, 진행 중 요청은 연결과 함께 사라진다(`server.ts:417-436`).
- Unix 리스너: 디렉터리를 0o700으로 만들고(`listener.ts:53`), 남아 있는 죽은 소켓을 지운 뒤 임시 경로에 bind하고 하드링크로 옮긴다(`:46-84`). 소켓 권한 기본 0o600. 연결별 송신 대기 바이트가 `maxPendingBytes`를 넘으면 그 연결을 실패시킨다(`:217-218`).

## 5. pi-client (`@earendil-works/pi-client`)

### 5.1 패키지 [원문 `client/package.json`]

- 1.1.0, MIT. `exports`: `"."`, `"./unix"`, `"./package.json"`. `sideEffects: false`. 의존 `chord`, `pi-protocol`. 8개 파일 1,135줄: `client.ts` 479, `unix.ts` 299, `connection.ts` 245, 나머지 타입·오류. 테스트 799줄.
- 루트 진입점은 브라우저 번들 스모크 대상이다(1.1절). `./unix`는 Node 전용이고 Windows에서는 `discoverUnixServers`가 예외를 던진다(`unix.ts:38`).

### 5.2 공개 API [원문]

```ts
// client/src/types.ts
export type ConnectionState = "disconnected" | "connecting" | "connected";           // :5
export interface ConnectionStateChange { state: ConnectionState; error?: Error }      // :7-10
export interface ServiceSubscription {                                                 // :16-23
	readonly id: string; readonly target: RpcTarget; readonly snapshot: ServiceSubscriptionSnapshot;
	start(): void;            // 스냅샷을 설치한 뒤 갱신 전달 시작
	dispose(): Promise<void>;
}
export interface ClientOptions {                                                       // :25-32
	transportFactory: ByteTransportFactory;
	serverId: string;         // 기대하는 논리 서버 ID. 소문자 UUIDv4가 아니면 TypeError (client.ts:77-79)
	maxFrameLength?: number;
	onListenerError?: (error: Error) => void;
}

// client/src/transport.ts
export interface ByteTransport { send(chunk: Uint8Array): Promise<void>; close(): void; }                 // :1-6
export interface ByteTransportHandlers { onData(chunk: Uint8Array): void; onClose(): void; onError(error: Error): void; } // :8-15
/** Creates a fresh connected, authenticated transport. Exactly one terminal handler is expected. */
export type ByteTransportFactory = (handlers: ByteTransportHandlers) => ByteTransport | Promise<ByteTransport>; // :18

// client/src/client.ts:62-
export class Client {
	static connect(options: ClientOptions): Promise<Client>;                 // :117
	constructor(options: ClientOptions);
	get connectionState(): ConnectionState; get connected(): boolean;
	get serverId(): string; get hello(): ServerHello | undefined; get attachment(): SessionTarget | undefined;
	connect(): Promise<ServerHello>;                                         // :128
	reconnect(): Promise<ServerHello>;                                       // :134-136, connect()와 같음
	disconnect(reason?: string): void;
	onConnectionStateChange(listener): Unsubscribe;
	onAttachmentChange(listener: (attachment: SessionTarget | undefined) => void): Unsubscribe;
	request(target: RpcTarget, call: ServiceCall, signal?: AbortSignal): Promise<JsonValue | undefined>; // :155
	serviceCatalogue(target: RpcTarget, signal?: AbortSignal): Promise<readonly ServiceCatalogueEntry[]>;
	subscribeService(target: RpcTarget, serviceId: string, mode: ServiceMode,
		listener: (update: ServiceProviderUpdate) => void | Promise<void>, signal?: AbortSignal): Promise<ServiceSubscription>; // :172
	dispose(): Promise<void>;  [Symbol.asyncDispose](): Promise<void>;
}
export function createClientServiceTransport(client: Client, getTarget: () => RpcTarget | undefined): RemoteServiceTransport; // :448
export class ServerError extends Error { readonly code: string }   // errors.ts:3
export class DisconnectedError extends Error {}                    // errors.ts:13
export class ClientDisposedError extends Error {}                  // errors.ts:20

// client/src/unix.ts
export function createUnixTransportFactory(options: { path: string; maxPendingBytes?: number }): ByteTransportFactory; // :88
export function discoverUnixServers(options: { directory: string; timeoutMs?: number }): Promise<{ serverId; path }[]>; // :37, 동시 16개 탐색
```

### 5.3 동작 [원문]

- 연결 시 `hello`를 보내고 서버 hello의 `serverId`가 기대값과 같은지 본다(`connection.ts:135-137`, README). 요청 `id`는 `request-<n>`(`client.ts:247`), 구독 `id`는 `service-<n>`(`:179`).
- 응답 짝이 없는 메시지, 다른 서버의 attachment 메시지, 해석할 수 없는 갱신은 연결을 실패시킨다(`client.ts:304-343`).
- 연결이 끊기면 hello·attachment를 지우고 대기 요청을 모두 거부하며 구독 리스너를 모두 지운다(`client.ts:345-351`).
- README: "It never reconnects or replays requests automatically. After disconnection, call `reconnect()`, attach through the application's management service again, and explicitly repeat only operations known to be safe."
- 취소: `AbortSignal`이 발생하면 로컬에서 바로 거부하고 `cancel` 프레임을 보낸다(`client.ts:252-269`).

## 6. Helm 프로토콜(결정 31)과 비교

### 6.1 대응표

| 관심사 | pi (protocol v8 + server + client) | Helm 결정 31·38 | 재사용 판단 [후보] |
|---|---|---|---|
| 전송 | 순서 보장 바이트 스트림이면 무엇이든. 구현은 Unix 소켓만 | WebSocket(Tailscale serve WSS) + SSH 경로(결정 38) | 추상(`ByteConnection`/`ServerListener`, `ByteTransport`/`Factory`)은 참고. 두 경로에서 같은 메시지 의미를 내려면 Helm도 "메시지 경계를 주는 전송 계층"과 "프로토콜 처리기"를 나누면 된다 |
| 프레임 | 4바이트 길이 + CBOR | WebSocket 텍스트 메시지 1개 = JSON-RPC 메시지 1개 | WebSocket에서는 불필요. SSH stdio 경로에서는 경계가 필요하므로 `framing.ts`(151줄)를 그대로 쓰거나 JSON Lines를 쓴다 |
| 인코딩 | CBOR, strict JSON 값만 | JSON | CBOR는 참고만. strict JSON 검사와 한도(16 MiB, 원소 100만, 깊이 64)는 가져올 만하다 |
| 핸드셰이크 | `hello{version}` → `hello{version, serverId}` / `hello_error`, 5초 제한, 첫 메시지 강제 | JSON-RPC 자체에는 없음 | Helm `helm.hello` 요청을 첫 메시지로 강제하고 `protocolVersion`, `deviceId`, `lastSeq`를 보낸다. 응답에 `serverId`와 저장소 식별자(복원된 DB면 seq가 되돌아갈 수 있으므로 epoch 포함)를 넣는다 |
| 요청/응답 | `{type:"request", id, target, call:{serviceId, instance?, member, args[]}}` / `{type:"response", id, ok, result \| error{code:string, message}}` | `{jsonrpc:"2.0", id, method, params}` / `{result}` 또는 `{error:{code:int, message, data}}` | `serviceId.member` → `method`, `args` → `params`. pi의 문자열 오류 코드는 JSON-RPC `error.data.code`에 둔다. 오류 정제(`internal_error`로 숨김)는 가져온다 |
| 취소 | `{type:"cancel", id, target}` | 정의 없음 | 알림 `$/cancelRequest {id}`(LSP 관례 [지식])로 같은 의미를 둔다. 요청별 `AbortController`, 같은 target만 취소, 연결 종료 시 전부 중단도 같게 한다 |
| 이벤트 | `service_update{subscriptionId, update}`, `attachment{...}` | 단조 증가 seq가 붙은 이벤트 알림 | 아래 6.2 |
| 구독 | Chord `$chord.service.subscribe` → 스냅샷 응답, 이후 delta. 응답 전 갱신은 버퍼 | 이벤트 로그 구독 + 화면 투영 | 스냅샷 응답 전 갱신 버퍼링, 구독별 인코더는 가져온다 |
| 재접속 | 없음. 새 연결에서 다시 attach·subscribe, 현재 스냅샷만 받음 [실험 exp7] | `lastSeq`부터 재전송 | Helm이 직접 만든다. pi에서 가져올 코드는 없다 |
| 멱등성 | 없음("안전한 것만 다시 하라") | 정의 필요 | 쓰기 요청에 클라이언트 생성 `requestId`(pi-durable의 submission `requestId`와 같은 생각)를 둔다 |
| 생존 확인 | protocol에 ping 없음(pi-env 프로토콜에는 5초 ping) | 정의 필요 | WebSocket ping 또는 `helm.ping`, SSH 경로는 pi-env처럼 양방향 ping |
| 인증 | 없음. 리스너 몫 | Tailscale 신원 헤더 + 기기 토큰, SSH 키 | 인증을 리스너 단계에서 끝내고 프로토콜 처리기에는 "인증된 연결"만 넘기는 경계는 pi와 같게 둔다 |
| 라우팅 fencing | `serverId` + `sessionId` + `attachmentId`로 늦게 온 프레임 거부 | Concern·WorkUnit 범위 | `attachmentId` 같은 연결 세대 ID를 구독에 붙여, 재접속 전 구독의 늦은 갱신을 버리는 데 쓴다 |
| 흐름 제어 | 연결별 `maxPendingBytes` 초과 시 끊음, Chord 구독별 대기 100개 초과 시 전체 `reset` | 정의 필요 | 둘 다 가져온다. 느린 클라이언트는 끊고 `lastSeq` 재접속으로 따라오게 한다 |
| 버전 | 정수 하나, 정확히 일치해야 함 | 정의 필요 | 같은 방식 + 메서드 추가는 버전 유지, 의미 변경은 버전 증가 |

### 6.2 이벤트 재전송과 상태 복제의 차이

- pi는 "최신 값 복제" 모델이다. Chord `ReplicatedState`는 값이 바뀔 때마다 멤버별 `sequence`와 delta 연산(`["r"|"s"|"d"|"a"|"t"|"p"|"m", ...]`, `chord/src/delta/index.ts:32-41`)을 보낸다. 받는 쪽은 sequence가 이어져야 하고, 구멍이 생기면 `reset` 스냅샷으로 다시 맞춘다(`chord/README.md` "Remote service adapters", `types.ts:221-234`). 재접속 시에는 현재 값의 스냅샷만 받는다 [실험 exp7: 재접속 후 `sequence 4`, ops `[["r", {...}]]`].
- Helm 결정 31은 "이벤트 로그 재전송" 모델이다. 끊긴 동안의 이벤트를 순서대로 다시 받아야 한다.
- 두 모델은 함께 쓸 수 있다 [후보]: (1) 이벤트 로그 구독은 `lastSeq` 재전송, (2) 화면 투영(Concern 목록, 질문 대기열 등)은 스냅샷 + delta. 투영은 재접속 때 스냅샷을 새로 받아도 의미가 같다. Chord delta 연산 형식은 불변 값과 구조 공유(structural sharing)를 전제로 하므로 React 18의 참조 비교와 맞는다 [지식]. P12·P13이 투영 동기화 형식을 정할 때 비교 대상으로 쓴다.
- Chord `ReplicatedStateSource`(`chord/src/types.ts:74-107`)는 "단조 증가 cursor, 스냅샷 다음 첫 frame은 `cursor + 1`, 겹침·구멍 없음"을 계약으로 적는다. Helm 이벤트 로그 구독의 계약 문구로 그대로 옮겨 쓸 만하다.

## 7. chord (`@earendil-works/chord`)

### 7.1 패키지 [원문 `chord/package.json`, `README.md`, `PLANNING.md`]

- 1.1.0, MIT, Earendil Works. 설명 "Application composition runtime for services, replicated state, RPC, and plugins". `exports`: `"."`, `"./context"`, `"./delta"`, `"./bundler"`, `"./node"`, `"./package.json"`(각 항목에 `"source"` 조건). `sideEffects: false`. 의존 `esbuild 0.28.2` 하나.
- **CHANGELOG 파일이 없다.** `PLANNING.md` 상태 문구: "This is not a stable public API contract yet." "Symmetric RPC and structural generation replacement remain planned."
- 29개 파일 8,817줄: `delta/tracker.ts` 2,205, `facets/host.ts` 906, `services/consumer.ts` 713, `delta/index.ts` 694, `services/provider.ts` 633, `delta/diff.ts` 523, `services/state.ts` 457, `node/bundle-loader.ts` 416 등. 테스트 9,726줄.
- pi 의존 없음(PLANNING §2가 금지 규칙으로 둠). Node 전용 코드는 `src/node/`에만 있고(`node:` import가 있는 파일은 `node/package.ts`, `node/bundle.ts`, `node/bundle-loader.ts`), 루트 진입점은 플랫폼 중립이다 [원문 grep].
- 사용처: pi-protocol, pi-server, pi-client, pi-durable, pi-env, pi-coding-agent의 의존이다.

### 7.2 공개 API [원문 `chord/src/index.ts:4-85`, `api.ts`, `types.ts`]

```ts
// 조립
export function createFacetHost(options: { facets: readonly Facet[]; serviceSources?: readonly RemoteServiceSource[]; onError? }): Promise<FacetHost>; // api.ts:22
export function defineFacet(facet: Facet): Facet;                                  // api.ts:69
export interface Facet { readonly id: string; setup(env: FacetEnvironment): void }  // types.ts:303-306
export interface FacetEnvironment {                                                 // types.ts:281-301
	use<T>(service: Service<T>): T;
	observe<T>(service: Service<T>, handler: (service: T, context: Context) => void | Promise<void>): void;
	provide<T>(service: Service<T>, implementation: NoInfer<T>): void;
	provideMany<T>(service: Service<T>): ServiceSpawner<T>;
	replicatedState<T extends object>(initial: T): MutableReplicatedState<T>;
	own(disposal: () => void | Promise<void>): void;
	onActivate(cb: () => void | Promise<void>): void;
	onDeactivate(cb: () => void | Promise<void>): void;
}
export interface FacetHost { readonly services: RemoteServiceProvider; reload(facets: readonly Facet[]): Promise<void>; dispose(): Promise<void> } // types.ts:325-330

// 서비스
export function defineService<T>(id: string, options?: { local?: boolean }): Service<T>; // api.ts:73-85, "$chord." 접두는 예약
export type ServiceMode = "singleton" | "keyed";                                         // types.ts:123
// 원격 서비스 계약: 멤버는 (…JSON 인자, Context) => Promise<JSON|void> 메서드이거나 ReplicatedState<JSON>만 (types.ts:164-182)

// 복제 상태
export interface ReplicatedState<T> { readonly value: T | undefined;                     // types.ts:43-57
	subscribe(listener: (value: T, context: Context, delivery: { kind: "hydrate" | "update"; sequence: number }) => void | Promise<void>): () => void; }
export interface MutableReplicatedState<T extends object> extends ReplicatedState<T> {     // types.ts:59-71
	readonly value: T; change(context: Context, mutate: (draft: Draft<T>) => void): void; replace(context: Context, value: T): void; }
export function replicatedState<T extends object>(initial: T): MutableReplicatedState<T>; // api.ts:99

// 원격 경계 (전송은 앱이 공급)
export interface RemoteServiceTransport {                                                // types.ts:259-267
	invoke(call: ServiceCall, context: Context): Promise<JsonValue | undefined>;
	subscribe(serviceId: string, mode: ServiceMode, listener: (update: ServiceProviderUpdate, context: Context) => void, context: Context): Promise<ServiceSubscription>;
}
export function createRemoteServiceBinding(options: { services; transport: RemoteServiceTransport; bound?; onError?; assertAccess? }): RemoteServiceBinding; // api.ts:87
export function createRemoteServiceEndpoint(provider: RemoteServiceProvider): RemoteServiceEndpoint; // services/provider.ts:549-585
export function createServiceStateEncoder(): ServiceStateEncoder; export function createServiceStateDecoder(): ServiceStateDecoder;
export type ServiceProviderUpdate =                                                      // types.ts:221-234
	| { type: "state"; instance?; member: string; sequence: number; ops: readonly Op[] }
	| { type: "reset"; snapshot: ServiceSubscriptionSnapshot }
	| { type: "unavailable" } | { type: "replaced"; snapshot } | { type: "spawned"; instance } | { type: "closed"; instance };

// 문맥 (Go의 context와 비슷): @earendil-works/chord/context
export const BACKGROUND_CONTEXT: Context; export const TODO_CONTEXT: Context;          // context/index.ts:55-56
export function createContextKey<T>(description: string): ContextKey<T>;               // :58
export function withContextValue<T>(key, value: T, parent: Context): Context;           // :63
export function withAbortSignal(signal: AbortSignal, context: Context): Context;       // :71
export function withCancel(context: Context): { context; cancel };                     // :83
export interface Context { readonly abortSignal: AbortSignal | undefined; value<T>(key: ContextKey<T>): T | undefined } // types.ts:15-19

// delta: @earendil-works/chord/delta
export function track(initial): Tracker; // beginChange → prepare → adopt
export function applyImmutable<T>(target: T | undefined, ops: readonly Op[]): T;
export type Op = ["r", v] | ["s", path, v] | ["d", path] | ["a", path, str] | ["t", path, n] | ["p", path, i, del, items] | ["m", path, perm]; // delta/index.ts:32-41
// WireOp: 두 번째 쓰임부터 경로를 숫자 id로 바꾸는 압축 (delta/index.ts:52-66)
```

- 흐름 제어: 제공자 구독은 대기 갱신을 100개까지 둔다. 101번째가 오면 대기열 전체를 `{ type: "reset", snapshot }` 하나로 바꾼다(`README.md`, `services/provider.ts:453`). 공개 `state.subscribe`도 대기 100개를 넘으면 가장 새 값만 남겨 sequence를 건너뛸 수 있다(`types.ts:49-54`).
- 불변 값 계약: 값을 얼리지(freeze) 않고 복사하지도 않는다. 넘긴 값을 바꾸면 조용히 상태가 깨진다(`delta/README.md` 첫 절).
- 번들러(`./bundler`, `./node`): 플러그인 facet을 esbuild로 CommonJS 파일로 묶고, SHA-256 무결성을 확인한 뒤 `node:vm`으로 읽는다. Helm이 쓸 일은 적다.
- [실험 exp7] `defineFacet` + `env.replicatedState` + `env.provide`로 만든 서비스를 `createRemoteServiceEndpoint`로 pi-server에 연결하고, 클라이언트에서 `createRemoteServiceBinding` + `createClientServiceTransport`로 받았다. 하이드레이트 후 `hydrate#1`, `update#2`, `update#3` 순서로 전달됐다. 재접속 뒤 기존 binding에 `rebind(false)` → `rebind(true)`를 하면 서버가 "Service subscription was not found"를 내고 `AggregateError("Failed to rebind services")`로 실패했다(옛 연결의 구독 해제를 새 연결로 보냄). 새 binding을 만들면 현재 값으로 하이드레이트됐다. 즉 재접속 후 binding 복구도 앱이 처리해야 한다.

## 8. pi-env (`@earendil-works/pi-env`)

- 1.1.0, MIT. 설명 "Remote execution environments for Pi Durable: a small daemon deployed over SSH and its ExecutionEnv client". `exports: "."`. 의존 `chord`, **`pi-durable`**. files에 `bin`(플랫폼별 데몬 바이너리, 소스 트리에는 없음)이 있고 npm 1.1.0 unpacked 크기는 8,818,361바이트 [원문][실험 `npm view`]. npm 버전: `0.0.0-stage`, `0.0.1`, `1.0.4`, `1.1.0`. CHANGELOG 첫 항목 1.0.4(2026-10-05) "Initial release".
- 구성: TS 6개 파일 2,073줄(`remote-env.ts` 939, `ssh.ts` 530, `connection.ts` 384, `watch.ts` 158), Rust 데몬 `daemon/src` 약 4,039줄, 문서 `docs/protocol.md`, `docs/semantics.md`.
- 공개 API(`env/src/index.ts`): `class RemoteExecutionEnv implements ExecutionEnv`(`remote-env.ts:351`, 옵션 `{ connection, id, cwd, shellPath?, shellEnv?, watch? }` `:48-58`), `class Connection`(`connection.ts:168`, 옵션 `{ command: string[] | () => Promise<string[]>, onLog? }` `:53-61`), `connectSsh`(`ssh.ts:523`), `sshConnection`(`:510`, 첫 작업 때 연결), `scanHostKey`, `acceptHostKey`, `forgetHostKey`, `detectPlatform`, `deployDaemon`, `packagedDaemon`, `sshArguments`, `RemoteWatcher`, 오류 `HostKeyChangedError`, `HostKeyUnknownError`, `SshError`, `RemoteError`, `isConnectionLost`. `SshTarget { host, user?, port?, identityFile?, knownHostsFile, hostKeyAlias, ssh?, configFile? }`(`ssh.ts:23-37`).
- 와이어 프로토콜 v1(`docs/protocol.md`): 클라이언트가 `pi-env serve --token <hex>`를 ssh로 띄우고, 데몬의 첫 출력 줄 `PI-ENV <token>` 앞의 stdout은 버린다(셸 시작 파일 잡음 제거). 프레임 `u32 length, u8 type, u32 id, u32 jsonLength, json, bytes`, 최대 16 MiB. type 1 request, 2 result, 3 error, 4 event(진행), 5 cancel, 6 ping. 오류 `{ code, message, syscall?, path? }`, 코드만 계약. 양쪽이 5초마다 ping, 데몬은 30초 무수신이면 시작한 프로세스 그룹을 모두 죽이고 종료. 응답·ping은 대량 출력보다 먼저 보냄. ssh는 `BatchMode`, 앱 전용 known_hosts와 고정 alias로 엄격한 호스트 키 검사, 포워딩·공유 연결 없음(README).
- Helm 관련 [원문 판단]: `ExecutionEnv`는 pi-durable 인터페이스다. Helm은 pi-agent-core + coding-agent 도구(`*Operations` 인터페이스)를 쓰므로, pi-env를 쓰려면 `ExecutionEnv` → `ReadOperations`/`BashOperations` 어댑터가 필요하고 pi-durable 패키지도 설치된다. 데몬 바이너리 배포(8.8 MB)도 따라온다.

## 9. pi-evals (`@earendil-works/pi-evals`)

- `private: true`, 버전 1.1.0, npm 미배포(404) [실험]. CHANGELOG·LICENSE 파일 없음. 모든 의존이 devDependencies: `pi-ai`, `pi-coding-agent`, `vitest-evals 0.15.0`, `@vitest-evals/core 0.15.0`, `autoevals 0.3.0`, `vitest 4.1.11`.
- 하는 일: pi coding agent의 행동 평가. `evals/*.eval.ts`는 호스트에서 Vitest로 도는 일반 스위트(smoke, documentation-audit), `*.docs.eval.ts`는 문서 유무(`without_docs`/`with_docs`) 두 Docker 이미지에서 같은 사례를 돌려 통과율 차이(lift)를 잰다. 한 쌍 중 하나라도 실패·누락이면 그 쌍을 집계에서 빼고 헤드라인 수치를 보류한다. 결과는 `.eval/<timestamp>_<id>/`에 `protocol.json`, `expected-runs.json`, `observations.jsonl`, 세션 JSONL, `report.json` [원문 `evals/README.md`].
- 어댑터: `createPiCodingAgentHarness(options?)`(`src/harness.ts:471-475`)는 coding-agent `AgentSession`(`createAgentSessionFromServices`)으로 한 사례를 돌린다. 실제 provider가 필요하다(`PI_PROVIDER`, `PI_MODEL`).
- 크기: `src/` 5개 파일 1,446줄(`cli.ts`, `docker.ts`, `plan.ts`, `report.ts`, `harness.ts`), `evals/` 약 860줄, `docker/`.
- Helm 관련: 코드 재사용 대상은 아니다. "쌍으로 비교하고 결측은 0으로 치지 않는다", "실행 계획을 먼저 고정한다" 같은 평가 절차는 관찰 에이전트의 반증 측정(16)과 테스트 전략(22)에서 참고할 수 있다.

## 10. pi-telemetry (`@earendil-works/pi-telemetry`)

- 1.1.0, MIT, Mario Zechner. `exports`: `"."`, `"./testing"`. **런타임 의존 없음**. 6개 파일 935줄(`index.ts` 357, `memory.ts` 219, `testing/conformance.ts` 315, `noop.ts` 20). 테스트 243줄.
- pi-ai가 의존한다: `StreamOptions.telemetryContext?: TelemetryContext`(`ai/src/types.ts:1`, `:160`). 그래서 pi-ai를 쓰면 pi-telemetry가 함께 설치된다 [원문][실험 설치본].
- 공개 API(`telemetry/src/index.ts`):

```ts
export type AttributeValue = string | number | boolean | readonly string[] | readonly number[] | readonly boolean[]; // :1
export interface SpanOptions { name: string; attributes?: SpanAttributes }                                         // :7-10
export type SpanStatus = { status: "ok" } | { status: "error"; error?: { name: string; message: string } };       // :12
export interface TelemetryContext { startSpan<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> } // :14-16
export interface TelemetrySpan extends TelemetryContext {                                                          // :18-22
	addEvent(name: string, attributes?: SpanAttributes): void; setAttributes(attributes: SpanAttributes): void; setStatus(status: SpanStatus): void; }
export { NOOP_TELEMETRY_CONTEXT } from "./noop.ts";                                                                 // :24
export function defineTelemetrySchema<const T extends TelemetrySchemaDefinition>(schema: T): T;                     // :72
export function createTypedSpanStarter<const Schemas extends TelemetrySchemaTuple>(ctx: TelemetryContext, schemas): TypedSpanStarter<Schemas>; // :349
export { InMemoryTelemetryContext } from "./memory.ts";                                                             // :357
// ./testing: 어댑터 적합성 검사(conformance)
```

- 특징: span은 콜백 범위로만 열고 닫는다(공개 `end()` 없음). 전역 "현재 span" 상태가 없고 부모 문맥을 명시적으로 넘긴다. 스키마는 타입 추론용이며 런타임 검증은 하지 않는다(`index.ts:345-348`). 속성 메타데이터에 `sensitive`, `cardinality`. 내보내기(exporter)는 없다. README는 "A span is diagnostic data, not business state."라고 적는다.
- Helm 관련: 진단용으로 그대로 쓸 수 있다. Helm 이벤트 로그(기준 원본)와 섞지 않는다.

## 11. pi-lab 실험 재실행 [실험]

- 환경: WSL2 Ubuntu, Node v24.19.0, npm 11.17.0. `experiments/pi-lab`에서 설치. 설치된 버전: chord, pi-agent-core, pi-ai, pi-client, pi-coding-agent, pi-durable, pi-protocol, pi-server 모두 1.1.0(전이 의존으로 pi-tui, pi-codemode, pi-mcp, pi-telemetry 1.1.0). pi-env는 pi-lab 의존에 없어 설치되지 않았다.
- 설치 경위: 처음 `npm install`을 `experiments/pi-lab`에서 실행했을 때 Helm 저장소 루트 `package.json`의 `workspaces: ["experiments/*", ...]` 때문에 루트에 `node_modules/`와 `package-lock.json`이 생겼다. 이 둘을 지우고 `npm install --prefix <pi-lab> --no-workspaces`로 다시 설치해 `experiments/pi-lab/node_modules`와 `experiments/pi-lab/package-lock.json`만 남겼다. npm 11은 esbuild·protobufjs 등의 install script를 allow-scripts 정책으로 실행하지 않았고, 실험에는 영향이 없었다.
- API 키는 쓰지 않았다(faux provider).

| 실험 | 결과 | 출력 요지 | 1.1.0에서 깨진 부분 |
|---|---|---|---|
| exp1-core (agent-core + faux + coding-agent `createReadTool`/`createBashTool`) | 성공, 종료 0 | 이벤트 순서 `agent_start, turn_start, message_*, tool_execution_start×2, tool_execution_end×2, …, agent_end`. `beforeToolCall`에서 bash 차단 → toolResult `isError:true`, 내용 "kernel policy: bash denied". 차단된 bash에는 `afterToolCall` 기록 없음. roles `system,user,assistant,toolResult,toolResult,assistant`. `state.messages` JSON 왕복 후 새 `Agent`로 이어서 실행, `systemPrompt: test` 복원 | 없음 |
| exp2-handoff (Context 직렬화 후 다른 provider로) | 성공 | A 응답 usage 기록, `durationMs=2`, frame 5개를 `reduceAssistantMessageFrames`로 복원 → `["thinking","text"]`. B가 받은 assistant 내용 타입 `["thinking","text"]` | 없음. 참고: faux provider(`ai/src/providers/faux.ts`)는 `transformMessages`를 호출하지 않으므로, 이 실험으로는 API 간 thinking 변환(`ai/src/api/transform-messages.ts`)을 확인할 수 없다 |
| exp3-sdk (`createAgentSession` + 인라인 확장) | 성공 | `tool_call`에서 bash 차단, read 입력 `nope.txt`를 `a.txt`로 바꿔 성공. `agent_settled`에서 `appendEntry` → JSONL 마지막 `custom:helm-audit`. `SessionManager.open()`으로 다시 열어 이어서 응답 | 없음(`pi-ai/compat`의 `registerFauxProvider`, `ModelRuntime.create`, `registerProvider` 그대로 동작) |
| exp4-durable (pi-durable SQLite, 도구 실행 중 `process.exit`) | 성공. crash 단계 종료 9(의도), resume 단계 종료 0 | `settled: done`, 엔트리 `pi.user pi.system pi.assistant pi.tool-result pi.assistant`, 도구 결과 `diagnostics: interrupted "Tool slow was interrupted and may have partially run"`, 재개 프로세스의 `beforeTool` 호출 0회 | 없음. DB는 `.helm-design-work/S3b/exp4.sqlite` |
| exp5-proto (pi-protocol 인코딩) | 성공 | `version 8`, frame 25바이트, 길이 접두 21, 첫 CBOR 바이트 `0xa2`(맵 2개 항목). 반쪽 push → 0개, 나머지 push → hello 1개. 알 수 없는 속성 → `ProtocolValidationError` | 없음 |
| exp6-tui (coding-agent `AssistantMessageComponent`를 JSON 메시지로 렌더링) | 성공 | 50칸에서 7줄. 마크다운 제목·굵게가 렌더링됨. 출력에 OSC 133 마커(`]133;A`, `]133;B`, `]133;C`)가 섞여 있다(스크립트의 정규식이 OSC 133을 지우지 않음) | 없음 |

추가 실험(이 문서용, 코드 `.helm-design-work/S3b/`):

| 실험 | 결과 | 출력 요지 |
|---|---|---|
| exp7-server-client (pi-server + pi-client + chord, 메모리 내 바이트 전송) | 성공 | hello `{version:8, serverId}`. 서버 범위 호출 `bump` → 1. 복제 상태 하이드레이트 `{"seq":1,"events":[7]}`, 이후 `hydrate#1 update#2 update#3`. attach 후 `attachment` 수신, Session 호출 `{"ok":true}`. 낡은 `attachmentId` → `ServerError session_not_attached`, 다른 serverId → `wrong_server`. `disconnect` 후 상태 `disconnected`, attachment 없음, 호출은 `DisconnectedError`. `reconnect` 후 attachment 자동 복구 없음. 기존 binding `rebind`는 `AggregateError`, 새 binding은 현재 값으로 하이드레이트. 재구독 스냅샷은 `sequence 4`, ops `[["r", 전체값]]`(중간 갱신 재전송 없음). 전체 왕복 바이트 약 1.9 KB / 1.7 KB |
| exp8-tui (pi-tui, 가짜 Terminal) | 성공 | 2.3·2.4·2.6절에 적은 결과(차등 렌더 316 → 70바이트, 한국어 폭, SelectList·Editor 입력, Markdown) |

## 12. 기존 문서 주장 판정 (담당 8개 패키지)

판정: 확인 / 불일치 / 확인 불가. "부분"은 대체로 맞지만 고칠 점이 있는 경우다.

### 12.1 `docs/design/process/sources/pi-layer-analysis.md`

| 위치 | 주장 | 판정 | 근거 |
|---|---|---|---|
| §1 표 머리 | 모든 패키지 lockstep 1.1.0 | 확인 | 8개 `package.json` 모두 `1.1.0` |
| §1 tui | 19,505줄, 차등 렌더링 터미널 UI | 확인 | `src/**/*.ts` 19,505줄 |
| §1 chord | 8,817줄, facet·service·replicated state·delta, pi 의존 없음, 2026-09 신규 | 확인 | 8,817줄. 의존 esbuild뿐. npm 생성 2026-09-04 |
| §1 protocol | 869줄, 길이 프리픽스 + CBOR envelope, v8, experimental | 확인 | `protocol.ts:5`, README |
| §1 client | 1,135줄, Unix 소켓 transport, discovery | 확인 | `client/src/unix.ts:37,88` |
| §1 server | 1,958줄, Unix listener, multi-attachment | 확인 | `session-router.ts:20-24` |
| §1 env | 2,073줄, pi-durable용 원격 실행 환경, SSH 배포 Rust 데몬, `RemoteExecutionEnv`, 2026-10 신규 | 확인 | `env/README.md`, npm 생성 2026-10-05 |
| §1 telemetry | 935줄, 벤더 중립 span 계약, in-memory 어댑터 | 확인 | `telemetry/src/index.ts`, `memory.ts` |
| §1 evals | 1,446줄, vitest-evals, Docker, private | 확인 | `evals/package.json`, `src/` 1,446줄 |
| §5 모델 | `Component.render(width): string[]`, `handleInput`, `invalidate` | 확인 | `tui.ts:117-142`(그 밖에 `handleMouse`, `wantsKeyRelease`) |
| §5 모델 | `TuiMainScreen`(scrollback), `TuiAltScreen`(`VStack`/`HStack`/`ScrollView`), 차등 렌더링, CSI 2026 | 확인 | 2.2·2.3절 |
| §5 모델 | 컴포넌트에 `Overlay` 포함 | 부분(불일치) | `Overlay` 클래스는 없다. 오버레이는 `TUI.showOverlay()` API다(`tui.ts:478`). 목록에서 빠진 것: `Input`, `TruncatedText`, `Spacer`, `MouseRegion`, `CancellableLoader`, `ScrollView` 등 |
| §5 모델 | `Terminal` 교체 가능, `VirtualTerminal`(테스트) | 부분(불일치) | `Terminal` 인터페이스는 맞다(`terminal.ts:78-126`). `VirtualTerminal`은 `test/virtual-terminal.ts`에만 있고 패키지 export에 없다. 또 1.1.0부터 `Terminal` 구현은 `setProgramStatus` 필수 |
| §5 의존성 | `get-east-asian-width`, `marked` 두 개 | 확인 | `tui/package.json`. 덧붙임: 네이티브 프리빌드 `.node` 파일이 tarball에 포함 |
| §5 화면 재사용 | coding-agent가 `AssistantMessageComponent` 등 export, JSON 메시지만으로 렌더링 [실험 exp6] | 확인 | `coding-agent/src/index.ts:435-479`, exp6 재실행 |
| §5 화면 재사용 | `createInteractiveTui`, `createChatViewport` export 안 됨 | 확인 | 정의는 `modes/interactive/tui-renderer.ts:19`, `chat-viewport.ts:22`. index와 `exports`에 없음 |
| §5 | 예제 `tui/test/chat-simple.ts` | 확인 | 파일 존재 |
| §4 experimental server/client | Chord facet 서비스 `SessionDirectory`, `SessionManagement`, `AgentController`, `Transcript`, `Models`, `SlashCommands` | 확인 | `defineService("pi.session-directory" … "pi.local.slash-commands")`(coding-agent `src/experimental/services/*.ts`). 이 밖에 `pi.presentation-plugins`, `pi.session-plugins`, `pi.local.presentation-ui` |
| §4 | Radius relay WebSocket subprotocol `pi-session-relay.host.v1` | 확인 | `coding-agent/src/experimental/radius-relay.ts:7` |
| §4 | TODO: 트리 탐색, next-run 큐, subagent 노출, transcript 페이징 | 확인 | `coding-agent/src/experimental/services/README.md:38-45` |
| §4 | npm `files`에서 제외 | 확인 | `coding-agent/package.json:29-39`(`!dist/experimental`, `!dist/client`). pi-server/client/protocol은 coding-agent의 devDependency일 뿐 dependency가 아니다 |
| §4 | `PI_EXPERIMENTAL=1 ./pi-test.sh server\|client`로 실행 | 확인 불가 | `pi-test.sh` 본문에서 server/client 분기를 찾지 못했다. `PI_EXPERIMENTAL`은 `coding-agent/src/core/experimental.ts`에 있다. coding-agent 담당(pi-api-facts-1) 확인 사항 |
| §7 프로토콜 | v8, 4바이트 big-endian 길이 + definite-length CBOR, 한도 16 MiB, payload strict JSON, 의미는 Chord `{serviceId, member, args}` | 확인 | 3.2·3.3절(정확히는 `instance?`도 있음) |
| §7 attachment | `{serverId, sessionId, attachmentId}`, 세션당 여러 개 | 확인 | `protocol.ts:40-45`, `session-router.ts:20-24`. 덧붙임: 연결 하나는 Session 하나에만 붙는다 |
| §7 transport | Unix 소켓(`createUnixServer`, `createUnixTransportFactory`, `discoverUnixServers`), Radius relay는 coding-agent experimental에만 | 확인 | 4.2·5.2절, `radius-relay.ts`. 덧붙임: Radius relay는 게이트웨이에 Bearer 토큰을 보낸다(`radius-relay.ts:646`). 피어 인증과는 다른 것이다 |
| §7 인증 | "Peer authentication ... not implemented" | 확인 | `protocol/README.md`, `server/README.md` |
| §7 호스팅 | 앱이 `ServerHost{resolveSession, openSession}`을 공급, 서버는 라우팅만 | 부분 | 맞다. 다만 `serverServices: RoutedServerServiceHost`도 필수다(`types.ts:63-68`) |
| §7 client | `Client.connect({serverId, transportFactory})`, `request()`, `subscribeService()`, 자동 재연결·재전송 없음 | 확인 | 5.2·5.3절, [실험 exp7] |
| §7 chord | facet, service(singleton/keyed), replicated state, delta codec, pi 의존 없음, esbuild만 사용 | 확인 | 7절 |
| §8 | 모든 패키지 동일 버전, 1.0.0은 2026-10-01 | 확인 | CHANGELOG |
| §8 | 핵심 패키지 0.74.0~1.1.0 사이 58개 버전 | 확인 | pi-ai 정식 버전 58개(레지스트리), pi-tui도 58개 |
| §8 | patch에도 breaking: pi-ai 1.0.3 Azure, 1.1.0 stream 반환 타입, agent-core 0.87.0 `shouldStopAfterTurn` 제거 | 부분 | 세 항목 모두 CHANGELOG에 있다(`agent/CHANGELOG.md:46`). 다만 1.1.0과 0.87.0은 minor 릴리스다. patch에서 깨진 예는 1.3절 표(1.0.1 mcp, 1.0.3 ai/coding-agent/durable, 1.0.4 durable)가 더 정확하다 |
| §8 | Breaking 절 수 coding-agent 49, pi-ai 27, agent-core 13 | 확인 | grep 집계(Unreleased 포함) |
| §9 (f) | server/client/protocol: 라우팅, CBOR framing, multi-attachment / 서버 앱·인증·UI 직접 구현 | 확인 | 4·5절 |
| §10 | OpenClaw는 pi-tui만 유지 | 확인 | `~/projects/_ref/openclaw/package.json:2269` `"@earendil-works/pi-tui": "1.0.0"`, 다른 pi 패키지 없음. 쓰는 API: `Container`, `Text`, `Box`, `Spacer`, `Markdown`, `SelectList`, `Input`, `Loader`, `TuiMainScreen`, `ProcessTerminal`, `matchesKey`, `getKeybindings`, `visibleWidth` 등 |

### 12.2 `docs/v0.3/audit/pi-runtime-options.md`

| 위치 | 주장 | 판정 | 근거 |
|---|---|---|---|
| §1 표 | pi-tui 19,505줄, 차등 렌더링, 의존성 2개, 안정 계열 | 확인 | 2.1절 |
| §1 표 | chord 8,817줄, 서비스·복제 상태, 2026-09 신규 | 확인 | 7.1절 |
| §1 표 | server/client/protocol 약 4,000줄, Experimental, 인증 미구현 | 확인 | 869 + 1,135 + 1,958 = 3,962줄 |
| §1 표 | pi-codemode, pi-mcp, pi-env, pi-telemetry는 독립 사용 가능 | 부분(pi-env 불일치) | pi-telemetry는 런타임 의존이 없다. pi-env는 pi-durable과 chord에 의존하고 pi-durable `ExecutionEnv`를 구현한다(`env/package.json`, `remote-env.ts:351`). codemode·mcp는 담당 밖 |
| §1 사실 | pi 팀의 데몬 구조(`pi server`/`pi client`)는 세션별 worker가 pi-durable을 연다. npm 배포물에 없고 소스로만 실행 | 부분 | 앱 계층(coding-agent `src/experimental`)은 npm에서 빠진다(`coding-agent/package.json:29-39`). 그러나 라이브러리 pi-server·pi-client·pi-protocol은 npm 1.1.0으로 배포되어 있다 [실험 pi-lab 설치]. 문장을 "앱 계층은 미배포, 라이브러리는 배포"로 고쳐야 한다 |
| §2 표 | pi-tui만 쓰는 사례 OpenClaw(현재) | 확인 | 12.1 §10 행 |
| §3 안 3 | 터미널 클라이언트는 pi-tui + coding-agent가 export한 메시지 컴포넌트, JSON 메시지만으로 렌더링 [실험] | 확인 | exp6 재실행. 단, 메시지 컴포넌트를 coding-agent 루트에서 가져오면 coding-agent 런타임 의존 전체가 설치된다 |
| §3 안 6 | npm 배포물에 없음, 피어 인증 없음, 호환성 보장 없음, 트리 탐색·하위 에이전트·transcript 페이징 TODO | 부분 | 인증 없음·보장 없음·TODO는 확인. "npm 배포물에 없음"은 앱 계층에만 맞다(위 행) |
| §3 안 6 | 세션별 worker, 세션별 SQLite, 복제 상태 전달 구조는 설계 참고 가치 | 확인(판단) | 복제 상태 전달은 [실험 exp7]로 확인 |
| §6 | 남은 확인: 버전 고정, import 무결성 테스트 | 해당 사항 | 1.3절의 patch breaking 목록이 근거가 된다 |

### 12.3 `docs/v0.3/audit/backend-oss-research.md`

| 위치 | 주장 | 판정 | 근거 |
|---|---|---|---|
| §0.2 | pi-server, pi-client, pi-protocol 패키지가 생겼다. 데몬 하나에 여러 클라이언트, 모두 experimental, 피어 인증 없음 | 확인 | 3·4·5절, README |
| §0.2 | coding-agent 안의 durable 모드, 세션 하나 = SQLite 파일 하나, 크래시 후 `--continue`로 턴 이어 감 | 확인 불가(담당 밖) | coding-agent `src/experimental/durable`. pi-api-facts-1 담당 |
| §1.1 표 "pi-durable + pi-server" 행 | CBOR 프레임(unix, Radius relay), 피어 인증 미구현, MIT/TS, 1.1.0 experimental | 확인 | 3·4절, `radius-relay.ts:7` |
| 같은 행 | 판정 "재사용" | 판단 충돌 | 브리프 결정 29(pi-durable 저장소를 기준 원본으로 쓰지 않음)와 맞지 않는다. 또 pi-server는 pi-durable에 의존하지 않는다(`server/package.json`). 두 패키지를 묶은 "pi-durable + pi-server"는 coding-agent 실험 서버의 조합이다 |
| §1.1 "pi RPC 모드" 행 | stdin/stdout JSONL, 인증 없음 | 확인 불가(담당 밖) | pi-api-facts-1 담당 |
| §3 표 | pi RPC는 런타임 직접 어댑터 | 확인 불가(담당 밖) | - |
| §6.7 | 미확인: pi-server/pi-client를 Helm 데몬 기반으로 쓸 수 있는지 | 이번에 확인 | 기술적으로는 가능하다: `ServerListener`로 WebSocket·SSH 리스너를 더하고 인증을 리스너에서 처리하면 된다. 그러나 (1) 메시지 의미가 Chord 서비스 모델에 묶이고, (2) 결정 31의 JSON-RPC·`lastSeq` 재전송과 형식이 다르며, (3) experimental·호환 보장 없음·chord CHANGELOG 없음이다. 기반으로 쓰기보다 설계 참고로 둔다(13절) |

## 13. Helm 관점 메모 [후보]

| 패키지 | 그대로 가져올 것 | 고쳐 쓸 것 | 참고만 할 것 | 이유 |
|---|---|---|---|---|
| pi-tui | 패키지 전체를 정확한 버전으로 고정 의존(`"@earendil-works/pi-tui": "1.1.0"`). `TuiMainScreen`/`TuiAltScreen`, `Editor`, `Input`, `Markdown`, `SelectList`, `SettingsList`, `Loader`, `Box`/`Text`, 오버레이, `KeybindingsManager`, `matchesKey`, `visibleWidth` 계열 | coding-agent의 메시지 컴포넌트(`AssistantMessageComponent`, `ToolExecutionComponent`, `UserMessageComponent`, `FooterComponent`)는 coding-agent 루트를 의존하지 말고 필요한 파일만 `@helm/tui`로 복사해 고친다(LICENSE 고지 포함) | `createInteractiveTui`, `createChatViewport` 화면 조립 방식 | 의존이 작고, OpenClaw처럼 끝까지 남은 사례가 있다. 렌더러·입력·IME·SSH ESC 처리 같은 터미널 세부를 다시 만들 이유가 적다. coding-agent 루트 의존은 무겁다 |
| pi-protocol | `framing.ts`의 `FrameDecoder`/`encodeFrame`(SSH stdio 경로를 길이 접두 프레임으로 정할 때만. 151줄, 의존 없음) | - | CBOR 코덱, envelope 스키마, strict JSON 검사·한도, `hello`/`hello_error`/버전 정수 규칙 | 결정 31이 JSON-RPC 2.0 + WebSocket이므로 envelope는 맞지 않는다. 프레임 분할기만 전송 독립적으로 쓸모가 있다 |
| pi-server | - | - | 연결 상태 기계, 5초 핸드셰이크, 중복 요청 id 거부, 요청별 AbortController와 cancel, 스냅샷 응답 전 갱신 버퍼, 연결별 송신 대기 한도와 느린 피어 끊기, attachment 세대 ID로 늦은 프레임 거부, 오류 정제, `ServerListener`에서 인증을 끝내는 경계, Unix 소켓 0600·디렉터리 0700·죽은 소켓 정리 | experimental이고 Chord 서비스 모델과 붙어 있다. Helm 데몬 프로토콜 처리기(P11·P12)의 체크리스트로 쓰기 좋다 |
| pi-client | - | - | `ByteTransport`/`ByteTransportFactory` 추상, 대기 요청 거부, 구독 `start()`로 스냅샷 설치 후 갱신 시작, 연결 세대별 상태 초기화 | 재접속·재전송이 없어 Helm 데스크톱 앱·TUI 클라이언트 요구(결정 31)를 채우지 못한다. Tauri 웹뷰에서 쓸 수는 있으나(브라우저 스모크 대상) 서버가 pi-server여야 한다 |
| chord | - | (선택) `chord/delta`의 `Op` 형식과 `applyImmutable`을 화면 투영 동기화에 쓸지 P12·P13이 판단 | Context(취소·값 전달), facet·service 조립, `ReplicatedStateSource`의 cursor 계약 문구, 구독 대기 100개 초과 시 reset 정책 | CHANGELOG가 없고 PLANNING이 "not a stable public API contract yet"이라 고정 의존 위험이 높다. 개념은 투영 동기화 설계에 바로 쓸 수 있다 |
| pi-env | - | - | SSH 부트스트랩(호스트 키 고정 alias, BatchMode, 포워딩 금지), stdio 프레임 프로토콜(동기화 줄, ping 5초, 무수신 30초 종료, 응답 우선 전송) | 결정 38(b) "SSH exec 채널의 stdio로 프로토콜 프레임"을 설계할 때 같은 문제를 이미 푼 예다. 패키지는 pi-durable `ExecutionEnv` 전용이라 Helm 도구 층에 바로 끼울 수 없다. 원격 도구 실행이 필요해지면 그때 어댑터를 검토한다 |
| pi-evals | - | - | 쌍 비교·결측 보류·실행 계획 고정·Docker 격리 절차 | private, 실제 모델 키와 coding-agent `AgentSession`이 필요하다 |
| pi-telemetry | pi-ai를 고정 의존하면 함께 들어온다. Helm 런타임 진단 span에 그대로 쓴다(`NOOP_TELEMETRY_CONTEXT` 기본) | - | 타입 있는 span 스키마 방식 | 의존이 없고 작다. pi-ai의 `telemetryContext` 옵션과 맞춰진다. 이벤트 로그와 역할이 겹치지 않게 "진단 전용"으로 둔다 |

공통 [후보]:
- pi 패키지는 `package.json`에 정확한 버전(`1.1.0`, `^` 없이)으로 적는다. 1.0.x 패치에서도 호환이 깨졌기 때문이다(1.3절). 단 pi 패키지끼리는 `^1.1.0`으로 서로를 요구하므로, 잠금 파일과 `overrides`로 한 버전에 묶어야 한다.
- 소스를 복사(포크)할 때는 `cdaf6c2`의 Unreleased 변경이 섞인다는 점을 기록한다. 고정 의존 버전(1.1.0)과 복사본 기준 커밋을 07 문서의 업스트림 추적 표에 함께 적는다.
- pi 소스는 `.ts` 확장자 상대 import, `erasableSyntaxOnly`, `rewriteRelativeImportExtensions`를 전제로 한다. 브리프 결정 36(TypeScript 5.x)으로 옮기려면 TS 5.8 이상이 필요하다(`erasableSyntaxOnly`는 5.8, `rewriteRelativeImportExtensions`는 5.7에서 추가) [지식].
- Node는 22.19.0 이상으로 고정한다(모든 pi 패키지의 `engines`). 이번 서버의 Node는 v24.19.0이다.

## 14. 미확인 사항

- `PI_EXPERIMENTAL=1 ./pi-test.sh server|client` 실행 경로(12.1 §4 행). pi-api-facts-1 담당과 맞춘다.
- pi-tui를 실제 TTY(Windows Terminal → SSH → WSL)에서 띄운 동작: Kitty 프로토콜 협상, IME 후보창 위치, 한국어 줄바꿈 품질. 이번 실험은 가짜 Terminal만 썼다.
- pi-env 데몬 Rust 크레이트 46개의 라이선스와 재배포 고지.
- chord `delta` 형식의 장기 안정성. CHANGELOG가 없으므로 버전 간 변경을 diff로만 추적할 수 있다.
- pi-client를 Tauri 웹뷰에서 WebSocket `ByteTransport`로 실제 연결해 본 적은 없다(브라우저 번들 스모크만 원문 확인).

## 15. 출처

- pi 소스(`~/projects/_ref/pi-src`, `cdaf6c2`): `package.json`, `tsconfig.base.json`, `tsconfig.json`, `vitest.base.ts`, `biome.json`, `AGENTS.md`, `LICENSE`, `scripts/check-browser-smoke.mjs`, `scripts/browser-smoke-entry.ts`, `.github/workflows/ci.yml`
- `packages/tui/`: `package.json`, `README.md`, `CHANGELOG.md`, `src/{index,tui,tui-main-screen,tui-alt-screen,terminal,keybindings,keys,stdin-buffer,oklab,native-platform,program-status}.ts`, `src/components/*.ts`, `test/chat-simple.ts`, `test/virtual-terminal.ts`, `native/`
- `packages/protocol/`: `package.json`, `README.md`, `CHANGELOG.md`, `src/{index,protocol,codec,framing}.ts`, `src/cbor/*.ts`, `vitest.config.ts`
- `packages/server/`: `package.json`, `README.md`, `CHANGELOG.md`, `src/{index,types,listener,connection,errors,server,session-router}.ts`, `src/transports/unix/*.ts`, `src/testing/*.ts`
- `packages/client/`: `package.json`, `README.md`, `CHANGELOG.md`, `src/{index,types,transport,errors,client,connection,unix}.ts`
- `packages/chord/`: `package.json`, `README.md`, `PLANNING.md`, `src/{index,api,types}.ts`, `src/services/{errors,wire,provider}.ts`, `src/context/index.ts`, `src/delta/{index.ts,README.md}`
- `packages/env/`: `package.json`, `README.md`, `CHANGELOG.md`, `docs/protocol.md`, `src/{index,remote-env,connection,ssh}.ts`, `daemon/Cargo.toml`, `daemon/Cargo.lock`
- `packages/evals/`: `package.json`, `README.md`, `src/harness.ts`
- `packages/telemetry/`: `package.json`, `README.md`, `src/index.ts`
- 그 밖 대조: `packages/{ai,agent,coding-agent,durable,mcp,codemode}/CHANGELOG.md`, `packages/ai/src/types.ts`, `packages/ai/src/providers/faux.ts`, `packages/coding-agent/{package.json,src/index.ts}`, `packages/coding-agent/src/experimental/{radius-relay.ts,radius-auth.ts,services/README.md,services/*.ts}`, `packages/coding-agent/src/modes/interactive/{tui-renderer.ts,chat-viewport.ts}`
- 사례: `~/projects/_ref/openclaw/package.json`, `~/projects/_ref/pi-fabric/package.json`
- npm 레지스트리 조회(2026-10-11): `npm view @earendil-works/{chord,pi-protocol,pi-client,pi-server,pi-tui,pi-telemetry,pi-env,pi-ai} time`, `npm view @earendil-works/pi-evals`
- 실험: `experiments/pi-lab/exp1~6-*.mjs`(재실행), `.helm-design-work/S3b/exp7-server-client.mjs`, `.helm-design-work/S3b/exp8-tui.mjs`
- 대조한 Helm 문서: `docs/design/process/00-design-brief.md`(결정 26, 29, 31, 33, 36~38), `docs/design/process/sources/pi-layer-analysis.md`, `docs/v0.3/audit/pi-runtime-options.md`, `docs/v0.3/audit/backend-oss-research.md`

<!-- 0단계 완료 -->
