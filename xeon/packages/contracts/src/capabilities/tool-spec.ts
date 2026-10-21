import type { Static, TSchema } from "typebox";
import type {
  ImageContent,
  JsonValue,
  ReplayPolicy,
  TextContent,
  Tool,
  ToolExecutionMode,
  ToolReference,
} from "../conversation/index.ts";
import type { MethodDef, MethodMap } from "./method.ts";
import type { ToolName } from "./ids.ts";

/** 정책 힌트. 의미는 MCP tool annotations와 pi ToolAnnotations를 따른다. 검증되지 않는 작성자 선언이다 */
export interface ToolHints {
  /** 환경을 바꾸지 않는다 */
  readonly readOnly?: boolean;
  /** 데이터를 지우거나 덮어쓸 수 있다 (readOnly가 아닐 때만 의미) */
  readonly destructive?: boolean;
  /** 같은 인자로 반복해도 추가 효과가 없다 */
  readonly idempotent?: boolean;
  /** 웹처럼 열린 외부 대상에 접근한다 */
  readonly openWorld?: boolean;
}

/** 모델에게 돌려줄 도구 결과 내용. agent-core AgentToolResult의 부분 집합 */
export interface ToolContent {
  readonly content: readonly (TextContent | ImageContent)[];
  readonly structuredContent?: JsonValue;
  readonly details?: JsonValue;
}

export interface ToolSpec<
  K extends string = string,
  P extends TSchema = TSchema,
  Md extends MethodDef = MethodDef,
> {
  /** 기계 이름. TOOL_NAME_WIRE_PATTERN을 만족해야 한다 */
  readonly name: ToolName;
  /** 표시 제목. 1~64자 */
  readonly label: string;
  /** 모델에게 보내는 설명 */
  readonly description: string;
  /** 대응하는 서비스 메서드 이름 */
  readonly method: K;
  /** 모델 도구 파라미터. 루트는 Type.Object */
  readonly parameters: P;
  /** structuredContent 스키마. 생략하고 toContent도 없으면 메서드 output을 쓴다 */
  readonly outputSchema?: TSchema;
  /**
   * 파라미터 → 메서드 입력. 생략하면 parameters가 메서드 input과 같아야 한다. 순수 함수.
   * 메서드 문법으로 선언한다(매개변수 이변). ToolSpecFor가 P를 TSchema로 두기 때문에, 속성 문법이면
   * 도구별로 좁은 params 타입을 쓰는 toInput을 대입할 수 없다.
   */
  toInput?(params: Static<P>): Static<Md["input"]>;
  /** 메서드 출력 → 모델용 결과. 생략하면 기본 렌더링. 순수 함수 */
  toContent?(output: Static<Md["output"]>): ToolContent;
  /** 재생 정책. 생략하면 "unsafe" */
  readonly replay?: ReplayPolicy;
  /** 병렬 실행 허용 여부. 생략하면 L1.tools 기본값 */
  readonly executionMode?: ToolExecutionMode;
  readonly hints?: ToolHints;
}

/** 메서드 맵 Ms에 대해 가능한 ToolSpec의 합집합. method 키와 toInput/toContent 타입이 맞물린다 */
export type ToolSpecFor<Ms extends MethodMap> = {
  readonly [K in keyof Ms & string]: ToolSpec<K, TSchema, Ms[K]>;
}[keyof Ms & string];

/** provider 요청에 실리는 부분. pi-ai Tool과 구조가 같다 */
export type ToolWire = Pick<Tool, "name" | "description" | "parameters">;
export type { ToolReference };

/** 순서·fingerprint 계산에 쓰는 도구 참조 */
export interface ToolRef {
  /** 능력 ID. 능력 밖 도구는 순서 키 접두("ext.<확장 이름>", "mcp.<서버 이름>")를 쓴다 */
  readonly capability: string;
  readonly name: ToolName;
}

export interface OrderedTool extends ToolRef {
  readonly wire: ToolWire;
}
