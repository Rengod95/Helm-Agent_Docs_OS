// 서비스 워커 소스(`sw.ts`)를 한 파일 classic 스크립트로 묶는다. `.js` 파일을 저장소에 두지 않으므로 린트와 타입 검사를 그대로 받는다.
import { Bug } from "@fresnel/contracts";
import type { ShimSource } from "../server/ports.ts";

let cached: string | null = null;

export const buildServiceWorkerSource: ShimSource = async () => {
  if (cached !== null) return cached;
  const result = await Bun.build({
    entrypoints: [new URL("./sw.ts", import.meta.url).pathname],
    target: "browser",
    format: "iife",
    minify: false,
    sourcemap: "none",
  });
  const [output] = result.outputs;
  if (!result.success || output === undefined) {
    throw new Bug("service worker bundle failed");
  }
  cached = await output.text();
  return cached;
};
