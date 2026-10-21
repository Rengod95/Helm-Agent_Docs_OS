import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type Logger } from "@xeon/contracts";
import type { BinaryName, OsPlatform, ResolvedBinary } from "@xeon/contracts/services";
import type { SecretsOs } from "../../src/assemble.ts";
import { versionAtLeast } from "../../src/providers/sops.ts";
import { seededRandom } from "./random.ts";
import type { ManualClock } from "./clock.ts";

interface LogLine {
  readonly level: string;
  readonly event: string;
  readonly fields: unknown;
}

export interface RecordingLogger extends Logger {
  readonly lines: LogLine[];
}

export function recordingLogger(): RecordingLogger {
  const lines: LogLine[] = [];
  const make = (level: string) => (event: string, fields?: unknown) => {
    lines.push({ level, event, fields: fields ?? null });
  };
  const logger: RecordingLogger = {
    lines,
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
    child: () => logger,
  };
  return logger;
}

export interface TempDir {
  readonly path: string;
  join(...parts: readonly string[]): string;
  remove(): Promise<void>;
}

export async function tempDir(prefix = "xeon-secrets-"): Promise<TempDir> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  return {
    path,
    join: (...parts) => join(path, ...parts),
    remove: () => rm(path, { recursive: true, force: true }),
  };
}

export interface FakeOsOptions {
  readonly config: string;
  readonly clock: ManualClock;
  readonly platform?: OsPlatform;
  readonly isWsl?: boolean;
  readonly userId?: number | null;
  /** 이름 → [경로, 버전]. 없으면 not_found */
  readonly binaries?: Readonly<Partial<Record<BinaryName, readonly [string, string]>>>;
  readonly logger?: Logger;
}

export function fakeOs(options: FakeOsOptions): SecretsOs {
  const logger = options.logger ?? recordingLogger();
  return {
    info: {
      platform: options.platform ?? "linux",
      arch: "x64",
      isWsl: options.isWsl ?? false,
      release: "test",
    },
    dirs: { config: options.config },
    time: { clock: options.clock, scheduler: options.clock, random: seededRandom(1) },
    userId: options.userId === undefined ? null : options.userId,
    logger: () => logger,
    resolveBinary(name, opts) {
      const found = options.binaries?.[name];
      if (found === undefined) {
        return Promise.resolve(
          err({ kind: "not_found" as const, name, searched: [], hint: "install" }),
        );
      }
      const [path, version] = found;
      if (opts.minVersion !== undefined && !versionAtLeast(version, opts.minVersion)) {
        return Promise.resolve(
          err({
            kind: "version_too_old" as const,
            name,
            found: version,
            required: opts.minVersion,
          }),
        );
      }
      const resolved: ResolvedBinary = { name, path, version, source: "system" };
      return Promise.resolve(ok(resolved));
    },
  };
}
