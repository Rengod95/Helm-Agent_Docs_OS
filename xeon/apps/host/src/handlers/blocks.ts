import { BLOCK_MODEL } from "@fresnel/contracts/blocks";
import type { WireHandlers } from "@fresnel/contracts/wire";

// 블록 모델 읽기 wire(M4, `blocks.describe`, M5e 스펙 §4.9). 엔진 빌드가 가진 `BLOCK_MODEL` 상수를 그대로 돌려준다.
// 입력이 없고 값이 상수라서 포트와 조립이 없다. 값을 새로 계산하지 않는다. `blocks.applied`는 대화와 프로필을 읽어야 해서 확장 읽기 포트(`m4/ext-read.ts`, `assembly/m4/ext-read-port.ts`)가 한다.

export type BlocksMethods = "blocks.describe";

export function createBlocksHandlers(): Pick<WireHandlers, BlocksMethods> {
  return {
    "blocks.describe": () => Promise.resolve(BLOCK_MODEL),
  };
}
