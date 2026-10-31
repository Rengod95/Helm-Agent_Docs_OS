# P-01 첫 실행 (p01-first-run)

- 실행: `MOCKUP=p01-first-run mise exec -- bun run mockup`. 상태 `?state=S1`~`S10`(기본 S1 키 등록), `?theme=dark`.
- 상태: S1 키 등록 · S2 기본 모델 · S3 기본 그룹 · S4 웹 검색 · S5 필수 도구 없음 · S6 키 저장 실패(권한) · S7 오프라인 · S8 읽는 중 · S9 팔레트(S-02 확인) · S10 대화 시작 → O-07.
- 단계 다섯: 외부 도구 · 모델 키 · 기본 모델 · 기본 그룹(Helm, 학습, 내 그룹 `xeon group new`, 안전 모드 안내) · 웹 검색(선택). 기본 그룹 단계는 스펙 §6.5에 없고 프레이밍 정정(L3 그룹이 핵심 단위)으로 더했어요.
- 레이아웃: 제목 띠 없음. 가운데 46rem 읽기 열, 머리에 "시작하기 n/5"와 "대화 시작"(키·모델 전엔 잠김 + Tooltip). 단계는 `Accordion`(ghost, sm, single). 단계 안 이름표·값은 `ListDescription`(ghost, xs). 첫 실행이라 대화 목록·내비 배지가 비고(셸 `threads.items`, `nav`), 오른쪽 well은 닫고 시작. 상태 표시줄은 "모델 없음", 0인 승인·알림 칸과 문맥 칸을 뺐어요.
- 빈틈: `Stepper checklist`는 누를 수 없어 다시 열기를 못 해요(→ Accordion). `Input xs`(32px)와 `Button xs`(24px) 높이가 달라 입력 옆 버튼은 `sm`. O-07은 `../o07-new-thread/new-thread-dialog.tsx`를 가져와요(mockup.css `@source`).
