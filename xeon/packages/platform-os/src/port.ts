import type { PortKey } from "@xeon/contracts/extensions";
import { OsServiceName, type OsService } from "@xeon/contracts/services";

/** 서비스 xeon.os의 포트 키. F ports.ts에 OS 키가 없어 이 패키지에서 서비스 이름 상수로 만든다 */
export const OsPortKey: PortKey<OsService> = { name: OsServiceName };
