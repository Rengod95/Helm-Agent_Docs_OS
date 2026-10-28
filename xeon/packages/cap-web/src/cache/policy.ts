import type { CacheUsage, WebProviderManifest } from "@xeon/contracts/capabilities";

// L2.web.spec §4.3.2. 앞단은 매니페스트의 cachePolicy만 본다. 약관 검토일(`termsFlags.reviewedAt`)이 없는 `persist`는 `session`으로 낮춘다.

export interface EffectiveCachePolicy {
  readonly policy: CacheUsage;
  /** reviewedAt이 없어 persist를 session으로 낮췄는가(로드 진단 경고 대상) */
  readonly downgraded: boolean;
}

export function effectiveCachePolicy(manifest: WebProviderManifest): EffectiveCachePolicy {
  const declared = manifest.termsFlags.cachePolicy;
  if (declared === "persist" && manifest.termsFlags.reviewedAt === undefined) {
    return { policy: "session", downgraded: true };
  }
  return { policy: declared, downgraded: false };
}
