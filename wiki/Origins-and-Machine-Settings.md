# Origins and Machine Settings

## Origin Settings

Correct origin setup is critical for predictable machining.

### XY Origin

Choose where XY zero is placed relative to your geometry:

- Center
- Bottom-left
- Bottom-right
- Top-left
- Top-right

### Z Origin

Choose Z reference:

- **Stock top** (`Z0` at material top)
- **Stock bottom** (`Z0` at material bottom/bed)

### Z Offset (Advanced)

Optional extra Z offset for machine-specific workflows.

## Machine Settings Panel

Open **Settings** (gear icon) and choose **Machine settings**.

Available toggles:

- **Spindle control**
- **Mist coolant (M7)**
- **Flood coolant (M8)**
- **Mirror X-axis**
- **Mirror Y-axis**

These options influence generated G-code behavior and comments.

## Spindle Speed (Advanced)

When spindle control is enabled, spindle speed field `S` is used in output.

- Set RPM that matches your machine and tooling.
- Ensure your controller supports the emitted spindle commands.

## Import and Export Machine Settings

From **Settings > Import/Export**:

- **Export settings**: save machine configuration as JSON.
- **Import settings**: load a saved JSON profile.

Use this to keep multiple machine presets or share setup baselines.

## Best Practices

- Confirm machine coordinate system before every job.
- Dry-run after changing origin mode, mirroring, or coolant options.
- Keep one tested settings profile per machine/controller.
