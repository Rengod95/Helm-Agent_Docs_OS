# @xeon/desktop

L4 데스크톱 앱. Tauri 2 셸(`src-tauri/`)이 엔진 사이드카를 띄우고 stdout/stdin 바이트를 WebView로 중계한다. 화면은 React 19 + Zustand 5(`src/`)이고 `bun build`로 번들해 `src-tauri/ui`에 둔다.

- 엔진은 `sidecar.json`이 정하는 컴파일 바이너리(`xeon host --stdio`)이고, UI와는 stdio JSON-RPC로 연결한다.
- 명세는 `docs/xeon/L4/desktop/spec.md`, 구현 계획과 DESK.2·DESK.3 기록은 `docs/xeon/L4/desktop/plan.md`(3.2.1절)를 따른다.

## 명령 (`just verify` 밖)

| 레시피                                                | 내용                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `just desktop-test`                                   | Rust 셸 단위 시험(`cargo test`). 사이드카 바이너리 불필요                            |
| `just desktop-sidecar <triple\|host> [--no-bytecode]` | 사이드카를 `src-tauri/binaries/xeon-<triple>`로 컴파일하고 크기 상한(500 MiB)을 검사 |
| `just desktop-run`                                    | `cargo run`(사이드카 필요)                                                           |
| `just desktop-build`                                  | `cargo build --release`(사이드카 필요)                                               |

- cargo는 `~/.cargo/bin`에서 찾는다. 없으면 종료코드 2다.
- Rust 빌드 산출물은 저장소 밖(`src-tauri/.cargo/config.toml`의 `target-dir`)에 쌓인다.
- `spike/`는 DESK.1 측정 코드다. 제품 코드가 아니다.
