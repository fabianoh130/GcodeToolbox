# Troubleshooting

This page lists common errors and practical fixes.

## Input Validation Errors

### "`<field>` must be a positive number."

Cause:
- One or more numeric fields are zero/negative where a positive value is required.

Fix:
- Check all visible numeric inputs in the active operation section.

### "Stepdown cannot be greater than total depth."

Cause:
- Stepdown value exceeds total depth.

Fix:
- Reduce stepdown or increase total depth.

### "Stepover (in mm) cannot be greater than tool diameter."

Cause:
- Effective stepover is too large for the selected tool.

Fix:
- Reduce stepover or use a larger tool.

### "Lead-in above material cannot be negative."

Cause:
- Lead-in above value is below zero.

Fix:
- Set lead-in to `0` or a positive value.

## Geometry and Tool Size Errors

### "The pocket/contour is smaller than the tool diameter."

Cause:
- Tool cannot physically fit in target geometry.

Fix:
- Use a smaller cutter or increase shape size.

### "The tool does not fit inside the letters..."

Cause:
- Letter details are narrower than tool diameter.

Fix:
- Increase letter size and/or reduce tool diameter.

### "Corner radius must be less than half the smallest dimension."

Cause:
- Rounded corner radius is too large for the selected rectangle/square size.

Fix:
- Lower radius or switch to circle if fully rounded shape is desired.

## DXF-Specific Issues

### "No DXF file selected."

Fix:
- Select a `.dxf` file and regenerate.

### "No closed contours found in the DXF file."

Cause:
- Open or invalid geometry.

Fix:
- Repair contours in CAD and export a clean 2D DXF.

### "DXF parser not loaded."

Cause:
- External DXF parser script did not load.

Fix:
- Reload page and verify internet access/script loading.

### "Failed to parse DXF..." / "Error processing DXF..."

Cause:
- Corrupt/unsupported DXF, non-2D content, or geometry issues.

Fix:
- Re-export DXF from CAD as simple 2D geometry and retry.

### "Pocket is not supported for DXF. Use Contour only."

Fix:
- Switch operation to `Contour` for DXF.

### Offset or contour-size errors for DXF

Cause:
- Tool too large for narrow areas or invalid contour topology.

Fix:
- Use a smaller tool or simplify/clean geometry.

## Operation Combination Warnings

### Contour + Tabs + Ramp

Behavior:
- Ramp can pass through tab zones in some cases.

Action:
- Carefully inspect preview and generated G-code.

## Copy/Download Issues

### "Copy to clipboard failed."

Cause:
- Browser security restrictions or unsupported context.

Fix:
- Use **Download .nc** as fallback.
- If possible, use a secure browser context.

### Download button is disabled

Cause:
- G-code is not generated yet or generation failed.

Fix:
- Resolve errors and click **Generate gcode** first.

## Settings Import/Export Problems

### Import error after loading settings JSON

Cause:
- Invalid/malformed file or unsupported values.

Fix:
- Re-export a known-good config and compare format.
- Re-import only valid JSON exported by the app.
