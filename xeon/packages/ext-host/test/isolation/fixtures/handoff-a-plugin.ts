// 맡기기 동등성 시험의 맡기는 쪽 엔트리(등록 이름 `ha`). 단계는 handoff-steps.ts의 `stepA`다.
import type { ExtensionEntry } from "@fresnel/contracts/extensions";
import { handoffEntry, stepA } from "./handoff-steps.ts";

export const extension: ExtensionEntry = handoffEntry("ha", stepA);
