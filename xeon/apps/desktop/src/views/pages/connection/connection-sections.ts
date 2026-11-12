import type { Locale } from "@fresnel/client/i18n";
import type { RemoteScreen } from "../../../app/remote/use-remote-controller.ts";
import type { EngineState } from "../../../state/engine/index.ts";
import type { TargetNotice } from "../../../state/ui/index.ts";
import type { ConnectionScreenHandlers } from "./connection-handlers.ts";
import type { ConnectionState, ReconnectLine } from "./connection-model.ts";
import type { RowProbe } from "./connection-probe-model.ts";

// 설정 "원격" 화면(DP-112~116)의 구역들이 함께 받는 값. 화면(`connection-screen.tsx`)이 만들고 그림(`connection-view.tsx`)이 나눠 준다.
// 구역: 요약 카드(`connection-hero.tsx`), 계속 켜 두기(`keep-on-section.tsx`), 다른 컴퓨터에 연결(`computers-section.tsx`),
// 휴대폰·브라우저에서 쓰기(`reach-section.tsx`), 등록된 기기(`devices-section.tsx`). 시안: `_notes/design/dz/dzRW-design.md`.

export interface SectionContext {
  readonly state: ConnectionState;
  readonly engine: EngineState | null;
  readonly locale: Locale;
  readonly handlers: ConnectionScreenHandlers;
  /**
   * 이 컴퓨터의 원격 접속 컨트롤러(서비스, 자동 시작, 다른 기기 접속, 기기 목록, 연결 코드, 사전 점검·Tailscale·설정 호출은
   * `useCommands().remote`). 엔진이 다른 컴퓨터에 붙어 있으면 null이다(그 컴퓨터의 서비스는 이 화면이 바꾸지 않는다).
   */
  readonly remote: RemoteScreen | null;
  /** 브라우저로 들어온 화면이다(웹 셸). 서비스 끄기·호스트 추가처럼 그 컴퓨터 앱에서만 하는 일을 숨긴다 */
  readonly web: boolean;
  /** 1초마다 넘어가는 시각(연결 코드 남은 시간). 코드가 없으면 멈춰 있다 */
  readonly nowMs: number;
  /** 글을 클립보드에 복사하고 "복사했어요"를 띄운다 */
  readonly copy: (text: string) => void;
}

/** 요약 카드가 더 받는 값 */
export interface HeroExtras {
  readonly reconnect: readonly ReconnectLine[];
  readonly targetNotice: TargetNotice | null;
}

/** 컴퓨터 목록이 더 받는 값 */
export interface ComputersExtras {
  readonly rowProbe: RowProbe | null;
}
