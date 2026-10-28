import { Type, type TLiteral, type TUnion } from "typebox";

/** p_agents.settled_status의 값. agent.settled 이벤트의 status와 같다(L1.agents.spec §3.5) */
export const AgentSettledStatusSchema: TUnion<
  [TLiteral<"completed">, TLiteral<"aborted">, TLiteral<"error">]
> = Type.Union([Type.Literal("completed"), Type.Literal("aborted"), Type.Literal("error")]);
