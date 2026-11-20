// 큰 값 시험의 맡은 쪽 엔트리(등록 이름 `bb`). 단계는 big-steps.ts의 `childStep`이다.
import type { ExtensionEntry } from "@fresnel/contracts/extensions";
import { bigEntry, childStep } from "./big-steps.ts";

export const extension: ExtensionEntry = bigEntry("bb", childStep);
