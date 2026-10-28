import {
  isCapabilityError,
  type AnyCapabilityDef,
  type CallOptions,
  type ToolContent,
} from "@xeon/contracts/capabilities";

// L1.tools 어댑터의 환원 규칙(F.capabilities.spec §4.2, core-tools entries.ts invokeCapability)을 흉내 낸 시험용 호출자.
// 실제 어댑터(core-tools)와의 연결 시험은 의존이 연결된 뒤(bun install) 통합 시험으로 둔다.

export interface AdaptedResult {
  readonly isError: boolean;
  /** 모델이 보는 첫 텍스트 */
  readonly text: string;
  readonly details: unknown;
  readonly content: ToolContent | undefined;
}

export async function callTool(
  def: AnyCapabilityDef,
  api: unknown,
  name: string,
  params: unknown,
  options: CallOptions = {},
): Promise<AdaptedResult> {
  const spec = def.tools.find((tool) => tool.name === name);
  if (spec === undefined) throw new Error(`no tool ${name} in ${def.id}`);
  const method: unknown = Reflect.get(Object(api), spec.method);
  if (typeof method !== "function") throw new Error(`no method ${spec.method}`);
  const input: unknown = spec.toInput === undefined ? params : spec.toInput(params);
  try {
    const output: unknown = await Reflect.apply(method, api, [input, options]);
    const rendered = spec.toContent?.(output);
    const first = rendered?.content[0];
    return {
      isError: false,
      text: first?.type === "text" ? first.text : "",
      details: rendered?.details,
      content: rendered,
    };
  } catch (caught) {
    if (!isCapabilityError(caught)) throw caught;
    return {
      isError: true,
      text: `[${caught.data.code}] ${caught.data.message}`,
      details: caught.data,
      content: undefined,
    };
  }
}
