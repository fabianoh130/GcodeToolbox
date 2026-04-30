# Getting Started

## Requirements

- A modern browser (Chrome, Edge, Firefox, or similar)
- Local project files (at least `index.html`, `main.js`, `styles.css`, `translations.js`)
- Optional internet connection (for external script CDNs and online font fallback)

## Open the Tool

1. Open `index.html` in your browser.
2. Wait for the interface to load.
3. On first visit, read the short onboarding message and close it with **Got it**.

## First Settings to Check

Use the gear icon (**Settings**) in the top-right:

- **Mode**: `Simple` or `Advanced`
- **Unit**: `mm` or `in`
- **Language**: EN/NL/DE/FR/ES
- **Theme**: Light or Dark

These preferences are stored in your browser and restored automatically next time.

## Basic Workflow

1. Choose **Type operation** (for example: Shapes, Facing, Letters, DXF).
2. Fill in geometry fields (dimensions, pattern values, or import DXF).
3. Choose **Operation** (`Pocket` or `Contour`) where relevant.
4. Fill in cutting parameters:
   - Tool diameter
   - Total depth
   - Feedrate
   - Safe Z height
   - Optional advanced parameters (stepover, entry method, finishing pass)
5. Set origin settings (XY and Z origin).
6. Click **Generate gcode**.
7. Inspect preview and output text.
8. Export with **Download .nc** or **Copy to clipboard**.

## Recommended Defaults for New Users

- Start in **Simple** mode.
- Use **mm** units unless your machine workflow is inch-based.
- Use conservative feeds and shallow total depth for first tests.
- Keep **Safe height Z** high enough to clear clamps and stock.

## Optional Offline Text Engraving Setup

If you need text engraving without internet:

1. Place `Roboto-Black.ttf` in `fonts/`.
2. Optional: run `node scripts/fetch-font-base64.js`.
3. Add `<script src="font-base64.js"></script>` in `index.html` before `main.js`.

This allows letter engraving to work fully offline, including `file://` usage.
