import { Type, type TString } from "typebox";

/** 확장 이름, 또는 "<확장 이름>/<하위 이름>" */
export type ScopeId = string;
export const SCOPE_ID_PATTERN: string = "^[a-z][a-z0-9-]{1,31}(/[a-z][a-z0-9-]{0,31})?$";
export const ScopeIdSchema: TString = Type.String({ pattern: SCOPE_ID_PATTERN, maxLength: 65 });

/** drive 임대 id. X가 발급한다 */
export type LeaseId = string;
