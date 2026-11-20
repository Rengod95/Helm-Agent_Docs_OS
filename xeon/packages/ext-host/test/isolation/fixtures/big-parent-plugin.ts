// 큰 값 시험의 맡기는 쪽 엔트리(등록 이름 `ba`). 단계는 big-steps.ts의 `parentStep`이다.
import type { ExtensionEntry } from "@fresnel/contracts/extensions";
import { bigEntry, parentStep } from "./big-steps.ts";

export const extension: ExtensionEntry = bigEntry("ba", parentStep);
