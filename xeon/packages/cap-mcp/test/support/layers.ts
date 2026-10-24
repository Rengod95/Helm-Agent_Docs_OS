import type { ScopeLayer } from "@xeon/contracts/settings";

export function layer(scope: ScopeLayer["scope"], values: Record<string, unknown>): ScopeLayer {
  return { scope, values: new Map(Object.entries(values)) };
}
