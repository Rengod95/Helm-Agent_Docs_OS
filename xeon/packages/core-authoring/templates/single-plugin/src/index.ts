import { pluginsOf, type ExtensionEntry } from "@fresnel/contracts/extensions";
import { memberSetups } from "./members.generated.ts";

// __TITLE__ 골격. 훅과 동작은 이 파일의 setup에 더하고, 더한 훅은 매니페스트 plugins[0].hooks에도 적는다.
// 구성원(뿌리가 아닌 plugins[])은 src/members/<id>.ts의 setup으로 등록한다. 목록은 생성 파일이 가진다.
const noSetup = (): void => {};

const entry: ExtensionEntry = ({ manifest, register }) => {
  register(manifest.name, {}, (g) => {
    g.on("boundary.settle.after", () => {});
  });
  for (const member of pluginsOf(manifest)) {
    const id = member.decl.id;
    if (member.root || id === undefined) continue;
    register(member.registrationId, {}, memberSetups[id] ?? noSetup);
  }
};

export default entry;
