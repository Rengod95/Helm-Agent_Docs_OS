// 감지(M5g-0, migration.md §6.1, M5g-2 뒤의 표). 엔진이 더는 읽지 않는 다른 하네스 형식(`.mcp.json`, `.agents/skills`)과 가져오기로 옮길 수 있는 표지가
// 프로젝트에 있는지 **존재만** 본다. `lstat`만 쓰고 내용은 읽지 않는다(`readBounded`·`listDir`를 부르지 않는다). `.agents/skills`는 루트와 모든 상위 폴더를 본다.
// 결과 값(`ForeignFormatNotice`)은 신뢰 상태 읽기(`trust.get`의 `foreignFormats`)에 선택 필드로 실는 값이다. `TrustStatus.resources`에는 이 두 표지가 더 들어가지 않는다.

import { Bug } from "@fresnel/contracts";
import { dirnameOf, joinPath, normalizePath } from "./paths.ts";
import type { ForeignFormatMarker, ScanFs, ScanStat } from "./types.ts";

export interface DetectInput {
  readonly fs: ScanFs;
  /** 절대 경로 */
  readonly projectRoot: string;
  /** 절대 경로. 이 폴더의 `.agents/skills`는 사용자 자원이라 세지 않는다 */
  readonly homeDir: string;
}

export interface ForeignFormatNotice {
  readonly code: "foreign_format_found";
  /**
   * 이제 읽지 않는 자리(예: ".mcp.json", "../.agents/skills"). 엔진이 예전에 읽던 자리다. 필드 이름은 wire 호환으로 그대로 둔다
   * (`ForeignFormatNoticeSchema`, 층 A). 값의 뜻만 "더는 읽지 않는 자리"다.
   */
  readonly willStopReading: readonly string[];
  /** 엔진은 읽지 않지만 가져오기로 옮길 수 있는 표지(`willStopReading`의 자리도 여기 들 수 있다) */
  readonly importable: readonly string[];
  /** 가져오기를 쓸 수 있는가(첫 조각이 다루는 표지가 하나라도 있다) */
  readonly importAvailable: boolean;
}

/** 공유 스킬 자리. 표에서 이 값만 프로젝트 루트와 모든 상위 폴더를 본다 */
const SHARED_SKILLS = ".agents/skills";

/** 폴더일 때만 표지로 치는 자리. 나머지 자리는 파일이나 폴더 어느 쪽이어도 있으면 표지다 */
const FOLDER_ONLY: ReadonlySet<string> = new Set([".claude/"]);

/**
 * 감지 표지 목록(§6.1). 데이터다. 표 순서가 결과 순서다. `engineReads`는 엔진이 지금 읽는가(M5g-2 뒤 모두 거짓), `stoppedReading`은
 * 예전에 읽던 자리인가(§8.1 1, 2번이 제거되며 참이 된다)다.
 */
export const FOREIGN_FORMAT_MARKERS: readonly ForeignFormatMarker[] = [
  {
    marker: ".mcp.json",
    harness: "claude-code",
    engineReads: false,
    stoppedReading: true,
    importable: true,
  },
  {
    marker: ".agents/skills",
    harness: "agent-skills",
    engineReads: false,
    stoppedReading: true,
    importable: true,
  },
  {
    marker: ".claude/",
    harness: "claude-code",
    engineReads: false,
    stoppedReading: false,
    importable: true,
  },
  {
    marker: "CLAUDE.md",
    harness: "claude-code",
    engineReads: false,
    stoppedReading: false,
    importable: true,
  },
  {
    marker: "CLAUDE.local.md",
    harness: "claude-code",
    engineReads: false,
    stoppedReading: false,
    importable: true,
  },
  {
    marker: ".cursor/",
    harness: "other",
    engineReads: false,
    stoppedReading: false,
    importable: false,
  },
  {
    marker: ".cursorrules",
    harness: "other",
    engineReads: false,
    stoppedReading: false,
    importable: false,
  },
  {
    marker: ".codex/",
    harness: "other",
    engineReads: false,
    stoppedReading: false,
    importable: false,
  },
  {
    marker: ".gemini/",
    harness: "other",
    engineReads: false,
    stoppedReading: false,
    importable: false,
  },
  {
    marker: "GEMINI.md",
    harness: "other",
    engineReads: false,
    stoppedReading: false,
    importable: false,
  },
  {
    marker: ".opencode/",
    harness: "other",
    engineReads: false,
    stoppedReading: false,
    importable: false,
  },
  {
    marker: ".pi/",
    harness: "other",
    engineReads: false,
    stoppedReading: false,
    importable: false,
  },
  {
    marker: ".clinerules",
    harness: "other",
    engineReads: false,
    stoppedReading: false,
    importable: false,
  },
  {
    marker: ".cline/",
    harness: "other",
    engineReads: false,
    stoppedReading: false,
    importable: false,
  },
  {
    marker: ".roo/",
    harness: "other",
    engineReads: false,
    stoppedReading: false,
    importable: false,
  },
  {
    marker: ".roomodes",
    harness: "other",
    engineReads: false,
    stoppedReading: false,
    importable: false,
  },
  {
    marker: ".windsurfrules",
    harness: "other",
    engineReads: false,
    stoppedReading: false,
    importable: false,
  },
];

/** 확인할 자리 하나. 표 한 줄이 여러 자리가 될 수 있다(`.agents/skills`) */
interface Candidate {
  readonly row: ForeignFormatMarker;
  /** 결과에 적을 상대 경로 */
  readonly marker: string;
  /** 확인할 절대 경로(끝 `/` 없음) */
  readonly path: string;
}

function absoluteOf(path: string): string {
  const normalized = path.startsWith("/") ? normalizePath(path) : undefined;
  if (normalized === undefined) throw new Bug("detect.path_not_absolute");
  return normalized;
}

/** 가까운 폴더부터 `<폴더>/.agents/skills`를 만든다. 루트(`/`)까지 올라가면 끝난다. 홈의 것은 뺀다 */
function sharedSkillCandidates(row: ForeignFormatMarker, root: string, home: string): Candidate[] {
  const found: Candidate[] = [];
  let dir = root;
  let up = "";
  for (;;) {
    if (dir !== home) {
      found.push({
        row,
        marker: `${up}${SHARED_SKILLS}`,
        path: joinPath(dir, ".agents", "skills"),
      });
    }
    const parent = dirnameOf(dir);
    if (parent === dir) return found;
    dir = parent;
    up = `${up}../`;
  }
}

function candidatesOf(root: string, home: string): readonly Candidate[] {
  return FOREIGN_FORMAT_MARKERS.flatMap((row) =>
    row.marker === SHARED_SKILLS
      ? sharedSkillCandidates(row, root, home)
      : [{ row, marker: row.marker, path: joinPath(root, row.marker.replace(/\/$/, "")) }],
  );
}

async function isPresent(fs: ScanFs, candidate: Candidate): Promise<boolean> {
  // 심볼릭 링크는 따라가지 않는다. 깨진 링크도 있는 것으로 본다
  const stat: ScanStat | null = await fs.lstat(candidate.path);
  if (stat === null) return false;
  if (FOLDER_ONLY.has(candidate.row.marker)) return stat.kind === "dir" || stat.kind === "symlink";
  return true;
}

/**
 * 프로젝트 루트에 있는 감지 표지를 표 순서대로 돌려준다. 존재만 본다(`lstat`).
 * 프로젝트 루트 밖 표지는 `.agents/skills`뿐이고, 그것도 루트부터 `/`까지의 폴더에서만 찾는다.
 * `lstat`가 던지면 그 오류를 그대로 던진다. 없음으로 바꾸지 않는다.
 */
export async function detectForeignFormats(
  input: DetectInput,
): Promise<readonly ForeignFormatMarker[]> {
  const root = absoluteOf(input.projectRoot);
  const home = absoluteOf(input.homeDir);
  const candidates = candidatesOf(root, home);
  const found = await Promise.all(
    candidates.map(async (candidate) =>
      (await isPresent(input.fs, candidate))
        ? {
            marker: candidate.marker,
            harness: candidate.row.harness,
            engineReads: candidate.row.engineReads,
            stoppedReading: candidate.row.stoppedReading,
            importable: candidate.row.importable,
          }
        : undefined,
    ),
  );
  return found.filter((marker): marker is ForeignFormatMarker => marker !== undefined);
}

/**
 * 표지가 없으면 알림도 없다(`undefined`). 있으면 이제 읽지 않는 자리(`willStopReading`)와 가져올 수 있는 자리(`importable`)를 가른다.
 * 두 목록은 겹칠 수 있다(`.mcp.json`은 읽지 않는 자리이면서 가져올 수 있다).
 */
export function foreignFormatNotice(
  markers: readonly ForeignFormatMarker[],
): ForeignFormatNotice | undefined {
  if (markers.length === 0) return undefined;
  return {
    code: "foreign_format_found",
    willStopReading: markers
      .filter((marker) => marker.stoppedReading)
      .map((marker) => marker.marker),
    importable: markers
      .filter((marker) => !marker.engineReads && marker.importable)
      .map((marker) => marker.marker),
    importAvailable: markers.some((marker) => marker.importable),
  };
}
