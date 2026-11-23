// 훅 순간 id의 화면 이름(멤버 탭이 훅 줄에 쓴다). 옛 개요 자세히 보기(`detail-flow.tsx`)에서 이것만 옮겼다(AGE-69).
import type { MessageId } from "@fresnel/client/i18n";

// 순간 이름은 훅마다 하나씩 있다. 표에 없는 id(없어야 한다)는 "알 수 없는 순간"으로 보인다.
const MOMENT_LABEL: ReadonlyMap<string, MessageId> = new Map<string, MessageId>([
  ["thread.start", "desktop.craft.detail.moment.thread.start"],
  ["input.user.before", "desktop.craft.detail.moment.input.user.before"],
  ["input.agent.before", "desktop.craft.detail.moment.input.agent.before"],
  ["thread.compact.before", "desktop.craft.detail.moment.thread.compact.before"],
  ["request.provider.before", "desktop.craft.detail.moment.request.provider.before"],
  ["guard.model.before", "desktop.craft.detail.moment.guard.model.before"],
  ["request.model.after", "desktop.craft.detail.moment.request.model.after"],
  ["tool.call.before", "desktop.craft.detail.moment.tool.call.before"],
  ["tool.run", "desktop.craft.detail.moment.tool.run"],
  ["tool.result", "desktop.craft.detail.moment.tool.result"],
  ["tool.execution.after", "desktop.craft.detail.moment.tool.execution.after"],
  ["boundary.step.after", "desktop.craft.detail.moment.boundary.step.after"],
  ["boundary.settle.after", "desktop.craft.detail.moment.boundary.settle.after"],
  ["thread.shutdown", "desktop.craft.detail.moment.thread.shutdown"],
]);

/** 순간 id의 이름. 표에 없는 훅(33개의 나머지)은 undefined라 id만 보인다 */
export function hookLabelOf(id: string): MessageId | undefined {
  return MOMENT_LABEL.get(id);
}
