import { assertNever, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type {
  DriveHolderSetting,
  GroupCommandError,
  GroupService,
  GroupSettingUnwritableReason,
  GroupStatus,
} from "@xeon/contracts/services";
import { GROUP_NAME_PATTERN } from "./define-group.ts";
import type { PromotionCandidate, PromotionReport } from "./promotion/report.ts";

export type GroupCommand =
  | { readonly op: "status"; readonly id?: string }
  | { readonly op: "on" | "off"; readonly id: string }
  | { readonly op: "drive"; readonly target: string }
  | { readonly op: "reset"; readonly id: string };

export type GroupCommandParse =
  | { readonly ok: true; readonly command: GroupCommand }
  | { readonly ok: false; readonly usage: string };

export const GROUP_USAGE =
  "사용법: /group status [이름] | on <이름> | off <이름> | drive <이름|auto> | reset <이름>";

const NAME_REGEX = new RegExp(GROUP_NAME_PATTERN);

function usage(): GroupCommandParse {
  return { ok: false, usage: GROUP_USAGE };
}

/** "/group" 뒤의 인자 문자열을 해석한다. 순수 함수 */
export function parseGroupCommand(args: string): GroupCommandParse {
  const tokens = args.split(/\s+/u).filter((token) => token.length > 0);
  const [sub, name, ...extra] = tokens;
  if (sub === undefined) return { ok: true, command: { op: "status" } };
  if (extra.length > 0) return usage();
  if (sub === "status") {
    if (name === undefined) return { ok: true, command: { op: "status" } };
    return NAME_REGEX.test(name) ? { ok: true, command: { op: "status", id: name } } : usage();
  }
  if (sub === "on" || sub === "off") {
    if (name === undefined || !NAME_REGEX.test(name)) return usage();
    return { ok: true, command: { op: sub, id: name } };
  }
  if (sub === "drive") {
    if (name === undefined || (name !== "auto" && !NAME_REGEX.test(name))) return usage();
    return { ok: true, command: { op: "drive", target: name } };
  }
  if (sub === "reset") {
    if (name === undefined || !NAME_REGEX.test(name)) return usage();
    return { ok: true, command: { op: "reset", id: name } };
  }
  return usage();
}

export interface CommandOutput {
  readonly ok: boolean;
  /** 사람이 읽는 여러 줄 문자열 */
  readonly text: string;
  /** 다음 단계 경계에 적용될 변경이 있으면 참 */
  readonly pending: boolean;
}

/** `/group status` 첫 줄이 읽는 구동 그룹 설정 값을 더 낸 서비스 */
export interface GroupServiceWithSetting extends GroupService {
  /** 설정 x.primitives.activeDriveGroup의 현재 유효 값 */
  driveHolderSetting(): DriveHolderSetting;
}

/**
 * `/group reset`과 `resetState`의 오류(L3.group-kit.spec §3.9). F 계약(`GroupError`)이 아니라 group-kit이 정한다.
 * `group.resetFailed`의 `message`는 X `resetScopeState`가 돌려준 오류 kind다.
 */
export type GroupResetError =
  | { readonly kind: "group.unknown"; readonly id: string; readonly known: readonly string[] }
  | { readonly kind: "group.noThread" }
  | { readonly kind: "group.notResettable"; readonly id: string }
  | { readonly kind: "group.resetFailed"; readonly id: string; readonly message: string };

/** createGroupService가 돌려주는 서비스. 상태를 보일 thread를 알려 주고 그 thread의 이벤트 집계를 갱신한다 */
export interface GroupServiceWithUsage extends GroupServiceWithSetting {
  /** 상태를 보이는 thread. 없으면 null */
  currentThread(): ThreadId | null;
  /** thread의 `lease.*`·`turn.*` 이벤트로 임대 시간과 비용 캐시를 다시 셈한다. 조회가 실패하면 캐시를 그대로 둔다 */
  refreshUsage(threadId: ThreadId): Promise<void>;
  /** 현재 thread의 승격 집계(L3.group-kit.spec §3.12). `/group status`의 후보 줄에 쓴다 */
  promotionReport(): Promise<PromotionReport>;
  /**
   * 저장 상태 오류(`group.stateInvalid`)가 남은 그룹의 상태를 선언 초기값의 새 판으로 되돌린다(X `resetScopeState`, L3.group-kit.spec §5 9번).
   * 그룹을 켜지 않는다. 성공하면 새 판 번호를 돌려준다.
   */
  resetState(id: string): Promise<Result<{ readonly rev: number }, GroupResetError>>;
}

function hasSetting(service: GroupService): service is GroupServiceWithSetting {
  return "driveHolderSetting" in service;
}

function hasUsage(service: GroupService): service is GroupServiceWithUsage {
  return "refreshUsage" in service;
}

function hasPromotion(service: GroupService): service is GroupServiceWithUsage {
  return "promotionReport" in service;
}

function hasReset(service: GroupService): service is GroupServiceWithUsage {
  return "resetState" in service;
}

/** `/group status`가 보이기 전에 현재 thread의 이벤트 집계를 갱신한다. thread가 없으면 아무것도 하지 않는다 */
async function refreshCurrent(service: GroupService): Promise<void> {
  if (!hasUsage(service)) return;
  const thread = service.currentThread();
  if (thread !== null) await service.refreshUsage(thread);
}

const SCOPE_TEXT: Readonly<Record<GroupStatus["scope"], string>> = {
  enabled: "켜짐",
  disabled: "꺼짐",
  enabling: "켜는 중(다음 단계 경계)",
  disabling: "끄는 중(다음 단계 경계)",
};

const DRIVE_TEXT: Readonly<Record<GroupStatus["drive"], string>> = {
  holder: "구동",
  waiting: "대기",
  none: "없음",
  error: "오류",
  rejected: "거부",
};

function statusLine(group: GroupStatus): string {
  const base = `${group.id}  ${SCOPE_TEXT[group.scope]}  drive=${DRIVE_TEXT[group.drive]}`;
  return group.lastError === null ? base : `${base}  오류: ${group.lastError.message}`;
}

const UNWRITABLE_TEXT: Readonly<Record<GroupSettingUnwritableReason, string>> = {
  no_thread: "쓸 대화가 없다",
  ambiguous_thread: "열린 대화가 여럿이라 어느 대화에 쓸지 정할 수 없다",
  not_owner: "그 대화의 쓰기 소유를 이 프로세스가 쥐고 있지 않다",
  project_unavailable: "프로젝트 설정 파일을 쓸 수 없다(작업 폴더가 없거나 신뢰하지 않는다)",
  invalid_value: "값이 설정 정의에 맞지 않는다",
  storage: "저장소나 설정 파일 쓰기에 실패했다",
};

function unknownText(id: string, known: readonly string[]): string {
  return `알 수 없는 그룹: ${id}. 설치된 그룹: ${known.join(", ")}`;
}

function errorText(error: GroupCommandError): string {
  switch (error.kind) {
    case "group.unknown":
      return unknownText(error.id, error.known);
    case "group.noDrive":
      return `${error.id} 그룹은 drive를 쓰지 않아 구동 그룹으로 지정할 수 없다`;
    case "group.settingLocked":
      return `${error.key}은 상위 범위 설정이 잠가 바꿀 수 없다`;
    case "group.settingUnwritable":
      return `${error.key}을 쓸 수 없다: ${UNWRITABLE_TEXT[error.reason]}`;
    default:
      return assertNever(error, "GroupCommandError");
  }
}

function resetErrorText(error: GroupResetError): string {
  switch (error.kind) {
    case "group.unknown":
      return unknownText(error.id, error.known);
    case "group.noThread":
      return "재설정할 대화가 없다";
    case "group.notResettable":
      return `${error.id} 그룹은 되돌릴 저장 상태 오류가 없다`;
    case "group.resetFailed":
      return `${error.id} 그룹의 저장 상태를 되돌리지 못했다: ${error.message}`;
    default:
      return assertNever(error, "GroupResetError");
  }
}

async function runReset(service: GroupService, id: string): Promise<CommandOutput> {
  if (!hasReset(service)) return failure("이 서비스는 저장 상태 재설정을 지원하지 않는다");
  const result = await service.resetState(id);
  if (!result.ok) return failure(resetErrorText(result.error));
  return {
    ok: true,
    text: `${id}: 저장 상태를 초기값으로 되돌렸습니다. /group on ${id}로 다시 켜세요.`,
    pending: false,
  };
}

function failure(text: string): CommandOutput {
  return { ok: false, text, pending: false };
}

/** 승격 후보 줄(L3.group-kit.spec §3.12 승격 절차 1번). 후보가 없으면 null이다 */
function promotionLine(report: PromotionReport): string | null {
  const candidates = report.candidates.filter((candidate) => candidate.candidate);
  if (candidates.length === 0) return null;
  return `승격 후보: ${candidates.map(candidateText).join("; ")}`;
}

function candidateText(candidate: PromotionCandidate): string {
  const consumers = candidate.consumers.map((consumer) => consumer.scopeId).join(", ");
  return `${candidate.tool} (${candidate.owner} -> ${consumers})`;
}

async function runStatus(service: GroupService, id: string | undefined): Promise<CommandOutput> {
  await refreshCurrent(service);
  const groups = service.list();
  const lines: string[] = [];
  if (hasSetting(service)) {
    const setting = service.driveHolderSetting();
    const installed = setting === null || groups.some((group) => group.id === setting);
    lines.push(`구동 그룹 설정: ${setting ?? "auto"}${installed ? "" : "(설치되지 않음)"}`);
  }
  if (id !== undefined) {
    const found = service.status(id);
    if (!found.ok) return failure(errorText(found.error));
    lines.push(statusLine(found.value));
    return { ok: true, text: lines.join("\n"), pending: found.value.pendingToggle !== null };
  }
  for (const group of groups) lines.push(statusLine(group));
  if (hasPromotion(service)) {
    const line = promotionLine(await service.promotionReport());
    if (line !== null) lines.push(line);
  }
  return {
    ok: true,
    text: lines.join("\n"),
    pending: groups.some((group) => group.pendingToggle !== null),
  };
}

function runToggle(service: GroupService, op: "on" | "off", id: string): CommandOutput {
  const result = op === "on" ? service.enable(id) : service.disable(id);
  if (!result.ok) return failure(errorText(result.error));
  const verb = op === "on" ? "켜기" : "끄기";
  if (result.value.appliesAt === "nextStepBoundary") {
    return {
      ok: true,
      text: `${id} ${verb} 요청을 기록했다. 다음 단계 경계에 적용한다`,
      pending: true,
    };
  }
  return { ok: true, text: `${id} 그룹을 ${op === "on" ? "켰다" : "껐다"}`, pending: false };
}

async function runDrive(service: GroupService, target: string): Promise<CommandOutput> {
  if (target === "auto") {
    const auto = await service.setDriveHolder("auto");
    if (!auto.ok) return failure(errorText(auto.error));
    return {
      ok: true,
      text: "구동 그룹 선택을 바꿨다: auto. 현재 holder는 유지한다",
      pending: false,
    };
  }
  const holderBefore = service.list().find((group) => group.drive === "holder");
  const result = await service.setDriveHolder(target);
  if (!result.ok) return failure(errorText(result.error));
  switch (result.value.appliesAt) {
    case "afterLeaseRelease":
      return {
        ok: true,
        text: `구동 그룹을 지정했다: ${target}. ${holderBefore?.id ?? "현재 holder"}의 임대가 반납된 뒤 적용한다`,
        pending: true,
      };
    case "nextStepBoundary":
      return {
        ok: true,
        text: `구동 그룹을 지정했다: ${target}. 다음 단계 경계에 적용한다`,
        pending: true,
      };
    case "now":
      return { ok: true, text: `구동 그룹을 지정했다: ${target}`, pending: false };
    default:
      return assertNever(result.value.appliesAt, "HolderReceipt.appliesAt");
  }
}

export function runGroupCommand(
  service: GroupService,
  command: GroupCommand,
): Promise<CommandOutput> {
  switch (command.op) {
    case "status":
      return runStatus(service, command.id);
    case "on":
    case "off":
      return Promise.resolve(runToggle(service, command.op, command.id));
    case "drive":
      return runDrive(service, command.target);
    case "reset":
      return runReset(service, command.id);
    default:
      return assertNever(command, "GroupCommand");
  }
}

/** L4 명령 등록부에 넘기는 모양 [가정: L4.cli.spec의 명령 등록 인터페이스] */
export interface GroupCommandRegistration {
  readonly name: "group";
  readonly summary: string;
  readonly usage: string;
  run(args: string): Promise<CommandOutput>;
}

export function groupCommand(service: GroupService): GroupCommandRegistration {
  return {
    name: "group",
    summary: "그룹 켜기·끄기와 구동 그룹 선택",
    usage: GROUP_USAGE,
    async run(args) {
      const parsed = parseGroupCommand(args);
      if (!parsed.ok) return failure(parsed.usage);
      return runGroupCommand(service, parsed.command);
    },
  };
}
