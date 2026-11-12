// 연결 화면의 동작 묶음 타입. 화면 그림(connection-view)과 구역들(connection-sections)이 함께 쓴다. 따로 둬서 서로를 가져오는 고리를 끊는다
import type { TargetEntry } from "@fresnel/client";
import type { TargetChoice } from "./connection-model.ts";
import type { ProbeRunArgs } from "./connection-probe-model.ts";

/** 화면 동작. 속성 형태로 둬서 시험이 빈 함수를 넣을 수 있다 */
export interface ConnectionScreenHandlers {
  /** 연결 실패의 다시 시도 */
  readonly retry: () => void;
  readonly restart: () => void;
  /** 진단 정보를 클립보드에 복사한다 */
  readonly copyDiagnostics: () => void;
  readonly backToLocal: () => void;
  readonly setRemoteRespond: (enabled: boolean) => void;
  /** 서비스 멈추기 확인 대화 상자를 연다(`true`)거나 닫는다(`false`) */
  readonly setStopConfirm: (open: boolean) => void;
  /** 그 행의 호스트로 연결한다(셸에 대상 바꾸기) */
  readonly connect: (choice: TargetChoice) => void;
  readonly query: (text: string) => void;
  readonly removeAsk: (entry: TargetEntry) => void;
  readonly removeCancel: () => void;
  readonly removeConfirm: () => void;
  readonly renameOpen: (entry: TargetEntry) => void;
  readonly renameField: (label: string) => void;
  readonly renameSubmit: () => void;
  readonly renameCancel: () => void;
  readonly dismissNotice: () => void;
  readonly confirmStop: () => void;
  /** 화면 상태(엔진이 붙은 서비스 상태와 설정)를 다시 읽는다. 실행 방식을 고른 뒤에 부른다 */
  readonly refresh: () => void;
  /** 저장된 호스트 줄의 연결 시험. `args`는 호스트 키 확인 뒤 다시 돌릴 때만 준다 */
  readonly testRow: (entry: TargetEntry, args?: ProbeRunArgs) => void;
  /** 고침 명령 한 줄을 클립보드에 복사한다 */
  readonly copyCommand: (text: string) => void;
  /** 바꾸기 확인 대화 상자에서 바꾸기 */
  readonly switchConfirm: () => void;
  /** 바꾸기 확인 대화 상자에서 그대로 두기 */
  readonly switchCancel: () => void;
  /** 대상 알림 줄을 닫는다 */
  readonly dismissTargetNotice: () => void;
  /** "컴퓨터 추가" wizard의 끝: 목록에 넣고 저장한다. `connectNow`면 저장한 뒤 그 컴퓨터로 바꾼다. 저장하면 참이다 */
  readonly addTarget: (
    entry: { readonly label: string; readonly address: string },
    connectNow: boolean,
  ) => Promise<boolean>;
}
