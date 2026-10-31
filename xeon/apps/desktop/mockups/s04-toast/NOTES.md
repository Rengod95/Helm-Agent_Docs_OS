# S-04 토스트 (s04-toast)

- 상태: S1 세 종류 함께(학습 알림 agent · 동작 결과 · 예약 실패 오류) · S2 알림 · S3 동작 결과 · S4 앱 동작 오류 · S5 합친 알림(같은 kind 1초 안).
- caustic `Toast`/`ToastViewport` 그대로. 상태 표시줄과 오른쪽 막대를 피해 `bottom-10 end-14`. 오류(danger)는 닫기 버튼, 닫히지 않음, role=alert. 목업에서는 성공 토스트도 머물게 `duration={0}`.
