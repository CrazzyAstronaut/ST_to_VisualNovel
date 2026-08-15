# ST Breathing Idle

SillyTavern third-party extension that adds a subtle idle "breathing" animation to character expression sprites.

## Features

- Works in normal chat mode and Visual Novel mode.
- Coexists with Character Expressions (this mod does not control expression selection).
- Lightweight and mobile-friendly.
- Three animation modes: `stretch`, `move`, and `stretch + move`.
- No backend, no Live2D, no sprite editing.
- Built-in settings drawer in the Extensions menu (live updates, persisted settings).
- Adds a collapsible header to SillyTavern's floating group-member window.

## How it works

- Detects expression sprites rendered in known SillyTavern/Character Expressions DOM containers.
- Wraps eligible `<img>` sprites in a lightweight wrapper (`.stbreathe-wrap`).
- Animates wrapper transform only (`translateY + scale`) to keep it subtle.
- Reapplies safely when nodes are replaced by using `MutationObserver`.

## Installation

### Option A: Install from Git URL

1. Open SillyTavern.
2. Go to `Extensions > Install extension`.
3. Paste this repository URL.
4. Install and reload the UI.

### Option B: Manual install

1. Copy this folder into your SillyTavern third-party extensions directory.
2. Make sure `manifest.json`, `index.js`, and `style.css` are in the extension root.
3. Reload SillyTavern.

## Compatibility notes

- Designed to coexist with Character Expressions and animate only what is already rendered.
- Preferred selectors are based on current official CE DOM structure:
  - `#expression-wrapper #expression-holder img.expression`
  - `#visual-novel-wrapper .expression-holder img`
- If CE is not present, fallback selectors attempt to detect compatible expression sprites.
- If a node cannot be animated safely, the extension uses a conservative no-op.

### Multi-Character Expression From A Card

Fully compatible with
[ST_MultiCharacter_Expression_From_A_Card](https://github.com/CrazzyAstronaut/ST_MultiCharacter_Expression_From_A_Card)
(MCEFAC), which renders several character sprites at once on its own `#mcefac-stage`.

- Each MCEFAC sprite (`#mcefac-stage .mcefac-holder img.mcefac-img`) is detected as a
  first-class sprite root, so breathing works even if you disable the *Fallback Without
  Character Expressions* option.
- `#mcefac-stage` is observed directly, so newly toggled characters and sprite swaps start
  breathing immediately instead of waiting for the safety rescan.
- Breathing wraps the `<img>` and animates the wrapper only. MCEFAC keeps full control of its
  sprites: source, per-character scale (`height`), horizontal flip (`scaleX(-1)` on the img),
  drag-to-position, and its own fade-in/out animation (on the parent `.mcefac-sprite`) all keep
  working — the two transforms compose instead of fighting.
- Breathing animates from the bottom-center origin, matching MCEFAC's sprite anchoring.

### Group member popout

When SillyTavern opens its floating current-members window, the extension adds a compact
`Group · group name` header with a fold/unfold button. Folding hides the member controls and
list while keeping the window available as a small tab. The expanded dimensions remain owned by
SillyTavern, so dragging and resizing continue to use its native Moving UI behavior.

The last folded/unfolded state is remembered. The integration can be disabled from the
**Integraciones con chats grupales** section in extension settings without closing or replacing
the native popout.

## Defaults

- Enabled by default.
- Animation mode: `stretch`.
- Intensity: `1.00`.
- Speed: `4.20` seconds per cycle.
- Offset X / Offset Y: `0` px.
- Lower intensity on mobile.
- Honors `prefers-reduced-motion`.
- Anti-clipping animation profile by default (designed for `overflow: hidden` sprite holders).

## Settings (Extensions menu)

The drawer is grouped into **Animation**, **Behavior**, **Advanced**, and
**Integraciones con chats grupales** sections, and every option has a hoverable info icon (ⓘ)
explaining what it does. All changes apply live.

**Animation**

- **Animation mode** — `stretch` / `move` / `stretch + move`.
- **Intensity** — numeric slider + value (like SillyTavern's font-size control). `1.00` is the
  default amount; higher exaggerates the breathing.
- **Speed (s/cycle)** — numeric slider + value. Seconds per breath cycle; lower is faster.
- **Offset X / Offset Y** — numeric slider + value, **no limits**. Constant pixel shift of the
  sprite (negative moves left/up). Useful for nudging a sprite into place.

**Behavior**

- **Mobile intensity** — multiplier applied to intensity on phones/tablets.
- **Respect reduced motion** — auto-disable when the OS requests reduced motion.
- **Force motion (testing)** — override reduced motion for testing.
- **Fallback without Character Expressions** — animate compatible sprites even when official CE
  is not detected.

**Advanced**

- **Safety rescan (ms)** and **Min sprite size (px)**.
- **Debug logs**.

**Integraciones con chats grupales**

- **Ventana flotante de miembros plegable** — adds the compact foldable header to the native
  floating members window without replacing its controls or resize behavior.

**Reset to defaults** — a button at the bottom restores every setting at once.

> Older installs that saved `low`/`medium`/`high` and `slow`/`medium`/`fast` are migrated
> automatically to the new numeric values.

## Manual test checklist

- Normal mode + CE active + rapid expression changes.
- VN mode + CE active + node replacement.
- Character/chat switch and UI navigation.
- Mobile portrait/landscape.
- Sprites of different sizes.
- Group-member popout folded/unfolded after resizing, dragging, closing, and reopening.
- With and without reduced motion.

## Known assumptions

- `optional: ["expressions"]` in `manifest.json` is set tentatively and should be validated in your local SillyTavern installation.
- DOM selectors may need updates if SillyTavern or Character Expressions changes internals.

## Troubleshooting

- No breathing on desktop, but works on mobile:
  - Your desktop may have reduced motion enabled (`prefers-reduced-motion: reduce`).
  - Check in console:
    - `window.matchMedia('(prefers-reduced-motion: reduce)').matches`
  - For test only (without changing OS setting):
    - `localStorage.setItem('stbreathe_force_motion', '1')`
    - Reload UI
  - Restore normal accessibility behavior:
    - `localStorage.removeItem('stbreathe_force_motion')`
    - Reload UI

- Sprite gets cut by an invisible border at peak animation:
  - This usually comes from `overflow: hidden` in expression containers.
  - This extension now uses a safer anti-clipping default profile (reduced upward expansion).

## License

AGPL-3.0
