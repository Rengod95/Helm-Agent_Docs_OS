import { expect, test } from "bun:test";
import { err, ok, type Logger } from "@xeon/contracts";
import type { SessionRetention, StoreError } from "@xeon/contracts/records";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { pruneOnOpen } from "../../src/assembly/retention.ts";

// 보관 정리 호출(HS-62): 계약의 SessionService.retention만 쓴다. 로그 이벤트와 필드 값을 비교한다.

interface Logged {
  readonly level: "info" | "warn";
  readonly event: string;
  readonly fields: unknown;
}

function recorder(): { readonly logger: Logger; readonly lines: Logged[] } {
  const lines: Logged[] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: (event, fields) => {
      lines.push({ level: "info", event, fields });
    },
    warn: (event, fields) => {
      lines.push({ level: "warn", event, fields });
    },
    error: () => undefined,
    child: () => logger,
  };
  return { logger, lines };
}

function retentionOf(prune: SessionRetention["prune"]): { readonly retention: SessionRetention } {
  return { retention: { preview: () => ok([]), prune } };
}

test("a prune that deleted threads logs how many", () => {
  const ids = fixedIdFactory();
  const { logger, lines } = recorder();
  pruneOnOpen(
    retentionOf(() => ok([ids.next("thr"), ids.next("thr")])),
    logger,
  );
  expect(lines).toEqual([{ level: "info", event: "retention.pruned", fields: { count: 2 } }]);
});

test("a prune that deleted nothing logs nothing", () => {
  const { logger, lines } = recorder();
  pruneOnOpen(
    retentionOf(() => ok([])),
    logger,
  );
  expect(lines).toEqual([]);
});

test("a failed prune is logged with its kind and does not throw", () => {
  const { logger, lines } = recorder();
  const failure: StoreError = { kind: "busy" };
  pruneOnOpen(
    retentionOf(() => err(failure)),
    logger,
  );
  expect(lines).toEqual([
    { level: "warn", event: "retention.prune_failed", fields: { kind: "busy" } },
  ]);
});
