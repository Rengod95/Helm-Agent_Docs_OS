// 연결 화면의 동작 묶음 타입. 화면 그림(connection-view)과 호스트 섹션이 함께 쓴다. 따로 둬서 두 파일이 서로를 가져오는 고리를 끊는다
import type { TargetEntry } from "@fresnel/client";
import type { TargetChoice } from "./connection-model.ts";
import type { DetailHandlers } from "./connection-status.tsx";
import type { HostFormValue } from "./host-address.ts";

/** 화면 동작. 속성 형태로 둬서 시험이 빈 함수를 넣을 수 있다 */
export interface ConnectionScreenHandlers extends DetailHandlers {
  /** 그 행의 호스트로 연결한다(셸에 대상 바꾸기) */
  readonly connect: (choice: TargetChoice) => void;
  readonly query: (text: string) => void;
  readonly openForm: () => void;
  readonly closeForm: () => void;
  readonly formChange: (value: HostFormValue) => void;
  readonly submitForm: () => void;
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
}
