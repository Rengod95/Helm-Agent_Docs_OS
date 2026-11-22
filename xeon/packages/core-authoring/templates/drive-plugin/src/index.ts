import {
  pluginsOf,
  type DriveCommand,
  type ExtensionEntry,
  type StepResult,
} from "@fresnel/contracts/extensions";
import { memberSetups } from "./members.generated.ts";

// __TITLE__ 구동(Drive) 골격. 단계 함수가 턴 하나를 돌리고 끝낸다. 명령은 커밋된 상태와 직전 결과로만 정한다
// (drive-isolation.md §1.1). Date.now, Math.random, 직접 I/O를 쓰지 않는다. 단계를 늘리면 상태를 커밋하고 다음 명령을 고른다.
// 구성원(뿌리가 아닌 plugins[])은 src/members/<id>.ts의 setup으로 등록한다. 목록은 생성 파일이 가진다.
function stepOf(last: StepResult | null): DriveCommand<unknown> {
  if (last === null) return { do: "turn", input: { kind: "user", content: "__TITLE__ 시작" } };
  return { do: "done" };
}

const noSetup = (): void => {};

const entry: ExtensionEntry = ({ manifest, register }) => {
  register(manifest.name, {}, (g) => {
    g.drive(({ last }) => Promise.resolve(stepOf(last)));
  });
  for (const member of pluginsOf(manifest)) {
    const id = member.decl.id;
    if (member.root || id === undefined) continue;
    register(member.registrationId, {}, memberSetups[id] ?? noSetup);
  }
};

export default entry;
