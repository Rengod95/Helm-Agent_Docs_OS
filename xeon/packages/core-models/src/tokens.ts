import {
  calculateContextTokens,
  estimateContextTokens,
  estimateMessageTokens,
} from "@earendil-works/pi-ai/utils/estimate";
import type { TokenEstimator } from "@xeon/contracts/services";

// L1.models.spec §3.3 TokenEstimator, plan M-1. pi-ai 추정을 위임한다. core-context는 pi-ai를 직접 import하지 않는다(DR-07).
export function createTokenEstimator(): TokenEstimator {
  return {
    estimateMessage: (message) => estimateMessageTokens(message),
    estimateContext: (messages) => estimateContextTokens([...messages]),
    fromUsage: (usage) => calculateContextTokens(usage),
  };
}
