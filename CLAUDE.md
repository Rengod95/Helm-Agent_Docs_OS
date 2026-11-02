# Fresnel

작업 지침은 `xeon/AGENTS.md`다.

## 검사를 돌리는 때

- 작업 중: `just check <패키지>`, `just test <패키지>`, 고친 범위의 `just check-layers`, `just check-ts-rules`, `just knip`, `just terms check`.
- `just verify`: 병합 직전에만 메인 세션이 맥에서 돌린다. 트랙 리드와 서브에이전트는 돌리지 않는다.
- CI는 수동이다. 병합 직전에만 `gh workflow run fresnel-ci.yml --ref <브랜치>`.
- caustic 전체 게이트는 PR 병합 직전에만 돌린다(`just verify-merge`). 작업 중에는 고친 스펙만 `just gate <id>`.
- 맥에서 할 수 있는 일은 맥에서 한다. 긴 명령을 `sleep`으로 반복 확인하지 않는다.
