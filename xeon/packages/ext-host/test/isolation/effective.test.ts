// 실효 격리 판정의 표 시험(F5, 2026-11-17 결정). 각 행은 입력과 기대 결정이다. 행의 순서가 우선순위다(위에서 처음 맞는 행).
import { expect, test } from "bun:test";
import {
  effectiveIsolationOf,
  type IsolationDecision,
  type IsolationInput,
} from "../../src/index.ts";

const IN_PORT: Pick<IsolationInput, "portAvailable"> = { portAvailable: true };
const NO_PORT: Pick<IsolationInput, "portAvailable"> = { portAvailable: false };

interface Row {
  readonly name: string;
  readonly input: IsolationInput;
  readonly expected: IsolationDecision;
}

const ROWS: readonly Row[] = [
  {
    name: "builtin stays in the engine whatever the settings and manifest say",
    input: {
      source: "builtin",
      setting: "process",
      manifest: "process",
      ...NO_PORT,
    },
    expected: { kind: "in_engine", reason: "builtin" },
  },
  {
    name: "a setting none lets a managed extension run in the engine, even over a manifest process",
    input: {
      source: "managed",
      setting: "none",
      manifest: "process",
      ...IN_PORT,
    },
    expected: { kind: "in_engine", reason: "setting_none" },
  },
  {
    name: "a setting none lets a user extension run in the engine without a port",
    input: { source: "user", setting: "none", manifest: undefined, ...NO_PORT },
    expected: { kind: "in_engine", reason: "setting_none" },
  },
  {
    name: "a manifest none with no setting runs in the engine",
    input: { source: "user", setting: undefined, manifest: "none", ...IN_PORT },
    expected: { kind: "in_engine", reason: "manifest_none" },
  },
  {
    name: "an explicit setting process without a port is refused as unavailable",
    input: {
      source: "user",
      setting: "process",
      manifest: undefined,
      ...NO_PORT,
    },
    expected: { kind: "refused", code: "isolation_unavailable" },
  },
  {
    name: "an explicit manifest process without a port is refused as unavailable",
    input: {
      source: "project",
      setting: undefined,
      manifest: "process",
      ...NO_PORT,
    },
    expected: { kind: "refused", code: "isolation_unavailable" },
  },
  {
    name: "a default without a port runs in the engine",
    input: {
      source: "user",
      setting: undefined,
      manifest: undefined,
      ...NO_PORT,
    },
    expected: { kind: "in_engine", reason: "default_no_port" },
  },
  {
    // 주도 단계 함수는 `drive.step` 요청으로 격리 자식에서 돈다(drive-isolation.md 3.2). `drives`는 격리를 막지 않는다
    name: "an explicit setting process with drives is isolated",
    input: { source: "user", setting: "process", manifest: undefined, ...IN_PORT },
    expected: { kind: "process" },
  },
  {
    name: "an explicit manifest process with drives is isolated",
    input: {
      source: "managed",
      setting: undefined,
      manifest: "process",
      ...IN_PORT,
    },
    expected: { kind: "process" },
  },
  {
    name: "a default with drives is isolated (drives is not an exclusion reason)",
    input: { source: "user", setting: undefined, manifest: undefined, ...IN_PORT },
    expected: { kind: "process" },
  },
  {
    name: "when the port is missing, an explicit process is refused as unavailable even with drives",
    input: { source: "user", setting: "process", manifest: undefined, ...NO_PORT },
    expected: { kind: "refused", code: "isolation_unavailable" },
  },
  {
    name: "a default with a port is isolated",
    input: {
      source: "user",
      setting: undefined,
      manifest: undefined,
      ...IN_PORT,
    },
    expected: { kind: "process" },
  },
  {
    name: "an explicit setting process with a port is isolated",
    input: {
      source: "project",
      setting: "process",
      manifest: undefined,
      ...IN_PORT,
    },
    expected: { kind: "process" },
  },
  {
    name: "a setting process overrides a manifest none",
    input: { source: "user", setting: "process", manifest: "none", ...IN_PORT },
    expected: { kind: "process" },
  },
  {
    name: "a manifest process with a port is isolated",
    input: {
      source: "managed",
      setting: undefined,
      manifest: "process",
      ...IN_PORT,
    },
    expected: { kind: "process" },
  },
  // 초안(F5 [제안], X.loading-trust.spec §4.9.8): 설정과 매니페스트의 none을 무시하고 언제나 격리한다
  {
    name: "a draft is isolated even when the setting and the manifest say none",
    input: { source: "user", setting: "none", manifest: "none", draft: true, ...IN_PORT },
    expected: { kind: "process" },
  },
  {
    name: "a draft without a port is refused as unavailable, whatever the setting says",
    input: { source: "user", setting: "none", manifest: undefined, draft: true, ...NO_PORT },
    expected: { kind: "refused", code: "isolation_unavailable" },
  },
  {
    name: "a draft without an entry is refused, since no code may run in the engine",
    input: {
      source: "user",
      setting: undefined,
      manifest: undefined,
      hasEntry: false,
      draft: true,
      ...IN_PORT,
    },
    expected: { kind: "refused", code: "draft_entry_missing" },
  },
];

for (const row of ROWS) {
  test(`isolation decision: ${row.name}`, () => {
    expect(effectiveIsolationOf(row.input)).toEqual(row.expected);
  });
}
