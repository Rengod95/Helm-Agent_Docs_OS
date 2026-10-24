import { Type, type Static, type TObject, type TString, type TUnsafe } from "typebox";
import { JsonValueSchema, type JsonValue } from "../../conversation/index.ts";

// key·scope 값 집합의 정본은 F.wire-settings.spec §3.8.1(SettingKey, SettingScope)이다. records는 settings보다
// 낮은 순위라(F.readme §3) 스키마를 import하지 않고 문자열로 둔다. 값 집합 일치는 test/wire-settings 쪽 테스트가 확인한다.
export const SettingsChangedPayloadSchema: TObject<{
  key: TString;
  scope: TString;
  value: TUnsafe<JsonValue>;
}> = Type.Object(
  {
    key: Type.String({ minLength: 3, maxLength: 128 }),
    scope: Type.String({ minLength: 1, maxLength: 16 }),
    /** 비밀 값은 기록하지 않고 secret:// 참조만 기록한다. 값이 없으면 null */
    value: JsonValueSchema,
  },
  { additionalProperties: false },
);
export type SettingsChangedPayload = Static<typeof SettingsChangedPayloadSchema>;
