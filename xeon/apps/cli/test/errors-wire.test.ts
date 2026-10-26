import { expect, test } from "bun:test";
import { WireError, wireError } from "@xeon/contracts/wire";
import { failureOfWire } from "../src/errors.ts";
import { EXIT } from "../src/exit-codes.ts";

// F 오류 표에 M2 마감(m2c)이 더한 kind를 두 줄 문구와 종료 코드로 바꾸는지 값으로 비교한다.

test("dedicated secret.* kinds map to the same phrases as the legacy internal details", () => {
  expect(failureOfWire(wireError("secret.notFound", { details: { where: "meta" } }))).toEqual({
    message: "그 이름의 비밀이 없다",
    fix: "xeon secret ls로 이름을 확인하거나 xeon secret add <이름>으로 만든다",
    code: EXIT.error,
  });
  expect(failureOfWire(wireError("secret.inUse", { details: { activeLeases: 2 } }))).toEqual({
    message: "사용 중인 비밀이라 지울 수 없다 (활성 lease 2개)",
    fix: "사용이 끝난 뒤 다시 지운다. 값만 바꾸려면 xeon secret rotate <이름>을 쓴다",
    code: EXIT.error,
  });
  expect(
    failureOfWire(
      wireError("secret.providerUnavailable", {
        details: { provider: "sops", reason: "binary_missing" },
      }),
    ),
  ).toEqual({
    message: "비밀 제공자(sops)를 쓸 수 없다 (binary_missing)",
    fix: "sops와 age를 설치하고 xeon doctor로 확인한다",
    code: EXIT.environment,
  });
  expect(
    failureOfWire(wireError("secret.keyUnavailable", { details: { key: "age", reason: "locked" } }))
      .code,
  ).toBe(EXIT.environment);
  expect(failureOfWire(wireError("secret.alreadyExists")).code).toBe(EXIT.error);
  expect(failureOfWire(wireError("secret.reauthRequired")).message).toBe(
    "사람 확인이 끝나지 않아 거부되었다",
  );
  expect(failureOfWire(wireError("secret.cancelled")).message).toBe("비밀 입력을 취소했다");
  expect(
    failureOfWire(
      wireError("secret.writeFailed", { details: { target: "key_file", code: "EACCES" } }),
    ).code,
  ).toBe(EXIT.environment);
});

test("the legacy internal details.secret path still works", () => {
  const failure = failureOfWire(
    wireError("internal", { details: { secret: { kind: "in_use", activeLeases: 1 } } }),
  );
  expect(failure.message).toBe("사용 중인 비밀이라 지울 수 없다 (활성 lease 1개)");
});

test("thread.closed, settings.reserved and store.corrupt have their own phrases", () => {
  expect(failureOfWire(wireError("thread.closed", { details: { threadId: "thr_1" } }))).toEqual({
    message: "닫힌 세션이라 쓸 수 없다: thr_1",
    fix: "xeon sessions fork로 분기하거나 새 세션을 연다",
    code: EXIT.error,
  });
  expect(
    failureOfWire(wireError("settings.reserved", { details: { key: "l1.loop.future" } })),
  ).toEqual({
    message: "아직 읽는 코드가 없는 예약 키다: l1.loop.future",
    fix: "xeon config list로 쓸 수 있는 키를 확인한다",
    code: EXIT.usage,
  });
  const corrupt = failureOfWire(
    wireError("store.corrupt", { details: { where: "items.payload" } }),
  );
  expect(corrupt.message).toBe("저장된 데이터가 스키마와 다르다 (items.payload)");
  expect(corrupt.code).toBe(EXIT.error);
});

function capabilityError(code: string, detail: Record<string, unknown>): WireError {
  return new WireError(4000, "developer text", {
    kind: `cap.dialog.commands.${code}`,
    retryable: false,
    details: detail,
  });
}

test("slash command failures come as capability errors and map to Korean phrases", () => {
  expect(
    failureOfWire(capabilityError("command_args_invalid", { message: "required: goal" })),
  ).toEqual({
    message: "명령 인자가 선언에 맞지 않다: required: goal",
    fix: "/help로 명령의 사용법을 확인한다",
    code: EXIT.usage,
  });
  expect(failureOfWire(capabilityError("command_shell_disabled", {}))).toEqual({
    message: "셸 주입이 설정에서 꺼져 있어 이 명령을 실행하지 않는다",
    fix: "l2.dialog.commands.shellInjection 설정을 확인한다 (xeon config get)",
    code: EXIT.error,
  });
  const other = failureOfWire(capabilityError("unavailable", {}));
  expect(other.message).toBe("슬래시 명령을 실행하지 못했다 (cap.dialog.commands.unavailable)");
});

test("compaction kinds have their own phrases and the exit code 1", () => {
  expect(
    failureOfWire(
      wireError("thread.cancelledByExtension", {
        details: { point: "session_before_compact", reason: null },
      }),
    ),
  ).toEqual({
    message: "확장이 컴팩션 작업을 막았다",
    fix: "확장의 설정을 확인한다 (xeon config get)",
    code: EXIT.error,
  });
  expect(
    failureOfWire(
      wireError("thread.cancelledByExtension", {
        details: { point: "session_before_fork", reason: "분기 금지" },
      }),
    ).message,
  ).toBe("확장이 분기 작업을 막았다: 분기 금지");
  expect(
    failureOfWire(wireError("thread.compactFailed", { details: { reason: "commit_failed" } })),
  ).toEqual({
    message: "대화를 요약하지 못했다 (commit_failed)",
    fix: "잠시 뒤 다시 /compact를 실행한다. 반복되면 xeon doctor를 실행하고 보고한다",
    code: EXIT.error,
  });
  expect(failureOfWire(wireError("request.cancelled"))).toEqual({
    message: "요청이 취소되었다",
    fix: "필요하면 다시 실행한다",
    code: EXIT.error,
  });
});
