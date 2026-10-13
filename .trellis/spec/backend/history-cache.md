# Session History Cache

## 1. Scope / Trigger

Apply to history reads, window serialization and lazy image lookup in
`runtime/session_history/`. Desktop and WebUI use the same Host cache for
Local/WSL/SSH; Pi JSONL in its original environment remains authoritative.

## 2. Signatures

- `read_history_json(..., expected_fingerprint) -> Result<Vec<u8>, String>`
- `read_history_window_json(..., expected_fingerprint, start_message,
  message_limit, include_message_index) -> Result<Vec<u8>, String>`
- `read_history_image_bytes(..., image_id, expected_fingerprint)` reads source
  ranges using the image-location index, not cached base64 payloads.
- Fingerprint: `{ fileSize, fileMtimeNs }`. History windows retain the existing
  `windowStartMessage`, `windowMessageCount`, `totalMessages`, optional
  `messageIndex`, and fingerprint fields. Limits clamp to 1–256 messages.

## 3. Contracts

- Cache keys include project ID and source path. Merge overlapping
  loads with a per-key lock, then recheck fingerprinted caches inside the lock.
  Release that lock before reading individual image payloads or history pages.
- Memory LRU: 16 entries, 192 MiB estimated using source size × 2. Histories
  exceeding this estimate use disposable projected-history files when eligible.
- Disk LRU: 16 entries, 2 GiB total projected bytes and 64 MiB estimated indexes.
  Indexes include message ranges, serialized directory and image locations.
  Eviction releases cache ownership; in-flight readers may retain handles.
- Disk files are caches, never source copies or SQLite conversation storage.
  Use random create-new names in the OS temporary directory. Unix uses mode 0600
  and immediate unlink; Windows uses delete-on-close. Closing the last handle
  releases the file. No cache paths or conversation payloads enter logs.
- A warm disk page reads only its contiguous message range and response metadata.
  Cold reads still scan/project the entire source to preserve branch resolution,
  stats and lazy-image indexes. Parsing and serialization run in blocking tasks.
- Oversized indexes/projections or a cache file creation/write failure fall back
  to returning the uncached projection. This preserves behavior, not cold-read
  peak-memory bounds. Cache accounting is not an exact process-RSS limit.

## 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Matching fingerprint | Reuse memory or disk projection |
| Different fingerprint | Read/project source again; replace cached entry |
| Over disk/index budget | Return uncached history |
| Temporary cache creation/write fails | Log warning without payload; return history |
| Cached range read fails | Return error; do not return partial JSON |
| Source changes during scan | Keep existing bounded retry/snapshot behavior |

## 5. Good / Base / Bad Cases

- Good: repeatedly page a large history without rescanning the remote JSONL.
- Base: small histories stay in memory with the existing window contract.
- Bad: treating the disposable projection as authoritative or claiming cold
  reads have bounded memory because warm pages do.

## 6. Tests Required

Pending explicit test authorization; these are assertion points, not checks run:

- Memory/disk pages produce identical events, directory, stats and fingerprints,
  including empty windows and start/limit clamping.
- Concurrent first loads share a cached projection; changed fingerprints rebuild.
- Byte/index/count eviction releases handles without breaking in-flight reads.
- Windows close/crash and Unix unlink remove disposable files; write failure
  preserves the uncached response. Check Local/WSL/SSH and lazy image lookup.

## 7. Wrong vs Correct

- Wrong: bypass the cache whenever a source exceeds the memory LRU budget, so
  every page rescans and replays the entire file.
- Correct: keep an eligible disposable projection plus message-range index,
  then read only the requested window; retain the source fingerprint contract.
