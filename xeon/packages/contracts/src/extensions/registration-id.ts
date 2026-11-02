import { Type, type TString } from "typebox";

/**
 * Registration id. 루트 플러그인은 "<확장 이름>", 그 밖의 플러그인은 "<확장 이름>/<플러그인 id>"다
 * (F.extensions.spec §3.1 `registrationIdOf`). 저장된 `scopeId` 값과 같은 모양이다
 */
export type RegistrationId = string;
export const REGISTRATION_ID_PATTERN: string = "^[a-z][a-z0-9-]{1,31}(/[a-z][a-z0-9-]{1,31})?$";
export const RegistrationIdSchema: TString = Type.String({
  pattern: REGISTRATION_ID_PATTERN,
  maxLength: 65,
});

/** drive lock id. X가 발급한다. 저장된 `leaseId` 필드의 값이다 */
export type DriveLockId = string;

/** 확장 안에서 유일한 플러그인 id. 루트가 아닌 플러그인의 Registration id 뒷부분이 된다 */
export const PLUGIN_ID_PATTERN: string = "^[a-z][a-z0-9-]{1,31}$";
export const PluginIdSchema: TString = Type.String({ pattern: PLUGIN_ID_PATTERN, maxLength: 32 });
