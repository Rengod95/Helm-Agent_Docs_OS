import { defineManifest } from "@xeon/contracts/extensions";
import type { ExtensionUnit } from "@xeon/ext-host";
import { defineGroup } from "@xeon/group-kit";

/** Helm 대역: drive 임대를 쥐고 놓지 않는 그룹. `release`가 놓게 한다 */
export interface DriveStandIn {
  readonly unit: ExtensionUnit;
  readonly release: () => void;
  /** drive 함수가 시작된 횟수 */
  readonly started: () => number;
}

export function driveStandIn(name: string): DriveStandIn {
  let started = 0;
  const gate = Promise.withResolvers<void>();
  const module = defineGroup({
    manifest: defineManifest({
      schemaVersion: 1,
      name,
      version: "0.1.0",
      layer: "L3",
      kind: "group",
      entry: "./src/index.ts",
      points: [],
      usesDrive: true,
      defaultEnabled: true,
      trust: { level: "builtin" },
    }),
    setup(g) {
      g.drive(async (loop) => {
        started += 1;
        await loop.turn({ input: { kind: "user", content: "explore the repository" } });
        await gate.promise;
      });
    },
  });
  return {
    unit: { manifest: module.manifest, entry: module.entry, loadIndex: 2, builtin: true },
    release: gate.resolve,
    started: () => started,
  };
}
