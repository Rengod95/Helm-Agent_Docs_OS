import {
  findForeignSecretSyntax,
  parseSecretRef,
  type SecretHandle,
  type SecretName,
  type SecretRefError,
} from "@xeon/contracts/capabilities";
import { err, type Result } from "@xeon/contracts";

// L0.secrets.spec §3.1. 참조 구문 분석은 F 순수 함수가 정본이다. 이 파일은 이 패키지의 입력 경로
// (메타 name, 설정 값, 도구 인자, HTTP 템플릿)에 그 함수를 연결할 뿐이고 규칙을 다시 정의하지 않는다.

export interface ParsedHandle {
  readonly handle: SecretHandle;
  readonly name: SecretName;
}

export function parseHandle(input: string): Result<ParsedHandle, SecretRefError> {
  return parseSecretRef(input);
}

/** 메타 파일 name이나 파일 이름 줄기를 핸들로 바꾼다. 이름 규칙 위반은 invalid_ref(name_pattern 등)다 */
export function handleForName(name: string): Result<ParsedHandle, SecretRefError> {
  return parseSecretRef(`secret://${name}`);
}

/** 설정 값(SecretRef 형식 키)의 입력 검사 */
export function checkSettingRef(value: string): Result<ParsedHandle, SecretRefError> {
  return parseSecretRef(value);
}

/** 비밀 인자로 선언된 도구 인자 필드의 입력 검사. 다른 비밀 구문($VAR, {{…}}, %…%, op:// 등)을 거부한다 */
export function checkSecretArgument(value: string): Result<ParsedHandle, SecretRefError> {
  const whole = parseSecretRef(value);
  if (whole.ok) return whole;
  const foreign = findForeignSecretSyntax(value);
  const first = foreign[0];
  if (first !== undefined) return err(first);
  return whole;
}

/** HTTP 본문처럼 문장 속에 섞인 `secret://<name>` 토큰 후보. 이름 뒤에 경로 문자가 붙으면 토큰 끝에 포함해 거부되게 한다 */
const TOKEN_PATTERN = /secret:\/\/[A-Za-z0-9_-]*(?:[/?#][^\s"'<>,;)}\]]*)?/g;

export function findHandleTokens(text: string): readonly string[] {
  return text.match(TOKEN_PATTERN) ?? [];
}
