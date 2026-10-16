use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};

use crate::domain::{ThemeSettings, ThemeSettingsUpdate};

pub(crate) fn get_theme_settings(db: &Connection) -> Result<ThemeSettings, String> {
    let json: Option<String> = db
        .query_row(
            "SELECT settings_json FROM theme_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    json.map(|json| serde_json::from_str(&json).map_err(|error| error.to_string()))
        .transpose()
        .map(Option::unwrap_or_default)
}

pub(crate) fn initialize_theme_settings(
    db: &Connection,
    mut initial: ThemeSettings,
) -> Result<ThemeSettings, String> {
    initial.revision = 1;
    let json = serde_json::to_string(&initial).map_err(|error| error.to_string())?;
    db.execute(
        "INSERT INTO theme_settings(id, settings_json) VALUES(1, ?1) ON CONFLICT(id) DO NOTHING",
        [json],
    )
    .map_err(|error| error.to_string())?;
    get_theme_settings(db)
}

pub(crate) fn update_theme_settings(
    db: &mut Connection,
    update: ThemeSettingsUpdate,
) -> Result<ThemeSettings, String> {
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let mut settings = get_theme_settings(&tx)?;
    if let Some(theme) = update.theme {
        settings.theme = theme;
    }
    if let Some(family) = update.theme_family {
        settings.theme_family = family;
    }
    if let Some(css) = update.theme_custom_css {
        settings.theme_custom_css = css;
    }
    if let Some(name) = update.theme_custom_name {
        settings.theme_custom_name = name;
    }
    if let Some(mut theme) = update.save_custom_theme {
        theme.name = theme.name.trim().to_owned();
        if theme.name.is_empty() {
            return Err("theme name cannot be empty".to_owned());
        }
        settings.theme_custom_css = theme.css.clone();
        settings.theme_custom_name = theme.name.clone();
        settings
            .saved_custom_themes
            .retain(|item| item.name != theme.name);
        settings.saved_custom_themes.push(theme);
    }
    if let Some(name) = update.delete_custom_theme {
        settings
            .saved_custom_themes
            .retain(|item| item.name != name);
    }
    settings.revision += 1;
    let json = serde_json::to_string(&settings).map_err(|error| error.to_string())?;
    tx.execute(
        "INSERT INTO theme_settings(id, settings_json) VALUES(1, ?1) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json",
        params![json],
    ).map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(settings)
}
