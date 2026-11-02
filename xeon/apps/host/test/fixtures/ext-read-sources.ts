import { Type } from "typebox";
import { defineManifest, type ExtensionManifest } from "@fresnel/contracts/extensions";
import { defineSettings, type ScopeStack, type SettingCatalog } from "@fresnel/contracts/settings";
import type { ExtReadSources, ExtensionRecord } from "../../src/assembly/m4/ext-read-port.ts";
import { EMPTY_EXT_READ_SOURCES } from "../../src/assembly/m4/ext-read-port.ts";

// ext-read 시험의 원천 대역. 확장 둘: `alpha`(플러그인 하나, 기능 `alpha.cap` 제공)와 `team`(플러그인 그룹, 루트와 `scout`).

export const ALPHA: ExtensionManifest = defineManifest({
  schemaVersion: 2,
  name: "alpha",
  version: "1.2.0",
  displayName: "Alpha",
  entry: "./src/index.ts",
  plugins: [
    {
      layer: "L2",
      hooks: ["input.user.before"],
      provides: [{ id: "alpha.cap", version: "1.0.0" }],
    },
  ],
});

export const TEAM: ExtensionManifest = defineManifest({
  schemaVersion: 2,
  name: "team",
  version: "0.3.0",
  entry: "./src/index.ts",
  group: {},
  plugins: [
    { layer: "L3", hooks: ["input.user.before", "input.bash.before"], drives: true },
    {
      id: "scout",
      layer: "L2",
      hooks: [],
      requires: [{ id: "alpha.cap", range: "^1.0.0" }],
      optional: [{ id: "ghost.cap", range: "^1.0.0" }],
    },
  ],
});

export function record(
  manifest: ExtensionRecord["manifest"],
  patch: Partial<ExtensionRecord> = {},
): ExtensionRecord {
  return {
    manifest,
    location: `/ext/${manifest.name}`,
    requestedGrade: "user",
    effectiveGrade: "user",
    tier: "user",
    loaded: true,
    diagnostics: [],
    ...patch,
  };
}

const MAX_REPLAY = defineSettings("l4.host-service", {
  maxReplayEvents: {
    type: Type.Integer(),
    default: 5000,
    runtimeChange: "live",
    allowedScopes: ["user", "launch"],
    since: "0.1.0",
  },
});

export function catalogOfTest(): SettingCatalog {
  const def = MAX_REPLAY.defs.maxReplayEvents;
  return new Map([[def.key, def]]);
}

export function layersOfTest(values: {
  readonly user?: number;
  readonly launch?: number;
}): ScopeStack {
  const key = "l4.host-service.maxReplayEvents";
  return [
    ...(values.user === undefined
      ? []
      : [{ scope: "user" as const, values: new Map([[key, values.user]]) }]),
    ...(values.launch === undefined
      ? []
      : [{ scope: "launch" as const, values: new Map([[key, values.launch]]) }]),
  ];
}

/** 호출을 기록하는 원천. 시험이 필요한 필드만 바꿔 쓴다 */
export interface RecordedSources {
  readonly sources: ExtReadSources;
  readonly reenabled: string[];
  readonly reloaded: string[];
}

export function createRecordedSources(patch: Partial<ExtReadSources> = {}): RecordedSources {
  const reenabled: string[] = [];
  const reloaded: string[] = [];
  const sources: ExtReadSources = {
    ...EMPTY_EXT_READ_SOURCES,
    budget: (hook) => ({
      budgetClass: "chain",
      budgetMs: hook === "input.user.before" ? 10000 : 30000,
    }),
    extensions: () => [record(ALPHA), record(TEAM)],
    registrations: () => [
      { id: "alpha", status: "enabled" },
      { id: "team", status: "enabled" },
      { id: "team/scout", status: "disabled" },
    ],
    threadStatus: (threadId, registrationId) =>
      threadId === "thr_known" && registrationId === "team/scout" ? "enabled" : undefined,
    threadKnown: (threadId) => Promise.resolve(threadId !== "thr_missing"),
    enabledSource: (registrationId, threadId) =>
      threadId !== undefined && registrationId === "team/scout" ? "thread" : "user",
    reenable: (name) => {
      reenabled.push(name);
    },
    reload: (name) => {
      reloaded.push(name);
      return Promise.resolve([
        {
          severity: "warning",
          code: "unused_hook",
          message: "unused",
          file: "src/index.ts",
          line: 7,
        },
      ]);
    },
    ...patch,
  };
  return { sources, reenabled, reloaded };
}
