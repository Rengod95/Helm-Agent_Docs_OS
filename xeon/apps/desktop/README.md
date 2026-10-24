# @xeon/desktop

L4 데스크톱 앱 자리. Tauri 2 프로젝트는 아직 만들지 않는다(Rust 툴체인 없음, 계획 5절 P4 이후).

- 엔진은 `apps/host`를 `bun build --compile`로 묶은 사이드카이고, UI와는 stdio JSON-RPC로 연결한다.
- 구현 계획은 `docs/xeon/L4/desktop/plan.md`를 따른다.
