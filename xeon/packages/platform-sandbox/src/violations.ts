import type { SandboxViolation } from "@xeon/contracts/services";
import type { SandboxProvider } from "./provider.ts";

// L0.sandbox.spec §4.2 9단계. srt의 위반 기록(원문 줄)을 SandboxViolation으로 바꾼다.
// 경로나 호스트만 싣는다. 파일 내용과 env 값은 싣지 않는다.

/** 한 실행에 싣는 위반 종류의 상한 */
export const MAX_VIOLATIONS = 50;
const TARGET_MAX = 200;

type Source = SandboxViolation["source"];
type Parsed = Pick<SandboxViolation, "source" | "operation" | "target">;

function clip(target: string): string {
  return target.length > TARGET_MAX ? target.slice(0, TARGET_MAX) : target;
}

function parseLine(line: string, fileSource: Source): Parsed {
  // 프록시 거부: "deny network-outbound host:port (reason)"
  const network = /\bnetwork-outbound\s+(\S+)/.exec(line);
  if (network?.[1] !== undefined) {
    // 프록시가 남긴 줄은 프로세스 접두 없이 "deny"로 시작한다. 그 밖의 줄은 Seatbelt가 남긴 것이다
    const source: Source = line.startsWith("deny network-outbound") ? "proxy" : fileSource;
    return { source, operation: "network", target: clip(network[1]) };
  }
  // macOS Seatbelt: "bash(12) deny(1) file-write-create /path"
  const file = /\bfile-(read|write)[^\s]*\s+(\S.*)$/.exec(line);
  if (file?.[1] !== undefined && file[2] !== undefined) {
    return {
      source: fileSource,
      operation: file[1] === "read" ? "file_read" : "file_write",
      target: clip(file[2].trim()),
    };
  }
  // Linux seccomp 관찰자: "deny <syscall> /path"는 쓰기 의도 syscall만 보고한다
  const seccomp = /^deny\s+\S+\s+(\/.*)$/.exec(line);
  if (seccomp?.[1] !== undefined) {
    return { source: "seccomp", operation: "file_write", target: clip(seccomp[1]) };
  }
  return { source: fileSource, operation: "other" };
}

/** 같은 출처·종류·대상은 합쳐 count를 올리고, 상한을 넘으면 앞의 MAX_VIOLATIONS개만 싣는다 */
export function toViolations(
  lines: readonly string[],
  provider: Pick<SandboxProvider, "kind">,
): { readonly violations: SandboxViolation[]; readonly truncated: boolean } {
  const fileSource: Source = provider.kind === "seatbelt" ? "seatbelt" : "seccomp";
  const merged = new Map<string, SandboxViolation>();
  for (const line of lines) {
    const parsed = parseLine(line, fileSource);
    const key = `${parsed.source}|${parsed.operation}|${parsed.target ?? ""}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, {
        source: parsed.source,
        operation: parsed.operation,
        ...(parsed.target === undefined ? {} : { target: parsed.target }),
        count: 1,
      });
    } else {
      existing.count += 1;
    }
  }
  const all = [...merged.values()];
  return { violations: all.slice(0, MAX_VIOLATIONS), truncated: all.length > MAX_VIOLATIONS };
}
