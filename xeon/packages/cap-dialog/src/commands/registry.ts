import type {
  CommandActionDecl,
  CommandActionHandler,
  CommandInfo,
  CommandSource,
} from "@xeon/contracts/capabilities";
import { DialogFailure } from "../errors.ts";
import type { CommandEntry } from "./loader.ts";
import type { TemplateSegment } from "./shell.ts";

// L2.dialog.spec §4.2.3 출처 우선순위와 충돌. 코드로 등록한 명령(capability)과 클라이언트가 선언한 명령(builtin)은 이 표에 있고,
// 파일 명령(project, user)은 호출마다 읽어 합친다.

/** 앞설수록 먼저 쓴다 */
const RANK: Readonly<Record<CommandSource, number>> = {
  builtin: 0,
  capability: 1,
  project: 2,
  user: 3,
  extension: 4,
};

/** 한 이름에 올라온 후보 하나 */
export interface Candidate {
  readonly info: CommandInfo;
  readonly segments?: readonly TemplateSegment[];
  readonly handler?: CommandActionHandler;
}

export interface CommandRegistry {
  /** 코드가 등록하는 템플릿 명령. 같은 이름의 capability가 있으면 command_name_taken */
  addTemplate(info: CommandInfo, segments: readonly TemplateSegment[]): void;
  /** 동작 명령. 반환 함수로 해제한다 */
  addAction(info: CommandInfo, handler: CommandActionHandler): () => void;
  /** 클라이언트 고유 명령 선언. 반환 함수로 해제한다 */
  declareBuiltin(infos: readonly CommandInfo[]): () => void;
  /** 정적 후보와 파일 후보를 합쳐 이름마다 우선순위로 정렬한 표 */
  catalog(files: readonly CommandEntry[]): ReadonlyMap<string, readonly Candidate[]>;
}

function byRank(left: Candidate, right: Candidate): number {
  return RANK[left.info.source] - RANK[right.info.source];
}

export function createCommandRegistry(): CommandRegistry {
  const capability = new Map<string, Candidate>();
  const builtin = new Map<string, Candidate>();

  return {
    addTemplate(info, segments) {
      if (capability.has(info.name)) throw nameTaken(info.name);
      capability.set(info.name, { info, segments });
    },
    addAction(info, handler) {
      if (capability.has(info.name)) throw nameTaken(info.name);
      const candidate: Candidate = { info, handler };
      capability.set(info.name, candidate);
      return () => {
        if (capability.get(info.name) === candidate) capability.delete(info.name);
      };
    },
    declareBuiltin(infos) {
      const added = infos.map((info): [string, Candidate] => [info.name, { info }]);
      for (const [name, candidate] of added) builtin.set(name, candidate);
      return () => {
        for (const [name, candidate] of added) {
          if (builtin.get(name) === candidate) builtin.delete(name);
        }
      };
    },
    catalog(files) {
      const table = new Map<string, Candidate[]>();
      const add = (candidate: Candidate): void => {
        const list = table.get(candidate.info.name);
        if (list === undefined) table.set(candidate.info.name, [candidate]);
        else list.push(candidate);
      };
      for (const candidate of builtin.values()) add(candidate);
      for (const candidate of capability.values()) add(candidate);
      for (const entry of files) {
        add({
          info: entry.info,
          ...(entry.segments === undefined ? {} : { segments: entry.segments }),
        });
      }
      // 같은 등급은 들어온 순서를 지킨다(파일 후보는 프로젝트 디렉터리, 사용자 디렉터리 순으로 온다)
      for (const list of table.values()) list.sort(byRank);
      return table;
    },
  };
}

function nameTaken(name: string): DialogFailure {
  return new DialogFailure("command_name_taken", `The command /${name} is already registered.`);
}

/** 동작 명령 선언을 `CommandInfo`로 옮긴다 */
export function actionInfo(decl: CommandActionDecl): CommandInfo {
  return {
    name: decl.name,
    description: decl.description.slice(0, 200),
    argumentHint: decl.argumentHint === undefined ? null : decl.argumentHint.slice(0, 120),
    args: [...(decl.args ?? [])],
    kind: "action",
    source: "capability",
    origin: decl.origin.slice(0, 512),
    hasShell: false,
  };
}
