import { Bug, parse } from "@xeon/contracts";
import { SecretMetaSchema, type SecretMeta } from "@xeon/contracts/capabilities";

export interface MetaInput {
  readonly name?: string;
  readonly desc?: string;
  readonly provider?: string;
  readonly ref?: string;
  readonly scope?: string;
  readonly expiresAt?: string | null;
  readonly modes?: readonly string[];
  readonly tools?: readonly string[];
  readonly hosts?: readonly string[];
  readonly origins?: readonly string[];
  readonly commands?: readonly string[];
  readonly approval?: string;
  readonly ttlSeconds?: number;
  readonly maxUses?: number;
}

/** 입력 객체(원시 JSON 모양). 스키마 검증 전이라 파일에 그대로 쓸 수 있다 */
export function rawMeta(input: MetaInput = {}): Record<string, unknown> {
  return {
    name: input.name ?? "github-token",
    desc: input.desc ?? "test token",
    provider: input.provider ?? "sops",
    ref: input.ref ?? "dev/GITHUB_TOKEN",
    scope: input.scope ?? "user",
    expiresAt: input.expiresAt ?? null,
    use: {
      modes: input.modes ?? ["runtime-http"],
      tools: input.tools ?? ["http.request"],
      hosts: input.hosts ?? ["api.example.test"],
      ...(input.origins === undefined ? {} : { origins: input.origins }),
      ...(input.commands === undefined ? {} : { commands: input.commands }),
    },
    approval: input.approval ?? "none",
    ttlSeconds: input.ttlSeconds ?? 900,
    maxUses: input.maxUses ?? 200,
  };
}

/** 검증을 통과한 SecretMeta. 실패하면 Bug(테스트 픽스처 결함) */
export function metaOf(input: MetaInput = {}): SecretMeta {
  const checked = parse(SecretMetaSchema, rawMeta(input));
  if (!checked.ok)
    throw new Bug(`test fixture meta invalid: ${JSON.stringify(checked.error.issues)}`);
  return checked.value;
}
