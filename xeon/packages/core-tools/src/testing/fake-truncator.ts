import type { OutputTruncator } from "../types.ts";
import { utf8Bytes } from "../util.ts";

// 출력 절단 대역. 운영 구현은 platform-exec의 durable truncate 포크이고, 이 대역은 앞부분 보존만 같은 규칙(줄·바이트 중
// 먼저 걸리는 쪽, 줄을 자르지 않음)으로 흉내 낸다. 운영 코드에서 쓰지 않는다.

export function fakeTruncator(): OutputTruncator {
  return {
    truncateHead(content, options) {
      const maxLines = options?.maxLines ?? 2000;
      const maxBytes = options?.maxBytes ?? 51_200;
      const lines = content.split("\n");
      const totalBytes = utf8Bytes(content).length;
      if (lines.length <= maxLines && totalBytes <= maxBytes) {
        return {
          content,
          truncated: false,
          truncatedBy: null,
          totalLines: lines.length,
          totalBytes,
          outputLines: lines.length,
          outputBytes: totalBytes,
          lastLinePartial: false,
          firstLineExceedsLimit: false,
          maxLines,
          maxBytes,
        };
      }
      const kept: string[] = [];
      let bytes = 0;
      let by: "lines" | "bytes" = lines.length > maxLines ? "lines" : "bytes";
      for (const line of lines) {
        const lineBytes = utf8Bytes(line).length + (kept.length > 0 ? 1 : 0);
        if (kept.length >= maxLines) {
          by = "lines";
          break;
        }
        if (bytes + lineBytes > maxBytes) {
          by = "bytes";
          break;
        }
        kept.push(line);
        bytes += lineBytes;
      }
      return {
        content: kept.join("\n"),
        truncated: true,
        truncatedBy: by,
        totalLines: lines.length,
        totalBytes,
        outputLines: kept.length,
        outputBytes: bytes,
        lastLinePartial: false,
        firstLineExceedsLimit: false,
        maxLines,
        maxBytes,
      };
    },
    formatSize: (bytes) => (bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}KB`),
  };
}
