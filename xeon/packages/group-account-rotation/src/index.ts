import { defineGroup, type GroupModule } from "@xeon/group-kit";
import { accountRotationManifest } from "./manifest.ts";
import { accountRotationSettings } from "./settings.ts";

/**
 * 그룹 등록. 이 그룹은 아무것도 등록하지 않는다. 회전 게이트(scope 상태와 `acknowledgeRisk`)는 core-models가 본다.
 * 고지 동의 값을 이 그룹이 읽을 일은 없으므로 setup은 비어 있다.
 */
function setupAccountRotation(): void {
  // 빈 setup. 회전 게이트는 core-models가 맡는다(L1.models.spec §4.8)
}

/** 기본 꺼짐인 계정 회전 플러그인의 그룹 모듈. 신뢰 등급 user, 설정 네임스페이스 `ext.account-rotation`이다 */
export const accountRotationGroup: GroupModule = defineGroup<
  never,
  typeof accountRotationSettings.defs
>({
  manifest: accountRotationManifest,
  settings: accountRotationSettings,
  setup: setupAccountRotation,
});

/** 외부 로더가 부르는 엔트리(X.loading-trust.spec §4.4.2: named `extension`) */
export const extension: GroupModule["entry"] = accountRotationGroup.entry;

export { accountRotationManifest, ROTATION_RISK_NOTICE } from "./manifest.ts";
export { accountRotationSettings } from "./settings.ts";
