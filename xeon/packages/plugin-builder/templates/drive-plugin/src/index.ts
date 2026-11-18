import type { DriveCommand, ExtensionEntry, StepResult } from "@fresnel/contracts/extensions";

// __TITLE__ 구동(Drive) 골격. 단계 함수가 턴 하나를 돌리고 끝낸다. 명령은 커밋된 상태와 직전 결과로만 정한다
// (drive-isolation.md §1.1). Date.now, Math.random, 직접 I/O를 쓰지 않는다. 단계를 늘리면 상태를 커밋하고 다음 명령을 고른다.
function stepOf(last: StepResult | null): DriveCommand<unknown> {
  if (last === null) return { do: "turn", input: { kind: "user", content: "__TITLE__ 시작" } };
  return { do: "done" };
}

const entry: ExtensionEntry = ({ manifest, register }) => {
  register(manifest.name, {}, (g) => {
    g.drive(({ last }) => Promise.resolve(stepOf(last)));
  });
};

export default entry;
