import { Bug } from "@xeon/contracts";
import type { Notice, NoticeKind } from "@xeon/contracts/capabilities";
import type { SettingCatalog, SettingDef } from "@xeon/contracts/settings";
import { resolveSetting } from "@xeon/contracts/settings";
import type { Unsubscribe } from "@xeon/contracts/wire";
import type { ConnectionHub } from "../connection-types.ts";
import type { Engine } from "../types.ts";
import { toRecord } from "../util.ts";

// L4.host-service.spec HS-82, F wire §3.3.2 `notify.delivered`. review.m3-design-inputs D-M3-17, M3-REQ-16. 엔진이 알림을 만들 때마다
// 연결된 클라이언트 모두에 한 번씩 보낸다. 창이 앞에 있는지는 호스트가 보지 않는다(클라이언트가 정한다).
// 보낼지는 그 알림 종류의 설정 `l2.dialog.notify.<kind>`가 정한다. 알림마다 그 thread의 범위로 읽는다. OS 토스트 설정 `l2.dialog.notify.os`는
// 여기서 보지 않는다(cap-dialog의 OS 전달 수단 설정이다). 손실을 견디는 `stream.chunk`와 달리 놓치면 안 되므로 송신 큐가 차도 건너뛰지 않는다.

/** 알림 종류마다 켜기 설정 정의를 찾는다. 카탈로그에 없으면 조립 결함이다(cap-dialog 정의는 조립에 항상 들어간다) */
function gateDefsOf(catalog: SettingCatalog): Readonly<Record<NoticeKind, SettingDef>> {
  const find = (key: string): SettingDef => {
    const def = catalog.get(key);
    if (def === undefined) throw new Bug(`the setting catalog has no ${key}`);
    return def;
  };
  return {
    completed: find("l2.dialog.notify.completed"),
    approval_waiting: find("l2.dialog.notify.approvalWaiting"),
    question_waiting: find("l2.dialog.notify.questionWaiting"),
    error: find("l2.dialog.notify.error"),
    background_completed: find("l2.dialog.notify.backgroundCompleted"),
  };
}

/**
 * 알림 전달 구독을 엔진의 알림 포트에 건다. 반환 함수가 구독을 뗀다(fan-out을 멈출 때 부른다). 서비스가 아직 없으면 포트가 나타날 때 붙는다
 * (assembly/dialog-wire.ts).
 */
export function startNoticeDelivery(engine: Engine, hub: ConnectionHub): Unsubscribe {
  const gates = gateDefsOf(engine.catalog);
  return engine.ports.dialog.subscribeNotices((threadId, notice: Notice) => {
    const enabled = resolveSetting(gates[notice.kind], engine.ports.settings.layers(threadId));
    if (enabled.setting.value !== true) return;
    const deliveredAt = new Date(engine.ports.clock.now()).toISOString();
    for (const conn of hub.connections()) {
      if (conn.phase !== "ready") continue;
      conn.sender.push({
        jsonrpc: "2.0",
        method: "notify.delivered",
        params: toRecord({ threadId, notice, deliveredAt }),
      });
    }
  });
}
