# Runtime Resource Lifecycle

## 1. Scope / Trigger

Apply when changing chat-turn ownership, process retention, runtime-event replay,
external session activity detection, or server shutdown.
Desktop and WebUI share `ChatSessions`; Local, WSL, and SSH use the same server lifecycle.
Frontend controller eviction alone is not backend process cleanup.

## 2. Signatures

- `ChatSessions::prepare(...)` / `ensure(...)` call `process(...)`, which invokes
  `prune_idle(retained_key)` before obtaining the requested process.
- `ChatSessions::send(session_key, command)` updates process recency and marks
  accepted work before waiting for Pi's first event.
- Frontend `sendPiPrompt(...)` / WebUI `rpcForSession<PiPromptResult>(...)` wait for
  the matching Pi `response`, not just successful command transport.
  `PiPromptResult` is `{ disposition: "started" | "queued" | "handled" }`;
  prompt preflight uses `PI_PROMPT_RPC_TIMEOUT_MS = 120_000`.
- `session_activity(...)` distinguishes process-confirmed `--session` paths from
  project-matched fallback candidates before reading their last JSONL message.
- `RuntimeEventBus::replay_after(sequence) -> Option<Vec<SequencedRuntimeEvent>>`:
  `None` means replay is incomplete and the WebUI must resync.
- `ServerClient::stop()` closes stdin, waits for server cleanup, then force-kills
  only if necessary. `serve_stdio()` handles EOF and framing errors through cleanup.

## 3. Contracts

- The idle cache reserves one slot for the requested chat and retains up to three
  other most recently used eligible processes. Pruning is admission-driven, not
  a timer: simultaneous live turns may exceed the budget until another prepare/ensure.
- Never evict an active turn, compaction, uninitialized process, `no_session`
  session, or a session without a resolved JSONL path. A cloned `ChatProcess` Arc
  or a locked session protects in-flight startup/RPC work from eviction.
- Remove an evicted process under the registry lock, mark it closed, and stop it
  asynchronously. Late events from the old process must not reach a replacement.
  Persisted sessions are resumed by the existing prepare/ensure path. Eviction
  emits no `ProcessState` event for the removed session; the frontend only sees it
  disappear from `states()` and re-syncs when the next `ensure` respawns it and
  resets the generation.
- `ChatSessions::send` defaults a missing `prompt.streamingBehavior` to `"followUp"`
  for both desktop and WebUI. Idle prompts still start normally; a prompt racing
  autonomous Pi continuation queues instead of failing with "Agent is already
  processing". Preserve explicitly supplied behavior, and leave `steer`/`follow_up`
  commands unchanged. This does not permit prompts during active compaction.
- Desktop `useChatRuntimeEvents` adopts an active turn when live
  `user_message_start`/`assistant_message_start` arrives without one, after its
  generation/discard checks. Merely projecting autonomous output into the
  conversation leaves the composer incorrectly idle and disables queue/stop.
  Compaction/completion events alone must not create a turn. WebUI already derives
  composer activity from the shared conversation reducer.
- `prompt` and `compact` mark their respective busy flags before `send_rpc`;
  transport failure rolls back only flags that were previously idle. Compaction
  is tracked separately so `CompactionEnd` cannot clear an ongoing agent turn.
- A `prompt` that flips an idle active-turn flag records its command id as the
  flag owner; `send` injects `pilo-prompt-<n>` when the caller sends none. Pi
  echoes the id in its prompt response. The owned flag rolls back when that
  response is `success:false` (preflight rejection) or carries
  `data.disposition == "handled"` (extension command or input handler consumed it
  without a turn). `started`/`queued` keep the flag, and a response for a prompt
  that did not own the flag never clears a running turn. Live user/assistant/retry
  starts release pending prompt ownership; a later `handled` response must not
  clear an extension-started turn.
- Both frontends end optimistic activity on rejected prompt responses. For
  `handled`, query Host state: clear the local pending prompt only if no real
  turn is active; do not auto-title a consumed prompt. Older Pi responses without
  `data.disposition` keep the existing accepted-prompt behavior.
- Responses with `pilo-` or `remote-` ids are caller-correlated: command rejection
  rejects that RPC, not the whole session. Runtime errors and terminal process
  events reject all pending RPCs for that session and clear activity, compaction,
  and retry UI. MCP approval intentionally interrupts initialization; preserve
  its session-keyed prompt for approval/resume instead of displaying a fatal turn.
- Explicit `stop`/`detach` remove and close the process, then asynchronously emit
  `ProcessState::Stopped` with its generation. Notification must not block detach
  on a session lock. Under the registry lock, skip the old notification when a
  replacement occupies the key. This differs from silent idle-cache eviction.
- A graceful `Stopped` is expected teardown, not a crash: the Desktop ends the
  active turn without an error and without restarting Pi, and only an unexpected
  `Failed` runs runtime recovery. `Stopped` still rejects that session's pending
  RPCs and refreshes activity on both frontends.
- A disappeared/stopped/failed Host runtime is not successful turn completion for
  unread markers. WebUI rechecks Host state before sending after failure, resumes
  the original persisted path, and keeps asynchronous sends/recovery session-scoped.
- Pi JSONL persists completed messages, not streaming deltas. A live process with
  an explicit `--session` path is not subject to the 60-second stale-tail cutoff.
  Project-only inferred paths still use that heuristic; their ownership is not
  certain. Parse complete final message lines backwards with bounded buffers,
  including messages larger than 128 KiB, without retaining their text/images.
  When no `message` entry exists yet (header-only file), a named live process still
  counts as active instead of releasing the session as idle. Native Windows
  external-process discovery is still unsupported; only running or starting Host
  paths are excluded from external detection.
- Replay retains at most 2048 events and 16 MiB of **serialized payload bytes**.
  This is not an exact RSS budget for Rust `Value` objects or live transport queues.
  Count bytes without allocating a second JSON buffer.
- An event exceeding the byte budget is delivered live but clears replay. A client
  behind that event receives a gap even when the replay deque is empty; a client
  already at the latest sequence receives an empty replay. Sequence zero retains
  the existing whole-buffer bootstrap behavior.
- Sequence allocation, replay insertion, and Web broadcast publication share a
  lock to preserve ordering across concurrent sessions.
- Abort and join pending server requests before draining Pi processes: an in-flight
  `pi.start` must not create a process after cleanup passes the registry.
- Abort and join the client writer to drop server stdin. Keep the reader alive while
  waiting for EOF cleanup (2 seconds); fallback kill/wait has another 1-second bound.
  Stop connection servers concurrently and do this even if earlier app teardown
  exceeds its 5-second grace period.

## 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Eligible idle cache exceeds budget | Stop oldest eligible processes; keep requested chat |
| Idle session evicted | No stop event; `states()` drops it; next `ensure` respawns and resets the generation |
| Live/temporary/unsaved/in-flight session | Keep it, even above budget |
| Extension resumes after compaction | Desktop adopts the live turn; queue and stop remain available |
| Prompt races autonomous continuation | Missing `streamingBehavior` defaults to `followUp`; explicit behavior is preserved |
| Prompt response rejects | Reject the matching caller; release its optimistic activity |
| Prompt response is `handled` | Query Host activity; clear pending UI only without a real turn; skip auto-title |
| Correlated `remote-` command fails during a turn | Fail that RPC only; do not clear the running turn |
| Explicit stop/detach | Remove immediately; notify asynchronously unless replaced; no completion unread dot |
| Graceful `stopped` during a turn | Desktop ends the turn silently; no error, no runtime restart |
| Unexpected `failed` during a turn | Desktop surfaces the error and attempts runtime recovery |
| WebUI runtime fails | Clear turn/compaction/retry; next send checks Host and resumes original path |
| Confirmed external `--session` tail is older than 60 seconds | Infer activity from the final message, not age |
| External probe fails | Keep last activity; unknown is not completion |
| Background idle stop fails | Log warning; do not block another chat launch |
| Replay byte/count eviction | Older sequence returns `None`; WebUI resyncs |
| Single oversized event | Deliver live; clear replay and expose the gap |
| Server stdin EOF or invalid frame | Cancel requests, clean up children, finish writer |
| Server ignores EOF | Bounded force-kill fallback |

## 5. Good / Base / Bad Cases

- Good: use many persisted sessions; idle processes are reclaimed on subsequent
  admission and resuming an evicted session loads its Pi JSONL.
- Base: a few idle sessions remain warm; running turns and temporary sessions survive.
- Bad: killing the server before closing stdin skips its child cleanup and can orphan Pi.

## 6. Tests Required

- `chat_sessions/idle_cache.rs`: LRU order, retained key, busy/compacting/initializing/
  temporary/unsaved/in-flight exclusions, busy-flag rollback on failed send.
- `chat_sessions/event_sink.rs`: prompt rejection rolls back only the owning
  prompt's active-turn flag; a success response releases ownership without
  clearing the turn; live start transfers ownership before a `handled` response;
  compaction completion does not clear an active turn.
- Prompt/UI regressions: rejected preflight releases optimistic activity; `handled`
  removes its pending user and permits the next send; extension-started activity
  survives `handled`; responses without disposition remain compatible. Verify
  desktop and WebUI, including mobile WebUI session switching while awaiting ACK.
- Explicit detach returns without waiting for startup/RPC locks, eventually emits
  stopped for the removed generation, and never notifies an existing replacement.
  Stopped/failed/disappeared Host runtimes do not create completion unread dots.
  Desktop must not show a runtime error or restart Pi for a graceful `stopped`,
  while `failed` still recovers.
- WebUI command rejection with a `remote-` id does not end an unrelated active turn;
  terminal process events reject only that session's RPCs. MCP approval resumes
  the original session after switching away. Runtime recovery preserves its path.
- External activity: a confirmed owner with an old open tail remains active;
  fallback candidates retain stale-tail filtering; a terminal message larger than
  128 KiB remains idle; trailing metadata/partial lines do not hide the last message;
  a named live process whose file has no `message` entry yet stays active.
  These assertion points are requirements, not a claim of checks already run.
- Prompt forwarding: absent `streamingBehavior` becomes `followUp`, explicit
  `steer`/`followUp` survives, and non-prompt commands are unchanged.
- Desktop manual regression: compact with extension-driven `continue`, then send
  steering/follow-up messages and stop; verify running state until agent settles.
  Late compaction/completion or stale/discarded generation events must not adopt
  a running turn. Repeat prompt-race behavior through WebUI.
- `events/mod.rs`: byte eviction before count limit, oversized live delivery, empty
  replay gap, latest-sequence empty replay, concurrent replay/broadcast ordering,
  existing sequence/count contracts.
- `server_client/tests.rs`: a fake server completes its EOF cleanup before stop returns.
- `pilo-server/tests/stdio_protocol.rs`: a real fake-Pi child is reaped after server EOF.
- Windows desktop shutdown and Local/WSL/SSH resumption still require platform testing;
  Unix process tests do not establish Windows descendant-process behavior.

## 7. Wrong vs Correct

```rust
// Wrong: abruptly kill the server, bypassing its Pi/PTY cleanup.
process.reader_task.abort();
process.child.kill().await;

// Correct: drop the stdin owner and let EOF run server cleanup first.
process.writer_task.abort();
let _ = process.writer_task.await;
// Bounded wait, then kill only if the server does not exit.
```

```typescript
// Wrong: successful transport does not mean Pi accepted the prompt.
await client.sendChatCommand(key, { type: "prompt", message });
// Correct: correlate Pi's response and handle rejection/consumption.
const result = await rpcForSession<PiPromptResult>(
  key, { type: "prompt", message }, PI_PROMPT_RPC_TIMEOUT_MS,
);
// If handled, consult Host activity before ending optimistic UI.
```

Do not use event count alone as a memory budget: one RPC result can contain an
entire transcript or large tool output. Combine count and payload-byte limits.
