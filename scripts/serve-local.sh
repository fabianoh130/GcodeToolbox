#!/usr/bin/env bash
# Start een lokale webserver om Gcode Toolbox te testen (inclusief SVG-import).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT="${PORT:-8080}"
echo ""
echo "Gcode Toolbox — lokale testserver"
echo "  URL:  http://localhost:${PORT}"
echo "  SVG:  kies operatie 'DXF/SVG (contouren)' en laad bestanden uit samples/svg/"
echo ""
echo "Druk Ctrl+C om te stoppen."
echo ""
if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  exec python -m SimpleHTTPServer "$PORT"
else
  echo "Python niet gevonden. Installeer Python 3 of open index.html via een andere static server." >&2
  exit 1
fi
