# Cutting Parameters

This page covers tool and motion settings that affect machining quality and safety.

## Core Parameters

- **Tool diameter**: cutter diameter used for offsets and path calculation.
- **Total depth**: final target depth.
- **Feedrate (F)**: cutting speed in units/min.
- **Safe height Z**: retract height for safe travel.

## Multiple Depths (Stepdown)

Enable **Multiple depths** to cut in layers.

- **Stepdown per layer** must not exceed total depth.
- Smaller stepdowns reduce tool load but increase runtime.

## Stepover

Stepover controls distance between adjacent tool passes.

- Can be set in `%` (of tool diameter) or in `mm`.
- 100% equals one full tool diameter.
- Too large stepover can leave material or produce invalid toolpaths.

## Finishing Pass (Advanced)

Optional final clean-up pass for better wall finish.

Parameters:

- Enable/disable finishing pass
- Finishing pass distance
- Finishing speed override (percentage)
- Finishing overlap

Use this when dimensional finish and surface quality are more important than cycle time.

## Entry Method (Advanced)

Choose how the tool enters material:

- **Plunge**: direct vertical entry.
- **Ramp**: angled entry using max ramp angle.

For contour operations, you can also toggle **Plunge outside part** in supported combinations.

## Tabs and Entry Interaction

When using **Contour + Tabs + Ramp**, ramp segments may pass through tab zones.  
The app warns this combination is not fully validated, so always inspect the preview before exporting.

## Unit Handling

The app supports `mm` and `inch` display modes.

- Internally, path calculations are normalized consistently.
- Always verify your machine/controller expects the same units as your generated file.

## Recommended Starting Values

For first tests on unknown setups:

- Conservative feedrate
- Modest stepdown
- Medium stepover
- Higher safe Z for clamp clearance

Then optimize after validating motion in simulation and test cuts.
