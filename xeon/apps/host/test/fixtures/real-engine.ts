import { assemble } from "../../src/assemble.ts";
import { useEngineHome } from "./engine-home.ts";

// 실제 엔진(모든 하위 패키지)을 세우는 시험의 전제 검사. 엔진이 서지 못하면 실제 엔진 시험을 건너뛰지 않고 이 파일에서 던져 시험 파일이
// 실패하게 한다. 예전에는 하위 패키지가 서로 맞지 않는 동안 건너뛰었지만(M1), 조립 실패가 조용히 모든 실제 엔진 시험을 건너뛰어
// 검증이 통과한 것처럼 보이게 했다(HOST.6에서 cap-work 표 이름 오류가 그렇게 숨어 있었다). 가짜 엔진 위의 시험은 이 전제와 무관하다.

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
      throw new Error(
        `the engine cannot be assembled, so the real-engine tests cannot run: ${blocker}`,
      );
    }
    return { blocker };
  });
  return cached;
}
