# Export and Validation

## Generate G-code

After filling required fields, click **Generate gcode**.

If generation succeeds:

- Preview updates with toolpath visualization.
- G-code appears in the output text area.
- **Download .nc** and **Copy to clipboard** become available.

## Export Options

### Download .nc

Use **Download .nc** to save a machine file directly.

Recommended:

- Use a clear filename including operation and date.
- Keep generated files in a per-job folder.

### Copy to Clipboard

Use **Copy to clipboard** when you want to paste code directly into another tool.

Note: clipboard behavior may depend on browser security context.

## Preview Validation Steps

Before exporting/running:

- Confirm operation type and geometry dimensions.
- Confirm origin settings (XY and Z).
- Confirm safe retract movement and entry behavior.
- Confirm tabs where required (contour jobs).
- Confirm no obvious collisions or missed areas.

## Controller and Shop-Floor Validation

Before real cutting:

- Verify units (`mm` or `inch`) match machine/controller.
- Run a simulator with the generated file.
- Perform an air cut or test in soft scrap material.
- Check spindle/coolant commands align with machine capabilities.

## Regenerate After Changes

If settings are changed after generation, regenerate before export to ensure preview and output are current.
