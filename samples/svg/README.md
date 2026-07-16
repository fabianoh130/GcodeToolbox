# SVG testbestanden

Gebruik deze bestanden om **SVG (contouren)** te testen in Gcode Toolbox.

## Snel starten (lokaal)

Vanuit de projectmap:

```bash
./scripts/serve-local.sh
```

Open daarna in je browser:

**http://localhost:8080**

1. Kies **SVG (contouren)** als operatietype
2. Klik **Bestand kiezen** en selecteer een bestand uit `samples/svg/`
3. Klik **Genereer** en bekijk de preview

## Bestanden

| Bestand | Wat het test |
|---------|----------------|
| [simple-rect.svg](./simple-rect.svg) | Rechthoek (`<rect>`), 100×100 mm |
| [circle.svg](./circle.svg) | Cirkel (`<circle>`), Ø60 mm |
| [multi-contour.svg](./multi-contour.svg) | Meerdere contouren (buiten + gat) |
| [curved-path.svg](./curved-path.svg) | `<path>` met bogen en Bezier-krommen |
| [polygon-hex.svg](./polygon-hex.svg) | Zeshoek (`<polygon>`) |

## Automatische test (parser)

```bash
node scripts/test-svg-import.js
```

Dit controleert of elke voorbeeld-SVG minstens één gesloten contour oplevert.

## Online

Na merge naar `main` staat de app op [GitHub Pages](https://fabianoh130.github.io/GcodeToolbox/). Download de SVG-bestanden vanuit deze map en laad ze in de app.
