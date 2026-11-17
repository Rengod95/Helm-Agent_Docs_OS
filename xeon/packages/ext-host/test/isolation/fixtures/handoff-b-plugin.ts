// 맡기기 동등성 시험의 맡은 쪽 엔트리(등록 이름 `hb`). 단계는 handoff-steps.ts의 `stepB`다.
import type { ExtensionEntry } from "@fresnel/contracts/extensions";
import { handoffEntry, stepB } from "./handoff-steps.ts";

export const extension: ExtensionEntry = handoffEntry("hb", stepB);
