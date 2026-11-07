import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import type { NoticeKind } from "@fresnel/contracts/capabilities";
import type { ExtListEntry, ProposalListParams, ProposalSource } from "@fresnel/contracts/wire";
import type { CommandError } from "../../src/views/commands.ts";
import type { LearningState } from "../../src/views/pages/proposals/proposals-model.ts";
import {
  PENDING_PROPOSAL_LIMIT,
  PENDING_REFRESH_MS,
  pendingCountOf,
  pendingListParams,
  readPendingCount,
  watchPendingCount,
  type PendingReadPorts,
  type PendingWatchPorts,
} from "../../src/views/proposal-pending.ts";

// 사이드바 "제안" 배지와 받은 요청 제안 줄이 쓰는 대기 제안 수. 질의, 학습 꺼짐 거르기, 목록 실패는 0, 다시 읽는 때를 본다.

type Row = { readonly source: ProposalSource };
const LEARNING: Row = { source: "learning" };
const KNOWLEDGE: Row = { source: "knowledge" };

const ON: LearningState = { status: "on" };
const OFF: LearningState = { status: "off", turnOn: null };
const UNKNOWN: LearningState = { status: "unknown" };

/** 확장 목록의 한 항목. 학습 그룹의 켜짐을 정하는 값만 바꾼다(proposals-model 시험과 같은 모양) */
function extEntry(overrides: Partial<ExtListEntry>): ExtListEntry {
  return {
    name: "learning",
    displayName: "Learning",
    layer: "L3",
    isGroup: true,
    version: "0.1.0",
    location: "builtin",
    requestedGrade: "builtin",
    effectiveGrade: "builtin",
    tier: null,
    status: "enabled",
    plugins: [],
    diagnostics: [],
    autoDisabled: false,
    safeModeExcluded: null,
    hookCount: 0,
    ...overrides,
  };
}

/** 읽기 포트를 가짜로 만든다. 질의와 확장 목록 읽기 횟수를 센다 */
function readingPorts(
  listed: Result<{ readonly rows: readonly Row[] }, CommandError>,
  extensions: Result<readonly ExtListEntry[], CommandError>,
): {
  readonly ports: PendingReadPorts;
  readonly asked: ProposalListParams[];
  readonly extensionReads: number[];
} {
  const asked: ProposalListParams[] = [];
  const extensionReads: number[] = [];
  const ports: PendingReadPorts = {
    proposals: (params) => {
      asked.push(params);
      return Promise.resolve(listed);
    },
    extensions: () => {
      extensionReads.push(1);
      return Promise.resolve(extensions);
    },
  };
  return { ports, asked, extensionReads };
}

describe("pending proposal query", () => {
  test("asks for pending rows only, up to the list limit", () => {
    expect(PENDING_PROPOSAL_LIMIT).toEqual(200);
    expect(pendingListParams()).toEqual({ status: ["pending"], limit: 200 });
  });
});

describe("pendingCountOf", () => {
  test("counts every pending row while learning is on or unknown", () => {
    const rows = [LEARNING, LEARNING, KNOWLEDGE];
    expect(pendingCountOf(rows, ON)).toEqual(3);
    expect(pendingCountOf(rows, UNKNOWN)).toEqual(3);
  });

  test("leaves out learning rows while the learning group is off and keeps knowledge rows", () => {
    expect(pendingCountOf([LEARNING, LEARNING, KNOWLEDGE], OFF)).toEqual(1);
    expect(pendingCountOf([LEARNING], OFF)).toEqual(0);
  });

  test("is zero with no rows", () => {
    expect(pendingCountOf([], ON)).toEqual(0);
  });
});

describe("readPendingCount", () => {
  test("counts the rows of the pending list, asking with the pending query", async () => {
    const { ports, asked } = readingPorts(
      ok({ rows: [LEARNING, LEARNING, KNOWLEDGE] }),
      err({ kind: "offline" }),
    );
    expect(await readPendingCount(ports)).toEqual(3);
    expect(asked).toEqual([{ status: ["pending"], limit: 200 }]);
  });

  test("counts zero when the learning group is off, but keeps knowledge rows", async () => {
    const { ports } = readingPorts(ok({ rows: [LEARNING, KNOWLEDGE] }), ok([]));
    expect(await readPendingCount(ports)).toEqual(1);
  });

  test("counts the learning rows when the learning group is on", async () => {
    const { ports } = readingPorts(
      ok({ rows: [LEARNING, KNOWLEDGE] }),
      ok([extEntry({ status: "enabled" })]),
    );
    expect(await readPendingCount(ports)).toEqual(2);
  });

  test("counts the learning rows when the extension list cannot be read", async () => {
    const { ports } = readingPorts(ok({ rows: [LEARNING, LEARNING] }), err({ kind: "failed" }));
    expect(await readPendingCount(ports)).toEqual(2);
  });

  test("reads the extension list only when a learning row is pending", async () => {
    const { ports, extensionReads } = readingPorts(ok({ rows: [KNOWLEDGE, KNOWLEDGE] }), ok([]));
    expect(await readPendingCount(ports)).toEqual(2);
    expect(extensionReads).toEqual([]);
  });

  test("counts zero when the list fails, without reading the extension list", async () => {
    const { ports, extensionReads } = readingPorts(err({ kind: "unsupported" }), ok([]));
    expect(await readPendingCount(ports)).toEqual(0);
    expect(extensionReads).toEqual([]);
  });

  test("counts zero when there is nothing pending", async () => {
    const { ports } = readingPorts(ok({ rows: [] }), ok([]));
    expect(await readPendingCount(ports)).toEqual(0);
  });
});

/** 다시 읽는 때를 가짜 사건으로 본다. 등록된 듣개를 직접 부른다 */
function watchingPorts(): {
  readonly ports: PendingWatchPorts;
  readonly calls: string[];
  readonly stopped: string[];
  readonly fire: {
    tick?: () => void;
    focus?: () => void;
    workbench?: () => void;
    notice?: (kind: NoticeKind) => void;
  };
} {
  const calls: string[] = [];
  const stopped: string[] = [];
  const fire: {
    tick?: () => void;
    focus?: () => void;
    workbench?: () => void;
    notice?: (kind: NoticeKind) => void;
  } = {};
  const ports: PendingWatchPorts = {
    read: () => {
      calls.push("read");
    },
    every: (ms, listener) => {
      calls.push(`every ${ms}`);
      fire.tick = listener;
      return () => {
        stopped.push("every");
      };
    },
    onFocus: (listener) => {
      fire.focus = listener;
      return () => {
        stopped.push("focus");
      };
    },
    onWorkbench: (listener) => {
      fire.workbench = listener;
      return () => {
        stopped.push("workbench");
      };
    },
    onNotice: (listener) => {
      fire.notice = listener;
      return () => {
        stopped.push("notice");
      };
    },
  };
  return { ports, calls, stopped, fire };
}

describe("watchPendingCount", () => {
  test("reads once at start, then every 30 seconds, on focus, on a workbench change, and on a background-completed notice", () => {
    const { ports, calls, fire } = watchingPorts();
    watchPendingCount(ports);
    expect(PENDING_REFRESH_MS).toEqual(30_000);
    expect(calls).toEqual(["read", "every 30000"]);
    fire.tick?.();
    fire.focus?.();
    fire.workbench?.();
    fire.notice?.("background_completed");
    expect(calls).toEqual(["read", "every 30000", "read", "read", "read", "read"]);
  });

  test("ignores notices that are not background completions", () => {
    const { ports, calls, fire } = watchingPorts();
    watchPendingCount(ports);
    fire.notice?.("approval_waiting");
    fire.notice?.("error");
    expect(calls).toEqual(["read", "every 30000"]);
  });

  test("stops every listener when the returned function is called", () => {
    const { ports, stopped } = watchingPorts();
    const stop = watchPendingCount(ports);
    stop();
    expect(stopped).toEqual(["every", "focus", "workbench", "notice"]);
  });
});
