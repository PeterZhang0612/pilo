mod connection;
mod next_prompt;
mod project;
pub use next_prompt::{NextPromptModel, NextPromptRequest, NextPromptSettings};
mod remote;
mod session;

pub use connection::{
    Connection, ConnectionKind, ConnectionNamingModel, PiRuntime, SshAuthMethod, SshTarget,
    WslDistribution,
};
pub use project::{
    DiscoveredProject, Project, ProjectMetadata, ProjectModelCache, ProjectModelScope,
    ProjectScopedModel,
};
pub use remote::{
    RemoteAccessAddress, RemoteAccessConfig, RemoteDevice, RemoteHostConfig, random_remote_port,
};
pub use session::{
    SessionIndexEntry, SessionReadState, SessionReconcileResult, SessionUiStateUpdate,
};
