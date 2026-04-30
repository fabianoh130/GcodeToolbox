# Operations and Shapes

This page explains what each operation type does and which inputs are required.

## Operation Type (first dropdown)

You can choose:

- **Shapes**
- **Facing**
- **Letters (engraving)**
- **Counterbore bolt**
- **Patterned holes**
- **Circular pattern holes**
- **DXF (contours)**

Depending on your selection, the form shows only the relevant fields.

## Shapes

Available shapes:

- Circle
- Square
- Rectangle
- Ellipse
- Hexagon

For square and rectangle, you can also use rounded corners.

Then choose **Operation**:

- **Pocket**: clear material inside the shape.
- **Contour**: machine along the contour (outside or inside where applicable).

### Contour Options

When `Contour` is selected:

- **Contour type**: outside or inside
- Optional **Tabs**:
  - Interval along contour
  - Tab width
  - Tab height (remaining material)

## Facing

Use facing to flatten a rectangular or square area.

Options:

- **Facing mode**:
  - `Within` (stays inside area)
  - `Full` (ensures full area coverage)
- Advanced:
  - Facing direction (`X` or `Y`)
  - Even spacing toggle

## Letters (Engraving)

Input fields:

- Text
- Letter size
- Letter mode (currently outline)
- Text orientation

Tip: for fine lettering, use a small or V-shaped tool.

## Counterbore Bolt

Use this for a bolt-hole feature with a wider head recess.

Main fields:

- Head diameter
- Counterbore depth
- Bolt diameter

The tool validates sensible geometry relationships (for example head diameter cannot be smaller than bolt diameter).

## Patterned Holes

Create a grid of holes.

Fields include:

- Hole diameter
- Center spacing X/Y
- Hole count X/Y
- Optional preset(s), such as MFT-style spacing

## Circular Pattern Holes

Create holes on a bolt circle.

Fields include:

- Number of holes
- Hole diameter
- Start angle
- Circle diameter
- Optional center hole + center hole diameter

## DXF (Contours)

Import a `.dxf` file and machine detected closed contours.

- Use the DXF file picker.
- Choose orientation (0, 90, -90, 180 degrees).
- Use contour workflows; DXF pocket behavior has limitations (see troubleshooting).
