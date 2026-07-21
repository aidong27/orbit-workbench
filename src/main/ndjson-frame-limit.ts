const NEWLINE_BYTE = 0x0a;

export const DEFAULT_MAX_NDJSON_FRAME_BYTES = 4 * 1024 * 1024;
export const NDJSON_FRAME_TOO_LARGE_MESSAGE = 'ACP NDJSON frame exceeds the configured byte limit.';

export class NdjsonFrameTooLargeError extends Error {
  constructor() {
    super(NDJSON_FRAME_TOO_LARGE_MESSAGE);
    this.name = 'NdjsonFrameTooLargeError';
  }
}

/**
 * Enforces a byte limit for each LF-delimited NDJSON frame.
 *
 * The LF delimiter is not counted toward the frame size. A CR in a CRLF
 * delimiter remains part of the frame, matching the raw bytes received from
 * the child process. The returned stream preserves the source chunks when
 * they pass validation.
 */
export function limitNdjsonFrameBytes(
  source: ReadableStream<Uint8Array>,
  maxFrameBytes = DEFAULT_MAX_NDJSON_FRAME_BYTES,
): ReadableStream<Uint8Array> {
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0) {
    throw new RangeError('maxFrameBytes must be a positive safe integer.');
  }

  let currentFrameBytes = 0;

  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      let segmentStart = 0;

      while (segmentStart < chunk.byteLength) {
        const newlineIndex = chunk.indexOf(NEWLINE_BYTE, segmentStart);
        const segmentEnd = newlineIndex === -1 ? chunk.byteLength : newlineIndex;
        const segmentBytes = segmentEnd - segmentStart;

        if (segmentBytes > maxFrameBytes - currentFrameBytes) {
          throw new NdjsonFrameTooLargeError();
        }

        currentFrameBytes += segmentBytes;
        if (newlineIndex === -1) break;

        currentFrameBytes = 0;
        segmentStart = newlineIndex + 1;
      }

      controller.enqueue(chunk);
    },
  });

  return source.pipeThrough(limiter);
}
