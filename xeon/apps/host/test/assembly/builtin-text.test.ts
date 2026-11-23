import { expect, test } from "bun:test";
import { BUILTIN_PLUGIN_NAMES, type ExtensionManifest } from "@fresnel/contracts/extensions";
import { sessionManifest } from "@fresnel/core-persistence";
import { TASKS_MANIFEST } from "@fresnel/core-tasks";
import { manifest as modelsManifest } from "@fresnel/core-models";
import { manifest as contextManifest } from "@fresnel/core-context";
import { toolsManifest } from "@fresnel/core-tools";
import { LOOP_MANIFEST } from "@fresnel/core-loop";
import { agentsManifest } from "@fresnel/core-agents";
import { workspaceManifest } from "@fresnel/cap-workspace";
import { dialogManifest } from "@fresnel/cap-dialog";
import { artifactsManifest } from "@fresnel/cap-artifacts";
import { workManifest } from "@fresnel/cap-work";
import { webManifest } from "@fresnel/cap-web";
import { knowledgeManifest } from "@fresnel/cap-knowledge";
import { scheduleManifest } from "@fresnel/cap-schedule";
import { authoringManifest } from "@fresnel/plugin-builder";
import { guideManifest } from "@fresnel/plugin-guide";
import { partial } from "../fixtures/unsafe.ts";
import { dialogBridgePlugin, type CommandRegistryHolder } from "../../src/assembly/l2-units.ts";
import { hostMcpPlugin, type HostMcpOptions } from "../../src/assembly/cap-mcp.ts";
import {
  goalBridgePlugin,
  memoryBridgePlugin,
  skillBridgePlugin,
  taskBridgePlugin,
  type DialogAreaHolder,
} from "../../src/assembly/m4/dialog-area-bridge.ts";
import { proposalsBridgePlugin, type KnowledgeWireHolder } from "../../src/assembly/proposals.ts";

// AGE-31 (2026-11-23 사용자 결정): 내장 플러그인 23개는 목적(purpose)과 설명(description)을 매니페스트에 싣는다.
// 아래 표가 en 글의 정본이다. 내장 이름이 늘거나 글이 바뀌면 이 표를 함께 고친다.

/** 이름, 목적, 설명(en). 순서는 계약의 내장 이름 목록과 무관하다 */
const TEXTS = [
  [
    "core-persistence",
    "Saves conversations and opens them again.",
    "Saves each conversation as it goes so it comes back after a restart; without it, closing the app loses the conversation.",
  ],
  [
    "core-tasks",
    "Lets you stop work in progress.",
    "Tracks running work so it can be cancelled and queues input sent while the agent is busy; without it, stopping a turn and queued messages do not work.",
  ],
  [
    "core-models",
    "Calls the AI model and brings back its answer.",
    "Calls model providers, picks the model for each role and counts usage; without it, the agent cannot talk to any model.",
  ],
  [
    "core-context",
    "Builds what the model sees each turn.",
    "Builds what the model sees each turn and shrinks or restores the conversation when it outgrows the model's limit; without it, long conversations fail.",
  ],
  [
    "core-tools",
    "Lets the model use tools.",
    "Offers tools to the model, applies permission rules and approvals and trims results that are too large; without it, the agent cannot use tools.",
  ],
  [
    "core-loop",
    "Runs each turn from start to finish.",
    "Asks the model, runs the tools it calls and saves every step in order; without it, the agent cannot answer.",
  ],
  [
    "core-agents",
    "Hands parts of the work to subagents.",
    "Lets the agent hand work to subagents in child conversations within its own permissions; without it, subagents do not run.",
  ],
  [
    "cap-workspace",
    "Gives the agent files and a shell in the workspace.",
    "Gives the agent tools to read and edit files and run commands in the workspace; without it, the agent cannot touch files or run commands.",
  ],
  [
    "cap-dialog",
    "Shows questions, slash commands and notices in the conversation.",
    "Handles questions, slash commands, the status line, attachments and notices in a conversation; without it, none of these appear.",
  ],
  [
    "cap-artifacts",
    "Keeps the files you make and lets you review changes.",
    "Stores the files a conversation makes and lets you approve or reject each part of the agent's edits; without it, changes cannot be reviewed.",
  ],
  [
    "host-dialog-bridge",
    "Connects the agent's questions to the app.",
    "Gives the agent a question tool and connects commands, the status line, attachments and notices to the app; without it, the agent cannot ask you anything.",
  ],
  [
    "cap-work",
    "Keeps to-dos and goals across turns.",
    "Keeps a to-do list and goals that last across turns; without it, the agent forgets its plan every turn.",
  ],
  [
    "cap-mcp",
    "Lets the agent use tools from MCP servers.",
    "Connects to MCP servers and offers their tools, prompts and resources to the agent; without it, MCP servers cannot be used.",
  ],
  [
    "cap-web",
    "Lets the agent search the web and read pages.",
    "Provides web search and page fetching with usage limits, caching and cost totals; without it, the agent cannot reach the web.",
  ],
  [
    "cap-knowledge",
    "Remembers across conversations with skills and memory.",
    "Stores skills and memory, searches past conversations and records changes to them; without it, the agent cannot remember beyond one conversation.",
  ],
  [
    "host-goal-bridge",
    "Shows goals beside the conversation.",
    "Connects the goal service to the app so goals show beside the conversation; without it, the goals panel looks empty.",
  ],
  [
    "host-task-bridge",
    "Shows tasks beside the conversation.",
    "Connects the task list service to the app so tasks show beside the conversation; without it, the task list looks empty.",
  ],
  [
    "host-skill-bridge",
    "Shows skills in the Skills screen.",
    "Connects the skill service to the app so the Skills screen can list them; without it, skills cannot be used from the app.",
  ],
  [
    "host-memory-bridge",
    "Lets you read and edit memory in the app.",
    "Connects the memory service to the app so memory can be read and edited; without it, memory cannot be used from the app.",
  ],
  [
    "host-proposals-bridge",
    "Brings knowledge proposals to you for a decision.",
    "Sends knowledge proposals waiting for a decision to the app and returns your answer; without it, proposals cannot be accepted or rejected.",
  ],
  [
    "cap-schedule",
    "Runs a prompt at a time you choose.",
    "Opens a new unattended conversation at the set time and runs the prompt; without it, scheduled runs do not happen.",
  ],
  [
    "authoring",
    "Builds and fixes plugins through a conversation.",
    "Guides you from choosing a kind and a name through the scaffold, checks, a test and sending to review, and keeps writes inside the plugin folder while it works.",
  ],
  [
    "guide",
    "Lets the agent explain how to use Fresnel.",
    "Gives the agent skills about how Fresnel works, such as plugins, settings, assets, data and diagnostics, and it reads only the part that fits your question.",
  ],
] as const;

/** 호스트가 조립하지 않고 패키지가 내는 매니페스트와, 호스트 조립 함수가 내는 매니페스트를 모은다. 실행 엔진 없이 만든다 */
function builtinManifests(): readonly ExtensionManifest[] {
  return [
    sessionManifest(),
    TASKS_MANIFEST,
    modelsManifest,
    contextManifest,
    toolsManifest(),
    LOOP_MANIFEST,
    agentsManifest(),
    workspaceManifest(),
    dialogManifest(),
    artifactsManifest(),
    dialogBridgePlugin(partial<CommandRegistryHolder>({}), 0).manifest,
    workManifest(),
    hostMcpPlugin(partial<HostMcpOptions>({})).manifest,
    webManifest(),
    knowledgeManifest(),
    goalBridgePlugin(partial<DialogAreaHolder>({}), 0).manifest,
    taskBridgePlugin(partial<DialogAreaHolder>({}), 0).manifest,
    skillBridgePlugin(partial<DialogAreaHolder>({}), 0).manifest,
    memoryBridgePlugin(partial<DialogAreaHolder>({}), 0).manifest,
    proposalsBridgePlugin(partial<KnowledgeWireHolder>({}), 0).manifest,
    scheduleManifest(),
    authoringManifest,
    guideManifest,
  ];
}

test("the 23 built-in plugins are the contract's names and each carries its purpose and description", () => {
  const manifests = builtinManifests();
  const actual = Object.fromEntries(
    manifests.map(
      (manifest) =>
        [
          manifest.name,
          { purpose: manifest.purpose ?? null, description: manifest.description ?? null },
        ] as const,
    ),
  );
  const expected = Object.fromEntries(
    TEXTS.map(([name, purpose, description]) => [name, { purpose, description }] as const),
  );
  // 읽은 매니페스트의 이름, 표의 이름, 계약의 내장 이름 목록이 같은 23개여야 한다. 새 내장이 목록에 들어오면 여기서 실패한다
  expect(manifests).toHaveLength(BUILTIN_PLUGIN_NAMES.length);
  expect(Object.keys(actual).toSorted()).toEqual([...BUILTIN_PLUGIN_NAMES].toSorted());
  expect(Object.keys(expected).toSorted()).toEqual([...BUILTIN_PLUGIN_NAMES].toSorted());
  expect(actual).toEqual(expected);
});
