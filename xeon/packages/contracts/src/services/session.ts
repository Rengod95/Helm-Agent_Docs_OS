import type { PortKey } from "../extensions/index.ts";
import type { SessionService } from "../records/index.ts";

// F.capabilities.spec §3.12. SessionService와 SessionServiceName은 records/session-service.ts에 있다(records는 extensions보다
// 앞 순서라 PortKey를 import할 수 없다). 서비스 전체 모양의 포트 키는 services가 둔다.
// 이름은 SessionServiceName("xeon.session")과 같아야 하고 test/services/session-key.test.ts가 이를 지킨다.
// services는 같은 서브패스 밖의 값 import를 하지 않으므로 이름 상수를 import하지 않고 리터럴로 적는다.

/** `xeon.session` 전체 모양(SessionService)의 포트 키. 제공 core-persistence, 소비 core-tools·core-tasks·core-context */
export const SessionPortKey: PortKey<SessionService> = { name: "xeon.session" };
