import type { SessionService, StoreDb } from "@xeon/contracts/records";

// cap-work가 쓰는 xeon.session의 부분과 자기 투영 테이블을 읽는 핸들. 실제 이름이 바뀌면 이 파일만 고친다
// (L2.work.plan §2 "포트 파일은 L1 서비스의 실제 이름을 한 곳에서 감싼다").

/** 커밋, 피드 읽기(재전송된 커밋의 이벤트 복원), 투영기 등록, 내구 피드 구독(승인 해결 알림) */
export type WorkSessionPort = Pick<SessionService, "commit" | "feed" | "projectors" | "subscribe">;

/**
 * `cap.work` 소유 테이블(cap_work_*)을 읽는 핸들. 조립 루트는 `xeon.store`의 `scoped("cap.work")`를 넘긴다.
 * 읽기 연결의 같은 스냅숏에서 읽으므로 쓰기 직렬화 큐 안에서만 쓰기 전 상태로 신뢰한다(spec §4.1.1)
 */
export type WorkReader = StoreDb;
