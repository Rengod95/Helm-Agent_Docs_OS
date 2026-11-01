import { defineManifest } from "@fresnel/contracts/extensions";
import type { ExtensionUnit } from "@fresnel/ext-host";
import { defineGroup } from "@fresnel/group-sdk";

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
      schemaVersion: 2,
      name,
      version: "0.1.0",
      entry: "./src/index.ts",
      defaultEnabled: true,
      trust: { level: "builtin" },
      plugins: [{ layer: "L3", hooks: [], drives: true }],
      group: {},
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
