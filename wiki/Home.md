# Gcode Toolbox Wiki

Welcome to the user guide for **Gcode Toolbox**.

This wiki explains how to use the tool from start to finish: setup, selecting operations, generating code, and validating output before machining.

## Quick Start

1. Open `index.html` in your browser.
2. Select your operation and geometry.
3. Enter cutting parameters (tool, depth, feed, safe height).
4. Click **Generate gcode**.
5. Review the toolpath preview and generated text.
6. Use **Download .nc** or **Copy to clipboard**.
7. Validate in a simulator before running on your machine.

## Wiki Pages

- [Getting Started](Getting-Started)
- [Operations and Shapes](Operations-and-Shapes)
- [Cutting Parameters](Cutting-Parameters)
- [Origins and Machine Settings](Origins-and-Machine-Settings)
- [DXF and Text](DXF-and-Text)
- [Export and Validation](Export-and-Validation)
- [Troubleshooting](Troubleshooting)

## Who This Tool Is For

This tool is intended for users who want to generate 2D CNC G-code quickly for:

- Basic shapes (circle, square, rectangle, ellipse, hexagon)
- Facing
- Text engraving
- Counterbore bolt holes
- Patterned holes and circular hole patterns
- DXF contour milling

## Safety Note

Always verify generated G-code in a simulator and do a safe test run (air cut or soft material) before cutting production material.
