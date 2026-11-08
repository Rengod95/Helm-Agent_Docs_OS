import type { SandboxBlock } from "@fresnel/contracts/capabilities";
import type { SandboxViolation } from "@fresnel/contracts/services";
import type { SandboxProvider } from "./provider.ts";

// L0.sandbox.spec §4.2 9·11단계. srt의 위반 기록(원문 줄)을 SandboxViolation으로 바꾸고, 막은 것의 분류(SandboxBlock)를 정한다.
// 경로나 호스트만 싣는다. 파일 내용과 env 값은 싣지 않는다.

/** 한 실행에 싣는 위반 종류의 상한. 막은 것의 분류 목록에도 같은 상한을 쓴다 */
export const MAX_VIOLATIONS = 50;
const TARGET_MAX = 200;

/**
 * srt 0.0.79(sandbox-manager.js `filterNetworkRequest`)가 차단 목록(deniedDomains)에 걸린 호스트를 거부할 때 붙이는 사유.
 * 다른 사유(해석된 주소가 사설 대역, 허용 목록 밖, 잘못된 호스트)는 정책이 막은 호스트 이름이 아니라서 분류하지 않는다.
 */
const DENY_LIST_REASON = "host is on the deny list";

type Source = SandboxViolation["source"];
type Parsed = Pick<SandboxViolation, "source" | "operation" | "target">;

interface Classified {
  readonly parsed: Parsed;
  readonly block?: SandboxBlock;
}

function clip(target: string): string {
  return target.length > TARGET_MAX ? target.slice(0, TARGET_MAX) : target;
}

/** "host:port"에서 호스트만 뽑는다. 대괄호로 싸인 IPv6 주소도 받는다 */
function hostOf(target: string): string {
  const bracketed = /^\[(.+)\]:\d+$/.exec(target);
  if (bracketed?.[1] !== undefined) return bracketed[1];
  const colon = target.lastIndexOf(":");
  return colon > 0 ? target.slice(0, colon) : target;
}

function parseLine(line: string, fileSource: Source): Classified {
  // 프록시 거부: "deny network-outbound host:port (reason)"
  const network = /\bnetwork-outbound\s+(\S+)/.exec(line);
  if (network?.[1] !== undefined) {
    // 프록시가 남긴 줄은 프로세스 접두 없이 "deny"로 시작한다. 그 밖의 줄은 Seatbelt가 남긴 것이다
    const proxied = line.startsWith("deny network-outbound");
    const source: Source = proxied ? "proxy" : fileSource;
    const target = clip(network[1]);
    // 직접 소켓의 Seatbelt 거부에는 정책이 막은 호스트가 없어 분류하지 않는다
    const block: SandboxBlock | undefined =
      proxied && line.endsWith(`(${DENY_LIST_REASON})`)
        ? { code: "sandbox.network_blocked", domain: clip(hostOf(network[1])) }
        : undefined;
    return {
      parsed: { source, operation: "network", target },
      ...(block === undefined ? {} : { block }),
    };
  }
  // macOS Seatbelt: "bash(12) deny(1) file-write-create /path"
  const file = /\bfile-(read|write)[^\s]*\s+(\S.*)$/.exec(line);
  if (file?.[1] !== undefined && file[2] !== undefined) {
    const path = clip(file[2].trim());
    const operation = file[1] === "read" ? "file_read" : "file_write";
    // 내용을 읽거나 쓰는 거부만 막은 것으로 본다. 메타데이터 조회(stat)는 셸이 흔히 시도하므로 분류하지 않는다
    const block: SandboxBlock | undefined =
      file[1] === "write"
        ? { code: "sandbox.write_blocked", path }
        : /^file-read-data\b/.test(file[0])
          ? { code: "sandbox.read_blocked", path }
          : undefined;
    return {
      parsed: { source: fileSource, operation, target: path },
      ...(block === undefined ? {} : { block }),
    };
  }
  // Linux seccomp 관찰자: "deny <syscall> /path"는 쓰기 의도 syscall만 보고한다
  const seccomp = /^deny\s+\S+\s+(\/.*)$/.exec(line);
  if (seccomp?.[1] !== undefined) {
    const path = clip(seccomp[1]);
    return {
      parsed: { source: "seccomp", operation: "file_write", target: path },
      block: { code: "sandbox.write_blocked", path },
    };
  }
  return { parsed: { source: fileSource, operation: "other" } };
}

/**
 * 같은 출처·종류·대상은 합쳐 count를 올리고, 상한을 넘으면 앞의 MAX_VIOLATIONS개만 싣는다.
 * blocks는 위반 전체에서 만든 막은 것의 분류다(같은 것은 한 번만, 상한 MAX_VIOLATIONS). 막은 것이 없으면 빈 목록이다.
 */
export function toViolations(
  lines: readonly string[],
  provider: Pick<SandboxProvider, "kind">,
): {
  readonly violations: SandboxViolation[];
  readonly truncated: boolean;
  readonly blocks: SandboxBlock[];
} {
  const fileSource: Source = provider.kind === "seatbelt" ? "seatbelt" : "seccomp";
  const merged = new Map<string, SandboxViolation>();
  const blocks = new Map<string, SandboxBlock>();
  for (const line of lines) {
    const { parsed, block } = parseLine(line, fileSource);
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
    if (block !== undefined) blocks.set(JSON.stringify(block), block);
  }
  const all = [...merged.values()];
  return {
    violations: all.slice(0, MAX_VIOLATIONS),
    truncated: all.length > MAX_VIOLATIONS,
    blocks: [...blocks.values()].slice(0, MAX_VIOLATIONS),
  };
}
