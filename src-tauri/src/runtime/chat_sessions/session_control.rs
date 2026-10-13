use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};

use serde_json::{Value, json};

use super::{
    super::{
        debug_trace::runtime_trace,
        events::{PiProcessState, RuntimeEvent, RuntimeEventEnvelope},
    },
    ChatProcess, ChatSessions,
};

static PROMPT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

impl ChatSessions {
    async fn close_process(&self, session_key: &str) -> Option<Arc<ChatProcess>> {
        let (process, events) = {
            let mut registry = self.registry.lock().await;
            let process = registry.processes.remove(session_key)?;
            registry.snapshots.remove(session_key);
            process.mark_closed();
            (process, registry.events.clone())
        };
        if let Some(events) = events {
            let process = Arc::clone(&process);
            let registry = Arc::clone(&self.registry);
            let session_key = session_key.to_owned();
            // Detach must not wait for a session lock held by startup or RPC work.
            tokio::spawn(async move {
                let snapshot = process.session.lock().await.snapshot();
                let registry = registry.lock().await;
                // Do not send an old stop event to a runtime already replacing this one.
                if !registry.processes.contains_key(&session_key) {
                    events.send(RuntimeEventEnvelope::session(
                        session_key,
                        process.project_id.clone(),
                        RuntimeEvent::ProcessState {
                            generation: snapshot.generation,
                            state: PiProcessState::Stopped,
                        },
                    ));
                }
            });
        }
        Some(process)
    }

    pub async fn send(&self, session_key: &str, mut command: Value) -> Result<(), String> {
        let command_type = command
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_owned();
        // Pi may resume autonomously before either UI observes its new turn.
        if command_type == "prompt"
            && let Some(command) = command.as_object_mut()
        {
            command
                .entry("streamingBehavior")
                .or_insert_with(|| Value::String("followUp".to_owned()));
        }
        // Generate an id for callers that send none, so Pi's prompt response can
        // release the preemptive active-turn flag after a preflight rejection.
        if command_type == "prompt"
            && command.is_object()
            && command.get("id").and_then(Value::as_str).is_none()
        {
            command["id"] = Value::String(format!(
                "pilo-prompt-{}",
                PROMPT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
        }
        let command_id = command.get("id").and_then(Value::as_str).map(str::to_owned);
        let process = {
            let mut registry = self.registry.lock().await;
            registry.usage_sequence = registry.usage_sequence.saturating_add(1);
            let process = registry
                .processes
                .get(session_key)
                .cloned()
                .ok_or_else(|| format!("session '{session_key}' is not running"))?;
            process
                .last_used
                .store(registry.usage_sequence, Ordering::Release);
            process
        };
        let session = process.session.lock().await;
        if process.closed.load(Ordering::Acquire) {
            return Err("project is closing".to_owned());
        }
        runtime_trace(
            "chat.send.begin",
            Some(session_key),
            session.stream_id(),
            json!({ "command": command_type, "id": command_id }),
        );
        // Protect the gap between accepting a prompt and its first Pi event.
        let work_flag = match command_type.as_str() {
            "prompt" => Some(&process.active_turn),
            "compact" => Some(&process.compacting),
            _ => None,
        };
        let was_active = work_flag.is_some_and(|flag| flag.swap(true, Ordering::AcqRel));
        // Only the prompt that flipped an idle flag owns it. A rejected prompt must
        // not clear a turn that was already running when it was sent.
        let mut owns_prompt_flag = false;
        if command_type == "prompt"
            && !was_active
            && let Some(id) = command_id.clone()
        {
            *process
                .pending_prompt_id
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = Some(id);
            owns_prompt_flag = true;
        }
        let result = session.send_rpc(command).await;
        if result.is_err()
            && !was_active
            && let Some(flag) = work_flag
        {
            flag.store(false, Ordering::Release);
            if owns_prompt_flag {
                *process
                    .pending_prompt_id
                    .lock()
                    .unwrap_or_else(|error| error.into_inner()) = None;
            }
        }
        runtime_trace(
            "chat.send.end",
            Some(session_key),
            session.stream_id(),
            json!({
                "command": command_type,
                "id": command_id,
                "ok": result.is_ok(),
                "error": result.as_ref().err(),
            }),
        );
        result
    }

    pub async fn stop(&self, session_key: &str, reason: Option<&str>) -> Result<(), String> {
        let process = self.close_process(session_key).await;
        let Some(process) = process else {
            runtime_trace(
                "chat.stop",
                Some(session_key),
                None,
                json!({ "found": false, "reason": reason }),
            );
            return Ok(());
        };
        let mut session = process.session.lock().await;
        runtime_trace(
            "chat.stop.begin",
            Some(session_key),
            session.stream_id(),
            json!({
                "found": true,
                "reason": reason,
                "prepared": process.prepared.load(Ordering::Acquire),
                "initialized": process.initialized.load(Ordering::Acquire),
                "activeTurn": process.active_turn.load(Ordering::Acquire),
                "hasSessionPath": process
                    .session_path
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .is_some(),
            }),
        );
        let result = session.stop().await;
        runtime_trace(
            "chat.stop.end",
            Some(session_key),
            session.stream_id(),
            json!({
                "ok": result.is_ok(),
                "reason": reason,
                "error": result.as_ref().err(),
            }),
        );
        result?;
        Ok(())
    }

    pub async fn detach(&self, session_key: &str, reason: Option<&str>) -> Result<(), String> {
        let process = self.close_process(session_key).await;
        let Some(process) = process else {
            runtime_trace(
                "chat.detach",
                Some(session_key),
                None,
                json!({ "found": false, "reason": reason }),
            );
            return Ok(());
        };

        let detached_session_key = session_key.to_owned();
        let detached_reason = reason.map(str::to_owned);
        runtime_trace(
            "chat.detach",
            Some(session_key),
            None,
            json!({ "found": true, "reason": reason }),
        );

        tokio::spawn(async move {
            let mut session = process.session.lock().await;
            runtime_trace(
                "chat.detach.stop.begin",
                Some(&detached_session_key),
                session.stream_id(),
                json!({ "reason": detached_reason }),
            );
            let result = session.stop().await;
            runtime_trace(
                "chat.detach.stop.end",
                Some(&detached_session_key),
                session.stream_id(),
                json!({
                    "ok": result.is_ok(),
                    "reason": detached_reason,
                    "error": result.as_ref().err(),
                }),
            );
        });

        Ok(())
    }
}
