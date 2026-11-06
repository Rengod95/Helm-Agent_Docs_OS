import type { WireHandler } from "@fresnel/contracts/wire";
import type { Engine } from "../types.ts";

// F wire §3.3.1 models.list(M4 T-MODEL). 대화가 `thread.setModel`로 고를 수 있는 모델의 목록이다. 읽기만 하므로 쓰기 소유를 얻지 않는다.

/** 결과 `models`의 상한(`ModelsListResultSchema` maxItems) */
const MODELS_MAX = 1000;

function compareRefs(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function createModelsListHandler(engine: Engine): WireHandler<"models.list"> {
  const { models } = engine.ports;
  return () => {
    const listed = models
      .available()
      .toSorted((a, b) => compareRefs(a.ref, b.ref))
      .slice(0, MODELS_MAX)
      .map((info) => ({
        ref: info.ref,
        name: info.name,
        contextWindow: info.contextWindow,
        reasoning: info.reasoning,
      }));
    return Promise.resolve({ models: listed });
  };
}
