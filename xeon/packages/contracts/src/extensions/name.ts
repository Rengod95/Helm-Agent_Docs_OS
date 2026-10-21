import { Type, type TString } from "typebox";

/**
 * [결정(잠정): review.decisions-2 U-18] 소문자·숫자·하이픈 2~32자. 밑줄은 쓰지 않는다.
 * 확장 테이블 접두는 "x_<이름의 하이픈을 밑줄로>_"이고 지역 테이블 이름에는 밑줄을 쓰지 않는다.
 */
export const EXTENSION_NAME_PATTERN: string = "^[a-z][a-z0-9-]{1,31}$";
export const ExtensionNameSchema: TString = Type.String({
  pattern: EXTENSION_NAME_PATTERN,
  minLength: 2,
  maxLength: 32,
});
export type ExtensionName = string;
