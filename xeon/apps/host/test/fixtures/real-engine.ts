import { assemble } from "../../src/assemble.ts";
import { useEngineHome } from "./engine-home.ts";

// 실제 엔진(모든 하위 패키지)을 세우는 시험의 전제 검사. 하위 패키지가 서로 맞지 않아 엔진이 서지 못하는 동안은
// 실제 엔진 시험을 건너뛰고 이유를 크게 알린다. 건너뛰는 것은 이 전제가 깨진 동안뿐이고, 가짜 엔진 위의 시험은 그대로 돈다.
// 엔진이 서면 아무것도 바꾸지 않아도 이 시험들이 돈다.

export interface RealEngineGate {
  /** 엔진이 서지 못하는 이유. 서면 undefined */
  readonly blocker: string | undefined;
}

async function probe(): Promise<string | undefined> {
  const home = useEngineHome();
  try {
    const engine = await assemble({ mode: "in-process" });
    await engine.close();
    return undefined;
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  } finally {
    home.dispose();
  }
}

let cached: Promise<RealEngineGate> | undefined;

export function realEngineGate(): Promise<RealEngineGate> {
  cached ??= probe().then((blocker) => {
    if (blocker !== undefined) {
      console.warn(`SKIPPED real-engine tests: the engine cannot be assembled (${blocker})`);
    }
    return { blocker };
  });
  return cached;
}
