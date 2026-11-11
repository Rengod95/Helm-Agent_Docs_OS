import { SectionHeader } from "@caustic/react";
import type { ReactNode } from "react";

// 연결 화면 섹션의 공용 부품(`ConnectionSection`)과 화면 동작의 모양. 실행 방식은 `connection-run-mode.tsx`, 다른 기기 접속은
// `connection-server.tsx`가 그린다. 설명은 정보 아이콘 뒤에 두고, 경고와 실패는 그대로 보인다.

/** 상태 열이 내는 동작. 화면 핸들러의 일부다 */
interface StatusHandlers {
  readonly restart: () => void;
  /** 진단 정보를 클립보드에 복사한다 */
  readonly copyDiagnostics: () => void;
  readonly backToLocal: () => void;
  readonly setRemoteRespond: (enabled: boolean) => void;
  /** 서비스 멈추기 확인 대화 상자를 연다(`true`)거나 닫는다(`false`) */
  readonly setStopConfirm: (open: boolean) => void;
  readonly openExtensions: () => void;
  /** 연결된 클라이언트 목록만 다시 읽는다(목록 읽기 실패의 다시 시도) */
  readonly retryClients: () => void;
}

/** 연결 화면 오른쪽 덩어리의 동작. 연결 실패의 다시 시도가 더 붙는다 */
export interface DetailHandlers extends StatusHandlers {
  readonly retry: () => void;
}

/**
 * 연결 화면의 섹션 하나. 머리는 caustic `SectionHeader`(제목 16/22 600, 설명, 끝 동작)이고, 본문은 그 아래 `gap-4`로 잇는다.
 * 섹션 사이의 큰 간격은 화면이 준다. 선이나 상자는 더하지 않는다.
 */
export function ConnectionSection(props: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const { title, description, action, children } = props;
  return (
    <section aria-label={title} className="grid content-start gap-4">
      <SectionHeader title={title} description={description} action={action} />
      {children}
    </section>
  );
}
