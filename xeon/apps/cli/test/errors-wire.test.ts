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

// M2 첫 실행: 깨끗한 기기의 첫 `secret add`가 실패했을 때 원인에 맞는 해결을 보인다("sops와 age를 설치"는 sops가 없을 때만이다).

test("not_registered points at the provider setting, not at installing sops and age", () => {
  const failure = failureOfWire(
    wireError("secret.providerUnavailable", {
      details: { provider: "sops", reason: "not_registered" },
    }),
  );
  expect(failure.message).toBe("비밀 제공자(sops)를 쓸 수 없다 (not_registered)");
  expect(failure.fix).toContain("l0.secrets.defaultProvider");
  expect(failure.fix).toContain("l0.secrets.sops.files");
  expect(failure.fix).not.toContain("설치");
  expect(failure.code).toBe(EXIT.environment);
});

test("a too old sops asks for an upgrade; a missing one still asks for an install", () => {
  const old = failureOfWire(
    wireError("secret.providerUnavailable", {
      details: { provider: "sops", reason: "version_too_old" },
    }),
  );
  expect(old.fix).toBe("sops를 3.10.0 이상(권장 3.12.0 이상)으로 올리고 xeon doctor로 확인한다");
});

test("a file key that is not confirmed yet tells the user which setting to save", () => {
  const failure = failureOfWire(
    wireError("secret.keyUnavailable", { details: { key: "file", reason: "access_denied" } }),
  );
  expect(failure).toEqual({
    message: "복호화 키를 아직 쓸 수 없다 (OS 키 저장소가 없어 파일 키가 필요하다)",
    fix: "키를 디스크 파일에 두는 것을 확인했다면 xeon config set l0.secrets.ageKey.source file로 저장하고 다시 실행한다",
    code: EXIT.environment,
  });
  // 키 항목이 없는 경우
  expect(
    failureOfWire(
      wireError("secret.keyUnavailable", {
        details: { key: "darwin-keychain", reason: "item_missing" },
      }),
    ).message,
  ).toBe("복호화 키를 찾을 수 없다 (키 항목이 없다)");
});

const sopsFile = (code: string) =>
  failureOfWire(wireError("secret.writeFailed", { details: { target: "sops_file", code } }));

test("write failures name what could not be prepared and why", () => {
  expect(sopsFile("sops_encrypt_failed")).toEqual({
    message: "기본 비밀 파일을 준비하지 못했다 (sops_encrypt_failed)",
    fix: "sops가 파일을 암호화하지 못했다. sops 버전을 확인하고 xeon doctor로 진단한다",
    code: EXIT.environment,
  });
  expect(sopsFile("recipient_unknown").fix).toContain("l0.secrets.sops.files");
  expect(sopsFile("unsupported_format").fix).toContain(".yaml");
  expect(sopsFile("lock_timeout").fix).toBe(
    "다른 xeon이 같은 비밀 파일에 쓰고 있다. 끝난 뒤 다시 실행한다",
  );
  // OS 오류 코드는 권한과 디스크를 보게 한다
  expect(sopsFile("EACCES")).toEqual({
    message: "기본 비밀 파일을 준비하지 못했다 (EACCES)",
    fix: "xeon 설정 디렉터리의 secrets/sops 폴더 권한과 디스크 상태를 확인한다",
    code: EXIT.environment,
  });
  const store = failureOfWire(
    wireError("secret.writeFailed", { details: { target: "key_store", code: "add_failed" } }),
  );
  expect(store.message).toBe("age 키를 OS 키 저장소에 만들지 못했다 (add_failed)");
  expect(store.fix).toContain("l0.secrets.ageKey.source");
  const keyFile = failureOfWire(
    wireError("secret.writeFailed", { details: { target: "key_file", code: "EACCES" } }),
  );
  expect(keyFile.message).toBe("age 키 파일을 만들지 못했다 (EACCES)");
});
