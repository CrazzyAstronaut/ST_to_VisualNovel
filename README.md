# ST Breathing Idle

SillyTavern third-party extension that adds a subtle idle "breathing" animation to character expression sprites.

## Features

- Works in normal chat mode and Visual Novel mode.
- Coexists with Character Expressions (this mod does not control expression selection).
- Lightweight and mobile-friendly.
- No backend, no Live2D, no sprite editing.

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

## Defaults

- Enabled by default.
- Intensity: `medium`.
- Speed: `medium`.
- Lower intensity on mobile.
- Honors `prefers-reduced-motion`.
- Anti-clipping animation profile by default (designed for `overflow: hidden` sprite holders).

## Manual test checklist

- Normal mode + CE active + rapid expression changes.
- VN mode + CE active + node replacement.
- Character/chat switch and UI navigation.
- Mobile portrait/landscape.
- Sprites of different sizes.
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
