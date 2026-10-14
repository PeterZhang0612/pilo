# Codebase Evidence

## Issue and approved direction

Issue https://github.com/hsingjui/pilo/issues/1 requests 全部/Scope view switching, model membership management and model search. The user explicitly rejected writing Pi configuration, then accepted project-owned overrides and a batch draft editor. The user subsequently confirmed that mobile narrow-screen layouts only consume Scope (search, view switching, selection and synchronization); editing, bulk operations and restoring inheritance are available in the desktop app and desktop-layout WebUI only.

The first configuration-writing attempt was removed before this task was created. No Pi configuration was modified and no tests/builds were run. The working tree was clean before task creation.

## Existing owners

- src/lib/pi-model-catalog-extension.ts: probe extension returns Pi-resolved scopeOrder and scopeThinkingLevel from ctx.scopedModels. This is read-only discovery, and must remain separate from Pilo project overrides.
- src/lib/pi-models.ts: host/frontend catalog cache, one-hour TTL, startup refresh, listener publication, persistence, transient noSession probe. Saving project settings must not fabricate refreshedAtMs or overwrite scope metadata.
- src/lib/pi-model-selection.ts: identity includes provider/id; getPiQuickCycleModels falls back to all available models when no scope exists. Reusing that fallback for an explicit custom [] would be incorrect.
- src/components/chat/use-chat-session-config.ts: historical sessions select/apply metadata lazily, whereas other sessions currently use native cyclePiModel. Project custom Scope requires the Pilo scoped shortcut to select from the effective project list.
- src/components/chat/use-chat-model-shortcuts.ts: separate shortcuts for all models and scoped models; preserve all-model behavior.
- src/components/chat/chat-composer-run-config.tsx: desktop nested dropdown and touch bottom sheet; both are reached from shared ChatComposer. Search inputs should not fight DropdownMenu typeahead/focus behavior.
- src/remote/use-remote-chat-agent-config.ts: draft uses Host-cached catalog; active get_available_models returns models without scope metadata and currently replaces the list. This needs catalog metadata reconciliation, not a new remote probe.
- src/remote/use-remote-keyboard-inset.ts: visualViewport updates --remote-viewport-height; a portalled bottom sheet must also account for the keyboard rather than relying only on dvh.

## Persistence / transport precedents

- src-tauri/src/domain/project.rs: ProjectModelCache is catalog snapshot only.
- src-tauri/src/runtime/storage/projects.rs: project upserts, cache persistence, project deletion. New app-owned preferences should not be fields overwritten by project discovery/upsert.
- src-tauri/src/runtime/storage/schema.rs: idempotent DDL; projects and project_model_cache have FK cascade. A separate project preference table avoids altering every Project constructor.
- src-tauri/src/runtime/storage/connections.rs: app-owned naming-model preferences already use SQLite separately from Pi sessions.
- src/lib/pilo-client.ts + tauri-pilo-client.ts + src/remote/web-pilo-client.ts: transport-neutral boundary with one desktop and one Web adapter.
- src-tauri/src/runtime/remote/api/mod.rs + handlers.rs: protected GET /api/v1/models returns the Host's cached catalog. New project preference read/write must stay behind existing auth and use the same Host store.
- src-tauri/src/runtime/events/model.rs and events/mod.rs: centrally owned RuntimeEvent contract and multi-subscriber bus with sequence/replay; suitable for project preference notifications.
- src/remote/use-remote-chat-transport.ts: session filtering occurs after generic RPC/activity handling. Project scope notifications must be handled before that filter.

## Pi API facts

Inspected installed @earendil-works/pi-coding-agent 1.1.0 and fetched official upstream RPC types:
https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/rpc/rpc-types.ts

- AgentSession.setScopedModels exists in SDK, but is not exposed by the standard RPC surface.
- Extension ctx.scopedModels is read-only; there is no public scope setter in the inspected extension API.
- set_model and set_thinking_level already provide runtime model/thinking changes; scope editing does not require using or changing native cycle_model.
- CLI --models overrides startup enabledModels without writing settings, but changing it requires restarting the process. This route is rejected for live editing and temporary-session safety.

No upstream change or server-side configuration-writing bridge is needed for the accepted app-owned project preference design.

## Applicable specs

Frontend: component-guidelines.md, hook-guidelines.md, state-management.md, type-safety.md, quality-guidelines.md.
Backend: directory-structure.md, database-guidelines.md, error-handling.md, quality-guidelines.md, remote-webui.md.
Shared: cross-layer-thinking-guide.md and code-reuse-thinking-guide.md.

Higher-priority developer restrictions prohibit adding/modifying tests or running tests/builds without explicit user authorization, even where existing project specs normally request them.

## Scope-loading follow-up evidence

Read-only inspection of the running Windows Host's SQLite cache found two WSL
projects, each with eight available models and four scoped members. Every cached
entry contained scopeOrder and scopeThinkingLevel; no project override rows were
present. Runtime trace inspection also showed successful model-catalog extension
responses and normal probe cleanup. SQLite was opened in readonly immutable mode;
no runtime files were changed. This does not establish that the UI consumed the
snapshot correctly, but provides no evidence that the current WSL server needs an
update to supply Scope metadata.

The frontend now retains the original catalog as a React snapshot alongside the
all-model list. A separate render-time global-cache lookup is no longer the Scope
source. Stable picker project identity also avoids a remount when the first
formal preference response arrives. Refresh focuses the search input before its
button becomes disabled. These changes still need GUI verification.

Installed Radix MenuSubContent supports align=start/end; the desktop submenu's
align=end and negative alignment offset are supported by its local types and
implementation. Their final placement remains subject to collision handling;
source inspection is not a screenshot or desktop interaction check.

## Repeated loading failure: missing landing-page controller

### Root cause

Change propagation failure: `NewChatLanding` is a separate desktop composer owner,
not a ChatPage using useChatSessionConfig. It was omitted from the first Scope
integration. Through the already-enabled Windows WebDriver interface, read-only
React-prop inspection found eight models in ComposerRunConfig but no modelScope;
its ChatComposer ancestor was under NewChatLanding.

### Why earlier fixes did not resolve it

Cache inspection established that the catalog had four Scope members, but did
not establish which controller the visible composer used. Snapshot/loading fixes
in useChatSessionConfig could not repair a caller that never passed Scope props.
The generic missing-Scope message also obscured this missing-controller case.
Rust stores models as serde_json::Value and preserves explicit null metadata;
there was no evidence for a serialization or WSL server data problem.

### Fix and prevention

NewChatLanding now loads project preferences, subscribes to project events,
retains the original catalog snapshot, passes the complete Scope controller and
uses effective Scope for its scoped shortcut. All-model cycling stays unchanged.
The lazy loading composer disables unsupported management. The Scope spec now
names both desktop owners and requires checking every enabled ChatComposer
caller, including the landing page before the first message.

### Observed result / limits

After source synchronization by the existing development setup, read-only
inspection of the same running window found all/available counts of eight,
Scope count of four, catalogReady=true, inherited preferences, loading=false and
error=null. No clicks, form submissions, Pi configuration writes, tests or builds
were performed. This confirms the runtime prop boundary, not the complete menu
or cross-transport editing workflow.

### Required future coverage

With authorization, cover new/temporary drafts as well as opened/history sessions;
verify inherited/custom/empty Scope, project switching, shared saved preferences
and matching scoped shortcuts. Do not substitute database cache assertions for
an assertion at the actual composer caller boundary.
