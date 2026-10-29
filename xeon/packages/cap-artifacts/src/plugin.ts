import { attemptAsync, detach, err, ok } from "@xeon/contracts";
import {
  ArtifactsReviews,
  ArtifactsReviewsKey,
  CapabilityError,
  WorkspaceFilesKey,
} from "@xeon/contracts/capabilities";
import type { IdFactory, LocalIdFactory } from "@xeon/contracts/conversation";
import { InputQueuePortKey, type ExtensionEntry, type PortKey } from "@xeon/contracts/extensions";
import type { Unsubscribe } from "@xeon/contracts/records";
import {
  ApprovalServicePortKey,
  LoopServicePortKey,
  OsPortKey,
  SessionPortKey,
  StoreServicePortKey,
  ToolServicePortKey,
  type ApprovalService,
  type L2ApprovalsPort,
} from "@xeon/contracts/services";
import { hostOf, PrimitiveError, type ExtensionUnit, type ScopeHostApi } from "@xeon/ext-host";
import { artifactsManifest } from "./manifest.ts";
import type { ExecutionGuardPort, ReviewFilesPort, ReviewQueuePort } from "./ports.ts";
import { createAnswerHandler } from "./reviews/answer.ts";
import { REVIEWS_PRODUCER } from "./reviews/kernel.ts";
import { createReviews } from "./reviews/service.ts";

// L2.artifacts.spec §7. 구현 패키지를 import하지 않고 F 서비스 인터페이스를 포트로만 받는다. Cordis는 import하지 않는다(DR-11).

export interface ArtifactsPluginOptions {
  readonly ids: IdFactory;
  readonly localIds: LocalIdFactory;
  /** `xeon.approvals`를 검토 승인(kind review)을 내는 포트로 감싸는 함수. 조립 루트가 넘긴다. 없으면 열 때 승인 요청을 내지 않는다 */
  readonly approvals?: (service: ApprovalService) => L2ApprovalsPort;
  readonly loadIndex?: number;
}

function optionalPort<Api>(host: ScopeHostApi, key: PortKey<Api>): Api | undefined {
  try {
    return host.port(key);
  } catch (caught) {
    if (caught instanceof PrimitiveError && caught.code === "port_unavailable") return undefined;
    throw caught;
  }
}

/** 커밋 리스너 안에서는 새 커밋을 낼 수 없다(`store.nested_write`). 리스너가 돌아간 뒤로 미룬다 */
async function deferred(work: () => Promise<void>): Promise<void> {
  await Promise.resolve();
  await work();
}

export function artifactsPlugin(options: ArtifactsPluginOptions): ExtensionUnit {
  const manifest = artifactsManifest();
  const entry: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      const session = host.port(SessionPortKey);
      const store = host.port(StoreServicePortKey);
      const os = host.port(OsPortKey);
      const logger = os.logger("artifacts");
      const loop = optionalPort(host, LoopServicePortKey);
      const queuePort = optionalPort(host, InputQueuePortKey);
      const approvalService = optionalPort(host, ApprovalServicePortKey);
      const tools = optionalPort(host, ToolServicePortKey);

      const files: ReviewFilesPort = {
        async replace(input) {
          const edited = await attemptAsync(() =>
            g.capability(WorkspaceFilesKey).edit(
              { path: input.path, edits: [{ oldText: input.oldText, newText: input.newText }] },
              {
                requestId: input.requestId.slice(0, 64),
                ...(input.signal === undefined ? {} : { signal: input.signal }),
              },
            ),
          );
          if (edited.ok) return ok(undefined);
          const cause = edited.error.cause;
          return cause instanceof CapabilityError
            ? err({ code: cause.data.code, message: cause.message })
            : err({ code: "unavailable", message: "workspace.files is not available." });
        },
      };
      const guard: ExecutionGuardPort | undefined =
        loop === undefined ? undefined : { check: (input) => loop.guardExecution(input) };
      const queue: ReviewQueuePort | undefined =
        queuePort === undefined
          ? undefined
          : {
              enqueue: (input) => queuePort.enqueue({ ...input, scopeId: host.scopeId }),
            };

      const approvals =
        options.approvals === undefined || approvalService === undefined
          ? undefined
          : options.approvals(approvalService);
      const reviews = createReviews({
        session,
        producer: session.producer(REVIEWS_PRODUCER),
        ids: options.ids,
        localIds: options.localIds,
        blobs: store,
        files,
        guard,
        approvals,
        queue,
        logger,
        settings: () => ({ deliverAs: "followUp" }),
      });
      host.provide(ArtifactsReviewsKey, reviews.api);
      if (approvals === undefined) {
        logger.warn("artifacts.approvals_missing", {
          effect: "reviews open without an approval request",
        });
      }

      const answers = createAnswerHandler(reviews, approvalService);
      const head = session.feed.headSeq();
      let unsubscribe: Unsubscribe | undefined;
      if (head.ok) {
        const subscribed = session.subscribe(
          head.value,
          (batch) => {
            for (const event of batch.events) {
              if (event.kind !== "approval.resolved") continue;
              detach(
                deferred(() => answers.onApprovalResolved(event)),
                (cause) => {
                  logger.error("artifacts.review_answer_failed", {
                    event: event.id,
                    reason: cause instanceof Error ? cause.message : "unknown",
                  });
                },
              );
            }
          },
          { kindPrefixes: ["approval.resolved"] },
        );
        if (subscribed.ok) unsubscribe = subscribed.value;
      }
      if (unsubscribe === undefined) {
        logger.warn("artifacts.listener_unavailable", { effect: "review answers are not applied" });
      }
      g.onDispose(() => {
        unsubscribe?.();
      });

      if (tools === undefined) {
        logger.warn("artifacts.tools_missing", { effect: "review_request is not advertised" });
        return ok(undefined);
      }
      const registered = tools.register({
        kind: "capability",
        def: ArtifactsReviews,
        key: ArtifactsReviewsKey,
        // 리뷰를 열 뿐 파일을 바꾸지 않는다. 승인 대기는 대화를 막지 않는다(spec §4.2.4)
        policy: { review_request: { risk: "read" } },
      });
      if (!registered.ok) return err({ reason: registered.error.kind, cause: registered.error });
      g.onDispose(registered.value);
      return ok(undefined);
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex ?? 0, builtin: true };
}
