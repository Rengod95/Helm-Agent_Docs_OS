// 포트 모양은 F(`@fresnel/contracts/services`)가 정의한다. 구현은 `write-access-adapter.ts`가 `fresnel.approvals`를 감싼다.
export type {
  WriteAccessError,
  WriteAccessPort,
  WriteAccessRequest,
  WriteAccessVia,
} from "@fresnel/contracts/services";
