import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import type { NoticeKind } from "@fresnel/contracts/capabilities";
import type { ProposalListParams } from "@fresnel/contracts/wire";
import type { CommandError } from "../../src/views/commands.ts";
import {
  PENDING_PROPOSAL_LIMIT,
  PENDING_REFRESH_MS,
  pendingListParams,
  readPendingCount,
  watchPendingCount,
  type PendingReadPorts,
  type PendingWatchPorts,
} from "../../src/views/proposal-pending.ts";

// 사이드바 "제안" 배지와 받은 요청 제안 줄이 쓰는 대기 제안 수. 질의, 행 수, 목록 실패는 0, 다시 읽는 때를 본다.

/** 읽기 포트를 가짜로 만든다. 질의를 기록한다 */
function readingPorts(listed: Result<{ readonly rows: readonly unknown[] }, CommandError>): {
  readonly ports: PendingReadPorts;
  readonly asked: ProposalListParams[];
} {
  const asked: ProposalListParams[] = [];
  const ports: PendingReadPorts = {
    proposals: (params) => {
      asked.push(params);
      return Promise.resolve(listed);
    },
  };
  return { ports, asked };
}

describe("pending proposal query", () => {
  test("asks for pending rows only, up to the list limit", () => {
    expect(PENDING_PROPOSAL_LIMIT).toEqual(200);
    expect(pendingListParams()).toEqual({ status: ["pending"], limit: 200 });
  });
});

describe("readPendingCount", () => {
  test("counts the rows of the pending list, asking with the pending query", async () => {
    const { ports, asked } = readingPorts(
      ok({ rows: [{ source: "learning" }, { source: "learning" }, { source: "knowledge" }] }),
    );
    expect(await readPendingCount(ports)).toEqual(3);
    expect(asked).toEqual([{ status: ["pending"], limit: 200 }]);
  });

  test("counts learning rows and knowledge rows alike", async () => {
    const { ports } = readingPorts(ok({ rows: [{ source: "learning" }, { source: "knowledge" }] }));
    expect(await readPendingCount(ports)).toEqual(2);
  });

  test("counts zero when the list fails", async () => {
    const { ports } = readingPorts(err({ kind: "unsupported" }));
    expect(await readPendingCount(ports)).toEqual(0);
  });

  test("counts zero when there is nothing pending", async () => {
    const { ports } = readingPorts(ok({ rows: [] }));
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
    notice?: (kind: NoticeKind) => void;
  };
} {
  const calls: string[] = [];
  const stopped: string[] = [];
  const fire: {
    tick?: () => void;
    focus?: () => void;
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
  test("reads once at start, then every 30 seconds, on focus, and on a background-completed notice", () => {
    const { ports, calls, fire } = watchingPorts();
    watchPendingCount(ports);
    expect(PENDING_REFRESH_MS).toEqual(30_000);
    expect(calls).toEqual(["read", "every 30000"]);
    fire.tick?.();
    fire.focus?.();
    fire.notice?.("background_completed");
    expect(calls).toEqual(["read", "every 30000", "read", "read", "read"]);
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
    expect(stopped).toEqual(["every", "focus", "notice"]);
  });
});
