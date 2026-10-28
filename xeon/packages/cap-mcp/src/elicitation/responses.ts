// L2.mcp.spec §4.6 3번. 규칙 본체는 F `@xeon/contracts/capabilities`(`mcp-questions.ts`)로 옮겼다: L1.tools(core-tools)가
// `input_required` 변형을 질문 승인으로 올릴 때 같은 규칙을 써야 하고, L1은 L2를 import할 수 없기 때문이다(L1.tools.spec §8.3 F 요청 12).
// 이 파일은 cap-mcp 안의 기존 이름을 지키는 재노출이다.
export {
  buildMcpInputResponses as buildInputResponses,
  checkMcpFormContent as checkFormContent,
} from "@xeon/contracts/capabilities";
