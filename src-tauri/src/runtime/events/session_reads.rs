use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, Mutex as StdMutex},
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::{
    domain::{Project, SessionReadState},
    runtime::{
        PiloRuntime,
        host_paths::HostPaths,
        session_activity::{self, SessionExternalActivity},
        storage,
    },
};

use super::{RuntimeEvent, RuntimeEventBus, RuntimeEventEnvelope};

pub(super) type ExternalReadActivity = Arc<StdMutex<HashMap<String, Arc<Mutex<HashSet<String>>>>>>;

struct SessionCompletion {
    project_id: String,
    session_path: String,
    completion_id: String,
}

#[derive(Default)]
pub(super) struct SessionCompletionQueue {
    worker_running: bool,
    pending: VecDeque<SessionCompletion>,
}

impl RuntimeEventBus {
    pub(crate) fn initialize_session_reads(&self, app: &AppHandle) -> Result<(), String> {
        *self
            .session_read_paths
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(HostPaths::from_app(app)?);
        Ok(())
    }

    fn session_read_paths(&self) -> Result<HostPaths, String> {
        self.session_read_paths
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
            .ok_or_else(|| "session read storage is not initialized".to_owned())
    }

    pub(crate) fn session_read_states(&self) -> Result<Vec<SessionReadState>, String> {
        storage::list_session_read_states(&storage::open_with_paths(&self.session_read_paths()?)?)
    }

    pub(crate) fn mark_session_read(
        &self,
        project_id: &str,
        session_path: &str,
        revision: u64,
    ) -> Result<SessionReadState, String> {
        if revision == 0 || revision > 9_007_199_254_740_991 {
            return Err("session read revision must be a positive safe integer".to_owned());
        }
        let state = storage::mark_session_read(
            &storage::open_with_paths(&self.session_read_paths()?)?,
            project_id,
            session_path,
            revision,
        )?;
        self.send(RuntimeEventEnvelope::global(
            RuntimeEvent::SessionReadStateChanged {
                state: state.clone(),
                completion_id: None,
            },
        ));
        Ok(state)
    }

    pub(crate) async fn external_session_activity(
        &self,
        runtime: &PiloRuntime,
        project: &Project,
    ) -> Result<Vec<SessionExternalActivity>, String> {
        let activity = self
            .external_read_activity
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .entry(project.id.clone())
            .or_default()
            .clone();
        // Serialize Desktop/WebUI polls per project so stale replies cannot
        // turn one external completion into multiple unread revisions.
        let mut previous = activity.lock().await;
        let activities =
            session_activity::external_session_activities_for_project(runtime, project).await?;
        for entry in &activities {
            if !entry.turn_open && previous.contains(&entry.path) {
                self.record_session_completion(project.id.clone(), entry.path.clone());
            }
        }
        // A disappeared process is not proof of a completed turn.
        *previous = activities
            .iter()
            .filter(|entry| entry.turn_open)
            .map(|entry| entry.path.clone())
            .collect();
        if previous.is_empty() {
            let mut registry = self
                .external_read_activity
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            // Drop idle tracking once no overlapping poll holds this entry.
            if Arc::strong_count(&activity) == 2 {
                registry.remove(&project.id);
            }
        }
        Ok(activities)
    }

    pub(crate) fn record_session_completion(&self, project_id: String, session_path: String) {
        let Ok(paths) = self.session_read_paths() else {
            return;
        };
        let mut id = [0_u8; 16];
        if let Err(error) = getrandom::fill(&mut id) {
            log::error!(target: "session-reads", "failed to identify session completion: {error}");
            return;
        }
        let completion_id = URL_SAFE_NO_PAD.encode(id);
        {
            let mut queue = self
                .session_completions
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            // Publish the turn identity before SQLite work so clients can retain
            // that it was seen, even if they navigate away before commit.
            self.send(RuntimeEventEnvelope::global(
                RuntimeEvent::SessionTurnCompleted {
                    project_id: project_id.clone(),
                    session_path: session_path.clone(),
                    completion_id: completion_id.clone(),
                },
            ));
            let completion = SessionCompletion {
                project_id,
                session_path,
                completion_id,
            };
            // Read progress only needs the latest queued turn per session.
            if let Some(pending) = queue.pending.iter_mut().find(|pending| {
                pending.project_id == completion.project_id
                    && pending.session_path == completion.session_path
            }) {
                *pending = completion;
            } else {
                queue.pending.push_back(completion);
            }
            if queue.worker_running {
                return;
            }
            queue.worker_running = true;
        }
        let events = self.clone();
        // One worker preserves each session's turn order without blocking Pi.
        tauri::async_runtime::spawn_blocking(move || {
            loop {
                let completion = {
                    let mut queue = events
                        .session_completions
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    match queue.pending.pop_front() {
                        Some(completion) => completion,
                        None => {
                            queue.worker_running = false;
                            return;
                        }
                    }
                };
                match storage::open_with_paths(&paths).and_then(|db| {
                    storage::complete_session_turn(
                        &db,
                        &completion.project_id,
                        &completion.session_path,
                    )
                }) {
                    Ok(state) => events.send(RuntimeEventEnvelope::global(
                        RuntimeEvent::SessionReadStateChanged {
                            state,
                            completion_id: Some(completion.completion_id),
                        },
                    )),
                    Err(error) => {
                        log::error!(target: "session-reads", "failed to record session completion: {error}");
                    }
                }
            }
        });
    }
}
