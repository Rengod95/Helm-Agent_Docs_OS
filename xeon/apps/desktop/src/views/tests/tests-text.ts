// 테스트 화면의 글 고르기. 모델의 값을 메시지 키로 바꾼다(글은 카탈로그에만 있다). 명령 오류는 화면이 쓰는 실패 종류로 줄인다.
import { activeLocale, type MessageId } from "@fresnel/client/i18n";
import {
  durationOf,
  type CutCell,
  type EffectKey,
  type NewTestError,
  type NewTestKind,
  type ReplayVerdict,
  type RunControl,
  type TestFailure,
  type TestKind,
  type TestKindFilter,
  type TestState,
  type TestStatusFilter,
  type TestsNotice,
} from "@fresnel/client/workbench";
import { assertNever } from "@fresnel/contracts";
import type { ReplayFailure } from "@fresnel/contracts/services";
import type { CommandError } from "../commands.ts";

export const KIND_TEXT: Readonly<Record<TestKind, MessageId>> = {
  replay: "desktop.tests.kind.replay",
  testRun: "desktop.tests.kind.testRun",
};

export const KIND_FILTER_TEXT: Readonly<Record<TestKindFilter, MessageId>> = {
  all: "desktop.tests.filter.all",
  replay: "desktop.tests.kind.replay",
  testRun: "desktop.tests.kind.testRun",
};

export const STATE_TEXT: Readonly<Record<TestState, MessageId>> = {
  running: "desktop.tests.status.running",
  passed: "desktop.tests.status.passed",
  failed: "desktop.tests.status.failed",
};

export const STATUS_FILTER_TEXT: Readonly<Record<TestStatusFilter, MessageId>> = {
  all: "desktop.tests.filter.all",
  running: "desktop.tests.status.running",
  passed: "desktop.tests.status.passed",
  failed: "desktop.tests.status.failed",
};

export const FAILURE_TEXT: Readonly<Record<ReplayFailure, MessageId>> = {
  "effects-doubled": "desktop.tests.failure.effectsDoubled",
  "effects-mismatch": "desktop.tests.failure.effectsMismatch",
  "max-commits-exceeded": "desktop.tests.failure.maxCommitsExceeded",
  "no-commits": "desktop.tests.failure.noCommits",
};

export const VERDICT_TEXT: Readonly<Record<ReplayVerdict["kind"], MessageId>> = {
  same: "desktop.tests.verdict.same",
  "digest-differs": "desktop.tests.verdict.digestDiffers",
  failure: "desktop.tests.verdict.failure",
};

export const EFFECT_TEXT: Readonly<Record<EffectKey, MessageId>> = {
  turn: "desktop.tests.effect.turn",
  spawn: "desktop.tests.effect.spawn",
  delegate: "desktop.tests.effect.delegate",
  post: "desktop.tests.effect.post",
};

export const CONTROL_TEXT: Readonly<Record<RunControl, MessageId>> = {
  pause: "desktop.tests.control.pause",
  resume: "desktop.tests.control.resume",
  step: "desktop.tests.control.step",
};

export const NEW_KIND_TEXT: Readonly<Record<NewTestKind, MessageId>> = {
  testRun: "desktop.tests.sheet.kindName.testRun",
  replay: "desktop.tests.sheet.kindName.replay",
  benchmark: "desktop.tests.sheet.kindName.benchmark",
  coreDiff: "desktop.tests.sheet.kindName.coreDiff",
  abCompare: "desktop.tests.sheet.kindName.abCompare",
};

/** 입력 칸의 오류 글. 대상은 비었거나 길고, 숫자 칸은 범위 밖이다 */
export function newTestErrorTextOf(error: NewTestError): MessageId {
  switch (error.field) {
    case "target":
      return error.reason === "tooLong"
        ? "desktop.tests.error.targetTooLong"
        : "desktop.tests.error.targetRequired";
    case "maxCommits":
      return "desktop.tests.error.maxCommits";
    case "runs":
      return "desktop.tests.error.runs";
    default:
      return assertNever(error.field, "NewTestField");
  }
}

/** 시간 칸의 글: 1초 밑은 밀리초, 1분 밑은 초, 그 밖은 분(구성기 시험 결과가 쓴다) */
export function durationTextOf(ms: number): { readonly key: MessageId; readonly value: number } {
  const duration = durationOf(ms);
  switch (duration.unit) {
    case "ms":
      return { key: "desktop.tests.duration.ms", value: duration.value };
    case "sec":
      return { key: "desktop.tests.duration.sec", value: duration.value };
    case "min":
      return { key: "desktop.tests.duration.min", value: duration.value };
    default:
      return assertNever(duration.unit, "DurationVM");
  }
}

/** 칸마다 글. 같음은 칠한 칸, 다름은 칠한 붉은 칸이다 */
export const CELL_TEXT: Readonly<Record<CutCell, MessageId>> = {
  same: "desktop.tests.detail.cell.same",
  differs: "desktop.compose.trial.cut.differs",
};

/** 시각 칸의 글. 로케일의 날짜와 시간 짧은 형식이고, 시각을 읽을 수 없으면 "—"다 */
export function timeTextOf(ms: number | null): string {
  if (ms === null) return "—";
  return new Intl.DateTimeFormat(activeLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

/** 명령 오류를 화면의 실패 종류로 줄인다. 잠김과 대상 전환 중은 일반 실패다 */
export function testFailureOf(error: CommandError): TestFailure {
  switch (error.kind) {
    case "offline":
      return "offline";
    case "unsupported":
      return "unsupported";
    case "rejected":
      return "rejected";
    case "locked":
    case "switching":
    case "failed":
      return "failed";
    default:
      return assertNever(error, "CommandError");
  }
}

const FAILURE_NOTICE: Readonly<Record<TestFailure, MessageId>> = {
  offline: "desktop.tests.notice.failed.offline",
  unsupported: "desktop.tests.notice.failed.unsupported",
  rejected: "desktop.tests.notice.failed.rejected",
  failed: "desktop.tests.notice.failed.failed",
};

export function noticeTextOf(notice: TestsNotice): MessageId {
  switch (notice.kind) {
    case "created":
      return "desktop.tests.notice.created";
    case "started":
      return "desktop.tests.notice.started";
    case "copied":
      return "desktop.tests.notice.copied";
    case "copyFailed":
      return "desktop.tests.notice.copyFailed";
    case "failed":
      return FAILURE_NOTICE[notice.failure];
    default:
      return assertNever(notice, "TestsNotice");
  }
}
