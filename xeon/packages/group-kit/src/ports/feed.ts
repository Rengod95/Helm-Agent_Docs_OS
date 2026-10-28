import type { PortKey } from "@xeon/contracts/extensions";
import type { EventFeed } from "@xeon/contracts/records";

/**
 * 커밋 이벤트 피드 포트(서비스 `xeon.session`의 `feed` 속성, 제공 core-persistence). X `SessionFeedPortKey`와 같은 키다.
 * X가 이 키를 공개 진입점으로 내지 않아 group-kit이 같은 값을 직접 적는다(L3.group-kit.spec §3.13 요청 7).
 * `lease.rejected`로 `GroupStatus.drive`의 `"rejected"`를 채우는 데만 읽는다
 */
export const GroupFeedPortKey: PortKey<EventFeed> = { name: "xeon.session", member: "feed" };
