import type { McpServerDef } from "@xeon/contracts/capabilities";

// L2.mcp.spec §4.2 [결정: M3-REQ-97, D-M3-19 행 3]. 서버 정의의 env·headers 값은 `secret://` 참조이거나 평문이다.
// 평문은 허용하되 이름이 비밀처럼 보이면(KEY, TOKEN, SECRET 등) 거부한다. `secret://`로 시작하는 값은 참조 형식이어야 한다
// (오타 난 참조가 평문으로 전송되는 일을 막는다).

const SECRET_REF = /^secret:\/\/[a-z][a-z0-9-]{1,63}$/;

/** 이름을 이루는 낱말이 이 중 하나면 비밀 이름이다. `MAX_TOKENS`의 TOKENS처럼 복수형은 비밀이 아니다 */
const SECRET_WORDS: ReadonlySet<string> = new Set([
  "KEY",
  "APIKEY",
  "TOKEN",
  "SECRET",
  "SECRETS",
  "PASSWORD",
  "PASSWD",
  "PWD",
  "CREDENTIAL",
  "CREDENTIALS",
  "AUTH",
  "AUTHORIZATION",
  "COOKIE",
  "BEARER",
]);

/** `API_KEY`, `apiKey`, `X-Api-Key`를 낱말(API, KEY)로 나눈다 */
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((word) => word.length > 0);
}

/** 이름이 비밀처럼 보이는가 */
export function looksLikeSecretName(name: string): boolean {
  return wordsOf(name).some((word) => SECRET_WORDS.has(word));
}

export interface ValueIssue {
  readonly code: "plaintext_secret" | "invalid_definition";
  readonly message: string;
}

function checkTable(
  label: "env" | "header",
  table: Readonly<Record<string, string>> | undefined,
): ValueIssue | undefined {
  if (table === undefined) return undefined;
  for (const [name, value] of Object.entries(table)) {
    if (value.startsWith("secret://")) {
      if (!SECRET_REF.test(value)) {
        return {
          code: "invalid_definition",
          message: `${label} ${name} is not a valid secret:// reference`,
        };
      }
      continue;
    }
    if (looksLikeSecretName(name)) {
      return {
        code: "plaintext_secret",
        message: `${label} ${name} looks like a secret; use a secret:// reference instead of a plaintext value`,
      };
    }
  }
  return undefined;
}

/** 정의 하나의 env·headers 값을 검사한다. 문제가 있으면 첫 문제를 돌려준다 */
export function checkDefinitionValues(def: McpServerDef): ValueIssue | undefined {
  const transport = def.transport;
  if (transport.type === "stdio") return checkTable("env", transport.env);
  return checkTable("header", transport.headers);
}

/** 정의의 `secret://` 참조 env와 평문 env를 나눈다 */
export function splitEnv(env: Readonly<Record<string, string>> | undefined): {
  readonly plain: Record<string, string>;
  readonly secret: Record<string, string>;
} {
  const plain: Record<string, string> = {};
  const secret: Record<string, string> = {};
  for (const [name, value] of Object.entries(env ?? {})) {
    if (value.startsWith("secret://")) secret[name] = value;
    else plain[name] = value;
  }
  return { plain, secret };
}
