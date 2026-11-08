// L2.mcp.spec §4.10. 시작 실패의 원인 문장(`lastError.message`). 첫 줄은 한국어 문장이고, 둘째 줄부터는 서버나 SDK가 준 원문이다(마스킹한 뒤).
// 화면은 첫 줄을 행과 토스트에 보이고 원문은 정보 아이콘 뒤에 둔다. 흔한 원인은 아래 표에서 고르고, 모르는 원인은 한국어 틀과 원문만 낸다.

export interface StartFailureInput {
  readonly server: string;
  /** 연결 시도가 낸 실패 코드(`spawn_failed`, `timeout`, `connect_failed` 등) */
  readonly code: string;
  /** 원문(마스킹한 것) */
  readonly message: string;
  /** 서버 stderr 끝 줄(마스킹한 것). 없으면 빈 배열 */
  readonly stderrTail: readonly string[];
  /** 이 시도에 쓴 연결 제한 시간(밀리초) */
  readonly connectMs: number;
}

const CONNECT_LIMIT_NOTE = "(설정: MCP 연결 제한 시간, l2.mcp.connectTimeoutMs)";
const NEGOTIATION_NOTE = "(설정: MCP 사양 버전 협상, l2.mcp.versionNegotiation)";

/** 서버가 응답을 시작하기 전에 연결이 닫혔다는 SDK 문장. 프로세스가 바로 끝난 경우다 */
const CLOSED = /connection closed|process exited|exited/i;
const NEGOTIATION = /negotiat/i;

/** 코드만으로 원인이 정해지는 실패의 문장 */
const FIXED_CAUSES: Readonly<Record<string, string>> = {
  sandbox_unavailable: "이 기기에서는 서버를 격리할 수 없어서 띄우지 않았어요",
  secret_missing: "서버가 쓰는 시크릿 참조를 찾지 못했어요. 시크릿을 등록했는지 확인해 주세요",
  secret_denied: "시크릿을 쓰는 서버의 시작이 허용되지 않았어요",
  invalid_url: "서버 주소를 해석하지 못했어요. 주소 형식을 확인해 주세요",
  unsupported: "이 환경에서는 이 종류의 서버를 띄울 수 없어요",
};

function spawnCauseOf(message: string): string {
  if (/^ENOENT\b|not found/i.test(message)) {
    return "명령을 찾지 못했어요. 실행 명령의 이름과 경로를 확인해 주세요";
  }
  if (/^EACCES\b|permission denied/i.test(message)) {
    return "명령을 실행할 권한이 없어요. 실행 파일의 권한을 확인해 주세요";
  }
  return "명령을 실행하지 못했어요. 실행 명령과 인자를 확인해 주세요";
}

/** 원인의 한국어 문장. 서버 id를 넣지 않는다(틀이 앞에 붙인다). 모르면 `null`이다 */
function causeOf(input: StartFailureInput): string | null {
  const { code, message } = input;
  if (code === "spawn_failed") return spawnCauseOf(message);
  if (code === "timeout") {
    return `${input.connectMs / 1000}초 안에 서버가 응답하지 않았어요 ${CONNECT_LIMIT_NOTE}`;
  }
  const fixed = FIXED_CAUSES[code];
  if (fixed !== undefined) return fixed;
  if (NEGOTIATION.test(message) && !CLOSED.test(message)) {
    return `서버와 MCP 사양 버전을 맞추지 못했어요 ${NEGOTIATION_NOTE}`;
  }
  if (CLOSED.test(message)) {
    return "서버 프로세스가 바로 끝났어요. 서버의 오류 출력 끝 줄을 확인해 주세요";
  }
  return null;
}

/**
 * 시작 실패의 문장. 첫 줄은 `서버 <id>에 연결하지 못했어요: <한국어 원인>`이고, 원문과 stderr 끝 줄이 있으면 다음 줄들에 붙는다.
 * 서버 id 뒤에는 `에`만 붙는다(받침에 따라 달라지는 조사를 쓰지 않는다)
 */
export function describeStartFailure(input: StartFailureInput): string {
  const cause = causeOf(input) ?? "원인을 알 수 없어요. 원문을 확인해 주세요";
  const head = `서버 ${input.server}에 연결하지 못했어요: ${cause}`;
  const original = input.message.trim();
  const stderr = input.stderrTail.map((line) => line.trim()).filter((line) => line !== "");
  const lines = [
    ...(original === "" ? [] : [original]),
    ...(stderr.length === 0 ? [] : [`stderr: ${stderr.join(" | ")}`]),
  ];
  return [head, ...lines].join("\n");
}
