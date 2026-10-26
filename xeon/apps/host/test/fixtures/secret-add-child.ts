import { ok, parse } from "@xeon/contracts";
import { SecretMetaSchema } from "@xeon/contracts/capabilities";
import {
  createLocalIdFactory,
  createOsService,
  readOsRuntime,
  systemClock,
  systemRandom,
} from "@xeon/platform-os";
import { createSecretsRuntime, DEFAULT_SECRETS_CONFIG } from "@xeon/platform-secrets";

// 시험 보조 프로세스: 한 클라이언트(CLI나 데스크톱 사이드카 자리)처럼 xeon.os(파일 잠금 포함)와 platform-secrets를 올리고
// 비밀 하나를 `add`한다. XEON_HOME은 부모 시험이 정한 임시 디렉터리다. 결과는 한 줄 JSON이고 값은 싣지 않는다(시험이 만든 가짜 값이다).

const name = process.env["CHILD_SECRET_NAME"] ?? "";
const value = process.env["CHILD_SECRET_VALUE"] ?? "";

const runtime = readOsRuntime();
const started = await createOsService(
  { resourceDir: process.cwd(), logSink: () => undefined, logRedact: (line) => line },
  runtime,
);
if (!started.ok) {
  process.stdout.write(`${JSON.stringify({ ok: false, stage: "os", kind: started.error.kind })}\n`);
  process.exit(1);
}
const handle = started.value;
const clock = systemClock();
const secrets = createSecretsRuntime({
  os: handle.service,
  ids: createLocalIdFactory(clock, systemRandom()),
  config: () => ({
    ...DEFAULT_SECRETS_CONFIG,
    // 임시 홈에는 OS 키 저장소가 없다: 파일 키를 사람이 확인한 것으로 둔다
    ageKey: { source: "file", filePath: null },
  }),
  env: process.env,
  fileLock: handle.fileLock,
});

const meta = parse(SecretMetaSchema, {
  name,
  desc: name,
  provider: "sops",
  ref: `user/${name.toUpperCase().replaceAll("-", "_")}`,
  scope: "user",
  expiresAt: null,
  use: { modes: [], tools: [], hosts: [] },
  approval: "per-session",
  ttlSeconds: 900,
  maxUses: 200,
});
if (!meta.ok) {
  process.stdout.write(`${JSON.stringify({ ok: false, stage: "meta" })}\n`);
  process.exit(1);
}
const added = await secrets.admin.add(meta.value, {
  read: () => Promise.resolve(ok(new TextEncoder().encode(value))),
});
process.stdout.write(
  `${JSON.stringify(added.ok ? { ok: true } : { ok: false, stage: "add", kind: added.error.kind })}\n`,
);
secrets.service[Symbol.dispose]();
await handle.dispose();
process.exit(added.ok ? 0 : 1);
