import type { ServerNotificationParams } from "@fresnel/contracts/wire";

/** `settings.invalidated` 알림의 params. 시험이 받은 알림을 모아 값으로 견준다 */
export type WireNotificationParams = ServerNotificationParams<"settings.invalidated">;
