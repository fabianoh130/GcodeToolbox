# DXF and Text

## DXF Workflow

Use `DXF (contours)` when your geometry comes from CAD.

### Supported Flow

1. Select **DXF (contours)** in operation type.
2. Click **Choose file** and load a `.dxf`.
3. Select orientation (0, 90, -90, 180).
4. Set tool/cutting parameters.
5. Generate and inspect preview.

### DXF Expectations

Best results with:

- 2D geometry
- Closed contours
- Clean, non-self-intersecting shapes

The parser targets contour-based machining. Invalid or unsupported entities can fail processing.

### DXF Limitations to Keep in Mind

- Pocket for DXF is limited/not available in some contour scenarios.
- Multiple contour combinations can block inside/pocket behavior.
- If offsets fail, the tool may be too large for narrow sections.

## Text Engraving Workflow

Use `Letters (engraving)` to generate text toolpaths.

### Steps

1. Select **Letters (engraving)**.
2. Enter text.
3. Set letter size and orientation.
4. Choose suitable tool diameter.
5. Generate and validate.

### Font Loading Behavior

The tool attempts font loading in fallback order so text engraving can still work in different environments.

## Full Offline Text Engraving

For fully offline use:

1. Put `Roboto-Black.ttf` in `fonts/`.
2. Run:
   - `node scripts/fetch-font-base64.js`
3. Include generated file in `index.html` before `main.js`:
   - `<script src="font-base64.js"></script>`

This removes internet dependency for font retrieval.

## Quality Tips for DXF and Text

- Use smaller tools for narrow details.
- Keep geometry scale and units consistent.
- Check simulation before machining.
- For text, verify stroke/detail clearance versus tool diameter.
