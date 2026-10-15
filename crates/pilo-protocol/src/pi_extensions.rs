use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Pilo-owned extensions are selected separately from third-party inline sources.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "id", rename_all = "kebab-case")]
pub enum BuiltinExtension {
    NextPrompt,
    CacheKeepAlive,
    ModelCatalog,
    SshWorkspace { config: SshWorkspaceConfig },
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshWorkspaceConfig {
    pub label: String,
    pub remote_cwd: String,
    pub ssh_args: Vec<String>,
    pub ssh_environment: BTreeMap<String, String>,
}
