import { defineManifest } from "@fresnel/contracts/extensions";
import type { GroupManifest } from "@fresnel/group-sdk";

/**
 * 약관 위험 고지 문구. 매니페스트 userConfig 설명이고, 설정 화면은 켜기 전에 이 문구를 보인다(L1.models.spec §4.8).
 * 회전 게이트는 core-models가 맡고, 이 문구는 사용자가 위험을 알고 켜도록 하는 자리다.
 */
export const ROTATION_RISK_NOTICE: string =
  "이 플러그인은 한 제공자의 여러 계정(API 키 계정과 구독 계정)을 돌려 가며 요청을 보내요. 구독 계정을 이렇게 쓰면 제공자 이용 약관에 어긋날 수 있고 계정이 제한되거나 정지될 수 있어요. 켜면 그 위험을 사용자가 져요.";

/** 플러그인 산출물(`.fresnel-plugin/plugin.json`)이 옮겨 쓰는 매니페스트 상수. 기본 꺼짐이고 엔트리는 번들(dist)을 가리킨다 */
export const accountRotationManifest: GroupManifest = defineManifest({
  schemaVersion: 2,
  name: "account-rotation",
  version: "0.1.0",
  displayName: "Account rotation",
  description: "한 provider의 API 키 계정과 구독 계정을 돌려 쓰는 계정 회전(기본 꺼짐)",
  entry: "./dist/index.js",
  defaultEnabled: false,
  trust: { level: "user" },
  userConfig: {
    acknowledgeRisk: {
      setting: "ext.account-rotation.acknowledgeRisk",
      title: "약관 위험 고지에 동의",
      description: ROTATION_RISK_NOTICE,
      required: false,
    },
  },
  plugins: [{ layer: "L3", hooks: [] }],
  group: {},
});
