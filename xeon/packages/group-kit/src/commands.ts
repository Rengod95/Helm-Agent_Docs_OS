import { assertNever } from "@xeon/contracts";
import type {
  DriveHolderSetting,
  GroupCommandError,
  GroupService,
  GroupSettingUnwritableReason,
  GroupStatus,
} from "@xeon/contracts/services";
import { GROUP_NAME_PATTERN } from "./define-group.ts";

export type GroupCommand =
  | { readonly op: "status"; readonly id?: string }
  | { readonly op: "on" | "off"; readonly id: string }
  | { readonly op: "drive"; readonly target: string };

export type GroupCommandParse =
  | { readonly ok: true; readonly command: GroupCommand }
  | { readonly ok: false; readonly usage: string };

export const GROUP_USAGE =
  "사용법: /group status [이름] | on <이름> | off <이름> | drive <이름|auto>";

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
  return usage();
}

export interface CommandOutput {
  readonly ok: boolean;
  /** 사람이 읽는 여러 줄 문자열 */
  readonly text: string;
  /** 다음 단계 경계에 적용될 변경이 있으면 참 */
  readonly pending: boolean;
}

/** createGroupService가 돌려주는 서비스. `/group status` 첫 줄이 읽는 구동 그룹 설정 값을 더 낸다 */
export interface GroupServiceWithSetting extends GroupService {
  /** 설정 x.primitives.activeDriveGroup의 현재 유효 값 */
  driveHolderSetting(): DriveHolderSetting;
}

function hasSetting(service: GroupService): service is GroupServiceWithSetting {
  return "driveHolderSetting" in service;
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

function failure(text: string): CommandOutput {
  return { ok: false, text, pending: false };
}

function runStatus(service: GroupService, id: string | undefined): CommandOutput {
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
      return Promise.resolve(runStatus(service, command.id));
    case "on":
    case "off":
      return Promise.resolve(runToggle(service, command.op, command.id));
    case "drive":
      return runDrive(service, command.target);
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
