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
      hasDrives: true,
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
      hasDrives: false,
      ...IN_PORT,
    },
    expected: { kind: "in_engine", reason: "setting_none" },
  },
  {
    name: "a setting none lets a user extension run in the engine without a port",
    input: { source: "user", setting: "none", manifest: undefined, hasDrives: false, ...NO_PORT },
    expected: { kind: "in_engine", reason: "setting_none" },
  },
  {
    name: "a manifest none with no setting runs in the engine",
    input: { source: "user", setting: undefined, manifest: "none", hasDrives: false, ...IN_PORT },
    expected: { kind: "in_engine", reason: "manifest_none" },
  },
  {
    name: "an explicit setting process without a port is refused as unavailable",
    input: {
      source: "user",
      setting: "process",
      manifest: undefined,
      hasDrives: false,
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
      hasDrives: false,
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
      hasDrives: false,
      ...NO_PORT,
    },
    expected: { kind: "in_engine", reason: "default_no_port" },
  },
  {
    name: "an explicit setting process with drives is refused as drive-unsupported",
    input: { source: "user", setting: "process", manifest: undefined, hasDrives: true, ...IN_PORT },
    expected: { kind: "refused", code: "isolation_drive_unsupported" },
  },
  {
    name: "an explicit manifest process with drives is refused as drive-unsupported",
    input: {
      source: "managed",
      setting: undefined,
      manifest: "process",
      hasDrives: true,
      ...IN_PORT,
    },
    expected: { kind: "refused", code: "isolation_drive_unsupported" },
  },
  {
    name: "a default with drives runs in the engine",
    input: { source: "user", setting: undefined, manifest: undefined, hasDrives: true, ...IN_PORT },
    expected: { kind: "in_engine", reason: "default_drives" },
  },
  {
    name: "when both the port and drives are missing, the port check comes first (explicit)",
    input: { source: "user", setting: "process", manifest: undefined, hasDrives: true, ...NO_PORT },
    expected: { kind: "refused", code: "isolation_unavailable" },
  },
  {
    name: "a default with a port and no drives is isolated",
    input: {
      source: "user",
      setting: undefined,
      manifest: undefined,
      hasDrives: false,
      ...IN_PORT,
    },
    expected: { kind: "process" },
  },
  {
    name: "an explicit setting process with a port and no drives is isolated",
    input: {
      source: "project",
      setting: "process",
      manifest: undefined,
      hasDrives: false,
      ...IN_PORT,
    },
    expected: { kind: "process" },
  },
  {
    name: "a setting process overrides a manifest none",
    input: { source: "user", setting: "process", manifest: "none", hasDrives: false, ...IN_PORT },
    expected: { kind: "process" },
  },
  {
    name: "a manifest process with a port and no drives is isolated",
    input: {
      source: "managed",
      setting: undefined,
      manifest: "process",
      hasDrives: false,
      ...IN_PORT,
    },
    expected: { kind: "process" },
  },
];

for (const row of ROWS) {
  test(`isolation decision: ${row.name}`, () => {
    expect(effectiveIsolationOf(row.input)).toEqual(row.expected);
  });
}
