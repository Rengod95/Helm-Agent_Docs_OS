import { parseTargetAddress } from "@fresnel/client";
import type { HostClientView } from "@fresnel/contracts/wire";
import type { EngineTargetView } from "../state/ui/index.ts";

// 대화 맥락 줄(DP-71)이 무엇을 보이고 숨기는지 정하는 순수 모델. 데이터가 없는 항목은 만들지 않는다.
// 폴더가 없는 대화는 줄 전체가 없다(연결은 새 대화 화면의 고르기가 따로 말한다).
// git 저장소 이름과 브랜치는 엔진에 묻는 명령이 아직 없어 입력이 늘 `null`이다(있으면 `project` 항목이 생긴다).

/** 연결 종류. `local`은 이 컴퓨터, `ssh`는 SSH 호스트, `web`은 그 밖의 원격(웹 게이트웨이·소켓 등)이다 */
export type ContextHostKind = "local" | "ssh" | "web";

/** 같은 엔진에 붙어 있는 다른 클라이언트 하나. 이름이 없으면(hello 전) 전송 종류로 부른다 */
export interface ContextClient {
  readonly name: string | null;
  readonly transport: HostClientView["transport"];
}

interface ContextGit {
  readonly repo: string;
  readonly branch: string | null;
}

export interface ContextInput {
  readonly workspace: string | null;
  readonly target: EngineTargetView;
  /** `host.clients` 결과(이 앱 포함). 아직 모르면 빈 목록 */
  readonly clients: readonly HostClientView[];
  readonly git: ContextGit | null;
}

export type ContextItem =
  | {
      readonly kind: "folder";
      readonly name: string;
      readonly path: string;
      /** 이름을 뺀 위쪽 경로를 줄인 꼬리. 상위가 없으면 `null` */
      readonly tail: string | null;
    }
  | { readonly kind: "project"; readonly repo: string; readonly branch: string | null }
  | { readonly kind: "host"; readonly host: ContextHostKind; readonly name: string | null }
  | { readonly kind: "clients"; readonly clients: readonly ContextClient[] };

/** 경로를 `/`와 `\`로 나눈 마디(빈 마디와 끝의 구분자는 뺀다) */
function segmentsOf(path: string): readonly string[] {
  return path.split(/[\\/]+/).filter((segment) => segment !== "");
}

/** 폴더 이름(마지막 마디). 뿌리 경로처럼 마디가 없으면 경로 그대로다 */
export function folderNameOf(path: string): string {
  return segmentsOf(path).at(-1) ?? path;
}

/** 이름 위쪽 경로의 꼬리. 마지막 두 마디만 남기고 더 있으면 `…/`를 앞에 붙인다. 상위가 없으면 `null` */
export function pathTailOf(path: string): string | null {
  const parents = segmentsOf(path).slice(0, -1);
  if (parents.length === 0) return null;
  const kept = parents.slice(-2).join("/");
  return parents.length > 2 ? `…/${kept}` : kept;
}

/** 엔진이 붙은 대상을 연결 종류와 이름으로 줄인다. 원격 이름은 저장된 이름(`label`)이고, SSH는 주소의 호스트를 쓴다 */
export function hostOf(target: EngineTargetView): {
  readonly host: ContextHostKind;
  readonly name: string | null;
} {
  if (target.kind === "local") return { host: "local", name: null };
  const parsed = parseTargetAddress(target.address);
  if (parsed.ok && parsed.target.kind === "ssh") {
    return { host: "ssh", name: target.label.trim() === "" ? parsed.target.host : target.label };
  }
  return { host: "web", name: target.label.trim() === "" ? null : target.label };
}

/** 이 앱 말고 붙은 클라이언트. 같은 이름은 한 번만 센다 */
export function otherClientsOf(clients: readonly HostClientView[]): readonly ContextClient[] {
  const seen = new Set<string>();
  const result: ContextClient[] = [];
  for (const client of clients) {
    if (client.self) continue;
    const name = client.name ?? null;
    const key = name ?? `transport:${client.transport}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name, transport: client.transport });
  }
  return result;
}

/** 줄에 놓을 항목들을 왼쪽부터 순서대로. 폴더가 없으면 비어 있다(줄을 그리지 않는다) */
export function contextItemsOf(input: ContextInput): readonly ContextItem[] {
  const { workspace } = input;
  if (workspace === null || workspace.trim() === "") return [];
  const items: ContextItem[] = [
    {
      kind: "folder",
      name: folderNameOf(workspace),
      path: workspace,
      tail: pathTailOf(workspace),
    },
  ];
  if (input.git !== null) {
    items.push({ kind: "project", repo: input.git.repo, branch: input.git.branch });
  }
  const host = hostOf(input.target);
  items.push({ kind: "host", host: host.host, name: host.name });
  const clients = otherClientsOf(input.clients);
  if (clients.length > 0) items.push({ kind: "clients", clients });
  return items;
}
