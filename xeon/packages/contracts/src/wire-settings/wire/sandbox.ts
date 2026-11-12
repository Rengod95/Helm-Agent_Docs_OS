import { Type, type Static, type TNull, type TObject, type TUnion, type TUnsafe } from "typebox";
import { Nullable } from "../../base/index.ts";
import { SelfTestReportSchema, type SelfTestReport } from "../../services/index.ts";

// 샌드박스 자가 시험 wire(M4, `sandbox.lastSelfTest`·`sandbox.selfTest`, L0.sandbox.spec §4.4). 설정 "샌드박스" 구역의 점검 줄이 쓴다.
// 결과는 L0 자가 시험 보고서 그대로다: 시각, 전체 통과, 항목 id·통과·사유 코드. 출력 원문과 경로는 싣지 않는다.

/** 빈 params. 두 메서드가 같이 쓴다 */
export const SandboxSelfTestParamsSchema: TObject<{}> = Type.Object(
  {},
  { additionalProperties: false },
);
export type SandboxSelfTestParams = Static<typeof SandboxSelfTestParamsSchema>;

/** `sandbox.lastSelfTest` 결과. 기록된 시험이 아직 없으면 `report`가 null이다(읽기만 하고 시험은 돌리지 않는다) */
export const SandboxLastSelfTestResultSchema: TObject<{
  report: TUnion<[TUnsafe<SelfTestReport>, TNull]>;
}> = Type.Object({ report: Nullable(SelfTestReportSchema) }, { additionalProperties: false });
export type SandboxLastSelfTestResult = Static<typeof SandboxLastSelfTestResultSchema>;
