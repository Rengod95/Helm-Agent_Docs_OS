import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { attempt } from "@xeon/contracts";

// 이 프로세스가 듣고 있는 소켓 주소를 운영체제 표(/proc/net)에서 읽는다(Linux). X5가 "서비스 리스너가 모두 루프백 또는 Unix 소켓"임을
// 서비스가 스스로 적은 값이 아니라 커널이 아는 값으로 확인하려고 쓴다. /proc이 없으면 undefined다.

export interface OwnListener {
  readonly family: "tcp4" | "tcp6" | "unix";
  /** tcp4 `127.0.0.1:8080`, tcp6 `[::1]:8080`, unix 경로(이름 없는 소켓은 빈 문자열) */
  readonly address: string;
}

function ownSocketInodes(): ReadonlySet<string> | undefined {
  const entries = attempt(() => readdirSync("/proc/self/fd"));
  if (!entries.ok) return undefined;
  const inodes = new Set<string>();
  for (const entry of entries.value) {
    // 읽는 사이에 닫힌 fd는 건너뛴다
    const target = attempt(() => readlinkSync(`/proc/self/fd/${entry}`));
    if (!target.ok) continue;
    const match = /^socket:\[(\d+)\]$/.exec(target.value);
    if (match?.[1] !== undefined) inodes.add(match[1]);
  }
  return inodes;
}

function ipv4Of(hex: string): string {
  const bytes = [0, 2, 4, 6].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return bytes.toReversed().join(".");
}

function ipv6Of(hex: string): string {
  // 32자리: 4바이트 묶음 넷, 각 묶음이 리틀 엔디언
  const groups: string[] = [];
  for (let word = 0; word < 4; word += 1) {
    const chunk = hex.slice(word * 8, word * 8 + 8);
    const bytes = [0, 2, 4, 6].map((index) => chunk.slice(index, index + 2)).toReversed();
    groups.push(
      `${bytes[0]}${bytes[1]}`.replace(/^0+(?=.)/, ""),
      `${bytes[2]}${bytes[3]}`.replace(/^0+(?=.)/, ""),
    );
  }
  return groups.map((group) => group.toLowerCase()).join(":");
}

function tcpListeners(
  file: string,
  family: "tcp4" | "tcp6",
  inodes: ReadonlySet<string>,
): OwnListener[] {
  const found: OwnListener[] = [];
  const lines = readFileSync(file, "utf8").split("\n").slice(1);
  for (const line of lines) {
    const columns = line.trim().split(/\s+/);
    const [, local, , state, , , , , , inode] = columns;
    if (local === undefined || state !== "0A" || inode === undefined || !inodes.has(inode))
      continue;
    const [addressHex = "", portHex = ""] = local.split(":");
    const port = parseInt(portHex, 16);
    found.push({
      family,
      address:
        family === "tcp4"
          ? `${ipv4Of(addressHex)}:${String(port)}`
          : `[${ipv6Of(addressHex)}]:${String(port)}`,
    });
  }
  return found;
}

function unixListeners(inodes: ReadonlySet<string>): OwnListener[] {
  const found: OwnListener[] = [];
  const lines = readFileSync("/proc/net/unix", "utf8").split("\n").slice(1);
  for (const line of lines) {
    const columns = line.trim().split(/\s+/);
    const [, , , flags, , , inode, path] = columns;
    // __SO_ACCEPTCON(0x00010000)이 듣는 소켓이다
    if (flags !== "00010000" || inode === undefined || !inodes.has(inode)) continue;
    found.push({ family: "unix", address: path ?? "" });
  }
  return found;
}

export function ownListeners(): readonly OwnListener[] | undefined {
  const inodes = ownSocketInodes();
  if (inodes === undefined) return undefined;
  const found = attempt(() => [
    ...tcpListeners("/proc/net/tcp", "tcp4", inodes),
    ...tcpListeners("/proc/net/tcp6", "tcp6", inodes),
    ...unixListeners(inodes),
  ]);
  return found.ok ? found.value : undefined;
}

/** 루프백 주소인가: 127.0.0.0/8, ::1, ::ffff:127.x */
export function isLoopbackAddress(listener: OwnListener): boolean {
  if (listener.family === "unix") return true;
  if (listener.family === "tcp4") return listener.address.startsWith("127.");
  return (
    listener.address.startsWith("[0:0:0:0:0:0:0:1]") ||
    listener.address.startsWith("[0:0:0:0:0:ffff:7f")
  );
}
