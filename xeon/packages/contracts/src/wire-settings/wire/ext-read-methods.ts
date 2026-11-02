import type { TUnsafe } from "typebox";
import * as r from "./ext-read.ts";
import { m4, NoParamsSchema, type Io, type M4Spec, type NoParams, type Req } from "./schema-kit.ts";

// M4 확장 읽기 메서드의 레지스트리 조각. methods.ts의 WireSchemas·WIRE_METHODS가 펼쳐 쓴다.

type U<T> = TUnsafe<T>;
export interface ExtReadSchemas {
  "ext.list": Io<U<Req<r.ExtListParams>>, U<r.ExtListResult>>;
  "ext.get": Io<U<Req<r.ExtNameParams>>, U<r.ExtGetResult>>;
  "ext.reenable": Io<U<Req<r.ExtNameParams>>, U<r.ExtAppliedResult>>;
  "ext.reload": Io<U<Req<r.ExtNameParams>>, U<r.ExtAppliedResult>>;
  "ext.health": Io<U<Req<r.ExtHealthParams>>, U<r.ExtHealthResult>>;
  "ext.timings": Io<U<Req<r.ExtTimingsParams>>, U<r.ExtTimingsResult>>;
  "ext.versions": Io<U<Req<r.ExtNameParams>>, U<r.ExtVersionsResult>>;
  "ext.rollback": Io<U<Req<r.ExtRollbackParams>>, U<r.ExtRollbackResult>>;
  "ext.bindings": Io<U<Req<r.ExtBindingsParams>>, U<r.ExtBindingsResult>>;
  "ext.validateComposition": Io<U<Req<r.ExtValidateCompositionParams>>, U<r.ExtValidateResult>>;
  "ext.ui.list": Io<U<Req<r.ExtUiListParams>>, U<r.ExtUiListResult>>;
  "ext.ui.post": Io<U<Req<r.ExtUiPostParams>>, U<r.ExtUiPostResult>>;
  "ext.ui.requestApproval": Io<U<Req<r.ExtUiApprovalParams>>, U<r.ExtUiApprovalResult>>;
  "group.list": Io<U<Req<r.GroupListParams>>, U<r.GroupListResult>>;
  "group.metrics": Io<U<Req<r.GroupMetricsParams>>, U<r.GroupMetricsResult>>;
  "group.promotion": Io<U<Req<r.GroupPromotionParams>>, U<r.GroupPromotionResult>>;
  "group.driveLock": Io<U<Req<r.GroupDriveLockParams>>, U<r.GroupDriveLockResult>>;
  "hooks.list": Io<U<NoParams>, U<r.HooksListResult>>;
}

type Table = {
  readonly [M in keyof ExtReadSchemas]: M4Spec<
    ExtReadSchemas[M]["params"],
    ExtReadSchemas[M]["result"]
  >;
};

export const EXT_READ_METHODS: Table = {
  "ext.list": m4(r.ExtListParamsSchema, r.ExtListResultSchema),
  "ext.get": m4(r.ExtNameParamsSchema, r.ExtGetResultSchema),
  "ext.reenable": m4(r.ExtNameParamsSchema, r.ExtAppliedResultSchema),
  "ext.reload": m4(r.ExtNameParamsSchema, r.ExtAppliedResultSchema),
  "ext.health": m4(r.ExtHealthParamsSchema, r.ExtHealthResultSchema),
  "ext.timings": m4(r.ExtTimingsParamsSchema, r.ExtTimingsResultSchema),
  "ext.versions": m4(r.ExtNameParamsSchema, r.ExtVersionsResultSchema),
  "ext.rollback": m4(r.ExtRollbackParamsSchema, r.ExtRollbackResultSchema),
  "ext.bindings": m4(r.ExtBindingsParamsSchema, r.ExtBindingsResultSchema),
  "ext.validateComposition": m4(r.ExtValidateCompositionParamsSchema, r.ExtValidateResultSchema),
  "ext.ui.list": m4(r.ExtUiListParamsSchema, r.ExtUiListResultSchema),
  "ext.ui.post": m4(r.ExtUiPostParamsSchema, r.ExtUiPostResultSchema),
  "ext.ui.requestApproval": m4(r.ExtUiApprovalParamsSchema, r.ExtUiApprovalResultSchema),
  "group.list": m4(r.GroupListParamsSchema, r.GroupListResultSchema),
  "group.metrics": m4(r.GroupMetricsParamsSchema, r.GroupMetricsResultSchema),
  "group.promotion": m4(r.GroupPromotionParamsSchema, r.GroupPromotionResultSchema),
  "group.driveLock": m4(r.GroupDriveLockParamsSchema, r.GroupDriveLockResultSchema),
  "hooks.list": m4(NoParamsSchema, r.HooksListResultSchema),
};
