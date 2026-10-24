// 실제 L1.tools(ToolService, ApprovalService)를 시험이 조작하는 얇은 껍데기. 대역 구현이 아니다: 승인 요청과 해결, 권한 모드 쓰기는
// 모두 core-tools의 실제 서비스가 실제 세션에 이벤트로 남긴다. 이 파일이 더하는 것은 시험이 쓰는 관찰 창(요청 목록, 호출 기록)과
// 장애 주입(승인 요청 커밋 실패)뿐이다.
import { Bug, err, parse } from "@xeon/contracts";
import { ApprovalRequestedPayloadSchema, type SessionService } from "@xeon/contracts/records";
import {
  ApprovalIdSchema,
  type ApprovalId,
  type JsonValue,
  type ThreadId,
} from "@xeon/contracts/conversation";
import type {
  ApprovalDecision,
  ApprovalService,
  L2ApprovalRequest,
  L2ApprovalsPort,
  PermissionMode,
  ToolService,
} from "@xeon/contracts/services";
import { planApprovalsOver, type PlanApprovalsFactory } from "../../src/ports/approvals.ts";
import { toolsPermissionMode, type PermissionModePort } from "../../src/ports/permission-mode.ts";

/** 이벤트 로그에서 읽은 승인 요청 한 건 */
interface LoggedRequest {
  readonly approvalId: ApprovalId;
  /** 요청이 기록된 대화 */
  readonly threadId: ThreadId;
  /** 요청 멱등 키(`requestKey`) */
  readonly requestId: string;
  readonly kind: L2ApprovalRequest["kind"];
  /** body 안의 kind별 내용(계획이면 `{ plan, planRef, nextModes }`) */
  readonly subject: unknown;
  /** 기록된 출처(JSON 수준) */
  readonly origin: Readonly<Record<string, unknown>>;
}

export interface ApprovalsDriver {
  /** `plugin`이 기본으로 만드는 것과 같은 `planApprovalsOver` 어댑터. 호출 횟수를 센다 */
  readonly factory: PlanApprovalsFactory;
  /** 이벤트 로그에 있는 승인 요청(같은 키의 재요청은 더하지 않는다) */
  readonly requests: readonly LoggedRequest[];
  /** 어댑터의 request 호출 횟수(재요청 포함) */
  requestCalls(): number;
  /** 다음 승인 요청 커밋 n번을 저장소 오류로 실패시킨다(강제 종료 흉내). 0이면 정상 */
  failRequests(count: number): void;
  /** 사용자 화면처럼 응답한다(`approval.respond`). 적용되면 true */
  respond(approvalId: ApprovalId, decision: ApprovalDecision, answer?: JsonValue): Promise<boolean>;
}

export interface ModeDriver extends PermissionModePort {
  /** 포트로 부른 호출 기록(`enterPlan:<thread>`, `restore:<모드>:<출처>`) */
  readonly calls: string[];
  /** 사용자가 모드를 직접 바꾼다(`settings.changed` 이벤트가 남는다) */
  set(threadId: ThreadId, mode: PermissionMode): Promise<void>;
}

const REQUEST_COMMIT_KEY = /^approval:.+:request$/;

export function approvalsDriver(options: {
  readonly session: SessionService;
  readonly approvals: ApprovalService;
  /** `failRequests`가 쓰는 장애 주입 상태. harness가 세션을 감쌀 때 같은 객체를 쓴다 */
  readonly faults: RequestFaults;
}): ApprovalsDriver {
  const { session, approvals, faults } = options;
  const adapter = planApprovalsOver(approvals);
  let calls = 0;
  const factory: PlanApprovalsFactory = (origin) => {
    const port = adapter(origin);
    const counted: L2ApprovalsPort = {
      ...port,
      request(input) {
        calls += 1;
        return port.request(input);
      },
    };
    return counted;
  };
  function logged(): LoggedRequest[] {
    const head = session.feed.headSeq();
    if (!head.ok) throw new Bug("driver: cannot read the head seq", { cause: head.error });
    const read = session.feed.read(
      0,
      head.value,
      { kindPrefixes: ["approval.requested"] },
      Math.max(1, head.value),
      Math.max(1, head.value),
    );
    if (!read.ok) throw new Bug("driver: cannot read the approval requests", { cause: read.error });
    return read.value.events.map((event): LoggedRequest => {
      const payload = parse(ApprovalRequestedPayloadSchema, event.payload);
      const id = parse(ApprovalIdSchema, event.id);
      if (!payload.ok || !id.ok) throw new Bug("driver: a stored approval.requested is damaged");
      const { body } = payload.value;
      return {
        approvalId: id.value,
        threadId: payload.value.surfaceThreadId,
        requestId: payload.value.requestKey,
        kind: body.kind,
        subject:
          body.kind === "plan" ? body.plan : body.kind === "question" ? body.question : body.tool,
        origin: payload.value.origin,
      };
    });
  }
  return {
    factory,
    get requests() {
      return logged();
    },
    requestCalls: () => calls,
    failRequests(count) {
      faults.remaining = count;
    },
    async respond(approvalId, decision, answer) {
      const applied = await approvals.respond(approvalId, {
        decision,
        ...(answer === undefined ? {} : { answer }),
      });
      return applied.applied;
    },
  };
}

/** 승인 요청 커밋을 실패시키는 횟수. harness가 세션을 감싸 쓰고 `failRequests`가 바꾼다 */
export interface RequestFaults {
  remaining: number;
}

/** 승인 요청(`approval:…:request` 키) 커밋만 `remaining`번 저장소 오류로 끝내는 세션 껍데기. 나머지는 그대로 실제 세션이다 */
export function withRequestFaults(session: SessionService, faults: RequestFaults): SessionService {
  return {
    ...session,
    commit(request) {
      if (faults.remaining > 0 && REQUEST_COMMIT_KEY.test(request.requestId)) {
        faults.remaining -= 1;
        return err({ kind: "io", code: "EIO" });
      }
      return session.commit(request);
    },
  };
}

export function modeDriver(tools: ToolService): ModeDriver {
  const port = toolsPermissionMode(tools);
  const calls: string[] = [];
  return {
    calls,
    current: (threadId) => port.current(threadId),
    enterPlan(threadId) {
      calls.push(`enterPlan:${threadId}`);
      return port.enterPlan(threadId);
    },
    restore(threadId, target, source) {
      calls.push(`restore:${target}:${source}`);
      return port.restore(threadId, target, source);
    },
    async set(threadId, mode) {
      const changed = await tools.setMode(threadId, mode, "user");
      if (!changed.ok) throw new Bug(`driver: setMode ${mode} failed`, { cause: changed.error });
    },
  };
}
