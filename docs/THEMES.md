# Theme customization

Create and manage themes in the desktop app under **Settings → Appearance**.
Custom themes are named CSS overrides, not Pi themes or JSON files. They change
Pilo's interface without changing Pi's terminal theme or agent behavior.

- [Quick start](#quick-start)
- [Save, switch and recover](#save-switch-and-recover)
- [Writing a custom theme](#writing-a-custom-theme)
- [Customization points](#customization-points)
- [Troubleshooting](#troubleshooting)
- [Startup and safety](#startup-and-safety)

## Quick start

1. Open **Settings → Appearance** in the desktop app. Choose **Light**, **Dark**
   or **Follow system** under **Color mode**; this is independent of **Theme style**.
2. Enter a new **Theme name** in **Custom CSS**, then paste the CSS below.
   Paste only CSS, without Markdown fences or an HTML `<style>` wrapper.
3. Choose **Save and apply**. The theme is applied immediately and added to
   **Theme style** next to **Lody** and **Claude**.
4. Switch between Light and Dark to check both palettes. Check a button's hover
   and keyboard focus, selected sidebar rows, menus and the chat composer too.

This starter keeps Lody's layout and changes its accent in both modes:

```css
:root {
	--primary: 14 61.7% 47%;
	--primary-foreground: 0 0% 100%;
	--button-hover: 14 61.7% 40%;
	--ring: 14 61.7% 55%;
	--sidebar-primary: var(--primary);
	--sidebar-ring: var(--ring);
	--pilo-composer-radius: 1rem;
}

:root.dark {
	--primary: 15.9 62.4% 59.6%;
	--primary-foreground: 0 0% 8.2%;
	--button-hover: 15.9 62.4% 65%;
	--ring: 15.9 62.4% 65%;
}
```

Omitted tokens retain Lody's light/dark defaults. Custom CSS does not inherit the
previously selected theme: selecting Claude before saving does not make Claude
the base. The editor's placeholder is commented guidance, not applied CSS.

## Save, switch and recover

- **Edit:** select a saved theme under **Theme style**, change its CSS, then
  choose **Update and apply**. Typing alone does not preview or save changes.
- **Create a variation:** change the name and save. Names are trimmed; an existing
  name updates that entry instead of creating a duplicate.
- **Cancel:** discards editor changes and restores the currently applied custom
  CSS and its saved name, if any. It does not undo an already saved update.
- **Switch back:** select **Lody** or **Claude** to stop applying custom CSS.
  Saved custom themes remain available for later selection.
- **Delete:** use the theme's trash button and confirm. This removes the saved
  entry, but its currently applied CSS stays active until you switch themes.
  To recover the default appearance, select **Lody** rather than just deleting.
- **Share or back up:** copy the editor's CSS into a `.css` file. Another user
  can paste it into their editor, name it and save. There is no file-import or
  export control, and updates do not retain earlier versions.

Themes are stored on the desktop Host in SQLite; browser storage is a startup
cache, not the source of truth. Desktop windows and connected WebUI clients
receive the Host's applied theme, including custom CSS. WebUI has no theme
editor or independent switching controls, regardless of whether its project
uses Local, WSL or SSH. In System mode, each client resolves light/dark from its
own device preference. Theme choices are not per-project or per-connection.

## One contract, built-in and saved themes

Pilo lists **Lody**, **Claude** and saved custom themes together under
Settings → Appearance → Theme style. Lody and Claude are built-in sets of CSS
token values, not separate component implementations. Custom CSS uses the same
tokens and renderer, with Lody as its initial defaults. It does not need a Claude
template, a special family flag or copies of component CSS to achieve either
built-in appearance.

Sources:

- [`src/styles/lody-theme.css`](../src/styles/lody-theme.css): complete defaults
  and dark-mode values.
- [`src/styles/claude-theme.css`](../src/styles/claude-theme.css): Claude's
  light/dark overrides of those tokens.
- [`src/styles/theme-components.css`](../src/styles/theme-components.css): shared
  component rules; no family selectors.
- [`src/index.css`](../src/index.css): shared Tailwind mappings, chat styles and
  responsive rules.

The only Claude-family selectors choose token values on the document root.
No component, interaction or boot-shell rule checks that family. New built-in
styling differences must be expressed through this contract, so custom themes
can express the same differences.

## Writing a custom theme

Use plain CSS with unlayered `:root` and `:root.dark` overrides. Do not wrap
it in `@layer`, `@theme` or Tailwind directives: the editor injects CSS directly,
without a compilation step. Unlayered declarations override the built-in preset
layers without needing `!important` or a theme-family selector.

`:root` applies in both modes; `:root.dark` overrides it in dark mode. If a
change should affect light mode only, use `:root:not(.dark)` instead. Define both
modes when replacing palette roles, rather than carrying a light palette into
dark mode accidentally.

| Value kind          | Examples                                                  | Syntax                                                             |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| Palette role        | `--background`, `--primary`, `--sidebar-background`       | HSL triplet: `14 61.7% 47%`, without `hsl()` or `#`                |
| Component color     | `--pilo-composer-background`, `--pilo-user-bubble-border` | Complete CSS color: `hsl(var(--card))`, `#f0f0ef` or `transparent` |
| Dimension or radius | `--pilo-composer-radius`, `--pilo-menu-padding`           | CSS length: `1rem`, `6px` or `0`                                   |
| Shadow              | `--pilo-shadow-floating`                                  | CSS shadow value; see the shadow guidance below                    |

The grouped names below, such as `--pilo-sidebar-margin/height/width` and
`--primary*`, are documentation shorthand, not literal token names. Set each
variable separately, for example `--pilo-sidebar-margin` and
`--primary-foreground`.

For example, an edge-attached sidebar is configured with values, just as in
the built-in Claude theme:

```css
:root {
	--primary: 14 61.7% 47%;
	--primary-foreground: 0 0% 100%;
	--pilo-sidebar-margin: 0;
	--pilo-sidebar-height: 100%;
	--pilo-sidebar-width: 100%;
	--pilo-sidebar-border-width: 0 1px 0 0;
	--pilo-sidebar-border-color: hsl(var(--sidebar-border) / 0.6);
	--pilo-sidebar-radius: 0;
	--pilo-sidebar-padding: 0.5rem;
	--pilo-sidebar-shadow: none;
	--pilo-mobile-sidebar-radius: 0;
	--pilo-composer-radius: 1rem;
	--pilo-composer-background: hsl(var(--card));
	--pilo-menu-item-height: 2.25rem;
	--pilo-menu-touch-height: 2.75rem;
}

:root.dark {
	--primary: 15.9 62.4% 59.6%;
	--primary-foreground: 0 0% 8.2%;
	--pilo-composer-border: hsl(var(--input-border) / 0.7);
}
```

This example configures part of the appearance; it is not the complete Claude
palette. The two built-in CSS files are the authoritative values for every
supported point. All values assigned in either file can also be assigned in
Custom. Existing saved CSS remains supported; arbitrary selector overrides
are still available when needed, but are not required for built-in effects.

## Customization points

### Palette, typography and motion

- Canvas/surfaces: `--background`, `--foreground`, `--card`, `--popover`,
  corresponding `*-foreground`, `--border`.
- Actions/state: `--primary*`, `--button-*`, `--secondary*`, `--muted*`,
  `--hover*`, `--destructive*`, `--ring`, `--status-*`.
- Sidebar: `--sidebar-background`, `--sidebar-foreground`,
  `--sidebar-foreground-muted`, `--sidebar-hover*`, `--sidebar-selection*`,
  `--sidebar-border`, `--sidebar-ring`, `--sidebar-primary`.
- Fields/tooltips: `--input*`, `--switch-track`, `--tooltip-background`,
  `--tooltip-foreground`.
- Code/loading: `--code-*`, `--syntax-*`, `--skeleton-*`, `--scrollbar-*`.
- Corners: `--pilo-radius-xs/sm/md/lg/xl`, `--pilo-bubble-radius`,
  `--pilo-composer-radius`.
- Display heading: `--pilo-display-font-family`. Interface/reading/code font
  preferences remain independent and continue to take precedence for their roles.
- Interaction timing: `--dur-1`, `--dur-2`, `--ease`; preserve reduced-motion rules.

### Layout and selected rows

| Tokens                                                           | Effect                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `--pilo-sidebar-margin/height/width`                             | Floating versus edge-attached sidebar geometry                         |
| `--pilo-sidebar-border-width/border-color/radius/padding/shadow` | Sidebar shape and elevation; border width accepts four sides           |
| `--pilo-mobile-sidebar-radius`                                   | Mobile drawer shape; accepts a full border-radius value                |
| `--pilo-sidebar-selected-border/background/foreground`           | Desktop selected session/project appearance                            |
| `--pilo-project-selected-foreground`                             | Project selection text, including its separate dark-mode dimming       |
| `--pilo-mobile-selected-background`                              | Mobile selected row fill                                               |
| `--pilo-mobile-confirm-selected-background`                      | Selected mobile row while confirming deletion                          |
| `--pilo-mobile-selected-ring-width`                              | Mobile selection outline: `1px` or `0px`, not a boolean switch         |
| `--pilo-conversation-max-width`                                  | Shared desktop/session/WebUI reading measure; omit for device defaults |
| `--pilo-user-bubble-bg/border`                                   | Complete CSS colors for user messages                                  |

Mobile WebUI remains full-width below 640px. Keep drawer dismissal space,
safe-area padding and existing mobile touch targets; these are interaction
constraints, not family styling.

### Composer, fields and buttons

| Tokens                                           | Effect                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `--pilo-composer-background/border/focus-border` | Enabled composer resting/focus colors; muted state remains separate |
| `--pilo-shadow-composer`                         | Resting composer shadow                                             |
| `--pilo-shadow-composer-hover/focus`             | Optional interaction shadows; fall back to the resting value        |
| `--pilo-field-hover-border/focus-border`         | Field border interaction colors                                     |
| `--pilo-field-shadow`                            | Input and Select elevation                                          |
| `--pilo-field-touch-height`                      | Field minimum height on coarse pointers                             |
| `--pilo-button-primary-shadow`                   | Filled primary button elevation                                     |
| `--pilo-button-secondary-shadow`                 | Secondary, outline and destructive button elevation                 |

For shadows used by Tailwind-backed controls, use `0 0 #0000` to remove
visible elevation, not `none`: the shadow participates in a combined stack
that also contains keyboard-focus rings. A plain sidebar shadow may use `none`.
Explicit component
utility overrides (for example the composer's borderless textarea and shadowless
send button) still take precedence over shared component defaults.

### Context usage indicator

`--pilo-context-usage-color` sets the occupied arc and details progress fill.
It takes a complete CSS color and defaults to `hsl(var(--primary))`, so both
built-in themes and custom palettes follow their primary color in light and
dark mode. Custom CSS can override this token independently. Percentage and
usage text, empty tracks and the unknown-usage icon remain neutral.

### Floating surfaces and menus

| Tokens                                                                | Effect                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `--pilo-floating-radius`, `--pilo-shadow-floating`                    | Default Popover, Select and HoverCard shape/elevation                    |
| `--pilo-context-details-radius`                                       | Context-usage details card; defaults to the `xl` radius                  |
| `--pilo-sheet-radius/padding/item-radius`                             | Run-config bottom sheet, model-list inset and shared inner-control curve |
| `--pilo-menu-radius`                                                  | Menu and searchable font-menu outer curve                                |
| `--pilo-segment-radius/padding/item-radius`                           | Mobile navigation switch, its inset and derived selected curve           |
| `--pilo-tooltip-border/shadow`                                        | Tooltip edge/elevation                                                   |
| `--pilo-menu-background/edge/shadow`                                  | Menu surface and its non-layout-affecting outline                        |
| `--pilo-menu-padding`, `--pilo-menu-item-height/radius`               | Menu density and item geometry                                           |
| `--pilo-menu-item-gap`                                                | Space between adjacent menu items                                        |
| `--pilo-menu-checked-background`                                      | Checked menu item fill                                                   |
| `--pilo-select-padding/gap`, `--pilo-select-item-height/radius`       | Select density and geometry                                              |
| `--pilo-select-checked-background/foreground`                         | Checked Select item colors                                               |
| `--pilo-menu-touch-height`, `--pilo-command-touch-height`             | Coarse-pointer item minimums                                             |
| `--pilo-shadow-2xs/xs/sm/md/lg/xl/2xl`, `--pilo-shadow-panel/popover` | Shared elevation scale                                                   |

Inset surfaces derive their radius from the enclosing radius minus the actual
padding and border, clamped at zero. Menu, sheet and segment item radii follow
this rule in both presets; their item-radius tokens remain independently
overridable. A menu's shadow outline does not consume layout space. Font menus
have a real 1px border, so their Command clipping curve and item curves subtract
that additional pixel. Model lists use menu padding on desktop and sheet padding
on touch, including scope-editing mode. Touch model search fields, scope tabs,
refresh, reasoning and scope-editing action buttons share
`--pilo-sheet-item-radius` with model rows; the scope-tab strip adds its 2px inset
to that inner radius. Theme-option delete buttons subtract their actual inset
from the control radius, including the coarse-pointer variant. Compact desktop
scope tabs subtract their 2px inset from the tab strip radius. Markdown code and
diagram surfaces use runtime radius tokens instead of fixed values.

For example, adjusting the outer shape and inset updates its inner curve without
requiring another selector override:

```css
:root {
	--pilo-menu-radius: 1rem;
	--pilo-menu-padding: 0.375rem;
	--pilo-context-details-radius: 1rem;
	--pilo-sheet-radius: 1.25rem;
	--pilo-sheet-padding: 0.5rem;
	--pilo-segment-radius: 0.75rem;
	--pilo-segment-padding: 0.25rem;
}
```

Here menu items default to 10px, sheet model items to 12px and segment items to
8px at a 16px root size. General floating-surface radius stays independent of
the larger details-card and bottom-sheet roles.

## Troubleshooting

| Symptom                            | What to check                                                                                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edits have no visible effect       | Choose **Save and apply** or **Update and apply**. The editor is not a live preview. A name is required.                                                                                 |
| Colors or controls look wrong      | Check the value kind: `--primary` needs an HSL triplet, while `--pilo-composer-background` needs a complete CSS color. Change foreground and hover roles alongside backgrounds.          |
| Only one mode looks correct        | Add `:root.dark` overrides and check Color mode. `:root` also applies in dark mode; System follows the current device preference.                                                        |
| A token does nothing               | Check its exact spelling in the linked preset files. CSS ignores unknown tokens and invalid values without an application error. Some components intentionally override shared defaults. |
| A copied Claude rule does nothing  | Copy token declarations into `:root` / `:root.dark`, not the original `[data-theme-family="claude"]` selector. Custom themes use a different family identifier.                          |
| Deleted theme still appears active | Deleting removes the saved entry, not the applied CSS. Select **Lody** or **Claude** to remove custom overrides.                                                                         |
| WebUI does not match the Host      | Check that it is connected to the intended Host and reconnect or reload. In System mode, devices may legitimately resolve different light/dark modes.                                    |

Before applying broad selector rules, keep a copy of the last working CSS. Custom
CSS can also affect the settings editor: avoid hiding navigation, disabling
pointer events or removing focus indicators. There is no separate safe-mode or
rollback control in the theme editor.

## Startup and safety

The startup shell loads the same native token presets before its boot script.
Its geometry, colors and composer read the same public tokens, including cached
custom overrides. There is no duplicated Claude boot palette or geometry branch.
The system-bar `theme-color` follows computed `--background` after theme changes.
The preset stylesheet is also included in WebUI offline precaching.

There is no separate theme preview. Save and apply custom CSS to inspect its
appearance in the application, including menus, focus states and mobile layouts.

Applied CSS is not sandboxed and can load external resources: only use CSS you
trust. Preserve focus indicators, disabled states and reduced-motion behavior.

## Claude reference

The Claude values reference the third-party `open-claude-ui` reconstruction,
not an official specification. The light palette follows the Claude Code desktop
reference: near-white canvas, a subtle neutral sidebar, `#f0f0ef` user messages
and neutral-gray selections, while retaining the terracotta accent. Pilo keeps
its compact composer, surface-role mapping and contrast adjustments. Its 8/12/16px
radius scale, 12px bubble and 16px composer remain adaptations rather than
pixel-identical copies. They are ordinary configurable token values, not
privileged built-in behavior. Copernicus is not bundled; display headings use
system serif fallbacks when it is unavailable.
