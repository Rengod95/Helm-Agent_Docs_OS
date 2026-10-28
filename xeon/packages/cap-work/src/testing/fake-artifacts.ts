import { err, ok } from "@xeon/contracts";
import type { ArtifactRef } from "@xeon/contracts/capabilities";
import type { PlanArtifactInput, PlanArtifactsPort } from "../ports/artifacts.ts";

// artifacts.registry 대역. 같은 requestId의 재호출은 처음 결과를 돌려준다(멱등).

export interface FakeArtifacts extends PlanArtifactsPort {
  /** 새로 만든 호출(멱등 재호출 제외) 기록: "register:<requestId>" 또는 "update:<artifactId>:<requestId>" */
  readonly calls: string[];
  /** 다음 호출들을 실패시킨다 */
  failWith(message: string | null): void;
}

export function createFakeArtifacts(): FakeArtifacts {
  const byRequest = new Map<string, ArtifactRef>();
  const calls: string[] = [];
  let failure: string | null = null;
  let counter = 0;
  const handle = (input: PlanArtifactInput, artifactId: string | null, label: string) => {
    if (failure !== null)
      return Promise.resolve(err({ kind: "unavailable" as const, message: failure }));
    const known = byRequest.get(input.requestId);
    if (known !== undefined) return Promise.resolve(ok(known));
    calls.push(label);
    counter += 1;
    const ref: ArtifactRef = {
      artifactId: artifactId ?? `art${counter}`,
      kind: "plan",
      title: input.title,
    };
    byRequest.set(input.requestId, ref);
    return Promise.resolve(ok(ref));
  };
  return {
    calls,
    failWith: (message) => {
      failure = message;
    },
    register: (input) => handle(input, null, `register:${input.requestId}`),
    update: (input) =>
      handle(input, input.artifactId, `update:${input.artifactId}:${input.requestId}`),
  };
}
