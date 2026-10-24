import { assertNever } from "@xeon/contracts";
import {
  CapabilityError,
  DialogAttachments,
  type Attachment,
  type CallOptions,
  type CapabilityApi,
  type WorkspaceImage,
} from "@xeon/contracts/capabilities";
import type { ImageContent, TextContent } from "@xeon/contracts/conversation";
import { BLOB_PLACEHOLDER_PREFIX, type BlobRef } from "@xeon/contracts/records";
import type { CancelScope } from "@xeon/contracts/services";
import type { DialogDeps } from "../deps.ts";
import { DialogFailure, guarded } from "../errors.ts";
import { isJsonObject } from "../util.ts";
import {
  attributeValue,
  baseName,
  decodeText,
  imageMimeFromName,
  sniffImageMime,
  TEXT_INLINE_MAX_BYTES,
} from "./classify.ts";

// L2.dialog.spec §3.4, §4.5. 첨부 하나를 검사하고 저장해 입력 파트를 만든다. URL은 가져오지 않는다(web.fetch의 정책을 우회하지 않는다).

type AttachmentsApi = CapabilityApi<typeof DialogAttachments>;
type AddInput = Parameters<AttachmentsApi["add"]>[0];
type AddOutput = Awaited<ReturnType<AttachmentsApi["add"]>>;
type Part = TextContent | ImageContent;

const CAPABILITY = DialogAttachments.id;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_NAME = 255;

interface Source {
  readonly bytes: Uint8Array;
  readonly name: string;
  /** 사용자가 알려 준 형식. 붙여넣기 데이터만 있다 */
  readonly declaredMime: string | null;
  /** 파일 원천이면 그 경로 */
  readonly path: string | null;
}

function tooLarge(size: number, limit: number): DialogFailure {
  return new DialogFailure(
    "attachment_too_large",
    `The attachment is ${size} bytes, over the ${limit} byte limit.`,
    {
      detail: { size, limit },
    },
  );
}

function unsupported(message: string): DialogFailure {
  return new DialogFailure("attachment_type_unsupported", message);
}

function nameOf(raw: string): string {
  return raw.slice(0, MAX_NAME);
}

function decodeBase64(data: string, maxBytes: number): Uint8Array {
  // 디코드 전에 크기를 본다. 큰 입력을 바이트로 풀지 않는다
  const approximate = Math.floor((data.length * 3) / 4);
  if (approximate > maxBytes + 3) throw tooLarge(approximate, maxBytes);
  if (data.length % 4 !== 0 || !BASE64_BODY.test(data)) {
    throw unsupported("The pasted data is not valid base64.");
  }
  return new Uint8Array(Buffer.from(data, "base64"));
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function blobsMissing(): DialogFailure {
  return new DialogFailure("unavailable", "The blob store is not available.", {
    detail: { by: "store", reason: "blob_store_missing" },
  });
}

function storeFailure(kind: string): DialogFailure {
  return new DialogFailure("unavailable", `The attachment could not be stored: ${kind}.`, {
    retryable: kind === "io" || kind === "disk_full",
    detail: { by: "store", reason: kind },
  });
}

export function createAttachmentsApi(deps: DialogDeps): AttachmentsApi {
  /** 이미지를 등록한다. `workspace.images`가 없으면 원본을 크기 한도만 검사해 직접 등록한다(spec §4.5) */
  async function registerImage(
    source: Source,
    mimeType: string,
    maxBytes: number,
    options: CallOptions | undefined,
  ): Promise<{ readonly image: WorkspaceImage; readonly processed: boolean }> {
    if (deps.images !== undefined) {
      try {
        const image = await deps.images.register(
          {
            data: encodeBase64(source.bytes),
            mimeType,
            source: {
              kind: source.path === null ? "paste" : "file",
              ...(source.name === "" ? {} : { name: source.name }),
            },
          },
          options,
        );
        return { image, processed: true };
      } catch (caught) {
        if (!(caught instanceof CapabilityError)) throw caught;
        const { code, detail } = caught.data;
        if (code === "image_unsupported" || code === "image_decode_failed") {
          throw unsupported(caught.data.message);
        }
        if (code === "image_too_large") {
          const limit = isJsonObject(detail) ? detail["maxBytes"] : undefined;
          throw tooLarge(source.bytes.length, typeof limit === "number" ? limit : maxBytes);
        }
        if (code !== "unavailable") throw caught;
        deps.logger.warn("dialog.images_unavailable", { effect: "the attachment is stored as is" });
      }
    }
    if (deps.blobs === undefined) throw blobsMissing();
    const stored = deps.blobs.putBlob(source.bytes, mimeType);
    if (!stored.ok) throw storeFailure(stored.error.kind);
    return { image: { blob: stored.value, mimeType }, processed: false };
  }

  function putBlob(bytes: Uint8Array, mediaType: string): BlobRef {
    if (deps.blobs === undefined) throw blobsMissing();
    const stored = deps.blobs.putBlob(bytes, mediaType);
    if (!stored.ok) throw storeFailure(stored.error.kind);
    return stored.value;
  }

  async function fromBytes(
    source: Source,
    maxBytes: number,
    options: CallOptions | undefined,
  ): Promise<AddOutput> {
    const name = nameOf(source.name);
    const declared =
      source.declaredMime?.startsWith("image/") === true ? source.declaredMime : null;
    const imageMime = sniffImageMime(source.bytes) ?? declared ?? imageMimeFromName(name);
    if (imageMime !== null) {
      const { image } = await registerImage(source, imageMime, maxBytes, options);
      const attachment: Attachment = {
        kind: "image",
        name,
        mime: image.mimeType,
        size: source.bytes.length,
        blob: image.blob,
        path: source.path,
        url: null,
        image:
          image.size === undefined
            ? null
            : {
                width: image.size.width,
                height: image.size.height,
                resized: image.resized !== undefined,
              },
      };
      const parts: Part[] = [
        {
          type: "image",
          data: `${BLOB_PLACEHOLDER_PREFIX}${image.blob.sha256}`,
          mimeType: image.mimeType,
        },
        { type: "text", text: name },
      ];
      return { attachment, parts };
    }

    const text = source.bytes.length <= TEXT_INLINE_MAX_BYTES ? decodeText(source.bytes) : null;
    if (text !== null) {
      const blob = putBlob(source.bytes, "text/plain");
      const pathAttribute = source.path === null ? "" : ` path="${attributeValue(source.path)}"`;
      return {
        attachment: {
          kind: "text",
          name,
          mime: "text/plain",
          size: source.bytes.length,
          blob,
          path: source.path,
          url: null,
          image: null,
        },
        parts: [
          {
            type: "text",
            text: `<attachment name="${attributeValue(name)}"${pathAttribute}>\n${text}\n</attachment>`,
          },
        ],
      };
    }

    if (source.path === null) {
      // 붙여넣은 데이터는 디스크에 다른 사본이 없다. 입력에 넣을 수 없으면 받을 수 없다
      throw unsupported(
        `The pasted data (${source.bytes.length} bytes) is neither an image nor UTF-8 text up to ${TEXT_INLINE_MAX_BYTES} bytes.`,
      );
    }
    // 큰 텍스트와 바이너리는 저장하지 않고 경로만 알린다. 모델은 read 도구로 읽는다
    return {
      attachment: {
        kind: "file",
        name,
        mime: null,
        size: source.bytes.length,
        blob: null,
        path: source.path,
        url: null,
        image: null,
      },
      parts: [
        {
          type: "text",
          text: `<attachment name="${attributeValue(name)}" path="${attributeValue(source.path)}"/>`,
        },
      ],
    };
  }

  return {
    add: (input: AddInput, options) =>
      guarded(CAPABILITY, "add", async () => {
        const maxBytes = deps.settings(options?.context?.threadId).attachments.maxBytes;
        const context: CancelScope = { abortSignal: options?.signal };
        const { source } = input;
        switch (source.kind) {
          case "url": {
            const name = nameOf(
              baseName(new URL(source.url).pathname) || new URL(source.url).hostname,
            );
            return {
              attachment: {
                kind: "url",
                name,
                mime: null,
                size: null,
                blob: null,
                path: null,
                url: source.url,
                image: null,
              },
              parts: [{ type: "text", text: `<attachment url="${attributeValue(source.url)}"/>` }],
            };
          }
          case "path": {
            const info = await deps.files.fileInfo(source.path, context);
            if (!info.ok) throw info.error;
            if (info.value.kind === "directory") {
              throw new DialogFailure("invalid_input", `${source.path} is a directory.`);
            }
            if (info.value.size > maxBytes) throw tooLarge(info.value.size, maxBytes);
            const bytes = await deps.files.readBinaryFile(source.path, context);
            if (!bytes.ok) throw bytes.error;
            return fromBytes(
              {
                bytes: bytes.value,
                name: baseName(source.path),
                declaredMime: null,
                path: source.path,
              },
              maxBytes,
              options,
            );
          }
          case "data": {
            const bytes = decodeBase64(source.data, maxBytes);
            if (bytes.length > maxBytes) throw tooLarge(bytes.length, maxBytes);
            return fromBytes(
              {
                bytes,
                name: source.name ?? "",
                declaredMime: source.mime,
                path: null,
              },
              maxBytes,
              options,
            );
          }
          default:
            return assertNever(source, "AttachmentSource");
        }
      }),
  };
}
