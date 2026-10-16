use tauri::{
    App, LogicalSize, Monitor, PhysicalPosition, PhysicalRect, PhysicalSize, WebviewWindow,
};
use tauri_plugin_window_state::{StateFlags, WindowExt};

#[tauri::command]
pub(crate) fn desktop_open_devtools(window: WebviewWindow) -> Result<(), String> {
    window.open_devtools();
    Ok(())
}

pub(crate) fn persisted_state_flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

fn work_area(monitor: &Monitor) -> PhysicalRect<i32, u32> {
    let area = *monitor.work_area();
    if area.size.width > 0 && area.size.height > 0 {
        area
    } else {
        PhysicalRect {
            position: *monitor.position(),
            size: *monitor.size(),
        }
    }
}

pub(crate) fn create_main_window(app: &App) -> tauri::Result<()> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == "main")
        .ok_or(tauri::Error::WindowNotFound)?
        .clone();
    let minimum = LogicalSize::new(
        config.min_width.unwrap_or(0.0),
        config.min_height.unwrap_or(0.0),
    );
    let monitor = app.primary_monitor()?;
    if let Some(monitor) = &monitor {
        let area = work_area(monitor);
        let available = area.size.to_logical::<f64>(monitor.scale_factor());
        let position = area.position.to_logical::<f64>(monitor.scale_factor());
        config.width = config.width.min((available.width * 0.9).floor());
        config.height = config.height.min((available.height * 0.9).floor());
        config.min_width = Some(minimum.width.min(config.width));
        config.min_height = Some(minimum.height.min(config.height));
        config.center = false;
        config.x = Some(position.x + (available.width - config.width) / 2.0);
        config.y = Some(position.y + (available.height - config.height) / 2.0);
    }

    // Compute defaults before creation: resizing a tracked window first could
    // overwrite the window-state plugin's cached size before it is restored.
    let builder = tauri::WebviewWindowBuilder::from_config(app, &config)?;
    #[cfg(target_os = "windows")]
    // Disable WebView2's native inspector shortcuts; the frontend gates opening it.
    let builder = builder.decorations(false).shadow(true).devtools(false);
    let window = builder.build()?;

    // Validate normal bounds before restoring maximization, so restoring the
    // window later also returns to a reachable size on the current display.
    if let Err(error) = window.restore_state(StateFlags::SIZE | StateFlags::POSITION) {
        log::error!(target: "window-state", "failed to restore main window bounds: {error}");
    }
    if let Err(error) = fit_main_window(&window, minimum) {
        log::error!(target: "window-state", "failed to fit main window to work area: {error}");
    }
    if let Err(error) = window.restore_state(StateFlags::MAXIMIZED) {
        log::error!(target: "window-state", "failed to restore main window maximization: {error}");
    }
    window.show()?;
    window.set_focus()?;
    Ok(())
}

fn fit_main_window(window: &WebviewWindow, minimum: LogicalSize<f64>) -> tauri::Result<()> {
    let monitor = window.current_monitor()?.or(window.primary_monitor()?);
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let area = work_area(&monitor);
    let inner = window.inner_size()?;
    let outer = window.outer_size()?;
    let available = PhysicalSize::new(
        area.size
            .width
            .saturating_sub(outer.width.saturating_sub(inner.width)),
        area.size
            .height
            .saturating_sub(outer.height.saturating_sub(inner.height)),
    );
    let logical = available.to_logical::<f64>(monitor.scale_factor());
    window.set_min_size(Some(LogicalSize::new(
        minimum.width.min((logical.width * 0.9).floor()),
        minimum.height.min((logical.height * 0.9).floor()),
    )))?;
    let bounds = PhysicalRect {
        position: window.outer_position()?,
        size: window.outer_size()?,
    };
    let areas: Vec<_> = window.available_monitors()?.iter().map(work_area).collect();
    // A window spanning connected displays is valid; only repair bounds that
    // extend outside their combined work areas (including gaps between them).
    if is_within_work_areas(bounds, &areas) {
        return Ok(());
    }
    let size = PhysicalSize::new(
        inner.width.min(available.width),
        inner.height.min(available.height),
    );
    if size != inner {
        window.set_size(size)?;
    }
    let outer = window.outer_size()?;
    let position = window.outer_position()?;
    let right = area.position.x + area.size.width.saturating_sub(outer.width) as i32;
    let bottom = area.position.y + area.size.height.saturating_sub(outer.height) as i32;
    let corrected = PhysicalPosition::new(
        position.x.clamp(area.position.x, right),
        position.y.clamp(area.position.y, bottom),
    );
    if corrected != position {
        window.set_position(corrected)?;
    }
    Ok(())
}

fn is_within_work_areas(bounds: PhysicalRect<i32, u32>, areas: &[PhysicalRect<i32, u32>]) -> bool {
    let edges = |rect: PhysicalRect<i32, u32>| {
        let left = i64::from(rect.position.x);
        let top = i64::from(rect.position.y);
        (
            left,
            top,
            left + i64::from(rect.size.width),
            top + i64::from(rect.size.height),
        )
    };
    let mut uncovered = vec![edges(bounds)];
    for &area in areas {
        let (area_left, area_top, area_right, area_bottom) = edges(area);
        let mut remaining = Vec::new();
        for (left, top, right, bottom) in uncovered {
            let clipped_left = left.max(area_left);
            let clipped_top = top.max(area_top);
            let clipped_right = right.min(area_right);
            let clipped_bottom = bottom.min(area_bottom);
            if clipped_left >= clipped_right || clipped_top >= clipped_bottom {
                remaining.push((left, top, right, bottom));
                continue;
            }
            // Subtract the covered intersection, leaving up to four rectangles.
            for (left, top, right, bottom) in [
                (left, top, right, clipped_top),
                (left, clipped_bottom, right, bottom),
                (left, clipped_top, clipped_left, clipped_bottom),
                (clipped_right, clipped_top, right, clipped_bottom),
            ] {
                if left < right && top < bottom {
                    remaining.push((left, top, right, bottom));
                }
            }
        }
        if remaining.is_empty() {
            return true;
        }
        uncovered = remaining;
    }
    false
}
