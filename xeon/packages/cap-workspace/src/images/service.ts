import {
  WorkspaceImages,
  type CapabilityApi,
  type ImageLimits,
  type WorkspaceImage,
} from "@xeon/contracts/capabilities";
import type { CancelScope } from "@xeon/contracts/services";
import type { WorkspaceDeps } from "../deps.ts";
import { guarded, WorkspaceFailure } from "../errors.ts";
import type { BlobSink } from "../ports/blobs.ts";
import { resolveWorkspacePath } from "../roots.ts";
import { scopedDeps } from "../scope.ts";
import type { WorkspaceSettings } from "../settings.ts";
import { getOrThrow } from "../upstream/get-or-throw.ts";
import { decodeBase64 } from "./decode.ts";
import { prepareImage } from "./prepare.ts";
import { detectSupportedImageMimeTypeOf } from "./upstream/image.ts";

// L2.workspace.spec §3.4, §4.6. M2는 처리기 없는 최소형(plan W7): register, load, 그리고 read의 이미지 분기.
// resize는 처리기가 들어오는 2차에서 구현한다.

type ImagesApi = CapabilityApi<typeof WorkspaceImages>;

const CAPABILITY = WorkspaceImages.id;

function limitsOf(
  settings: WorkspaceSettings["images"],
  override: ImageLimits | undefined,
): ImageLimits {
  return (
    override ?? {
      maxWidth: settings.maxWidth,
      maxHeight: settings.maxHeight,
      maxBytes: settings.maxBytes,
    }
  );
}

function blobsOf(deps: WorkspaceDeps): BlobSink {
  if (deps.blobs === undefined) {
    throw new WorkspaceFailure("unavailable", "The blob store is not available.", {
      detail: { by: "store", reason: "blob_store_missing" },
    });
  }
  return deps.blobs;
}

/** 이미지로 보이는 파일인지 머리 바이트로 판별한다. 이미지가 아니거나 형식을 모르면 undefined다 */
export async function probeImageType(
  deps: WorkspaceDeps,
  canonicalPath: string,
  context: CancelScope,
): Promise<string | undefined> {
  const reader = getOrThrow(await deps.env.openBinaryReader(canonicalPath, undefined, context));
  try {
    const info = getOrThrow(await reader.info(context));
    return await detectSupportedImageMimeTypeOf({
      size: info.size,
      read: async (offset, length) => getOrThrow(await reader.read(offset, length, context)),
    });
  } finally {
    await reader.close(context);
  }
}

/** 해석한 정규 경로의 이미지 파일을 읽어 준비하고 등록한다 */
export async function loadImageAt(
  deps: WorkspaceDeps,
  canonicalPath: string,
  displayPath: string,
  settings: WorkspaceSettings["images"],
  override: ImageLimits | undefined,
  context: CancelScope,
): Promise<WorkspaceImage> {
  const blobs = blobsOf(deps);
  const reader = getOrThrow(await deps.env.openBinaryReader(canonicalPath, undefined, context));
  try {
    const info = getOrThrow(await reader.info(context));
    if (info.size > settings.maxInputBytes) {
      throw new WorkspaceFailure(
        "invalid_input",
        `${displayPath} is ${info.size} bytes, over the ${settings.maxInputBytes} byte input limit.`,
        { detail: { reason: "input_too_large", size: info.size, limit: settings.maxInputBytes } },
      );
    }
    const bytes = getOrThrow(await reader.read(0, info.size, context));
    return prepareImage(bytes, limitsOf(settings, override), blobs, displayPath);
  } finally {
    await reader.close(context);
  }
}

export function createImagesApi(deps: WorkspaceDeps): ImagesApi {
  return {
    register: (input, options) =>
      guarded(CAPABILITY, "register", () => {
        const settings = deps.settings(options?.context?.threadId).images;
        const blobs = blobsOf(deps);
        // 처리 전에 입력 크기를 먼저 본다. 너무 큰 입력은 디코드하지 않는다
        if (input.data.length > settings.maxInputBytes) {
          throw new WorkspaceFailure(
            "invalid_input",
            `The image data is ${input.data.length} bytes, over the ${settings.maxInputBytes} byte input limit.`,
            {
              detail: {
                reason: "input_too_large",
                size: input.data.length,
                limit: settings.maxInputBytes,
              },
            },
          );
        }
        const bytes = decodeBase64(input.data);
        return Promise.resolve(
          prepareImage(bytes, limitsOf(settings, input.limits), blobs, input.source?.name),
        );
      }),
    load: (input, options) =>
      guarded(CAPABILITY, "load", async () => {
        const scoped = scopedDeps(deps, options?.context?.threadId);
        const context: CancelScope = { abortSignal: options?.signal };
        const settings = scoped.settings(options?.context?.threadId).images;
        const resolved = await resolveWorkspacePath(scoped.roots, input.path, "read", context, {
          variants: true,
        });
        if (!resolved.exists) {
          throw new WorkspaceFailure("not_found", `File not found: ${input.path}`);
        }
        const info = await scoped.env.fileInfo(resolved.canonical, context);
        if (!info.ok) throw info.error;
        if (info.value.kind === "directory") {
          throw new WorkspaceFailure("invalid_input", `${input.path} is a directory.`, {
            detail: { reason: "is_directory" },
          });
        }
        return loadImageAt(scoped, resolved.canonical, input.path, settings, input.limits, context);
      }),
    resize: () =>
      guarded(CAPABILITY, "resize", () =>
        Promise.reject(
          new WorkspaceFailure("unsupported", "workspace.images resize needs an image processor.", {
            detail: { milestone: "2차" },
          }),
        ),
      ),
  };
}
