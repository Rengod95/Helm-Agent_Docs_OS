import { assertNever } from "@fresnel/contracts";
import {
  wireError,
  type WireError,
  type WireHandler,
  type WireHandlers,
} from "@fresnel/contracts/wire";
import type { Engine, TrustPortFailure } from "../types.ts";

// F wire §3.3.1 trust.get, trust.decide. L4.host-service.spec HS-58, HS-70. 프로젝트 신뢰를 클라이언트가 묻고 정한다.
// 엔진은 프롬프트를 띄우지 않는다. 결정이 없는 폴더는 불신(`undecided`)이고, 사람의 결정은 이 메서드로 온다.

function trustFailure(failure: TrustPortFailure): WireError {
  switch (failure.kind) {
    case "workspace_not_absolute":
      return wireError("jsonrpc.invalidParams", {
        details: { issues: [{ path: "workspace", message: "workspace must be an absolute path" }] },
      });
    case "invalid_choice":
      return wireError("jsonrpc.invalidParams", {
        details: {
          issues: [{ path: "choice", message: "choice is not one of the options of trust.get" }],
        },
      });
    case "store_failed":
      return wireError("store.io", {
        message: `trust: the decision could not be stored (${failure.reason})`,
        details: { code: "trust_store" },
      });
    case "store_unreadable":
      return wireError("store.io", {
        message: `trust: the stored decisions could not be read (${failure.reason})`,
        details: { code: "trust_store_read" },
      });
    default:
      return assertNever(failure, "TrustPortFailure");
  }
}

// trust.list는 저장 파일을 읽기만 한다(F wire §3.3.1). 제거와 바꾸기는 아직 없다.
function createTrustListHandler(engine: Engine): WireHandler<"trust.list"> {
  const { trust } = engine.ports;
  return async (_params, context) => {
    const listed = await trust.list(context.signal);
    if (!listed.ok) throw trustFailure(listed.error);
    return listed.value;
  };
}

function createTrustGetHandler(engine: Engine): WireHandler<"trust.get"> {
  const { trust } = engine.ports;
  return async (params, context) => {
    const status = await trust.get(params.workspace, context.signal);
    if (!status.ok) throw trustFailure(status.error);
    return status.value;
  };
}

function createTrustDecideHandler(engine: Engine): WireHandler<"trust.decide"> {
  const { trust } = engine.ports;
  return async (params, context) => {
    const status = await trust.decide(params.workspace, params.choice, context.signal);
    if (!status.ok) throw trustFailure(status.error);
    return status.value;
  };
}

export function createTrustHandlers(
  engine: Engine,
): Pick<WireHandlers, "trust.get" | "trust.decide" | "trust.list"> {
  return {
    "trust.get": createTrustGetHandler(engine),
    "trust.decide": createTrustDecideHandler(engine),
    "trust.list": createTrustListHandler(engine),
  };
}
