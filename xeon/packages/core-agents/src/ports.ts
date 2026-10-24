import type { PortKey } from "@xeon/contracts/extensions";
import {
  AgentServiceName,
  LoopServiceName,
  type AgentService,
  type LoopService,
} from "@xeon/contracts/services";

// [미결] F `@xeon/contracts/services`에 `xeon.agents`·`xeon.loop` 전체 모양의 PortKey가 없다(tasks·tools는 있다).
// 이 파일이 같은 이름의 키를 만든다. F에 같은 키가 생기면 이 파일은 그것을 다시 내보내도록 바꾼다.

/** `xeon.agents` 전체 모양의 포트 키. 제공 core-agents */
export const AgentServicePortKey: PortKey<AgentService> = { name: AgentServiceName };

/** `xeon.loop` 전체 모양의 포트 키. 제공 core-loop */
export const LoopServicePortKey: PortKey<LoopService> = { name: LoopServiceName };
