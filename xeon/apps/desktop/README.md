# @fresnel/desktop

L4 데스크톱 앱. Electron 셸(`apps/desktop-shell/`)이 엔진 사이드카를 띄우고 stdout/stdin 바이트를 WebView로 중계한다. 화면은 React 19 + Zustand 5(`src/`)이고 `vite build`로 번들해 `dist/ui`에 둔다. Tauri와 Rust 셸은 제거했다(마지막 Tauri 커밋 `424f338a`).

- 엔진은 `sidecar.json`이 정하는 컴파일 바이너리(`fresnel host --stdio`)이고, UI와는 stdio JSON-RPC로 연결한다.
- 명세는 `docs/xeon/L4/desktop/spec.md`, 구현 계획과 DESK.2·DESK.3 기록은 `docs/xeon/L4/desktop/plan.md`(3.2.1절)를 따른다.

## 명령 (`just verify` 밖)

| 레시피                                                | 내용                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `just desktop-ui [dev]`                               | 화면 번들을 `dist/ui`에 만든다                                                          |
| `just desktop-sidecar <triple\|host> [--no-bytecode]` | 사이드카를 `dist/sidecar/fresnel-<triple>`로 컴파일하고 크기 상한(500 MiB)을 검사       |
| `just desktop-run`                                    | Electron 셸을 번들해 띄운다(화면 번들과 사이드카 필요)                                  |
| `just desktop-shell-test`                             | 셸 단위 시험(electron 없이 가짜 ctx)                                                    |
| `just desktop-build-electron`                         | 묶은 앱 Fresnel.app 만들기                                                              |
| `just desktop-smoke-electron`                         | 묶은 앱 실행 스모크(macOS 화면 있는 로그인 환경)                                        |

- `dist/`는 git이 제외한다. `spike/`는 DESK.1 측정 코드다. 제품 코드가 아니다.
