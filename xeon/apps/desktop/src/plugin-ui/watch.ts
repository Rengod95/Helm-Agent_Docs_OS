import type { HostConnection } from "@fresnel/contracts/wire";

// 확장 상태가 바뀌었을 수 있는 알림에서 화면 목록을 다시 읽게 한다(ADR-0021 §3.4.2). 알림에는 값이 없고 다시 읽는 일은 호출자가 한다.
// - `settings.invalidated`: 키가 비어 있거나(어느 키인지 모름) `ext.`(켜짐 등 확장 설정)나 `x.ui.`(앱 정책)로 시작하는 키가 있을 때
// - `events.batch`: `scope.changed`(켜짐·꺼짐, 자동 끄기)가 들어 있을 때

const WATCHED_SETTING_PREFIXES: readonly string[] = ["ext.", "x.ui."];

/** 이 연결의 알림을 듣는다. 해제 함수를 돌려준다 */
export function watchExtensionChanges(
  connection: HostConnection,
  onChange: () => void,
): () => void {
  const offs = [
    connection.onNotification("settings.invalidated", (params) => {
      const watched =
        params.keys.length === 0 ||
        params.keys.some((key) =>
          WATCHED_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix)),
        );
      if (watched) onChange();
    }),
    connection.onNotification("events.batch", (params) => {
      if (params.events.some((event) => event.kind === "scope.changed")) onChange();
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
