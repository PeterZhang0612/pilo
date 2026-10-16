use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Light,
    Dark,
    #[default]
    System,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeFamily {
    #[default]
    Lody,
    Claude,
    Custom,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct SavedCustomTheme {
    pub name: String,
    pub css: String,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ThemeSettings {
    pub revision: u64,
    pub theme: ThemeMode,
    pub theme_family: ThemeFamily,
    pub theme_custom_css: String,
    pub theme_custom_name: String,
    pub saved_custom_themes: Vec<SavedCustomTheme>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemeSettingsUpdate {
    pub theme: Option<ThemeMode>,
    pub theme_family: Option<ThemeFamily>,
    pub theme_custom_css: Option<String>,
    pub theme_custom_name: Option<String>,
    pub save_custom_theme: Option<SavedCustomTheme>,
    pub delete_custom_theme: Option<String>,
}
