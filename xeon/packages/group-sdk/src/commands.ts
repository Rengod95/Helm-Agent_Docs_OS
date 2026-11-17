import { assertNever, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { GroupCommandError, GroupService, GroupStatus } from "@fresnel/contracts/services";
import { GROUP_NAME_PATTERN } from "./define-group.ts";
import type { PromotionCandidate, PromotionReport } from "./promotion/report.ts";

export type GroupCommand =
  | { readonly op: "status"; readonly id?: string }
  | { readonly op: "on" | "off"; readonly id: string }
  | { readonly op: "reset"; readonly id: string };

export type GroupCommandParse =
  | { readonly ok: true; readonly command: GroupCommand }
  | { readonly ok: false; readonly usage: string };

export const GROUP_USAGE = "사용법: /group status [이름] | on <이름> | off <이름> | reset <이름>";

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

/**
 * `/group reset`과 `resetState`의 오류(L3.group-sdk.spec §3.9). F 계약(`GroupError`)이 아니라 group-sdk이 정한다.
 * `group.resetFailed`의 `message`는 X `resetRegistrationState`가 돌려준 오류 kind다.
 */
export type GroupResetError =
  | { readonly kind: "group.unknown"; readonly id: string; readonly known: readonly string[] }
  | { readonly kind: "group.noThread" }
  | { readonly kind: "group.notResettable"; readonly id: string }
  | { readonly kind: "group.resetFailed"; readonly id: string; readonly message: string };

/** createGroupService가 돌려주는 서비스. 상태를 보일 thread를 알려 주고 그 thread의 이벤트 집계를 갱신한다 */
export interface GroupServiceWithUsage extends GroupService {
  /** 상태를 보이는 thread. 없으면 null */
  currentThread(): ThreadId | null;
  /** thread의 `lease.*`·`turn.*` 이벤트로 임대 시간과 비용 캐시를 다시 셈한다. 조회가 실패하면 캐시를 그대로 둔다 */
  refreshUsage(threadId: ThreadId): Promise<void>;
  /** 현재 thread의 승격 집계(L3.group-sdk.spec §3.12). `/group status`의 후보 줄에 쓴다 */
  promotionReport(): Promise<PromotionReport>;
  /**
   * 저장 상태 오류(`group.stateInvalid`)가 남은 그룹의 상태를 선언 초기값의 새 판으로 되돌린다(X `resetRegistrationState`, L3.group-sdk.spec §5 9번).
   * 그룹을 켜지 않는다. 성공하면 새 판 번호를 돌려준다.
   */
  resetState(id: string): Promise<Result<{ readonly rev: number }, GroupResetError>>;
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
};

function statusLine(group: GroupStatus): string {
  const base = `${group.id}  ${SCOPE_TEXT[group.scope]}  drive=${DRIVE_TEXT[group.drive]}`;
  return group.lastError === null ? base : `${base}  오류: ${group.lastError.message}`;
}

function unknownText(id: string, known: readonly string[]): string {
  return `알 수 없는 그룹: ${id}. 설치된 그룹: ${known.join(", ")}`;
}

function errorText(error: GroupCommandError): string {
  return unknownText(error.id, error.known);
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
  // 켜진 그룹은 X가 다음 경계에 다시 실행한다. 꺼진 그룹은 켜야 돈다(L3.group-sdk.spec §3.9)
  const status = service.status(id);
  const disabled = status.ok && status.value.scope === "disabled";
  const text = `${id}: 저장 상태를 초기값으로 되돌렸습니다. 다음 단계 경계에서 다시 실행됩니다.`;
  return {
    ok: true,
    text: disabled ? `${text} /group on ${id}로 켜세요.` : text,
    pending: false,
  };
}

function failure(text: string): CommandOutput {
  return { ok: false, text, pending: false };
}

/** 승격 후보 줄(L3.group-sdk.spec §3.12 승격 절차 1번). 후보가 없으면 null이다 */
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
    summary: "그룹 켜기·끄기와 상태",
    usage: GROUP_USAGE,
    async run(args) {
      const parsed = parseGroupCommand(args);
      if (!parsed.ok) return failure(parsed.usage);
      return runGroupCommand(service, parsed.command);
    },
  };
}
