export interface DownloadChunkSpeed {
  sizeBytes: number;
  startTimeMs: number;
  endTimeMs: number;
}

/**
 * Takes an array of downloaded chunks and calculates the overall download speed in
 * bytes per second.
 */
export function calculateSpeed(chunks: DownloadChunkSpeed[]): number {
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.sizeBytes, 0);
  const totalMs = chunks.reduce(
    (sum, chunk) => sum + (chunk.endTimeMs - chunk.startTimeMs),
    0,
  );

  if (totalMs === 0) {
    return 0;
  }

  return (totalBytes / totalMs) * 1000; // Convert ms to seconds
}

/**
 * Filters the downloaded chunks by a given timeframe in milliseconds.
 * The time frame extends from now into the past. This function will
 * filter all chunks before the calculated cutoff time.
 */
export function filterChunksByTimeframe(
  chunks: DownloadChunkSpeed[],
  timeframeMs: number,
): DownloadChunkSpeed[] {
  const now = Date.now();
  const cutoffTime = now - timeframeMs;

  return chunks.filter((chunk) => {
    const chunkEndTime = now - chunk.startTimeMs;
    return chunkEndTime >= cutoffTime;
  });
}
