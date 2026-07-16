// main.js - G-code generator voor eenvoudige 2D-vormen

/**
 * Conceptuele enumeraties (stringwaarden in de praktijk).
 */
const ShapeType = {
  CIRCLE: "circle",
  SQUARE: "square",
  RECTANGLE: "rectangle",
  HEXAGON: "hexagon",
  FACING: "facing",
  ELLIPSE: "ellipse",
  LETTERS: "letters",
  COUNTERBORE_BOLT: "counterbore_bolt",
  THREAD_MILLING: "thread_milling",
  PATTERNED_HOLES: "patterned_holes",
  CIRCULAR_PATTERN_HOLES: "circular_pattern_holes",
  DXF: "dxf",
};

const OperationType = {
  POCKET: "pocket",
  CONTOUR: "contour",
  FACING: "facing",
};

/** Operatietype-categorie (eerste dropdown). "vormen" toont de vorm-dropdown. */
const OperationTypeCategory = {
  SHAPES: "vormen",
  FACING: "facing",
  LETTERS: "letters",
  COUNTERBORE_BOLT: "counterbore_bolt",
  THREAD_MILLING: "thread_milling",
  HOLE_PATTERN: "hole_pattern",
  DXF: "dxf",
};

/** Patroontype binnen de samengevoegde patroongaten-operatie (UI-keuze). */
const HolePatternLayout = {
  GRID: "grid",
  CIRCULAR: "circular",
};

/** @returns {string} */
function getHolePatternLayout() {
  const el = /** @type {HTMLSelectElement | null} */ (document.getElementById("hole-pattern-layout"));
  return el?.value === HolePatternLayout.CIRCULAR ? HolePatternLayout.CIRCULAR : HolePatternLayout.GRID;
}

/**
 * Bepaalt de effectieve vorm op basis van operatiecategorie en (optioneel) vorm-dropdown.
 * @param {string} opType
 * @param {string|undefined|null} shapeValue
 * @returns {string}
 */
function resolveEffectiveShape(opType, shapeValue) {
  if (opType === OperationTypeCategory.SHAPES) {
    return shapeValue ?? ShapeType.CIRCLE;
  }
  if (opType === OperationTypeCategory.HOLE_PATTERN) {
    return getHolePatternLayout() === HolePatternLayout.CIRCULAR
      ? ShapeType.CIRCULAR_PATTERN_HOLES
      : ShapeType.PATTERNED_HOLES;
  }
  if (opType === "circular_pattern_holes") return ShapeType.CIRCULAR_PATTERN_HOLES;
  if (opType === "patterned_holes") return ShapeType.PATTERNED_HOLES;
  return opType;
}

/** @param {string|undefined|null} value */
function normalizeContourType(value) {
  if (value === "inside" || value === "outside" || value === "engraving") return value;
  return "outside";
}

/**
 * @param {string} shape
 * @param {string|undefined|null} contourType
 * @param {string|undefined|null} [letterMode]
 */
function isEngravingContourMode(shape, contourType, letterMode) {
  return getEngravingToolDiameterMm(shape, contourType, letterMode) != null;
}

const DXF_ENGRAVING_TOOL_DIAMETER_MM = 4;

/**
 * Vaste freesdiameter voor gravure-modi waar het pad niet wordt geoffset.
 * @param {string} shape
 * @param {string|undefined|null} contourType
 * @param {string|undefined|null} [letterMode]
 * @returns {number|null}
 */
function getEngravingToolDiameterMm(shape, contourType, letterMode) {
  if (shape === ShapeType.LETTERS && (letterMode || "outline") === "outline") return 0.5;
  if (shape === ShapeType.DXF && normalizeContourType(contourType) === "engraving") return DXF_ENGRAVING_TOOL_DIAMETER_MM;
  return null;
}

/** Gravure: altijd plunge — ramp laat een zichtbare streep achter op smalle lijnen. */
function effectiveEntryMethod(shape, contourType, letterMode, entryMethod) {
  return isEngravingContourMode(shape, contourType, letterMode)
    ? EntryMethod.PLUNGE
    : (entryMethod || EntryMethod.PLUNGE);
}

/** ISO metrisch / UNC inch draad-presets (alle maten in mm). */
const THREAD_PRESETS = {
  metric: {
    M3: { majorDia: 3.0, pitch: 0.5, holeDia: 2.5, defaultDepth: 4.5 },
    M4: { majorDia: 4.0, pitch: 0.7, holeDia: 3.3, defaultDepth: 6.0 },
    M5: { majorDia: 5.0, pitch: 0.8, holeDia: 4.2, defaultDepth: 7.5 },
    M6: { majorDia: 6.0, pitch: 1.0, holeDia: 5.0, defaultDepth: 9.0 },
    M8: { majorDia: 8.0, pitch: 1.25, holeDia: 6.8, defaultDepth: 12.0 },
    M10: { majorDia: 10.0, pitch: 1.5, holeDia: 8.5, defaultDepth: 15.0 },
    M12: { majorDia: 12.0, pitch: 1.75, holeDia: 10.2, defaultDepth: 18.0 },
  },
  inch: {
    "1/4-20": { majorDia: 6.35, pitch: 1.27, holeDia: 5.1, defaultDepth: 9.5 },
    "5/16-18": { majorDia: 7.938, pitch: 1.411, holeDia: 6.6, defaultDepth: 11.1 },
    "3/8-16": { majorDia: 9.525, pitch: 1.587, holeDia: 8.0, defaultDepth: 12.7 },
    "1/2-13": { majorDia: 12.7, pitch: 1.954, holeDia: 10.8, defaultDepth: 17.5 },
    "5/8-11": { majorDia: 15.875, pitch: 2.309, holeDia: 13.5, defaultDepth: 22.0 },
    "3/4-10": { majorDia: 19.05, pitch: 2.54, holeDia: 16.5, defaultDepth: 25.4 },
  },
};

/**
 * Radiale pass-stralen voor draadfrezen: roughing van binnen naar buiten, laatste pass op finish-straal.
 * @param {number} holeDiameter
 * @param {number} majorDiameter
 * @param {number} toolDiameter
 * @param {number} stepover
 * @returns {number[]}
 */
function computeThreadMillingPassRadii(holeDiameter, majorDiameter, toolDiameter, stepover) {
  const rMax = Math.max(0, (majorDiameter - toolDiameter) / 2);
  if (rMax <= 1e-6) return [];
  const rMin = Math.max(0, (holeDiameter - toolDiameter) / 2);
  if (rMax <= rMin + 1e-6) return [rMax];
  if (!Number.isFinite(stepover) || stepover <= 0) return [rMax];

  const radii = [];
  let r = rMin;
  while (r < rMax - 1e-6) {
    radii.push(r);
    r += stepover;
  }
  if (radii.length === 0 || radii[radii.length - 1] < rMax - 1e-6) {
    radii.push(rMax);
  }
  return radii;
}

/** Veiligheidspasses (radiale stepover) voor draadfrezen — code aanwezig, later inschakelen. */
const THREAD_MILLING_SPRING_PASSES_ENABLED = false;

const ThreadMillType = {
  INTERNAL: "internal",
  EXTERNAL: "external",
};

const ThreadCutDirection = {
  BOTTOM_TO_TOP: "bottom_to_top",
  TOP_TO_BOTTOM: "top_to_bottom",
};

const ThreadHand = {
  RIGHT: "right_hand",
  LEFT: "left_hand",
};

/**
 * Finish-straal freescentrum voor draadfrezen (mm).
 * Binnen: (major − tool) / 2; buiten: (major + tool) / 2.
 */
function getThreadMillingFinishRadius(majorDia, toolDia, threadMillType) {
  const external = threadMillType === ThreadMillType.EXTERNAL;
  const r = external ? (majorDia + toolDia) / 2 : (majorDia - toolDia) / 2;
  return Math.max(0, r);
}

/**
 * Draairichting helix voor metrische schroefdraad, gezien van boven.
 * Rechtsdraads boven→onder: rechtsom (CW). Linksdraads: omgekeerd.
 * Binnendraad gebruikt tegengestelde toolrotatie t.o.v. buitendraad (climb milling).
 */
function getThreadMillingHelixSign(threadMillType, cutBottomToTop, threadHand) {
  const topToBottomSign = threadMillType === ThreadMillType.EXTERNAL ? -1 : 1;
  const rhSign = cutBottomToTop ? -topToBottomSign : topToBottomSign;
  return threadHand === ThreadHand.LEFT ? -rhSign : rhSign;
}

/** Benaderde kerfdiameter ISO-60° uitwendige metrische draad (mm). */
function externalThreadMinorDiameter(majorDia, pitch) {
  return majorDia - 1.226869 * pitch;
}

const XYOrigin = {
  CENTER: "center",
  BOTTOM_LEFT: "bottom_left",
  BOTTOM_RIGHT: "bottom_right",
  TOP_LEFT: "top_left",
  TOP_RIGHT: "top_right",
};

const ZOrigin = {
  STOCK_TOP: "stock_top",
  STOCK_BOTTOM: "stock_bottom",
};

const EntryMethod = {
  PLUNGE: "plunge",
  RAMP: "ramp",
};

/**
 * @typedef {{ x: number, y: number, z: number, type: 'rapid'|'cut', feedOverridePct?: number }} ToolpathMove
 * @typedef {{ moves: ToolpathMove[], resultPaths?: {x:number,y:number,z:number}[][], resultTotalDepth?: number, resultBottomZ?: number, resultContourInside?: boolean, resultPathsWithDepth?: {path:{x:number,y:number,z:number}[], topZ:number, bottomZ:number}[], resultBounds?: {minX:number,maxX:number,minY:number,maxY:number}, toolDiameter?: number }} Toolpath
 */

const DEFAULT_SAFE_Z = 10; // mm, standaard veilige hoogte (overschrijfbaar via formulier)
const GCODE_TOOLBOX_URL = "https://fabianoh130.github.io/GcodeToolbox/";

/** Conversie display-eenheid naar mm (intern). */
const MM_PER_INCH = 25.4;
function toMm(value, unit) {
  if (!Number.isFinite(value)) return value;
  return unit === "inch" ? value * MM_PER_INCH : value;
}
function fromMm(mm, unit) {
  if (!Number.isFinite(mm)) return mm;
  return unit === "inch" ? mm / MM_PER_INCH : mm;
}

/** Maximale afwijking (mm) van cirkelboog bij polygoonbenadering; gebruikt om aantal segmenten te bepalen. */
const CIRCLE_TOLERANCE_MM = 0.01;

/**
 * Berekent het aantal lijnsegmenten voor een cirkel met gegeven straal (mm) zodat de maximale
 * afwijking (sagitta) ≤ CIRCLE_TOLERANCE_MM blijft.
 * @param {number} radiusMm - straal in mm
 * @returns {number} aantal segmenten (min 4, max 360)
 */
function segmentsForCircleRadius(radiusMm) {
  if (!Number.isFinite(radiusMm) || radiusMm <= 0) return 4;
  const arg = Math.max(-1, 1 - CIRCLE_TOLERANCE_MM / radiusMm);
  const n = Math.ceil(Math.PI / Math.acos(arg));
  return Math.max(4, Math.min(360, n));
}

/** Font voor lettergravering. Eerst lokaal, anders dit fallback-URL (opentype.js testfont, werkt zonder variable-font fout). */
const LETTER_FONT_URL =
  "https://cdn.jsdelivr.net/gh/opentypejs/opentype.js@master/test/fonts/Roboto-Black.ttf";
/** Lokaal fontbestand (relatief aan de pagina); voor offline gebruik bestand in fonts/ map zetten. */
const LETTER_FONT_LOCAL = "fonts/Roboto-Black.ttf";
let cachedLetterFont = null;

const PreviewViewMode = {
  ISO: "iso",
  TOP: "top",
  FRONT: "front",
  SIDE: "side",
};

/** @type {keyof typeof PreviewViewMode} */
let currentPreviewView = PreviewViewMode.ISO;

/** @type {Toolpath} */
let lastToolpath = { moves: [] };

/**
 * Meertaligheid (i18n). Taal wordt opgeslagen in localStorage onder "gcode-lang".
 * Nieuwe talen: voeg een key toe in TRANSLATIONS (translations.js) en een knop in de lang-switcher.
 */
const LANG_STORAGE_KEY = "gcode-lang";
const DEFAULT_LANG = "en";
let currentLang = DEFAULT_LANG;

const THEME_STORAGE_KEY = "gcode-theme";
const DEFAULT_THEME = "light";

const UNIT_STORAGE_KEY = "gcode-unit";
const DEFAULT_UNIT = "mm";

const MODE_STORAGE_KEY = "gcode-mode";
const DEFAULT_MODE = "simple";

const FIRST_VISIT_STORAGE_KEY = "gcode-first-visit-shown";
function getDisplayMode() {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (stored === "simple" || stored === "advanced") return stored;
  } catch (_) {}
  return DEFAULT_MODE;
}

function getDisplayUnit() {
  try {
    const stored = localStorage.getItem(UNIT_STORAGE_KEY);
    if (stored === "mm" || stored === "inch") return stored;
  } catch (_) {}
  return DEFAULT_UNIT;
}

function getCurrentTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch (_) {}
  return DEFAULT_THEME;
}

function getCurrentLang() {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored && typeof TRANSLATIONS !== "undefined" && TRANSLATIONS[stored]) return stored;
  } catch (_) {}
  return DEFAULT_LANG;
}

/** Vertaal een key; optioneel object met placeholders, bijv. { label: "Freesdiameter" } voor "{{label}} moet..." */
function t(key, vars) {
  const dict = typeof TRANSLATIONS !== "undefined" && TRANSLATIONS[currentLang] ? TRANSLATIONS[currentLang] : {};
  let s = dict[key] != null ? dict[key] : (TRANSLATIONS[DEFAULT_LANG] && TRANSLATIONS[DEFAULT_LANG][key]) || key;
  if (vars && typeof vars === "object") {
    Object.keys(vars).forEach((k) => {
      s = s.replace(new RegExp("\\{\\{\\s*" + k + "\\s*\\}\\}", "g"), String(vars[k]));
    });
  }
  return s;
}

function setLanguage(lang) {
  if (!TRANSLATIONS[lang]) return;
  currentLang = lang;
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch (_) {}
  document.documentElement.lang = lang;
  applyTranslations();
  document.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.getAttribute("data-lang") === lang ? "true" : "false");
  });
  document.dispatchEvent(new CustomEvent("languagechange"));
}

/** Keys die een inch-variant hebben (form.xxxIn) voor label-weergave. */
const UNIT_LABEL_KEYS = [
  "form.patternedHolesDiameter", "form.patternedHolesSpacingX", "form.patternedHolesSpacingY",
  "form.circularPatternHolesDiameter", "form.circularPatternHolesCircleDiameter", "form.circularPatternHolesCenterDiameter",
  "form.diameter", "form.counterboreHeadDiameter", "form.counterboreDepth", "form.counterboreBoltDiameter",
  "form.threadMajorDiameter", "form.threadPitch", "form.threadHoleDiameter", "form.threadMillingDepth",
  "form.side", "form.width", "form.height", "form.roundedCornerRadius", "form.hexagonHeight", "form.majorAxis", "form.minorAxis", "form.letterSize",
  "form.tabInterval", "form.tabWidth", "form.tabHeight",
  "form.toolDiameter", "form.totalDepth", "form.stepdown", "form.feedrate", "form.safeHeight", "form.leadInAbove", "form.zOffset", "form.originOffsetX", "form.originOffsetY", "form.finishingPassOverlap",
];

function applyTranslations() {
  const displayUnit = getDisplayUnit();
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    const effectiveKey = (displayUnit === "inch" && UNIT_LABEL_KEYS.includes(key)) ? key + "In" : key;
    const text = t(effectiveKey);
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      /** placeholder wordt apart gezet via data-i18n-placeholder */
      if (!el.hasAttribute("data-i18n-placeholder")) el.placeholder = text;
    } else {
      el.textContent = text;
    }
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
  });
  const titleEl = document.querySelector("title[data-i18n]");
  if (titleEl) titleEl.textContent = t(titleEl.getAttribute("data-i18n"));
}

/**
 * Hulpfuncties
 */
function toNumber(input) {
  if (input == null) return NaN;
  if (typeof input === "number") return Number.isFinite(input) ? input : NaN;
  // Sta zowel punt als komma als decimaalteken toe
  const v = String(input).trim().replace(",", ".");
  if (v === "" || v === "." || v === "-") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** @param {string} value */
function isPartialDecimalInput(value) {
  const v = String(value ?? "").trim();
  return v === "" || v === "." || v === "," || v === "-" || v.endsWith(".") || v.endsWith(",");
}

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function distance2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * Kleinste karakteristieke maat van de vorm (mm), gebruikt voor checks
 * t.o.v. freesdiameter (bij pocket / binnencontour).
 */
function getShapeMinSize(shape, shapeParams) {
  switch (shape) {
    case ShapeType.CIRCLE:
      return shapeParams.diameter;
    case ShapeType.SQUARE:
      return shapeParams.size;
    case ShapeType.RECTANGLE:
    case ShapeType.FACING:
      return Math.min(shapeParams.width, shapeParams.height);
    case ShapeType.ELLIPSE:
      return Math.min(shapeParams.major, shapeParams.minor);
    case ShapeType.HEXAGON:
      return shapeParams.height;
    case ShapeType.LETTERS:
      return shapeParams.fontSize;
    case ShapeType.COUNTERBORE_BOLT:
      return Math.min(shapeParams.headDiameter || Infinity, shapeParams.boltDiameter || Infinity);
    case ShapeType.THREAD_MILLING:
      return shapeParams.holeDiameter;
    case ShapeType.PATTERNED_HOLES:
      return shapeParams.diameter;
    case ShapeType.CIRCULAR_PATTERN_HOLES:
      if (shapeParams.holeInCenter && Number.isFinite(shapeParams.centerHoleDiameter) && shapeParams.centerHoleDiameter > 0) {
        return Math.min(shapeParams.diameter, shapeParams.centerHoleDiameter);
      }
      return shapeParams.diameter;
    case ShapeType.DXF:
      return NaN;
    default:
      return NaN;
  }
}

/**
 * Laad het letterfont voor gravering (eenmalig gecached).
 * Volgorde: 1) ingesloten base64 (offline), 2) lokaal bestand fonts/..., 3) CDN-URL.
 * @returns {Promise<import('opentype.js').Font>}
 */
function loadLetterFont() {
  if (cachedLetterFont) return Promise.resolve(cachedLetterFont);
  if (typeof opentype === "undefined") {
    return Promise.reject(new Error(t("error.opentypeNotLoaded")));
  }

  function parseBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return opentype.parse(bytes.buffer);
  }

  if (typeof window !== "undefined" && window.LETTER_FONT_BASE64) {
    try {
      cachedLetterFont = parseBase64(window.LETTER_FONT_BASE64);
      return Promise.resolve(cachedLetterFont);
    } catch (e) {
      console.warn("Ingesloten lettertype kon niet worden geparsed:", e);
    }
  }

  function tryLoad(url) {
    return new Promise((resolve, reject) => {
      opentype.load(url, (err, font) => {
        if (err) reject(err);
        else {
          cachedLetterFont = font;
          resolve(font);
        }
      });
    });
  }

  // Bij file:// (lokaal bestand) faalt laden van fonts/... door CORS; sla lokaal over en gebruik CDN.
  const isFileProtocol = typeof window !== "undefined" && (window.location.protocol === "file:" || !window.location.origin || window.location.origin === "null");
  const loadOrder = isFileProtocol ? [LETTER_FONT_URL] : [LETTER_FONT_LOCAL, LETTER_FONT_URL];

  let chain = Promise.reject();
  for (const url of loadOrder) {
    chain = chain.catch(() => tryLoad(url));
  }
  return chain.catch((err) =>
    Promise.reject(new Error(t("error.fontNotLoaded") + (err && err.message ? err.message : err)))
  );
}

/** Aantal punten om een Bézier-curve te benaderen */
const BEZIER_SEGMENTS = 16;

/**
 * Converteer opentype path-commando's naar een reeks contour-paden (array van punten per contour).
 * @param {import('opentype.js').Path} path
 * @returns {{ x: number, y: number, z: number }[][]}
 */
function pathCommandsToContours(path) {
  const contours = [];
  let current = [];
  let lastX = 0;
  let lastY = 0;

  function addPoint(x, y) {
    current.push({ x, y, z: 0 });
    lastX = x;
    lastY = y;
  }

  function sampleCubic(x1, y1, x2, y2, x, y) {
    for (let i = 1; i <= BEZIER_SEGMENTS; i++) {
      const t = i / BEZIER_SEGMENTS;
      const u = 1 - t;
      const u2 = u * u;
      const u3 = u2 * u;
      const t2 = t * t;
      const t3 = t2 * t;
      const px = u3 * lastX + 3 * u2 * t * x1 + 3 * u * t2 * x2 + t3 * x;
      const py = u3 * lastY + 3 * u2 * t * y1 + 3 * u * t2 * y2 + t3 * y;
      addPoint(px, py);
    }
  }

  function sampleQuadratic(x1, y1, x, y) {
    for (let i = 1; i <= BEZIER_SEGMENTS; i++) {
      const t = i / BEZIER_SEGMENTS;
      const u = 1 - t;
      const px = u * u * lastX + 2 * u * t * x1 + t * t * x;
      const py = u * u * lastY + 2 * u * t * y1 + t * t * y;
      addPoint(px, py);
    }
  }

  const cmds = path.commands;
  if (!Array.isArray(cmds) || cmds.length === 0) return contours;

  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];
    let cmdType = typeof c.type === "string" ? c.type : "";
    if (cmdType === "curveTo" || cmdType === "bezierCurveTo") cmdType = "C";
    if (cmdType === "quadTo" || cmdType === "quadraticCurveTo") cmdType = "Q";
    cmdType = cmdType.toUpperCase();
    const rel = c.type === "c" || c.type === "q" || c.type === "l" || c.type === "m";
    const ox = rel ? lastX : 0;
    const oy = rel ? lastY : 0;
    const x = (c.x ?? 0) + ox;
    const y = (c.y ?? 0) + oy;
    let x1 = c.x1 ?? c.cp1x;
    let y1 = c.y1 ?? c.cp1y;
    let x2 = c.x2 ?? c.cp2x;
    let y2 = c.y2 ?? c.cp2y;
    if (rel) {
      if (x1 !== undefined) x1 = Number(x1) + ox;
      if (y1 !== undefined) y1 = Number(y1) + oy;
      if (x2 !== undefined) x2 = Number(x2) + ox;
      if (y2 !== undefined) y2 = Number(y2) + oy;
    }

    switch (cmdType) {
      case "M":
        if (current.length > 0) contours.push(current);
        current = [];
        addPoint(x, y);
        break;
      case "L":
        addPoint(x, y);
        break;
      case "C":
        if (
          Number.isFinite(x1) && Number.isFinite(y1) &&
          Number.isFinite(x2) && Number.isFinite(y2) &&
          Number.isFinite(x) && Number.isFinite(y)
        ) {
          sampleCubic(x1, y1, x2, y2, x, y);
        } else {
          addPoint(x, y);
        }
        break;
      case "Q":
        if (Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x) && Number.isFinite(y)) {
          sampleQuadratic(x1, y1, x, y);
        } else {
          addPoint(x, y);
        }
        break;
      case "Z":
        if (current.length > 0) {
          current.push({ ...current[0], z: 0 });
          lastX = current[0].x;
          lastY = current[0].y;
        }
        break;
      default:
        if (Number.isFinite(x) && Number.isFinite(y)) addPoint(x, y);
        break;
    }
  }
  if (current.length > 0) contours.push(current);
  return contours;
}

/**
 * Parse een DXF-tekst en extraheer gesloten contouren (LWPOLYLINE, CIRCLE, ARC, LINE).
 * Vereist dat dxf-parser geladen is (script tag). Coördinaten blijven in DXF-eenheid (meestal mm).
 * @param {string} dxfString - ruwe DXF-tekst
 * @returns {{ x: number, y: number, z: number }[][]}
 */
function parseDxfToContours(dxfString) {
  const DxfParserClass = typeof DxfParser !== "undefined" ? DxfParser : (typeof window !== "undefined" && window.DxfParser);
  if (!DxfParserClass) {
    throw new Error(t("error.dxfParserNotLoaded"));
  }
  const parser = new DxfParserClass();
  let dxf;
  try {
    dxf = parser.parse(dxfString);
  } catch (e) {
    throw new Error(t("error.dxfParseFailed") + (e && e.message ? e.message : String(e)));
  }
  if (!dxf || !dxf.entities || !Array.isArray(dxf.entities)) {
    return [];
  }
  /** @type {{ x: number, y: number, z: number }[][]} */
  const contours = [];

  for (const ent of dxf.entities) {
    const type = (ent.type || "").toUpperCase();
    if (type === "CIRCLE" && ent.center != null && Number.isFinite(ent.radius)) {
      const cx = Number(ent.center.x) || 0;
      const cy = Number(ent.center.y) || 0;
      const r = Math.abs(Number(ent.radius)) || 0;
      const n = segmentsForCircleRadius(r);
      const contour = [];
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * 2 * Math.PI;
        contour.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t), z: 0 });
      }
      if (contour.length >= 3) contours.push(contour);
    } else if (type === "ARC" && ent.center != null && Number.isFinite(ent.radius)) {
      const cx = Number(ent.center.x) || 0;
      const cy = Number(ent.center.y) || 0;
      const r = Math.abs(Number(ent.radius)) || 0;
      let start = Number(ent.startAngle);
      let end = Number(ent.endAngle);
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end)) end = start + 2 * Math.PI;
      const n = Math.max(4, Math.min(120, Math.ceil((Math.abs(end - start) / (2 * Math.PI)) * 32)));
      const contour = [];
      for (let i = 0; i <= n; i++) {
        const t = start + (i / n) * (end - start);
        contour.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t), z: 0 });
      }
      if (contour.length >= 3) contours.push(contour);
    } else if (type === "LWPOLYLINE" && ent.vertices && Array.isArray(ent.vertices) && ent.vertices.length >= 2) {
      const contour = [];
      const verts = ent.vertices;
      for (let i = 0; i < verts.length; i++) {
        const v = verts[i];
        const x = Number(v.x);
        const y = Number(v.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const bulge = Number(v.bulge);
        contour.push({ x, y, z: 0 });
        const nextIdx = i + 1 < verts.length ? i + 1 : (ent.closed === true || ent.shape === true ? 0 : -1);
        if (Number.isFinite(bulge) && Math.abs(bulge) > 1e-9 && nextIdx >= 0) {
          const nextV = verts[nextIdx];
          const nx = Number(nextV.x);
          const ny = Number(nextV.y);
          if (Number.isFinite(nx) && Number.isFinite(ny)) {
            const chord = Math.sqrt((nx - x) * (nx - x) + (ny - y) * (ny - y));
            if (chord > 1e-9) {
              const sag = (bulge * chord) / 2;
              const perpX = -(ny - y);
              const perpY = nx - x;
              const len = Math.sqrt(perpX * perpX + perpY * perpY) || 1e-9;
              const r = (chord * chord) / (8 * Math.abs(sag)) + Math.abs(sag) / 2;
              const a = Math.sqrt(Math.max(0, r * r - (chord * chord) / 4));
              const midX = (x + nx) / 2;
              const midY = (y + ny) / 2;
              const cx = midX + (perpX / len) * Math.sign(bulge) * a;
              const cy = midY + (perpY / len) * Math.sign(bulge) * a;
              const startAng = Math.atan2(y - cy, x - cx);
              const endAng = Math.atan2(ny - cy, nx - cx);
              let span = endAng - startAng;
              if ((bulge > 0 && span < 0) || (bulge < 0 && span > 0)) span += bulge > 0 ? 2 * Math.PI : -2 * Math.PI;
              const n = Math.max(4, Math.min(64, Math.ceil((Math.abs(span) / (2 * Math.PI)) * segmentsForCircleRadius(r))));
              for (let k = 1; k < n; k++) {
                const t = startAng + (k / n) * span;
                contour.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t), z: 0 });
              }
            }
          }
        }
      }
      const closed = !!(ent.shape === true || ent.closed === true) ||
        (contour.length >= 3 && Math.hypot(contour[contour.length - 1].x - contour[0].x, contour[contour.length - 1].y - contour[0].y) < 1e-6);
      if (closed && contour.length >= 3) {
        if (Math.hypot(contour[contour.length - 1].x - contour[0].x, contour[contour.length - 1].y - contour[0].y) >= 1e-6) {
          contour.push({ ...contour[0], z: 0 });
        }
        contours.push(contour);
      }
    } else if (type === "LINE" && ent.vertices && Array.isArray(ent.vertices) && ent.vertices.length >= 2) {
      const v0 = ent.vertices[0];
      const v1 = ent.vertices[1];
      const x0 = Number(v0.x);
      const y0 = Number(v0.y);
      const x1 = Number(v1.x);
      const y1 = Number(v1.y);
      if (Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1) &&
          Math.hypot(x1 - x0, y1 - y0) > 1e-9) {
        contours.push([
          { x: x0, y: y0, z: 0 },
          { x: x1, y: y1, z: 0 },
        ]);
      }
    }
  }
  if (contours.length === 0) return contours;
  const closedContours = contours.filter((c) => c.length >= 3 &&
    Math.hypot(c[c.length - 1].x - c[0].x, c[c.length - 1].y - c[0].y) < 1e-6);
  const lineSegments = contours.filter((c) => c.length === 2);
  if (lineSegments.length > 0) {
    closedContours.push(...buildClosedChainsFromLines(lineSegments));
  }
  return closedContours.length > 0 ? closedContours : contours.filter((c) => c.length >= 3);
}

/**
 * Verbind LINE-segmenten tot gesloten lussen (endpoint-matching met tolerantie).
 * @param {{ x: number, y: number, z: number }[][]} segments - elk element is [start, end]
 * @returns {{ x: number, y: number, z: number }[][]}
 */
function buildClosedChainsFromLines(segments) {
  const result = [];
  const used = new Set();
  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    const [a, b] = segments[i];
    const path = [a, b];
    used.add(i);
    let current = b;
    for (;;) {
      let found = -1;
      for (let j = 0; j < segments.length; j++) {
        if (used.has(j)) continue;
        const [p, q] = segments[j];
        if (Math.hypot(current.x - p.x, current.y - p.y) < 1e-4) {
          path.push(q);
          current = q;
          found = j;
          break;
        }
        if (Math.hypot(current.x - q.x, current.y - q.y) < 1e-4) {
          path.push(p);
          current = p;
          found = j;
          break;
        }
      }
      if (found < 0) break;
      used.add(found);
      if (path.length >= 3 && Math.hypot(current.x - a.x, current.y - a.y) < 1e-4) {
        path.push({ ...a, z: 0 });
        result.push(path);
        break;
      }
    }
  }
  return result;
}

/**
 * Pas XY-origin transform toe op DXF-contouren (zelfde logica als letters: bbox + offset).
 * @param {{ x: number, y: number, z: number }[][]} contours
 * @param {string} xyOrigin
 * @returns {{ x: number, y: number, z: number }[][]}
 */
function applyOriginToDxfContours(contours, xyOrigin) {
  if (!contours || contours.length === 0) return contours;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const contour of contours) {
    for (const p of contour) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let dx, dy;
  switch (xyOrigin) {
    case XYOrigin.CENTER: dx = -cx; dy = -cy; break;
    case XYOrigin.BOTTOM_LEFT: dx = -minX; dy = -minY; break;
    case XYOrigin.BOTTOM_RIGHT: dx = -maxX; dy = -minY; break;
    case XYOrigin.TOP_LEFT: dx = -minX; dy = -maxY; break;
    case XYOrigin.TOP_RIGHT: dx = -maxX; dy = -maxY; break;
    default: dx = -minX; dy = -minY; break;
  }
  return contours.map((contour) =>
    contour.map((p) => ({ x: p.x + dx, y: p.y + dy, z: 0 }))
  );
}

/**
 * Bepaal de XY-verschuiving voor DXF-contouren (zelfde logica als applyOriginToDxfContours).
 * @param {{ x: number, y: number, z?: number }[][]} contours
 * @param {string} xyOrigin
 * @returns {{ dx: number, dy: number }}
 */
function getDxfOriginShift(contours, xyOrigin) {
  if (!contours || contours.length === 0) return { dx: 0, dy: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const contour of contours) {
    for (const p of contour) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let dx;
  let dy;
  switch (xyOrigin) {
    case XYOrigin.CENTER: dx = -cx; dy = -cy; break;
    case XYOrigin.BOTTOM_LEFT: dx = -minX; dy = -minY; break;
    case XYOrigin.BOTTOM_RIGHT: dx = -maxX; dy = -minY; break;
    case XYOrigin.TOP_LEFT: dx = -minX; dy = -maxY; break;
    case XYOrigin.TOP_RIGHT: dx = -maxX; dy = -maxY; break;
    default: dx = -minX; dy = -minY; break;
  }
  return { dx, dy };
}

/**
 * @param {{ x: number, y: number }[]} points
 * @param {{ dx: number, dy: number }} shift
 * @returns {{ x: number, y: number }[]}
 */
function applyDxfOriginShiftToPoints(points, shift) {
  if (!points?.length) return [];
  return points.map((p) => ({ x: p.x + shift.dx, y: p.y + shift.dy }));
}

/**
 * @param {string} dxfText
 * @param {number} orientationDeg
 * @returns {{ x: number, y: number, z: number }[][]}
 */
function getOrientedDxfContoursFromText(dxfText, orientationDeg) {
  const contours = parseDxfToContours(dxfText);
  if (!contours.length) return [];
  return orientationDeg !== 0 ? rotatePathsAroundOrigin(contours, orientationDeg) : contours;
}

/**
 * @param {*} raw
 * @param {{ x: number, y: number, z: number }[][]} orientedContours
 */
function applyDxfOriginToRaw(raw, orientedContours) {
  const shift = getDxfOriginShift(orientedContours, raw.originParams.xyOrigin);
  raw.dxfContours = applyOriginToDxfContours(orientedContours, raw.originParams.xyOrigin);
  if (raw.dxfSupportHoles?.enabled && raw.dxfSupportHoles.points?.length) {
    raw.dxfSupportHoles = {
      ...raw.dxfSupportHoles,
      points: applyDxfOriginShiftToPoints(raw.dxfSupportHoles.points, shift),
    };
  }
}

/**
 * Genereer lettercontouren voor de gegeven tekst (omtrek per contour, in mm).
 * Vereist dat loadLetterFont() eerder is aangeroepen.
 * @param {string} text
 * @param {number} fontSizeMm
 * @param {string} xyOrigin - "center" | "bottom_left" | "bottom_right" | "top_left" | "top_right"
 * @param {import('opentype.js').Font} font
 * @returns {{ x: number, y: number, z: number }[][]}
 */
function getLetterPathsFromFont(text, fontSizeMm, xyOrigin, font) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/).filter((l) => l.length > 0);
  const lineHeight = fontSizeMm * 1.25;
  /** @type {{ x: number, y: number, z: number }[][]} */
  let allContours = [];
  // Eerste regel krijgt meest negatieve yOff, zodat na Y-spiegeling de eerste regel bovenaan komt
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const yOff = -(lines.length - 1 - i) * lineHeight;
    const path = font.getPath(line, 0, yOff, fontSizeMm);
    const contours = pathCommandsToContours(path);
    let lineMinY = Infinity, lineMaxY = -Infinity;
    for (const contour of contours) {
      for (const p of contour) {
        if (p.y < lineMinY) lineMinY = p.y;
        if (p.y > lineMaxY) lineMaxY = p.y;
      }
    }
    const actualHeight = lineMaxY - lineMinY || 1;
    const scale = fontSizeMm / actualHeight;
    const baseline = lineMinY;
    const scaledContours = contours.map((contour) =>
      contour.map((p) => ({
        x: p.x * scale,
        y: baseline + (p.y - baseline) * scale,
        z: 0,
      }))
    );
    allContours = allContours.concat(scaledContours);
  }
  if (allContours.length === 0) return [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const contour of allContours) {
    for (const p of contour) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let dx, dy;
  switch (xyOrigin) {
    case XYOrigin.CENTER: dx = -cx; dy = -cy; break;
    case XYOrigin.BOTTOM_LEFT: dx = -minX; dy = -minY; break;
    case XYOrigin.BOTTOM_RIGHT: dx = -maxX; dy = -minY; break;
    case XYOrigin.TOP_LEFT: dx = -minX; dy = -maxY; break;
    case XYOrigin.TOP_RIGHT: dx = -maxX; dy = -maxY; break;
    default: dx = -minX; dy = -minY; break;
  }

  // Fontcoördinaten: Y spiegelen zodat letters rechtop staan; X niet spiegelen zodat tekst links-naar-rechts leesbaar is (HANS)
  return allContours.map((contour) =>
    contour.map((p) => ({
      x: p.x + dx,
      y: -(p.y + dy),
      z: 0,
    }))
  );
}

/**
 * Roteer een lijst contour-paden rond de oorsprong (0,0).
 * @param {{ x: number, y: number, z: number }[][]} paths
 * @param {number} angleDeg - hoek in graden; positief = met de klok mee (90 = tekst 90° naar rechts)
 * @returns {{ x: number, y: number, z: number }[][]}
 */
function rotatePathsAroundOrigin(paths, angleDeg) {
  if (!paths || paths.length === 0 || (angleDeg % 360 === 0)) return paths;
  const rad = degToRad(-angleDeg); // omzetten naar wiskundige hoek (CCW positief)
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return paths.map((contour) =>
    contour.map((p) => ({
      x: p.x * cos - p.y * sin,
      y: p.x * sin + p.y * cos,
      z: p.z,
    }))
  );
}

/**
 * Bepaal de kleinste afmeting van een contour (geschatte breedte/hoogte van de bbox).
 * @param {{ x: number, y: number }[]} pts
 * @returns {number}
 */
function contourMinSize(pts) {
  if (!pts || pts.length < 2) return 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return Math.min(maxX - minX, maxY - minY);
}

/**
 * Bepaal of een gesloten polygoon (punten tegen de klok in) rechtsom (CW) of linksom (CCW) is.
 * Positieve signed area = CCW (tegen de klok in), negatief = CW.
 * @param {{ x: number, y: number }[]} pts
 * @returns {number} signed area * 2 (positief = CCW)
 */
function polygonSignedArea2(pts) {
  if (!pts || pts.length < 3) return 0;
  let sum = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  }
  return sum;
}

/**
 * Offset van contour via ClipperLib (indien beschikbaar).
 * Clipper: positieve delta = uitbreiden (outward), negatief = verkleinen (inward).
 * Onze conventie: positief = naar binnen, negatief = naar buiten.
 * Dus: Clipper delta = -distance.
 *
 * @param {{ x: number, y: number, z: number }[]} contour - gesloten contour
 * @param {number} distance - positief = naar binnen, negatief = naar buiten (mm)
 * @param {{ failReason?: string }} [debug]
 * @returns {{ x: number, y: number, z: number }[] | null}
 */
function contourOffsetViaClipper(contour, distance, debug) {
  const ClipperLib = typeof window !== "undefined" ? window.ClipperLib : typeof globalThis !== "undefined" ? globalThis.ClipperLib : undefined;
  if (!ClipperLib || !ClipperLib.ClipperOffset || !ClipperLib.JS || !ClipperLib.JS.Clean) return null;

  try {
  let pts = contour;
  const n = pts.length;
  if (n < 3) return null;
  const closed = n >= 2 && Math.abs(pts[n - 1].x - pts[0].x) < 1e-9 && Math.abs(pts[n - 1].y - pts[0].y) < 1e-9;
  if (closed) pts = pts.slice(0, n - 1);
  if (pts.length < 3) return null;

  const scale = 1000;
  const path = pts.map((p) => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }));

  let paths = [path];
  const cleandelta = 0.1;
  paths = ClipperLib.JS.Clean(paths, cleandelta * scale);
  if (!paths || paths.length === 0 || !paths[0] || paths[0].length < 3) {
    if (debug) debug.failReason = "contour te klein of ongeldig na opschonen";
    return null;
  }

  const miterLimit = 2;
  const arcTolerance = 0.25;
  const co = new ClipperLib.ClipperOffset(miterLimit, arcTolerance);
  co.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);

  const delta = -distance * scale;
  const solution = new ClipperLib.Paths();
  co.Execute(solution, delta);

  if (!solution || solution.length === 0) {
    if (debug) debug.failReason = "offset levert lege contour (frees te groot of contour te smal)";
    return null;
  }

  const z0 = contour[0].z ?? 0;
  const out = [];
  for (const solPath of solution) {
    if (!solPath || solPath.length < 3) continue;
    const scaled = solPath.map((p) => ({ x: p.X / scale, y: p.Y / scale }));
    const area2 = polygonSignedArea2(scaled);
    const origArea2 = polygonSignedArea2(pts);
    if (area2 * origArea2 < 0) {
      for (let i = solPath.length - 1; i >= 0; i--) {
        const p = solPath[i];
        out.push({ x: p.X / scale, y: p.Y / scale, z: z0 });
      }
    } else {
      for (let i = 0; i < solPath.length; i++) {
        const p = solPath[i];
        out.push({ x: p.X / scale, y: p.Y / scale, z: z0 });
      }
    }
    break;
  }

  if (out.length < 3) {
    if (debug) debug.failReason = "geen geldige offset-contour";
    return null;
  }
  out.push({ ...out[0], z: z0 });
  return out;
  } catch (e) {
    if (debug && e && e.message) debug.failReason = "Clipper: " + String(e.message);
    return null;
  }
}

/**
 * Contour één afstand naar binnen (inset) of buiten (outset) verschuiven.
 * Gebruikt ClipperLib (robuust voor L-vormen e.d.).
 *
 * @param {{ x: number, y: number, z: number }[]} contour - gesloten contour
 * @param {number} distance - positief = naar binnen, negatief = naar buiten (mm)
 * @param {{ failReason?: string }} [debug]
 * @returns {{ x: number, y: number, z: number }[] | null}
 */
function contourOffset(contour, distance, debug) {
  if (!contour || contour.length < 3) {
    if (debug) debug.failReason = "contour te kort of leeg";
    return null;
  }
  if (distance === 0) return contour.map((p) => ({ ...p }));

  const clipperResult = contourOffsetViaClipper(contour, distance, debug);
  if (clipperResult) return clipperResult;

  if (debug && !debug.failReason) debug.failReason = "ClipperLib niet beschikbaar of offset mislukt";
  return null;
}

const MAX_POCKET_RINGS = 300;

/**
 * Pocket-ringen: start met gegeven contour (al op freesstraal naar binnen), dan herhaald stepover naar binnen.
 */
function pocketRingsFromInnerContour(innerContour, stepover) {
  const rings = [];
  let current = innerContour;
  let it = 0;
  while (current && current.length >= 3 && it < MAX_POCKET_RINGS) {
    it++;
    rings.push(current);
    current = contourOffset(current, stepover);
    if (!current) break;
  }
  return rings;
}

/**
 * Input lezen en valideren
 */
function readInputsFromForm() {
  const g = (id) => document.getElementById(id);
  const displayUnit = getDisplayUnit();

  const operationTypeCategory = /** @type {HTMLSelectElement} */ (g("operation-type"))?.value ?? OperationTypeCategory.SHAPES;
  const shape = resolveEffectiveShape(
    operationTypeCategory,
    /** @type {HTMLSelectElement} */ (g("shape"))?.value
  );
  const operationRaw = /** @type {HTMLSelectElement} */ (g("operation")).value;
  const operation = (shape === ShapeType.FACING ? OperationType.FACING : shape === ShapeType.PATTERNED_HOLES ? OperationType.POCKET : operationRaw);

  const shapeParams = { type: shape };
  if (shape === ShapeType.CIRCLE) {
    shapeParams.diameter = toMm(toNumber(g("circle-diameter").value), displayUnit);
  } else if (shape === ShapeType.SQUARE) {
    shapeParams.size = toMm(toNumber(g("square-size").value), displayUnit);
    const cornerEl = g("rounded-corner-radius");
    shapeParams.cornerRadius = cornerEl ? Math.max(0, toMm(toNumber(cornerEl.value), displayUnit)) : 0;
  } else if (shape === ShapeType.FACING) {
    shapeParams.width = toMm(toNumber(g("rect-width").value), displayUnit);
    shapeParams.height = toMm(toNumber(g("rect-height").value), displayUnit);
    shapeParams.cornerRadius = 0;
  } else if (shape === ShapeType.RECTANGLE) {
    shapeParams.width = toMm(toNumber(g("rect-width").value), displayUnit);
    shapeParams.height = toMm(toNumber(g("rect-height").value), displayUnit);
    const cornerEl = g("rounded-corner-radius");
    shapeParams.cornerRadius = cornerEl ? Math.max(0, toMm(toNumber(cornerEl.value), displayUnit)) : 0;
  } else if (shape === ShapeType.ELLIPSE) {
    shapeParams.major = toMm(toNumber(g("ellipse-major").value), displayUnit);
    shapeParams.minor = toMm(toNumber(g("ellipse-minor").value), displayUnit);
  } else if (shape === ShapeType.HEXAGON) {
    shapeParams.height = toMm(toNumber(g("hexagon-height").value), displayUnit);
  } else if (shape === ShapeType.LETTERS) {
    shapeParams.text = (g("letter-text") && g("letter-text").value) || "";
    shapeParams.fontSize = toMm(toNumber(g("letter-size")?.value) || 10, displayUnit);
    shapeParams.letterOrientation = toNumber(g("letter-orientation")?.value) || 0;
  } else if (shape === ShapeType.COUNTERBORE_BOLT) {
    shapeParams.headDiameter = toMm(toNumber(g("counterbore-head-diameter")?.value), displayUnit);
    shapeParams.counterboreDepth = toMm(toNumber(g("counterbore-depth")?.value), displayUnit);
    shapeParams.boltDiameter = toMm(toNumber(g("counterbore-bolt-diameter")?.value), displayUnit);
    const totalD = toMm(toNumber(g("total-depth").value), displayUnit);
    shapeParams.boltHoleDepth = Number.isFinite(totalD) && Number.isFinite(shapeParams.counterboreDepth)
      ? Math.max(0, totalD - shapeParams.counterboreDepth)
      : 0;
  } else if (shape === ShapeType.THREAD_MILLING) {
    shapeParams.majorDiameter = toMm(toNumber(g("thread-major-diameter")?.value), displayUnit);
    shapeParams.pitch = toMm(toNumber(g("thread-pitch")?.value), displayUnit);
    shapeParams.holeDiameter = toMm(toNumber(g("thread-hole-diameter")?.value), displayUnit);
    shapeParams.threadDepth = toMm(toNumber(g("thread-milling-depth")?.value), displayUnit);
    shapeParams.threadSystem = g("thread-system")?.value || "metric";
    shapeParams.threadPreset = g("thread-preset")?.value || "";
    shapeParams.threadMillType = g("thread-mill-type")?.value || ThreadMillType.INTERNAL;
    shapeParams.threadCutDirection = g("thread-cut-direction")?.value || ThreadCutDirection.BOTTOM_TO_TOP;
    shapeParams.threadHand = g("thread-hand")?.value || ThreadHand.RIGHT;
  } else if (shape === ShapeType.PATTERNED_HOLES) {
    shapeParams.diameter = toMm(toNumber(g("patterned-holes-diameter")?.value), displayUnit);
    shapeParams.spacingX = toMm(toNumber(g("patterned-holes-spacing-x")?.value), displayUnit);
    shapeParams.spacingY = toMm(toNumber(g("patterned-holes-spacing-y")?.value), displayUnit);
    shapeParams.countX = Math.max(1, Math.floor(toNumber(g("patterned-holes-count-x")?.value) || 1));
    shapeParams.countY = Math.max(1, Math.floor(toNumber(g("patterned-holes-count-y")?.value) || 1));
  } else if (shape === ShapeType.CIRCULAR_PATTERN_HOLES) {
    shapeParams.count = Math.max(1, Math.floor(toNumber(g("circular-pattern-holes-count")?.value) || 6));
    shapeParams.diameter = toMm(toNumber(g("circular-pattern-holes-diameter")?.value), displayUnit);
    shapeParams.circleDiameter = toMm(toNumber(g("circular-pattern-holes-circle-diameter")?.value), displayUnit);
    shapeParams.startAngle = Math.max(0, Math.min(360, toNumber(g("circular-pattern-holes-start-angle")?.value) || 0));
    shapeParams.holeInCenter = /** @type {HTMLInputElement} */ (g("circular-pattern-holes-center-hole"))?.checked ?? false;
    shapeParams.centerHoleDiameter = shapeParams.holeInCenter ? toMm(toNumber(g("circular-pattern-holes-center-diameter")?.value), displayUnit) : 0;
  } else if (shape === ShapeType.DXF) {
    shapeParams.type = "dxf";
    shapeParams.dxfOrientation = toNumber(g("dxf-orientation")?.value) || 0;
  }

  const letterMode = shape === ShapeType.LETTERS
    ? (/** @type {HTMLSelectElement} */ (g("letter-mode"))?.value || "outline")
    : "outline";

  const contourType = /** @type {HTMLSelectElement} */ (
    g("contour-type")
  )?.value;

  // Bij letters outline of DXF-gravering: vaste freesdiameter (pad wordt niet geoffset)
  const engravingToolD = getEngravingToolDiameterMm(shape, contourType, letterMode);
  const toolDiameter = engravingToolD != null
    ? engravingToolD
    : toMm(toNumber(g("tool-diameter").value), displayUnit);
  let totalDepth = toMm(toNumber(g("total-depth").value), displayUnit);
  const multipleDepths = /** @type {HTMLInputElement} */ (g("multiple-depths"))?.checked ?? false;
  let stepdown = multipleDepths ? toMm(toNumber(g("stepdown").value), displayUnit) : totalDepth;
  if (shape === ShapeType.COUNTERBORE_BOLT && !multipleDepths) {
    stepdown = totalDepth;
  }
  if (shape === ShapeType.THREAD_MILLING && Number.isFinite(shapeParams.threadDepth)) {
    totalDepth = shapeParams.threadDepth;
    stepdown = totalDepth;
  }
  const isSimpleMode = getDisplayMode() === "simple";

  let stepoverMm;
  if (isSimpleMode) {
    // Simple mode: default stepover is 50%, but for facing we want a coarser default (90%)
    const defaultRatio = shape === ShapeType.FACING ? 0.9 : 0.66;
    stepoverMm = Number.isFinite(toolDiameter) && toolDiameter > 0 ? defaultRatio * toolDiameter : 3;
  } else {
    const stepoverUnit = /** @type {HTMLInputElement} */ (document.querySelector('input[name="stepover-unit"]:checked'))?.value ?? "percent";
    const stepoverEl = /** @type {HTMLInputElement | null} */ (g("stepover"));
    const stepoverValue = stepoverEl ? toNumber(stepoverEl.value) : NaN;
    stepoverMm = stepoverUnit === "percent" && Number.isFinite(toolDiameter) && Number.isFinite(stepoverValue)
      ? (stepoverValue / 100) * toolDiameter
      : stepoverUnit === "mm"
        ? toMm(stepoverValue, displayUnit)
        : NaN;
    if (!Number.isFinite(stepoverMm) || stepoverMm <= 0) {
      const defaultRatio = shape === ShapeType.FACING ? 0.9 : 0.66;
      stepoverMm = Number.isFinite(toolDiameter) && toolDiameter > 0 ? defaultRatio * toolDiameter : 3;
      if (stepoverEl) {
        if (stepoverUnit === "percent") {
          stepoverEl.value = "50";
        } else {
          stepoverEl.value = String(Math.round(fromMm(stepoverMm, displayUnit) * 1000) / 1000);
        }
      }
    }
    stepoverMm = Math.min(stepoverMm, Number.isFinite(toolDiameter) ? toolDiameter : stepoverMm);
  }

  const spindleSpeedEnabled = isSimpleMode ? false : (/** @type {HTMLInputElement} */ (g("spindle-speed-enabled"))?.checked ?? false);
  const spindleSpeed = spindleSpeedEnabled ? toNumber(g("spindle-speed")?.value) : null;
  const mistCoolantEnabled = isSimpleMode ? false : (/** @type {HTMLInputElement} */ (g("mist-coolant-enabled"))?.checked ?? false);
  const floodCoolantEnabled = isSimpleMode ? false : (/** @type {HTMLInputElement} */ (g("flood-coolant-enabled"))?.checked ?? false);
  const mirrorXEnabled = isSimpleMode ? false : (/** @type {HTMLInputElement} */ (g("mirror-x-enabled"))?.checked ?? false);
  const mirrorYEnabled = isSimpleMode ? false : (/** @type {HTMLInputElement} */ (g("mirror-y-enabled"))?.checked ?? false);
  const useArcsEnabled = /** @type {HTMLInputElement} */ (g("use-arcs-enabled"))?.checked ?? false;

  const finishingPassSupported = (operation === OperationType.POCKET || operation === OperationType.CONTOUR)
    && shape !== ShapeType.THREAD_MILLING
    && !isEngravingContourMode(shape, contourType, letterMode);
  const finishingPassEnabled = isSimpleMode
    ? false
    : (finishingPassSupported && ((/** @type {HTMLInputElement} */ (g("finishing-pass-enabled"))?.checked ?? false)));
  const finishingPassDistance = finishingPassEnabled
    ? toMm(toNumber(g("finishing-pass-distance")?.value), displayUnit)
    : 0;
  const finishingPassSpeedOverridePct = finishingPassEnabled
    ? toNumber(g("finishing-pass-speed-override")?.value)
    : 100;
  const finishingPassOverlap = finishingPassEnabled
    ? toMm(toNumber(g("finishing-pass-overlap")?.value), displayUnit)
    : 0;

  const cutParams = {
    toolDiameter,
    totalDepth,
    stepdown,
    stepover: stepoverMm,
    feedrate: toMm(toNumber(g("feedrate").value), displayUnit),
    safeHeight: isSimpleMode ? DEFAULT_SAFE_Z : toMm(toNumber(g("safe-height").value) || DEFAULT_SAFE_Z, displayUnit),
    leadInAboveMm: isSimpleMode ? 2 : toMm(toNumber(g("lead-in-above").value), displayUnit),
    spindleSpeedEnabled,
    spindleSpeed: Number.isFinite(spindleSpeed) && spindleSpeed > 0 ? spindleSpeed : null,
    mistCoolantEnabled,
    floodCoolantEnabled,
    mirrorXEnabled,
    mirrorYEnabled,
    useArcsEnabled,
    finishingPassEnabled,
    finishingPassDistance: Number.isFinite(finishingPassDistance) && finishingPassDistance >= 0 ? finishingPassDistance : 0,
    finishingPassSpeedOverridePct: Number.isFinite(finishingPassSpeedOverridePct) ? Math.max(5, Math.min(200, finishingPassSpeedOverridePct)) : 100,
    finishingPassOverlap: Number.isFinite(finishingPassOverlap) && finishingPassOverlap >= 0 ? finishingPassOverlap : 0,
  };

  const originParams = {
    xyOrigin: /** @type {HTMLSelectElement} */ (g("xy-origin")).value,
    zOrigin: /** @type {HTMLSelectElement} */ (g("z-origin")).value,
    zOffset: isSimpleMode ? 0 : toMm(toNumber(g("z-offset").value) || 0, displayUnit),
    originOffsetX: isSimpleMode ? 0 : toMm(toNumber(g("origin-offset-x")?.value) || 0, displayUnit),
    originOffsetY: isSimpleMode ? 0 : toMm(toNumber(g("origin-offset-y")?.value) || 0, displayUnit),
  };
  const entryMethod = effectiveEntryMethod(
    shape,
    contourType,
    letterMode,
    isSimpleMode ? EntryMethod.PLUNGE : (/** @type {HTMLInputElement} */ (g("entry-method"))?.value)
  );

  const rampAngle = toNumber(g("ramp-angle").value);

  const plungeOutsideRaw = /** @type {HTMLInputElement} */ (g("plunge-outside"))?.value ?? "off";
  const plungeOutside = isSimpleMode ? false : ((operation === OperationType.POCKET || operation === OperationType.FACING || shape === ShapeType.DXF) ? false : plungeOutsideRaw === "on");

  const facingModeRaw = (/** @type {HTMLSelectElement} */ (g("facing-mode")))?.value?.trim?.() ?? "";
  const facingMode = facingModeRaw === "within" ? "within" : "full";
  const facingDirectionRaw = isSimpleMode ? "x" : ((/** @type {HTMLSelectElement} */ (g("facing-direction")))?.value?.trim?.() ?? "");
  const facingDirection = facingDirectionRaw === "y" ? "y" : "x";
  const facingFinishModeRaw = isSimpleMode ? "off" : ((/** @type {HTMLSelectElement} */ (g("facing-finish-mode")))?.value?.trim?.() ?? "");
  const facingFinishMode = facingFinishModeRaw === "cross" || facingFinishModeRaw === "perimeter" ? facingFinishModeRaw : "off";
  const facingEvenSpacing = isSimpleMode ? false : ((/** @type {HTMLInputElement} */ (g("facing-even-spacing")))?.checked ?? false);

  const tabsEnabled = /** @type {HTMLInputElement} */ (
    g("tabs-enabled")
  )?.checked ?? false;
  let tabInterval = toMm(toNumber(g("tab-interval")?.value), displayUnit);
  let tabWidth = toMm(toNumber(g("tab-width")?.value), displayUnit);
  let tabHeight = toMm(toNumber(g("tab-height")?.value), displayUnit);

  // Defaults/fix bij ingeschakelde tabs met lege/ongeldige waarden
  if (tabsEnabled) {
    const tabIntervalEl = /** @type {HTMLInputElement | null} */ (g("tab-interval"));
    const tabWidthEl = /** @type {HTMLInputElement | null} */ (g("tab-width"));
    const tabHeightEl = /** @type {HTMLInputElement | null} */ (g("tab-height"));

    if (!Number.isFinite(tabInterval) || tabInterval <= 0) {
      tabInterval = 40;
      if (tabIntervalEl) tabIntervalEl.value = String(fromMm(40, displayUnit));
    }
    if (!Number.isFinite(tabWidth) || tabWidth <= 0) {
      tabWidth = 8;
      if (tabWidthEl) tabWidthEl.value = String(fromMm(8, displayUnit));
    }
    if (!Number.isFinite(tabHeight) || tabHeight <= 0) {
      tabHeight = 1.0;
      if (tabHeightEl) tabHeightEl.value = String(fromMm(1.0, displayUnit));
    }
  }

  return {
    shape,
    operation,
    shapeParams,
    letterMode,
    contourType: normalizeContourType(contourType),
    facingMode,
    facingDirection,
    facingFinishMode,
    facingEvenSpacing,
    cutParams: {
      ...cutParams,
      entryMethod: entryMethod || EntryMethod.PLUNGE,
      rampAngleMax: rampAngle || 3,
    },
    originParams,
    plungeOutside,
    tabs: {
      enabled: tabsEnabled,
      interval: tabInterval,
      width: tabWidth,
      height: tabHeight,
    },
    dxfSupportHoles: shape === ShapeType.DXF ? readDxfSupportHolesFromForm() : undefined,
  };
}

/**
 * Alleen-lezen snapshot van form voor vergelijking. Wijzigt NOOIT formulierwaarden.
 */
function getParamsSnapshotReadOnly() {
  const g = (id) => document.getElementById(id);
  const el = (id) => /** @type {HTMLInputElement|HTMLSelectElement|null} */ (g(id));
  const displayUnit = getDisplayUnit();
  const isSimple = getDisplayMode() === "simple";

  const opCat = el("operation-type")?.value ?? OperationTypeCategory.SHAPES;
  const shape = resolveEffectiveShape(opCat, el("shape")?.value);
  const opRaw = el("operation")?.value;
  const operation = (shape === ShapeType.FACING ? OperationType.FACING : shape === ShapeType.PATTERNED_HOLES ? OperationType.POCKET : opRaw);

  const sp = { type: shape };
  const v = (id) => toNumber(el(id)?.value);
  const vm = (id) => toMm(v(id), displayUnit);
  if (shape === ShapeType.CIRCLE) sp.diameter = vm("circle-diameter");
  else if (shape === ShapeType.SQUARE) { sp.size = vm("square-size"); sp.cornerRadius = Math.max(0, vm("rounded-corner-radius") || 0); }
  else if (shape === ShapeType.FACING) { sp.width = vm("rect-width"); sp.height = vm("rect-height"); sp.cornerRadius = 0; }
  else if (shape === ShapeType.RECTANGLE) { sp.width = vm("rect-width"); sp.height = vm("rect-height"); sp.cornerRadius = Math.max(0, vm("rounded-corner-radius") || 0); }
  else if (shape === ShapeType.ELLIPSE) { sp.major = vm("ellipse-major"); sp.minor = vm("ellipse-minor"); }
  else if (shape === ShapeType.HEXAGON) sp.height = vm("hexagon-height");
  else if (shape === ShapeType.LETTERS) { sp.text = el("letter-text")?.value || ""; sp.fontSize = vm("letter-size") || 10; sp.letterOrientation = v("letter-orientation") || 0; }
  else if (shape === ShapeType.COUNTERBORE_BOLT) { sp.headDiameter = vm("counterbore-head-diameter"); sp.counterboreDepth = vm("counterbore-depth"); sp.boltDiameter = vm("counterbore-bolt-diameter"); const td = vm("total-depth"); sp.boltHoleDepth = Math.max(0, (td || 0) - (sp.counterboreDepth || 0)); }
  else if (shape === ShapeType.THREAD_MILLING) { sp.majorDiameter = vm("thread-major-diameter"); sp.pitch = vm("thread-pitch"); sp.holeDiameter = vm("thread-hole-diameter"); sp.threadDepth = vm("thread-milling-depth"); sp.threadSystem = el("thread-system")?.value || "metric"; sp.threadPreset = el("thread-preset")?.value || ""; sp.threadMillType = el("thread-mill-type")?.value || ThreadMillType.INTERNAL; sp.threadCutDirection = el("thread-cut-direction")?.value || ThreadCutDirection.BOTTOM_TO_TOP; sp.threadHand = el("thread-hand")?.value || ThreadHand.RIGHT; }
  else if (shape === ShapeType.PATTERNED_HOLES) { sp.diameter = vm("patterned-holes-diameter"); sp.spacingX = vm("patterned-holes-spacing-x"); sp.spacingY = vm("patterned-holes-spacing-y"); sp.countX = Math.max(1, Math.floor(v("patterned-holes-count-x") || 1)); sp.countY = Math.max(1, Math.floor(v("patterned-holes-count-y") || 1)); }
  else if (shape === ShapeType.CIRCULAR_PATTERN_HOLES) { sp.count = Math.max(1, Math.floor(v("circular-pattern-holes-count") || 6)); sp.diameter = vm("circular-pattern-holes-diameter"); sp.circleDiameter = vm("circular-pattern-holes-circle-diameter"); sp.startAngle = Math.max(0, Math.min(360, v("circular-pattern-holes-start-angle") || 0)); sp.holeInCenter = el("circular-pattern-holes-center-hole")?.checked ?? false; sp.centerHoleDiameter = sp.holeInCenter ? vm("circular-pattern-holes-center-diameter") : 0; }
  else if (shape === ShapeType.DXF) { sp.type = "dxf"; sp.dxfOrientation = v("dxf-orientation") || 0; }

  const letterMode = shape === ShapeType.LETTERS ? (el("letter-mode")?.value || "outline") : "outline";
  const contourType = normalizeContourType(el("contour-type")?.value);
  const toolD = (() => {
    const fixed = getEngravingToolDiameterMm(shape, contourType, letterMode);
    return fixed != null ? fixed : vm("tool-diameter");
  })();
  let totalD = vm("total-depth");
  const multDep = el("multiple-depths")?.checked ?? false;
  let stepdown = multDep ? vm("stepdown") : totalD;
  if (shape === ShapeType.COUNTERBORE_BOLT && !multDep) stepdown = totalD;
  if (shape === ShapeType.THREAD_MILLING && Number.isFinite(sp.threadDepth)) { totalD = sp.threadDepth; stepdown = totalD; }

  let stepoverMm;
  if (isSimple) {
    const defaultRatio = shape === ShapeType.FACING ? 0.9 : 0.66;
    stepoverMm = (Number.isFinite(toolD) && toolD > 0 ? defaultRatio * toolD : 3);
  }
  else {
    const unit = document.querySelector('input[name="stepover-unit"]:checked')?.value ?? "percent";
    const sv = v("stepover");
    stepoverMm = unit === "percent" && Number.isFinite(toolD) && Number.isFinite(sv) ? (sv / 100) * toolD : unit === "mm" ? vm("stepover") : NaN;
    if (!Number.isFinite(stepoverMm) || stepoverMm <= 0) {
      const defaultRatio = shape === ShapeType.FACING ? 0.9 : 0.66;
      stepoverMm = Number.isFinite(toolD) && toolD > 0 ? defaultRatio * toolD : 3;
    }
    stepoverMm = Math.min(stepoverMm, Number.isFinite(toolD) ? toolD : stepoverMm);
  }

  const finishingPassSupported = (operation === OperationType.POCKET || operation === OperationType.CONTOUR)
    && shape !== ShapeType.THREAD_MILLING
    && !isEngravingContourMode(shape, contourType, letterMode);
  const finPassEnabled = isSimple ? false : (finishingPassSupported && (el("finishing-pass-enabled")?.checked ?? false));
  const finPassDist = finPassEnabled ? (vm("finishing-pass-distance") || 0) : 0;
  const finPassSpeedOverridePct = finPassEnabled ? (v("finishing-pass-speed-override") || 100) : 100;
  const finPassOverlap = finPassEnabled ? (vm("finishing-pass-overlap") || 0) : 0;

  const cp = {
    toolDiameter: toolD,
    totalDepth: totalD,
    stepdown,
    stepover: stepoverMm,
    feedrate: vm("feedrate"),
    safeHeight: isSimple ? DEFAULT_SAFE_Z : (vm("safe-height") || DEFAULT_SAFE_Z),
    leadInAboveMm: isSimple ? 2 : vm("lead-in-above"),
    spindleSpeedEnabled: isSimple ? false : (el("spindle-speed-enabled")?.checked ?? false),
    spindleSpeed: null,
    mistCoolantEnabled: isSimple ? false : (el("mist-coolant-enabled")?.checked ?? false),
    floodCoolantEnabled: isSimple ? false : (el("flood-coolant-enabled")?.checked ?? false),
    mirrorXEnabled: isSimple ? false : (el("mirror-x-enabled")?.checked ?? false),
    mirrorYEnabled: isSimple ? false : (el("mirror-y-enabled")?.checked ?? false),
    useArcsEnabled: el("use-arcs-enabled")?.checked ?? false,
    finishingPassEnabled: finPassEnabled,
    finishingPassDistance: Number.isFinite(finPassDist) && finPassDist >= 0 ? finPassDist : 0,
    finishingPassSpeedOverridePct: Number.isFinite(finPassSpeedOverridePct) ? Math.max(5, Math.min(200, finPassSpeedOverridePct)) : 100,
    finishingPassOverlap: Number.isFinite(finPassOverlap) && finPassOverlap >= 0 ? finPassOverlap : 0,
  };
  const ss = v("spindle-speed");
  if (cp.spindleSpeedEnabled && Number.isFinite(ss) && ss > 0) cp.spindleSpeed = ss;

  const op = {
    xyOrigin: el("xy-origin")?.value,
    zOrigin: el("z-origin")?.value,
    zOffset: isSimple ? 0 : (vm("z-offset") || 0),
    originOffsetX: isSimple ? 0 : (vm("origin-offset-x") || 0),
    originOffsetY: isSimple ? 0 : (vm("origin-offset-y") || 0),
  };
  const plungeRaw = el("plunge-outside")?.value ?? "off";
  const plunge = isSimple ? false : ((operation === OperationType.POCKET || operation === OperationType.FACING || shape === ShapeType.DXF) ? false : plungeRaw === "on");
  const facing = (el("facing-mode")?.value?.trim?.() ?? "") === "within" ? "within" : "full";
  const facingDir = isSimple ? "x" : ((el("facing-direction")?.value?.trim?.() ?? "") === "y" ? "y" : "x");
  const facingFinishRaw = isSimple ? "off" : (el("facing-finish-mode")?.value?.trim?.() ?? "");
  const facingFinishMode = facingFinishRaw === "cross" || facingFinishRaw === "perimeter" ? facingFinishRaw : "off";
  const facingEven = isSimple ? false : (el("facing-even-spacing")?.checked ?? false);
  const tabsEn = el("tabs-enabled")?.checked ?? false;
  const tabs = { enabled: tabsEn, interval: vm("tab-interval"), width: vm("tab-width"), height: vm("tab-height") };
  const entry = effectiveEntryMethod(shape, contourType, letterMode, isSimple ? EntryMethod.PLUNGE : (el("entry-method")?.value || EntryMethod.PLUNGE));
  const ramp = v("ramp-angle") || 3;

  const snap = { shape, operation, shapeParams: sp, letterMode, contourType, facingMode: facing, facingDirection: facingDir, facingFinishMode, facingEvenSpacing: facingEven, plungeOutside: plunge, cutParams: { ...cp, entryMethod: entry, rampAngleMax: ramp }, originParams: op, tabs };
  if (shape === ShapeType.DXF) {
    const f = el("dxf-file");
    const file = f?.files?.[0];
    snap.dxfFile = file ? { name: file.name, size: file.size, lastModified: file.lastModified } : null;
    snap.dxfSupportHoles = readDxfSupportHolesFromForm();
  }
  return snap;
}

const NUM_TOL = 1e-6;
function paramsSnapshotsEqual(a, b) {
  if (!a || !b) return a === b;
  if (a.shape !== b.shape || a.operation !== b.operation || a.letterMode !== b.letterMode || a.contourType !== b.contourType || a.facingMode !== b.facingMode || a.facingDirection !== b.facingDirection || a.facingFinishMode !== b.facingFinishMode || a.facingEvenSpacing !== b.facingEvenSpacing || a.plungeOutside !== b.plungeOutside) return false;
  function eq(x, y) {
    if (typeof x === "number" && typeof y === "number") return Math.abs(x - y) < NUM_TOL;
    return x === y;
  }
  function objEq(oa, ob) {
    if (oa === ob) return true;
    if (oa == null || ob == null) return false;
    const ka = Object.keys(oa);
    if (ka.length !== Object.keys(ob).length) return false;
    for (const k of ka) {
      const va = oa[k], vb = ob[k];
      if (typeof va === "number" && typeof vb === "number") { if (!eq(va, vb)) return false; }
      else if (typeof va === "object" && va !== null && typeof vb === "object" && vb !== null) { if (!objEq(va, vb)) return false; }
      else if (va !== vb) return false;
    }
    return true;
  }
  if (!objEq(a.shapeParams, b.shapeParams) || !objEq(a.cutParams, b.cutParams) || !objEq(a.originParams, b.originParams) || !objEq(a.tabs, b.tabs)) return false;
  if (a.shape === ShapeType.DXF) {
    const da = a.dxfFile, db = b.dxfFile;
    if (!da !== !db) return false;
    if (da && db && (da.name !== db.name || da.size !== db.size || da.lastModified !== db.lastModified)) return false;
    const sa = a.dxfSupportHoles, sb = b.dxfSupportHoles;
    if (!sa !== !sb) return false;
    if (sa && sb) {
      if (sa.enabled !== sb.enabled || sa.pauseAfter !== sb.pauseAfter) return false;
      if (!eq(sa.diameter, sb.diameter) || !eq(sa.depth ?? NaN, sb.depth ?? NaN)) return false;
      const pa = sa.points || [], pb = sb.points || [];
      if (pa.length !== pb.length) return false;
      for (let i = 0; i < pa.length; i++) {
        if (!eq(pa[i].x, pb[i].x) || !eq(pa[i].y, pb[i].y)) return false;
      }
    }
  }
  return true;
}

function validateInputs(raw) {
  const errors = [];

  const cp = raw.cutParams;
  const sp = raw.shapeParams;

  function assertPositive(value, labelKey) {
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(t("error.positive", { label: t(labelKey) }));
    }
  }

  const isEngravingNoToolD = isEngravingContourMode(raw.shape, raw.contourType, raw.letterMode);
  if (!isEngravingNoToolD) {
    assertPositive(cp.toolDiameter, "field.toolDiameter");
  }
  assertPositive(cp.totalDepth, "field.totalDepth");
  assertPositive(cp.stepdown, "field.stepdown");
  if (!isEngravingNoToolD && raw.shape !== ShapeType.THREAD_MILLING) {
    assertPositive(cp.stepover, "field.stepover");
  }
  assertPositive(cp.feedrate, "field.feedrate");
  assertPositive(cp.safeHeight, "field.safeHeight");
  if (Number.isFinite(cp.leadInAboveMm) && cp.leadInAboveMm < 0) {
    errors.push(t("error.leadInNegative"));
  }

  if (cp.stepdown > cp.totalDepth) {
    errors.push(t("error.stepdownTooBig"));
  }

  if (
    !isEngravingNoToolD &&
    raw.shape !== ShapeType.THREAD_MILLING &&
    Number.isFinite(cp.toolDiameter) &&
    cp.stepover > cp.toolDiameter
  ) {
    errors.push(t("error.stepoverTooBig"));
  }

  if (cp.finishingPassEnabled) {
    if (!Number.isFinite(cp.finishingPassDistance) || cp.finishingPassDistance <= 0) {
      errors.push(t("error.finishingPassDistanceRequired"));
    }
    if (
      !Number.isFinite(cp.finishingPassSpeedOverridePct) ||
      cp.finishingPassSpeedOverridePct < 5 ||
      cp.finishingPassSpeedOverridePct > 200
    ) {
      errors.push(t("error.finishingPassSpeedOverrideRange"));
    }
  }

  if (!isEngravingContourMode(raw.shape, raw.contourType, raw.letterMode) && raw.cutParams.entryMethod === EntryMethod.RAMP) {
    assertPositive(raw.cutParams.rampAngleMax, "field.rampAngle");
  }


  if (raw.operation === OperationType.CONTOUR && raw.tabs?.enabled) {
    assertPositive(raw.tabs.interval, "field.tabInterval");
    assertPositive(raw.tabs.width, "field.tabWidth");
    assertPositive(raw.tabs.height, "field.tabHeight");
  }

  switch (raw.shape) {
    case ShapeType.CIRCLE:
      assertPositive(sp.diameter, "field.diameter");
      break;
    case ShapeType.SQUARE:
      assertPositive(sp.size, "field.side");
      break;
    case ShapeType.RECTANGLE:
    case ShapeType.FACING:
      assertPositive(sp.width, "field.width");
      assertPositive(sp.height, "field.height");
      break;
    case ShapeType.ELLIPSE:
      assertPositive(sp.major, "field.majorAxis");
      assertPositive(sp.minor, "field.minorAxis");
      break;
    case ShapeType.HEXAGON:
      assertPositive(sp.height, "field.hexagonHeight");
      break;
    case ShapeType.LETTERS:
      if (!sp.text || String(sp.text).trim() === "") {
        errors.push(t("error.enterText"));
      }
      assertPositive(sp.fontSize, "field.letterSize");
      break;
    case ShapeType.COUNTERBORE_BOLT: {
      assertPositive(sp.headDiameter, "field.counterboreHeadDiameter");
      assertPositive(sp.counterboreDepth, "field.counterboreDepth");
      assertPositive(sp.boltDiameter, "field.counterboreBoltDiameter");
      const boltHoleDepth = Number.isFinite(cp.totalDepth) && Number.isFinite(sp.counterboreDepth)
        ? cp.totalDepth - sp.counterboreDepth
        : NaN;
      if (Number.isFinite(boltHoleDepth) && boltHoleDepth <= 0) {
        errors.push(t("error.counterboreTotalDepthTooSmall"));
      }
      if (Number.isFinite(sp.headDiameter) && Number.isFinite(sp.boltDiameter) && sp.headDiameter < sp.boltDiameter) {
        errors.push(t("error.counterboreHeadSmallerThanBolt"));
      }
      break;
    }
    case ShapeType.THREAD_MILLING: {
      assertPositive(sp.majorDiameter, "field.threadMajorDiameter");
      assertPositive(sp.pitch, "field.threadPitch");
      assertPositive(sp.holeDiameter, "field.threadHoleDiameter");
      assertPositive(sp.threadDepth, "field.threadMillingDepth");
      break;
    }
    case ShapeType.PATTERNED_HOLES: {
      assertPositive(sp.diameter, "field.patternedHolesDiameter");
      assertPositive(sp.spacingX, "field.patternedHolesSpacingX");
      assertPositive(sp.spacingY, "field.patternedHolesSpacingY");
      if (!Number.isFinite(sp.countX) || sp.countX < 1) {
        errors.push(t("error.positive", { label: t("field.patternedHolesCountX") }));
      }
      if (!Number.isFinite(sp.countY) || sp.countY < 1) {
        errors.push(t("error.positive", { label: t("field.patternedHolesCountY") }));
      }
      break;
    }
    case ShapeType.CIRCULAR_PATTERN_HOLES: {
      assertPositive(sp.diameter, "field.circularPatternHolesDiameter");
      assertPositive(sp.circleDiameter, "field.circularPatternHolesCircleDiameter");
      if (!Number.isFinite(sp.count) || sp.count < 1) {
        errors.push(t("error.positive", { label: t("field.circularPatternHolesCount") }));
      }
      if (sp.holeInCenter) {
        assertPositive(sp.centerHoleDiameter, "field.circularPatternHolesCenterDiameter");
      }
      break;
    }
    case ShapeType.DXF:
      if (!raw.dxfContours || !Array.isArray(raw.dxfContours) || raw.dxfContours.length === 0) {
        errors.push(t("error.dxfNoContours"));
      }
      if (raw.dxfSupportHoles?.enabled) {
        assertPositive(raw.dxfSupportHoles.diameter, "form.dxfSupportHolesDiameter");
        if (!raw.dxfSupportHoles.points?.length) {
          errors.push(t("error.dxfSupportNoPoints"));
        }
      }
      break;
    default:
      errors.push(t("error.unknownShape"));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const toolD = cp.toolDiameter;
  const isPocketOrInsideContour =
    raw.operation === OperationType.POCKET ||
    (raw.operation === OperationType.CONTOUR && raw.contourType === "inside");
  if (
    raw.shape !== ShapeType.LETTERS &&
    raw.shape !== ShapeType.COUNTERBORE_BOLT &&
    raw.shape !== ShapeType.THREAD_MILLING &&
    raw.shape !== ShapeType.DXF &&
    isPocketOrInsideContour &&
    Number.isFinite(toolD) &&
    toolD > 0
  ) {
    const minSize = getShapeMinSize(raw.shape, sp);
    if (Number.isFinite(minSize)) {
      const eps = 1e-6;
      if (minSize + eps < toolD) {
        errors.push(t("error.pocketSmallerThanTool"));
      }
    }
  }
  if (raw.shape === ShapeType.COUNTERBORE_BOLT && Number.isFinite(toolD) && toolD > 0) {
    const eps = 1e-6;
    if (Number.isFinite(sp.headDiameter) && sp.headDiameter + eps < toolD) {
      errors.push(t("error.pocketSmallerThanTool"));
    }
    if (Number.isFinite(sp.boltDiameter) && sp.boltDiameter + eps < toolD) {
      errors.push(t("error.pocketSmallerThanTool"));
    }
  }
  if (raw.shape === ShapeType.THREAD_MILLING && Number.isFinite(toolD) && toolD > 0) {
    const eps = 1e-6;
    const isExternal = sp.threadMillType === ThreadMillType.EXTERNAL;
    if (!isExternal) {
      if (Number.isFinite(sp.holeDiameter) && toolD >= sp.holeDiameter - eps) {
        errors.push(t("error.threadToolLargerThanHole"));
      }
      if (Number.isFinite(sp.majorDiameter) && toolD >= sp.majorDiameter - eps) {
        errors.push(t("error.threadToolTooLarge"));
      }
    }
    const pathRadius = getThreadMillingFinishRadius(
      sp.majorDiameter,
      toolD,
      sp.threadMillType || ThreadMillType.INTERNAL
    );
    if (pathRadius <= eps) {
      errors.push(isExternal ? t("error.threadToolTooLargeExternal") : t("error.threadToolTooLarge"));
    }
  }

  if ((raw.operation === OperationType.FACING || raw.shape === ShapeType.FACING) &&
      Number.isFinite(toolD) &&
      toolD > 0) {
    const w = raw.shape === ShapeType.SQUARE ? sp.size : sp.width;
    const h = raw.shape === ShapeType.SQUARE ? sp.size : sp.height;
    if (Number.isFinite(w) && Number.isFinite(h)) {
      const minDim = Math.min(w, h);
      if (raw.facingMode === "within" && minDim + 1e-6 <= toolD) {
        errors.push(t("error.pocketSmallerThanTool"));
      }
    }
  }

  if ((raw.shape === ShapeType.SQUARE || raw.shape === ShapeType.RECTANGLE) &&
      Number.isFinite(sp.cornerRadius) &&
      sp.cornerRadius > 0) {
    const hw = raw.shape === ShapeType.SQUARE ? sp.size / 2 : sp.width / 2;
    const hh = raw.shape === ShapeType.SQUARE ? sp.size / 2 : sp.height / 2;
    const maxRadius = Math.min(hw, hh);
    if (Number.isFinite(hw) && Number.isFinite(hh) && sp.cornerRadius >= maxRadius - 1e-6) {
      errors.push(t("error.cornerRadiusTooLarge"));
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, params: raw };
}

/**
 * Dieptes per laag bepalen (negatieve Z, uitgaande van Z=0 op stock-oppervlak).
 * stepdown = max. laaghoogte; alle tussenlagen worden even hoog (bijv. diepte 3, max laag 2 → lagen 1.5, 3).
 */
function computeDepthLevels(totalDepth, stepdown) {
  const numLayers = Math.max(1, Math.ceil(totalDepth / stepdown));
  const layerHeight = totalDepth / numLayers;
  const depths = [];
  const roundDepth = (v) => Math.round(v * 1000) / 1000;
  for (let i = 1; i <= numLayers; i++) {
    const z = i === numLayers ? -totalDepth : -i * layerHeight;
    depths.push(-roundDepth(Math.abs(z)));
  }
  return depths;
}

/**
 * Vertices van een platte hexagon (boven- en onderkant horizontaal), gecentreerd op oorsprong.
 * @param {number} height - afstand tussen de 2 horizontale lijnen (mm)
 * @param {number} [scale=1] - schaalfactor (voor offset/rings)
 * @returns {{x:number,y:number}[]}
 */
function getHexagonVertices(height, scale = 1) {
  const scaleFactor = Number.isFinite(scale) ? scale : 1;
  const s = (height / Math.sqrt(3)) * scaleFactor;
  const hh = (height / 2) * scaleFactor;
  return [
    { x: -s / 2, y: hh, z: 0 },
    { x: s / 2, y: hh, z: 0 },
    { x: s, y: 0, z: 0 },
    { x: s / 2, y: -hh, z: 0 },
    { x: -s / 2, y: -hh, z: 0 },
    { x: -s, y: 0, z: 0 },
    { x: -s / 2, y: hh, z: 0 },
  ];
}

/**
 * Punten voor een afgeronde rechthoek (gecentreerd op oorsprong, CCW).
 * @param {number} hw - halve breedte
 * @param {number} hh - halve hoogte
 * @param {number} cornerRadius - straal van de hoeken (0 = scherp)
 * @param {number} [cornerSteps=10] - aantal punten per kwartcirkel
 * @returns {{x:number,y:number,z:number}[]}
 */
function generateRoundedRectPoints(hw, hh, cornerRadius, cornerSteps = 10) {
  const maxR = Math.min(hw, hh);
  const r = Math.max(0, Math.min(cornerRadius || 0, maxR));
  const steps = Math.max(1, Math.floor(cornerSteps));

  if (r <= 0) {
    return [
      { x: -hw, y: -hh, z: 0 },
      { x: hw, y: -hh, z: 0 },
      { x: hw, y: hh, z: 0 },
      { x: -hw, y: hh, z: 0 },
      { x: -hw, y: -hh, z: 0 },
    ];
  }

  const left = -hw;
  const right = hw;
  const bottom = -hh;
  const top = hh;
  const pts = [];

  const edgeLen = Math.max(0, right - left - 2 * r);
  if (edgeLen < 1e-9) {
    const n = segmentsForCircleRadius(maxR);
    const circlePts = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * 2 * Math.PI;
      circlePts.push({ x: maxR * Math.cos(t), y: maxR * Math.sin(t), z: 0 });
    }
    return circlePts;
  }

  // Onderzijde: van (left + r, bottom) naar (right - r, bottom)
  for (let x = left + r; x <= right - r + 1e-6; x += edgeLen / Math.max(steps, 1)) {
    pts.push({ x, y: bottom, z: 0 });
  }
  // Onder-rechts hoek (kwartcirkel)
  const cxBR = right - r;
  const cyBR = bottom + r;
  for (let i = 0; i <= steps; i++) {
    const t = -Math.PI / 2 + (i / steps) * (Math.PI / 2);
    pts.push({ x: cxBR + r * Math.cos(t), y: cyBR + r * Math.sin(t), z: 0 });
  }
  // Rechterzijde
  for (let y = bottom + r; y <= top - r + 1e-6; y += (top - bottom - 2 * r) / Math.max(steps, 1)) {
    pts.push({ x: right, y, z: 0 });
  }
  // Boven-rechts hoek
  const cxTR = right - r;
  const cyTR = top - r;
  for (let i = 0; i <= steps; i++) {
    const t = 0 + (i / steps) * (Math.PI / 2);
    pts.push({ x: cxTR + r * Math.cos(t), y: cyTR + r * Math.sin(t), z: 0 });
  }
  // Bovenzijde
  for (let x = right - r; x >= left + r - 1e-6; x -= (right - left - 2 * r) / Math.max(steps, 1)) {
    pts.push({ x, y: top, z: 0 });
  }
  // Boven-links hoek
  const cxTL = left + r;
  const cyTL = top - r;
  for (let i = 0; i <= steps; i++) {
    const t = Math.PI / 2 + (i / steps) * (Math.PI / 2);
    pts.push({ x: cxTL + r * Math.cos(t), y: cyTL + r * Math.sin(t), z: 0 });
  }
  // Linkerzijde
  for (let y = top - r; y >= bottom + r - 1e-6; y -= (top - bottom - 2 * r) / Math.max(steps, 1)) {
    pts.push({ x: left, y, z: 0 });
  }
  // Onder-links hoek
  const cxBL = left + r;
  const cyBL = bottom + r;
  for (let i = 0; i <= steps; i++) {
    const t = Math.PI + (i / steps) * (Math.PI / 2);
    pts.push({ x: cxBL + r * Math.cos(t), y: cyBL + r * Math.sin(t), z: 0 });
  }
  pts.push(pts[0]);
  return pts;
}

/**
 * Basisvormpaden (XY, Z=0) genereren.
 * Resultaat: array van punten (gesloten polyline) op Z=0.
 */
function generateBasePath(shape, shapeParams, operation) {
  const points = [];

  if (shape === ShapeType.CIRCLE) {
    const radius = shapeParams.diameter / 2;
    const SEGMENTS = segmentsForCircleRadius(radius);
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = (i / SEGMENTS) * 2 * Math.PI;
      points.push({ x: radius * Math.cos(t), y: radius * Math.sin(t), z: 0 });
    }
  } else if (shape === ShapeType.ELLIPSE) {
    const rx = shapeParams.major / 2;
    const ry = shapeParams.minor / 2;
    const SEGMENTS = segmentsForCircleRadius(Math.max(rx, ry));
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = (i / SEGMENTS) * 2 * Math.PI;
      points.push({ x: rx * Math.cos(t), y: ry * Math.sin(t), z: 0 });
    }
  } else if (shape === ShapeType.SQUARE) {
    const half = shapeParams.size / 2;
    const r = Number.isFinite(shapeParams.cornerRadius) ? shapeParams.cornerRadius : 0;
    points.push(...generateRoundedRectPoints(half, half, r));
  } else if (shape === ShapeType.RECTANGLE) {
    const hw = shapeParams.width / 2;
    const hh = shapeParams.height / 2;
    const r = Number.isFinite(shapeParams.cornerRadius) ? shapeParams.cornerRadius : 0;
    points.push(...generateRoundedRectPoints(hw, hh, r));
  } else if (shape === ShapeType.HEXAGON) {
    const verts = getHexagonVertices(shapeParams.height, 1);
    verts.forEach((v) => points.push({ x: v.x, y: v.y, z: 0 }));
  }

  return points;
}

/**
 * Contourpad met freescompensatie: pad ligt op halve freesdiameter van de vorm.
 * @param {string} shape
 * @param {*} shapeParams
 * @param {number} toolRadius
 * @param {boolean} contourInside - true = binnencontour (pad naar binnen), false = buitencontour (pad naar buiten)
 * @returns {{x:number,y:number,z:number}[]}
 */
function generateContourPathWithOffset(shape, shapeParams, toolRadius, contourInside) {
  const offset = contourInside ? -toolRadius : toolRadius;
  const points = [];

  if (shape === ShapeType.CIRCLE) {
    const radius = shapeParams.diameter / 2 + offset;
    if (radius <= 0) return [];
    const SEGMENTS = segmentsForCircleRadius(radius);
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = (i / SEGMENTS) * 2 * Math.PI;
      points.push({ x: radius * Math.cos(t), y: radius * Math.sin(t), z: 0 });
    }
  } else if (shape === ShapeType.ELLIPSE) {
    const rx = shapeParams.major / 2 + offset;
    const ry = shapeParams.minor / 2 + offset;
    if (rx <= 0 || ry <= 0) return [];
    const SEGMENTS = segmentsForCircleRadius(Math.max(rx, ry));
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = (i / SEGMENTS) * 2 * Math.PI;
      points.push({ x: rx * Math.cos(t), y: ry * Math.sin(t), z: 0 });
    }
  } else if (shape === ShapeType.SQUARE) {
    const half = shapeParams.size / 2 + offset;
    if (half <= 0) return [];
    const userR = Number.isFinite(shapeParams.cornerRadius) ? shapeParams.cornerRadius : 0;
    const rEff = contourInside ? Math.max(0, userR + offset) : userR + offset;
    points.push(...generateRoundedRectPoints(half, half, rEff));
  } else if (shape === ShapeType.RECTANGLE) {
    const hw = shapeParams.width / 2 + offset;
    const hh = shapeParams.height / 2 + offset;
    if (hw <= 0 || hh <= 0) return [];
    const userR = Number.isFinite(shapeParams.cornerRadius) ? shapeParams.cornerRadius : 0;
    const rEff = contourInside ? Math.max(0, userR + offset) : userR + offset;
    points.push(...generateRoundedRectPoints(hw, hh, rEff));
  } else if (shape === ShapeType.HEXAGON) {
    const H = shapeParams.height;
    const apothem = H / 2;
    const scale = 1 + (2 * offset) / H;
    if (scale <= 0) return [];
    const verts = getHexagonVertices(H, scale);
    verts.forEach((v) => points.push({ x: v.x, y: v.y, z: 0 }));
  }

  return points;
}

/**
 * Voor vierkant/rechthoek: startpunt van contourpad verplaatsen naar
 * het midden van een zijde (in plaats van een hoek), zodat lead-in
 * netjes tangent op een rechte zijde kan zijn.
 * @param {{x:number,y:number,z:number}[]} path
 */
function adjustRectContourStartToEdgeMid(path) {
  if (!path || path.length < 4) return path;

  // Zoek een hoek met maximale X (rechterzijde).
  let maxX = -Infinity;
  let idx = -1;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (p.x > maxX + 1e-9) {
      maxX = p.x;
      idx = i;
    }
  }
  if (idx < 0) return path;

  const nextIdx = (idx + 1) % path.length;
  const v0 = path[idx];
  const v1 = path[nextIdx];
  const mid = {
    x: (v0.x + v1.x) / 2,
    y: (v0.y + v1.y) / 2,
    z: v0.z,
  };

  const newPath = [];
  newPath.push(mid);
  // vanaf volgende hoek tot einde
  for (let i = nextIdx; i < path.length; i++) {
    newPath.push(path[i]);
  }
  // van begin tot en met gekozen hoek
  for (let i = 0; i <= idx; i++) {
    newPath.push(path[i]);
  }
  // sluiten op mid
  newPath.push(mid);

  return newPath;
}

/**
 * Voor hexagon: startpunt van contourpad verplaatsen naar midden van een zijde (rechterzijde).
 * @param {{x:number,y:number,z:number}[]} path
 */
function adjustHexagonContourStartToEdgeMid(path) {
  if (!path || path.length < 6) return path;

  let maxX = -Infinity;
  let idx = -1;
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i];
    if (p.x > maxX + 1e-9) {
      maxX = p.x;
      idx = i;
    }
  }
  if (idx < 0) return path;

  const nextIdx = (idx + 1) % (path.length - 1);
  const v0 = path[idx];
  const v1 = path[nextIdx];
  const mid = {
    x: (v0.x + v1.x) / 2,
    y: (v0.y + v1.y) / 2,
    z: v0.z,
  };

  const newPath = [];
  newPath.push(mid);
  for (let i = nextIdx; i < path.length - 1; i++) newPath.push(path[i]);
  for (let i = 0; i <= idx; i++) newPath.push(path[i]);
  newPath.push(mid);
  return newPath;
}

/**
 * Punten langs een cubic Bézier die tangent aansluit op beide ringen.
 * P0=from, P3=to; raaklijn bij from = tangentFrom, raaklijn bij to = tangentTo.
 * @param {{x:number,y:number,z?:number}} from - startpunt
 * @param {{x:number,y:number,z?:number}} to - eindpunt
 * @param {{x:number,y:number}} tangentFrom - richting bij from (genormaliseerd of met lengte)
 * @param {{x:number,y:number}} tangentTo - richting bij to (genormaliseerd of met lengte)
 * @param {number} [steps=12] - aantal tussenpunten
 * @param {number} [tangentScale=0.4] - schaal voor raaklijnlengte (fractie van chord)
 * @returns {{x:number,y:number,z:number}[]}
 */
function bezierTangentTransition(from, to, tangentFrom, tangentTo, steps = 12, tangentScale = 0.4) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return [];
  const baseScale = chord * Math.max(0.1, Math.min(1, tangentScale));
  const tfLen = Math.hypot(tangentFrom.x, tangentFrom.y) || 1;
  const ttLen = Math.hypot(tangentTo.x, tangentTo.y) || 1;
  const tFrom = { x: tangentFrom.x / tfLen, y: tangentFrom.y / tfLen };
  const tTo = { x: tangentTo.x / ttLen, y: tangentTo.y / ttLen };
  const perpX = -dy / chord;
  const perpY = dx / chord;
  const dotFrom = tFrom.x * perpX + tFrom.y * perpY;
  const dotTo = tTo.x * perpX + tTo.y * perpY;
  const absFrom = Math.abs(dotFrom);
  const absTo = Math.abs(dotTo);
  let scale1 = baseScale;
  let scale2 = baseScale;
  if (absFrom > 1e-9 && absTo > 1e-9) {
    scale2 = baseScale * absFrom / absTo;
    const maxScale = chord * 1.2;
    if (scale2 > maxScale) {
      scale2 = maxScale;
      scale1 = scale2 * absTo / absFrom;
    } else if (scale1 > maxScale) {
      scale1 = maxScale;
      scale2 = scale1 * absFrom / absTo;
    }
  }
  const p0 = { x: from.x, y: from.y };
  const p3 = { x: to.x, y: to.y };
  const p1 = { x: from.x + tFrom.x * scale1, y: from.y + tFrom.y * scale1 };
  const p2 = { x: to.x - tTo.x * scale2, y: to.y - tTo.y * scale2 };
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
    const y = u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
    pts.push({ x, y, z: (from.z ?? 0) });
  }
  return pts;
}

/**
 * Combineert pocket-ringen tot één pad met rechte lijnen tussen ringen.
 * Snijmove op diepte, geen retract.
 */
function ringsToPathWithCurvedTransitions(rings) {
  if (!rings || rings.length === 0) return [];
  if (rings.length === 1) return rings[0];
  const combined = [];
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    if (!ring || ring.length < 2) continue;
    if (i > 0) {
      const prevEnd = combined[combined.length - 1];
      const nextStart = ring[0];
      combined.push({ x: nextStart.x, y: nextStart.y, z: nextStart.z ?? 0 });
      combined.push(...ring.slice(1));
    } else {
      combined.push(...ring);
    }
  }
  return combined;
}

/**
 * Pocket-paden genereren als reeks van polyline-ringen.
 * Voor een simpele eerste versie gebruiken we offset-ringen:
 * - Cirkel/ellipse: schalen
 * - Vierkant/rechthoek: offsetten van de randen
 */
function generatePocketRings(shape, shapeParams, stepover, toolRadius, outerOffset = 0) {
  const rings = [];

  if (shape === ShapeType.CIRCLE) {
    const maxR = shapeParams.diameter / 2 - toolRadius - outerOffset;
    if (maxR <= 0) return [];
    const SEGMENTS = segmentsForCircleRadius(maxR);
    for (let r = toolRadius; r <= maxR + 1e-6; r += stepover) {
      const pts = [];
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = (i / SEGMENTS) * 2 * Math.PI;
        pts.push({ x: r * Math.cos(t), y: r * Math.sin(t), z: 0 });
      }
      rings.push(pts);
    }
  } else if (shape === ShapeType.ELLIPSE) {
    const rxMax = shapeParams.major / 2 - toolRadius - outerOffset;
    const ryMax = shapeParams.minor / 2 - toolRadius - outerOffset;
    if (rxMax <= 0 || ryMax <= 0) return [];
    const SEGMENTS = segmentsForCircleRadius(Math.max(rxMax, ryMax));
    // gebruik een factor op basis van minimale straal
    const minR = Math.min(rxMax, ryMax);
    for (let d = toolRadius; d <= minR + 1e-6; d += stepover) {
      const scale = d / minR;
      const rx = rxMax * scale;
      const ry = ryMax * scale;
      const pts = [];
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = (i / SEGMENTS) * 2 * Math.PI;
        pts.push({ x: rx * Math.cos(t), y: ry * Math.sin(t), z: 0 });
      }
      rings.push(pts);
    }
  } else if (shape === ShapeType.SQUARE || shape === ShapeType.RECTANGLE) {
    const hw =
      (shape === ShapeType.SQUARE
        ? shapeParams.size
        : shapeParams.width) /
        2 -
      toolRadius - outerOffset;
    const hh =
      (shape === ShapeType.SQUARE
        ? shapeParams.size
        : shapeParams.height) /
        2 -
      toolRadius - outerOffset;
    if (hw <= 0 || hh <= 0) return [];

    const userR = Number.isFinite(shapeParams.cornerRadius) ? shapeParams.cornerRadius : 0;
    const rOuter = Math.max(0, userR - toolRadius);
    const maxOffset = Math.min(hw, hh);
    for (let off = 0; off <= maxOffset + 1e-6; off += stepover) {
      const w = hw - off;
      const h = hh - off;
      if (w <= 0 || h <= 0) break;
      const rEff = Math.max(0, Math.min(rOuter - off, w, h));
      const pts = generateRoundedRectPoints(w, h, rEff);
      rings.push(pts);
    }
  } else if (shape === ShapeType.HEXAGON) {
    const H = shapeParams.height;
    const apothem = H / 2;
    const maxScale = Math.max(0, (apothem - toolRadius - outerOffset) / apothem);
    if (maxScale <= 0) return [];
    for (let scale = maxScale; scale >= 1e-9; scale -= stepover / apothem) {
      if (scale <= 0) break;
      const verts = getHexagonVertices(H, scale);
      const pts = verts.map((v) => ({ x: v.x, y: v.y, z: 0 }));
      rings.push(pts);
    }
  }

  return rings;
}

/**
 * Genereert de nabewerking-contour voor een pocket: één gesloten pad op de werkelijke
 * pocketwand (toolcenter op pocketgrens − toolRadius). Gebruikt voor de nabewerkingslaag
 * na het grof-frezen binnen de outerOffset.
 * Geeft null terug als de pocket te klein is voor de freesdiameter.
 */
function generatePocketFinishingContour(shape, shapeParams, toolRadius) {
  if (shape === ShapeType.CIRCLE) {
    const r = shapeParams.diameter / 2 - toolRadius;
    if (r <= 0) return null;
    const segments = segmentsForCircleRadius(r);
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * 2 * Math.PI;
      pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle), z: 0 });
    }
    return pts;
  } else if (shape === ShapeType.ELLIPSE) {
    const rx = shapeParams.major / 2 - toolRadius;
    const ry = shapeParams.minor / 2 - toolRadius;
    if (rx <= 0 || ry <= 0) return null;
    const segments = segmentsForCircleRadius(Math.max(rx, ry));
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * 2 * Math.PI;
      pts.push({ x: rx * Math.cos(angle), y: ry * Math.sin(angle), z: 0 });
    }
    return pts;
  } else if (shape === ShapeType.SQUARE || shape === ShapeType.RECTANGLE) {
    const hw = (shape === ShapeType.SQUARE ? shapeParams.size : shapeParams.width) / 2 - toolRadius;
    const hh = (shape === ShapeType.SQUARE ? shapeParams.size : shapeParams.height) / 2 - toolRadius;
    if (hw <= 0 || hh <= 0) return null;
    const userR = Number.isFinite(shapeParams.cornerRadius) ? shapeParams.cornerRadius : 0;
    const rEff = Math.max(0, Math.min(userR - toolRadius, hw, hh));
    return generateRoundedRectPoints(hw, hh, rEff);
  } else if (shape === ShapeType.HEXAGON) {
    const apothem = shapeParams.height / 2;
    const scale = Math.max(0, (apothem - toolRadius) / apothem);
    if (scale <= 0) return null;
    const verts = getHexagonVertices(shapeParams.height, scale);
    const pts = verts.map((v) => ({ x: v.x, y: v.y, z: 0 }));
    pts.push({ x: verts[0].x, y: verts[0].y, z: 0 }); // sluiten
    return pts;
  }
  return null;
}

/**
 * Verleng een gesloten contour met overlap vanaf de start van het pad.
 * Zo wordt het beginstuk nogmaals gefreesd voor een betere sluiting.
 * @param {{x:number,y:number,z:number}[]} path
 * @param {number} overlapMm
 * @returns {{x:number,y:number,z:number}[]}
 */
function withClosedPathOverlap(path, overlapMm) {
  if (!Array.isArray(path) || path.length < 2) return path;
  if (!Number.isFinite(overlapMm) || overlapMm <= 0) return path;

  let perimeter = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    const dz = path[i].z - path[i - 1].z;
    perimeter += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  if (perimeter <= 1e-9) return path;

  let remaining = Math.min(overlapMm, perimeter);
  const out = path.map((p) => ({ x: p.x, y: p.y, z: p.z }));

  for (let i = 1; i < path.length && remaining > 1e-9; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (segLen <= 1e-9) continue;

    if (remaining >= segLen - 1e-9) {
      out.push({ x: b.x, y: b.y, z: b.z });
      remaining -= segLen;
    } else {
      const t = remaining / segLen;
      out.push({
        x: a.x + dx * t,
        y: a.y + dy * t,
        z: a.z + dz * t,
      });
      remaining = 0;
    }
  }
  return out;
}

/**
 * Spiraal-pocket voor cirkel: start- en eindcirkel + spiraal ertussen.
 * De buitenste ring ligt op (pocketgrens − toolRadius) zodat de snijkant van de frees
 * precies op de opgegeven diameter komt; de pocket wordt dus niet te groot.
 * Ondersteunt ook pockets kleiner dan 2× freesdiameter (bv. 10mm pocket, 6mm frees).
 */
function generateSpiralPocketCircle(shapeParams, stepover, toolRadius, outerOffset = 0) {
  const pocketBoundaryRadius = shapeParams.diameter / 2; // gewenste rand van de pocket (snijkant)
  const outerRingRadius = pocketBoundaryRadius - toolRadius - outerOffset; // toolcenter op rand: snijkant = boundary
  if (outerRingRadius <= 0) return [];

  const segments = segmentsForCircleRadius(pocketBoundaryRadius);

  // Pocket kleiner dan 2× frees (bv. 10mm pocket, 6mm frees): alleen randcirkel. Start in het
  // midden; spiraal naar de rand (geen rechte lijn) zodat er geen haakse hoek op de rand is.
  if (outerRingRadius < toolRadius) {
    const pts = [];
    pts.push({ x: 0, y: 0, z: 0 }); // start in midden: lead-in blijft in het centrum
    // Spiraal van midden naar rand (één winding)
    const spiralSegments = segments;
    for (let i = 1; i <= spiralSegments; i++) {
      const t = i / spiralSegments;
      const angle = t * 2 * Math.PI;
      const r = t * outerRingRadius;
      pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle), z: 0 });
    }
    // Randcirkel: start bij hoek 2π (waar spiraal eindigt) voor vloeiende aansluiting, geen haakse hoek
    for (let i = 1; i <= segments; i++) {
      const angle = 2 * Math.PI + (i / segments) * 2 * Math.PI;
      pts.push({ x: outerRingRadius * Math.cos(angle), y: outerRingRadius * Math.sin(angle), z: 0 });
    }
    return pts;
  }

  const innerR = toolRadius;
  const outerR = outerRingRadius;
  const radialSpan = outerR - innerR;
  if (radialSpan <= 1e-9) {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * 2 * Math.PI;
      pts.push({ x: outerRingRadius * Math.cos(angle), y: outerRingRadius * Math.sin(angle), z: 0 });
    }
    return pts;
  }

  const pts = [];

  // Start: volledige cirkel op binnenstraal (toolRadius)
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    pts.push({ x: innerR * Math.cos(angle), y: innerR * Math.sin(angle), z: 0 });
  }

  // Midden: spiraal van innerR naar outerR (naar pocketgrens)
  const turns = Math.max(1, Math.ceil(radialSpan / stepover));
  const totalAngle = turns * 2 * Math.PI;
  const steps = Math.max(segments * turns, 1);
  for (let i = 1; i <= steps; i++) {
    const angle = (i / steps) * totalAngle;
    const r = innerR + (radialSpan * i) / steps;
    pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle), z: 0 });
  }

  // Eind: volledige cirkel op buitenstraal (pocketgrens, offset voor freesdikte)
  const endAngleStart = totalAngle;
  for (let i = 1; i <= segments; i++) {
    const angle = endAngleStart + (i / segments) * 2 * Math.PI;
    pts.push({ x: outerR * Math.cos(angle), y: outerR * Math.sin(angle), z: 0 });
  }

  return pts;
}

/**
 * Spiraal-pocket voor ellips: start- en eindellips + spiraal.
 * Buitenellips op (halve as − toolRadius) zodat de snijkant op de opgegeven grens ligt.
 * Bij zeer kleine ellips (kleiner dan 2× frees): alleen één ellips op de grens.
 */
function generateSpiralPocketEllipse(shapeParams, stepover, toolRadius, outerOffset = 0) {
  const rxMax = shapeParams.major / 2 - toolRadius - outerOffset;   // toolcenter: snijkant op major/2
  const ryMax = shapeParams.minor / 2 - toolRadius - outerOffset;  // toolcenter: snijkant op minor/2
  if (rxMax <= 0 || ryMax <= 0) return [];

  const segments = segmentsForCircleRadius(Math.max(rxMax, ryMax));
  const minR = Math.min(rxMax, ryMax);
  const rMin = minR > 0 ? toolRadius / minR : 0;
  const radialSpan = 1 - rMin;

  if (radialSpan <= 1e-9) {
    // Pocket kleiner dan ~2× frees: alleen randellips
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * 2 * Math.PI;
      pts.push({
        x: rxMax * Math.cos(angle),
        y: ryMax * Math.sin(angle),
        z: 0,
      });
    }
    return pts;
  }

  const pts = [];

  // Start: volledige ellips op binnenstraal (r = rMin)
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    pts.push({
      x: rMin * rxMax * Math.cos(angle),
      y: rMin * ryMax * Math.sin(angle),
      z: 0,
    });
  }

  // Midden: spiraal van rMin naar 1
  const turns = Math.max(1, Math.ceil((radialSpan * minR) / stepover));
  const totalAngle = turns * 2 * Math.PI;
  const steps = Math.max(segments * turns, 1);
  for (let i = 1; i <= steps; i++) {
    const angle = (i / steps) * totalAngle;
    const r = rMin + (radialSpan * i) / steps;
    pts.push({
      x: r * rxMax * Math.cos(angle),
      y: r * ryMax * Math.sin(angle),
      z: 0,
    });
  }

  // Eind: volledige ellips op buitenstraal (r = 1)
  const endAngleStart = totalAngle;
  for (let i = 1; i <= segments; i++) {
    const angle = endAngleStart + (i / segments) * 2 * Math.PI;
    pts.push({
      x: rxMax * Math.cos(angle),
      y: ryMax * Math.sin(angle),
      z: 0,
    });
  }

  return pts;
}

/**
 * Spiraal-pocket voor vierkant/rechthoek: spiraal blijft exact dezelfde (buiten → binnen).
 * G-code start in het midden (rode pijl) en volgt hetzelfde pad in omgekeerde richting (naar buiten).
 * Ondersteunt afgeronde hoeken via shapeParams.cornerRadius.
 */
function generateSpiralPocketRectangle(shape, shapeParams, stepover, toolRadius) {
  const hw =
    (shape === ShapeType.SQUARE ? shapeParams.size : shapeParams.width) / 2 - toolRadius;
  const hh =
    (shape === ShapeType.SQUARE ? shapeParams.size : shapeParams.height) / 2 - toolRadius;
  if (hw <= 0 || hh <= 0) return [];

  const userR = Number.isFinite(shapeParams.cornerRadius) ? shapeParams.cornerRadius : 0;
  const rOuter = Math.max(0, userR - toolRadius);
  const cornerSteps = 8;

  const path = [];
  path.push({ x: 0, y: 0, z: 0 });
  path.push({ x: -hw, y: -hh, z: 0 });

  let L = -hw;
  let R = hw;
  let B = -hh;
  let T = hh;
  let k = 0;

  while (L < R - 1e-9 && B < T - 1e-9) {
    const w = R - L;
    const h = T - B;
    const rEff = Math.max(0, Math.min(rOuter - k * stepover, w / 2, h / 2));

    if (rEff <= 0) {
      path.push({ x: R, y: B, z: 0 });
      path.push({ x: R, y: T, z: 0 });
      path.push({ x: L, y: T, z: 0 });
    } else {
      const cxBR = R - rEff;
      const cyBR = B + rEff;
      const cxTR = R - rEff;
      const cyTR = T - rEff;
      const cxTL = L + rEff;
      const cyTL = T - rEff;
      const cxBL = L + rEff;
      const cyBL = B + rEff;
      path.push({ x: L + rEff, y: B, z: 0 });
      path.push({ x: R - rEff, y: B, z: 0 });
      for (let i = 0; i <= cornerSteps; i++) {
        const t = -Math.PI / 2 + (i / cornerSteps) * (Math.PI / 2);
        path.push({ x: cxBR + rEff * Math.cos(t), y: cyBR + rEff * Math.sin(t), z: 0 });
      }
      for (let i = 0; i <= cornerSteps; i++) {
        const t = 0 + (i / cornerSteps) * (Math.PI / 2);
        path.push({ x: cxTR + rEff * Math.cos(t), y: cyTR + rEff * Math.sin(t), z: 0 });
      }
      path.push({ x: L + rEff, y: T, z: 0 });
      for (let i = 0; i <= cornerSteps; i++) {
        const t = Math.PI / 2 + (i / cornerSteps) * (Math.PI / 2);
        path.push({ x: cxTL + rEff * Math.cos(t), y: cyTL + rEff * Math.sin(t), z: 0 });
      }
      path.push({ x: L, y: T - rEff, z: 0 });
      path.push({ x: L, y: B + rEff, z: 0 });
      for (let i = 0; i <= cornerSteps; i++) {
        const t = Math.PI + (i / cornerSteps) * (Math.PI / 2);
        path.push({ x: cxBL + rEff * Math.cos(t), y: cyBL + rEff * Math.sin(t), z: 0 });
      }
      path.push({ x: L + rEff, y: B, z: 0 });
    }

    const hasNextWinding = L + stepover < R - 1e-9 && B + stepover < T - 1e-9;
    if (hasNextWinding) {
      const Ln = L + stepover;
      const Bn = B + stepover;
      const wn = R - stepover - Ln;
      const hn = T - stepover - Bn;
      const rEffNext = Math.max(0, Math.min(rOuter - (k + 1) * stepover, wn / 2, hn / 2));
      path.push({ x: Ln + rEffNext, y: Bn, z: 0 });
    }
    L += stepover;
    R -= stepover;
    B += stepover;
    T -= stepover;
    k += 1;
  }

  const spiralPts = path.slice(2);
  spiralPts.reverse();
  spiralPts.push({ x: -hw, y: -hh, z: 0 });
  spiralPts.push({ x: -hw, y: hh, z: 0 });
  return spiralPts;
}

/**
 * Spiraal-pocket voor hexagon: van midden naar buiten in ringen.
 * Hexagon met platte boven- en onderkant, grootte bepaald door hoogte.
 */
function generateSpiralPocketHexagon(shapeParams, stepover, toolRadius, outerOffset = 0) {
  const H = shapeParams.height;
  const apothem = H / 2;
  const maxScale = Math.max(0, (apothem - toolRadius - outerOffset) / apothem);
  if (maxScale <= 0) {
    throw new Error(t("error.pocketSmallerThanTool"));
  }

  const path = [];
  path.push({ x: 0, y: 0, z: 0 });

  const scaleStep = stepover / apothem;
  let lastVerts = null;
  for (let scale = scaleStep; scale <= maxScale + 1e-9; scale += scaleStep) {
    const s = Math.min(scale, maxScale);
    const verts = getHexagonVertices(H, s);
    lastVerts = verts;
    for (let i = 0; i < 6; i++) {
      path.push({ x: verts[i].x, y: verts[i].y, z: 0 });
    }
  }
  // Buitenste hexagon sluiten: van v5 terug naar v0
  if (lastVerts) {
    path.push({ x: lastVerts[0].x, y: lastVerts[0].y, z: 0 });
  }

  return path;
}

/**
 * X-grenzen voor een horizontale lijn op y binnen een afgeronde rechthoek (hw, hh, r).
 * @param {number} hw
 * @param {number} hh
 * @param {number} r
 * @param {number} y
 * @returns {{xMin:number,xMax:number}}
 */
function roundedRectXBoundsAtY(hw, hh, r, y) {
  if (r <= 0) return { xMin: -hw, xMax: hw };
  if (y >= hh - r && y <= hh) {
    const dy = y - (hh - r);
    const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
    return { xMin: -hw + r - dx, xMax: hw - r + dx };
  }
  if (y >= -hh && y <= -hh + r) {
    const dy = y - (-hh + r);
    const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
    return { xMin: -hw + r - dx, xMax: hw - r + dx };
  }
  return { xMin: -hw, xMax: hw };
}

/**
 * Y-grenzen voor een verticale lijn op x binnen een afgeronde rechthoek (hw, hh, r).
 * @param {number} hw
 * @param {number} hh
 * @param {number} r
 * @param {number} x
 * @returns {{yMin:number,yMax:number}}
 */
function roundedRectYBoundsAtX(hw, hh, r, x) {
  if (r <= 0) return { yMin: -hh, yMax: hh };
  if (x >= hw - r && x <= hw) {
    const dx = x - (hw - r);
    const dy = Math.sqrt(Math.max(0, r * r - dx * dx));
    return { yMin: -hh + r - dy, yMax: hh - r + dy };
  }
  if (x >= -hw && x <= -hw + r) {
    const dx = x - (-hw + r);
    const dy = Math.sqrt(Math.max(0, r * r - dx * dx));
    return { yMin: -hh + r - dy, yMax: hh - r + dy };
  }
  return { yMin: -hh, yMax: hh };
}

/**
 * Normaliseert facing-finish instelling naar een geldige enum-waarde.
 * @param {string} mode
 * @returns {"off"|"cross"|"perimeter"}
 */
function normalizeFacingFinishMode(mode) {
  const normalized = String(mode || "").toLowerCase().trim();
  if (normalized === "cross" || normalized === "perimeter") return normalized;
  return "off";
}

/**
 * Berekent effectieve half-dimensies/radius voor facing rekening houdend met within/full.
 * @param {string} shape
 * @param {{ size?: number, width?: number, height?: number, cornerRadius?: number }} shapeParams
 * @param {number} toolRadius
 * @param {string} facingMode
 * @returns {{ hwEff:number, hhEff:number, rEff:number } | null}
 */
/**
 * Werkelijke stepover bij gelijkmatige facing-verdeling (≤ ingestelde stepover).
 * @param {number} limit - hwEff of hhEff (halve zijde in stepover-richting)
 * @param {number} maxStepover
 * @returns {number|null}
 */
function computeEvenFacingStepover(limit, maxStepover) {
  if (!(Number.isFinite(limit) && limit > 0)) return null;
  if (!(Number.isFinite(maxStepover) && maxStepover > 0)) return null;
  const span = 2 * limit;
  const intervals = Math.max(1, Math.ceil(span / maxStepover));
  return span / intervals;
}

function getFacingEffectiveGeometry(shape, shapeParams, toolRadius, facingMode) {
  const hw = (shape === ShapeType.SQUARE ? shapeParams.size : shapeParams.width) / 2;
  const hh = (shape === ShapeType.SQUARE ? shapeParams.size : shapeParams.height) / 2;
  const r = 0;
  const isWithin = String(facingMode).toLowerCase().trim() === "within";
  const hwEff = isWithin ? hw - toolRadius : hw;
  const hhEff = isWithin ? hh - toolRadius : hh;
  const rEff = Math.max(0, isWithin ? r - toolRadius : r);
  if (hwEff <= 0 || hhEff <= 0) return null;
  return { hwEff, hhEff, rEff };
}

/**
 * Maakt 1 gesloten perimeter-pad voor facing-finish.
 * @param {string} shape
 * @param {{ size?: number, width?: number, height?: number, cornerRadius?: number }} shapeParams
 * @param {number} toolRadius
 * @param {string} facingMode
 * @returns {{x:number,y:number,z:number}[]}
 */
function generateFacingPerimeterPath(shape, shapeParams, toolRadius, facingMode) {
  const geom = getFacingEffectiveGeometry(shape, shapeParams, toolRadius, facingMode);
  if (!geom) return [];
  return generateRoundedRectPoints(geom.hwEff, geom.hhEff, geom.rEff);
}

/**
 * Geeft het laatste punt van de laatste niet-lege path.
 * @param {{x:number,y:number,z:number}[][]} paths
 * @returns {{x:number,y:number,z:number}|null}
 */
function getLastPointFromPaths(paths) {
  if (!paths || !paths.length) return null;
  for (let i = paths.length - 1; i >= 0; i--) {
    const path = paths[i];
    if (path && path.length) return path[path.length - 1];
  }
  return null;
}

/**
 * Oriënteert open paden zodat elk pad start dichtbij het eindpunt van het vorige.
 * @param {{x:number,y:number,z:number}[][]} paths
 * @param {{x:number,y:number,z:number}|null} referencePoint
 * @returns {{x:number,y:number,z:number}[][]}
 */
function orientOpenPathsFromReference(paths, referencePoint) {
  if (!paths || !paths.length || !referencePoint) return paths || [];
  /** @type {{x:number,y:number,z:number}[][]} */
  const oriented = [];
  let prev = referencePoint;
  for (const path of paths) {
    if (!path || path.length < 2) {
      if (path && path.length) {
        oriented.push(path);
        prev = path[path.length - 1];
      }
      continue;
    }
    const first = path[0];
    const last = path[path.length - 1];
    const dFirst = Math.hypot(first.x - prev.x, first.y - prev.y);
    const dLast = Math.hypot(last.x - prev.x, last.y - prev.y);
    if (dLast < dFirst) {
      const reversed = path.slice().reverse();
      oriented.push(reversed);
      prev = reversed[reversed.length - 1];
    } else {
      oriented.push(path);
      prev = path[path.length - 1];
    }
  }
  return oriented;
}

/**
 * Verplaatst startpunt van een gesloten pad naar het punt het dichtst bij referentie.
 * @param {{x:number,y:number,z:number}[]} path
 * @param {{x:number,y:number,z:number}|null} referencePoint
 * @returns {{x:number,y:number,z:number}[]}
 */
function rotateClosedPathStartNear(path, referencePoint) {
  if (!path || path.length < 3 || !referencePoint) return path || [];
  const isClosed = Math.abs(path[0].x - path[path.length - 1].x) < 1e-9 && Math.abs(path[0].y - path[path.length - 1].y) < 1e-9;
  const open = isClosed ? path.slice(0, -1) : path.slice();
  if (open.length < 2) return path;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < open.length; i++) {
    const p = open[i];
    const d = Math.hypot(p.x - referencePoint.x, p.y - referencePoint.y);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  const rotated = open.slice(bestIdx).concat(open.slice(0, bestIdx));
  rotated.push({ ...rotated[0] });
  return rotated;
}

/**
 * Facing-paden: parallelle strips (rechthoekig gebied vlakfrezen).
 * @param {string} shape - ShapeType.SQUARE of RECTANGLE
 * @param {{ size?: number, width?: number, height?: number, cornerRadius?: number }} shapeParams
 * @param {number} stepover
 * @param {number} toolRadius
 * @param {string} facingMode - "within" (tool binnen gebied) of "full" (helemaal bereiken)
 * @param {string} [facingDirection] - "x" (strips langs X, stepover in Y) of "y" (strips langs Y, stepover in X)
 * @param {boolean} [facingEvenSpacing] - true: restafstand gelijkmatig verdelen tussen passes
 * @returns {{x:number,y:number,z:number}[][]}
 */
function generateFacingPaths(shape, shapeParams, stepover, toolRadius, facingMode, facingDirection, facingEvenSpacing) {
  const geom = getFacingEffectiveGeometry(shape, shapeParams, toolRadius, facingMode);
  const dir = String(facingDirection || "x").toLowerCase().trim() === "y" ? "y" : "x";
  const evenSpacing = !!facingEvenSpacing;
  if (!geom) return [];
  const { hwEff, hhEff, rEff } = geom;

  /**
   * Genereert sweep-posities van -limit tot +limit en forceert altijd een eindpass op +limit.
   * Zo blijft er geen reststrook over als stepover niet exact in de breedte/hoogte past.
   * @param {number} limit
   * @param {number} step
   * @returns {number[]}
   */
  function buildSweepPositions(limit, step, distributeEvenly) {
    const positions = [];
    const eps = 1e-9;
    if (!(Number.isFinite(limit) && limit > 0)) return [0];
    if (!(Number.isFinite(step) && step > 0)) return [-limit, limit];
    if (distributeEvenly) {
      const span = 2 * limit;
      const intervals = Math.max(1, Math.ceil(span / step));
      const actualStep = span / intervals;
      for (let i = 0; i <= intervals; i++) {
        positions.push(-limit + i * actualStep);
      }
      return positions;
    }
    let pos = -limit;
    while (pos <= limit + eps) {
      positions.push(pos);
      pos += step;
    }
    if (positions.length === 0) return [-limit, limit];
    const last = positions[positions.length - 1];
    if (Math.abs(last - limit) > eps) {
      positions.push(limit);
    }
    return positions;
  }

  /** @type {{x:number,y:number,z:number}[][]} */
  const paths = [];
  let reverse = false;
  if (dir === "y") {
    const xPositions = buildSweepPositions(hwEff, stepover, evenSpacing);
    for (const x of xPositions) {
      const { yMin, yMax } = roundedRectYBoundsAtX(hwEff, hhEff, rEff, x);
      const strip = reverse
        ? [
            { x, y: yMax, z: 0 },
            { x, y: yMin, z: 0 },
          ]
        : [
            { x, y: yMin, z: 0 },
            { x, y: yMax, z: 0 },
          ];
      paths.push(strip);
      reverse = !reverse;
    }
  } else {
    const yPositions = buildSweepPositions(hhEff, stepover, evenSpacing);
    for (const y of yPositions) {
      const { xMin, xMax } = roundedRectXBoundsAtY(hwEff, hhEff, rEff, y);
      const strip = reverse
        ? [
            { x: xMax, y, z: 0 },
            { x: xMin, y, z: 0 },
          ]
        : [
            { x: xMin, y, z: 0 },
            { x: xMax, y, z: 0 },
          ];
      paths.push(strip);
      reverse = !reverse;
    }
  }
  return paths;
}


/**
 * Berekent een compacte helix-ramp op het strip-startpunt voor facing.
 * Houdt bij modus "within" de helix binnen het effectieve werkvlak.
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number,z:number}[]} path
 * @param {number} toolDiameter
 * @param {{ hw:number, hh:number, within:boolean } | null | undefined} bounds
 * @returns {{ cx:number, cy:number, helixR:number, startAngle:number }}
 */
function computeFacingStripHelixPlacement(start, path, toolDiameter, bounds) {
  const toolR = (toolDiameter || 6) / 2;
  let helixR = Math.max(1.0, Math.min(2.5, toolR * 0.7));

  const dx = path.length >= 2 ? path[1].x - path[0].x : 1;
  const dy = path.length >= 2 ? path[1].y - path[0].y : 0;
  const segLen = Math.hypot(dx, dy);
  const dirX = segLen > 1e-9 ? dx / segLen : 1;
  const dirY = segLen > 1e-9 ? dy / segLen : 0;

  function inwardNormal() {
    let nx = dirX;
    let ny = dirY;
    if (bounds && bounds.within) {
      let tx = -start.x;
      let ty = -start.y;
      const tl = Math.hypot(tx, ty);
      if (tl > 1e-9) {
        tx /= tl;
        ty /= tl;
        nx += tx;
        ny += ty;
      }
      const { hw, hh } = bounds;
      if (Math.abs(start.x + hw) < 1e-4) nx += 1;
      if (Math.abs(start.x - hw) < 1e-4) nx -= 1;
      if (Math.abs(start.y + hh) < 1e-4) ny += 1;
      if (Math.abs(start.y - hh) < 1e-4) ny -= 1;
    }
    const nl = Math.hypot(nx, ny);
    if (nl > 1e-9) return { x: nx / nl, y: ny / nl };
    return { x: dirX, y: dirY };
  }

  function circleFitsRect(cx, cy, R, hw, hh) {
    const eps = 1e-6;
    return cx - R >= -hw - eps && cx + R <= hw + eps && cy - R >= -hh - eps && cy + R <= hh + eps;
  }

  function placementForRadius(R) {
    const n = inwardNormal();
    const cx = start.x + n.x * R;
    const cy = start.y + n.y * R;
    return { cx, cy, startAngle: Math.atan2(start.y - cy, start.x - cx) };
  }

  if (bounds && bounds.within) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const { cx, cy, startAngle } = placementForRadius(helixR);
      if (circleFitsRect(cx, cy, helixR, bounds.hw, bounds.hh)) {
        return { cx, cy, helixR, startAngle };
      }
      helixR *= 0.85;
      if (helixR < 0.8) break;
    }
    helixR = Math.max(0.8, helixR);
    const n = inwardNormal();
    const cx = Math.max(-bounds.hw + helixR, Math.min(bounds.hw - helixR, start.x + n.x * helixR));
    const cy = Math.max(-bounds.hh + helixR, Math.min(bounds.hh - helixR, start.y + n.y * helixR));
    return { cx, cy, helixR, startAngle: Math.atan2(start.y - cy, start.x - cx) };
  }

  const { cx, cy, startAngle } = placementForRadius(helixR);
  return { cx, cy, helixR, startAngle };
}

/**
 * Tab-configuratie langs een gesloten polyline berekenen.
 * Tabs worden om de X mm op de contour geplaatst, met gegeven breedte.
 * @param {{x:number,y:number,z:number}[]} path
 * @param {number} interval
 * @param {number} width
 * @param {number} totalDepth
 * @param {number} tabHeight
 */
function buildTabConfig(path, interval, width, totalDepth, tabHeight) {
  if (!path || path.length < 2 || interval <= 0 || width <= 0 || tabHeight <= 0) {
    return null;
  }

  const cumDist = [0];
  let totalLen = 0;
  for (let i = 1; i < path.length; i++) {
    const d = distance2D(path[i - 1], path[i]);
    totalLen += d;
    cumDist.push(totalLen);
  }
  if (totalLen <= 0) return null;

  const closingLen = path.length >= 2 ? distance2D(path[path.length - 1], path[0]) : 0;
  const totalLengthClosed = totalLen + closingLen;

  /** @type {{start:number,end:number}[]} */
  const ranges = [];
  const halfWidth = width / 2;
  // Tabs gelijkmatig verdelen; (i+0.5)/n voorkomt tabs op s=0 zodat geen wrap/split nodig is
  const n = Math.max(1, Math.round(totalLengthClosed / interval));
  for (let i = 0; i < n; i++) {
    const center = ((i + 0.5) / n) * totalLengthClosed;
    const start = Math.max(0, center - halfWidth);
    const end = Math.min(totalLengthClosed, center + halfWidth);
    if (end > start) ranges.push({ start, end });
  }
  if (!ranges.length) return null;

  // Tab-top t.o.v. totale diepte: er blijft 'tabHeight' materiaal staan
  const cutDepthForTabs = Math.max(0, totalDepth - tabHeight);
  const tabZ = -cutDepthForTabs; // negatief, minder diep dan volledige diepte

  return {
    enabled: true,
    ranges,
    totalLength: totalLen,
    totalLengthClosed,
    cumulative: cumDist,
    tabZ,
    tabWidth: width,
  };
}

/**
 * Berekent Z voor een punt op het pad bij tabs: 25% van tabbreedte ramp omhoog, 50% vlak, 25% ramp omlaag.
 * @param {number} s - cumulatieve afstand langs het pad (mm), binnen [0, totalLengthClosed]
 * @param {number} depthZ - volledige snijdiepte (negatief)
 * @param {{enabled:boolean,ranges:{start:number,end:number}[],tabZ:number,tabWidth:number}|null} tabConfig
 * @returns {number} z-waarde voor dit punt
 */
function getZForTabProfile(s, depthZ, tabConfig) {
  if (!tabConfig || !tabConfig.enabled || depthZ >= tabConfig.tabZ + 1e-6) return depthZ;
  const rampLenMm = 0.25 * (tabConfig.tabWidth || 0);
  if (rampLenMm <= 1e-9) return depthZ;
  for (const r of tabConfig.ranges) {
    if (s < r.start || s > r.end) continue;
    const rangeLen = r.end - r.start;
    const rampLen = Math.min(rampLenMm, rangeLen / 2);
    if (rampLen <= 1e-9) return tabConfig.tabZ;
    const rampUpEnd = r.start + rampLen;
    const rampDownStart = r.end - rampLen;
    if (s <= rampUpEnd) {
      const t = (s - r.start) / rampLen;
      return depthZ + t * (tabConfig.tabZ - depthZ);
    }
    if (s >= rampDownStart) {
      const t = (s - rampDownStart) / rampLen;
      return tabConfig.tabZ + t * (depthZ - tabConfig.tabZ);
    }
    return tabConfig.tabZ;
  }
  return depthZ;
}

/**
 * Geeft alle s-waarden voor een segment (tab-grenzen) zodat 50% vlak echt vlak is en ramps gelijke hoek hebben.
 * @param {number} sStart
 * @param {number} sEnd
 * @param {{enabled:boolean,ranges:{start:number,end:number}[],tabWidth:number}|null} tabConfig
 * @returns {number[]} gesorteerde s-waarden in [sStart, sEnd]
 */
function getTabBoundarySInSegment(sStart, sEnd, tabConfig) {
  const out = [sStart, sEnd];
  if (!tabConfig || !tabConfig.enabled || !tabConfig.ranges.length) return out;
  const rampLenMm = 0.25 * (tabConfig.tabWidth || 0);
  if (rampLenMm <= 1e-9) return out;
  const eps = 1e-9;
  for (const r of tabConfig.ranges) {
    const rangeLen = r.end - r.start;
    const rampLen = Math.min(rampLenMm, rangeLen / 2);
    if (rampLen <= 1e-9) continue;
    const rampUpEnd = r.start + rampLen;
    const rampDownStart = r.end - rampLen;
    for (const bound of [r.start, rampUpEnd, rampDownStart, r.end]) {
      if (bound > sStart + eps && bound < sEnd - eps) out.push(bound);
    }
  }
  out.sort((a, b) => a - b);
  const deduped = [out[0]];
  for (let i = 1; i < out.length; i++) {
    if (out[i] - deduped[deduped.length - 1] > eps) deduped.push(out[i]);
  }
  return deduped;
}

/**
 * Berekent de XY-shift en Z-parameters voor origin-transformatie.
 * @returns {{ shiftX: number, shiftY: number, zOffset: number, zOriginMode: string }}
 */
function computeOriginShift(
  moves,
  originParams,
  totalDepth,
  toolRadiusForXYShift,
  operation,
  contourType,
  facingBounds,
  skipXYShift
) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  moves.forEach((m) => {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
    if (m.x < minX) minX = m.x;
    if (m.y < minY) minY = m.y;
    if (m.x > maxX) maxX = m.x;
    if (m.y > maxY) maxY = m.y;
  });
  let shiftX = 0;
  let shiftY = 0;
  const r = Number.isFinite(toolRadiusForXYShift) ? toolRadiusForXYShift : 0;
  const isFacing = operation === OperationType.FACING && facingBounds;
  const contourOutside = operation === OperationType.CONTOUR && contourType === "outside";
  if (skipXYShift && originParams.xyOrigin !== XYOrigin.CENTER) {
    shiftX = 0;
    shiftY = 0;
  } else if (originParams.xyOrigin === XYOrigin.CENTER && skipXYShift) {
    shiftX = -(minX + maxX) / 2;
    shiftY = -(minY + maxY) / 2;
  } else if (isFacing) {
    switch (originParams.xyOrigin) {
      case XYOrigin.BOTTOM_LEFT: shiftX = facingBounds.hw; shiftY = facingBounds.hh; break;
      case XYOrigin.BOTTOM_RIGHT: shiftX = -facingBounds.hw; shiftY = facingBounds.hh; break;
      case XYOrigin.TOP_LEFT: shiftX = facingBounds.hw; shiftY = -facingBounds.hh; break;
      case XYOrigin.TOP_RIGHT: shiftX = -facingBounds.hw; shiftY = -facingBounds.hh; break;
      case XYOrigin.CENTER: break;
      default: shiftX = facingBounds.hw; shiftY = facingBounds.hh; break;
    }
  } else if (originParams.xyOrigin !== XYOrigin.CENTER) {
    if (contourOutside) {
      switch (originParams.xyOrigin) {
        case XYOrigin.BOTTOM_LEFT: shiftX = -minX - r; shiftY = -minY - r; break;
        case XYOrigin.BOTTOM_RIGHT: shiftX = r - maxX; shiftY = -minY - r; break;
        case XYOrigin.TOP_LEFT: shiftX = -minX - r; shiftY = r - maxY; break;
        case XYOrigin.TOP_RIGHT: shiftX = r - maxX; shiftY = r - maxY; break;
        default: shiftX = -minX - r; shiftY = -minY - r; break;
      }
    } else {
      switch (originParams.xyOrigin) {
        case XYOrigin.BOTTOM_LEFT: shiftX = -minX + r; shiftY = -minY + r; break;
        case XYOrigin.BOTTOM_RIGHT: shiftX = -maxX - r; shiftY = r - minY; break;
        case XYOrigin.TOP_LEFT: shiftX = r - minX; shiftY = -maxY - r; break;
        case XYOrigin.TOP_RIGHT: shiftX = -maxX - r; shiftY = -maxY - r; break;
        default: shiftX = -minX + r; shiftY = -minY + r; break;
      }
    }
  } else {
    shiftX = -(minX + maxX) / 2;
    shiftY = -(minY + maxY) / 2;
  }
  // Positive "offset from origin" moves the toolpath opposite to +X/+Y (e.g. +25 X → 25 mm left).
  const offsetX = Number.isFinite(originParams.originOffsetX) ? originParams.originOffsetX : 0;
  const offsetY = Number.isFinite(originParams.originOffsetY) ? originParams.originOffsetY : 0;
  return {
    shiftX: shiftX - offsetX,
    shiftY: shiftY - offsetY,
    zOffset: originParams.zOffset || 0,
    zOriginMode: originParams.zOrigin || ZOrigin.STOCK_TOP,
  };
}

/**
 * Berekent de bounding box van een array van paden.
 * @param {{x:number,y:number,z?:number}[][]} paths
 * @returns {{ minX: number, maxX: number, minY: number, maxY: number } | null}
 */
function computeBoundsFromPaths(paths) {
  if (!paths || paths.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  paths.forEach((path) => {
    path.forEach((p) => {
      if (Number.isFinite(p.x) && p.x < minX) minX = p.x;
      if (Number.isFinite(p.y) && p.y < minY) minY = p.y;
      if (Number.isFinite(p.x) && p.x > maxX) maxX = p.x;
      if (Number.isFinite(p.y) && p.y > maxY) maxY = p.y;
    });
  });
  if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) return null;
  return { minX, maxX, minY, maxY };
}

/**
 * Past origin-transformatie toe op een array van punten (x,y,z).
 */
function applyOriginTransformToPoints(points, shiftX, shiftY, zOffset, zOriginMode, totalDepth) {
  points.forEach((p) => {
    p.x += shiftX;
    p.y += shiftY;
    let z = p.z;
    if (zOriginMode === ZOrigin.STOCK_BOTTOM) {
      z += totalDepth;
    }
    z += zOffset;
    p.z = z;
  });
}

/**
 * Bepaalt de 2D-contouren van het gefreesde resultaat (vóór origin-transform).
 * @param {*} params - dezelfde params als generateToolpath
 * @returns {{ paths: {x:number,y:number,z:number}[][], totalDepth: number, bottomZ: number } | null}
 */
function getResultShapePathsRaw(params) {
  const { shape, operation, shapeParams, cutParams, originParams, contourType } = params;
  const toolRadius = cutParams.toolDiameter / 2;
  const totalDepth = cutParams.totalDepth;
  const bottomZ = originParams.zOrigin === ZOrigin.STOCK_BOTTOM ? 0 : -totalDepth;

  /** @type {{x:number,y:number,z:number}[][]} */
  const paths = [];

  if (shape === ShapeType.LETTERS) {
    const font = params.letterFont;
    if (!font) return null;
    const letterMode = params.letterMode || "outline";
    let letterPaths = getLetterPathsFromFont(
      shapeParams.text,
      shapeParams.fontSize,
      originParams.xyOrigin,
      font
    );
    const orientationDeg = Number(shapeParams.letterOrientation) || 0;
    if (orientationDeg !== 0) {
      letterPaths = rotatePathsAroundOrigin(letterPaths, orientationDeg);
    }
    if (letterMode === "pocket") {
      const getPts = (path) => {
        if (!path.length) return path;
        const last = path[path.length - 1];
        const first = path[0];
        if (Math.abs(last.x - first.x) < 1e-9 && Math.abs(last.y - first.y) < 1e-9) return path.slice(0, path.length - 1);
        return path;
      };
      const contourIsHole = (path) => polygonSignedArea2(getPts(path)) < 0;
      const minSize = 1.2 * cutParams.toolDiameter;
      for (let i = 0; i < letterPaths.length; i++) {
        const path = letterPaths[i];
        const pts = getPts(path);
        if (pts.length < 3 || contourMinSize(pts) < minSize) continue;
        const isHole = contourIsHole(path);
        const offset = isHole ? -toolRadius : toolRadius;
        const debug = {};
        let inner = contourOffset(path, offset, debug);
        if (!inner && Math.abs(offset) > 1e-6) inner = contourOffset(path, offset * 0.98, debug);
        if (inner && inner.length >= 3) {
          paths.push(path.map((p) => ({ x: p.x, y: p.y, z: 0 })));
        }
      }
    } else {
      letterPaths.forEach((path) => {
        if (path.length >= 2) {
          paths.push(path.map((p) => ({ x: p.x, y: p.y, z: 0 })));
        }
      });
    }
    if (paths.length === 0) return null;
    return { paths, totalDepth, bottomZ };
  }

  if (shape === ShapeType.DXF) {
    const dxfContours = params.dxfContours;
    if (!dxfContours || dxfContours.length === 0) return null;
    if (operation === OperationType.POCKET) {
      const getPts = (path) => {
        if (!path.length) return path;
        const last = path[path.length - 1];
        const first = path[0];
        if (Math.abs(last.x - first.x) < 1e-9 && Math.abs(last.y - first.y) < 1e-9) return path.slice(0, path.length - 1);
        return path;
      };
      const contourIsHole = (path) => polygonSignedArea2(getPts(path)) < 0;
      const minSize = 1.2 * cutParams.toolDiameter;
      for (let i = 0; i < dxfContours.length; i++) {
        const path = dxfContours[i];
        const pts = getPts(path);
        if (pts.length < 3 || contourMinSize(pts) < minSize) continue;
        const isHole = contourIsHole(path);
        const offset = isHole ? -toolRadius : toolRadius;
        const debug = {};
        let inner = contourOffset(path, offset, debug);
        if (!inner && Math.abs(offset) > 1e-6) inner = contourOffset(path, offset * 0.98, debug);
        if (inner && inner.length >= 3) {
          paths.push(path.map((p) => ({ x: p.x, y: p.y, z: 0 })));
        }
      }
    } else {
      dxfContours.forEach((path) => {
        if (path.length >= 2) {
          paths.push(path.map((p) => ({ x: p.x, y: p.y, z: 0 })));
        }
      });
    }
    if (paths.length === 0) return null;
    return { paths, totalDepth, bottomZ };
  }

  if (shape === ShapeType.COUNTERBORE_BOLT) {
    return null;
  }

  if (shape === ShapeType.THREAD_MILLING) {
    const majorR = shapeParams.majorDiameter / 2;
    const majorSegs = segmentsForCircleRadius(majorR);
    const majorPath = [];
    for (let i = 0; i <= majorSegs; i++) {
      const t = (i / majorSegs) * 2 * Math.PI;
      majorPath.push({ x: majorR * Math.cos(t), y: majorR * Math.sin(t), z: 0 });
    }
    const isExternal = shapeParams.threadMillType === ThreadMillType.EXTERNAL;
    if (isExternal) {
      const minorDia = Math.max(0, externalThreadMinorDiameter(shapeParams.majorDiameter, shapeParams.pitch));
      const minorR = minorDia / 2;
      const minorSegs = segmentsForCircleRadius(Math.max(minorR, 1e-6));
      const minorPath = [];
      for (let i = 0; i <= minorSegs; i++) {
        const t = (i / minorSegs) * 2 * Math.PI;
        minorPath.push({ x: minorR * Math.cos(t), y: minorR * Math.sin(t), z: 0 });
      }
      return { paths: [minorPath, majorPath], totalDepth, bottomZ };
    }
    const holeR = shapeParams.holeDiameter / 2;
    const holeSegs = segmentsForCircleRadius(holeR);
    const holePath = [];
    for (let i = 0; i <= holeSegs; i++) {
      const t = (i / holeSegs) * 2 * Math.PI;
      holePath.push({ x: holeR * Math.cos(t), y: holeR * Math.sin(t), z: 0 });
    }
    return { paths: [holePath, majorPath], totalDepth, bottomZ };
  }

  if (shape === ShapeType.PATTERNED_HOLES && operation === OperationType.POCKET) {
    const countX = Math.max(1, shapeParams.countX || 1);
    const countY = Math.max(1, shapeParams.countY || 1);
    const spacingX = shapeParams.spacingX || 96;
    const spacingY = shapeParams.spacingY || 96;
    const r = shapeParams.diameter / 2;
    const segs = segmentsForCircleRadius(r);
    for (let j = 0; j < countY; j++) {
      for (let i = 0; i < countX; i++) {
        const cx = i * spacingX;
        const cy = j * spacingY;
        const pts = [];
        for (let k = 0; k <= segs; k++) {
          const t = (k / segs) * 2 * Math.PI;
          pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t), z: 0 });
        }
        paths.push(pts);
      }
    }
    return { paths, totalDepth, bottomZ };
  }

  if (shape === ShapeType.CIRCULAR_PATTERN_HOLES && (operation === OperationType.POCKET || operation === OperationType.CONTOUR)) {
    const count = Math.max(1, shapeParams.count || 6);
    const circleRadius = (shapeParams.circleDiameter || 80) / 2;
    const holeRadius = (shapeParams.diameter || 10) / 2;
    const startAngleDeg = Math.max(0, Math.min(360, shapeParams.startAngle ?? 0));
    const startAngleRad = Math.PI / 2 - (startAngleDeg * Math.PI / 180);
    const segs = segmentsForCircleRadius(holeRadius);
    for (let i = 0; i < count; i++) {
      const angle = startAngleRad + (2 * Math.PI * i) / count;
      const cx = circleRadius * Math.cos(angle);
      const cy = circleRadius * Math.sin(angle);
      const pts = [];
      for (let k = 0; k <= segs; k++) {
        const t = (k / segs) * 2 * Math.PI;
        pts.push({ x: cx + holeRadius * Math.cos(t), y: cy + holeRadius * Math.sin(t), z: 0 });
      }
      paths.push(pts);
    }
    if (shapeParams.holeInCenter && Number.isFinite(shapeParams.centerHoleDiameter) && shapeParams.centerHoleDiameter > 0) {
      const centerR = shapeParams.centerHoleDiameter / 2;
      const centerSegs = segmentsForCircleRadius(centerR);
      const pts = [];
      for (let k = 0; k <= centerSegs; k++) {
        const t = (k / centerSegs) * 2 * Math.PI;
        pts.push({ x: centerR * Math.cos(t), y: centerR * Math.sin(t), z: 0 });
      }
      paths.push(pts);
    }
    return { paths, totalDepth, bottomZ };
  }

  if (shape === ShapeType.FACING || (operation === OperationType.FACING && (shape === ShapeType.SQUARE || shape === ShapeType.RECTANGLE))) {
    const w = shape === ShapeType.FACING ? shapeParams.width : (shape === ShapeType.SQUARE ? shapeParams.size : shapeParams.width);
    const h = shape === ShapeType.FACING ? shapeParams.height : (shape === ShapeType.SQUARE ? shapeParams.size : shapeParams.height);
    const hw = w / 2;
    const hh = h / 2;
    const r = shape === ShapeType.FACING ? 0 : (Number.isFinite(shapeParams.cornerRadius) ? shapeParams.cornerRadius : 0);
    paths.push(generateRoundedRectPoints(hw, hh, r));
    return { paths, totalDepth, bottomZ };
  }

  if (operation === OperationType.POCKET) {
    const basePath = generateBasePath(shape, shapeParams, operation);
    if (basePath && basePath.length >= 2) {
      paths.push(basePath.map((p) => ({ x: p.x, y: p.y, z: 0 })));
    }
  } else if (operation === OperationType.CONTOUR) {
    // Resultaat = snijrand (vormgrens), niet het toolpad. Toolpad ligt op ±toolRadius van de rand.
    const basePath = generateBasePath(shape, shapeParams, operation);
    if (basePath && basePath.length >= 2) {
      paths.push(basePath.map((p) => ({ x: p.x, y: p.y, z: 0 })));
    }
  }

  if (paths.length === 0) return null;
  return { paths, totalDepth, bottomZ };
}

/**
 * Voeg support-gaten toe aan het toolpath (DXF), vóór de contourbewerking.
 * @param {ToolpathMove[]} moves
 * @param {*} params
 */
function appendDxfSupportHolesMoves(moves, params) {
  const support = params.dxfSupportHoles;
  if (!support?.enabled || !support.points?.length) return;

  const cutParams = params.cutParams;
  const safeZ = cutParams.safeHeight;
  const holeDiameter = support.diameter;
  const holeDepth = Number.isFinite(support.depth) && support.depth > 0 ? support.depth : cutParams.totalDepth;
  const toolRadius = cutParams.toolDiameter / 2;
  const holeDepths = computeDepthLevels(holeDepth, cutParams.stepdown);
  const entryMethod = EntryMethod.PLUNGE;
  const epsSize = 1e-3;
  const equalToToolDiameter = Math.abs(holeDiameter - cutParams.toolDiameter) <= epsSize;

  const sortedPoints = [...support.points].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 1e-6) return a.y - b.y;
    return a.x - b.x;
  });

  const supportStartIdx = moves.length;

  sortedPoints.forEach((pt, idx) => {
    let path;
    let maxHelixRadius;
    if (equalToToolDiameter || holeDiameter <= cutParams.toolDiameter) {
      path = [{ x: pt.x, y: pt.y, z: 0 }];
      maxHelixRadius = undefined;
    } else {
      const holeShapeParams = { diameter: holeDiameter };
      path = generateSpiralPocketCircle(holeShapeParams, cutParams.stepover, toolRadius);
      maxHelixRadius = Math.max(0, holeDiameter / 2 - toolRadius);
      path = path.map((p) => ({ x: p.x + pt.x, y: p.y + pt.y, z: p.z }));
    }

    holeDepths.forEach((depthZ, depthIndex) => {
      addLayerForPath(
        moves,
        path,
        depthZ,
        cutParams,
        false,
        entryMethod,
        supportStartIdx === 0 && idx === 0 && depthIndex === 0,
        safeZ,
        undefined,
        false,
        true,
        toolRadius,
        true,
        maxHelixRadius,
        equalToToolDiameter || holeDiameter <= cutParams.toolDiameter ? pt.x : undefined,
        equalToToolDiameter || holeDiameter <= cutParams.toolDiameter ? pt.y : undefined
      );
    });

    const last = moves[moves.length - 1];
    if (last && last.z < safeZ - 1e-6) {
      moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
    }
  });

  if (support.pauseAfter && moves.length > supportStartIdx) {
    const last = moves[moves.length - 1];
    moves.push({
      x: last?.x ?? 0,
      y: last?.y ?? 0,
      z: safeZ,
      type: "pause",
    });
  }
}

/**
 * Toolpath genereren met lagen, insteek en origin-correctie.
 * @returns {Toolpath}
 */
function generateToolpath(params) {
  const { shape, operation, shapeParams, cutParams, originParams, plungeOutside, contourType, tabs, facingMode, facingDirection } =
    params;
  const toolRadius = cutParams.toolDiameter / 2;
  const minSizeForShape = getShapeMinSize(shape, shapeParams);
  const epsSize = 1e-6;
  const equalToToolDiameter =
    Number.isFinite(minSizeForShape) &&
    Math.abs(minSizeForShape - cutParams.toolDiameter) <= epsSize;

  /** @type {ToolpathMove[]} */
  const moves = [];

  const depths = computeDepthLevels(cutParams.totalDepth, cutParams.stepdown);

  // Lettergravering: outline (omtrek) of pocket (binnenkant uitfrezen)
  if (shape === ShapeType.LETTERS) {
    const font = params.letterFont;
    if (!font) return { moves: [] };
    const letterMode = params.letterMode || "outline";
    let letterPaths = getLetterPathsFromFont(
      shapeParams.text,
      shapeParams.fontSize,
      originParams.xyOrigin,
      font
    );
    const orientationDeg = Number(shapeParams.letterOrientation) || 0;
    if (orientationDeg !== 0) {
      letterPaths = rotatePathsAroundOrigin(letterPaths, orientationDeg);
    }
    const entryMethod = effectiveEntryMethod(shape, params.contourType, params.letterMode, cutParams.entryMethod);
    const safeZ = cutParams.safeHeight;

    if (letterMode === "pocket") {
      // Pocket = start met contour op freesstraal naar binnen (rand waar toolcentrum mag), dan vullen met ringen.
      const getPts = (path) => {
        if (!path.length) return path;
        const last = path[path.length - 1];
        const first = path[0];
        if (Math.abs(last.x - first.x) < 1e-9 && Math.abs(last.y - first.y) < 1e-9) return path.slice(0, path.length - 1);
        return path;
      };
      const contourIsHole = (path) => polygonSignedArea2(getPts(path)) < 0;
      const minSize = 1.2 * cutParams.toolDiameter;

      /** @type {{ roughingBoundary: { x: number, y: number, z: number }[], finishingBoundary: { x: number, y: number, z: number }[] }[]} */
      const pocketable = [];
      let lastFailReason = "";
      const letterFpDist = (cutParams.finishingPassEnabled && cutParams.finishingPassDistance > 0) ? cutParams.finishingPassDistance : 0;
      for (let i = 0; i < letterPaths.length; i++) {
        const path = letterPaths[i];
        const pts = getPts(path);
        if (pts.length < 3 || contourMinSize(pts) < minSize) continue;
        const isHole = contourIsHole(path);
        const offset = isHole ? -toolRadius : toolRadius;
        const debug = {};
        let finishingBoundary = contourOffset(path, offset, debug);
        if (!finishingBoundary && Math.abs(offset) > 1e-6) finishingBoundary = contourOffset(path, offset * 0.98, debug);
        if (!finishingBoundary || finishingBoundary.length < 3) {
          if (debug.failReason) lastFailReason = debug.failReason;
          continue;
        }
        let roughingBoundary = finishingBoundary;
        if (letterFpDist > 0) {
          const roughOffset = isHole ? -letterFpDist : letterFpDist;
          const rb = contourOffset(finishingBoundary, roughOffset);
          if (rb && rb.length >= 3) roughingBoundary = rb;
        }
        pocketable.push({ roughingBoundary, finishingBoundary });
      }
      if (pocketable.length === 0) {
        throw new Error(
          t("error.lettersToolTooBig") + (lastFailReason ? " " + lastFailReason : "")
        );
      }

      depths.forEach((depthZ) => {
        pocketable.forEach(({ roughingBoundary }, idxContour) => {
          const rings = pocketRingsFromInnerContour(roughingBoundary, cutParams.stepover);
          if (!rings.length) return;
          const fromInsideOut = rings.slice().reverse();
          if (idxContour > 0) {
            const last = moves[moves.length - 1];
            if (last && last.z < safeZ - 1e-6) moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
          }
          fromInsideOut.forEach((ring, ringIdx) => {
            addLayerForPath(moves, ring, depthZ, cutParams, plungeOutside && idxContour === 0 && ringIdx === 0, entryMethod, true, safeZ, undefined, true, true, toolRadius);
            const last = moves[moves.length - 1];
            if (last && last.z < safeZ - 1e-6) moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
          });
        });
      });
      // Nabewerkingslaag letters: één contour per letter op de werkelijke pocketgrens, alleen op volledige diepte
      if (letterFpDist > 0 && depths.length > 0) {
        const finalDepth = depths[depths.length - 1];
        pocketable.forEach(({ finishingBoundary }) => {
          if (finishingBoundary.length < 2) return;
          const last = moves[moves.length - 1];
          if (last && last.z < safeZ - 1e-6) moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
          addLayerForPath(moves, finishingBoundary, finalDepth, cutParams, false, entryMethod, true, safeZ, undefined, true, true, toolRadius);
        });
      }
    } else {
      // Outline: omtrek van elke letter volgen
      depths.forEach((depthZ) => {
        letterPaths.forEach((path, idx) => {
          if (idx > 0) {
            const last = moves[moves.length - 1];
            if (last && last.z < safeZ - 1e-6) {
              moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
            }
          }
          addLayerForPath(
            moves,
            path,
            depthZ,
            cutParams,
            plungeOutside && idx === 0,
            entryMethod,
            true,
            safeZ,
            undefined,
            false,
            false,
            0
          );
        });
      });
    }

    if (moves.length > 0) {
      const last = moves[moves.length - 1];
      if (last.z < safeZ - 1e-6) {
        moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
      }
    }
    const resultRaw = getResultShapePathsRaw(params);
    const shift = computeOriginShift(moves, originParams, cutParams.totalDepth, 0, OperationType.POCKET, "inside", undefined, false);
    applyOriginTransform(moves, originParams, cutParams.totalDepth, 0, OperationType.POCKET, "inside");
    // Bij outline: geen preview van gefreesde vorm (alleen wireframe toolpad), geen freesdikte voor dimensies
    if (resultRaw && resultRaw.paths.length > 0 && letterMode !== "outline") {
      resultRaw.paths.forEach((path) => {
        applyOriginTransformToPoints(path, shift.shiftX, shift.shiftY, shift.zOffset, shift.zOriginMode, cutParams.totalDepth);
      });
      const resultBounds = computeBoundsFromPaths(resultRaw.paths);
      return { moves, resultPaths: resultRaw.paths, resultTotalDepth: resultRaw.totalDepth, resultBottomZ: resultRaw.bottomZ, resultContourInside: true, resultBounds, toolDiameter: cutParams.toolDiameter };
    }
    return { moves, toolDiameter: letterMode === "outline" ? 0 : cutParams.toolDiameter };
  }

  // DXF-contouren: contour (uitsnijden) of pocket (uitfrezen),zelfde logica als letters
  if (shape === ShapeType.DXF) {
    const dxfContours = params.dxfContours;
    if (!dxfContours || dxfContours.length === 0) return { moves: [] };
    appendDxfSupportHolesMoves(moves, params);
    const entryMethod = effectiveEntryMethod(shape, params.contourType, params.letterMode, cutParams.entryMethod);
    const safeZ = cutParams.safeHeight;

    if (operation === OperationType.POCKET) {
      if (dxfContours.length > 1) {
        throw new Error(t("error.dxfMultipleContoursPocket"));
      }
      const getPts = (path) => {
        if (!path.length) return path;
        const last = path[path.length - 1];
        const first = path[0];
        if (Math.abs(last.x - first.x) < 1e-9 && Math.abs(last.y - first.y) < 1e-9) return path.slice(0, path.length - 1);
        return path;
      };
      const contourIsHole = (path) => polygonSignedArea2(getPts(path)) < 0;
      const minSize = 1.2 * cutParams.toolDiameter;
      /** @type {{ innerBoundary: { x: number, y: number, z: number }[] }[]} */
      const pocketable = [];
      let lastFailReason = "";
      const dxfFpDist = (cutParams.finishingPassEnabled && cutParams.finishingPassDistance > 0) ? cutParams.finishingPassDistance : 0;
      for (let i = 0; i < dxfContours.length; i++) {
        const path = dxfContours[i];
        const pts = getPts(path);
        if (pts.length < 3 || contourMinSize(pts) < minSize) continue;
        const isHole = contourIsHole(path);
        const offset = isHole ? -toolRadius : toolRadius;
        const debug = {};
        let finishingBoundary = contourOffset(path, offset, debug);
        if (!finishingBoundary && Math.abs(offset) > 1e-6) finishingBoundary = contourOffset(path, offset * 0.98, debug);
        if (!finishingBoundary || finishingBoundary.length < 3) {
          if (debug.failReason) lastFailReason = debug.failReason;
          continue;
        }
        let roughingBoundary = finishingBoundary;
        if (dxfFpDist > 0) {
          // Verschuif de binnengrens verder naar binnen voor de grofbewerking
          const roughOffset = isHole ? -dxfFpDist : dxfFpDist;
          const rb = contourOffset(finishingBoundary, roughOffset);
          if (rb && rb.length >= 3) roughingBoundary = rb;
          // Als de extra offset te groot is (pocket collapst) valt roughingBoundary terug op finishingBoundary
        }
        pocketable.push({ roughingBoundary, finishingBoundary });
      }
      if (pocketable.length === 0) {
        throw new Error(
          t("error.dxfNoPocketableContours") + (lastFailReason ? " " + lastFailReason : "")
        );
      }
      depths.forEach((depthZ) => {
        pocketable.forEach(({ roughingBoundary }, idxContour) => {
          const rings = pocketRingsFromInnerContour(roughingBoundary, cutParams.stepover);
          if (!rings.length) return;
          const fromInsideOut = rings.slice().reverse();
          if (idxContour > 0) {
            const last = moves[moves.length - 1];
            if (last && last.z < safeZ - 1e-6) moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
          }
          fromInsideOut.forEach((ring, ringIdx) => {
            addLayerForPath(moves, ring, depthZ, cutParams, plungeOutside && idxContour === 0 && ringIdx === 0, entryMethod, true, safeZ, undefined, true, true, toolRadius);
            const last = moves[moves.length - 1];
            if (last && last.z < safeZ - 1e-6) moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
          });
        });
      });
      // Nabewerkingslaag DXF: één contour per vormpunt op de werkelijke pocketgrens, alleen op volledige diepte
      if (dxfFpDist > 0 && depths.length > 0) {
        const finalDepth = depths[depths.length - 1];
        pocketable.forEach(({ finishingBoundary }, idxContour) => {
          if (finishingBoundary.length < 2) return;
          const last = moves[moves.length - 1];
          if (last && last.z < safeZ - 1e-6) moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
          addLayerForPath(moves, finishingBoundary, finalDepth, cutParams, false, entryMethod, true, safeZ, undefined, true, true, toolRadius);
        });
      }
    } else {
      let contourPath = null;
      let tabConfig = null;
      const contourType = normalizeContourType(params.contourType);
      if (contourType === "engraving") {
        depths.forEach((depthZ) => {
          dxfContours.forEach((path, idx) => {
            if (!path || path.length < 2) return;
            if (idx > 0) {
              const last = moves[moves.length - 1];
              if (last && last.z < safeZ - 1e-6) moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
            }
            const closed = path.length >= 3 &&
              Math.hypot(path[path.length - 1].x - path[0].x, path[path.length - 1].y - path[0].y) < 1e-6;
            addLayerForPath(
              moves,
              path,
              depthZ,
              cutParams,
              false,
              entryMethod,
              idx === 0,
              safeZ,
              undefined,
              false,
              false,
              0,
              true,
              undefined,
              undefined,
              undefined,
              true,
              false,
              !closed
            );
          });
        });
      } else if (dxfContours.length > 1 && contourType === "inside") {
        throw new Error(t("error.dxfMultipleContoursInside"));
      } else if (dxfContours.length === 1) {
        const path = dxfContours[0];
        const offset = contourType === "inside" ? toolRadius : -toolRadius;
        const debug = {};
        contourPath = contourOffset(path, offset, debug);
        if (!contourPath) {
          const err = new Error(t("error.dxfProcessingFailed"));
          err.dxfProcessingError = true;
          throw err;
        }
        if (tabs && tabs.enabled) {
          tabConfig = buildTabConfig(contourPath, tabs.interval, tabs.width, cutParams.totalDepth, tabs.height);
        }
        depths.forEach((depthZ) => {
          addLayerForPath(moves, contourPath, depthZ, cutParams, plungeOutside, entryMethod, true, safeZ, tabConfig, contourType === "inside", false, toolRadius);
        });
      } else {
        const contoursWithArea = dxfContours.map((path) => {
          const pts = path.length > 0 && path[0].x === path[path.length - 1].x && path[0].y === path[path.length - 1].y ? path.slice(0, -1) : path;
          const area2 = polygonSignedArea2(pts);
          return { path, pts, area2, absArea: Math.abs(area2) };
        });
        const maxAbsArea = Math.max(...contoursWithArea.map((c) => c.absArea));
        // Sorteer: binnencontouren eerst, buitencontour (grootste) als laatste, zodat alle contouren dezelfde tab-logica gebruiken
        contoursWithArea.sort((a, b) => a.absArea - b.absArea);
        depths.forEach((depthZ) => {
          contoursWithArea.forEach(({ path }, idx) => {
            if (idx > 0) {
              const last = moves[moves.length - 1];
              if (last && last.z < safeZ - 1e-6) moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
            }
            const contourInside = contoursWithArea[idx].absArea < maxAbsArea;
            const offset = contourInside ? toolRadius : -toolRadius;
            const debug = {};
            const offsetPath = contourOffset(path, offset, debug);
            if (!offsetPath) {
              const err = new Error(t("error.dxfProcessingFailed"));
              err.dxfProcessingError = true;
              throw err;
            }
            const useTabConfig = tabs && tabs.enabled ? buildTabConfig(offsetPath, tabs.interval, tabs.width, cutParams.totalDepth, tabs.height) : null;
            const allowContinuing = contoursWithArea.length <= 1;
            addLayerForPath(moves, offsetPath, depthZ, cutParams, plungeOutside && idx === 0, entryMethod, idx === 0, safeZ, useTabConfig, contourInside, false, toolRadius, true, undefined, undefined, undefined, allowContinuing);
          });
        });
      }
    }
    if (moves.length > 0) {
      const last = moves[moves.length - 1];
      if (last.z < safeZ - 1e-6) moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
    }
    const resultRaw = getResultShapePathsRaw(params);
    const dxfContourOrigin = operation === OperationType.POCKET
      ? "inside"
      : (normalizeContourType(params.contourType) === "inside" ? "inside" : "outside");
    const shift = computeOriginShift(moves, originParams, cutParams.totalDepth, 0, operation, dxfContourOrigin, undefined, true);
    applyOriginTransform(moves, originParams, cutParams.totalDepth, 0, operation, dxfContourOrigin, undefined, true);
    if (resultRaw && resultRaw.paths.length > 0) {
      resultRaw.paths.forEach((path) => {
        applyOriginTransformToPoints(path, shift.shiftX, shift.shiftY, shift.zOffset, shift.zOriginMode, cutParams.totalDepth);
      });
      const isDxfEngraving = normalizeContourType(params.contourType) === "engraving";
      const resultContourInside = operation === OperationType.POCKET || (operation === OperationType.CONTOUR && params.contourType === "inside");
      const resultBounds = computeBoundsFromPaths(resultRaw.paths);
      return {
        moves,
        resultPaths: resultRaw.paths,
        resultTotalDepth: resultRaw.totalDepth,
        resultBottomZ: resultRaw.bottomZ,
        resultContourInside,
        resultBounds,
        toolDiameter: isDxfEngraving ? 0 : cutParams.toolDiameter,
      };
    }
    const isDxfEngraving = normalizeContourType(params.contourType) === "engraving";
    return { moves, toolDiameter: isDxfEngraving ? 0 : cutParams.toolDiameter };
  }

  // Bout met verzonken kop: eerst verzinking (kop-gat), dan boutgat
  if (shape === ShapeType.COUNTERBORE_BOLT) {
    const headDiameter = shapeParams.headDiameter;
    const counterboreDepth = shapeParams.counterboreDepth;
    const boltDiameter = shapeParams.boltDiameter;
    const boltHoleDepth = shapeParams.boltHoleDepth;
    const safeZ = cutParams.safeHeight;
    const entryMethod = cutParams.entryMethod;
    const toolRadiusPocket = cutParams.toolDiameter / 2;

    const depthsCounterbore = computeDepthLevels(counterboreDepth, cutParams.stepdown);
    const headPath = generateSpiralPocketCircle(
      { diameter: headDiameter },
      cutParams.stepover,
      toolRadiusPocket
    );
    const maxHelixRadiusHead = Math.max(0, headDiameter / 2 - toolRadiusPocket);

    depthsCounterbore.forEach((depthZ, depthIndex) => {
      addLayerForPath(
        moves,
        headPath,
        depthZ,
        cutParams,
        false,
        entryMethod,
        depthIndex === 0,
        safeZ,
        undefined,
        false,
        true,
        toolRadiusPocket,
        true,
        maxHelixRadiusHead,
        0,
        0
      );
    });

    // Naar midden (0,0) op bodem verzinking
    if (moves.length > 0) {
      const last = moves[moves.length - 1];
      if (Math.abs(last.x) > 1e-9 || Math.abs(last.y) > 1e-9 || Math.abs(last.z + counterboreDepth) > 1e-9) {
        moves.push({ x: 0, y: 0, z: -counterboreDepth, type: "cut" });
      }
    }

    const depthsBolt = computeDepthLevels(boltHoleDepth, cutParams.stepdown);
    const boltPath = generateSpiralPocketCircle(
      { diameter: boltDiameter },
      cutParams.stepover,
      toolRadiusPocket
    );
    const maxHelixRadiusBolt = Math.max(0, boltDiameter / 2 - toolRadiusPocket);
    const useRampForBolt = entryMethod === EntryMethod.RAMP && maxHelixRadiusBolt > 1e-6;

    depthsBolt.forEach((depthZRel, depthIndex) => {
      const depthZ = -counterboreDepth + depthZRel;
      if (depthIndex === 0 && useRampForBolt && boltPath.length > 1) {
        // Eerste boutlaag met ramp: helix start op hoogte verzonken gat (-counterboreDepth), niet bovenaan
        const R = Math.max(1e-6, Math.min(toolRadiusPocket, maxHelixRadiusBolt));
        const cx = 0;
        const cy = 0;
        const helixStartX = cx + R;
        const helixStartY = cy;
        const zStart = -counterboreDepth; // start helix op bodem verzinking
        const targetZ = depthZ;
        const start = { x: boltPath[0].x, y: boltPath[0].y };
        const rampAngleRad = degToRad(cutParams.rampAngleMax || 3);
        const maxDepth = Math.abs(targetZ - zStart);
        // Van (0,0,zStart) naar helix-start op dezelfde Z, dan helix omlaag
        moves.push({ x: helixStartX, y: helixStartY, z: zStart, type: "cut" });
        const maxAnglePerMove = degToRad(8);
        const twoPi = 2 * Math.PI;
        const targetAngleNorm = (Math.atan2(start.y - cy, start.x - cx) + twoPi) % twoPi;
        let angle = 0;
        let currentZ = zStart;
        while (currentZ > targetZ - 1e-6) {
          const remainingZ = currentZ - targetZ;
          const segmentDeltaZ = Math.abs(remainingZ) > maxDepth ? -maxDepth : -Math.abs(remainingZ);
          const segmentZ = currentZ + segmentDeltaZ;
          const angleNorm = ((angle % twoPi) + twoPi) % twoPi;
          let angleToTarget = (targetAngleNorm - angleNorm + twoPi) % twoPi;
          if (angleToTarget < 1e-6) angleToTarget = twoPi;
          const isLastSegment = segmentZ <= targetZ + 1e-6;
          let deltaAngleTotal;
          if (isLastSegment) {
            const minAngleForRamp = R > 1e-6 && rampAngleRad > 0 ? Math.abs(targetZ - currentZ) / (R * Math.tan(rampAngleRad)) : 0;
            deltaAngleTotal = angleToTarget + twoPi * Math.ceil(Math.max(0, minAngleForRamp - angleToTarget) / twoPi);
          } else {
            let arcLength = rampAngleRad > 0 ? Math.abs(segmentDeltaZ) / Math.tan(rampAngleRad) : 0;
            if (!isFinite(arcLength) || arcLength <= 0) arcLength = 0;
            deltaAngleTotal = R > 1e-6 ? arcLength / R : 0;
          }
          const numSteps = Math.max(1, Math.ceil(deltaAngleTotal / maxAnglePerMove));
          const deltaAngle = deltaAngleTotal / numSteps;
          const deltaZTotal = isLastSegment ? targetZ - currentZ : segmentDeltaZ;
          const deltaZPerStep = deltaZTotal / numSteps;
          for (let step = 0; step < numSteps; step++) {
            angle += deltaAngle;
            const z = currentZ + deltaZPerStep * (step + 1);
            moves.push({ x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle), z, type: "cut" });
          }
          currentZ = isLastSegment ? targetZ : segmentZ;
          if (currentZ <= targetZ + 1e-6) break;
        }
        if (distance2D({ x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) }, start) > 1e-6) {
          moves.push({ x: start.x, y: start.y, z: depthZ, type: "cut" });
        }
        for (let i = 1; i < boltPath.length; i++) {
          moves.push({ x: boltPath[i].x, y: boltPath[i].y, z: depthZ, type: "cut" });
        }
      } else {
        addLayerForPath(
          moves,
          boltPath,
          depthZ,
          cutParams,
          false,
          entryMethod,
          true,
          safeZ,
          undefined,
          false,
          true,
          toolRadiusPocket,
          true,
          maxHelixRadiusBolt,
          0,
          0
        );
      }
    });

    if (moves.length > 0) {
      const last = moves[moves.length - 1];
      if (last.z < safeZ - 1e-6) {
        moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
      }
    }

    const totalDepth = counterboreDepth + boltHoleDepth;
    const headOutlinePath = [];
    const headR = headDiameter / 2;
    const boltOutlinePath = [];
    const boltR = boltDiameter / 2;
    const headSegs = segmentsForCircleRadius(headR);
    const boltSegs = segmentsForCircleRadius(boltR);
    for (let i = 0; i <= headSegs; i++) {
      const t = (i / headSegs) * 2 * Math.PI;
      headOutlinePath.push({ x: headR * Math.cos(t), y: headR * Math.sin(t), z: 0 });
    }
    for (let i = 0; i <= boltSegs; i++) {
      const t = (i / boltSegs) * 2 * Math.PI;
      boltOutlinePath.push({ x: boltR * Math.cos(t), y: boltR * Math.sin(t), z: 0 });
    }
    const shift = computeOriginShift(moves, originParams, totalDepth, 0, OperationType.POCKET, "inside", undefined, false);
    applyOriginTransform(moves, originParams, totalDepth, 0, OperationType.POCKET, "inside");
    const zOffset = shift.zOffset;
    const zOriginMode = shift.zOriginMode;
    const applyZ = (z) => {
      let out = z;
      if (zOriginMode === ZOrigin.STOCK_BOTTOM) out += totalDepth;
      return out + zOffset;
    };
    [headOutlinePath, boltOutlinePath].forEach((path) => {
      applyOriginTransformToPoints(path, shift.shiftX, shift.shiftY, shift.zOffset, shift.zOriginMode, totalDepth);
    });
    const resultPathsWithDepth = [
      { path: headOutlinePath, topZ: applyZ(0), bottomZ: applyZ(-counterboreDepth) },
      { path: boltOutlinePath, topZ: applyZ(-counterboreDepth), bottomZ: applyZ(-totalDepth) },
    ];
    const resultBounds = computeBoundsFromPaths([headOutlinePath, boltOutlinePath]);
    return { moves, resultPathsWithDepth, resultTotalDepth: totalDepth, resultBottomZ: applyZ(-totalDepth), resultContourInside: true, resultBounds, toolDiameter: cutParams.toolDiameter };
  }

  // Draadfrezen: helicale paden rond draadcentrum (meerdere radiale veiligheidspasses)
  if (shape === ShapeType.THREAD_MILLING) {
    const majorDia = shapeParams.majorDiameter;
    const pitch = shapeParams.pitch;
    const threadDepth = shapeParams.threadDepth;
    const holeDia = shapeParams.holeDiameter;
    const threadMillType = shapeParams.threadMillType || ThreadMillType.INTERNAL;
    const cutBottomToTop = (shapeParams.threadCutDirection || ThreadCutDirection.BOTTOM_TO_TOP)
      !== ThreadCutDirection.TOP_TO_BOTTOM;
    const toolDia = cutParams.toolDiameter;
    const stepover = cutParams.stepover;
    const safeZ = cutParams.safeHeight;
    const leadInAbove = Math.max(0, cutParams.leadInAboveMm ?? 2);
    const helixSign = getThreadMillingHelixSign(
      threadMillType,
      cutBottomToTop,
      shapeParams.threadHand || ThreadHand.RIGHT
    );
    const cx = 0;
    const cy = 0;
    const threadBottomZ = -threadDepth;
    const approachZ = leadInAbove;
    const helixStartZ = cutBottomToTop ? threadBottomZ : approachZ;
    const helixEndZ = cutBottomToTop ? approachZ : threadBottomZ;
    const totalZSpan = Math.abs(helixEndZ - helixStartZ);
    const totalRevolutions = totalZSpan / pitch;
    const totalAngle = totalRevolutions * 2 * Math.PI;

    const rFinish = getThreadMillingFinishRadius(majorDia, toolDia, threadMillType);
    const passRadii = THREAD_MILLING_SPRING_PASSES_ENABLED
      ? computeThreadMillingPassRadii(holeDia, majorDia, toolDia, stepover)
      : (rFinish > 1e-6 ? [rFinish] : []);

    passRadii.forEach((pathRadius, passIdx) => {
      const isFirstPass = passIdx === 0;
      const isLastPass = passIdx === passRadii.length - 1;
      const segs = segmentsForCircleRadius(pathRadius);
      const totalSteps = Math.max(segs, Math.ceil(totalRevolutions * segs));
      const deltaAngle = (helixSign * totalAngle) / totalSteps;
      const deltaZ = (helixEndZ - helixStartZ) / totalSteps;
      const startX = cx + pathRadius;
      const startY = cy;
      const isExternal = threadMillType === ThreadMillType.EXTERNAL;

      if (isExternal) {
        // Buitendraad: centrum is massief — nooit door het midden op snijdiepte.
        if (isFirstPass) {
          moves.push({ x: cx, y: cy, z: safeZ, type: "rapid" });
          if (safeZ > approachZ + 1e-6) {
            moves.push({ x: cx, y: cy, z: approachZ, type: "rapid" });
          }
        }
        const prev = moves[moves.length - 1];
        if (Math.hypot(prev.x - startX, prev.y - startY) > 1e-6 || Math.abs(prev.z - approachZ) > 1e-6) {
          moves.push({ x: startX, y: startY, z: approachZ, type: "rapid" });
        }
        if (cutBottomToTop && Math.abs(approachZ - threadBottomZ) > 1e-6) {
          moves.push({ x: startX, y: startY, z: threadBottomZ, type: "rapid" });
        }
      } else {
        if (isFirstPass) {
          moves.push({ x: cx, y: cy, z: safeZ, type: "rapid" });
          if (safeZ > approachZ + 1e-6) {
            moves.push({ x: cx, y: cy, z: approachZ, type: "rapid" });
          }
        }
        // Binnendraad: insteken via centrum op feed.
        if (cutBottomToTop && Math.abs(approachZ - threadBottomZ) > 1e-6) {
          moves.push({ x: cx, y: cy, z: threadBottomZ, type: "cut" });
        }
        if (Math.abs(startX - cx) > 1e-6 || Math.abs(startY - cy) > 1e-6) {
          moves.push({ x: startX, y: startY, z: helixStartZ, type: "cut" });
        }
      }

      let angle = 0;
      let z = helixStartZ;
      for (let i = 0; i < totalSteps; i++) {
        angle += deltaAngle;
        z += deltaZ;
        moves.push({
          x: cx + pathRadius * Math.cos(angle),
          y: cy + pathRadius * Math.sin(angle),
          z,
          type: "cut",
        });
      }

      const last = moves[moves.length - 1];
      if (isExternal) {
        const lx = last.x;
        const ly = last.y;
        const dist = Math.hypot(lx - cx, ly - cy);
        const retractRadius = pathRadius + toolDia;
        const scale = dist > 1e-6 ? retractRadius / dist : 1;
        const retractX = cx + (lx - cx) * scale;
        const retractY = cy + (ly - cy) * scale;
        if (Math.hypot(lx - retractX, ly - retractY) > 1e-6) {
          moves.push({ x: retractX, y: retractY, z: helixEndZ, type: "rapid" });
        }
        if (!cutBottomToTop && Math.abs(threadBottomZ - approachZ) > 1e-6) {
          moves.push({ x: retractX, y: retractY, z: approachZ, type: "rapid" });
        }
        if (isLastPass && safeZ > approachZ + 1e-6) {
          moves.push({ x: retractX, y: retractY, z: safeZ, type: "rapid" });
        }
      } else {
        // Helix eindigt op de baanradius; eerst radiaal naar draadcentrum op einddiepte (feed).
        if (Math.abs(last.x - cx) > 1e-6 || Math.abs(last.y - cy) > 1e-6) {
          moves.push({ x: cx, y: cy, z: helixEndZ, type: "cut" });
        }
        // Boven→onder: uit op feed rate tot lead-in hoogte (geen rapid uit het gat).
        if (!cutBottomToTop && Math.abs(threadBottomZ - approachZ) > 1e-6) {
          moves.push({ x: cx, y: cy, z: approachZ, type: "cut" });
        }
        if (isLastPass && safeZ > approachZ + 1e-6) {
          moves.push({ x: cx, y: cy, z: safeZ, type: "rapid" });
        }
      }
    });

    const majorR = majorDia / 2;
    const majorOutlinePath = [];
    const majorSegs = segmentsForCircleRadius(majorR);
    for (let i = 0; i <= majorSegs; i++) {
      const t = (i / majorSegs) * 2 * Math.PI;
      majorOutlinePath.push({ x: majorR * Math.cos(t), y: majorR * Math.sin(t), z: 0 });
    }
    const isExternal = threadMillType === ThreadMillType.EXTERNAL;
    let innerOutlinePath;
    if (isExternal) {
      const minorDia = Math.max(0, externalThreadMinorDiameter(majorDia, pitch));
      const minorR = minorDia / 2;
      const minorSegs = segmentsForCircleRadius(Math.max(minorR, 1e-6));
      innerOutlinePath = [];
      for (let i = 0; i <= minorSegs; i++) {
        const t = (i / minorSegs) * 2 * Math.PI;
        innerOutlinePath.push({ x: minorR * Math.cos(t), y: minorR * Math.sin(t), z: 0 });
      }
    } else {
      const holeR = shapeParams.holeDiameter / 2;
      const holeSegs = segmentsForCircleRadius(holeR);
      innerOutlinePath = [];
      for (let i = 0; i <= holeSegs; i++) {
        const t = (i / holeSegs) * 2 * Math.PI;
        innerOutlinePath.push({ x: holeR * Math.cos(t), y: holeR * Math.sin(t), z: 0 });
      }
    }

    const shift = computeOriginShift(moves, originParams, threadDepth, 0, OperationType.POCKET, "inside", undefined, false);
    applyOriginTransform(moves, originParams, threadDepth, 0, OperationType.POCKET, "inside");
    const zOffset = shift.zOffset;
    const zOriginMode = shift.zOriginMode;
    const applyZ = (z) => {
      let out = z;
      if (zOriginMode === ZOrigin.STOCK_BOTTOM) out += threadDepth;
      return out + zOffset;
    };
    [innerOutlinePath, majorOutlinePath].forEach((path) => {
      applyOriginTransformToPoints(path, shift.shiftX, shift.shiftY, shift.zOffset, shift.zOriginMode, threadDepth);
    });
    const resultPathsWithDepth = [
      { path: innerOutlinePath, topZ: applyZ(0), bottomZ: applyZ(-threadDepth) },
      { path: majorOutlinePath, topZ: applyZ(0), bottomZ: applyZ(-threadDepth) },
    ];
    const resultBounds = computeBoundsFromPaths([innerOutlinePath, majorOutlinePath]);
    return { moves, resultPathsWithDepth, resultTotalDepth: threadDepth, resultBottomZ: applyZ(-threadDepth), resultContourInside: !isExternal, resultBounds, toolDiameter: cutParams.toolDiameter };
  }

  // Voor contour: pad met halve freesdiameter offset (binnen- of buitencontour),
  // behalve in het speciale geval "binnencontour exact freesdiameter".
  /** @type {{x:number,y:number,z:number}[][]|null} - meerdere contouren (alleen bij circular pattern holes) */
  let contourPaths = null;
  let contourPath =
    operation === OperationType.CONTOUR
      ? (shape === ShapeType.CIRCULAR_PATTERN_HOLES && contourType === "inside"
          ? (() => {
              const count = Math.max(1, shapeParams.count || 6);
              const circleRadius = (shapeParams.circleDiameter || 80) / 2;
              const startAngleDeg = Math.max(0, Math.min(360, shapeParams.startAngle ?? 0));
              const startAngleRad = Math.PI / 2 - (startAngleDeg * Math.PI / 180);
              const holeParams = { diameter: shapeParams.diameter };
              const singleCircle = generateContourPathWithOffset(ShapeType.CIRCLE, holeParams, toolRadius, true);
              if (!singleCircle || singleCircle.length < 2) return [];
              contourPaths = [];
              for (let i = 0; i < count; i++) {
                const angle = startAngleRad + (2 * Math.PI * i) / count;
                const cx = circleRadius * Math.cos(angle);
                const cy = circleRadius * Math.sin(angle);
                contourPaths.push(singleCircle.map((p) => ({ x: p.x + cx, y: p.y + cy, z: p.z })));
              }
              if (shapeParams.holeInCenter && Number.isFinite(shapeParams.centerHoleDiameter) && shapeParams.centerHoleDiameter > 0) {
                const centerParams = { diameter: shapeParams.centerHoleDiameter };
                const centerCircle = generateContourPathWithOffset(ShapeType.CIRCLE, centerParams, toolRadius, true);
                if (centerCircle && centerCircle.length >= 2) {
                  contourPaths.push(centerCircle.map((p) => ({ x: p.x, y: p.y, z: p.z })));
                }
              }
              return contourPaths[0] || [];
            })()
          : generateContourPathWithOffset(
              shape,
              shapeParams,
              toolRadius,
              contourType === "inside"
            ))
      : generateBasePath(shape, shapeParams, operation);

  // Speciaal geval: binnencontour exact freesdiameter
  if (
    operation === OperationType.CONTOUR &&
    contourType === "inside" &&
    equalToToolDiameter
  ) {
    if (
      shape === ShapeType.CIRCLE ||
      shape === ShapeType.ELLIPSE ||
      shape === ShapeType.SQUARE ||
      shape === ShapeType.HEXAGON
    ) {
      // Cirkels, ellipsen, vierkanten en hexagon: enkel boorgat in het midden
      contourPath = [{ x: 0, y: 0, z: 0 }];
    } else if (shape === ShapeType.RECTANGLE) {
      const w = shapeParams.width;
      const h = shapeParams.height;
      if (Math.abs(w - cutParams.toolDiameter) <= epsSize && Math.abs(h - cutParams.toolDiameter) <= epsSize) {
        contourPath = [{ x: 0, y: 0, z: 0 }];
      } else if (Math.abs(w - cutParams.toolDiameter) <= epsSize) {
        // Breedte = diameter → verticale lijn (langs hoogte)
        const halfLine = Math.max(h / 2 - toolRadius, 0);
        contourPath = [
          { x: 0, y: -halfLine, z: 0 },
          { x: 0, y: halfLine, z: 0 },
        ];
      } else {
        // Hoogte = diameter → horizontale lijn (langs breedte)
        const halfLine = Math.max(w / 2 - toolRadius, 0);
        contourPath = [
          { x: -halfLine, y: 0, z: 0 },
          { x: halfLine, y: 0, z: 0 },
        ];
      }
    }
  }

  // Voor vierkant/rechthoek/hexagon: startpunt van contourpad verplaatsen naar midden van een zijde
  if (
    operation === OperationType.CONTOUR &&
    contourPath &&
    (shape === ShapeType.SQUARE || shape === ShapeType.RECTANGLE) &&
    contourPath.length >= 4
  ) {
    contourPath = adjustRectContourStartToEdgeMid(contourPath);
  } else if (
    operation === OperationType.CONTOUR &&
    contourPath &&
    shape === ShapeType.HEXAGON &&
    contourPath.length >= 6
  ) {
    contourPath = adjustHexagonContourStartToEdgeMid(contourPath);
  }

  // Bewaar de echte eindcontour voor finishing pass.
  const contourFinishingPaths = contourPaths
    ? contourPaths.map((path) => path.map((p) => ({ x: p.x, y: p.y, z: p.z })))
    : null;
  const contourFinishingPath = contourPath
    ? contourPath.map((p) => ({ x: p.x, y: p.y, z: p.z }))
    : null;

  // Bij contour met finishing: roughing met extra offset, finishing op de echte contour.
  const contourFinishingDist = (operation === OperationType.CONTOUR && cutParams.finishingPassEnabled && cutParams.finishingPassDistance > 0)
    ? cutParams.finishingPassDistance
    : 0;
  if (operation === OperationType.CONTOUR && contourFinishingDist > 0) {
    const roughToolRadius = toolRadius + contourFinishingDist;
    if (shape === ShapeType.CIRCULAR_PATTERN_HOLES && contourType === "inside") {
      const count = Math.max(1, shapeParams.count || 6);
      const circleRadius = (shapeParams.circleDiameter || 80) / 2;
      const startAngleDeg = Math.max(0, Math.min(360, shapeParams.startAngle ?? 0));
      const startAngleRad = Math.PI / 2 - (startAngleDeg * Math.PI / 180);
      const holeParams = { diameter: shapeParams.diameter };
      const singleCircle = generateContourPathWithOffset(ShapeType.CIRCLE, holeParams, roughToolRadius, true);
      if (singleCircle && singleCircle.length >= 2) {
        contourPaths = [];
        for (let i = 0; i < count; i++) {
          const angle = startAngleRad + (2 * Math.PI * i) / count;
          const cx = circleRadius * Math.cos(angle);
          const cy = circleRadius * Math.sin(angle);
          contourPaths.push(singleCircle.map((p) => ({ x: p.x + cx, y: p.y + cy, z: p.z })));
        }
        if (shapeParams.holeInCenter && Number.isFinite(shapeParams.centerHoleDiameter) && shapeParams.centerHoleDiameter > 0) {
          const centerParams = { diameter: shapeParams.centerHoleDiameter };
          const centerCircle = generateContourPathWithOffset(ShapeType.CIRCLE, centerParams, roughToolRadius, true);
          if (centerCircle && centerCircle.length >= 2) {
            contourPaths.push(centerCircle.map((p) => ({ x: p.x, y: p.y, z: p.z })));
          }
        }
        contourPath = contourPaths[0] || [];
      }
    } else {
      const roughContourPath = generateContourPathWithOffset(
        shape,
        shapeParams,
        roughToolRadius,
        contourType === "inside"
      );
      if (roughContourPath && roughContourPath.length >= 2) {
        contourPath = roughContourPath;
        if ((shape === ShapeType.SQUARE || shape === ShapeType.RECTANGLE) && contourPath.length >= 4) {
          contourPath = adjustRectContourStartToEdgeMid(contourPath);
        } else if (shape === ShapeType.HEXAGON && contourPath.length >= 6) {
          contourPath = adjustHexagonContourStartToEdgeMid(contourPath);
        }
      }
    }
  }

  // Tabs voorbereiden (alleen contour)
  let tabConfig = null;
  if (operation === OperationType.CONTOUR && tabs && tabs.enabled) {
    tabConfig = buildTabConfig(
      contourPath,
      tabs.interval,
      tabs.width,
      cutParams.totalDepth,
      tabs.height
    );
  }

  // Voor facing: parallelle strips (alleen vierkant/rechthoek)
  /** @type {{x:number,y:number,z:number}[][]} */
  let facingPaths = [];
  /** @type {{ hw:number, hh:number, within:boolean } | null} */
  let facingOpenBounds = null;
  if (shape === ShapeType.FACING || (operation === OperationType.FACING && (shape === ShapeType.SQUARE || shape === ShapeType.RECTANGLE))) {
    const mode = (params.facingMode && String(params.facingMode).toLowerCase().trim() === "within") ? "within" : "full";
    const dir = (params.facingDirection && String(params.facingDirection).toLowerCase().trim() === "y") ? "y" : "x";
    const finishMode = normalizeFacingFinishMode(params.facingFinishMode);
    const even = !!params.facingEvenSpacing;
    const useShape = shape === ShapeType.FACING ? ShapeType.RECTANGLE : shape;
    const useParams = shapeParams;
    const facingGeom = getFacingEffectiveGeometry(useShape, useParams, toolRadius, mode);
    if (facingGeom) {
      facingOpenBounds = { hw: facingGeom.hwEff, hh: facingGeom.hhEff, within: mode === "within" };
    }
    facingPaths = generateFacingPaths(
      useShape,
      useParams,
      cutParams.stepover,
      toolRadius,
      mode,
      dir,
      even
    );
    let phaseEnd = getLastPointFromPaths(facingPaths);
    if (finishMode === "cross") {
      const crossDir = dir === "y" ? "x" : "y";
      let crossPaths = generateFacingPaths(
        useShape,
        useParams,
        cutParams.stepover,
        toolRadius,
        mode,
        crossDir,
        even
      );
      crossPaths = orientOpenPathsFromReference(crossPaths, phaseEnd);
      if (crossPaths.length) facingPaths.push(...crossPaths);
      phaseEnd = getLastPointFromPaths(facingPaths);
    } else if (finishMode === "perimeter") {
      let perimeterPath = generateFacingPerimeterPath(
        useShape,
        useParams,
        toolRadius,
        mode
      );
      perimeterPath = rotateClosedPathStartNear(perimeterPath, phaseEnd);
      if (perimeterPath.length >= 2) facingPaths.push(perimeterPath);
    }
  }

  // Voor pocket: één spiraalpad per vorm (stepover, volledige dekking)
  /** @type {{x:number,y:number,z:number}[][]} */
  let pocketPaths = [];
  if (operation === OperationType.POCKET) {
    if (equalToToolDiameter) {
      // Speciaal geval: pocket precies freesdiameter
      if (shape === ShapeType.PATTERNED_HOLES) {
        const countX = Math.max(1, shapeParams.countX || 1);
        const countY = Math.max(1, shapeParams.countY || 1);
        const spacingX = shapeParams.spacingX || 96;
        const spacingY = shapeParams.spacingY || 96;
        pocketPaths = [];
        for (let j = 0; j < countY; j++) {
          for (let i = 0; i < countX; i++) {
            const cx = i * spacingX;
            const cy = j * spacingY;
            pocketPaths.push([{ x: cx, y: cy, z: 0 }]);
          }
        }
      } else if (
        shape === ShapeType.CIRCLE ||
        shape === ShapeType.ELLIPSE ||
        shape === ShapeType.SQUARE ||
        shape === ShapeType.HEXAGON
      ) {
        // Cirkels, ellipsen, vierkanten en hexagon: enkel "boor"-pad op het midden.
        pocketPaths = [[{ x: 0, y: 0, z: 0 }]];
      } else if (shape === ShapeType.RECTANGLE) {
        const w = shapeParams.width;
        const h = shapeParams.height;
        if (Math.abs(w - cutParams.toolDiameter) <= epsSize && Math.abs(h - cutParams.toolDiameter) <= epsSize) {
          pocketPaths = [[{ x: 0, y: 0, z: 0 }]];
        } else if (Math.abs(w - cutParams.toolDiameter) <= epsSize) {
          const halfLine = Math.max(h / 2 - toolRadius, 0);
          pocketPaths = [[
            { x: 0, y: -halfLine, z: 0 },
            { x: 0, y: halfLine, z: 0 },
          ]];
        } else {
          const halfLine = Math.max(w / 2 - toolRadius, 0);
          pocketPaths = [[
            { x: -halfLine, y: 0, z: 0 },
            { x: halfLine, y: 0, z: 0 },
          ]];
        }
      }
    } else {
      const fpDist = (cutParams.finishingPassEnabled && cutParams.finishingPassDistance > 0) ? cutParams.finishingPassDistance : 0;
      if (shape === ShapeType.CIRCLE) {
        pocketPaths = [generateSpiralPocketCircle(shapeParams, cutParams.stepover, toolRadius, fpDist)];
      } else if (shape === ShapeType.ELLIPSE) {
        pocketPaths = [generateSpiralPocketEllipse(shapeParams, cutParams.stepover, toolRadius, fpDist)];
      } else if (shape === ShapeType.SQUARE || shape === ShapeType.RECTANGLE) {
        const rings = generatePocketRings(shape, shapeParams, cutParams.stepover, toolRadius, fpDist);
        const fromInsideOut = rings.length > 0 ? rings.slice().reverse() : [];
        pocketPaths = fromInsideOut.length > 0 ? [ringsToPathWithCurvedTransitions(fromInsideOut)] : [];
      } else if (shape === ShapeType.HEXAGON) {
        pocketPaths = [generateSpiralPocketHexagon(shapeParams, cutParams.stepover, toolRadius, fpDist)];
      } else if (shape === ShapeType.PATTERNED_HOLES) {
        const countX = Math.max(1, shapeParams.countX || 1);
        const countY = Math.max(1, shapeParams.countY || 1);
        const spacingX = shapeParams.spacingX || 96;
        const spacingY = shapeParams.spacingY || 96;
        const holeShapeParams = { diameter: shapeParams.diameter };
        const singlePath = generateSpiralPocketCircle(holeShapeParams, cutParams.stepover, toolRadius, fpDist);
        pocketPaths = [];
        for (let j = 0; j < countY; j++) {
          for (let i = 0; i < countX; i++) {
            const cx = i * spacingX;
            const cy = j * spacingY;
            const translatedPath = singlePath.map((p) => ({ x: p.x + cx, y: p.y + cy, z: p.z }));
            pocketPaths.push(translatedPath);
          }
        }
      } else if (shape === ShapeType.CIRCULAR_PATTERN_HOLES) {
        const count = Math.max(1, shapeParams.count || 6);
        const circleRadius = (shapeParams.circleDiameter || 80) / 2;
        const startAngleDeg = Math.max(0, Math.min(360, shapeParams.startAngle ?? 0));
        const startAngleRad = Math.PI / 2 - (startAngleDeg * Math.PI / 180);
        const holeShapeParams = { diameter: shapeParams.diameter };
        const singlePath = generateSpiralPocketCircle(holeShapeParams, cutParams.stepover, toolRadius, fpDist);
        pocketPaths = [];
        for (let i = 0; i < count; i++) {
          const angle = startAngleRad + (2 * Math.PI * i) / count;
          const cx = circleRadius * Math.cos(angle);
          const cy = circleRadius * Math.sin(angle);
          const translatedPath = singlePath.map((p) => ({ x: p.x + cx, y: p.y + cy, z: p.z }));
          pocketPaths.push(translatedPath);
        }
        if (shapeParams.holeInCenter && Number.isFinite(shapeParams.centerHoleDiameter) && shapeParams.centerHoleDiameter > 0) {
          const centerHoleParams = { diameter: shapeParams.centerHoleDiameter };
          const centerPath = generateSpiralPocketCircle(centerHoleParams, cutParams.stepover, toolRadius, fpDist);
          pocketPaths.push(centerPath);
        }
      }
    }
  }

  /** @type {{x:number,y:number}[]} - per pocket het midden (alleen bij patterned holes / circular pattern holes) */
  let pocketCenters = [];
  if (shape === ShapeType.PATTERNED_HOLES && operation === OperationType.POCKET) {
    const countX = Math.max(1, shapeParams.countX || 1);
    const countY = Math.max(1, shapeParams.countY || 1);
    const spacingX = shapeParams.spacingX || 96;
    const spacingY = shapeParams.spacingY || 96;
    for (let j = 0; j < countY; j++) {
      for (let i = 0; i < countX; i++) {
        pocketCenters.push({ x: i * spacingX, y: j * spacingY });
      }
    }
  } else if (shape === ShapeType.CIRCULAR_PATTERN_HOLES && (operation === OperationType.POCKET || operation === OperationType.CONTOUR)) {
    const count = Math.max(1, shapeParams.count || 6);
    const circleRadius = (shapeParams.circleDiameter || 80) / 2;
    const startAngleDeg = Math.max(0, Math.min(360, shapeParams.startAngle ?? 0));
    const startAngleRad = Math.PI / 2 - (startAngleDeg * Math.PI / 180);
    for (let i = 0; i < count; i++) {
      const angle = startAngleRad + (2 * Math.PI * i) / count;
      pocketCenters.push({ x: circleRadius * Math.cos(angle), y: circleRadius * Math.sin(angle) });
    }
    if (shapeParams.holeInCenter && Number.isFinite(shapeParams.centerHoleDiameter) && shapeParams.centerHoleDiameter > 0) {
      pocketCenters.push({ x: 0, y: 0 });
    }
  }

  const entryMethod = cutParams.entryMethod;
  const safeZ = cutParams.safeHeight;

  // toolRadiusPocket en maxHelixRadiusPocket hier berekend zodat ze beschikbaar zijn voor
  // zowel de dieptelagen als de nabewerkingslaag achteraf.
  const toolRadiusPocket = cutParams.toolDiameter / 2;
  let maxHelixRadiusPocket = undefined;
  if (operation === OperationType.POCKET) {
    if (shape === ShapeType.CIRCLE || shape === ShapeType.PATTERNED_HOLES || shape === ShapeType.CIRCULAR_PATTERN_HOLES) {
      maxHelixRadiusPocket = Math.max(0, (shapeParams.diameter / 2) - toolRadiusPocket);
    } else if (shape === ShapeType.ELLIPSE) {
      const rx = (shapeParams.major || 0) / 2 - toolRadiusPocket;
      const ry = (shapeParams.minor || 0) / 2 - toolRadiusPocket;
      maxHelixRadiusPocket = Math.max(0, Math.min(rx, ry));
    } else if (shape === ShapeType.SQUARE || shape === ShapeType.RECTANGLE) {
      const hw = (shape === ShapeType.SQUARE ? shapeParams.size : shapeParams.width) / 2 - toolRadiusPocket;
      const hh = (shape === ShapeType.SQUARE ? shapeParams.size : shapeParams.height) / 2 - toolRadiusPocket;
      maxHelixRadiusPocket = Math.max(0, Math.min(hw, hh));
    } else if (shape === ShapeType.HEXAGON) {
      const apothem = (shapeParams.height || 0) / 2 - toolRadiusPocket;
      maxHelixRadiusPocket = Math.max(0, apothem);
    }
  }

  function tagRecentFinishingMoves(startIdx) {
    const overridePct = Number.isFinite(cutParams.finishingPassSpeedOverridePct)
      ? Math.max(5, Math.min(200, cutParams.finishingPassSpeedOverridePct))
      : 100;
    if (overridePct === 100) return;
    for (let i = Math.max(0, startIdx); i < moves.length; i++) {
      if (moves[i].type === "cut") {
        moves[i].feedOverridePct = overridePct;
      }
    }
  }
  function getFinishingContourWithOverlap(contourPath) {
    const overlapMm = Number.isFinite(cutParams.finishingPassOverlap) ? Math.max(0, cutParams.finishingPassOverlap) : 0;
    return withClosedPathOverlap(contourPath, overlapMm);
  }

  // Speciaal gedrag voor PATTERNED_HOLES en CIRCULAR_PATTERN_HOLES bij pockets:
  // eerst één gat volledig (alle depths + finishing pass), dan retract + travel naar het volgende gat.
  if (
    operation === OperationType.POCKET &&
    (shape === ShapeType.CIRCULAR_PATTERN_HOLES || shape === ShapeType.PATTERNED_HOLES) &&
    pocketPaths &&
    pocketPaths.length > 0
  ) {
    const useFinishing =
      cutParams.finishingPassEnabled &&
      cutParams.finishingPassDistance > 0 &&
      depths.length > 0;
    const finalDepth = depths[depths.length - 1];
    let finContour = null;
    if (useFinishing) {
      const holeShapeParams = { diameter: shapeParams.diameter };
      finContour = generatePocketFinishingContour(ShapeType.CIRCLE, holeShapeParams, toolRadiusPocket);
    }

    pocketPaths.forEach((path, idx) => {
      const center = pocketCenters[idx] || { x: 0, y: 0 };
      depths.forEach((depthZ, depthIndex) => {
        const outside = plungeOutside && depthIndex === 0 && idx === 0;
        // Gedraagt zich als een gewone cirkel-pocket per gat: opvolgende depths gaan direct door
        // vanaf de vorige laag (geen retracts tussen depths). Daarom hier altijd isFirstPathAtDepth = true.
        const isFirstPathAtDepth = true;
        addLayerForPath(
          moves,
          path,
          depthZ,
          cutParams,
          outside,
          entryMethod,
          isFirstPathAtDepth,
          safeZ,
          undefined,
          false,
          true,
          toolRadiusPocket,
          true,
          maxHelixRadiusPocket,
          center.x,
          center.y
        );
      });

      // Finishing pass direct na het laatste depth van dit gat (indien ingeschakeld),
      // net als bij een normale cirkel-pocket.
      if (useFinishing && finContour && finContour.length >= 2) {
        const last = moves[moves.length - 1];
        const finishingStartIdx = moves.length;
        const translatedContour = getFinishingContourWithOverlap(finContour.map((p) => ({
          x: p.x + center.x,
          y: p.y + center.y,
          z: p.z,
        })));
        if (last && Math.abs(last.z - finalDepth) < 1e-6) {
          // Frees staat al op einddiepte: direct de finishing contour op dezelfde Z, geen retract.
          for (let i = 0; i < translatedContour.length; i++) {
            moves.push({
              x: translatedContour[i].x,
              y: translatedContour[i].y,
              z: finalDepth,
              type: "cut",
            });
          }
        } else {
          // Onverwacht: frees niet op einddiepte, val terug op retract + plunge via addLayerForPath.
          if (last && last.z < safeZ - 1e-6) {
            moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
          }
          addLayerForPath(
            moves,
            translatedContour,
            finalDepth,
            cutParams,
            false,
            entryMethod,
            true,
            safeZ,
            undefined,
            false,
            true,
            toolRadiusPocket,
            true,
            maxHelixRadiusPocket,
            center.x,
            center.y
          );
        }
        tagRecentFinishingMoves(finishingStartIdx);
      }

      // Na één volledig gat (alle depths + finishing): eerst klein stukje richting midden,
      // dan retract + travel naar volgende gat.
      if (pocketCenters[idx]) {
        const last = moves[moves.length - 1];
        if (last && last.z < safeZ - 1e-6) {
          const cx = pocketCenters[idx].x;
          const cy = pocketCenters[idx].y;
          const dx = cx - last.x;
          const dy = cy - last.y;
          const dist = Math.hypot(dx, dy);
          const pullbackMm = 1.5;
          if (dist > 1e-6 && pullbackMm > 0) {
            const step = Math.min(pullbackMm, dist);
            const endX = last.x + (dx / dist) * step;
            const endY = last.y + (dy / dist) * step;
            moves.push({ x: endX, y: endY, z: last.z, type: "cut" });
            moves.push({ x: endX, y: endY, z: safeZ, type: "rapid" });
          } else {
            moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
          }
        }
      }
    });
  } else {
    depths.forEach((depthZ, depthIndex) => {
      if (operation === OperationType.CONTOUR) {
        if (contourPaths && contourPaths.length > 0) {
          const isLastLayer = depthIndex === depths.length - 1;
          const toolRadiusContour = cutParams.toolDiameter / 2;
          const maxHelixRadiusContour = contourType === "inside" ? Math.max(0, (shapeParams.diameter / 2) - toolRadiusContour) : undefined;
          contourPaths.forEach((path, idx) => {
            if (path.length < 2) return;
            const center = pocketCenters[idx] || { x: 0, y: 0 };
            addLayerForPath(
              moves,
              path,
              depthZ,
              cutParams,
              plungeOutside && idx === 0,
              entryMethod,
              idx === 0,
              safeZ,
              undefined,
              true,
              true,
              toolRadiusContour,
              isLastLayer && idx === contourPaths.length - 1,
              maxHelixRadiusContour,
              center.x,
              center.y
            );
            if (idx < contourPaths.length - 1) {
              const last = moves[moves.length - 1];
              if (last && last.z < safeZ - 1e-6) {
                moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
              }
            }
          });
        } else if (contourPath && contourPath.length >= 2) {
          const isLastLayer = depthIndex === depths.length - 1;
          addLayerForPath(
            moves,
            contourPath,
            depthZ,
            cutParams,
            plungeOutside,
            entryMethod,
            true,
            safeZ,
            tabConfig,
            contourType === "inside",
            false,
            0,
            isLastLayer
          );
        }
      } else if (operation === OperationType.FACING) {
        const toolRadiusFacing = cutParams.toolDiameter / 2;
        facingPaths.forEach((path, idx) => {
          addLayerForPath(
            moves,
            path,
            depthZ,
            cutParams,
            false,
            entryMethod,
            idx === 0,
            safeZ,
            undefined,
            false,
            false, // helix-ramp op strip-start via openPath (niet via midden van vlak)
            toolRadiusFacing,
            true,
            undefined,
            undefined,
            undefined,
            false, // elke dieptelaag: retract en opnieuw insteken aan strip-start
            true,  // keepToolDownBetweenPaths: geen retract tussen strips
            true,  // openPath: strip is geen gesloten contour
            facingOpenBounds
          );
        });
      } else {
        // Pocket: één spiraalpad per laag (cirkel/ellips/rechthoek), stepover gerespecteerd
        // toolRadiusPocket en maxHelixRadiusPocket zijn buiten de forEach gehesen (zie boven).
        pocketPaths.forEach((path, idx) => {
          const outside = plungeOutside && idx === 0;
          const center = (shape === ShapeType.PATTERNED_HOLES || shape === ShapeType.CIRCULAR_PATTERN_HOLES) && pocketCenters[idx] ? pocketCenters[idx] : { x: 0, y: 0 };
          // Clamp helix-ramp radius op basis van het actuele pocketpad.
          // Dit voorkomt dat de ramp buiten de roughing-contour komt bij kleine pockets
          // met finishing-pass offset.
          let pathMaxHelixRadius = 0;
          for (let i = 0; i < path.length; i++) {
            const p = path[i];
            if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
            const r = Math.hypot(p.x - center.x, p.y - center.y);
            if (r > pathMaxHelixRadius) pathMaxHelixRadius = r;
          }
          const effectiveMaxHelixRadius = Number.isFinite(maxHelixRadiusPocket)
            ? Math.max(0, Math.min(maxHelixRadiusPocket, pathMaxHelixRadius))
            : Math.max(0, pathMaxHelixRadius);
          addLayerForPath(
            moves,
            path,
            depthZ,
            cutParams,
            outside,
            entryMethod,
            idx === 0,
            safeZ,
            undefined,
            false,
            true,
            toolRadiusPocket,
            true,
            effectiveMaxHelixRadius,
            center.x,
            center.y
          );
          // Bij patterned holes en circular pattern holes: na elk gat eerst naar midden, dan retract — voorkomt sporen aan de rand
          if ((shape === ShapeType.PATTERNED_HOLES || shape === ShapeType.CIRCULAR_PATTERN_HOLES) && pocketCenters[idx]) {
            const last = moves[moves.length - 1];
            if (last && last.z < safeZ - 1e-6) {
              const cx = pocketCenters[idx].x;
              const cy = pocketCenters[idx].y;
              const dx = cx - last.x;
              const dy = cy - last.y;
              const dist = Math.hypot(dx, dy);
              const pullbackMm = 1.5;
              if (dist > 1e-6 && pullbackMm > 0) {
                const step = Math.min(pullbackMm, dist);
                const endX = last.x + (dx / dist) * step;
                const endY = last.y + (dy / dist) * step;
                moves.push({ x: endX, y: endY, z: last.z, type: "cut" });
                moves.push({ x: endX, y: endY, z: safeZ, type: "rapid" });
              } else {
                moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
              }
            }
          }
        });
        // Bij meerdere pockets (patterned holes): na elke dieptelaag retracten zodat de volgende laag
        // niet als "continuing from previous layer" een cut-lijn naar het eerste gat maakt
        if (shape === ShapeType.PATTERNED_HOLES && pocketPaths.length > 1 && depthIndex < depths.length - 1) {
          const last = moves[moves.length - 1];
          if (last && last.z < safeZ - 1e-6) {
            moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
          }
        }
      }
    });
  }

  // Finishing pass voor contour: extra pass op einddiepte met overlap.
  if (operation === OperationType.CONTOUR && cutParams.finishingPassEnabled && depths.length > 0) {
    const finalDepth = depths[depths.length - 1];
    const contourInside = contourType === "inside";
    const toolRadiusContour = cutParams.toolDiameter / 2;
    const finishingContourPaths = contourFinishingPaths || contourPaths;
    const finishingContourPath = contourFinishingPath || contourPath;
    function addContourFinishingPass(path, centerX, centerY, useTabConfig) {
      if (!path || path.length < 2) return;
      const finishingStartIdx = moves.length;
      const finishingPath = getFinishingContourWithOverlap(path);
      const last = moves[moves.length - 1];
      if (last && Math.abs(last.z - finalDepth) < 1e-6) {
        // Tool staat al op einddiepte: finishing direct doorlopend frezen.
        for (let i = 0; i < finishingPath.length; i++) {
          moves.push({ x: finishingPath[i].x, y: finishingPath[i].y, z: finalDepth, type: "cut" });
        }
      } else {
        addLayerForPath(
          moves,
          finishingPath,
          finalDepth,
          cutParams,
          false,
          entryMethod,
          true,
          safeZ,
          useTabConfig,
          contourInside,
          true,
          toolRadiusContour,
          true,
          undefined,
          centerX,
          centerY
        );
      }
      tagRecentFinishingMoves(finishingStartIdx);
    }
    if (finishingContourPaths && finishingContourPaths.length > 0) {
      finishingContourPaths.forEach((path, idx) => {
        const center = pocketCenters[idx] || { x: 0, y: 0 };
        addContourFinishingPass(path, center.x, center.y, undefined);
      });
    } else if (finishingContourPath && finishingContourPath.length >= 2) {
      addContourFinishingPass(finishingContourPath, undefined, undefined, tabConfig);
    }
  }

  // Nabewerkingslaag: één contourpad op de werkelijke pocketgrens (zonder outerOffset), alleen op volledige diepte.
  if (operation === OperationType.POCKET && cutParams.finishingPassEnabled && cutParams.finishingPassDistance > 0 && depths.length > 0) {
    const finalDepth = depths[depths.length - 1];
    if (shape === ShapeType.CIRCULAR_PATTERN_HOLES && shapeParams.holeInCenter && Number.isFinite(shapeParams.centerHoleDiameter) && shapeParams.centerHoleDiameter > 0) {
      // Alleen het centrumgat van een circular pattern (de cirkels zelf zijn al per stuk afgewerkt)
      const centerHoleParams = { diameter: shapeParams.centerHoleDiameter };
      const centerFinContour = generatePocketFinishingContour(ShapeType.CIRCLE, centerHoleParams, toolRadiusPocket);
      if (centerFinContour && centerFinContour.length >= 2) {
        const finishingStartIdx = moves.length;
        const last = moves[moves.length - 1];
        if (last && last.z < safeZ - 1e-6) moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
        const centerFinContourWithOverlap = getFinishingContourWithOverlap(centerFinContour);
        addLayerForPath(moves, centerFinContourWithOverlap, finalDepth, cutParams, false, entryMethod, true, safeZ, undefined, false, true, toolRadiusPocket, true, maxHelixRadiusPocket, 0, 0);
        tagRecentFinishingMoves(finishingStartIdx);
      }
    } else if (shape !== ShapeType.PATTERNED_HOLES && shape !== ShapeType.CIRCULAR_PATTERN_HOLES) {
      const finContour = generatePocketFinishingContour(shape, shapeParams, toolRadiusPocket);
      if (finContour && finContour.length >= 2) {
        const finishingStartIdx = moves.length;
        const finContourWithOverlap = getFinishingContourWithOverlap(finContour);
        const last = moves[moves.length - 1];
        if (last && Math.abs(last.z - finalDepth) < 1e-6) {
          // Frees zit al op einddiepte: rechtstreeks naar de startpositie van de nabewerking,
          // geen retract + herinsteken nodig.
          for (let i = 0; i < finContourWithOverlap.length; i++) {
            moves.push({ x: finContourWithOverlap[i].x, y: finContourWithOverlap[i].y, z: finalDepth, type: "cut" });
          }
        } else {
          // Onverwacht: frees niet op einddiepte, val terug op retract + plunge.
          if (last && last.z < safeZ - 1e-6) moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
          addLayerForPath(moves, finContourWithOverlap, finalDepth, cutParams, false, entryMethod, true, safeZ, undefined, false, true, toolRadiusPocket, true, maxHelixRadiusPocket, 0, 0);
        }
        tagRecentFinishingMoves(finishingStartIdx);
      }
    }
  }

  // Aan het einde alleen terug naar veilige hoogte boven de laatste XY-positie,
  // niet terug naar de origin.
  if (moves.length > 0) {
    const last = moves[moves.length - 1];
    if (last.z < safeZ - 1e-6) {
      if (operation === OperationType.POCKET || (shape === ShapeType.CIRCULAR_PATTERN_HOLES && operation === OperationType.CONTOUR && pocketCenters.length > 0)) {
        // Eerst een recht lijntje richting het midden (net van de rand af), dan retract — geen boog, geen sporen
        const cx = ((shape === ShapeType.PATTERNED_HOLES || shape === ShapeType.CIRCULAR_PATTERN_HOLES) && pocketCenters.length > 0) ? pocketCenters[pocketCenters.length - 1].x : 0;
        const cy = ((shape === ShapeType.PATTERNED_HOLES || shape === ShapeType.CIRCULAR_PATTERN_HOLES) && pocketCenters.length > 0) ? pocketCenters[pocketCenters.length - 1].y : 0;
        const dx = cx - last.x;
        const dy = cy - last.y;
        const dist = Math.hypot(dx, dy);
        const pullbackMm = 1.5;
        if (dist > 1e-6 && pullbackMm > 0) {
          const step = Math.min(pullbackMm, dist);
          const endX = last.x + (dx / dist) * step;
          const endY = last.y + (dy / dist) * step;
          moves.push({ x: endX, y: endY, z: last.z, type: "cut" });
          moves.push({ x: endX, y: endY, z: safeZ, type: "rapid" });
        } else {
          moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
        }
      } else {
        moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
      }
    }
  }

  // Origin-transformatie toepassen
  let facingBounds = null;
  if (shape === ShapeType.FACING || operation === OperationType.FACING) {
    const w = shape === ShapeType.FACING ? shapeParams.width : (shape === ShapeType.SQUARE ? shapeParams.size : shapeParams.width);
    const h = shape === ShapeType.FACING ? shapeParams.height : (shape === ShapeType.SQUARE ? shapeParams.size : shapeParams.height);
    if (Number.isFinite(w) && Number.isFinite(h)) {
      facingBounds = { hw: w / 2, hh: h / 2 };
    }
  }
  const resultRaw = getResultShapePathsRaw(params);
  const shift = computeOriginShift(moves, originParams, cutParams.totalDepth, toolRadius, operation, contourType, facingBounds, false);
  applyOriginTransform(moves, originParams, cutParams.totalDepth, toolRadius, operation, contourType, facingBounds);
  if (resultRaw && resultRaw.paths.length > 0) {
    resultRaw.paths.forEach((path) => {
      applyOriginTransformToPoints(path, shift.shiftX, shift.shiftY, shift.zOffset, shift.zOriginMode, cutParams.totalDepth);
    });
    const resultContourInside = operation === OperationType.POCKET || (operation === OperationType.CONTOUR && contourType === "inside");
    const resultBounds = computeBoundsFromPaths(resultRaw.paths);
    return { moves, resultPaths: resultRaw.paths, resultTotalDepth: resultRaw.totalDepth, resultBottomZ: resultRaw.bottomZ, resultContourInside, resultBounds, toolDiameter: cutParams.toolDiameter };
  }
  return { moves, toolDiameter: cutParams.toolDiameter };
}

/**
 * Eén laag toevoegen voor een gegeven polyline-pad.
 * Insteek: plunge of ramp.
 * @param {ToolpathMove[]} moves
 * @param {{x:number,y:number,z:number}[]} path
 * @param {number} depthZ
 * @param {*} cutParams
 * @param {boolean} plungeOutside
 * @param {string} entryMethod
 * @param {boolean} isFirstPathAtDepth  // true = eerste pad op deze Z-laag
 * @param {number} safeZ  // veilige hoogte (mm) voor rapid moves
 * @param {{enabled:boolean,ranges:{start:number,end:number}[],totalLength:number,cumulative:number[],tabZ:number}|null} [tabConfig]
 * @param {boolean} [entryInsideForInsideContour] // bij binnencontour: insteken aan binnenzijde van de contour
 * @param {boolean} [useHelixRamp] // bij pocket: ramp als helix zodat we binnen de pocket blijven
 * @param {number} [toolRadius] // freesstraal (mm), nodig voor helix-straal
 * @param {boolean} [isLastLayer] // bij contour tussenlagen: false = alleen ramp, geen volledige contour; onderste laag wel
 * @param {number} [maxHelixRadius] // bij pocket: max. helixstraal (binnenkant vorm), zodat helix niet buiten pocket komt
 * @param {number} [helixCenterX] // bij pocket: X van midden (helix gecentreerd), anders entryStart
 * @param {number} [helixCenterY] // bij pocket: Y van midden
 * @param {boolean} [allowContinuingFromPreviousLayer] // false = altijd retract (bij multi-contour: vorige was andere contour)
 * @param {boolean} [keepToolDownBetweenPaths] // bij facing: geen retract tussen strips, direct cut naar volgende strip
 * @param {boolean} [openPath] // bij facing: open strip-pad; helix-ramp op startpunt, daarna volledige strip op diepte
 * @param {{ hw:number, hh:number, within:boolean } | null} [openPathBounds] // effectief facing-werkvlak voor helix-plaatsing
 */
function addLayerForPath(
  moves,
  path,
  depthZ,
  cutParams,
  plungeOutside,
  entryMethod,
  isFirstPathAtDepth,
  safeZ,
  tabConfig,
  entryInsideForInsideContour = false,
  useHelixRamp = false,
  toolRadius = 0,
  isLastLayer = true,
  maxHelixRadius = undefined,
  helixCenterX = undefined,
  helixCenterY = undefined,
  allowContinuingFromPreviousLayer = true,
  keepToolDownBetweenPaths = false,
  openPath = false,
  openPathBounds = null
) {
  if (!path || path.length === 0) return;

  const start = { x: path[0].x, y: path[0].y };
  const leadInAbove = Math.max(0, cutParams.leadInAboveMm ?? 2);

  // Speciaal geval: enkel punt → boorgat / enkel pad in Z-richting.
  if (path.length === 1) {
    const last = moves[moves.length - 1];
    if (last && last.z < safeZ - 1e-6) {
      moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
    }
    moves.push({ x: start.x, y: start.y, z: safeZ, type: "rapid" });
    if (safeZ > leadInAbove) {
      moves.push({ x: start.x, y: start.y, z: leadInAbove, type: "rapid" });
    }
    moves.push({ x: start.x, y: start.y, z: 0, type: "cut" });
    moves.push({ x: start.x, y: start.y, z: depthZ, type: "cut" });
    return;
  }

  // Niet het eerste pad op deze Z-laag: retract, rapid naar volgend gat, dan ramp of plunge naar depthZ
  if (!isFirstPathAtDepth) {
    const last = moves[moves.length - 1];
    // Bij facing: tool blijft op diepte, direct cut naar start van volgende strip (geen retract)
    if (keepToolDownBetweenPaths && last && Math.abs(last.z - depthZ) < 1e-6) {
      moves.push({ x: start.x, y: start.y, z: depthZ, type: "cut" });
      for (let i = 1; i < path.length; i++) {
        const p = path[i];
        moves.push({ x: p.x, y: p.y, z: depthZ, type: "cut" });
      }
      return;
    }
    // Retract naar veilige hoogte
    if (last && last.z < safeZ - 1e-6) {
      moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
    }
    const cx = Number.isFinite(helixCenterX) ? helixCenterX : start.x;
    const cy = Number.isFinite(helixCenterY) ? helixCenterY : start.y;
    const useRampHere = entryMethod === EntryMethod.RAMP && useHelixRamp && toolRadius > 0 && Number.isFinite(helixCenterX) && Number.isFinite(helixCenterY);

    if (useRampHere) {
      // Helix-ramp naar dit gat (zelfde als eerste gat)
      const R = Math.max(1e-6, Math.min(toolRadius, Number.isFinite(maxHelixRadius) ? maxHelixRadius : toolRadius));
      const helixStartX = cx + R;
      const helixStartY = cy;
      const zStart = leadInAbove;
      const targetZ = depthZ;
      const maxDepth = Math.abs(targetZ - zStart);
      const rampAngleRad = degToRad(cutParams.rampAngleMax || 3);
      moves.push({ x: helixStartX, y: helixStartY, z: safeZ, type: "rapid" });
      if (safeZ > zStart) {
        moves.push({ x: helixStartX, y: helixStartY, z: zStart, type: "rapid" });
      }
      const maxAnglePerMove = degToRad(8);
      const twoPi = 2 * Math.PI;
      const targetAngleNorm = (Math.atan2(start.y - cy, start.x - cx) + twoPi) % twoPi;
      let angle = 0;
      let currentZ = zStart;
      while (currentZ > targetZ - 1e-6) {
        const remainingZ = currentZ - targetZ;
        const segmentDeltaZ = Math.abs(remainingZ) > maxDepth ? -maxDepth : -Math.abs(remainingZ);
        const segmentZ = currentZ + segmentDeltaZ;
        const angleNorm = ((angle % twoPi) + twoPi) % twoPi;
        let angleToTarget = (targetAngleNorm - angleNorm + twoPi) % twoPi;
        if (angleToTarget < 1e-6) angleToTarget = twoPi;
        const isLastSegment = segmentZ <= targetZ + 1e-6;
        let deltaAngleTotal;
        if (isLastSegment) {
          const minAngleForRamp = R > 1e-6 && rampAngleRad > 0 ? Math.abs(targetZ - currentZ) / (R * Math.tan(rampAngleRad)) : 0;
          deltaAngleTotal = angleToTarget + twoPi * Math.ceil(Math.max(0, minAngleForRamp - angleToTarget) / twoPi);
        } else {
          let arcLength = rampAngleRad > 0 ? Math.abs(segmentDeltaZ) / Math.tan(rampAngleRad) : 0;
          if (!isFinite(arcLength) || arcLength <= 0) arcLength = 0;
          deltaAngleTotal = R > 1e-6 ? arcLength / R : 0;
        }
        const numSteps = Math.max(1, Math.ceil(deltaAngleTotal / maxAnglePerMove));
        const deltaAngle = deltaAngleTotal / numSteps;
        const deltaZTotal = isLastSegment ? targetZ - currentZ : segmentDeltaZ;
        const deltaZPerStep = deltaZTotal / numSteps;
        for (let step = 0; step < numSteps; step++) {
          angle += deltaAngle;
          const z = currentZ + deltaZPerStep * (step + 1);
          const x = cx + R * Math.cos(angle);
          const y = cy + R * Math.sin(angle);
          moves.push({ x, y, z, type: "cut" });
        }
        currentZ = isLastSegment ? targetZ : segmentZ;
        if (currentZ <= targetZ + 1e-6) break;
      }
      const helixEndX = cx + R * Math.cos(((angle % twoPi) + twoPi) % twoPi);
      const helixEndY = cy + R * Math.sin(((angle % twoPi) + twoPi) % twoPi);
      if (distance2D({ x: helixEndX, y: helixEndY }, start) > 1e-6) {
        moves.push({ x: start.x, y: start.y, z: depthZ, type: "cut" });
      }
    } else if (entryMethod === EntryMethod.RAMP && !useHelixRamp) {
      // Contour ramp (pad-gebaseerd): ramp langs het pad,zelfde logica als eerste contour
      const rampAngleRad = degToRad(cutParams.rampAngleMax || 3);
      const rampStartZ = leadInAbove;
      const requiredPathLength = rampAngleRad > 0 ? Math.abs(depthZ - rampStartZ) / Math.tan(rampAngleRad) : 0;
      moves.push({ x: start.x, y: start.y, z: safeZ, type: "rapid" });
      if (safeZ > rampStartZ) {
        moves.push({ x: start.x, y: start.y, z: rampStartZ, type: "rapid" });
      }
      const n = path.length;
      if (n >= 2 && requiredPathLength > 1e-6) {
        let dist = 0;
        let rampEndSeg = 0;
        let rampEndPoint = null;
        rampLoop: while (true) {
          for (let i = 0; i < n; i++) {
            const a = path[i];
            const b = path[(i + 1) % n];
            const segLen = distance2D(a, b);
            if (segLen < 1e-9) continue;
            if (dist + segLen <= requiredPathLength) {
              dist += segLen;
              const z = rampStartZ + (depthZ - rampStartZ) * (dist / requiredPathLength);
              moves.push({ x: b.x, y: b.y, z, type: "cut" });
            } else {
              const remaining = requiredPathLength - dist;
              const t = remaining / segLen;
              rampEndPoint = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
              moves.push({ x: rampEndPoint.x, y: rampEndPoint.y, z: depthZ, type: "cut" });
              rampEndSeg = (i + 1) % n;
              break rampLoop;
            }
          }
        }
        if (rampEndPoint !== null && tabConfig && tabConfig.enabled && tabConfig.totalLengthClosed != null && depthZ < (tabConfig.tabZ + 1e-6)) {
          const prevIdx = (rampEndSeg + n - 1) % n;
          const sRampEnd = tabConfig.cumulative[prevIdx] + distance2D(path[prevIdx], rampEndPoint);
          const eps = 1e-9;
          const sEndFirst = rampEndSeg === 0 ? tabConfig.totalLengthClosed : tabConfig.cumulative[rampEndSeg];
          const segLenFirst = sEndFirst - sRampEnd;
          const sListFirst = getTabBoundarySInSegment(sRampEnd, sEndFirst, tabConfig);
          for (const s of sListFirst) {
            if (s <= sRampEnd + eps) continue;
            const t = segLenFirst > 1e-12 ? (s - sRampEnd) / segLenFirst : 0;
            moves.push({
              x: rampEndPoint.x + t * (path[rampEndSeg].x - rampEndPoint.x),
              y: rampEndPoint.y + t * (path[rampEndSeg].y - rampEndPoint.y),
              z: getZForTabProfile(s, depthZ, tabConfig),
              type: "cut",
            });
          }
          for (let k = 1; k < n; k++) {
            const idx = (rampEndSeg + k) % n;
            const nextIdx = (rampEndSeg + k + 1) % n;
            // Skip het ramp-segment (prevIdx -> rampEndSeg): dat is al afgehandeld in sListFirst en sListLast
            if (idx === prevIdx && nextIdx === rampEndSeg) continue;
            const sStart = tabConfig.cumulative[idx];
            const sEnd = nextIdx === 0 ? tabConfig.totalLengthClosed : tabConfig.cumulative[nextIdx];
            const sList = getTabBoundarySInSegment(sStart, sEnd, tabConfig);
            const p0 = path[idx];
            const p1 = path[nextIdx];
            const segLen = sEnd - sStart;
            for (const s of sList) {
              const t = segLen > 1e-12 ? (s - sStart) / segLen : 0;
              moves.push({
                x: p0.x + t * (p1.x - p0.x),
                y: p0.y + t * (p1.y - p0.y),
                z: getZForTabProfile(s, depthZ, tabConfig),
                type: "cut",
              });
            }
          }
          const sListLast = getTabBoundarySInSegment(tabConfig.cumulative[prevIdx], sRampEnd, tabConfig);
          const segLenLast = sRampEnd - tabConfig.cumulative[prevIdx];
          for (const s of sListLast) {
            if (s >= sRampEnd - eps) continue;
            const t = segLenLast > 1e-12 ? (s - tabConfig.cumulative[prevIdx]) / segLenLast : 0;
            moves.push({
              x: path[prevIdx].x + t * (rampEndPoint.x - path[prevIdx].x),
              y: path[prevIdx].y + t * (rampEndPoint.y - path[prevIdx].y),
              z: getZForTabProfile(s, depthZ, tabConfig),
              type: "cut",
            });
          }
          moves.push({ x: rampEndPoint.x, y: rampEndPoint.y, z: getZForTabProfile(sRampEnd, depthZ, tabConfig), type: "cut" });
        } else if (rampEndPoint !== null) {
          for (let k = 0; k < n; k++) {
            const idx = (rampEndSeg + k) % n;
            const z = tabConfig && tabConfig.enabled && depthZ < (tabConfig.tabZ + 1e-6) && tabConfig.cumulative && idx < tabConfig.cumulative.length
              ? getZForTabProfile(tabConfig.cumulative[idx], depthZ, tabConfig) : depthZ;
            moves.push({ x: path[idx].x, y: path[idx].y, z, type: "cut" });
          }
          if (rampEndSeg !== 0 && tabConfig && tabConfig.enabled) {
            const s = tabConfig.cumulative[(rampEndSeg + n - 1) % n] + distance2D(path[(rampEndSeg + n - 1) % n], rampEndPoint);
            moves.push({ x: rampEndPoint.x, y: rampEndPoint.y, z: getZForTabProfile(s, depthZ, tabConfig), type: "cut" });
          }
        }
      } else {
        moves.push({ x: start.x, y: start.y, z: depthZ, type: "cut" });
      }
    } else {
      // Geen ramp: rapid naar start, verticale plunge
      moves.push({ x: start.x, y: start.y, z: safeZ, type: "rapid" });
      if (safeZ > leadInAbove) {
        moves.push({ x: start.x, y: start.y, z: leadInAbove, type: "rapid" });
      }
      moves.push({ x: start.x, y: start.y, z: depthZ, type: "cut" });
    }

    // Volledige ring op deze diepte aflopen (met tabs indien tabConfig) – alleen bij plunge (bij ramp al gedaan)
    if (entryMethod !== EntryMethod.RAMP || useHelixRamp) {
    if (tabConfig && tabConfig.enabled && tabConfig.totalLengthClosed != null && depthZ < (tabConfig.tabZ + 1e-6)) {
      for (let i = 0; i < path.length - 1; i++) {
        const sStart = tabConfig.cumulative[i];
        const sEnd = tabConfig.cumulative[i + 1];
        const sList = getTabBoundarySInSegment(sStart, sEnd, tabConfig);
        const p0 = path[i];
        const p1 = path[i + 1];
        const segLen = sEnd - sStart;
        for (const s of sList) {
          const t = segLen > 1e-12 ? (s - sStart) / segLen : 0;
          const x = p0.x + t * (p1.x - p0.x);
          const y = p0.y + t * (p1.y - p0.y);
          const z = getZForTabProfile(s, depthZ, tabConfig);
          moves.push({ x, y, z, type: "cut" });
        }
      }
    } else {
      const useTabsHere = !!tabConfig && tabConfig.enabled && depthZ < (tabConfig.tabZ + 1e-6);
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        let z = depthZ;
        if (useTabsHere && tabConfig.cumulative && i < tabConfig.cumulative.length) {
          z = getZForTabProfile(tabConfig.cumulative[i], depthZ, tabConfig);
        }
        moves.push({ x: p.x, y: p.y, z, type: "cut" });
      }
    }
    }
    return;
  }

  // Eerste pad op deze Z-laag: normale insteek (plunge of ramp)
  let entryStart = { ...start };

  if (plungeOutside) {
    // Buiten het part insteken, tenzij start in het midden (0,0) ligt (bv. kleine pocket):
    // dan in het midden insteken zodat lead-in de rand niet raakt.
    // Voor een BINNENcontour willen we echter "naast het onderdeel" aan de BINNENkant van de contour insteken.
    const atCenter = Math.abs(start.x) <= 1e-9 && Math.abs(start.y) <= 1e-9;
    if (!atCenter) {
      if (entryInsideForInsideContour) {
        // Binnencontour: offset richting het geometrische midden van het pad (naar binnen toe).
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < path.length; i++) {
          const p = path[i];
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        let vx = cx - start.x;
        let vy = cy - start.y;
        const len = Math.hypot(vx, vy);
        if (len > 1e-9) {
          vx /= len;
          vy /= len;
          const dist = cutParams.toolDiameter * 1.5;
          entryStart = {
            x: start.x + vx * dist,
            y: start.y + vy * dist,
          };
        } else {
          entryStart = { ...start };
        }
      } else {
        // Standaard (buitencontour / buiten het part):
        // insteken in de richting "naar buiten" t.o.v. het pad,
        // ongeveer radiaal vanaf het geometrische midden van de contour.
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < path.length; i++) {
          const p = path[i];
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        let vx = start.x - cx;
        let vy = start.y - cy;
        const len = Math.hypot(vx, vy);
        if (len > 1e-9) {
          vx /= len;
          vy /= len;
          const dist = cutParams.toolDiameter * 1.5;
          entryStart = {
            x: start.x + vx * dist,
            y: start.y + vy * dist,
          };
        } else {
          // fallback: kleine verschuiving in X/Y
          const dist = cutParams.toolDiameter * 1.5;
          entryStart = {
            x: start.x + dist,
            y: start.y,
          };
        }
      }
    }
  }

  // Helper: maak een gebogen lead-in (quadratische Bézier) van 'fromPoint'
  // naar 'start', die vloeiend (tangent) overloopt in de eerste lijn
  // van het pad (start -> nextPoint).
  function addCurvedLeadIn(fromPoint, startPoint, nextPoint, depth) {
    if (!nextPoint) {
      // Geen volgend punt bekend: val terug op rechte lijn.
      if (fromPoint.x !== startPoint.x || fromPoint.y !== startPoint.y) {
        moves.push({ x: startPoint.x, y: startPoint.y, z: depth, type: "cut" });
      }
      return;
    }

    const vx = nextPoint.x - startPoint.x;
    const vy = nextPoint.y - startPoint.y;
    const segLen = Math.hypot(vx, vy);
    if (segLen < 1e-9) {
      // Te kort om een nette curve te maken → rechte lijn.
      if (fromPoint.x !== startPoint.x || fromPoint.y !== startPoint.y) {
        moves.push({ x: startPoint.x, y: startPoint.y, z: depth, type: "cut" });
      }
      return;
    }

    // Eenvoudige boog via een quadratische Bézier:
    // B(0) = fromPoint, B(1) = startPoint.
    // Tangent bij B(1) evenwijdig aan (startPoint -> nextPoint).
    // Speciaal voor rechthoekige segmenten (horizontaal/verticaal)
    // kiezen we het control point zó dat:
    // - de tangent exact langs de zijde loopt
    // - de boog mooi "rond" is, zonder rare knikken.
    let cx;
    let cy;
    const eps = 1e-9;
    if (Math.abs(vx) < eps) {
      // Eerste segment is (nagenoeg) verticaal: tangent omhoog/omlaag.
      // Kies control point op dezelfde x als de zijde (start.x) en
      // verschuif in de richting van de tangent met een afstand die
      // ongeveer gelijk is aan de normale offset van de insteek.
      const dir = Math.sign(vy) || 1;
      const normalOffset = Math.abs(fromPoint.x - startPoint.x);
      const span = normalOffset || segLen * 0.5;
      cx = startPoint.x;
      cy = startPoint.y + dir * span;
    } else if (Math.abs(vy) < eps) {
      // Eerste segment is (nagenoeg) horizontaal: tangent links/rechts.
      // Analoge constructie, maar dan in X-richting.
      const dir = Math.sign(vx) || 1;
      const normalOffset = Math.abs(fromPoint.y - startPoint.y);
      const span = normalOffset || segLen * 0.5;
      cx = startPoint.x + dir * span;
      cy = startPoint.y;
    } else {
      // Algemene vorm (bijv. cirkel): control point op verlenging van
      // de eerste segmentvector achter het startpunt.
      const CURVE_FACTOR = 1.5;
      cx = startPoint.x - CURVE_FACTOR * vx;
      cy = startPoint.y - CURVE_FACTOR * vy;
    }

    const STEPS = 12;
    for (let i = 1; i <= STEPS; i++) {
      const t = i / STEPS;
      const omt = 1 - t;
      const bx =
        omt * omt * fromPoint.x +
        2 * omt * t * cx +
        t * t * startPoint.x;
      const by =
        omt * omt * fromPoint.y +
        2 * omt * t * cy +
        t * t * startPoint.y;
      moves.push({ x: bx, y: by, z: depth, type: "cut" });
    }
  }

  const rampAngleRad = degToRad(cutParams.rampAngleMax || 3);

  const last = moves[moves.length - 1];
  /** Volgende laag: ramp direct onder vorige eindpositie (geen retract naar boven); onderste laag sluit wel dicht. */
  /** Bij multi-contour (DXF): vorige was andere contour, dus nooit "continuing" - altijd retract. */
  const continuingFromPreviousLayer =
    allowContinuingFromPreviousLayer &&
    last &&
    last.z < -1e-6 &&
    depthZ < last.z - 1e-6;

  if (!continuingFromPreviousLayer) {
    if (last && last.z < safeZ - 1e-6) {
      moves.push({ x: last.x, y: last.y, z: safeZ, type: "rapid" });
    }
    if (
      !(entryMethod === EntryMethod.RAMP && useHelixRamp && toolRadius > 0) &&
      !(entryMethod === EntryMethod.RAMP && plungeOutside)
    ) {
      moves.push({ x: entryStart.x, y: entryStart.y, z: safeZ, type: "rapid" });
    }
  }

  /** Pad niet nogmaals: bij RAMP op tussenlaag alleen ramp (geen contour); bij plunge altijd contour per laag.
   * Uitzondering: bij insteken buiten doen we wél de volledige contour op elke laag (meerdere rechthoeken). */
  let pathAlreadyAtDepth = false;
  /** Bij contour ramp + insteken buiten: na ramp+lead-in staan we al op path[0], dus die niet dubbel toevoegen. */
  let skipFirstPathPoint = false;
  if (entryMethod === EntryMethod.RAMP && !isLastLayer && !plungeOutside) {
    pathAlreadyAtDepth = true;
  }

  if (entryMethod === EntryMethod.RAMP) {
    const zStart = continuingFromPreviousLayer ? last.z : 0;
    const targetZ = depthZ;
    const maxDepth = Math.abs(targetZ - zStart);

    if (useHelixRamp && toolRadius > 0) {
      const R = Math.max(1e-6, Math.min(toolRadius, Number.isFinite(maxHelixRadius) ? maxHelixRadius : toolRadius));
      const cx = Number.isFinite(helixCenterX) ? helixCenterX : entryStart.x;
      const cy = Number.isFinite(helixCenterY) ? helixCenterY : entryStart.y;
      const helixStartX = cx + R;
      const helixStartY = cy;
      // Pocket-helix: rechte stuk boven materiaal is onderdeel van de ramp; helix start op zStart+leadInAbove.
      const helixRampStartZ = continuingFromPreviousLayer ? zStart : zStart + leadInAbove;
      if (!continuingFromPreviousLayer) {
        moves.push({ x: helixStartX, y: helixStartY, z: safeZ, type: "rapid" });
        if (safeZ > zStart + leadInAbove) {
          moves.push({ x: helixStartX, y: helixStartY, z: zStart + leadInAbove, type: "rapid" });
        }
        // Geen aparte rechte cut naar zStart; helix start direct op helixRampStartZ
      } else {
        moves.push({ x: helixStartX, y: helixStartY, z: zStart, type: "cut" });
      }

      const maxAnglePerMove = degToRad(8);
      const twoPi = 2 * Math.PI;
      const targetAngleNorm = (Math.atan2(start.y - cy, start.x - cx) + twoPi) % twoPi;
      let angle = 0;
      let currentZ = helixRampStartZ;

      while (currentZ > targetZ - 1e-6) {
        const remainingZ = currentZ - targetZ;
        const segmentDeltaZ =
          Math.abs(remainingZ) > maxDepth ? -maxDepth : -Math.abs(remainingZ);
        const segmentZ = currentZ + segmentDeltaZ;

        const angleNorm = ((angle % twoPi) + twoPi) % twoPi;
        let angleToTarget = (targetAngleNorm - angleNorm + twoPi) % twoPi;
        if (angleToTarget < 1e-6) angleToTarget = twoPi;
        const isLastSegment = segmentZ <= targetZ + 1e-6;

        let deltaAngleTotal;
        if (isLastSegment) {
          const minAngleForRamp =
            R > 1e-6 && rampAngleRad > 0
              ? Math.abs(targetZ - currentZ) / (R * Math.tan(rampAngleRad))
              : 0;
          deltaAngleTotal =
            angleToTarget +
            twoPi * Math.ceil(Math.max(0, minAngleForRamp - angleToTarget) / twoPi);
        } else {
          let arcLength =
            rampAngleRad > 0 ? Math.abs(segmentDeltaZ) / Math.tan(rampAngleRad) : 0;
          if (!isFinite(arcLength) || arcLength <= 0) arcLength = 0;
          deltaAngleTotal = R > 1e-6 ? arcLength / R : 0;
        }

        const numSteps = Math.max(
          1,
          Math.ceil(deltaAngleTotal / maxAnglePerMove)
        );
        const deltaAngle = deltaAngleTotal / numSteps;
        const deltaZTotal = isLastSegment ? targetZ - currentZ : segmentDeltaZ;
        const deltaZPerStep = deltaZTotal / numSteps;

        for (let step = 0; step < numSteps; step++) {
          angle += deltaAngle;
          const z = currentZ + deltaZPerStep * (step + 1);
          const x = cx + R * Math.cos(angle);
          const y = cy + R * Math.sin(angle);
          moves.push({ x, y, z, type: "cut" });
        }
        currentZ = isLastSegment ? targetZ : segmentZ;
        if (currentZ <= targetZ + 1e-6) break;
      }

      const helixEndX = cx + R * Math.cos(((angle % twoPi) + twoPi) % twoPi);
      const helixEndY = cy + R * Math.sin(((angle % twoPi) + twoPi) % twoPi);
      if (distance2D({ x: helixEndX, y: helixEndY }, start) > 1e-6) {
        moves.push({ x: start.x, y: start.y, z: depthZ, type: "cut" });
      }
    } else if (plungeOutside) {
      // Contour met insteken buiten: kleine helix rond entryStart (naast het onderdeel) tot op diepte,
      // dan rechte lijn naar start; zo snijden we nooit door de vorm.
      // Rechte stuk boven materiaal is onderdeel van de ramp; helix start op zStart+leadInAbove.
      const cx = entryStart.x;
      const cy = entryStart.y;
      const helixR = Math.max(0.5, Math.min(1.5, (cutParams.toolDiameter || 6) / 2));
      const helixStartX = cx + helixR;
      const helixStartY = cy;
      const helixRampStartZ = continuingFromPreviousLayer ? zStart : zStart + leadInAbove;

      if (!continuingFromPreviousLayer) {
        moves.push({ x: helixStartX, y: helixStartY, z: safeZ, type: "rapid" });
        if (safeZ > zStart + leadInAbove) {
          moves.push({ x: helixStartX, y: helixStartY, z: zStart + leadInAbove, type: "rapid" });
        }
        // Geen aparte rechte cut naar zStart; helix start direct op helixRampStartZ
      } else {
        // Volgende laag: geen retract; direct op diepte (last.z) naar helixstart, dan helix naar depthZ
        moves.push({ x: helixStartX, y: helixStartY, z: last.z, type: "cut" });
      }
      let currentAngle = 0;
      let currentZ = continuingFromPreviousLayer ? last.z : helixRampStartZ;

      const maxAnglePerMove = degToRad(8);
      const R = Math.max(1e-6, helixR);

      while (currentZ > targetZ - 1e-6) {
        const remainingZ = currentZ - targetZ;
        const segmentDeltaZ =
          Math.abs(remainingZ) > maxDepth ? -maxDepth : -Math.abs(remainingZ);
        const segmentZ = currentZ + segmentDeltaZ;
        const isLastSegment = segmentZ <= targetZ + 1e-6;

        let arcLength =
          rampAngleRad > 0 ? Math.abs(segmentDeltaZ) / Math.tan(rampAngleRad) : 0;
        if (!isFinite(arcLength) || arcLength <= 0) arcLength = 0;
        let deltaAngleTotal = R > 1e-6 ? arcLength / R : 0;
        if (isLastSegment) {
          const minAngleForRamp =
            R > 1e-6 && rampAngleRad > 0
              ? Math.abs(targetZ - currentZ) / (R * Math.tan(rampAngleRad))
              : 0;
          deltaAngleTotal = Math.max(deltaAngleTotal, minAngleForRamp);
        }
        const numSteps = Math.max(1, Math.ceil(deltaAngleTotal / maxAnglePerMove));
        const deltaAngle = deltaAngleTotal / numSteps;
        const deltaZTotal = isLastSegment ? targetZ - currentZ : segmentDeltaZ;
        const deltaZPerStep = deltaZTotal / numSteps;

        for (let step = 0; step < numSteps; step++) {
          currentAngle += deltaAngle;
          const z = currentZ + deltaZPerStep * (step + 1);
          const x = cx + R * Math.cos(currentAngle);
          const y = cy + R * Math.sin(currentAngle);
          moves.push({ x, y, z, type: "cut" });
        }
        currentZ = isLastSegment ? targetZ : segmentZ;
        if (currentZ <= targetZ + 1e-6) break;
      }

      moves.push({ x: start.x, y: start.y, z: depthZ, type: "cut" });
      skipFirstPathPoint = true;
    } else if (openPath) {
      // Open strip (facing): compacte helix-ramp op strip-start, binnen werkvlak bij modus "within".
      const helixPlacement = computeFacingStripHelixPlacement(
        start,
        path,
        cutParams.toolDiameter,
        openPathBounds
      );
      const cx = helixPlacement.cx;
      const cy = helixPlacement.cy;
      const helixR = helixPlacement.helixR;
      const helixStartX = start.x;
      const helixStartY = start.y;
      const helixRampStartZ = continuingFromPreviousLayer ? zStart : zStart + leadInAbove;

      if (!continuingFromPreviousLayer) {
        moves.push({ x: helixStartX, y: helixStartY, z: safeZ, type: "rapid" });
        if (safeZ > zStart + leadInAbove) {
          moves.push({ x: helixStartX, y: helixStartY, z: zStart + leadInAbove, type: "rapid" });
        }
      } else {
        moves.push({ x: helixStartX, y: helixStartY, z: last.z, type: "cut" });
      }

      let currentAngle = helixPlacement.startAngle;
      let currentZ = continuingFromPreviousLayer ? last.z : helixRampStartZ;
      const maxAnglePerMove = degToRad(8);
      const R = Math.max(1e-6, helixR);

      while (currentZ > targetZ - 1e-6) {
        const remainingZ = currentZ - targetZ;
        const segmentDeltaZ =
          Math.abs(remainingZ) > maxDepth ? -maxDepth : -Math.abs(remainingZ);
        const segmentZ = currentZ + segmentDeltaZ;
        const isLastSegment = segmentZ <= targetZ + 1e-6;

        let arcLength =
          rampAngleRad > 0 ? Math.abs(segmentDeltaZ) / Math.tan(rampAngleRad) : 0;
        if (!isFinite(arcLength) || arcLength <= 0) arcLength = 0;
        let deltaAngleTotal = R > 1e-6 ? arcLength / R : 0;
        if (isLastSegment) {
          const minAngleForRamp =
            R > 1e-6 && rampAngleRad > 0
              ? Math.abs(targetZ - currentZ) / (R * Math.tan(rampAngleRad))
              : 0;
          deltaAngleTotal = Math.max(deltaAngleTotal, minAngleForRamp);
        }
        const numSteps = Math.max(1, Math.ceil(deltaAngleTotal / maxAnglePerMove));
        const deltaAngle = deltaAngleTotal / numSteps;
        const deltaZTotal = isLastSegment ? targetZ - currentZ : segmentDeltaZ;
        const deltaZPerStep = deltaZTotal / numSteps;

        for (let step = 0; step < numSteps; step++) {
          currentAngle += deltaAngle;
          const z = currentZ + deltaZPerStep * (step + 1);
          const x = cx + R * Math.cos(currentAngle);
          const y = cy + R * Math.sin(currentAngle);
          moves.push({ x, y, z, type: "cut" });
        }
        currentZ = isLastSegment ? targetZ : segmentZ;
        if (currentZ <= targetZ + 1e-6) break;
      }

      moves.push({ x: start.x, y: start.y, z: depthZ, type: "cut" });
      skipFirstPathPoint = true;
    } else {
      // Contour ramp: P(path[0]) → ramp → B op diepte; dan contour van B naar P. Onderste laag: contour afmaken tot B.
      // Het rechte stuk boven het materiaal (leadInAbove) is onderdeel van de ramp: ramp start bij zStart+leadInAbove.
      pathAlreadyAtDepth = true;
      const rampStartZ = continuingFromPreviousLayer ? zStart : zStart + leadInAbove;
      const requiredPathLength =
        rampAngleRad > 0 ? Math.abs(targetZ - rampStartZ) / Math.tan(rampAngleRad) : 0;
      if (!continuingFromPreviousLayer) {
        if (safeZ > zStart + leadInAbove) {
          moves.push({ x: start.x, y: start.y, z: zStart + leadInAbove, type: "rapid" });
        }
        // Geen aparte rechte cut naar zStart meer; ramp start direct op rampStartZ
      }

      const n = path.length;
      if (n < 2 || requiredPathLength <= 1e-6) {
        moves.push({ x: start.x, y: start.y, z: depthZ, type: "cut" });
      } else {
        let dist = 0;
        let rampEndSeg = 0;
        let rampEndPoint = null;
        // Gesloten contour: segmenten (path[i], path[(i+1)%n]); meerdere rondes tot requiredPathLength
        rampLoop: while (true) {
          for (let i = 0; i < n; i++) {
            const a = path[i];
            const b = path[(i + 1) % n];
            const segLen = distance2D(a, b);
            if (segLen < 1e-9) continue;

            if (dist + segLen <= requiredPathLength) {
              dist += segLen;
              const z = rampStartZ + (depthZ - rampStartZ) * (dist / requiredPathLength);
              moves.push({ x: b.x, y: b.y, z, type: "cut" });
            } else {
              const remaining = requiredPathLength - dist;
              const t = remaining / segLen;
              const rx = a.x + t * (b.x - a.x);
              const ry = a.y + t * (b.y - a.y);
              rampEndPoint = { x: rx, y: ry };
              moves.push({ x: rx, y: ry, z: depthZ, type: "cut" });
              rampEndSeg = (i + 1) % n;
              break rampLoop;
            }
          }
        }

        if (rampEndPoint !== null) {
          if (isLastLayer) {
            if (tabConfig && tabConfig.enabled && tabConfig.totalLengthClosed != null) {
              const prevIdx = (rampEndSeg + n - 1) % n;
              const sRampEnd =
                tabConfig.cumulative[prevIdx] +
                distance2D(path[prevIdx], rampEndPoint);
              const eps = 1e-9;

              // Eerste deel: rampEndPoint → path[rampEndSeg]; op depthZ houden (geen tab-profiel) zodat geen plunge
              const sEndFirst = rampEndSeg === 0 ? tabConfig.totalLengthClosed : tabConfig.cumulative[rampEndSeg];
              const p0First = rampEndPoint;
              const p1First = path[rampEndSeg];
              const segLenFirst = sEndFirst - sRampEnd;
              const sListFirst = getTabBoundarySInSegment(sRampEnd, sEndFirst, tabConfig);
              for (const s of sListFirst) {
                if (s <= sRampEnd + eps) continue;
                const t = segLenFirst > 1e-12 ? (s - sRampEnd) / segLenFirst : 0;
                moves.push({
                  x: p0First.x + t * (p1First.x - p0First.x),
                  y: p0First.y + t * (p1First.y - p0First.y),
                  z: depthZ,
                  type: "cut",
                });
              }

              // Volle segmenten in wrap-volgorde met tab-profiel
              for (let k = 1; k < n; k++) {
                const idx = (rampEndSeg + k) % n;
                const nextIdx = (rampEndSeg + k + 1) % n;
                // Skip het ramp-segment (prevIdx -> rampEndSeg): dat is al afgehandeld in sListFirst en sListLast
                if (idx === prevIdx && nextIdx === rampEndSeg) continue;
                const sStart = tabConfig.cumulative[idx];
                const sEnd =
                  nextIdx === 0 ? tabConfig.totalLengthClosed : tabConfig.cumulative[nextIdx];
                const sList = getTabBoundarySInSegment(sStart, sEnd, tabConfig);
                const p0 = path[idx];
                const p1 = path[nextIdx];
                const segLen = sEnd - sStart;
                for (const s of sList) {
                  const t = segLen > 1e-12 ? (s - sStart) / segLen : 0;
                  moves.push({
                    x: p0.x + t * (p1.x - p0.x),
                    y: p0.y + t * (p1.y - p0.y),
                    z: getZForTabProfile(s, depthZ, tabConfig),
                    type: "cut",
                  });
                }
              }

              // Laatste deel: path[prevIdx] → rampEndPoint; daarna rampEndPoint om te sluiten
              const sListLast = getTabBoundarySInSegment(
                tabConfig.cumulative[prevIdx],
                sRampEnd,
                tabConfig
              );
              const p0Last = path[prevIdx];
              const segLenLast = sRampEnd - tabConfig.cumulative[prevIdx];
              for (const s of sListLast) {
                if (s >= sRampEnd - eps) continue;
                const t =
                  segLenLast > 1e-12
                    ? (s - tabConfig.cumulative[prevIdx]) / segLenLast
                    : 0;
                moves.push({
                  x: p0Last.x + t * (rampEndPoint.x - p0Last.x),
                  y: p0Last.y + t * (rampEndPoint.y - p0Last.y),
                  z: getZForTabProfile(s, depthZ, tabConfig),
                  type: "cut",
                });
              }
              moves.push({
                x: rampEndPoint.x,
                y: rampEndPoint.y,
                z: getZForTabProfile(sRampEnd, depthZ, tabConfig),
                type: "cut",
              });
            } else {
              for (let k = 0; k < n; k++) {
                const idx = (rampEndSeg + k) % n;
                const s = tabConfig ? tabConfig.cumulative[idx] : 0;
                const z = k === 0 ? depthZ : getZForTabProfile(s, depthZ, tabConfig);
                moves.push({ x: path[idx].x, y: path[idx].y, z, type: "cut" });
              }
              if (rampEndSeg !== 0) {
                const s =
                  rampEndSeg > 0 && tabConfig
                    ? tabConfig.cumulative[rampEndSeg - 1] +
                      distance2D(path[rampEndSeg - 1], rampEndPoint)
                    : 0;
                const zEnd = getZForTabProfile(s, depthZ, tabConfig);
                moves.push({
                  x: rampEndPoint.x,
                  y: rampEndPoint.y,
                  z: zEnd,
                  type: "cut",
                });
              }
            }
          } else {
            for (let s = rampEndSeg; s < n; s++) {
              moves.push({ x: path[s].x, y: path[s].y, z: depthZ, type: "cut" });
            }
            moves.push({ x: path[0].x, y: path[0].y, z: depthZ, type: "cut" });
          }
        }
      }
    }
  } else {
    // Plunge: verticale insteek (lead-in: alleen laatste leadInAbove mm als cut)
    if (!continuingFromPreviousLayer) {
      if (safeZ > leadInAbove) {
        moves.push({ x: entryStart.x, y: entryStart.y, z: leadInAbove, type: "rapid" });
      }
      moves.push({ x: entryStart.x, y: entryStart.y, z: 0, type: "cut" });
      moves.push({ x: entryStart.x, y: entryStart.y, z: depthZ, type: "cut" });
      if (plungeOutside) {
        addCurvedLeadIn(entryStart, start, path[1], depthZ);
      }
    } else {
      // Volgende laag: geen retract; op diepte (last.z) naar entryStart, dan plunge naar depthZ
      moves.push({ x: entryStart.x, y: entryStart.y, z: last.z, type: "cut" });
      moves.push({ x: entryStart.x, y: entryStart.y, z: depthZ, type: "cut" });
      if (plungeOutside) {
        addCurvedLeadIn(entryStart, start, path[1], depthZ);
      }
    }
  }

  // Nu volledige pad op deze diepte (tenzij we bij contour-ramp het pad al hebben gelopen)
  if (!pathAlreadyAtDepth) {
    const startIdx = skipFirstPathPoint ? 1 : 0;
    if (tabConfig && tabConfig.enabled && tabConfig.totalLengthClosed != null) {
      // Punten op exacte tab-grenzen zodat 50% vlak echt vlak is en ramps gelijke hoek hebben
      for (let i = startIdx; i < path.length - 1; i++) {
        const sStart = tabConfig.cumulative[i];
        const sEnd = tabConfig.cumulative[i + 1];
        const sList = getTabBoundarySInSegment(sStart, sEnd, tabConfig);
        const p0 = path[i];
        const p1 = path[i + 1];
        const segLen = sEnd - sStart;
        for (const s of sList) {
          const t = segLen > 1e-12 ? (s - sStart) / segLen : 0;
          const x = p0.x + t * (p1.x - p0.x);
          const y = p0.y + t * (p1.y - p0.y);
          const z = getZForTabProfile(s, depthZ, tabConfig);
          moves.push({ x, y, z, type: "cut" });
        }
      }
    } else {
      const useTabsHere = !!tabConfig && depthZ < (tabConfig.tabZ + 1e-6);
      for (let i = startIdx; i < path.length; i++) {
        const p = path[i];
        let z = depthZ;
        if (useTabsHere && tabConfig && tabConfig.enabled) {
          const s = tabConfig.cumulative[i];
          const inTab =
            s >= 0 &&
            s <= tabConfig.totalLength &&
            tabConfig.ranges.some((r) => s >= r.start && s <= r.end);
          if (inTab && depthZ < tabConfig.tabZ) {
            z = tabConfig.tabZ;
          }
        }
        moves.push({ x: p.x, y: p.y, z, type: "cut" });
      }
    }
  }
}

/**
 * Origin-transformatie op moves toepassen (XY en Z).
 * @param {ToolpathMove[]} moves
 * @param {*} originParams
 * @param {number} totalDepth
 * @param {number} toolRadiusForXYShift
 * @param {string} operation
 * @param {string} contourType
 * @param {{ hw: number, hh: number } | null} [facingBounds] - bij facing: halve breedte/hoogte van het vlak; (0,0) wordt de hoek van het oppervlak
 * @param {boolean} [skipXYShift] - true bij DXF: contouren zijn al in origin-ruimte, geen extra XY-shift
 */
function applyOriginTransform(
  moves,
  originParams,
  totalDepth,
  toolRadiusForXYShift,
  operation,
  contourType,
  facingBounds,
  skipXYShift
) {
  const { shiftX, shiftY, zOffset, zOriginMode } = computeOriginShift(
    moves,
    originParams,
    totalDepth,
    toolRadiusForXYShift,
    operation,
    contourType,
    facingBounds,
    skipXYShift
  );
  moves.forEach((m) => {
    m.x += shiftX;
    m.y += shiftY;
    let z = m.z;
    if (zOriginMode === ZOrigin.STOCK_BOTTOM) {
      z += totalDepth;
    }
    z += zOffset;
    m.z = z;
  });
}

/**
 * Cirkel door 3 punten (xy). Retourneert { cx, cy, r } of null als collinear.
 * Formule: circumcenter van de driehoek.
 */
function circleFromThreePoints(p1, p2, p3) {
  const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y, x3 = p3.x, y3 = p3.y;
  const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  if (Math.abs(d) < 1e-10) return null;
  const cx = ((x1 * x1 + y1 * y1) * (y2 - y3) + (x2 * x2 + y2 * y2) * (y3 - y1) + (x3 * x3 + y3 * y3) * (y1 - y2)) / d;
  const cy = ((x1 * x1 + y1 * y1) * (x3 - x2) + (x2 * x2 + y2 * y2) * (x1 - x3) + (x3 * x3 + y3 * y3) * (x2 - x1)) / d;
  const r = Math.hypot(x1 - cx, y1 - cy);
  return { cx, cy, r };
}

/**
 * Afwijking van punt t.o.v. cirkel (abs(afstand tot middelpunt - straal)).
 */
function pointToCircleDeviation(px, py, cx, cy, r) {
  return Math.abs(Math.hypot(px - cx, py - cy) - r);
}

/**
 * Probeer een gesloten (bijna) cirkel-run om te zetten naar 2 halve bogen.
 * Geeft null terug als de run niet voldoende cirkelvormig is.
 * @param {{ x: number, y: number, z: number }[]} points
 * @returns {{ type: 'arc', x: number, y: number, z: number, i: number, j: number, clockwise: boolean }[] | null}
 */
function tryFitClosedCircleAsTwoArcs(points) {
  if (!points || points.length < 8) return null;
  const z = points[0].z;
  const pts = points.slice();
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closeDist = Math.hypot(last.x - first.x, last.y - first.y);
  if (closeDist < 1e-6) pts.pop();
  if (pts.length < 7) return null;

  const n = pts.length;
  const p0 = pts[0];
  const p1 = pts[Math.floor(n / 3)];
  const p2 = pts[Math.floor((2 * n) / 3)];
  const c = circleFromThreePoints(p0, p1, p2);
  if (!c || !Number.isFinite(c.r) || c.r <= 0) return null;

  const CIRCLE_TOL_MM = Math.max(0.25, c.r * 0.01);
  for (let i = 0; i < n; i++) {
    if (pointToCircleDeviation(pts[i].x, pts[i].y, c.cx, c.cy, c.r) > CIRCLE_TOL_MM) return null;
  }

  // Kies punt ongeveer tegenover startpunt.
  let midIdx = Math.floor(n / 2);
  let bestErr = Number.POSITIVE_INFINITY;
  for (let i = 1; i < n - 1; i++) {
    const dot = (pts[i].x - c.cx) * (p0.x - c.cx) + (pts[i].y - c.cy) * (p0.y - c.cy);
    const err = Math.abs(dot + c.r * c.r);
    if (err < bestErr) {
      bestErr = err;
      midIdx = i;
    }
  }
  const pmid = pts[midIdx];
  if (!pmid) return null;
  if (Math.hypot(pmid.x - p0.x, pmid.y - p0.y) < 1e-4) return null;

  // Draairichting op basis van lokale tangent.
  const d1 = pts[1];
  const d2 = pts[2];
  if (!d1 || !d2) return null;
  const crossPath = (d1.x - p0.x) * (d2.y - d1.y) - (d1.y - p0.y) * (d2.x - d1.x);
  const clockwise = crossPath < 0;

  return [
    {
      type: "arc",
      x: pmid.x,
      y: pmid.y,
      z,
      i: c.cx - p0.x,
      j: c.cy - p0.y,
      clockwise,
    },
    {
      type: "arc",
      x: p0.x,
      y: p0.y,
      z,
      i: c.cx - pmid.x,
      j: c.cy - pmid.y,
      clockwise,
    },
  ];
}

/** Max afwijking (mm) om een reeks punten als cirkelboog te accepteren; wat ruimer voor Bézier-benaderingen */
const ARC_FIT_TOLERANCE_MM = 0.2;

/**
 * Vervang reeksen cut-bewegingen in de move-lijst door arc-bewegingen waar mogelijk.
 * Wijzigt de array in plaats; voegt move type 'arc' toe.
 * @param {ToolpathMove[]} moves
 */
function replaceCutRunsWithArcs(moves) {
  const out = [];
  const Z_TOL = 1e-4;
  /** @type {{ x: number, y: number, z: number }[]} */
  let cutRun = [];
  let runZ = null;

  function flushCutRun() {
    if (!cutRun.length) return;
    const circleArcs = tryFitClosedCircleAsTwoArcs(cutRun);
    const fitted = circleArcs ?? fitArcsToPoints(cutRun);
    for (const seg of fitted) {
      if (seg.type === "arc") {
        out.push({
          x: seg.x,
          y: seg.y,
          z: seg.z,
          type: "arc",
          i: seg.i,
          j: seg.j,
          clockwise: seg.clockwise,
        });
      } else {
        out.push({ x: seg.x, y: seg.y, z: seg.z, type: "cut" });
      }
    }
    cutRun = [];
    runZ = null;
  }

  for (const m of moves) {
    if (m.type !== "cut") {
      flushCutRun();
      out.push(m);
      continue;
    }
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || !Number.isFinite(m.z)) {
      flushCutRun();
      out.push(m);
      continue;
    }
    if (runZ == null || Math.abs(m.z - runZ) <= Z_TOL) {
      cutRun.push({ x: m.x, y: m.y, z: m.z });
      if (runZ == null) runZ = m.z;
      continue;
    }
    flushCutRun();
    cutRun.push({ x: m.x, y: m.y, z: m.z });
    runZ = m.z;
  }
  flushCutRun();
  moves.length = 0;
  moves.push(...out);
}

/**
 * Consecutieve cut-bewegingen op dezelfde Z omzetten naar een mix van G1 en G2/G3.
 * @param {{ x: number, y: number, z: number }[]} points
 * @returns {{ type: 'line'|'arc', x: number, y: number, z: number, i?: number, j?: number, clockwise?: boolean }[]}
 */
function fitArcsToPoints(points) {
  if (points.length < 3) {
    return points.map((p) => ({ type: "line", ...p }));
  }
  const ARC_MIN_CHORD_MM = 1e-6;
  const ARC_MAX_SWEEP_RAD = Math.PI * 1.02; // vermijd (bijna) volledige cirkel in 1 boog
  const result = [];
  let i = 0;
  const z = points[0].z;

  function normalizedCcwSweep(aStart, aEnd) {
    let d = aEnd - aStart;
    while (d < 0) d += Math.PI * 2;
    while (d >= Math.PI * 2) d -= Math.PI * 2;
    return d;
  }

  while (i < points.length) {
    if (i >= points.length - 2) {
      result.push({ type: "line", ...points[i] });
      i++;
      continue;
    }
    const p0 = points[i];
    let bestJ = i + 2;
    for (let j = i + 3; j <= points.length; j++) {
      const pMid = points[Math.floor((i + j) / 2)];
      const pEnd = points[j - 1];
      // Vermijd full-circle/degenereerde bogen met praktisch gelijke start/eindpunt.
      if (Math.hypot(pEnd.x - p0.x, pEnd.y - p0.y) <= ARC_MIN_CHORD_MM) {
        break;
      }
      const circle = circleFromThreePoints(p0, pMid, pEnd);
      if (!circle) break;
      const a0 = Math.atan2(p0.y - circle.cy, p0.x - circle.cx);
      const a1 = Math.atan2(pMid.y - circle.cy, pMid.x - circle.cx);
      const a2 = Math.atan2(pEnd.y - circle.cy, pEnd.x - circle.cx);
      const crossDir = (p0.x - circle.cx) * (pEnd.y - circle.cy) - (p0.y - circle.cy) * (pEnd.x - circle.cx);
      const isClockwise = crossDir < 0;
      const ccwSweep = normalizedCcwSweep(a0, a2);
      const sweep = isClockwise ? (Math.PI * 2 - ccwSweep) : ccwSweep;
      // Grote sweeps (richting 360°) in 1 boog worden door veel controllers verkeerd geïnterpreteerd.
      if (sweep > ARC_MAX_SWEEP_RAD) break;
      let ok = true;
      for (let k = i + 1; k < j - 1 && ok; k++) {
        if (pointToCircleDeviation(points[k].x, points[k].y, circle.cx, circle.cy, circle.r) > ARC_FIT_TOLERANCE_MM) {
          ok = false;
        }
      }
      if (!ok) break;
      bestJ = j;
    }
    if (bestJ > i + 2) {
      const pEnd = points[bestJ - 1];
      const pMid = points[Math.floor((i + bestJ) / 2)];
      if (Math.hypot(pEnd.x - p0.x, pEnd.y - p0.y) <= ARC_MIN_CHORD_MM) {
        result.push({ type: "line", ...p0 });
        i++;
        continue;
      }
      const circle = circleFromThreePoints(p0, pMid, pEnd);
      if (circle) {
        const dx = p0.x - circle.cx;
        const dy = p0.y - circle.cy;
        const ex = pEnd.x - circle.cx;
        const ey = pEnd.y - circle.cy;
        const cross = dx * ey - dy * ex;
        result.push({
          type: "arc",
          x: pEnd.x,
          y: pEnd.y,
          z,
          i: circle.cx - p0.x,
          j: circle.cy - p0.y,
          clockwise: cross < 0,
        });
        i = bestJ;
        continue;
      }
    }
    result.push({ type: "line", ...p0 });
    i++;
  }
  return result;
}

/**
 * @param {string} shape
 * @returns {boolean}
 */
function isBasicShapeType(shape) {
  return shape === ShapeType.CIRCLE
    || shape === ShapeType.SQUARE
    || shape === ShapeType.RECTANGLE
    || shape === ShapeType.HEXAGON
    || shape === ShapeType.ELLIPSE;
}

/**
 * @param {string} shape
 * @returns {string}
 */
function getGcodeShapeLabel(shape) {
  switch (shape) {
    case ShapeType.CIRCLE: return t("form.shapeCircle");
    case ShapeType.SQUARE: return t("form.shapeSquare");
    case ShapeType.RECTANGLE: return t("form.shapeRectangle");
    case ShapeType.HEXAGON: return t("form.shapeHexagon");
    case ShapeType.ELLIPSE: return t("form.shapeEllipse");
    default: return "";
  }
}

/**
 * G-code header-comment met freesdiameter en eenheid.
 * @param {*} cutParams
 * @param {boolean} useInch
 * @param {number} decimals
 * @returns {string|null}
 */
function formatGcodeToolDiameterComment(cutParams, useInch, decimals) {
  const diameterMm = cutParams?.toolDiameter;
  if (!Number.isFinite(diameterMm) || diameterMm <= 0) return null;
  const diameter = useInch ? fromMm(diameterMm, "inch") : diameterMm;
  const unitLabel = useInch ? t("gcode.comment.unitsInch") : t("gcode.comment.unitsMm");
  return `(${t("gcode.comment.toolDiameter", { value: diameter.toFixed(decimals), unit: unitLabel })})`;
}

/**
 * Leesbare operatienaam voor G-code header-comment.
 * @param {*} params
 * @returns {string}
 */
function getGcodeOperationLabel(params) {
  const { shape, operation, contourType, shapeParams } = params;
  if (shape === ShapeType.LETTERS) {
    return `${t("form.shapeLetters")} - ${t("form.letterModeOutline")}`;
  }
  if (shape === ShapeType.COUNTERBORE_BOLT) return t("form.shapeCounterboreBolt");
  if (shape === ShapeType.THREAD_MILLING) {
    const type = shapeParams?.threadMillType === ThreadMillType.EXTERNAL
      ? t("form.threadMillTypeExternal")
      : t("form.threadMillTypeInternal");
    return `${t("form.shapeThreadMilling")} - ${type}`;
  }
  if (shape === ShapeType.PATTERNED_HOLES) {
    return `${t("form.shapePatternedHoles")} - ${t("form.operationPocket")}`;
  }
  if (shape === ShapeType.CIRCULAR_PATTERN_HOLES) {
    const opLabel = operation === OperationType.CONTOUR
      ? t("form.operationContour")
      : t("form.operationPocket");
    return `${t("form.shapePatternedHoles")} - ${opLabel}`;
  }
  if (shape === ShapeType.DXF) {
    const opLabel = operation === OperationType.POCKET
      ? t("form.operationPocket")
      : (contourType === "engraving" ? t("form.contourEngraving") : t("form.operationContour"));
    return `${t("form.shapeDxf")} - ${opLabel}`;
  }
  if (shape === ShapeType.FACING || operation === OperationType.FACING) return t("form.operationFacing");
  let opLabel = "";
  if (operation === OperationType.POCKET) {
    opLabel = t("form.operationPocket");
  } else if (operation === OperationType.CONTOUR) {
    if (contourType === "inside") opLabel = t("form.contourInside");
    else if (contourType === "engraving") opLabel = t("form.contourEngraving");
    else opLabel = t("form.contourOutside");
  } else {
    return operation || "";
  }
  if (isBasicShapeType(shape)) {
    return `${opLabel} - ${getGcodeShapeLabel(shape)}`;
  }
  return opLabel;
}

/**
 * G-code moves schrijven (gedeeld door enkelvoudige en gekoppelde jobs).
 * @param {string[]} lines
 * @param {ToolpathMove[]} moves
 * @param {*} cutParams
 * @param {object} ctx
 */
function appendToolpathMovesAsGcode(lines, moves, cutParams, ctx) {
  const {
    useInch, decimals, feedrate, mirrorX, mirrorY, mirrorFlipsArcDir,
  } = ctx;
  let { currentFeed, currentFeedOverridePct, currentX, currentY } = ctx;
  const ARC_RADIUS_TOL_MM = 1.0;
  const ARC_MIN_CHORD_MM = 1e-6;

  function outCoord(v) {
    if (v == null || !Number.isFinite(v)) return null;
    const val = useInch ? fromMm(v, "inch") : v;
    return val.toFixed(decimals);
  }
  function tx(x) {
    if (!Number.isFinite(x)) return x;
    return mirrorX ? -x : x;
  }
  function ty(y) {
    if (!Number.isFinite(y)) return y;
    return mirrorY ? -y : y;
  }
  function clampFeedOverridePct(value) {
    if (!Number.isFinite(value)) return 100;
    return Math.max(5, Math.min(200, Math.round(value)));
  }

  let idx = 0;
  while (idx < moves.length) {
    const m = moves[idx];
    if (m.type === "pause") {
      const pauseZ = useInch ? fromMm(cutParams.safeHeight ?? DEFAULT_SAFE_Z, "inch") : (cutParams.safeHeight ?? DEFAULT_SAFE_Z);
      lines.push(`G0 Z${pauseZ.toFixed(decimals)}`);
      lines.push(`(${t("gcode.comment.dxfSupportPause")})`);
      lines.push("M0");
      idx++;
      continue;
    }
    const targetFeedOverridePct = m.type === "cut" ? clampFeedOverridePct(m.feedOverridePct ?? 100) : 100;
    if (targetFeedOverridePct !== currentFeedOverridePct) {
      lines.push(`M220 S${targetFeedOverridePct}`);
      currentFeedOverridePct = targetFeedOverridePct;
      currentFeed = 0;
    }
    const x = Number.isFinite(m.x) ? tx(m.x) : null;
    const y = Number.isFinite(m.y) ? ty(m.y) : null;
    const z = Number.isFinite(m.z) ? m.z : null;

    if (m.type === "rapid") {
      const xs = x != null ? `X${outCoord(x)}` : "";
      const ys = y != null ? `Y${outCoord(y)}` : "";
      const zs = z != null ? `Z${outCoord(z)}` : "";
      lines.push(`G0 ${xs} ${ys} ${zs}`.trim());
      if (x != null) currentX = x;
      if (y != null) currentY = y;
      idx++;
      continue;
    }
    const xs = x != null ? `X${outCoord(x)}` : "";
    const ys = y != null ? `Y${outCoord(y)}` : "";
    const zs = z != null ? ` Z${outCoord(z)}` : "";
    let line = `G1 ${xs} ${ys}${zs}`.trim();
    if (m.type === "arc" && Number.isFinite(m.i) && Number.isFinite(m.j) && currentX != null && currentY != null && x != null && y != null) {
      const iVal = mirrorX ? -m.i : m.i;
      const jVal = mirrorY ? -m.j : m.j;
      const cx = currentX + iVal;
      const cy = currentY + jVal;
      const rStart = Math.hypot(currentX - cx, currentY - cy);
      const rEnd = Math.hypot(x - cx, y - cy);
      const chord = Math.hypot(x - currentX, y - currentY);
      const arcValid = chord > ARC_MIN_CHORD_MM && Math.abs(rStart - rEnd) <= ARC_RADIUS_TOL_MM;
      if (arcValid) {
        const gCode = (m.clockwise ^ mirrorFlipsArcDir) ? "G2" : "G3";
        line = `${gCode} ${xs} ${ys}${zs} I${outCoord(iVal)} J${outCoord(jVal)}`.trim();
      }
    }
    if (feedrate && feedrate !== currentFeed) {
      line += ` F${(useInch ? feedrate : cutParams.feedrate).toFixed(useInch ? 2 : 0)}`;
      currentFeed = feedrate;
    }
    lines.push(line);
    if (x != null) currentX = x;
    if (y != null) currentY = y;
    idx++;
  }

  ctx.currentFeed = currentFeed;
  ctx.currentFeedOverridePct = currentFeedOverridePct;
  ctx.currentX = currentX;
  ctx.currentY = currentY;
}

/**
 * G-code voor meerdere gekoppelde stappen (één header/footer, geen toolwissel).
 * @param {{ toolpath: Toolpath, params: * }[]} steps
 */
function jobToolpathsToGcode(steps) {
  if (!steps.length) return "";
  const firstParams = steps[0].params;
  const cutParams = firstParams.cutParams;
  const unit = getDisplayUnit();
  const useInch = unit === "inch";
  const safeZMm = cutParams.safeHeight ?? DEFAULT_SAFE_Z;
  const safeZ = useInch ? fromMm(safeZMm, "inch") : safeZMm;
  const decimals = useInch ? 4 : 3;
  const feedrate = cutParams.feedrate && cutParams.feedrate > 0
    ? (useInch ? cutParams.feedrate / MM_PER_INCH : cutParams.feedrate)
    : 0;
  const lines = [];
  const mirrorX = !!cutParams.mirrorXEnabled;
  const mirrorY = !!cutParams.mirrorYEnabled;
  const mirrorFlipsArcDir = (mirrorX ? 1 : 0) + (mirrorY ? 1 : 0) === 1;

  lines.push(`(${t("gcode.comment.generated", { url: GCODE_TOOLBOX_URL })})`);
  lines.push(`(${t("gcode.comment.useAtOwnRisk")})`);
  const toolDiameterComment = formatGcodeToolDiameterComment(cutParams, useInch, decimals);
  if (toolDiameterComment) lines.push(toolDiameterComment);
  lines.push(`(${t("gcode.comment.operation", { name: getGcodeOperationLabel(firstParams) })})`);
  lines.push(useInch ? `G20  (${t("gcode.comment.unitsInch")})` : `G21  (${t("gcode.comment.unitsMm")})`);
  lines.push(`G90  (${t("gcode.comment.absolute")})`);
  lines.push(`G0 Z${safeZ.toFixed(decimals)}`);
  const spindleCmd = cutParams.spindleSpeedEnabled && cutParams.spindleSpeed
    ? `M3 S${Math.round(cutParams.spindleSpeed)}  (${t("gcode.comment.spindleOn")})`
    : `M3  (${t("gcode.comment.spindleOn")})`;
  lines.push(spindleCmd);
  if (cutParams.mistCoolantEnabled) lines.push(`M7  (${t("gcode.comment.coolantMistOn")})`);
  if (cutParams.floodCoolantEnabled) lines.push(`M8  (${t("gcode.comment.coolantFloodOn")})`);

  /** @type {object} */
  const ctx = {
    useInch,
    decimals,
    feedrate,
    mirrorX,
    mirrorY,
    mirrorFlipsArcDir,
    currentFeed: 0,
    currentFeedOverridePct: 100,
    currentX: null,
    currentY: null,
  };

  steps.forEach((step, stepIndex) => {
    const stepCut = step.params.cutParams;
    if (stepIndex > 0) {
      lines.push(`G0 Z${safeZ.toFixed(decimals)}`);
      lines.push(`(${t("gcode.comment.operation", { name: getGcodeOperationLabel(step.params) })})`);
    }
    ctx.feedrate = stepCut.feedrate && stepCut.feedrate > 0
      ? (useInch ? stepCut.feedrate / MM_PER_INCH : stepCut.feedrate)
      : 0;
    ctx.currentFeed = 0;
    /** @type {ToolpathMove[]} */
    const moves = step.toolpath.moves.map((m) => ({ ...m }));
    if (stepCut.useArcsEnabled) {
      replaceCutRunsWithArcs(moves);
    }
    appendToolpathMovesAsGcode(lines, moves, stepCut, ctx);
  });

  if (ctx.currentFeedOverridePct !== 100) {
    lines.push("M220 S100");
  }
  lines.push(`G0 Z${safeZ.toFixed(decimals)}`);
  if (cutParams.mistCoolantEnabled || cutParams.floodCoolantEnabled) lines.push(`M9  (${t("gcode.comment.coolantOff")})`);
  lines.push(`M5  (${t("gcode.comment.spindleOff")})`);
  lines.push("M30");

  return lines.join("\n");
}

/**
 * G-code genereren uit toolpath. Cut-reeksen op dezelfde Z worden waar mogelijk als G2/G3-bogen uitgevoerd.
 * Gebruikt de geselecteerde eenheid (mm of inch): bij inch wordt G20 en alle coördinaten/F in inches uitgevoerd.
 * @param {Toolpath} toolpath
 * @param {*} params
 */
function toolpathToGcode(toolpath, params) {
  return jobToolpathsToGcode([{ toolpath, params }]);
}

/** Typische snelle verplaatsing (G0) in mm/min voor tijdsinschatting. */
const DEFAULT_RAPID_FEEDRATE_MM_MIN = 10000;

/**
 * Schat de freesduur op basis van toolpath en feedrate.
 * @param {Toolpath} toolpath
 * @param {{ feedrate: number }} cutParams
 * @returns {{ totalMinutes: number, cutMinutes: number, rapidMinutes: number, cutDistanceMm: number, rapidDistanceMm: number }}
 */
function estimateMillingTime(toolpath, cutParams) {
  const feedrate = cutParams.feedrate && cutParams.feedrate > 0 ? cutParams.feedrate : 1;
  const rapidFeed = DEFAULT_RAPID_FEEDRATE_MM_MIN;
  let cutDist = 0;
  let rapidDist = 0;
  let prev = null;
  for (const m of toolpath.moves) {
    const x = Number.isFinite(m.x) ? m.x : 0;
    const y = Number.isFinite(m.y) ? m.y : 0;
    const z = Number.isFinite(m.z) ? m.z : 0;
    if (prev != null) {
      const dx = x - prev.x;
      const dy = y - prev.y;
      const dz = z - prev.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (m.type === "cut") {
        cutDist += d;
      } else {
        rapidDist += d;
      }
    }
    prev = { x, y, z };
  }
  const cutMinutes = cutDist / feedrate;
  const rapidMinutes = rapidDist / rapidFeed;
  const totalMinutes = cutMinutes + rapidMinutes;
  return {
    totalMinutes,
    cutMinutes,
    rapidMinutes,
    cutDistanceMm: cutDist,
    rapidDistanceMm: rapidDist,
  };
}

/**
 * Formatteer geschatte tijd als leesbare string (bijv. "2 min" of "1 u 15 min").
 * @param {number} totalMinutes
 * @returns {string}
 */
function formatEstimatedTime(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return "—";
  if (totalMinutes < 1) {
    const sec = Math.round(totalMinutes * 60);
    return sec <= 0 ? t("preview.estimatedTimeUnder1Min") : t("preview.estimatedTimeSec", { sec });
  }
  if (totalMinutes < 60) {
    return t("preview.estimatedTimeMin", { min: Math.round(totalMinutes) });
  }
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return t("preview.estimatedTimeHMin", { h, m });
}

/**
 * Bepaal of de gegeven G-code in inches (G20) of mm (G21) is.
 * @param {string} gcodeText
 * @returns {"inch" | "mm"}
 */
function getGcodeUnitFromText(gcodeText) {
  if (!gcodeText || typeof gcodeText !== "string") return "mm";
  const lines = gcodeText.split("\n").slice(0, 20);
  for (const line of lines) {
    if (/G20\b/.test(line.trim())) return "inch";
    if (/G21\b/.test(line.trim())) return "mm";
  }
  return "mm";
}

/**
 * Haal X, Y, Z uit één G-code regel (bijv. "G1 X25.000 Y25.000 Z-1.000").
 * @param {string} line
 * @returns {{ x: number, y: number, z: number } | null} machinecoördinaten in mm, of null als geen X/Y
 */
function parseGcodeLineForPoint(line) {
  if (!line || typeof line !== "string") return null;
  const trimmed = line.trim();
  const xMatch = trimmed.match(/X\s*([-\d.]+)/i);
  const yMatch = trimmed.match(/Y\s*([-\d.]+)/i);
  const zMatch = trimmed.match(/Z\s*([-\d.]+)/i);
  const x = xMatch ? Number(xMatch[1].replace(",", ".")) : NaN;
  const y = yMatch ? Number(yMatch[1].replace(",", ".")) : NaN;
  const z = zMatch ? Number(zMatch[1].replace(",", ".")) : 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y,
    z: Number.isFinite(z) ? z : 0,
  };
}

/**
 * Normaliseert preview-resultaten naar items met per-pad contourInside.
 * @param {Toolpath} toolpath
 * @returns {{ path: {x:number,y:number,z:number}[], topZ: number, bottomZ: number, contourInside: boolean }[]}
 */
function getResultPreviewItems(toolpath) {
  const defaultInside = toolpath.resultContourInside !== false;
  const resultTotalDepth = toolpath.resultTotalDepth;
  const resultBottomZ = toolpath.resultBottomZ;
  const topZDefault = resultBottomZ === 0 ? (resultTotalDepth ?? 0) : 0;
  const bottomZDefault = Number.isFinite(resultBottomZ) ? resultBottomZ : -(resultTotalDepth ?? 0);

  if (toolpath.resultPathsWithDepth && toolpath.resultPathsWithDepth.length > 0) {
    return toolpath.resultPathsWithDepth
      .filter((item) => item?.path && item.path.length >= 2)
      .map((item) => ({
        path: item.path,
        topZ: item.topZ,
        bottomZ: item.bottomZ,
        contourInside: item.contourInside !== undefined ? item.contourInside !== false : defaultInside,
      }));
  }
  if (toolpath.resultPaths && toolpath.resultPaths.length > 0) {
    return toolpath.resultPaths
      .filter((path) => path && path.length >= 2)
      .map((path) => ({
        path,
        topZ: topZDefault,
        bottomZ: bottomZDefault,
        contourInside: defaultInside,
      }));
  }
  return [];
}

/**
 * Voegt een gesloten resultaatcontour toe aan het huidige canvas-pad (TOP-view).
 */
function appendResultPathToTopContext(ctx, path, topZ, projectPoint, toCanvas, cx, cy, cz, depthScale) {
  const pts = path.map((p) => ({ x: p.x, y: p.y }));
  const closed = pts.length >= 3
    && Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-9
    && Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-9;
  const n = closed ? pts.length - 1 : pts.length;
  if (n < 2) return;
  const p0 = projectPoint(pts[0].x - cx, pts[0].y - cy, (cz - topZ) * depthScale);
  const c0 = toCanvas(p0);
  ctx.moveTo(c0.x, c0.y);
  for (let i = 1; i < n; i++) {
    const p = projectPoint(pts[i].x - cx, pts[i].y - cy, (cz - topZ) * depthScale);
    const c = toCanvas(p);
    ctx.lineTo(c.x, c.y);
  }
  ctx.closePath();
}

/**
 * Preview tekenen op canvas.
 * @param {Toolpath} toolpath
 * @param {HTMLCanvasElement} canvas
 * @param {keyof typeof PreviewViewMode} [viewMode]
 * @param {{ x: number, y: number, z: number, diameter: number } | null} [cursorColumn] optionele kolom: midden onderkant op dit punt, hoogte 50 mm, diameter = freesdikte
 */
function renderPreview(toolpath, canvas, viewMode = currentPreviewView, cursorColumn = null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!toolpath.moves.length) return;

  // 3D/2D-wireframe weergave: afhankelijk van viewMode projecteren.
  const angleZ = degToRad(45); // voor isometrische weergave
  const angleX = degToRad(60);
  const DEPTH_SCALE = 2; // diepte iets overdrijven zodat het beter opvalt

  /** @type {{ x:number, y:number, type:'rapid'|'cut' }[]} */
  const projected = [];

  // Eerst alle punten omzetten naar een gecentreerd 3D-coördinatenstelsel.
  let minX0 = Infinity;
  let minY0 = Infinity;
  let minZ0 = Infinity;
  let maxX0 = -Infinity;
  let maxY0 = -Infinity;
  let maxZ0 = -Infinity;

  toolpath.moves.forEach((m) => {
    if (
      !Number.isFinite(m.x) ||
      !Number.isFinite(m.y) ||
      !Number.isFinite(m.z)
    ) {
      return;
    }
    if (m.x < minX0) minX0 = m.x;
    if (m.y < minY0) minY0 = m.y;
    if (m.z < minZ0) minZ0 = m.z;
    if (m.x > maxX0) maxX0 = m.x;
    if (m.y > maxY0) maxY0 = m.y;
    if (m.z > maxZ0) maxZ0 = m.z;
  });

  if (
    !isFinite(minX0) ||
    !isFinite(minY0) ||
    !isFinite(minZ0) ||
    !isFinite(maxX0) ||
    !isFinite(maxY0) ||
    !isFinite(maxZ0)
  ) {
    return;
  }

  const cx = (minX0 + maxX0) / 2;
  const cy = (minY0 + maxY0) / 2;
  const cz = (minZ0 + maxZ0) / 2;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function projectPoint(x, y, z) {
    // z komt hier al geschaald binnen
    switch (viewMode) {
      case PreviewViewMode.TOP:
        // Bovenaanzicht: gewoon XY
        return { x, y };
      case PreviewViewMode.FRONT:
        // Voor: X horizontaal, Z verticaal
        return { x, y: -z };
      case PreviewViewMode.SIDE:
        // Zijkant: Y horizontaal, Z verticaal
        return { x: y, y: -z };
      case PreviewViewMode.ISO:
      default: {
        // Isometrische projectie met rotaties
        const cosZ = Math.cos(angleZ);
        const sinZ = Math.sin(angleZ);
        const x1 = x * cosZ - y * sinZ;
        const y1 = x * sinZ + y * cosZ;
        const z1 = z;

        const cosX = Math.cos(angleX);
        const sinX = Math.sin(angleX);
        const y2 = y1 * cosX - z1 * sinX;
        // const z2 = y1 * sinX + z1 * cosX; // kan later voor shading gebruikt worden
        const x2 = x1;
        return { x: x2, y: y2 };
      }
    }
  }

  toolpath.moves.forEach((m, idx) => {
    if (m.type === "pause") {
      projected[idx] = null;
      return;
    }
    if (
      !Number.isFinite(m.x) ||
      !Number.isFinite(m.y) ||
      !Number.isFinite(m.z)
    ) {
      projected[idx] = null;
      return;
    }

    // Centreer rond (0,0,0) en schaal diepte
    const x = m.x - cx;
    const y = m.y - cy;
    // Inverseer Z zodat "dieper in het materiaal" visueel logischer wordt
    const z = (cz - m.z) * DEPTH_SCALE;

    const p = projectPoint(x, y, z);

    projected[idx] = { x: p.x, y: p.y, type: m.type };

    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });

  // Voor TOP-view: voeg de resultaatvorm toe aan de view-bounds, zonder minX0/maxX0
  // (die worden gebruikt voor dimensies). Zo voorkom je clipping zonder maatfout.
  if (viewMode === PreviewViewMode.TOP) {
    const previewResultPathsWithDepth = toolpath.resultPathsWithDepth;
    const previewResultPaths = toolpath.resultPaths;
    const previewUsePathsWithDepth = previewResultPathsWithDepth && previewResultPathsWithDepth.length > 0;
    const previewPathsToUse = previewUsePathsWithDepth
      ? previewResultPathsWithDepth.map((p) => p.path)
      : previewResultPaths;
    if (previewPathsToUse && previewPathsToUse.length > 0) {
      previewPathsToUse.forEach((path) => {
        if (!path || path.length === 0) return;
        path.forEach((pt) => {
          if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
          const p = projectPoint(pt.x - cx, pt.y - cy, (cz - 0) * DEPTH_SCALE);
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        });
      });
    }
  }

  // Zorg dat de origin (0,0,0) altijd binnen de view-bounds valt
  const originProjected = projectPoint(0 - cx, 0 - cy, (cz - 0) * DEPTH_SCALE);
  if (originProjected.x < minX) minX = originProjected.x;
  if (originProjected.y < minY) minY = originProjected.y;
  if (originProjected.x > maxX) maxX = originProjected.x;
  if (originProjected.y > maxY) maxY = originProjected.y;

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    return;
  }

  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  // 10% marge rond de content (content past in 80% van het canvas)
  const usableW = canvas.width * 0.8;
  const usableH = canvas.height * 0.8;
  const scale = Math.min(usableW / width, usableH / height);

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  function toCanvas(p) {
    const xNorm = (p.x - (minX + maxX) / 2) * scale;
    const yNorm = (p.y - (minY + maxY) / 2) * scale;
    return {
      x: centerX + xNorm,
      y: centerY - yNorm,
    };
  }

  // Achtergrond-raster licht
  ctx.save();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
  ctx.lineWidth = 1;
  const gridSpacing = 20;
  for (let x = 0; x <= canvas.width; x += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.restore();

  // 2.5D gefreesd resultaat tekenen (bodem + zijwanden)
  const resultTotalDepth = toolpath.resultTotalDepth;
  const resultBottomZ = toolpath.resultBottomZ;
  const resultContourInside = toolpath.resultContourInside;
  const previewItems = getResultPreviewItems(toolpath);
  if (previewItems.length > 0 && Number.isFinite(resultTotalDepth)) {
    const topZ = resultBottomZ === 0 ? resultTotalDepth : 0;
    const bottomZ = resultBottomZ;
    const isLightTheme = typeof document !== "undefined" && document.body?.dataset.theme === "light";
    const fillColor = isLightTheme ? "rgba(200, 210, 220, 0.5)" : "rgba(220, 225, 235, 0.45)";
    const strokeColor = isLightTheme ? "rgba(175, 185, 195, 0.4)" : "rgba(200, 208, 218, 0.35)";
    const wallColor = isLightTheme ? "rgba(180, 190, 200, 0.35)" : "rgba(200, 210, 220, 0.3)";

    const outsideItems = previewItems.filter((item) => !item.contourInside);
    const insideItems = previewItems.filter((item) => item.contourInside);

    if (viewMode === PreviewViewMode.TOP) {
      ctx.save();
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;

      if (outsideItems.length > 0) {
        ctx.beginPath();
        outsideItems.forEach((item) => {
          appendResultPathToTopContext(ctx, item.path, item.topZ, projectPoint, toCanvas, cx, cy, cz, DEPTH_SCALE);
        });
        ctx.fill();
      }

      if (insideItems.length > 0) {
        if (outsideItems.length > 0) {
          ctx.save();
          ctx.globalCompositeOperation = "destination-out";
          ctx.beginPath();
          insideItems.forEach((item) => {
            appendResultPathToTopContext(ctx, item.path, item.topZ, projectPoint, toCanvas, cx, cy, cz, DEPTH_SCALE);
          });
          ctx.fill();
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.rect(0, 0, canvas.width, canvas.height);
          insideItems.forEach((item) => {
            appendResultPathToTopContext(ctx, item.path, item.topZ, projectPoint, toCanvas, cx, cy, cz, DEPTH_SCALE);
          });
          ctx.fill("evenodd");
        }
      }

      previewItems.forEach((item) => {
        ctx.beginPath();
        appendResultPathToTopContext(ctx, item.path, item.topZ, projectPoint, toCanvas, cx, cy, cz, DEPTH_SCALE);
        ctx.stroke();
      });
      ctx.restore();
    } else {
      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      if (resultContourInside && insideItems.length > 0 && outsideItems.length === 0) {
        ctx.fillStyle = fillColor;
        ctx.beginPath();
        if (viewMode === PreviewViewMode.FRONT || viewMode === PreviewViewMode.SIDE) {
          const stockPaddingH = Math.max((maxX0 - minX0) * 0.5, (maxY0 - minY0) * 0.5, 15);
          const zTop = (cz - topZ) * DEPTH_SCALE;
          const zBottom = (cz - bottomZ) * DEPTH_SCALE;
          if (viewMode === PreviewViewMode.FRONT) {
            const left = minX0 - cx - stockPaddingH;
            const right = maxX0 - cx + stockPaddingH;
            const c1 = toCanvas(projectPoint(left, 0, zTop));
            const c2 = toCanvas(projectPoint(right, 0, zTop));
            const c3 = toCanvas(projectPoint(right, 0, zBottom));
            const c4 = toCanvas(projectPoint(left, 0, zBottom));
            ctx.moveTo(c1.x, c1.y);
            ctx.lineTo(c2.x, c2.y);
            ctx.lineTo(c3.x, c3.y);
            ctx.lineTo(c4.x, c4.y);
          } else {
            const left = minY0 - cy - stockPaddingH;
            const right = maxY0 - cy + stockPaddingH;
            const c1 = toCanvas(projectPoint(0, left, zTop));
            const c2 = toCanvas(projectPoint(0, right, zTop));
            const c3 = toCanvas(projectPoint(0, right, zBottom));
            const c4 = toCanvas(projectPoint(0, left, zBottom));
            ctx.moveTo(c1.x, c1.y);
            ctx.lineTo(c2.x, c2.y);
            ctx.lineTo(c3.x, c3.y);
            ctx.lineTo(c4.x, c4.y);
          }
        } else {
          const pad = Math.max(canvas.width, canvas.height);
          ctx.moveTo(-pad, -pad);
          ctx.lineTo(canvas.width + pad, -pad);
          ctx.lineTo(canvas.width + pad, canvas.height + pad);
          ctx.lineTo(-pad, canvas.height + pad);
        }
        ctx.closePath();
        insideItems.forEach((item) => {
          const path = item.path;
          const pathTopZ = item.topZ;
          const pathBottomZ = item.bottomZ;
          const pts = path.map((p) => ({ x: p.x, y: p.y }));
          const closed = pts.length >= 3 && Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-9 && Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-9;
          const n = closed ? pts.length - 1 : pts.length;
          if (n < 2) return;
          const bottomPoints = [];
          for (let i = 0; i < n; i++) {
            const pt = pts[i];
            const x = pt.x - cx;
            const y = pt.y - cy;
            const zBottom = (cz - pathBottomZ) * DEPTH_SCALE;
            bottomPoints.push(toCanvas(projectPoint(x, y, zBottom)));
          }
          ctx.moveTo(bottomPoints[0].x, bottomPoints[0].y);
          for (let i = 1; i < bottomPoints.length; i++) ctx.lineTo(bottomPoints[i].x, bottomPoints[i].y);
          ctx.closePath();
        });
        ctx.fill("evenodd");
        ctx.fillStyle = wallColor;
        insideItems.forEach((item) => {
          const path = item.path;
          const pathTopZ = item.topZ;
          const pathBottomZ = item.bottomZ;
          const pts = path.map((p) => ({ x: p.x, y: p.y }));
          const closed = pts.length >= 3 && Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-9 && Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-9;
          const n = closed ? pts.length - 1 : pts.length;
          if (n < 2) return;
          const bottomPoints = [];
          const topPoints = [];
          for (let i = 0; i < n; i++) {
            const pt = pts[i];
            const x = pt.x - cx;
            const y = pt.y - cy;
            const zBottom = (cz - pathBottomZ) * DEPTH_SCALE;
            const zTop = (cz - pathTopZ) * DEPTH_SCALE;
            bottomPoints.push(toCanvas(projectPoint(x, y, zBottom)));
            topPoints.push(toCanvas(projectPoint(x, y, zTop)));
          }
          for (let i = 0; i < n; i++) {
            const next = (i + 1) % n;
            ctx.beginPath();
            ctx.moveTo(bottomPoints[i].x, bottomPoints[i].y);
            ctx.lineTo(bottomPoints[next].x, bottomPoints[next].y);
            ctx.lineTo(topPoints[next].x, topPoints[next].y);
            ctx.lineTo(topPoints[i].x, topPoints[i].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        });
      } else {
        const drawExtrudedPreviewItem = (item) => {
          const path = item.path;
          const pathTopZ = item.topZ;
          const pathBottomZ = item.bottomZ;
          const pts = path.map((p) => ({ x: p.x, y: p.y }));
          const closed = pts.length >= 3 && Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-9 && Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-9;
          const n = closed ? pts.length - 1 : pts.length;
          if (n < 2) return;
          const bottomPoints = [];
          const topPoints = [];
          for (let i = 0; i < n; i++) {
            const pt = pts[i];
            const x = pt.x - cx;
            const y = pt.y - cy;
            const zBottom = (cz - pathBottomZ) * DEPTH_SCALE;
            const zTop = (cz - pathTopZ) * DEPTH_SCALE;
            bottomPoints.push(toCanvas(projectPoint(x, y, zBottom)));
            topPoints.push(toCanvas(projectPoint(x, y, zTop)));
          }
          ctx.fillStyle = fillColor;
          ctx.beginPath();
          ctx.moveTo(bottomPoints[0].x, bottomPoints[0].y);
          for (let i = 1; i < bottomPoints.length; i++) ctx.lineTo(bottomPoints[i].x, bottomPoints[i].y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = wallColor;
          for (let i = 0; i < n; i++) {
            const next = (i + 1) % n;
            ctx.beginPath();
            ctx.moveTo(bottomPoints[i].x, bottomPoints[i].y);
            ctx.lineTo(bottomPoints[next].x, bottomPoints[next].y);
            ctx.lineTo(topPoints[next].x, topPoints[next].y);
            ctx.lineTo(topPoints[i].x, topPoints[i].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        };
        outsideItems.forEach(drawExtrudedPreviewItem);
        if (outsideItems.length === 0) {
          insideItems.forEach(drawExtrudedPreviewItem);
        }
      }
      ctx.restore();
    }
  }

  // Toolpath tekenen
  let last = null;
  for (let i = 0; i < toolpath.moves.length; i++) {
    const m = toolpath.moves[i];
    const proj = projected[i];
    if (!proj) {
      last = null;
      continue;
    }
    const p = toCanvas(proj);
    if (last) {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      if (m.type === "arc" && i > 0) {
        const prevMove = toolpath.moves[i - 1];
        const startP = projectPoint(
          prevMove.x - cx,
          prevMove.y - cy,
          (cz - prevMove.z) * DEPTH_SCALE
        );
        const centerP = projectPoint(
          prevMove.x + m.i - cx,
          prevMove.y + m.j - cy,
          (cz - m.z) * DEPTH_SCALE
        );
        const startC = toCanvas(startP);
        const centerC = toCanvas(centerP);
        const r = Math.hypot(startC.x - centerC.x, startC.y - centerC.y);
        const startAngle = Math.atan2(startC.y - centerC.y, startC.x - centerC.x);
        const endAngle = Math.atan2(p.y - centerC.y, p.x - centerC.x);
        ctx.arc(centerC.x, centerC.y, r, startAngle, endAngle, !m.clockwise);
        ctx.strokeStyle = "#38bdf8";
        ctx.setLineDash([]);
        ctx.lineWidth = 2;
      } else {
        ctx.lineTo(p.x, p.y);
        if (m.type === "rapid") {
          ctx.strokeStyle = "#f97316";
          ctx.setLineDash([6, 4]);
          ctx.lineWidth = 1.5;
        } else {
          ctx.strokeStyle = "#38bdf8";
          ctx.setLineDash([]);
          ctx.lineWidth = 2;
        }
      }
      ctx.stroke();
    }
    last = p;
  }

  // Origin markeren (0,0)
  const originCanvas = toCanvas(originProjected);

  // X- en Y-as door de origin, per viewMode
  ctx.save();
  const isLightTheme =
    typeof document !== "undefined" && document.body?.dataset.theme === "light";
  ctx.strokeStyle = isLightTheme ? "#4b5563" : "#ffffff"; // donkergrijs in light, wit in dark
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  if (viewMode === PreviewViewMode.TOP) {
    // Bovenaanzicht: X horizontaal, Y verticaal
    // X-as
    ctx.beginPath();
    ctx.moveTo(0, originCanvas.y);
    ctx.lineTo(canvas.width, originCanvas.y);
    ctx.stroke();
    // Y-as
    ctx.beginPath();
    ctx.moveTo(originCanvas.x, 0);
    ctx.lineTo(originCanvas.x, canvas.height);
    ctx.stroke();
  } else if (viewMode === PreviewViewMode.FRONT || viewMode === PreviewViewMode.SIDE) {
    // Front / side: alleen horizontale lijn door origin
    ctx.beginPath();
    ctx.moveTo(0, originCanvas.y);
    ctx.lineTo(canvas.width, originCanvas.y);
    ctx.stroke();
  } else {
    // Isometrisch (of fallback): assen in dezelfde schuine hoek als de rest van de tekening
    const axisLen = Math.max(canvas.width, canvas.height);

    /**
     * Teken een as door originCanvas langs een richting in scherm-coördinaten.
     * @param {{ dx: number, dy: number }} dir
     */
    function drawAxisFromDir(dir) {
      const len = Math.hypot(dir.dx, dir.dy);
      if (!len) return;
      const scaleDir = axisLen / len;
      const dx = dir.dx * scaleDir;
      const dy = dir.dy * scaleDir;
      ctx.beginPath();
      ctx.moveTo(originCanvas.x - dx, originCanvas.y - dy);
      ctx.lineTo(originCanvas.x + dx, originCanvas.y + dy);
      ctx.stroke();
    }

    // Richting van +X-as in schermruimte
    const projX = toCanvas(
      projectPoint(1 - cx, 0 - cy, (cz - 0) * DEPTH_SCALE)
    );
    drawAxisFromDir({ dx: projX.x - originCanvas.x, dy: projX.y - originCanvas.y });

    // Richting van +Y-as in schermruimte
    const projY = toCanvas(
      projectPoint(0 - cx, 1 - cy, (cz - 0) * DEPTH_SCALE)
    );
    drawAxisFromDir({ dx: projY.x - originCanvas.x, dy: projY.y - originCanvas.y });
  }

  ctx.restore();

  // Origin kruisje
  ctx.save();
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 1.5;
  const r = 4;
  ctx.beginPath();
  ctx.moveTo(originCanvas.x - r, originCanvas.y);
  ctx.lineTo(originCanvas.x + r, originCanvas.y);
  ctx.moveTo(originCanvas.x, originCanvas.y - r);
  ctx.lineTo(originCanvas.x, originCanvas.y + r);
  ctx.stroke();
  ctx.restore();

  // Semi-transparante witte kolom op het punt van de gcode-regel onder de cursor (onderkant midden op punt, hoogte 50 mm, diameter = freesdikte)
  if (cursorColumn && toolpath.moves.length > 0) {
    const CYLINDER_HEIGHT_MM = 50;
    const r = (Number.isFinite(cursorColumn.diameter) ? cursorColumn.diameter : 4) / 2;
    const x0 = cursorColumn.x - cx;
    const y0 = cursorColumn.y - cy;
    const zBottom = (cz - cursorColumn.z) * DEPTH_SCALE;
    const zTop = (cz - (cursorColumn.z + CYLINDER_HEIGHT_MM)) * DEPTH_SCALE;
    const segments = 24;
    const bottomPoints = [];
    const topPoints = [];
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      const bx = x0 + r * Math.cos(t);
      const by = y0 + r * Math.sin(t);
      const pBot = projectPoint(bx, by, zBottom);
      const pTop = projectPoint(bx, by, zTop);
      bottomPoints.push(toCanvas(pBot));
      topPoints.push(toCanvas(pTop));
    }
    ctx.save();
    const isLightTheme = typeof document !== "undefined" && document.body?.dataset.theme === "light";
    ctx.fillStyle = isLightTheme ? "rgba(148, 163, 184, 0.55)" : "rgba(255, 255, 255, 0.45)";
    ctx.strokeStyle = isLightTheme ? "rgba(107, 114, 128, 0.9)" : "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = 1;
    // Ondercirkel
    ctx.beginPath();
    ctx.moveTo(bottomPoints[0].x, bottomPoints[0].y);
    for (let i = 1; i < bottomPoints.length; i++) ctx.lineTo(bottomPoints[i].x, bottomPoints[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Zijvlakken (quads tussen onder- en bovenring)
    for (let i = 0; i < segments; i++) {
      ctx.beginPath();
      ctx.moveTo(bottomPoints[i].x, bottomPoints[i].y);
      ctx.lineTo(bottomPoints[i + 1].x, bottomPoints[i + 1].y);
      ctx.lineTo(topPoints[i + 1].x, topPoints[i + 1].y);
      ctx.lineTo(topPoints[i].x, topPoints[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // Bovencirkel
    ctx.beginPath();
    ctx.moveTo(topPoints[0].x, topPoints[0].y);
    for (let i = 1; i < topPoints.length; i++) ctx.lineTo(topPoints[i].x, topPoints[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Dimensielijnen (X en Y) bij bovenaanzicht: max-min freespad + freesstraal aan beide kanten
  const toolRadius = Number.isFinite(toolpath.toolDiameter) ? toolpath.toolDiameter / 2 : 0;
  if (viewMode === PreviewViewMode.TOP) {
    const minExtX = minX0 - toolRadius;
    const maxExtX = maxX0 + toolRadius;
    const minExtY = minY0 - toolRadius;
    const maxExtY = maxY0 + toolRadius;
    const dimX = maxExtX - minExtX;
    const dimY = maxExtY - minExtY;
    const unit = getDisplayUnit();
    const dimXDisplay = unit === "inch" ? fromMm(dimX, "inch") : dimX;
    const dimYDisplay = unit === "inch" ? fromMm(dimY, "inch") : dimY;
    const dimXText = dimXDisplay.toFixed(1) + (unit === "inch" ? '"' : " mm");
    const dimYText = dimYDisplay.toFixed(1) + (unit === "inch" ? '"' : " mm");

    const left = minExtX - cx;
    const right = maxExtX - cx;
    const bottom = minExtY - cy;
    const top = maxExtY - cy;
    const cLeft = toCanvas(projectPoint(left, 0, 0));
    const cRight = toCanvas(projectPoint(right, 0, 0));
    const cBottom = toCanvas(projectPoint(0, bottom, 0));
    const cTop = toCanvas(projectPoint(0, top, 0));

    const dimOffset = 28;
    const tickLen = 6;
    const isLightTheme = typeof document !== "undefined" && document.body?.dataset.theme === "light";
    ctx.save();
    ctx.strokeStyle = isLightTheme ? "#94a3b8" : "#64748b";
    ctx.fillStyle = isLightTheme ? "#64748b" : "#94a3b8";
    ctx.lineWidth = 1;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.beginPath();
    ctx.moveTo(cLeft.x, canvas.height - dimOffset);
    ctx.lineTo(cRight.x, canvas.height - dimOffset);
    ctx.moveTo(cLeft.x, canvas.height - dimOffset - tickLen);
    ctx.lineTo(cLeft.x, canvas.height - dimOffset + tickLen);
    ctx.moveTo(cRight.x, canvas.height - dimOffset - tickLen);
    ctx.lineTo(cRight.x, canvas.height - dimOffset + tickLen);
    ctx.stroke();
    ctx.fillText(dimXText, (cLeft.x + cRight.x) / 2, canvas.height - dimOffset - 10);

    ctx.beginPath();
    ctx.moveTo(dimOffset, cBottom.y);
    ctx.lineTo(dimOffset, cTop.y);
    ctx.moveTo(dimOffset - tickLen, cBottom.y);
    ctx.lineTo(dimOffset + tickLen, cBottom.y);
    ctx.moveTo(dimOffset - tickLen, cTop.y);
    ctx.lineTo(dimOffset + tickLen, cTop.y);
    ctx.stroke();
    ctx.save();
    ctx.translate(dimOffset - 14, (cBottom.y + cTop.y) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText(dimYText, 0, 0);
    ctx.restore();

    ctx.restore();
  } else if (viewMode === PreviewViewMode.FRONT) {
    // Front: X horizontaal, Z verticaal
    const minExtX = minX0 - toolRadius;
    const maxExtX = maxX0 + toolRadius;
    const dimX = maxExtX - minExtX;
    const dimZ = maxZ0 - minZ0;
    const unit = getDisplayUnit();
    const dimXDisplay = unit === "inch" ? fromMm(dimX, "inch") : dimX;
    const dimZDisplay = unit === "inch" ? fromMm(dimZ, "inch") : dimZ;
    const dimXText = dimXDisplay.toFixed(1) + (unit === "inch" ? '"' : " mm");
    const dimZText = dimZDisplay.toFixed(1) + (unit === "inch" ? '"' : " mm");

    const left = minExtX - cx;
    const right = maxExtX - cx;
    const zBottomProj = (cz - minZ0) * DEPTH_SCALE;
    const zTopProj = (cz - maxZ0) * DEPTH_SCALE;
    const cLeft = toCanvas(projectPoint(left, 0, 0));
    const cRight = toCanvas(projectPoint(right, 0, 0));
    const cBottom = toCanvas(projectPoint(0, 0, zBottomProj));
    const cTop = toCanvas(projectPoint(0, 0, zTopProj));

    const dimOffset = 28;
    const tickLen = 6;
    const isLightTheme = typeof document !== "undefined" && document.body?.dataset.theme === "light";
    ctx.save();
    ctx.strokeStyle = isLightTheme ? "#94a3b8" : "#64748b";
    ctx.fillStyle = isLightTheme ? "#64748b" : "#94a3b8";
    ctx.lineWidth = 1;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.beginPath();
    ctx.moveTo(cLeft.x, canvas.height - dimOffset);
    ctx.lineTo(cRight.x, canvas.height - dimOffset);
    ctx.moveTo(cLeft.x, canvas.height - dimOffset - tickLen);
    ctx.lineTo(cLeft.x, canvas.height - dimOffset + tickLen);
    ctx.moveTo(cRight.x, canvas.height - dimOffset - tickLen);
    ctx.lineTo(cRight.x, canvas.height - dimOffset + tickLen);
    ctx.stroke();
    ctx.fillText(dimXText, (cLeft.x + cRight.x) / 2, canvas.height - dimOffset - 10);

    ctx.beginPath();
    ctx.moveTo(dimOffset, cBottom.y);
    ctx.lineTo(dimOffset, cTop.y);
    ctx.moveTo(dimOffset - tickLen, cBottom.y);
    ctx.lineTo(dimOffset + tickLen, cBottom.y);
    ctx.moveTo(dimOffset - tickLen, cTop.y);
    ctx.lineTo(dimOffset + tickLen, cTop.y);
    ctx.stroke();
    ctx.save();
    ctx.translate(dimOffset - 14, (cBottom.y + cTop.y) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText(dimZText, 0, 0);
    ctx.restore();

    ctx.restore();
  } else if (viewMode === PreviewViewMode.SIDE) {
    // Side: Y horizontaal, Z verticaal
    const minExtY = minY0 - toolRadius;
    const maxExtY = maxY0 + toolRadius;
    const dimY = maxExtY - minExtY;
    const dimZ = maxZ0 - minZ0;
    const unit = getDisplayUnit();
    const dimYDisplay = unit === "inch" ? fromMm(dimY, "inch") : dimY;
    const dimZDisplay = unit === "inch" ? fromMm(dimZ, "inch") : dimZ;
    const dimYText = dimYDisplay.toFixed(1) + (unit === "inch" ? '"' : " mm");
    const dimZText = dimZDisplay.toFixed(1) + (unit === "inch" ? '"' : " mm");

    const bottom = minExtY - cy;
    const top = maxExtY - cy;
    const zBottomProj = (cz - minZ0) * DEPTH_SCALE;
    const zTopProj = (cz - maxZ0) * DEPTH_SCALE;
    const cLeft = toCanvas(projectPoint(0, bottom, 0));
    const cRight = toCanvas(projectPoint(0, top, 0));
    const cBottom = toCanvas(projectPoint(0, 0, zBottomProj));
    const cTop = toCanvas(projectPoint(0, 0, zTopProj));

    const dimOffset = 28;
    const tickLen = 6;
    const isLightTheme = typeof document !== "undefined" && document.body?.dataset.theme === "light";
    ctx.save();
    ctx.strokeStyle = isLightTheme ? "#94a3b8" : "#64748b";
    ctx.fillStyle = isLightTheme ? "#64748b" : "#94a3b8";
    ctx.lineWidth = 1;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.beginPath();
    ctx.moveTo(cLeft.x, canvas.height - dimOffset);
    ctx.lineTo(cRight.x, canvas.height - dimOffset);
    ctx.moveTo(cLeft.x, canvas.height - dimOffset - tickLen);
    ctx.lineTo(cLeft.x, canvas.height - dimOffset + tickLen);
    ctx.moveTo(cRight.x, canvas.height - dimOffset - tickLen);
    ctx.lineTo(cRight.x, canvas.height - dimOffset + tickLen);
    ctx.stroke();
    ctx.fillText(dimYText, (cLeft.x + cRight.x) / 2, canvas.height - dimOffset - 10);

    ctx.beginPath();
    ctx.moveTo(dimOffset, cBottom.y);
    ctx.lineTo(dimOffset, cTop.y);
    ctx.moveTo(dimOffset - tickLen, cBottom.y);
    ctx.lineTo(dimOffset + tickLen, cBottom.y);
    ctx.moveTo(dimOffset - tickLen, cTop.y);
    ctx.lineTo(dimOffset + tickLen, cTop.y);
    ctx.stroke();
    ctx.save();
    ctx.translate(dimOffset - 14, (cBottom.y + cTop.y) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText(dimZText, 0, 0);
    ctx.restore();

    ctx.restore();
  }
}

/**
 * Download als .nc bestand.
 */
function downloadGcode(filename, gcode) {
  const blob = new Blob([gcode], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Vraag om een bestandsnaam en download gcode als .nc.
 * @param {string} suggestedFilename
 * @param {string} gcode
 */
function promptAndDownloadGcode(suggestedFilename, gcode) {
  const input = window.prompt(t("form.downloadPrompt"), suggestedFilename);
  if (input == null) return;
  if (input.trim() === "") {
    alert(t("form.downloadCanceled"));
    return;
  }
  let filename = sanitizeFilename(input.trim());
  if (!filename.toLowerCase().endsWith(".nc")) {
    filename += ".nc";
  }
  downloadGcode(filename, gcode);
}

/** @returns {string} */
function getGcodeTimestamp() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
}

/**
 * Standaard bestandsnaam voor een enkele gcode-export.
 * @param {{ shape: string, operation: string, shapeParams?: { threadMillType?: string } }} raw
 * @returns {string}
 */
function getSuggestedGcodeFilename(raw) {
  const ts = getGcodeTimestamp();
  if (raw.shape === ShapeType.LETTERS) {
    return `gcode_letters_${ts}.nc`;
  }
  if (raw.shape === ShapeType.DXF) {
    return `gcode_dxf_${raw.operation}_${ts}.nc`;
  }
  if (raw.shape === ShapeType.THREAD_MILLING) {
    return `gcode_thread_milling_${raw.shapeParams?.threadMillType || ThreadMillType.INTERNAL}_${ts}.nc`;
  }
  return `gcode_${raw.shape}_${raw.operation}_${ts}.nc`;
}

/**
 * Download bestand (bijv. JSON).
 */
function downloadFile(filename, content, mimeType = "application/json") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Schema voor machine-instellingen export/import (version 1). */
const MACHINE_SETTINGS_SCHEMA = [
  { key: "feedrate", formId: "feedrate", type: "number" },
  { key: "spindleSpeedEnabled", formId: "spindle-speed-enabled", type: "checkbox" },
  { key: "spindleSpeed", formId: "spindle-speed", type: "number" },
  { key: "mistCoolantEnabled", formId: "mist-coolant-enabled", type: "checkbox" },
  { key: "floodCoolantEnabled", formId: "flood-coolant-enabled", type: "checkbox" },
  { key: "mirrorXEnabled", formId: "mirror-x-enabled", type: "checkbox" },
  { key: "mirrorYEnabled", formId: "mirror-y-enabled", type: "checkbox" },
  { key: "useArcsEnabled", formId: "use-arcs-enabled", type: "checkbox" },
  { key: "toolDiameter", formId: "tool-diameter", type: "number" },
  { key: "safeHeight", formId: "safe-height", type: "number" },
  { key: "leadInAbove", formId: "lead-in-above", type: "number" },
  { key: "zOffset", formId: "z-offset", type: "number" },
  { key: "originOffsetX", formId: "origin-offset-x", type: "number" },
  { key: "originOffsetY", formId: "origin-offset-y", type: "number" },
];

/** Default waarden voor ontbrekende keys bij import. */
const MACHINE_SETTINGS_DEFAULTS = {
  feedrate: 800,
  spindleSpeedEnabled: false,
  spindleSpeed: 12000,
  mistCoolantEnabled: false,
  floodCoolantEnabled: false,
  mirrorXEnabled: false,
  mirrorYEnabled: false,
  useArcsEnabled: false,
  toolDiameter: 4,
  safeHeight: 10,
  leadInAbove: 2,
  zOffset: 0,
  originOffsetX: 0,
  originOffsetY: 0,
};

const LAST_SETTINGS_STORAGE_KEY = "gcode-last-settings";
const CHAIN_MODE_STORAGE_KEY = "gcode-chain-enabled";
const LEGACY_CHAIN_MODE_STORAGE_KEY = "gcode-chain-mode";

/** @type {{ x: number, y: number }[]} */
let currentDxfSupportPoints = [];

/** @type {string|null} */
let dxfLoadedTextForSupport = null;

/** @type {{ x: number, y: number, z: number }[][]} */
let dxfSupportPopupContours = [];

/** @type {{ x: number, y: number }[]} */
let dxfSupportPopupPoints = [];

/** @type {object|null} */
let dxfSupportPopupView = null;

/**
 * @returns {{ enabled: boolean, pauseAfter: boolean, diameter: number, depth: number|null, points: {x:number,y:number}[] }}
 */
function readDxfSupportHolesFromForm() {
  const enabled = /** @type {HTMLInputElement|null} */ (document.getElementById("dxf-support-holes-enabled"))?.checked ?? false;
  const pauseAfter = /** @type {HTMLInputElement|null} */ (document.getElementById("dxf-support-pause-after"))?.checked ?? true;
  const displayUnit = getDisplayUnit();
  const diaRaw = toNumber(document.getElementById("dxf-support-holes-diameter")?.value);
  const depthRaw = toNumber(document.getElementById("dxf-support-holes-depth")?.value);
  const diameter = toMm(diaRaw, displayUnit);
  const depth = Number.isFinite(depthRaw) && depthRaw > 0 ? toMm(depthRaw, displayUnit) : null;
  return {
    enabled,
    pauseAfter,
    diameter,
    depth,
    points: currentDxfSupportPoints.map((p) => ({ x: p.x, y: p.y })),
  };
}

function updateDxfSupportPointsSummary() {
  const summary = document.getElementById("dxf-support-points-summary");
  if (!summary) return;
  const count = currentDxfSupportPoints.length;
  summary.textContent = count > 0
    ? t("form.dxfSupportPointsCount", { count: String(count) })
    : t("form.dxfSupportPointsNone");
}

function updateDxfSupportPopupCount() {
  const el = document.getElementById("dxf-support-popup-count");
  if (!el) return;
  el.textContent = t("dxfSupport.popupCount", { count: String(dxfSupportPopupPoints.length) });
}

function updateDxfSupportSettingsVisibility() {
  const enabled = /** @type {HTMLInputElement|null} */ (document.getElementById("dxf-support-holes-enabled"))?.checked ?? false;
  const settings = document.getElementById("dxf-support-settings");
  if (settings) settings.classList.toggle("hidden", !enabled);
}

function syncDxfSupportPointsToActiveChainStep() {
  if (!isChainModeEnabled()) return;
  const idx = getChainActiveStepIndex();
  if (idx < 0 || !chainJobSteps[idx]?.formState) return;
  chainJobSteps[idx].formState.dxfSupportPoints = currentDxfSupportPoints.map((p) => ({ x: p.x, y: p.y }));
}

function setCurrentDxfSupportPoints(points, syncChain = true) {
  currentDxfSupportPoints = (points || []).map((p) => ({ x: p.x, y: p.y }));
  updateDxfSupportPointsSummary();
  if (syncChain) syncDxfSupportPointsToActiveChainStep();
  if (typeof updateRegenerateIndicator === "function") updateRegenerateIndicator();
}

function clearDxfSupportPoints(showHint = false) {
  if (!currentDxfSupportPoints.length) return;
  setCurrentDxfSupportPoints([]);
  if (showHint) {
    const errorMessage = document.getElementById("error-message");
    if (errorMessage) errorMessage.textContent = t("dxfSupport.pointsCleared");
  }
}

async function getActiveDxfTextForSupport() {
  if (isChainModeEnabled()) {
    const idx = getChainActiveStepIndex();
    if (idx >= 0 && chainJobSteps[idx]?.dxfText) return chainJobSteps[idx].dxfText;
  }
  if (dxfLoadedTextForSupport) return dxfLoadedTextForSupport;
  const { text } = await readDxfTextFromFileInput();
  return text;
}

function buildDxfSupportPopupView(canvas, contours) {
  const padding = 28;
  const bounds = computeBoundsFromPaths(contours);
  if (!bounds) return null;
  const w = Math.max(bounds.maxX - bounds.minX, 1e-3);
  const h = Math.max(bounds.maxY - bounds.minY, 1e-3);
  const scale = Math.min((canvas.width - 2 * padding) / w, (canvas.height - 2 * padding) / h);
  return { canvas, bounds, scale, padding };
}

function dxfSupportWorldToScreen(x, y, view) {
  const sx = view.padding + (x - view.bounds.minX) * view.scale;
  const sy = view.canvas.height - view.padding - (y - view.bounds.minY) * view.scale;
  return { sx, sy };
}

function dxfSupportScreenToWorld(sx, sy, view) {
  const x = view.bounds.minX + (sx - view.padding) / view.scale;
  const y = view.bounds.minY + (view.canvas.height - view.padding - sy) / view.scale;
  return { x, y };
}

function renderDxfSupportCanvas() {
  const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById("dxf-support-canvas"));
  if (!canvas || !dxfSupportPopupView) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const view = dxfSupportPopupView;
  const displayUnit = getDisplayUnit();
  const diaRaw = toNumber(document.getElementById("dxf-support-holes-diameter")?.value);
  const holeDiameterMm = toMm(diaRaw, displayUnit);
  const holeRadiusMm = Number.isFinite(holeDiameterMm) && holeDiameterMm > 0 ? holeDiameterMm / 2 : 0;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(148, 163, 184, 0.9)";
  ctx.lineWidth = 1.5;
  dxfSupportPopupContours.forEach((contour) => {
    if (!contour.length) return;
    ctx.beginPath();
    const first = dxfSupportWorldToScreen(contour[0].x, contour[0].y, view);
    ctx.moveTo(first.sx, first.sy);
    for (let i = 1; i < contour.length; i++) {
      const p = dxfSupportWorldToScreen(contour[i].x, contour[i].y, view);
      ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();
  });

  dxfSupportPopupPoints.forEach((pt) => {
    const { sx, sy } = dxfSupportWorldToScreen(pt.x, pt.y, view);
    const rPx = holeRadiusMm > 0 ? holeRadiusMm * view.scale : 6;
    ctx.beginPath();
    ctx.strokeStyle = "rgba(248, 113, 113, 0.55)";
    ctx.lineWidth = 1;
    ctx.arc(sx, sy, Math.max(rPx, 4), 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#f87171";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx - 7, sy);
    ctx.lineTo(sx + 7, sy);
    ctx.moveTo(sx, sy - 7);
    ctx.lineTo(sx, sy + 7);
    ctx.stroke();
    ctx.fillStyle = "#f87171";
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  updateDxfSupportPopupCount();
}

function removeNearestDxfSupportPopupPoint(sx, sy, maxDistPx = 12) {
  if (!dxfSupportPopupView || !dxfSupportPopupPoints.length) return;
  let bestIdx = -1;
  let bestDist = maxDistPx;
  dxfSupportPopupPoints.forEach((pt, idx) => {
    const p = dxfSupportWorldToScreen(pt.x, pt.y, dxfSupportPopupView);
    const d = Math.hypot(p.sx - sx, p.sy - sy);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = idx;
    }
  });
  if (bestIdx >= 0) {
    dxfSupportPopupPoints.splice(bestIdx, 1);
    renderDxfSupportCanvas();
  }
}

async function openDxfSupportPopup() {
  const overlay = document.getElementById("dxf-support-overlay");
  const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById("dxf-support-canvas"));
  const errorMessage = document.getElementById("error-message");
  if (!overlay || !canvas) return;

  const dxfText = await getActiveDxfTextForSupport();
  if (!dxfText) {
    if (errorMessage) errorMessage.textContent = t("dxfSupport.noDxf");
    return;
  }

  const orientationDeg = Number(document.getElementById("dxf-orientation")?.value) || 0;
  dxfSupportPopupContours = getOrientedDxfContoursFromText(dxfText, orientationDeg);
  if (!dxfSupportPopupContours.length) {
    if (errorMessage) errorMessage.textContent = t("dxfSupport.noContours");
    return;
  }

  dxfSupportPopupPoints = currentDxfSupportPoints.map((p) => ({ x: p.x, y: p.y }));
  dxfSupportPopupView = buildDxfSupportPopupView(canvas, dxfSupportPopupContours);
  renderDxfSupportCanvas();
  overlay.classList.remove("hidden");
  if (errorMessage) errorMessage.textContent = "";
}

function closeDxfSupportPopup(save) {
  const overlay = document.getElementById("dxf-support-overlay");
  if (!overlay) return;
  if (save) {
    setCurrentDxfSupportPoints(dxfSupportPopupPoints);
  }
  overlay.classList.add("hidden");
}

function initDxfSupportUI() {
  const enabledCb = document.getElementById("dxf-support-holes-enabled");
  const openBtn = document.getElementById("dxf-support-open-btn");
  const undoBtn = document.getElementById("dxf-support-undo-btn");
  const clearBtn = document.getElementById("dxf-support-clear-btn");
  const doneBtn = document.getElementById("dxf-support-done-btn");
  const cancelBtn = document.getElementById("dxf-support-cancel-btn");
  const overlay = document.getElementById("dxf-support-overlay");
  const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById("dxf-support-canvas"));
  const dxfOrientation = document.getElementById("dxf-orientation");
  const dxfFileInput = document.getElementById("dxf-file");
  const diameterInput = document.getElementById("dxf-support-holes-diameter");

  if (enabledCb) {
    enabledCb.addEventListener("change", () => {
      updateDxfSupportSettingsVisibility();
      if (typeof updateRegenerateIndicator === "function") updateRegenerateIndicator();
    });
  }
  ["dxf-support-pause-after", "dxf-support-holes-depth"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => { if (typeof updateRegenerateIndicator === "function") updateRegenerateIndicator(); });
    el.addEventListener("change", () => { if (typeof updateRegenerateIndicator === "function") updateRegenerateIndicator(); });
  });
  if (diameterInput) {
    diameterInput.addEventListener("input", () => {
      if (!overlay?.classList.contains("hidden")) renderDxfSupportCanvas();
      if (typeof updateRegenerateIndicator === "function") updateRegenerateIndicator();
    });
  }
  if (openBtn) openBtn.addEventListener("click", () => { openDxfSupportPopup(); });
  if (undoBtn) {
    undoBtn.addEventListener("click", () => {
      dxfSupportPopupPoints.pop();
      renderDxfSupportCanvas();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      dxfSupportPopupPoints = [];
      renderDxfSupportCanvas();
    });
  }
  if (doneBtn) doneBtn.addEventListener("click", () => closeDxfSupportPopup(true));
  if (cancelBtn) cancelBtn.addEventListener("click", () => closeDxfSupportPopup(false));
  if (overlay) {
    overlay.addEventListener("click", (evt) => {
      if (evt.target === overlay) closeDxfSupportPopup(false);
    });
  }
  if (canvas) {
    canvas.addEventListener("click", (evt) => {
      if (!dxfSupportPopupView) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const sx = (evt.clientX - rect.left) * scaleX;
      const sy = (evt.clientY - rect.top) * scaleY;
      if (evt.shiftKey || evt.button === 2) {
        removeNearestDxfSupportPopupPoint(sx, sy);
        return;
      }
      const world = dxfSupportScreenToWorld(sx, sy, dxfSupportPopupView);
      dxfSupportPopupPoints.push({ x: world.x, y: world.y });
      renderDxfSupportCanvas();
    });
    canvas.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      if (!dxfSupportPopupView) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const sx = (evt.clientX - rect.left) * scaleX;
      const sy = (evt.clientY - rect.top) * scaleY;
      removeNearestDxfSupportPopupPoint(sx, sy);
    });
  }
  if (dxfOrientation) {
    dxfOrientation.addEventListener("change", () => {
      clearDxfSupportPoints(true);
    });
  }
  if (dxfFileInput) {
    dxfFileInput.addEventListener("change", async () => {
      const file = dxfFileInput.files?.[0];
      if (!file) {
        dxfLoadedTextForSupport = null;
        clearDxfSupportPoints(false);
        return;
      }
      try {
        const text = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result ?? ""));
          r.onerror = () => reject(new Error("File read failed"));
          r.readAsText(file);
        });
        dxfLoadedTextForSupport = text;
        clearDxfSupportPoints(true);
      } catch (_) {
        dxfLoadedTextForSupport = null;
      }
    });
  }

  updateDxfSupportSettingsVisibility();
  updateDxfSupportPointsSummary();
}

/** @type {{ id: string, formState: object, dxfText: string|null }[]} */
let chainJobSteps = [];
/** @type {string|null} */
let chainActiveStepId = null;

/** Formuliervelden die per stap worden opgeslagen. */
const CHAIN_CAPTURE_FIELD_IDS = [
  "operation-type", "hole-pattern-layout", "shape", "operation",
  "circle-diameter", "square-size", "square-preset", "rect-width", "rect-height", "rect-preset",
  "rounded-corner-radius", "hexagon-height", "ellipse-major", "ellipse-minor",
  "letter-text", "letter-size", "letter-mode", "letter-orientation",
  "counterbore-head-diameter", "counterbore-depth", "counterbore-bolt-diameter",
  "thread-system", "thread-preset", "thread-mill-type", "thread-hand", "thread-cut-direction", "thread-major-diameter", "thread-pitch",
  "thread-hole-diameter", "thread-milling-depth",
  "patterned-holes-preset", "patterned-holes-diameter", "patterned-holes-spacing-x", "patterned-holes-spacing-y",
  "patterned-holes-count-x", "patterned-holes-count-y",
  "circular-pattern-holes-count", "circular-pattern-holes-diameter", "circular-pattern-holes-circle-diameter",
  "circular-pattern-holes-start-angle", "circular-pattern-holes-center-hole", "circular-pattern-holes-center-diameter",
  "dxf-orientation",
  "dxf-support-holes-enabled", "dxf-support-holes-diameter", "dxf-support-holes-depth", "dxf-support-pause-after",
  "facing-mode", "facing-direction", "facing-finish-mode", "facing-even-spacing",
  "contour-type", "tabs-enabled", "tab-interval", "tab-width", "tab-height",
  "tool-diameter", "total-depth", "multiple-depths", "stepdown", "stepover",
  "finishing-pass-enabled", "finishing-pass-distance", "finishing-pass-speed-override", "finishing-pass-overlap",
  "feedrate", "spindle-speed", "safe-height", "lead-in-above",
  "xy-origin", "z-origin", "z-offset", "origin-offset-x", "origin-offset-y",
  "entry-method", "ramp-angle", "plunge-outside",
  "spindle-speed-enabled", "mist-coolant-enabled", "flood-coolant-enabled",
  "mirror-x-enabled", "mirror-y-enabled", "use-arcs-enabled",
];

/** Baseline-velden (stap 1) die voor latere stappen vergrendeld worden. */
const CHAIN_BASELINE_FIELD_IDS = [
  "xy-origin", "z-origin", "z-offset",
  "tool-diameter", "safe-height", "spindle-speed",
  "spindle-speed-enabled", "mist-coolant-enabled", "flood-coolant-enabled",
  "mirror-x-enabled", "mirror-y-enabled", "use-arcs-enabled",
];

function isChainModeEnabled() {
  try {
    return localStorage.getItem(CHAIN_MODE_STORAGE_KEY) !== "off";
  } catch (_) {
    return true;
  }
}

function initChainModeOnStartup(refreshStepOneFromForm = false) {
  if (isChainModeEnabled()) {
    setChainModeEnabled(true);
  } else {
    applyChainModeUI(false);
  }
  if (refreshStepOneFromForm && isChainModeEnabled() && chainJobSteps[0]) {
    chainJobSteps[0].formState = captureFormStateForChain();
    renderChainStepsBar();
  }
}

function setChainModeEnabled(enabled) {
  try {
    localStorage.setItem(CHAIN_MODE_STORAGE_KEY, enabled ? "on" : "off");
    localStorage.removeItem(LEGACY_CHAIN_MODE_STORAGE_KEY);
  } catch (_) {}
  applyChainModeUI(enabled);
}

function applyChainModeUI(enabled) {
  document.body.dataset.chainMode = enabled ? "on" : "off";
  const bar = document.getElementById("chain-steps-bar");
  const hint = document.getElementById("chain-baseline-hint");
  if (bar) bar.classList.toggle("hidden", !enabled);
  if (hint) hint.classList.toggle("hidden", !enabled || chainJobSteps.length < 2);
  document.querySelectorAll(".settings-chain-item[data-chain]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.getAttribute("data-chain") === (enabled ? "on" : "off") ? "true" : "false");
  });
  if (enabled && chainJobSteps.length === 0) {
    chainJobSteps.push(createChainStepFromCurrentFormSync());
    chainActiveStepId = chainJobSteps[0].id;
  }
  renderChainStepsBar();
  updateChainFieldLocks();
}

function onChainBaselineFieldsChanged() {
  if (!isChainModeEnabled() || getChainActiveStepIndex() !== 0 || !chainJobSteps[0]) return;
  chainJobSteps[0].formState = captureFormStateForChain();
  syncChainBaselineToOtherSteps();
  renderChainStepsBar();
  updateChainFieldLocks();
}

function createChainStepId() {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function captureFormStateForChain() {
  /** @type {Record<string, string|boolean|number>} */
  const fields = {};
  CHAIN_CAPTURE_FIELD_IDS.forEach((id) => {
    const el = /** @type {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|null} */ (document.getElementById(id));
    if (!el) return;
    if (el.type === "checkbox") fields[id] = el.checked;
    else fields[id] = el.value;
  });
  return {
    fields,
    stepoverUnit: document.querySelector('input[name="stepover-unit"]:checked')?.value ?? "percent",
    entryMethod: /** @type {HTMLInputElement|null} */ (document.getElementById("entry-method"))?.value ?? EntryMethod.PLUNGE,
    plungeOutside: /** @type {HTMLInputElement|null} */ (document.getElementById("plunge-outside"))?.value ?? "off",
    dxfSupportPoints: currentDxfSupportPoints.map((p) => ({ x: p.x, y: p.y })),
  };
}

function applyFormStateForChain(formState) {
  if (!formState?.fields) return;
  Object.entries(formState.fields).forEach(([id, val]) => {
    const el = /** @type {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|null} */ (document.getElementById(id));
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!val;
    else el.value = String(val);
  });
  const stepoverRadio = /** @type {HTMLInputElement|null} */ (
    document.querySelector(`input[name="stepover-unit"][value="${formState.stepoverUnit || "percent"}"]`)
  );
  if (stepoverRadio) {
    stepoverRadio.checked = true;
    stepoverRadio.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const entryHidden = /** @type {HTMLInputElement|null} */ (document.getElementById("entry-method"));
  const entryVal = formState.entryMethod || EntryMethod.PLUNGE;
  if (entryHidden) entryHidden.value = entryVal;
  document.querySelectorAll(".entry-method-btn").forEach((b) => {
    b.classList.toggle("entry-method-btn--active", b.getAttribute("data-entry") === entryVal);
  });
  const plungeHidden = /** @type {HTMLInputElement|null} */ (document.getElementById("plunge-outside"));
  const plungeVal = formState.plungeOutside || "off";
  if (plungeHidden) plungeHidden.value = plungeVal;
  document.querySelectorAll("[data-plunge-outside]").forEach((b) => {
    b.classList.toggle("entry-method-btn--active", b.getAttribute("data-plunge-outside") === plungeVal);
  });
  setCurrentDxfSupportPoints(formState.dxfSupportPoints || [], false);
  updateDxfSupportSettingsVisibility();
}

function extractBaselineFieldsFromFormState(formState) {
  /** @type {Record<string, string|boolean>} */
  const baseline = {};
  CHAIN_BASELINE_FIELD_IDS.forEach((id) => {
    if (formState.fields[id] !== undefined) baseline[id] = formState.fields[id];
  });
  return baseline;
}

function applyBaselineFieldsToFormState(formState, baseline) {
  if (!formState?.fields || !baseline) return formState;
  CHAIN_BASELINE_FIELD_IDS.forEach((id) => {
    if (baseline[id] !== undefined) formState.fields[id] = baseline[id];
  });
  return formState;
}

function syncChainBaselineToOtherSteps() {
  if (chainJobSteps.length < 2) return;
  const baseline = extractBaselineFieldsFromFormState(chainJobSteps[0].formState);
  for (let i = 1; i < chainJobSteps.length; i++) {
    applyBaselineFieldsToFormState(chainJobSteps[i].formState, baseline);
  }
}

function getChainActiveStepIndex() {
  if (!chainActiveStepId) return -1;
  return chainJobSteps.findIndex((s) => s.id === chainActiveStepId);
}

function isChainBaselineLocked() {
  return isChainModeEnabled() && chainJobSteps.length > 0 && getChainActiveStepIndex() > 0;
}

function getChainLockTargets() {
  const targets = [
    document.getElementById("xy-origin")?.closest(".field-row"),
    document.getElementById("z-origin")?.closest(".field-row"),
    document.getElementById("z-offset")?.closest(".field-row"),
    document.getElementById("tool-diameter-row"),
    document.getElementById("spindle-speed-row"),
    document.getElementById("safe-height")?.closest(".field-row"),
    document.getElementById("settings-machine-btn"),
  ];
  return targets.filter(Boolean);
}

function updateChainFieldLocks() {
  const locked = isChainBaselineLocked();
  getChainLockTargets().forEach((el) => {
    el.classList.toggle("chain-locked", locked);
  });
  const overlay = document.getElementById("machine-settings-overlay");
  if (overlay) {
    overlay.querySelectorAll("input, select, button").forEach((el) => {
      if (el.id === "machine-settings-close") return;
      if (locked) {
        el.setAttribute("data-chain-was-disabled", el.disabled ? "1" : "0");
        el.disabled = true;
      } else if (el.hasAttribute("data-chain-was-disabled")) {
        el.disabled = el.getAttribute("data-chain-was-disabled") === "1";
        el.removeAttribute("data-chain-was-disabled");
      }
    });
  }
  const hint = document.getElementById("chain-baseline-hint");
  if (hint) hint.classList.toggle("hidden", !isChainModeEnabled() || chainJobSteps.length < 2);
}

function getChainStepToolLabel(formState) {
  const opCat = formState.fields["operation-type"] ?? OperationTypeCategory.SHAPES;
  const shape = resolveEffectiveShape(opCat, formState.fields["shape"]);
  const contourType = normalizeContourType(formState.fields["contour-type"]);
  const letterMode = formState.fields["letter-mode"] || "outline";
  const fixed = getEngravingToolDiameterMm(shape, contourType, letterMode);
  const u = getDisplayUnit();
  let diaMm;
  if (fixed != null) diaMm = fixed;
  else {
    const baseline = chainJobSteps.length > 0
      ? extractBaselineFieldsFromFormState(chainJobSteps[0].formState)
      : null;
    const toolField = baseline?.["tool-diameter"] ?? formState.fields["tool-diameter"];
    const raw = toNumber(toolField);
    diaMm = Number.isFinite(raw) ? toMm(raw, u) : NaN;
  }
  if (!Number.isFinite(diaMm)) return "";
  const val = u === "inch" ? fromMm(diaMm, "inch").toFixed(3) : fromMm(diaMm, "mm").toFixed(1);
  return t("chain.toolDiameter", { val });
}

function getChainStepOperationLabel(formState) {
  const saved = captureFormStateForChain();
  applyFormStateForChain(formState);
  const raw = readInputsFromForm();
  applyFormStateForChain(saved);
  if (chainActiveStepId) {
    const active = chainJobSteps.find((s) => s.id === chainActiveStepId);
    if (active) applyFormStateForChain(active.formState);
  }
  return getGcodeOperationLabel(raw);
}

function createChainStepFromCurrentFormSync() {
  return {
    id: createChainStepId(),
    formState: captureFormStateForChain(),
    dxfText: null,
    dxfFileName: null,
  };
}

async function readDxfTextFromFileInput() {
  const dxfFileInput = /** @type {HTMLInputElement|null} */ (document.getElementById("dxf-file"));
  const file = dxfFileInput?.files?.[0];
  if (!file) return { text: null, name: null };
  const text = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(new Error("File read failed"));
    r.readAsText(file);
  });
  return { text, name: file.name };
}

async function saveActiveChainStepFromForm() {
  const idx = getChainActiveStepIndex();
  if (idx < 0 || !chainJobSteps[idx]) return;
  chainJobSteps[idx].formState = captureFormStateForChain();
  const opCat = chainJobSteps[idx].formState.fields["operation-type"];
  const shape = resolveEffectiveShape(opCat, chainJobSteps[idx].formState.fields["shape"]);
  if (shape === ShapeType.DXF) {
    const { text, name } = await readDxfTextFromFileInput();
    if (text) {
      chainJobSteps[idx].dxfText = text;
      chainJobSteps[idx].dxfFileName = name;
    }
  }
  if (idx === 0) syncChainBaselineToOtherSteps();
}

function loadChainStepToForm(stepId) {
  const step = chainJobSteps.find((s) => s.id === stepId);
  if (!step) return;
  chainActiveStepId = stepId;
  const idx = getChainActiveStepIndex();
  if (idx > 0 && chainJobSteps[0]) {
    applyBaselineFieldsToFormState(step.formState, extractBaselineFieldsFromFormState(chainJobSteps[0].formState));
  }
  applyFormStateForChain(step.formState);
  if (typeof updateUIForOperationTypeAndShape === "function") updateUIForOperationTypeAndShape();
  if (typeof updateContourTypeVisibility === "function") updateContourTypeVisibility();
  if (typeof updateStepoverHint === "function") updateStepoverHint();
  if (typeof updateToolDiameterVisibility === "function") updateToolDiameterVisibility();
  updateChainFieldLocks();
  renderChainStepsBar();
  if (typeof updateRegenerateIndicator === "function") updateRegenerateIndicator();
}

async function selectChainStep(stepId) {
  if (chainActiveStepId && chainActiveStepId !== stepId) {
    await saveActiveChainStepFromForm();
  }
  loadChainStepToForm(stepId);
}

async function addChainStepFromForm() {
  await saveActiveChainStepFromForm();
  const step = createChainStepFromCurrentFormSync();
  if (chainJobSteps.length > 0) {
    const baseline = extractBaselineFieldsFromFormState(chainJobSteps[0].formState);
    applyBaselineFieldsToFormState(step.formState, baseline);
  }
  const opCat = step.formState.fields["operation-type"];
  const shape = resolveEffectiveShape(opCat, step.formState.fields["shape"]);
  if (shape === ShapeType.DXF) {
    const { text, name } = await readDxfTextFromFileInput();
    if (text) {
      step.dxfText = text;
      step.dxfFileName = name;
    }
  }
  chainJobSteps.push(step);
  chainActiveStepId = step.id;
  loadChainStepToForm(step.id);
}

async function removeChainStep(stepId) {
  const idx = chainJobSteps.findIndex((s) => s.id === stepId);
  if (idx < 0) return;
  chainJobSteps.splice(idx, 1);
  if (chainJobSteps.length === 0) {
    chainActiveStepId = null;
    if (isChainModeEnabled()) {
      const step = createChainStepFromCurrentFormSync();
      chainJobSteps.push(step);
      chainActiveStepId = step.id;
    }
  } else if (chainActiveStepId === stepId) {
    chainActiveStepId = chainJobSteps[Math.min(idx, chainJobSteps.length - 1)].id;
    loadChainStepToForm(chainActiveStepId);
  }
  syncChainBaselineToOtherSteps();
  renderChainStepsBar();
  updateChainFieldLocks();
  if (typeof updateRegenerateIndicator === "function") updateRegenerateIndicator();
}

function renderChainStepsBar() {
  const list = document.getElementById("chain-steps-list");
  if (!list) return;
  list.innerHTML = "";
  chainJobSteps.forEach((step, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "chain-step-chip-wrapper";

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chain-step-chip" + (step.id === chainActiveStepId ? " chain-step-chip--active" : "");
    chip.dataset.stepId = step.id;
    const num = document.createElement("span");
    num.className = "chain-step-chip-num";
    num.textContent = String(index + 1);
    const label = document.createElement("span");
    label.className = "chain-step-chip-label";
    label.textContent = getChainStepOperationLabel(step.formState);
    const tool = document.createElement("span");
    tool.className = "chain-step-chip-tool";
    tool.textContent = getChainStepToolLabel(step.formState);
    chip.appendChild(num);
    chip.appendChild(label);
    chip.appendChild(tool);
    chip.addEventListener("click", () => {
      selectChainStep(step.id);
    });
    wrapper.appendChild(chip);

    if (chainJobSteps.length > 1) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "chain-step-remove";
      removeBtn.setAttribute("aria-label", t("chain.removeStep"));
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        removeChainStep(step.id);
      });
      wrapper.appendChild(removeBtn);
    }

    list.appendChild(wrapper);
  });
}

function applyChainBaselineToRaw(raw, baselineFields) {
  if (!baselineFields) return raw;
  const displayUnit = getDisplayUnit();
  raw.originParams = {
    ...raw.originParams,
    xyOrigin: String(baselineFields["xy-origin"] ?? raw.originParams.xyOrigin),
    zOrigin: String(baselineFields["z-origin"] ?? raw.originParams.zOrigin),
    zOffset: toMm(toNumber(baselineFields["z-offset"]) || 0, displayUnit),
  };
  const toolRaw = toNumber(baselineFields["tool-diameter"]);
  if (Number.isFinite(toolRaw) && toolRaw > 0 && !isEngravingContourMode(raw.shape, raw.contourType, raw.letterMode)) {
    raw.cutParams.toolDiameter = toMm(toolRaw, displayUnit);
  }
  raw.cutParams.safeHeight = toMm(toNumber(baselineFields["safe-height"]) || raw.cutParams.safeHeight, displayUnit);
  raw.cutParams.spindleSpeedEnabled = !!baselineFields["spindle-speed-enabled"];
  const spindle = toNumber(baselineFields["spindle-speed"]);
  raw.cutParams.spindleSpeed = raw.cutParams.spindleSpeedEnabled && Number.isFinite(spindle) && spindle > 0 ? spindle : null;
  raw.cutParams.mistCoolantEnabled = !!baselineFields["mist-coolant-enabled"];
  raw.cutParams.floodCoolantEnabled = !!baselineFields["flood-coolant-enabled"];
  raw.cutParams.mirrorXEnabled = !!baselineFields["mirror-x-enabled"];
  raw.cutParams.mirrorYEnabled = !!baselineFields["mirror-y-enabled"];
  raw.cutParams.useArcsEnabled = !!baselineFields["use-arcs-enabled"];
  return raw;
}

async function prepareRawFromChainStep(step, baselineFields) {
  applyFormStateForChain(step.formState);
  let raw = readInputsFromForm();
  if (baselineFields) raw = applyChainBaselineToRaw(raw, baselineFields);
  if (raw.shape === ShapeType.DXF) {
    if (!step.dxfText) {
      throw new Error(t("error.dxfNoFile"));
    }
    const dxfOrientation = Number(raw.shapeParams.dxfOrientation) || 0;
    const orientedContours = getOrientedDxfContoursFromText(step.dxfText, dxfOrientation);
    applyDxfOriginToRaw(raw, orientedContours);
  }
  return raw;
}

function mergeChainToolpaths(stepResults) {
  /** @type {ToolpathMove[]} */
  const moves = [];
  stepResults.forEach((r) => {
    if (r.toolpath?.moves?.length) moves.push(...r.toolpath.moves);
  });
  const last = stepResults[stepResults.length - 1]?.toolpath;

  // Grijs gefreesd-resultaat in preview: alleen betrouwbaar bij enkele stap.
  if (stepResults.length > 1) {
    return { moves, toolDiameter: last?.toolDiameter };
  }

  if (!last) return { moves };

  return {
    moves,
    resultPaths: last.resultPaths,
    resultPathsWithDepth: last.resultPathsWithDepth,
    resultTotalDepth: last.resultTotalDepth,
    resultBottomZ: last.resultBottomZ,
    resultContourInside: last.resultContourInside,
    resultBounds: last.resultBounds,
    toolDiameter: last.toolDiameter,
  };
}

/** Slaat de huidige machine-instellingen op in localStorage. */
function saveLastSettings() {
  try {
    const unit = getDisplayUnit();
    const previewSpeedSliderEl = /** @type {HTMLInputElement | null} */ (document.getElementById("preview-speed"));
    const previewSpeedSliderValue = previewSpeedSliderEl ? Number(previewSpeedSliderEl.value) : 0;
    const data = {
      version: 1,
      unit,
      previewSpeedSliderValue: Number.isFinite(previewSpeedSliderValue) ? previewSpeedSliderValue : 0,
      feedrate: toNumber(document.getElementById("feedrate")?.value),
      spindleSpeedEnabled: /** @type {HTMLInputElement} */ (document.getElementById("spindle-speed-enabled"))?.checked ?? false,
      spindleSpeed: toNumber(document.getElementById("spindle-speed")?.value),
      mistCoolantEnabled: /** @type {HTMLInputElement} */ (document.getElementById("mist-coolant-enabled"))?.checked ?? false,
      floodCoolantEnabled: /** @type {HTMLInputElement} */ (document.getElementById("flood-coolant-enabled"))?.checked ?? false,
      mirrorXEnabled: /** @type {HTMLInputElement} */ (document.getElementById("mirror-x-enabled"))?.checked ?? false,
      mirrorYEnabled: /** @type {HTMLInputElement} */ (document.getElementById("mirror-y-enabled"))?.checked ?? false,
      useArcsEnabled: /** @type {HTMLInputElement} */ (document.getElementById("use-arcs-enabled"))?.checked ?? false,
      toolDiameter: toNumber(document.getElementById("tool-diameter")?.value),
      safeHeight: toNumber(document.getElementById("safe-height")?.value),
      leadInAbove: toNumber(document.getElementById("lead-in-above")?.value),
      zOffset: toNumber(document.getElementById("z-offset")?.value),
      originOffsetX: toNumber(document.getElementById("origin-offset-x")?.value),
      originOffsetY: toNumber(document.getElementById("origin-offset-y")?.value),
    };
    MACHINE_SETTINGS_SCHEMA.forEach(({ key, type }) => {
      const val = data[key];
      if (type === "number" && (val == null || !Number.isFinite(val))) {
        data[key] = MACHINE_SETTINGS_DEFAULTS[key];
      }
    });
    localStorage.setItem(LAST_SETTINGS_STORAGE_KEY, JSON.stringify(data));
  } catch (_) {}
}

/** Sanitize bestandsnaam: ongeldige tekens verwijderen. */
function sanitizeFilename(name) {
  if (!name || typeof name !== "string") return "machine-settings";
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, "-")
    .trim() || "machine-settings";
}

function fallbackCopyToClipboard(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (_) {
    copied = false;
  }
  document.body.removeChild(textArea);
  return copied;
}

async function copyGcodeToClipboard(gcode) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(gcode);
      alert(t("error.copySuccess"));
      return;
    }
    if (fallbackCopyToClipboard(gcode)) {
      alert(t("error.copySuccess"));
      return;
    }
  } catch (_) {
    if (fallbackCopyToClipboard(gcode)) {
      alert(t("error.copySuccess"));
      return;
    }
  }
  alert(t("error.copyFailed"));
}

/**
 * UI-initialisatie
 */
function setupUI() {
  currentLang = getCurrentLang();
  document.documentElement.lang = currentLang;
  applyTranslations();
  document.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.getAttribute("data-lang") === currentLang ? "true" : "false");
    btn.addEventListener("click", () => {
      const lang = btn.getAttribute("data-lang");
      if (lang) setLanguage(lang);
    });
  });

  // Submenu's: open op hover (unit, lang, theme)
  function setupHoverSubmenu(triggerId, submenuId) {
    const trigger = document.getElementById(triggerId);
    const submenu = document.getElementById(submenuId);
    let closeTimer = null;
    function openSubmenu() {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      submenu?.classList.remove("hidden");
      trigger?.setAttribute("aria-expanded", "true");
    }
    function closeSubmenu() {
      closeTimer = setTimeout(() => {
        submenu?.classList.add("hidden");
        trigger?.setAttribute("aria-expanded", "false");
        closeTimer = null;
      }, 150);
    }
    if (trigger && submenu) {
      trigger.addEventListener("mouseenter", openSubmenu);
      trigger.addEventListener("mouseleave", closeSubmenu);
      submenu.addEventListener("mouseenter", openSubmenu);
      submenu.addEventListener("mouseleave", closeSubmenu);
    }
  }
  setupHoverSubmenu("unit-submenu-trigger", "unit-submenu");
  setupHoverSubmenu("lang-submenu-trigger", "lang-submenu");
  setupHoverSubmenu("theme-submenu-trigger", "theme-submenu");
  setupHoverSubmenu("importexport-submenu-trigger", "importexport-submenu");
  setupHoverSubmenu("mode-submenu-trigger", "mode-submenu");
  setupHoverSubmenu("chain-submenu-trigger", "chain-submenu");

  document.querySelectorAll(".settings-chain-item[data-chain]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setChainModeEnabled(btn.getAttribute("data-chain") === "on");
    });
  });

  initChainModeOnStartup();

  const chainAddStepBtn = document.getElementById("chain-add-step-btn");
  if (chainAddStepBtn) {
    chainAddStepBtn.addEventListener("click", () => {
      addChainStepFromForm();
    });
  }

  // Display mode (simple / advanced)
  function applyDisplayMode(mode) {
    document.body.dataset.displayMode = mode;
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch (_) {}
    document.querySelectorAll(".settings-mode-item[data-mode]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-mode") === mode ? "true" : "false");
    });
    document.dispatchEvent(new CustomEvent("modechange"));
  }
  applyDisplayMode(getDisplayMode());
  document.querySelectorAll(".settings-mode-item[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = btn.getAttribute("data-mode");
      if (m === "simple" || m === "advanced") applyDisplayMode(m);
    });
  });

  // Theme switcher (dark / light)
  function applyTheme(theme) {
    const body = document.body;
    if (!body) return;
    const next = theme === "light" ? "light" : "dark";
    body.dataset.theme = next;
    body.classList.toggle("theme-light", next === "light");
    body.classList.toggle("theme-dark", next === "dark");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (_) {}
    document.querySelectorAll(".settings-theme-item[data-theme]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-theme") === next ? "true" : "false");
    });
  }

  const initialTheme = getCurrentTheme();
  applyTheme(initialTheme);
  document.querySelectorAll(".settings-theme-item[data-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const theme = btn.getAttribute("data-theme");
      if (theme === "light" || theme === "dark") applyTheme(theme);
    });
  });

  // First time visit popup
  (function setupFirstVisitPopup() {
    const overlay = document.getElementById("first-visit-overlay");
    const dismissBtn = document.getElementById("first-visit-dismiss");
    if (!overlay || !dismissBtn) return;

    let hasShown = false;
    try {
      hasShown = localStorage.getItem(FIRST_VISIT_STORAGE_KEY) === "1";
    } catch (_) {}
    if (hasShown) return;

    function closePopup() {
      overlay.classList.add("hidden");
      try {
        localStorage.setItem(FIRST_VISIT_STORAGE_KEY, "1");
      } catch (_) {}
    }

    overlay.classList.remove("hidden");
    dismissBtn.addEventListener("click", closePopup);
    overlay.addEventListener("click", (evt) => {
      if (evt.target === overlay) {
        closePopup();
      }
    });
  })();

  // Unit switcher (mm / inch): bewaar keuze, converteer velden bij wissel, update labels
  const LENGTH_INPUT_IDS = [
    "circle-diameter", "square-size", "rect-width", "rect-height", "rounded-corner-radius", "ellipse-major", "ellipse-minor", "letter-size",
    "counterbore-head-diameter", "counterbore-depth", "counterbore-bolt-diameter",
    "thread-major-diameter", "thread-pitch", "thread-hole-diameter", "thread-milling-depth",
    "patterned-holes-diameter", "patterned-holes-spacing-x", "patterned-holes-spacing-y",
    "tab-interval", "tab-width", "tab-height",
    "tool-diameter", "total-depth", "stepdown", "stepover", "feedrate", "safe-height", "lead-in-above", "z-offset", "origin-offset-x", "origin-offset-y", "finishing-pass-overlap",
  ];
  /** Minimum waarden in mm; in inch-modus omrekenen zodat HTML5-validatie en steppers kloppen. */
  const MIN_MM_BY_INPUT = {
    "letter-size": 1,
    "tab-interval": 1,
    "tab-width": 1,
    "tab-height": 0.1,
    "tool-diameter": 0.1,
  };
  /** Step in mm voor wrapper (data-step); gebruikt voor +/- knoppen en in inch omgerekend. */
  const STEP_MM_BY_INPUT = {
    "circle-diameter": 1, "square-size": 1, "rect-width": 1, "rect-height": 1, "rounded-corner-radius": 0.5,
    "ellipse-major": 1, "ellipse-minor": 1, "letter-size": 1,
    "patterned-holes-diameter": 0.1, "patterned-holes-spacing-x": 1, "patterned-holes-spacing-y": 1,
    "counterbore-head-diameter": 1, "counterbore-depth": 0.5, "counterbore-bolt-diameter": 0.5,
    "thread-major-diameter": 0.5, "thread-pitch": 0.1, "thread-hole-diameter": 0.5, "thread-milling-depth": 0.5,
    "tab-interval": 5, "tab-width": 1, "tab-height": 0.5,
    "tool-diameter": 0.5, "total-depth": 0.5, "stepdown": 0.5, "feedrate": 50,
    "safe-height": 1, "lead-in-above": 0.5, "z-offset": 0.5, "origin-offset-x": 0.5, "origin-offset-y": 0.5,
    "finishing-pass-overlap": 0.1,
  };
  /** Inputs met vaste step in HTML (niet "any"); in inch step="any", in mm herstellen. */
  const INPUT_FIXED_STEP_MM = {
    "tab-interval": 1, "tab-width": 1, "safe-height": 1,
    "feedrate": 50, "lead-in-above": 0.5, "z-offset": 0.5, "origin-offset-x": 0.5, "origin-offset-y": 0.5,
  };
  /** Default waarden in inch (afgeleid van mm-defaults, afgerond op logische inch-waarden). Stepover blijft %. */
  const DEFAULT_VALUES_INCH = {
    "circle-diameter": 2,
    "square-size": 2,
    "rect-width": 3.5,
    "rect-height": 5,
    "rounded-corner-radius": 0,
    "ellipse-major": 2.25,
    "ellipse-minor": 1.5,
    "letter-size": 0.375,
    "patterned-holes-diameter": 0.8,
    "patterned-holes-spacing-x": 3.75,
    "patterned-holes-spacing-y": 3.75,
    "counterbore-head-diameter": 0.5,
    "counterbore-depth": 0.125,
    "counterbore-bolt-diameter": 0.25,
    "thread-major-diameter": 0.25,
    "thread-pitch": 0.004,
    "thread-hole-diameter": 0.2,
    "thread-milling-depth": 0.375,
    "tab-interval": 1.5,
    "tab-width": 0.25,
    "tab-height": 0.04,
    "tool-diameter": 0.125,
    "total-depth": 0.25,
    "stepdown": 0.04,
    "feedrate": 30,
    "safe-height": 0.5,
    "lead-in-above": 0.1,
    "origin-offset-x": 0,
    "origin-offset-y": 0,
  };
  function applyInchDefaults() {
    Object.keys(DEFAULT_VALUES_INCH).forEach((id) => {
      const input = document.getElementById(id);
      if (input && "value" in input) /** @type {HTMLInputElement} */ (input).value = String(DEFAULT_VALUES_INCH[id]);
    });
  }
  /**
   * Zet alle relevante invoervelden terug naar hun standaardwaarden
   * voor de gekozen eenheid, zodat afrondfouten bij het wisselen tussen
   * mm en inch worden voorkomen.
   */
  function applyDefaultsForUnit(unit) {
    if (unit === "inch") {
      applyInchDefaults();
      return;
    }
    // Voor mm gebruiken we de originele HTML-defaults (in mm) van de inputs.
    LENGTH_INPUT_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el || !("value" in el)) return;
      const input = /** @type {HTMLInputElement} */ (el);
      if (typeof input.defaultValue === "string" && input.defaultValue.length > 0) {
        input.value = input.defaultValue;
      } else {
        input.value = "";
      }
    });
  }
  function updateInputMinMaxForUnit(unit) {
    const isInch = unit === "inch";
    Object.keys(MIN_MM_BY_INPUT).forEach((id) => {
      const input = document.getElementById(id);
      if (!input || !("min" in input)) return;
      const minMm = MIN_MM_BY_INPUT[id];
      const minDisplay = isInch ? Math.round((minMm / MM_PER_INCH) * 1000) / 1000 : minMm;
      /** @type {HTMLInputElement} */ (input).min = String(minDisplay);
      const wrapper = input.closest(".input-with-stepper");
      if (wrapper) wrapper.setAttribute("data-min", String(minDisplay));
    });
    LENGTH_INPUT_IDS.forEach((id) => {
      const input = document.getElementById(id);
      if (!input || !("step" in input)) return;
      if (isInch) {
        /** @type {HTMLInputElement} */ (input).step = "any";
      } else if (INPUT_FIXED_STEP_MM[id] != null) {
        /** @type {HTMLInputElement} */ (input).step = String(INPUT_FIXED_STEP_MM[id]);
      }
      const stepMm = STEP_MM_BY_INPUT[id];
      if (stepMm != null) {
        const wrapper = input.closest(".input-with-stepper");
        if (wrapper) {
          let stepDisplay = isInch
            ? Math.round((stepMm / MM_PER_INCH) * 1000) / 1000
            : stepMm;
          // In inch mode: avoid step 0 (from tiny mm steps), and cap at 0.01 so 0.25 is reachable
          if (isInch) {
            if (!stepDisplay || stepDisplay <= 0) stepDisplay = 0.001;
            if (stepDisplay > 0.01) stepDisplay = 0.01;
          }
          wrapper.setAttribute("data-step", String(stepDisplay));
        }
      }
    });
  }
  function setDisplayUnit(unit) {
    const prev = getDisplayUnit();
    if (prev === unit) return;
    // Waarschuwing: bij wisselen van eenheid worden invoervelden
    // teruggezet naar hun standaardwaarden om afrondfouten te voorkomen.
    const confirmed = window.confirm(
      "Let op: bij wisselen tussen mm en inch worden alle invoervelden teruggezet naar de standaardwaarden om afrondfouten te voorkomen. Wil je doorgaan?"
    );
    if (!confirmed) return;
    try {
      localStorage.setItem(UNIT_STORAGE_KEY, unit);
    } catch (_) {}
    applyDefaultsForUnit(unit);
    updateInputMinMaxForUnit(unit);
    updateStepoverUnitLabel();
    document.querySelectorAll(".settings-unit-item[data-unit]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-unit") === unit ? "true" : "false");
    });
    applyTranslations();
    document.dispatchEvent(new CustomEvent("unitchange"));
  }
  function updateStepoverUnitLabel() {
    const span = document.querySelector('.stepover-unit-toggle input[value="mm"] + span');
    if (span) span.textContent = getDisplayUnit() === "inch" ? "in" : "mm";
  }
  const savedUnit = getDisplayUnit();
  updateInputMinMaxForUnit(savedUnit);
  updateStepoverUnitLabel();
  if (savedUnit === "inch") applyInchDefaults();
  document.querySelectorAll(".settings-unit-item[data-unit]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.getAttribute("data-unit") === savedUnit ? "true" : "false");
    btn.addEventListener("click", () => {
      const u = btn.getAttribute("data-unit");
      if (u === "mm" || u === "inch") setDisplayUnit(u);
    });
  });

  function restoreLastSettings() {
    try {
      const raw = localStorage.getItem(LAST_SETTINGS_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const unit = data.unit ?? "mm";
      if (unit !== "mm" && unit !== "inch") return;
      if (getDisplayUnit() !== unit) {
        try {
          localStorage.setItem(UNIT_STORAGE_KEY, unit);
        } catch (_) {}
        updateInputMinMaxForUnit(unit);
        updateStepoverUnitLabel();
        applyTranslations();
        document.querySelectorAll(".settings-unit-item[data-unit]").forEach((btn) => {
          btn.setAttribute("aria-pressed", btn.getAttribute("data-unit") === unit ? "true" : "false");
        });
        document.dispatchEvent(new CustomEvent("unitchange"));
      }
      MACHINE_SETTINGS_SCHEMA.forEach(({ key, formId, type }) => {
        const val = data[key];
        if (val === undefined || val === null) return;
        const el = document.getElementById(formId);
        if (!el) return;
        if (type === "checkbox") {
          /** @type {HTMLInputElement} */ (el).checked = !!val;
        } else if (type === "number" && Number.isFinite(val)) {
          /** @type {HTMLInputElement} */ (el).value = String(val);
        }
      });
      const spindleRow = document.getElementById("spindle-speed-row");
      const spindleCb = document.getElementById("spindle-speed-enabled");
      if (spindleRow && spindleCb) {
        spindleRow.classList.toggle("hidden", !(/** @type {HTMLInputElement} */ (spindleCb)).checked);
      }
      const storedPreviewSpeedSliderValue = Number(data.previewSpeedSliderValue);
      if (Number.isFinite(storedPreviewSpeedSliderValue)) {
        const normalized = Math.max(0, Math.min(1, storedPreviewSpeedSliderValue));
        playbackSpeedMultiplier = speedSliderToMultiplier(normalized);
      }
      if (speedSlider) {
        speedSlider.value = String(speedMultiplierToSlider(playbackSpeedMultiplier));
      }
      if (speedValueEl) {
        speedValueEl.textContent = formatMultiplierForDisplay(playbackSpeedMultiplier);
      }
    } catch (_) {}
  }

  // Instellingenmenu: dropdown open/dicht
  const settingsMenuBtn = document.getElementById("settings-menu-btn");
  const settingsDropdown = document.getElementById("settings-dropdown");
  function closeSettingsMenu() {
    if (settingsDropdown) settingsDropdown.classList.add("hidden");
    if (settingsMenuBtn) settingsMenuBtn.setAttribute("aria-expanded", "false");
  }
  function openSettingsMenu() {
    if (settingsDropdown) settingsDropdown.classList.remove("hidden");
    if (settingsMenuBtn) settingsMenuBtn.setAttribute("aria-expanded", "true");
  }
  if (settingsMenuBtn && settingsDropdown) {
    settingsMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = settingsDropdown.classList.contains("hidden");
      if (isOpen) openSettingsMenu();
      else closeSettingsMenu();
    });
    document.addEventListener("click", () => closeSettingsMenu());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSettingsMenu();
    });
    settingsDropdown.addEventListener("click", (e) => e.stopPropagation());
  }

  const machineSettingsOverlay = document.getElementById("machine-settings-overlay");
  const machineSettingsBtn = document.getElementById("settings-machine-btn");
  const machineSettingsCloseBtn = document.getElementById("machine-settings-close");
  function closeMachineSettingsModal() {
    if (machineSettingsOverlay) machineSettingsOverlay.classList.add("hidden");
  }
  function openMachineSettingsModal() {
    if (machineSettingsOverlay) machineSettingsOverlay.classList.remove("hidden");
    closeSettingsMenu();
  }
  if (machineSettingsBtn) {
    machineSettingsBtn.addEventListener("click", () => openMachineSettingsModal());
  }
  if (machineSettingsCloseBtn) {
    machineSettingsCloseBtn.addEventListener("click", () => closeMachineSettingsModal());
  }
  if (machineSettingsOverlay) {
    machineSettingsOverlay.addEventListener("click", (evt) => {
      if (evt.target === machineSettingsOverlay) closeMachineSettingsModal();
    });
  }
  document.addEventListener("keydown", (evt) => {
    if (evt.key === "Escape") closeMachineSettingsModal();
  });

  // Machine-instellingen export
  const exportBtn = document.getElementById("settings-export-machine");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      const name = window.prompt(t("settings.exportPrompt"), "");
      if (name == null || name.trim() === "") {
        if (name !== null) alert(t("settings.exportCanceled"));
        return;
      }
      const unit = getDisplayUnit();
      const data = {
        version: 1,
        unit,
        name: name.trim(),
        feedrate: toNumber(document.getElementById("feedrate")?.value),
        spindleSpeedEnabled: /** @type {HTMLInputElement} */ (document.getElementById("spindle-speed-enabled"))?.checked ?? false,
        spindleSpeed: toNumber(document.getElementById("spindle-speed")?.value),
        mistCoolantEnabled: /** @type {HTMLInputElement} */ (document.getElementById("mist-coolant-enabled"))?.checked ?? false,
        floodCoolantEnabled: /** @type {HTMLInputElement} */ (document.getElementById("flood-coolant-enabled"))?.checked ?? false,
        mirrorXEnabled: /** @type {HTMLInputElement} */ (document.getElementById("mirror-x-enabled"))?.checked ?? false,
        mirrorYEnabled: /** @type {HTMLInputElement} */ (document.getElementById("mirror-y-enabled"))?.checked ?? false,
        useArcsEnabled: /** @type {HTMLInputElement} */ (document.getElementById("use-arcs-enabled"))?.checked ?? false,
        toolDiameter: toNumber(document.getElementById("tool-diameter")?.value),
        safeHeight: toNumber(document.getElementById("safe-height")?.value),
        leadInAbove: toNumber(document.getElementById("lead-in-above")?.value),
        zOffset: toNumber(document.getElementById("z-offset")?.value),
        originOffsetX: toNumber(document.getElementById("origin-offset-x")?.value),
        originOffsetY: toNumber(document.getElementById("origin-offset-y")?.value),
      };
      MACHINE_SETTINGS_SCHEMA.forEach(({ key, type }) => {
        const val = data[key];
        if (type === "number" && (val == null || !Number.isFinite(val))) {
          data[key] = MACHINE_SETTINGS_DEFAULTS[key];
        }
      });
      const filename = sanitizeFilename(name.trim()) + ".json";
      downloadFile(filename, JSON.stringify(data, null, 2));
      alert(t("settings.exportSuccess"));
      closeSettingsMenu();
    });
  }

  // Machine-instellingen import
  const importBtn = document.getElementById("settings-import-machine");
  const importFileInput = document.getElementById("settings-import-file");
  if (importBtn && importFileInput) {
    importBtn.addEventListener("click", () => {
      /** @type {HTMLInputElement} */ (importFileInput).value = "";
      importFileInput.click();
    });
    importFileInput.addEventListener("change", () => {
      const file = /** @type {HTMLInputElement} */ (importFileInput).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result));
          const version = data.version ?? 1;
          const unit = data.unit ?? "mm";
          if (unit !== "mm" && unit !== "inch") {
            alert(t("settings.importError") + "Ongeldige eenheid.");
            return;
          }
          // Unit stil wijzigen (zonder confirm, zonder form reset)
          try {
            localStorage.setItem(UNIT_STORAGE_KEY, unit);
          } catch (_) {}
          updateInputMinMaxForUnit(unit);
          updateStepoverUnitLabel();
          applyTranslations();
          document.querySelectorAll(".settings-unit-item[data-unit]").forEach((btn) => {
            btn.setAttribute("aria-pressed", btn.getAttribute("data-unit") === unit ? "true" : "false");
          });
          document.dispatchEvent(new CustomEvent("unitchange"));
          // Waarden toepassen
          MACHINE_SETTINGS_SCHEMA.forEach(({ key, formId, type }) => {
            const val = data[key];
            if (val === undefined || val === null) return;
            const el = document.getElementById(formId);
            if (!el) return;
            if (type === "checkbox") {
              /** @type {HTMLInputElement} */ (el).checked = !!val;
            } else if (type === "number" && Number.isFinite(val)) {
              /** @type {HTMLInputElement} */ (el).value = String(val);
            }
          });
          // Spindle-speed rij zichtbaarheid bijwerken
          const spindleRow = document.getElementById("spindle-speed-row");
          const spindleCb = document.getElementById("spindle-speed-enabled");
          if (spindleRow && spindleCb) {
            spindleRow.classList.toggle("hidden", !(/** @type {HTMLInputElement} */ (spindleCb)).checked);
          }
          alert(t("settings.importSuccess"));
          closeSettingsMenu();
        } catch (err) {
          alert(t("settings.importError") + (err instanceof Error ? err.message : String(err)));
        }
      };
      reader.readAsText(file);
    });
  }

  const form = /** @type {HTMLFormElement} */ (
    document.getElementById("gcode-form")
  );
  const operationTypeSelect = /** @type {HTMLSelectElement} */ (
    document.getElementById("operation-type")
  );
  const shapeSelect = /** @type {HTMLSelectElement} */ (
    document.getElementById("shape")
  );
  const xyOriginSelect = /** @type {HTMLSelectElement} */ (
    document.getElementById("xy-origin")
  );
  const rampSettings = document.getElementById("ramp-settings");
  const entryButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll(".entry-method-btn")
  );
  const entryMethodInput = /** @type {HTMLInputElement} */ (
    document.getElementById("entry-method")
  );
  const plungeOutsideButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll(".plunge-outside-btn")
  );
  const plungeOutsideInput = /** @type {HTMLInputElement} */ (
    document.getElementById("plunge-outside")
  );
  const contourTypeRow = document.getElementById("contour-type-row");
  const operationSelect = /** @type {HTMLSelectElement} */ (
    document.getElementById("operation")
  );
  const errorMessage = document.getElementById("error-message");
  const gcodeOutput = /** @type {HTMLTextAreaElement} */ (
    document.getElementById("gcode-output")
  );
  const gcodeLineHighlightOverlay = document.getElementById("gcode-line-highlight-overlay");
  const gcodeLineHighlightInner = document.getElementById("gcode-line-highlight-inner");
  const gcodeLineHighlightBar = document.getElementById("gcode-line-highlight-bar");
  const previewCanvas = /** @type {HTMLCanvasElement} */ (
    document.getElementById("preview-canvas")
  );
  const downloadBtn = document.getElementById("download-btn");
  const copyBtn = document.getElementById("copy-btn");
  const viewButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll(".preview-view-btn")
  );
  const tabsEnabledCheckbox = /** @type {HTMLInputElement} */ (
    document.getElementById("tabs-enabled")
  );
  const tabParamRows = document.querySelectorAll(".tab-param-row");
  const tabIntervalInput = /** @type {HTMLInputElement} */ (document.getElementById("tab-interval"));
  const tabWidthInput = /** @type {HTMLInputElement} */ (document.getElementById("tab-width"));
  const tabHeightInput = /** @type {HTMLInputElement} */ (document.getElementById("tab-height"));
  const stepoverRow = document.getElementById("stepover-input-wrapper")?.closest(".field-row") ?? null;
  const regenerateBanner = document.getElementById("regenerate-banner");
  const generateBtn = document.getElementById("generate-btn");
  let lastGenerationSnapshot = null;

  function updateRegenerateIndicator() {
    try {
      if (!regenerateBanner || !generateBtn) return;
      const current = getParamsSnapshotReadOnly();
      const needs = lastGenerationSnapshot != null && (current == null || !paramsSnapshotsEqual(current, lastGenerationSnapshot));
      regenerateBanner.classList.toggle("hidden", !needs);
      generateBtn.classList.toggle("needs-regenerate", needs);
    } catch (_) {}
  }

  function updateTabParamsVisibility() {
    const enabled = !!tabsEnabledCheckbox?.checked;
    tabParamRows.forEach((row) => {
      if (enabled) {
        row.classList.remove("hidden");
      } else {
        row.classList.add("hidden");
      }
    });
    if (tabIntervalInput) tabIntervalInput.disabled = !enabled;
    if (tabWidthInput) tabWidthInput.disabled = !enabled;
    if (tabHeightInput) tabHeightInput.disabled = !enabled;
    updateContourTabsRampHintVisibility();
  }

  const contourTabsRampHintEl = document.getElementById("contour-tabs-ramp-hint");
  function updateContourTabsRampHintVisibility() {
    if (!contourTabsRampHintEl) return;
    const isContour = operationSelect?.value === OperationType.CONTOUR;
    const tabsEnabled = !!tabsEnabledCheckbox?.checked;
    const isRamp = entryMethodInput?.value === EntryMethod.RAMP;
    const show = isContour && tabsEnabled && isRamp;
    if (show) {
      contourTabsRampHintEl.classList.remove("hidden");
    } else {
      contourTabsRampHintEl.classList.add("hidden");
    }
  }

  function getEffectiveShape() {
    const opType = operationTypeSelect?.value ?? OperationTypeCategory.SHAPES;
    return resolveEffectiveShape(opType, shapeSelect?.value ?? ShapeType.CIRCLE);
  }

  function updateFacingEvenSpacingHint() {
    const hintEl = document.getElementById("facing-even-spacing-hint");
    if (!hintEl) return;
    const evenCheckbox = /** @type {HTMLInputElement | null} */ (document.getElementById("facing-even-spacing"));
    const showFacing = getEffectiveShape() === ShapeType.FACING;
    const evenOn = !!evenCheckbox?.checked && getDisplayMode() !== "simple";
    if (!showFacing || !evenOn) {
      hintEl.textContent = "";
      return;
    }
    const displayUnit = getDisplayUnit();
    const width = toMm(toNumber(/** @type {HTMLInputElement} */ (document.getElementById("rect-width"))?.value), displayUnit);
    const height = toMm(toNumber(/** @type {HTMLInputElement} */ (document.getElementById("rect-height"))?.value), displayUnit);
    const toolD = toMm(toNumber(/** @type {HTMLInputElement} */ (document.getElementById("tool-diameter"))?.value), displayUnit);
    const facingMode = /** @type {HTMLSelectElement} */ (document.getElementById("facing-mode"))?.value ?? "full";
    const facingDir = /** @type {HTMLSelectElement} */ (document.getElementById("facing-direction"))?.value ?? "x";
    if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(toolD) || toolD <= 0) {
      hintEl.textContent = "";
      return;
    }
    const geom = getFacingEffectiveGeometry(ShapeType.RECTANGLE, { width, height, cornerRadius: 0 }, toolD / 2, facingMode);
    if (!geom) {
      hintEl.textContent = "";
      return;
    }
    const limit = facingDir === "y" ? geom.hwEff : geom.hhEff;
    const stepoverUnit = /** @type {HTMLInputElement} */ (document.querySelector('input[name="stepover-unit"]:checked'))?.value ?? "percent";
    const stepoverVal = toNumber(/** @type {HTMLInputElement} */ (document.getElementById("stepover"))?.value);
    let stepoverMm = stepoverUnit === "percent" && Number.isFinite(stepoverVal)
      ? (stepoverVal / 100) * toolD
      : stepoverUnit === "mm"
        ? toMm(stepoverVal, displayUnit)
        : NaN;
    if (!Number.isFinite(stepoverMm) || stepoverMm <= 0) {
      hintEl.textContent = "";
      return;
    }
    stepoverMm = Math.min(stepoverMm, toolD);
    const actualMm = computeEvenFacingStepover(limit, stepoverMm);
    if (actualMm == null) {
      hintEl.textContent = "";
      return;
    }
    const showVal = displayUnit === "inch" ? fromMm(actualMm, displayUnit).toFixed(3) : fromMm(actualMm, displayUnit).toFixed(2);
    hintEl.textContent = displayUnit === "inch"
      ? t("form.facingEvenSpacingStepoverHintIn", { val: showVal })
      : t("form.facingEvenSpacingStepoverHintMm", { val: showVal });
  }

  function updateUIForOperationTypeAndShape() {
    const opType = operationTypeSelect?.value ?? OperationTypeCategory.SHAPES;
    const selected = getEffectiveShape();
    const previous = updateUIForOperationTypeAndShape._prevShape;
    updateUIForOperationTypeAndShape._prevShape = selected;

    // Toon/verberg vorm-dropdown (alleen bij "Vormen")
    document.querySelectorAll(".vormen-only").forEach((el) => {
      if (opType === OperationTypeCategory.SHAPES) {
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    });

    const holePatternLayoutRow = document.getElementById("hole-pattern-layout-row");
    if (holePatternLayoutRow) {
      holePatternLayoutRow.classList.toggle("hidden", opType !== OperationTypeCategory.HOLE_PATTERN);
    }

    document
      .querySelectorAll(".shape-field")
      .forEach((el) => el.classList.add("hidden"));
    const map = {
      [ShapeType.CIRCLE]: ".shape-circle",
      [ShapeType.SQUARE]: ".shape-square",
      [ShapeType.RECTANGLE]: ".shape-rectangle",
      [ShapeType.HEXAGON]: ".shape-hexagon",
      [ShapeType.FACING]: ".shape-rectangle",
      [ShapeType.ELLIPSE]: ".shape-ellipse",
      [ShapeType.LETTERS]: ".shape-letters",
      [ShapeType.COUNTERBORE_BOLT]: ".shape-counterbore-bolt",
      [ShapeType.THREAD_MILLING]: ".shape-thread-milling",
      [ShapeType.PATTERNED_HOLES]: ".shape-patterned-holes",
      [ShapeType.CIRCULAR_PATTERN_HOLES]: ".shape-circular-pattern-holes",
      [ShapeType.DXF]: ".shape-dxf",
    };
    const selector = map[selected];
    if (selector) {
      document
        .querySelectorAll(selector)
        .forEach((el) => el.classList.remove("hidden"));
    }
    if (selected === ShapeType.SQUARE || selected === ShapeType.RECTANGLE) {
      document
        .querySelectorAll(".shape-rounded-corners")
        .forEach((el) => el.classList.remove("hidden"));
    }

    const operationRow = document.getElementById("operation-row");
    const contourOnlyElems = document.querySelectorAll(".contour-only");
    const facingOnlyElems = document.querySelectorAll(".facing-only");
    if (selected === ShapeType.LETTERS || selected === ShapeType.COUNTERBORE_BOLT || selected === ShapeType.THREAD_MILLING || selected === ShapeType.PATTERNED_HOLES) {
      if (operationRow) operationRow.classList.add("hidden");
      contourOnlyElems.forEach((el) => el.classList.add("hidden"));
      facingOnlyElems.forEach((el) => el.classList.add("hidden"));
    } else if (selected === ShapeType.CIRCULAR_PATTERN_HOLES) {
      if (operationRow) operationRow.classList.remove("hidden");
      facingOnlyElems.forEach((el) => el.classList.add("hidden"));
      const pocketOpt = operationSelect?.querySelector('option[value="pocket"]');
      if (pocketOpt) pocketOpt.disabled = false;
      contourOnlyElems.forEach((el) => el.classList.remove("hidden"));
      if (operationSelect?.value === OperationType.CONTOUR) {
        const contourTypeSelect = /** @type {HTMLSelectElement} */ (document.getElementById("contour-type"));
        if (contourTypeSelect) contourTypeSelect.value = "inside";
      }
      updateContourTypeVisibility();
    } else if (selected === ShapeType.DXF) {
      if (operationRow) operationRow.classList.remove("hidden");
      contourOnlyElems.forEach((el) => {
        el.classList.remove("hidden");
        if (el.classList.contains("plunge-outside-no-dxf")) el.classList.add("hidden");
      });
      facingOnlyElems.forEach((el) => el.classList.add("hidden"));
      const pocketOpt = operationSelect?.querySelector('option[value="pocket"]');
      if (pocketOpt) pocketOpt.disabled = false;
      if (operationSelect) operationSelect.value = OperationType.CONTOUR;
      const contourTypeSelect = /** @type {HTMLSelectElement} */ (document.getElementById("contour-type"));
      if (contourTypeSelect) contourTypeSelect.value = "outside";
      if (plungeOutsideInput) {
        plungeOutsideInput.value = "off";
        plungeOutsideButtons.forEach((b) => b.classList.toggle("entry-method-btn--active", b.dataset.plungeOutside === "off"));
      }
      if (previous !== ShapeType.DXF) {
        const u = getDisplayUnit();
        const toolEl = /** @type {HTMLInputElement | null} */ (document.getElementById("tool-diameter"));
        if (toolEl) toolEl.value = String(fromMm(DXF_ENGRAVING_TOOL_DIAMETER_MM, u));
      }
      updateContourTypeVisibility();
    } else if (selected === ShapeType.FACING) {
      if (operationRow) operationRow.classList.add("hidden");
      contourOnlyElems.forEach((el) => el.classList.add("hidden"));
      facingOnlyElems.forEach((el) => el.classList.remove("hidden"));

      // Facing defaults (only when switching into facing)
      if (previous !== ShapeType.FACING) {
        const u = getDisplayUnit();
        const toolEl = /** @type {HTMLInputElement | null} */ (document.getElementById("tool-diameter"));
        const totalDepthEl = /** @type {HTMLInputElement | null} */ (document.getElementById("total-depth"));
        const stepoverEl = /** @type {HTMLInputElement | null} */ (document.getElementById("stepover"));
        const facingFinishModeEl = /** @type {HTMLSelectElement | null} */ (document.getElementById("facing-finish-mode"));
        if (toolEl) toolEl.value = String(fromMm(25, u));
        if (totalDepthEl) totalDepthEl.value = String(fromMm(1, u));
        if (facingFinishModeEl) facingFinishModeEl.value = "off";
        // default stepover = 90% for facing
        const percentRadio = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="stepover-unit"][value="percent"]'));
        if (percentRadio) {
          percentRadio.checked = true;
          // Trigger the unit toggle handler so min/max + wrapper step update correctly
          percentRadio.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (stepoverEl) stepoverEl.value = "90";
        if (typeof updateStepoverHint === "function") updateStepoverHint();
        if (typeof updateRegenerateIndicator === "function") updateRegenerateIndicator();
      }
      // Forceer alle operatie-afhankelijke rijen (incl. finishing pass) meteen bij switch naar facing.
      updateContourTypeVisibility();
    } else {
      if (operationRow) operationRow.classList.remove("hidden");
      facingOnlyElems.forEach((el) => el.classList.add("hidden"));
      const pocketOpt = operationSelect?.querySelector('option[value="pocket"]');
      if (pocketOpt) pocketOpt.disabled = false;
      updateContourTypeVisibility();
    }
    if (selected !== ShapeType.DXF) {
      const pocketOpt = operationSelect?.querySelector('option[value="pocket"]');
      if (pocketOpt) pocketOpt.disabled = false;
    }

    // Standaard XY-origin per vorm
    if (xyOriginSelect) {
      if (selected === ShapeType.SQUARE || selected === ShapeType.RECTANGLE || selected === ShapeType.FACING || selected === ShapeType.LETTERS || selected === ShapeType.PATTERNED_HOLES || selected === ShapeType.DXF) {
        xyOriginSelect.value = XYOrigin.BOTTOM_LEFT;
      } else if (selected === ShapeType.CIRCLE || selected === ShapeType.ELLIPSE || selected === ShapeType.HEXAGON || selected === ShapeType.COUNTERBORE_BOLT || selected === ShapeType.THREAD_MILLING || selected === ShapeType.CIRCULAR_PATTERN_HOLES) {
        xyOriginSelect.value = XYOrigin.CENTER;
      }
    }

    const totalDepthRow = document.getElementById("total-depth-row");
    const multipleDepthsRow = document.getElementById("multiple-depths-row");
    const stepoverRowEl = document.getElementById("stepover-input-wrapper")?.closest(".field-row") ?? null;
    if (totalDepthRow) totalDepthRow.classList.toggle("hidden", selected === ShapeType.THREAD_MILLING);
    if (multipleDepthsRow) multipleDepthsRow.classList.toggle("hidden", selected === ShapeType.THREAD_MILLING);
    if (stepoverRowEl) stepoverRowEl.classList.toggle("hidden", selected === ShapeType.THREAD_MILLING);

    // Insteek-veld: zichtbaarheid via updateEntryMethodForEngraving (gravure + draadfrezen).

    if (selected === ShapeType.THREAD_MILLING && previous !== ShapeType.THREAD_MILLING) {
      const u = getDisplayUnit();
      const toolEl = /** @type {HTMLInputElement | null} */ (document.getElementById("tool-diameter"));
      if (toolEl) toolEl.value = String(fromMm(6, u));
      const systemEl = /** @type {HTMLSelectElement | null} */ (document.getElementById("thread-system"));
      if (systemEl) systemEl.value = "metric";
      populateThreadPresetOptions();
      const presetEl = /** @type {HTMLSelectElement | null} */ (document.getElementById("thread-preset"));
      if (presetEl) presetEl.value = "M6";
      const typeEl = /** @type {HTMLSelectElement | null} */ (document.getElementById("thread-mill-type"));
      if (typeEl) typeEl.value = ThreadMillType.INTERNAL;
      const cutDirEl = /** @type {HTMLSelectElement | null} */ (document.getElementById("thread-cut-direction"));
      if (cutDirEl) cutDirEl.value = ThreadCutDirection.BOTTOM_TO_TOP;
      const handEl = /** @type {HTMLSelectElement | null} */ (document.getElementById("thread-hand"));
      if (handEl) handEl.value = ThreadHand.RIGHT;
      applyThreadPreset("M6");
    }

    if (selected === ShapeType.LETTERS) {
      const totalDepthEl = /** @type {HTMLInputElement} */ (document.getElementById("total-depth"));
      if (totalDepthEl) totalDepthEl.value = "0.5";
    }

    updateCircularPatternHolesCenterRowVisibility();
    updateToolDiameterVisibility();
    updateThreadMillTypeVisibility();
    updateContourTypeVisibility();
    if (typeof updateStepoverHint === "function") updateStepoverHint();
    updateChainFieldLocks();
  }

  // Track last effective shape inside closure (static-like property)
  updateUIForOperationTypeAndShape._prevShape = null;

  function updateCircularPatternHolesCenterRowVisibility() {
    const centerRow = document.getElementById("circular-pattern-holes-center-diameter-row");
    const centerCb = /** @type {HTMLInputElement | null} */ (document.getElementById("circular-pattern-holes-center-hole"));
    if (centerRow && centerCb) {
      centerRow.classList.toggle("hidden", !centerCb.checked);
    }
  }

  operationTypeSelect?.addEventListener("change", updateUIForOperationTypeAndShape);
  shapeSelect?.addEventListener("change", updateUIForOperationTypeAndShape);

  const holePatternLayoutSelect = document.getElementById("hole-pattern-layout");
  holePatternLayoutSelect?.addEventListener("change", updateUIForOperationTypeAndShape);

  if (operationTypeSelect) {
    const legacyOp = operationTypeSelect.value;
    if (legacyOp === "circular_pattern_holes" || legacyOp === "patterned_holes") {
      operationTypeSelect.value = OperationTypeCategory.HOLE_PATTERN;
      if (holePatternLayoutSelect) {
        holePatternLayoutSelect.value = legacyOp === "circular_pattern_holes"
          ? HolePatternLayout.CIRCULAR
          : HolePatternLayout.GRID;
      }
    }
  }

  const circularPatternHolesCenterCb = document.getElementById("circular-pattern-holes-center-hole");
  if (circularPatternHolesCenterCb) {
    circularPatternHolesCenterCb.addEventListener("change", updateCircularPatternHolesCenterRowVisibility);
  }

  // DXF bestand: toon gekozen bestandsnaam
  const dxfFileInput = document.getElementById("dxf-file");
  const dxfFileNameEl = document.getElementById("dxf-file-name");
  if (dxfFileInput && dxfFileNameEl) {
    dxfFileInput.addEventListener("change", () => {
      const file = dxfFileInput.files && dxfFileInput.files[0];
      dxfFileNameEl.textContent = file ? file.name : "";
    });
  }

  initDxfSupportUI();

  // Presets: vierkant (50, 100, 150) en rechthoek (A4, A5, A6, foto) via dropdown; geselecteerde preset blijft zichtbaar tot breedte/hoogte handmatig wordt gewijzigd
  const squarePresetSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("square-preset"));
  const rectPresetSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("rect-preset"));
  const squareSizeInput = document.getElementById("square-size");
  const rectWidthInput = document.getElementById("rect-width");
  const rectHeightInput = document.getElementById("rect-height");

  if (squarePresetSelect) {
    squarePresetSelect.addEventListener("change", () => {
      const val = squarePresetSelect.value;
      if (!val) return;
      const mm = toNumber(val);
      if (squareSizeInput) /** @type {HTMLInputElement} */ (squareSizeInput).value = String(fromMm(mm, getDisplayUnit()));
    });
  }
  if (squareSizeInput && squarePresetSelect) {
    squareSizeInput.addEventListener("input", () => {
      const val = /** @type {HTMLInputElement} */ (squareSizeInput).value;
      const match = ["50", "100", "150"].includes(val) ? val : "";
      squarePresetSelect.value = match;
    });
  }

  if (rectPresetSelect) {
    rectPresetSelect.addEventListener("change", () => {
      const val = rectPresetSelect.value;
      if (!val) return;
      const [w, h] = val.split(",").map(Number);
      if (!Number.isFinite(w) || !Number.isFinite(h)) return;
      const u = getDisplayUnit();
      if (rectWidthInput) /** @type {HTMLInputElement} */ (rectWidthInput).value = String(fromMm(w, u));
      if (rectHeightInput) /** @type {HTMLInputElement} */ (rectHeightInput).value = String(fromMm(h, u));
    });
  }
  function syncRectPresetFromInputs() {
    if (!rectPresetSelect || !rectWidthInput || !rectHeightInput) return;
    const w = Math.round(parseFloat(/** @type {HTMLInputElement} */ (rectWidthInput).value) || 0);
    const h = Math.round(parseFloat(/** @type {HTMLInputElement} */ (rectHeightInput).value) || 0);
    const key1 = `${w},${h}`;
    const key2 = `${h},${w}`;
    const options = Array.from(rectPresetSelect.options);
    const match = options.find((opt) => opt.value === key1 || opt.value === key2);
    rectPresetSelect.value = match ? match.value : "";
  }
  if (rectWidthInput) rectWidthInput.addEventListener("input", syncRectPresetFromInputs);
  if (rectHeightInput) rectHeightInput.addEventListener("input", syncRectPresetFromInputs);

  // Preset patterned holes (Festool MFT)
  const patternedHolesPresetSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("patterned-holes-preset"));
  const patternedHolesDiameterInput = document.getElementById("patterned-holes-diameter");
  const patternedHolesSpacingXInput = document.getElementById("patterned-holes-spacing-x");
  const patternedHolesSpacingYInput = document.getElementById("patterned-holes-spacing-y");
  if (patternedHolesPresetSelect) {
    patternedHolesPresetSelect.addEventListener("change", () => {
      const val = patternedHolesPresetSelect.value;
      if (val === "mft") {
        const u = getDisplayUnit();
        if (patternedHolesDiameterInput) /** @type {HTMLInputElement} */ (patternedHolesDiameterInput).value = String(fromMm(20.2, u));
        if (patternedHolesSpacingXInput) /** @type {HTMLInputElement} */ (patternedHolesSpacingXInput).value = String(fromMm(96, u));
        if (patternedHolesSpacingYInput) /** @type {HTMLInputElement} */ (patternedHolesSpacingYInput).value = String(fromMm(96, u));
      }
      updatePatternedHolesTotalHint();
    });
  }
  function syncPatternedHolesPresetFromInputs() {
    if (!patternedHolesPresetSelect || !patternedHolesDiameterInput || !patternedHolesSpacingXInput || !patternedHolesSpacingYInput) return;
    const d = parseFloat(/** @type {HTMLInputElement} */ (patternedHolesDiameterInput).value);
    const sx = parseFloat(/** @type {HTMLInputElement} */ (patternedHolesSpacingXInput).value);
    const sy = parseFloat(/** @type {HTMLInputElement} */ (patternedHolesSpacingYInput).value);
    const isMft = Math.abs(d - 20.2) < 0.01 && Math.abs(sx - 96) < 0.01 && Math.abs(sy - 96) < 0.01;
    patternedHolesPresetSelect.value = isMft ? "mft" : "";
  }
  if (patternedHolesDiameterInput) patternedHolesDiameterInput.addEventListener("input", syncPatternedHolesPresetFromInputs);
  if (patternedHolesSpacingXInput) patternedHolesSpacingXInput.addEventListener("input", syncPatternedHolesPresetFromInputs);
  if (patternedHolesSpacingYInput) patternedHolesSpacingYInput.addEventListener("input", syncPatternedHolesPresetFromInputs);

  // Thread milling presets (metric / inch + M5, M6, etc.)
  const threadSystemSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("thread-system"));
  const threadPresetSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("thread-preset"));
  const threadMajorInput = document.getElementById("thread-major-diameter");
  const threadPitchInput = document.getElementById("thread-pitch");
  const threadHoleInput = document.getElementById("thread-hole-diameter");
  const threadDepthInput = document.getElementById("thread-milling-depth");

  const threadMillTypeSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("thread-mill-type"));

  function updateThreadMillTypeVisibility() {
    const isThread = getEffectiveShape() === ShapeType.THREAD_MILLING;
    const isInternal = (threadMillTypeSelect?.value || ThreadMillType.INTERNAL) === ThreadMillType.INTERNAL;
    document.querySelectorAll(".thread-internal-only").forEach((el) => {
      el.classList.toggle("hidden", !isThread || !isInternal);
    });
  }

  function populateThreadPresetOptions() {
    if (!threadPresetSelect || !threadSystemSelect) return;
    const system = threadSystemSelect.value || "metric";
    const presets = THREAD_PRESETS[system] || {};
    const prev = threadPresetSelect.value;
    threadPresetSelect.innerHTML = "";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.setAttribute("data-i18n", "form.presetsNone");
    noneOpt.textContent = t("form.presetsNone");
    threadPresetSelect.appendChild(noneOpt);
    Object.keys(presets).forEach((key) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = key;
      threadPresetSelect.appendChild(opt);
    });
    if (prev && presets[prev]) {
      threadPresetSelect.value = prev;
    } else {
      threadPresetSelect.value = "";
    }
  }

  function applyThreadPreset(presetKey) {
    if (!threadSystemSelect) return;
    const system = threadSystemSelect.value || "metric";
    const spec = presetKey ? THREAD_PRESETS[system]?.[presetKey] : null;
    if (!spec) return;
    const u = getDisplayUnit();
    if (threadMajorInput) /** @type {HTMLInputElement} */ (threadMajorInput).value = String(fromMm(spec.majorDia, u));
    if (threadPitchInput) /** @type {HTMLInputElement} */ (threadPitchInput).value = String(fromMm(spec.pitch, u));
    if (threadHoleInput && (threadMillTypeSelect?.value || ThreadMillType.INTERNAL) === ThreadMillType.INTERNAL) {
      /** @type {HTMLInputElement} */ (threadHoleInput).value = String(fromMm(spec.holeDia, u));
    }
    if (threadDepthInput) /** @type {HTMLInputElement} */ (threadDepthInput).value = String(fromMm(spec.defaultDepth, u));
  }

  function syncThreadPresetFromInputs() {
    if (!threadPresetSelect || !threadSystemSelect || !threadMajorInput || !threadPitchInput || !threadHoleInput || !threadDepthInput) return;
    const system = threadSystemSelect.value || "metric";
    const presets = THREAD_PRESETS[system] || {};
    const u = getDisplayUnit();
    const major = toMm(parseFloat(/** @type {HTMLInputElement} */ (threadMajorInput).value), u);
    const pitch = toMm(parseFloat(/** @type {HTMLInputElement} */ (threadPitchInput).value), u);
    const hole = toMm(parseFloat(/** @type {HTMLInputElement} */ (threadHoleInput).value), u);
    const depth = toMm(parseFloat(/** @type {HTMLInputElement} */ (threadDepthInput).value), u);
    const isInternal = (threadMillTypeSelect?.value || ThreadMillType.INTERNAL) === ThreadMillType.INTERNAL;
    const tol = 0.02;
    let match = "";
    for (const [key, spec] of Object.entries(presets)) {
      const majorOk = Math.abs(major - spec.majorDia) < tol;
      const pitchOk = Math.abs(pitch - spec.pitch) < tol;
      const depthOk = Math.abs(depth - spec.defaultDepth) < tol;
      const holeOk = !isInternal || Math.abs(hole - spec.holeDia) < tol;
      if (majorOk && pitchOk && depthOk && holeOk) {
        match = key;
        break;
      }
    }
    threadPresetSelect.value = match;
  }

  if (threadMillTypeSelect) {
    threadMillTypeSelect.addEventListener("change", () => {
      updateThreadMillTypeVisibility();
      syncThreadPresetFromInputs();
      if (typeof updateRegenerateIndicator === "function") updateRegenerateIndicator();
    });
  }
  if (threadSystemSelect) {
    threadSystemSelect.addEventListener("change", () => {
      populateThreadPresetOptions();
      threadPresetSelect.value = "";
    });
  }
  if (threadPresetSelect) {
    threadPresetSelect.addEventListener("change", () => {
      const val = threadPresetSelect.value;
      if (val) applyThreadPreset(val);
    });
  }
  [threadMajorInput, threadPitchInput, threadDepthInput].forEach((el) => {
    if (el) el.addEventListener("input", syncThreadPresetFromInputs);
  });
  populateThreadPresetOptions();

  // Patterned holes: toon totale horizontale en verticale afstand als hint (los bij X en Y)
  const patternedHolesTotalHintX = document.getElementById("patterned-holes-total-hint-x");
  const patternedHolesTotalHintY = document.getElementById("patterned-holes-total-hint-y");
  const patternedHolesCountXInput = document.getElementById("patterned-holes-count-x");
  const patternedHolesCountYInput = document.getElementById("patterned-holes-count-y");
  function updatePatternedHolesTotalHint() {
    if (!patternedHolesTotalHintX || !patternedHolesTotalHintY || !patternedHolesSpacingXInput || !patternedHolesSpacingYInput || !patternedHolesCountXInput || !patternedHolesCountYInput) return;
    const spacingX = toNumber(/** @type {HTMLInputElement} */ (patternedHolesSpacingXInput).value);
    const spacingY = toNumber(/** @type {HTMLInputElement} */ (patternedHolesSpacingYInput).value);
    const countX = Math.max(1, Math.floor(toNumber(/** @type {HTMLInputElement} */ (patternedHolesCountXInput).value) || 1));
    const countY = Math.max(1, Math.floor(toNumber(/** @type {HTMLInputElement} */ (patternedHolesCountYInput).value) || 1));
    const displayUnit = getDisplayUnit();
    const fmt = displayUnit === "inch" ? (v) => v.toFixed(3) : (v) => v.toFixed(2);
    const key = displayUnit === "inch" ? "form.patternedHolesTotalHintIn" : "form.patternedHolesTotalHintMm";
    const totalX = Number.isFinite(spacingX) ? (countX - 1) * spacingX : NaN;
    const totalY = Number.isFinite(spacingY) ? (countY - 1) * spacingY : NaN;
    patternedHolesTotalHintX.textContent = Number.isFinite(totalX) ? t(key, { axis: "X", total: fmt(totalX) }) : "";
    patternedHolesTotalHintY.textContent = Number.isFinite(totalY) ? t(key, { axis: "Y", total: fmt(totalY) }) : "";
  }
  const updateHint = updatePatternedHolesTotalHint;
  if (patternedHolesSpacingXInput) { patternedHolesSpacingXInput.addEventListener("input", updateHint); patternedHolesSpacingXInput.addEventListener("change", updateHint); }
  if (patternedHolesSpacingYInput) { patternedHolesSpacingYInput.addEventListener("input", updateHint); patternedHolesSpacingYInput.addEventListener("change", updateHint); }
  if (patternedHolesCountXInput) { patternedHolesCountXInput.addEventListener("input", updateHint); patternedHolesCountXInput.addEventListener("change", updateHint); }
  if (patternedHolesCountYInput) { patternedHolesCountYInput.addEventListener("input", updateHint); patternedHolesCountYInput.addEventListener("change", updateHint); }
  document.addEventListener("languagechange", updatePatternedHolesTotalHint);
  document.addEventListener("unitchange", updatePatternedHolesTotalHint);
  updatePatternedHolesTotalHint();

  // Initiële sync zodat standaardwaarden (bijv. vierkant 50) in de preset-dropdown zichtbaar zijn
  if (squareSizeInput && squarePresetSelect) {
    const v = /** @type {HTMLInputElement} */ (squareSizeInput).value;
    if (["50", "100", "150"].includes(v)) squarePresetSelect.value = v;
  }
  syncRectPresetFromInputs();
  syncPatternedHolesPresetFromInputs();

  const letterModeSelect = /** @type {HTMLSelectElement} */ (document.getElementById("letter-mode"));
  const toolDiameterRow = document.getElementById("tool-diameter-row");
  const toolDiameterOutlineHint = document.getElementById("tool-diameter-outline-hint");
  const toolDiameterThreadHint = document.getElementById("tool-diameter-thread-hint");
  function updateToolDiameterVisibility() {
    const shape = getEffectiveShape();
    const contourType = normalizeContourType(
      /** @type {HTMLSelectElement | null} */ (document.getElementById("contour-type"))?.value
    );
    const isEngravingNoToolD = isEngravingContourMode(
      shape,
      contourType,
      letterModeSelect?.value || "outline"
    );
    const isThreadMilling = shape === ShapeType.THREAD_MILLING;
    if (toolDiameterRow) {
      if (isEngravingNoToolD) {
        toolDiameterRow.classList.add("hidden");
      } else {
        toolDiameterRow.classList.remove("hidden");
      }
    }
    if (toolDiameterOutlineHint) {
      toolDiameterOutlineHint.classList.toggle("hidden", !isEngravingNoToolD);
    }
    if (toolDiameterThreadHint) {
      toolDiameterThreadHint.classList.toggle("hidden", !isThreadMilling);
    }
    const toolDInput = /** @type {HTMLInputElement} */ (document.getElementById("tool-diameter"));
    if (toolDInput) {
      toolDInput.disabled = !!isEngravingNoToolD;
      toolDInput.removeAttribute("required");
      if (!isEngravingNoToolD) toolDInput.setAttribute("required", "");
    }
    updateEntryMethodForEngraving();
  }
  function updateEntryMethodForEngraving() {
    const shape = getEffectiveShape();
    const contourType = normalizeContourType(
      /** @type {HTMLSelectElement | null} */ (document.getElementById("contour-type"))?.value
    );
    const forcePlunge = isEngravingContourMode(shape, contourType, letterModeSelect?.value || "outline");
    const hideForThread = shape === ShapeType.THREAD_MILLING;
    const entrySettingsFieldset = document.getElementById("entry-settings-fieldset");
    if (entrySettingsFieldset) {
      entrySettingsFieldset.classList.toggle("hidden", forcePlunge || hideForThread);
    }
    if (forcePlunge) {
      if (entryMethodInput) entryMethodInput.value = EntryMethod.PLUNGE;
      entryButtons.forEach((b) => {
        if (b.dataset.entry === EntryMethod.RAMP) {
          b.classList.remove("entry-method-btn--active");
          b.disabled = true;
        } else if (b.dataset.entry === EntryMethod.PLUNGE) {
          b.classList.add("entry-method-btn--active");
          b.disabled = false;
        }
      });
      if (rampSettings) rampSettings.classList.add("hidden");
      if (typeof updateRampInputsDisabled === "function") updateRampInputsDisabled();
    } else if (!hideForThread) {
      entryButtons.forEach((b) => {
        if (b.dataset.entry === EntryMethod.RAMP || b.dataset.entry === EntryMethod.PLUNGE) {
          b.disabled = false;
        }
      });
    }
  }
  if (letterModeSelect) {
    letterModeSelect.addEventListener("change", () => {
      updateToolDiameterVisibility();
      updateEntryMethodForEngraving();
    });
  }
  const contourTypeSelectForToolD = /** @type {HTMLSelectElement | null} */ (document.getElementById("contour-type"));
  function applyDxfEngravingToolDefault() {
    const shape = getEffectiveShape();
    if (shape !== ShapeType.DXF) return;
    const contourType = normalizeContourType(contourTypeSelectForToolD?.value);
    if (contourType !== "engraving") return;
    const u = getDisplayUnit();
    const toolEl = /** @type {HTMLInputElement | null} */ (document.getElementById("tool-diameter"));
    if (toolEl) toolEl.value = String(fromMm(DXF_ENGRAVING_TOOL_DIAMETER_MM, u));
  }
  if (contourTypeSelectForToolD) {
    contourTypeSelectForToolD.addEventListener("change", () => {
      applyDxfEngravingToolDefault();
      updateToolDiameterVisibility();
    });
  }
  updateToolDiameterVisibility();

  function updateContourTypeVisibility() {
    const op = operationSelect.value;
    const shape = getEffectiveShape();
    const showContour = op === OperationType.CONTOUR;
    const showFacing = shape === ShapeType.FACING;

    const contourTypeSelect = /** @type {HTMLSelectElement} */ (document.getElementById("contour-type"));
    const outsideOpt = document.getElementById("contour-type-outside");
    const engravingOpt = document.getElementById("contour-type-engraving");
    const isCircularPatternHoles = shape === ShapeType.CIRCULAR_PATTERN_HOLES;
    const isDxf = shape === ShapeType.DXF;
    if (outsideOpt) {
      if (showContour && isCircularPatternHoles) {
        outsideOpt.setAttribute("hidden", "");
        outsideOpt.disabled = true;
        if (contourTypeSelect && contourTypeSelect.value === "outside") {
          contourTypeSelect.value = "inside";
        }
      } else {
        outsideOpt.removeAttribute("hidden");
        outsideOpt.disabled = false;
      }
    }
    if (engravingOpt) {
      if (showContour && isDxf) {
        engravingOpt.removeAttribute("hidden");
        engravingOpt.disabled = false;
      } else {
        engravingOpt.setAttribute("hidden", "");
        engravingOpt.disabled = true;
        if (contourTypeSelect && contourTypeSelect.value === "engraving") {
          contourTypeSelect.value = "outside";
        }
      }
    }

    const contourOnlyElems = document.querySelectorAll(".contour-only");
    const isDxfEngraving = isDxf && showContour && contourTypeSelect?.value === "engraving";
    const isCircularPatternHolesContour = showContour && shape === ShapeType.CIRCULAR_PATTERN_HOLES;
    if (isCircularPatternHolesContour && plungeOutsideInput) {
      plungeOutsideInput.value = "off";
      plungeOutsideButtons.forEach((b) => b.classList.toggle("entry-method-btn--active", b.dataset.plungeOutside === "off"));
    }
    contourOnlyElems.forEach((el) => {
      if (showContour) {
        el.classList.remove("hidden");
        if (el.classList.contains("plunge-outside-no-dxf") && isDxf) el.classList.add("hidden");
        if (el.classList.contains("plunge-outside-no-circular-pattern-holes") && isCircularPatternHolesContour) el.classList.add("hidden");
        if (el.id === "tab-settings" && isDxfEngraving) el.classList.add("hidden");
      } else {
        el.classList.add("hidden");
      }
    });

    const facingOnlyElems = document.querySelectorAll(".facing-only");
    facingOnlyElems.forEach((el) => {
      if (showFacing) {
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    });

    // Stepover: pocket/facing; draadfrezen later via THREAD_MILLING_SPRING_PASSES_ENABLED
    if (stepoverRow) {
      const showStepover = (op === OperationType.POCKET || op === OperationType.FACING)
        && shape !== ShapeType.THREAD_MILLING;
      if (showStepover) {
        stepoverRow.classList.remove("hidden");
      } else {
        stepoverRow.classList.add("hidden");
      }
    }

    // Nabewerkingslaag is relevant voor pocket en contour.
    // Voor PATTERNED_HOLES is de operatie altijd pocket, ook als de select iets anders zegt.
    const effectiveOpForPocket = shape === ShapeType.FACING
      ? OperationType.FACING
      : (shape === ShapeType.PATTERNED_HOLES ? OperationType.POCKET : op);
    const showPocket = effectiveOpForPocket === OperationType.POCKET;
    const showFinishingPass = (effectiveOpForPocket === OperationType.POCKET || effectiveOpForPocket === OperationType.CONTOUR)
      && shape !== ShapeType.THREAD_MILLING
      && !isDxfEngraving;
    document.querySelectorAll(".pocket-only").forEach((el) => {
      el.classList.toggle("hidden", !showPocket);
    });
    document.querySelectorAll(".finishing-pass-only").forEach((el) => {
      el.classList.toggle("hidden", !showFinishingPass);
    });
    const fpCheckbox = /** @type {HTMLInputElement|null} */ (document.getElementById("finishing-pass-enabled"));
    if (fpCheckbox) fpCheckbox.disabled = !showFinishingPass;
    if (!showFinishingPass) {
      if (fpCheckbox) fpCheckbox.checked = false;
    }
    // Synchroniseer de afstandsrij met de checkboxstatus (ook bij wisselen naar pocket).
    // Gebruik getElementById direct om temporal dead zone van de const-variabelen te vermijden.
    {
      const fpCb = /** @type {HTMLInputElement} */ (document.getElementById("finishing-pass-enabled"));
      const fpDRow = document.getElementById("finishing-pass-distance-row");
      const fpSpeedRow = document.getElementById("finishing-pass-speed-override-row");
      const fpOverlapRow = document.getElementById("finishing-pass-overlap-row");
      const showFinDistance = fpCb && fpCb.checked
        && (effectiveOpForPocket === OperationType.POCKET || effectiveOpForPocket === OperationType.CONTOUR)
        && shape !== ShapeType.THREAD_MILLING;
      if (fpCb && fpDRow) fpDRow.classList.toggle("hidden", !showFinDistance);
      if (fpCb && fpSpeedRow) fpSpeedRow.classList.toggle("hidden", !fpCb.checked);
      if (fpCb && fpOverlapRow) fpOverlapRow.classList.toggle("hidden", !fpCb.checked);
    }

    // Bij wisselen naar niet-contour of DXF-gravering: tabs uitzetten en parameters verbergen; insteken naast part uit
    if (!showContour || isDxfEngraving) {
      if (tabsEnabledCheckbox) {
        tabsEnabledCheckbox.checked = false;
        updateTabParamsVisibility();
      }
      if (plungeOutsideInput) {
        plungeOutsideInput.value = "off";
        plungeOutsideButtons.forEach((b) => {
          b.classList.toggle("entry-method-btn--active", b.dataset.plungeOutside === "off");
        });
      }
    }
    updateContourTabsRampHintVisibility();
    updateFacingEvenSpacingHint();
    updateToolDiameterVisibility();
    updateEntryMethodForEngraving();
  }
  operationSelect.addEventListener("change", updateContourTypeVisibility);
  if (contourTypeSelectForToolD) contourTypeSelectForToolD.addEventListener("change", updateContourTypeVisibility);
  updateContourTypeVisibility();

  const rampAngleInput = /** @type {HTMLInputElement} */ (document.getElementById("ramp-angle"));
  function updateRampInputsDisabled() {
    const rampVisible = rampSettings && !rampSettings.classList.contains("hidden");
    if (rampAngleInput) rampAngleInput.disabled = !rampVisible;
  }
  entryButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.entry;
      if (!value || !entryMethodInput) return;
      const shape = getEffectiveShape();
      const contourType = normalizeContourType(
        /** @type {HTMLSelectElement | null} */ (document.getElementById("contour-type"))?.value
      );
      if (value === EntryMethod.RAMP && isEngravingContourMode(shape, contourType, letterModeSelect?.value || "outline")) {
        return;
      }

      entryMethodInput.value = value;

      entryButtons.forEach((b) =>
        b.classList.remove("entry-method-btn--active")
      );
      btn.classList.add("entry-method-btn--active");

      if (value === EntryMethod.RAMP) {
        rampSettings.classList.remove("hidden");
      } else {
        rampSettings.classList.add("hidden");
      }
      updateRampInputsDisabled();
      updateContourTabsRampHintVisibility();
      updateContourTypeVisibility();
      if (typeof updateRegenerateIndicator === "function") updateRegenerateIndicator();
    });
  });
  // init zichtbaarheid ramp-instellingen op basis van huidige entry-method
  if (entryMethodInput && entryMethodInput.value === EntryMethod.RAMP) {
    rampSettings.classList.remove("hidden");
  } else {
    rampSettings.classList.add("hidden");
  }
  updateEntryMethodForEngraving();
  updateRampInputsDisabled();
  updateContourTabsRampHintVisibility();

  // Toggle-knoppen voor "Insteken naast part"
  plungeOutsideButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.plungeOutside;
      if (!value || !plungeOutsideInput) return;

      plungeOutsideInput.value = value;

      plungeOutsideButtons.forEach((b) =>
        b.classList.remove("entry-method-btn--active")
      );
      btn.classList.add("entry-method-btn--active");
      updateContourTypeVisibility();
      if (typeof updateRegenerateIndicator === "function") updateRegenerateIndicator();
    });
  });

  // Algemene stepper-knoppen: leest data-step/data-min/data-max bij elke klik (zodat stepover toggle werkt)
  const toolDiameterInput = /** @type {HTMLInputElement} */ (document.getElementById("tool-diameter"));
  const stepoverInput = /** @type {HTMLInputElement} */ (document.getElementById("stepover"));
  if (tabsEnabledCheckbox) {
    tabsEnabledCheckbox.addEventListener("change", updateTabParamsVisibility);
  }
  updateTabParamsVisibility();
  document.querySelectorAll(".input-with-stepper[data-step]").forEach((wrapper) => {
    const input = /** @type {HTMLInputElement} */ (
      wrapper.querySelector("input[type='number'], input.decimal-input")
    );
    const downBtn = /** @type {HTMLButtonElement | HTMLInputElement | null} */ (wrapper.querySelector(".stepper-down"));
    const upBtn = /** @type {HTMLButtonElement | HTMLInputElement | null} */ (wrapper.querySelector(".stepper-up"));
    if (!input || !downBtn || !upBtn) return;

    // Zorg dat Tab van het invoerveld direct naar het volgende veld gaat
    // en niet eerst op de + / - stepper-knoppen komt.
    downBtn.tabIndex = -1;
    upBtn.tabIndex = -1;

    function getStepMinMax() {
      const step = parseFloat(/** @type {string} */ (wrapper.getAttribute("data-step")));
      const minAttr = wrapper.getAttribute("data-min");
      const maxAttr = wrapper.getAttribute("data-max");
      const min = minAttr === "" || minAttr === null ? -Infinity : parseFloat(minAttr);
      const max = maxAttr === "" || maxAttr === null ? Infinity : parseFloat(maxAttr);
      return { step: Number.isFinite(step) ? step : 1, min, max };
    }

    function applyDelta(delta) {
      const { step, min, max } = getStepMinMax();

      const stepDecimals = String(step).includes(".")
        ? String(step).split(".")[1].length
        : 0;

      const currentStr = String(input.value ?? "").trim().replace(",", ".");
      const typedDecimals = currentStr.includes(".")
        ? currentStr.split(".")[1].length
        : 0;

      const minDecimals = (input.step === "any" || input.classList.contains("decimal-input")) ? 1 : 0;
      const decimals = Math.max(stepDecimals, typedDecimals, minDecimals);
      const factor = Math.pow(10, decimals);

      const current = toNumber(input.value) || 0;
      const next = decimals > 0
        ? Math.round((current + delta) * factor) / factor
        : Math.round(current + delta);

      const clamped = Math.min(max, Math.max(min, next));
      input.value = String(clamped);
      if (input.id === "tool-diameter" || input.id === "stepover") updateStepoverHint();
      if (input.id === "patterned-holes-spacing-x" || input.id === "patterned-holes-spacing-y" || input.id === "patterned-holes-count-x" || input.id === "patterned-holes-count-y") {
        if (typeof updatePatternedHolesTotalHint === "function") updatePatternedHolesTotalHint();
      }
      if (typeof updateRegenerateIndicator === "function") updateRegenerateIndicator();
    }

    downBtn.addEventListener("click", () => applyDelta(-getStepMinMax().step));
    upBtn.addEventListener("click", () => applyDelta(getStepMinMax().step));
  });

  // Stepover eenheid toggle: % ↔ mm, waarde omrekenen en input/wrapper aanpassen
  const stepoverWrapper = document.getElementById("stepover-input-wrapper");
  const stepoverUnitRadios = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name="stepover-unit"]'));

  // Tab mag de stepover-unit radios (% / mm) overslaan; deze blijven wel met de muis bedienbaar.
  stepoverUnitRadios.forEach((radio) => {
    radio.tabIndex = -1;
    radio.addEventListener("change", () => {
      if (!stepoverInput || !stepoverWrapper || !toolDiameterInput) return;
      const d = toNumber(toolDiameterInput.value) || 6;
      const currentVal = toNumber(stepoverInput.value);
      if (radio.value === "mm") {
        const mm = Number.isFinite(currentVal) && d > 0 ? (currentVal / 100) * d : d * 0.5;
        stepoverInput.value = String(Math.round(mm * 100) / 100);
        stepoverInput.min = "0";
        stepoverInput.max = String(d);
        stepoverInput.step = "any";
        stepoverWrapper.setAttribute("data-step", "0.5");
        stepoverWrapper.setAttribute("data-min", "0");
        stepoverWrapper.setAttribute("data-max", String(d));
      } else {
        const pct = d > 0 && Number.isFinite(currentVal) ? Math.round((currentVal / d) * 100) : 50;
        stepoverInput.value = String(Math.min(100, Math.max(1, pct)));
        stepoverInput.min = "1";
        stepoverInput.max = "100";
        stepoverInput.step = "any";
        stepoverWrapper.setAttribute("data-step", "10");
        stepoverWrapper.setAttribute("data-min", "1");
        stepoverWrapper.setAttribute("data-max", "100");
      }
      updateStepoverHint();
      if (typeof updateRegenerateIndicator === "function") updateRegenerateIndicator();
    });
  });

  // Stepover-hint: in %-modus tonen we mm of in (d en val zijn altijd in display-eenheid), in mm/in-modus tonen we %
  const stepoverMmHint = document.getElementById("stepover-mm-hint");
  const facingEvenSpacingInput = /** @type {HTMLInputElement | null} */ (document.getElementById("facing-even-spacing"));
  function updateStepoverHint() {
    if (!stepoverMmHint || !stepoverInput || !toolDiameterInput) return;
    const d = toNumber(toolDiameterInput.value);
    const val = toNumber(stepoverInput.value);
    const stepoverUnit = /** @type {HTMLInputElement} */ (document.querySelector('input[name="stepover-unit"]:checked'))?.value;
    const displayUnit = getDisplayUnit();
    if (!Number.isFinite(d) || !Number.isFinite(val)) {
      stepoverMmHint.textContent = "";
      updateFacingEvenSpacingHint();
      return;
    }

    if (getEffectiveShape() === ShapeType.THREAD_MILLING && THREAD_MILLING_SPRING_PASSES_ENABLED) {
      const holeEl = /** @type {HTMLInputElement | null} */ (document.getElementById("thread-hole-diameter"));
      const majorEl = /** @type {HTMLInputElement | null} */ (document.getElementById("thread-major-diameter"));
      const holeD = holeEl ? toMm(toNumber(holeEl.value), displayUnit) : NaN;
      const majorD = majorEl ? toMm(toNumber(majorEl.value), displayUnit) : NaN;
      const toolD = toMm(d, displayUnit);
      let stepoverMm = stepoverUnit === "percent" ? (val / 100) * toolD : stepoverUnit === "mm" ? toMm(val, displayUnit) : NaN;
      if (!Number.isFinite(stepoverMm) || stepoverMm <= 0) stepoverMm = 0.5 * toolD;
      stepoverMm = Math.min(stepoverMm, toolD);
      const passCount = Number.isFinite(holeD) && Number.isFinite(majorD)
        ? computeThreadMillingPassRadii(holeD, majorD, toolD, stepoverMm).length
        : 0;
      const showVal = displayUnit === "inch" ? fromMm(stepoverMm, displayUnit).toFixed(3) : fromMm(stepoverMm, displayUnit).toFixed(2);
      const key = displayUnit === "inch" ? "form.threadStepoverHintIn" : "form.threadStepoverHintMm";
      stepoverMmHint.textContent = passCount > 0 ? t(key, { passes: passCount, val: showVal }) : "";
      updateFacingEvenSpacingHint();
      return;
    }

    if (stepoverUnit === "percent" && d > 0) {
      const stepoverInDisplayUnit = (val / 100) * d;
      const showVal = displayUnit === "inch" ? stepoverInDisplayUnit.toFixed(3) : stepoverInDisplayUnit.toFixed(2);
      stepoverMmHint.textContent = displayUnit === "inch"
        ? t("form.stepoverInHint", { val: showVal })
        : t("form.stepoverMmHint", { val: showVal });
    } else if (stepoverUnit === "mm" && d > 0) {
      const pct = Math.round((val / d) * 100);
      stepoverMmHint.textContent = t("form.stepoverPctHint", { pct });
    } else {
      stepoverMmHint.textContent = "";
    }
    updateFacingEvenSpacingHint();
  }
  if (toolDiameterInput) {
    toolDiameterInput.addEventListener("input", updateStepoverHint);
    toolDiameterInput.addEventListener("change", () => {
      if (stepoverWrapper && stepoverInput) updateStepoverMaxWhenMm();
    });
  }
  if (stepoverInput) stepoverInput.addEventListener("input", updateStepoverHint);
  document.addEventListener("languagechange", updateStepoverHint);
  document.addEventListener("unitchange", updateStepoverHint);
  document.addEventListener("languagechange", updateFacingEvenSpacingHint);
  document.addEventListener("unitchange", updateFacingEvenSpacingHint);
  document.addEventListener("modechange", updateFacingEvenSpacingHint);
  if (facingEvenSpacingInput) {
    facingEvenSpacingInput.addEventListener("change", updateFacingEvenSpacingHint);
  }
  ["facing-mode", "facing-direction"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", updateFacingEvenSpacingHint);
  });
  if (rectWidthInput) rectWidthInput.addEventListener("input", updateFacingEvenSpacingHint);
  if (rectHeightInput) rectHeightInput.addEventListener("input", updateFacingEvenSpacingHint);
  document.addEventListener("unitchange", updateRegenerateIndicator);
  document.addEventListener("modechange", updateRegenerateIndicator);
  function updateStepoverMaxWhenMm() {
    const unit = /** @type {HTMLInputElement} */ (document.querySelector('input[name="stepover-unit"]:checked'))?.value;
    if (unit === "mm" && stepoverWrapper && stepoverInput && toolDiameterInput) {
      if (isPartialDecimalInput(toolDiameterInput.value)) return;
      const d = toNumber(toolDiameterInput.value);
      if (Number.isFinite(d) && d > 0) {
        stepoverInput.max = String(d);
        stepoverWrapper.setAttribute("data-max", String(d));
        const current = toNumber(stepoverInput.value);
        if (current > d) {
          stepoverInput.value = String(d);
        }
      }
    }
  }
  updateStepoverHint();
  updateFacingEvenSpacingHint();

  // Meerdere dieptes: stepdown-row tonen/verbergen; default stepdown = totale diepte / 2 (max laaghoogte)
  const multipleDepthsCheckbox = /** @type {HTMLInputElement} */ (document.getElementById("multiple-depths"));
  const stepdownRow = document.getElementById("stepdown-row");
  const totalDepthInput = /** @type {HTMLInputElement} */ (document.getElementById("total-depth"));
  const stepdownInput = /** @type {HTMLInputElement} */ (document.getElementById("stepdown"));
  function setDefaultStepdownFromTotalDepth() {
    if (!stepdownInput || !totalDepthInput) return;
    const depth = toNumber(totalDepthInput.value);
    if (Number.isFinite(depth) && depth > 0) {
      const defaultStepdown = Math.round((depth / 2) * 100) / 100;
      stepdownInput.value = String(defaultStepdown);
    }
  }
  function updateStepdownVisibility() {
    if (!stepdownRow || !multipleDepthsCheckbox) return;
    if (multipleDepthsCheckbox.checked) {
      stepdownRow.classList.remove("hidden");
      setDefaultStepdownFromTotalDepth();
    } else {
      stepdownRow.classList.add("hidden");
    }
  }
  if (multipleDepthsCheckbox) {
    // Tab mag ook de 'Multiple depths'-toggle overslaan.
    multipleDepthsCheckbox.tabIndex = -1;
    function onMultipleDepthsToggle() {
      setTimeout(updateStepdownVisibility, 0);
    }
    multipleDepthsCheckbox.addEventListener("change", onMultipleDepthsToggle);
    multipleDepthsCheckbox.addEventListener("click", onMultipleDepthsToggle);
  }
  updateStepdownVisibility();

  // Nabewerkingslaag: finishing-pass-distance-row tonen/verbergen
  const finishingPassCheckbox = /** @type {HTMLInputElement} */ (document.getElementById("finishing-pass-enabled"));
  const finishingPassDistRow = document.getElementById("finishing-pass-distance-row");
  const finishingPassSpeedOverrideRow = document.getElementById("finishing-pass-speed-override-row");
  const finishingPassOverlapRow = document.getElementById("finishing-pass-overlap-row");
  const finishingPassSpeedOverrideInput = /** @type {HTMLInputElement} */ (document.getElementById("finishing-pass-speed-override"));
  const finishingPassSpeedOverrideValue = document.getElementById("finishing-pass-speed-override-value");
  const finishingPassSpeedOverrideHint = document.getElementById("finishing-pass-speed-override-hint");
  const feedrateInputForFinishingHint = /** @type {HTMLInputElement} */ (document.getElementById("feedrate"));
  function updateFinishingPassSpeedOverrideHint() {
    if (!finishingPassSpeedOverrideHint) return;
    const displayUnit = getDisplayUnit();
    const baseFeed = toNumber(feedrateInputForFinishingHint?.value);
    const pct = finishingPassSpeedOverrideInput
      ? Math.max(5, Math.min(200, Math.round(toNumber(finishingPassSpeedOverrideInput.value) || 100)))
      : 100;
    const feed = Number.isFinite(baseFeed) && baseFeed > 0 ? (baseFeed * pct) / 100 : 0;
    const showVal = displayUnit === "inch"
      ? (Math.round(feed * 100) / 100).toFixed(2)
      : String(Math.round(feed));
    const key = displayUnit === "inch"
      ? "form.finishingPassSpeedOverrideHintIn"
      : "form.finishingPassSpeedOverrideHintMm";
    finishingPassSpeedOverrideHint.textContent = t(key, { val: showVal });
  }
  function updateFinishingPassSpeedOverrideValue() {
    if (!finishingPassSpeedOverrideInput || !finishingPassSpeedOverrideValue) return;
    const pct = Math.max(5, Math.min(200, Math.round(toNumber(finishingPassSpeedOverrideInput.value) || 100)));
    finishingPassSpeedOverrideInput.value = String(pct);
    finishingPassSpeedOverrideValue.textContent = `${pct}%`;
    updateFinishingPassSpeedOverrideHint();
  }
  function updateFinishingPassDistVisibility() {
    if (!finishingPassDistRow || !finishingPassCheckbox) return;
    const opType = (/** @type {HTMLSelectElement} */ (document.getElementById("operation-type")))?.value ?? OperationTypeCategory.SHAPES;
    const shape = resolveEffectiveShape(
      opType,
      (/** @type {HTMLSelectElement} */ (document.getElementById("shape")))?.value
    );
    const opRaw = (/** @type {HTMLSelectElement} */ (document.getElementById("operation")))?.value;
    const effectiveOp = shape === ShapeType.FACING
      ? OperationType.FACING
      : (shape === ShapeType.PATTERNED_HOLES ? OperationType.POCKET : opRaw);
    const showDistanceForOp = (effectiveOp === OperationType.POCKET || effectiveOp === OperationType.CONTOUR)
      && shape !== ShapeType.THREAD_MILLING;
    finishingPassCheckbox.disabled = !showDistanceForOp;
    if (!showDistanceForOp) {
      finishingPassCheckbox.checked = false;
    }
    if (finishingPassCheckbox.checked) {
      finishingPassDistRow.classList.toggle("hidden", !showDistanceForOp);
      if (finishingPassSpeedOverrideRow) finishingPassSpeedOverrideRow.classList.remove("hidden");
      if (finishingPassOverlapRow) finishingPassOverlapRow.classList.remove("hidden");
    } else {
      finishingPassDistRow.classList.add("hidden");
      if (finishingPassSpeedOverrideRow) finishingPassSpeedOverrideRow.classList.add("hidden");
      if (finishingPassOverlapRow) finishingPassOverlapRow.classList.add("hidden");
    }
    updateFinishingPassSpeedOverrideValue();
  }
  if (finishingPassCheckbox) {
    finishingPassCheckbox.tabIndex = -1;
    finishingPassCheckbox.addEventListener("change", updateFinishingPassDistVisibility);
    finishingPassCheckbox.addEventListener("click", updateFinishingPassDistVisibility);
  }
  if (finishingPassSpeedOverrideInput) {
    finishingPassSpeedOverrideInput.addEventListener("input", updateFinishingPassSpeedOverrideValue);
    finishingPassSpeedOverrideInput.addEventListener("change", updateFinishingPassSpeedOverrideValue);
  }
  if (feedrateInputForFinishingHint) {
    feedrateInputForFinishingHint.addEventListener("input", updateFinishingPassSpeedOverrideHint);
    feedrateInputForFinishingHint.addEventListener("change", updateFinishingPassSpeedOverrideHint);
  }
  document.addEventListener("unitchange", updateFinishingPassSpeedOverrideHint);
  updateFinishingPassDistVisibility();

  // Spindle speed: spindle-speed-row tonen/verbergen
  const spindleSpeedEnabledCheckbox = /** @type {HTMLInputElement} */ (document.getElementById("spindle-speed-enabled"));
  const spindleSpeedRow = document.getElementById("spindle-speed-row");
  function updateSpindleSpeedVisibility() {
    if (!spindleSpeedRow || !spindleSpeedEnabledCheckbox) return;
    if (spindleSpeedEnabledCheckbox.checked) {
      spindleSpeedRow.classList.remove("hidden");
    } else {
      spindleSpeedRow.classList.add("hidden");
    }
  }
  if (spindleSpeedEnabledCheckbox) {
    spindleSpeedEnabledCheckbox.addEventListener("change", updateSpindleSpeedVisibility);
    spindleSpeedEnabledCheckbox.addEventListener("click", updateSpindleSpeedVisibility);
  }
  updateSpindleSpeedVisibility();
  document.addEventListener("modechange", updateSpindleSpeedVisibility);

  // Preview-weergave knoppen
  viewButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.view;
      if (!mode) return;
      currentPreviewView = /** @type {keyof typeof PreviewViewMode} */ (mode);

      viewButtons.forEach((b) => b.classList.remove("preview-view-btn--active"));
      btn.classList.add("preview-view-btn--active");

      renderPreview(lastToolpath, previewCanvas, currentPreviewView, getDisplayedColumn());
    });
  });

  // Kolom in preview op het punt van de gcode-regel waar de cursor staat (diameter = freesdikte, hoogte 50 mm)
  let cursorColumnForPreview = null;

  // Playback: time-based animatie op vaste 10fps, positie geïnterpoleerd langs het pad
  const GCODE_HEADER_LINES = 8; // aantal regels vóór de eerste beweging in gegenereerde gcode
  const PREVIEW_TICK_MS = 67; // 15fps
  let playbackElapsedMs = 0;
  let playbackStartTime = 0;
  let isPlaying = false;
  let playbackIntervalId = null;
  let playbackSpeedMultiplier = 1; // 0.5–15× feedrate
  /** @type {number[]} cumulatieve segmentduur in ms (index i = eindtijd van segment i→i+1), gebouwd bij start playback */
  let playbackCumulativeTimesMs = [];
  let playbackTotalDurationMs = 0;

  /**
   * Berekent de preview-duur in ms voor het segment van move index naar index+1.
   * @param {ToolpathMove[]} moves
   * @param {number} index
   * @param {number} feedrateMmMin
   * @param {number} speedMultiplier
   * @returns {number}
   */
  function getSegmentDurationMs(moves, index, feedrateMmMin, speedMultiplier) {
    if (index + 1 >= moves.length) return 0;
    const prev = moves[index];
    const next = moves[index + 1];
    const dx = (Number.isFinite(next.x) ? next.x : 0) - (Number.isFinite(prev.x) ? prev.x : 0);
    const dy = (Number.isFinite(next.y) ? next.y : 0) - (Number.isFinite(prev.y) ? prev.y : 0);
    const dz = (Number.isFinite(next.z) ? next.z : 0) - (Number.isFinite(prev.z) ? prev.z : 0);
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const feedrate = next.type === "cut" ? (feedrateMmMin > 0 ? feedrateMmMin : 800) : DEFAULT_RAPID_FEEDRATE_MM_MIN;
    const tijdMs = (d * 60000) / feedrate;
    return Math.max(1, tijdMs / speedMultiplier);
  }

  /**
   * Bouwt cumulatieve tijden voor het volledige pad (speedMultiplier=1 voor natuurlijke duur).
   * @param {ToolpathMove[]} moves
   * @param {number} feedrateMmMin
   * @returns {{ cumulative: number[], total: number }}
   */
  function buildCumulativeTimesMs(moves, feedrateMmMin) {
    const cumulative = [0];
    for (let i = 0; i < moves.length - 1; i++) {
      const seg = getSegmentDurationMs(moves, i, feedrateMmMin, 1);
      cumulative.push(cumulative[cumulative.length - 1] + seg);
    }
    return { cumulative, total: cumulative[cumulative.length - 1] ?? 0 };
  }

  /**
   * Berekent geïnterpoleerde positie op het pad bij gegeven verstreken tijd.
   * @param {number[]} cumulativeTimesMs
   * @param {ToolpathMove[]} moves
   * @param {number} elapsedMs
   * @returns {{ x: number, y: number, z: number, segmentIndex: number, t: number } | null}
   */
  function getPositionAtTimeMs(cumulativeTimesMs, moves, elapsedMs) {
    if (moves.length === 0) return null;
    if (moves.length === 1) return { x: moves[0].x, y: moves[0].y, z: moves[0].z, segmentIndex: 0, t: 0 };
    const totalMs = cumulativeTimesMs[cumulativeTimesMs.length - 1] ?? 0;
    if (elapsedMs <= 0) return { ...moves[0], segmentIndex: 0, t: 0 };
    if (elapsedMs >= totalMs) {
      const last = moves[moves.length - 1];
      return { x: last.x, y: last.y, z: last.z, segmentIndex: moves.length - 2, t: 1 };
    }
    let i = 0;
    while (i < cumulativeTimesMs.length - 1 && cumulativeTimesMs[i + 1] <= elapsedMs) i++;
    const t0 = cumulativeTimesMs[i];
    const t1 = cumulativeTimesMs[i + 1];
    const t = t1 > t0 ? (elapsedMs - t0) / (t1 - t0) : 1;
    const prev = moves[i];
    const next = moves[i + 1];
    return {
      x: prev.x + t * ((Number.isFinite(next.x) ? next.x : 0) - (Number.isFinite(prev.x) ? prev.x : 0)),
      y: prev.y + t * ((Number.isFinite(next.y) ? next.y : 0) - (Number.isFinite(prev.y) ? prev.y : 0)),
      z: prev.z + t * ((Number.isFinite(next.z) ? next.z : 0) - (Number.isFinite(prev.z) ? prev.z : 0)),
      segmentIndex: i,
      t,
    };
  }

  function getDisplayedColumn() {
    if (isPlaying && lastToolpath.moves.length > 0 && playbackCumulativeTimesMs.length > 0) {
      const elapsedMs = (Date.now() - playbackStartTime) * playbackSpeedMultiplier;
      const pos = getPositionAtTimeMs(playbackCumulativeTimesMs, lastToolpath.moves, elapsedMs);
      if (pos) {
        const engravingToolD = getEngravingToolDiameterMm(
          shapeSelect.value,
          /** @type {HTMLSelectElement | null} */ (document.getElementById("contour-type"))?.value,
          letterModeSelect?.value || "outline"
        );
        const diameter = engravingToolD != null ? engravingToolD : (toolDiameterInput ? toNumber(toolDiameterInput.value) || 6 : 6);
        return { x: pos.x, y: pos.y, z: pos.z, diameter };
      }
    }
    return cursorColumnForPreview;
  }

  function getPlaybackLineIndex() {
    if (!isPlaying || lastToolpath.moves.length === 0 || playbackCumulativeTimesMs.length === 0) return 0;
    const elapsedMs = (Date.now() - playbackStartTime) * playbackSpeedMultiplier;
    const pos = getPositionAtTimeMs(playbackCumulativeTimesMs, lastToolpath.moves, elapsedMs);
    if (!pos) return 0;
    const lineIndex = pos.t > 0.5 ? pos.segmentIndex + 1 : pos.segmentIndex;
    return GCODE_HEADER_LINES + Math.min(lineIndex, lastToolpath.moves.length - 1);
  }

  /**
   * @param {number} [forceLineIndex] - indien gegeven, gebruik deze regel in plaats van playback-positie (bijv. bij reset)
   * @param {boolean} [stealFocus] - indien true, focus op gcode-veld (standaard false tijdens playback; voorkomt dat scrollen/klikken onderbroken wordt)
   */
  function syncGcodeCursorToPlayback(forceLineIndex, stealFocus = false) {
    if (!gcodeOutput || !gcodeOutput.value) return;
    const lines = gcodeOutput.value.split("\n");
    const lineIndex = forceLineIndex ?? getPlaybackLineIndex();
    if (lineIndex < 0 || lineIndex >= lines.length) return;
    let offset = 0;
    for (let j = 0; j < lineIndex && j < lines.length; j++) offset += lines[j].length + 1;
    gcodeOutput.selectionStart = gcodeOutput.selectionEnd = offset;
    if (stealFocus) gcodeOutput.focus();
    updateGcodeLineHighlight();
  }

  function getCurrentLineIndex() {
    if (!gcodeOutput) return 0;
    const text = gcodeOutput.value;
    if (isPlaying && lastToolpath.moves.length > 0) {
      return Math.min(getPlaybackLineIndex(), text.split("\n").length - 1);
    }
    const pos = gcodeOutput.selectionStart;
    return Math.max(0, text.substring(0, pos).split("\n").length - 1);
  }

  function getGcodePaddingTop() {
    if (!gcodeOutput) return 8;
    const pt = getComputedStyle(gcodeOutput).paddingTop;
    const px = parseFloat(pt);
    return Number.isFinite(px) ? px : 8;
  }

  function getGcodePaddingBottom() {
    if (!gcodeOutput) return 8;
    const pb = getComputedStyle(gcodeOutput).paddingBottom;
    const px = parseFloat(pb);
    return Number.isFinite(px) ? px : 8;
  }

  /**
   * Berekent de effectieve regelhoogte uit de echte scrollHeight van de textarea,
   * zodat er geen cumulatieve afrondingsfout ontstaat (geen scheeflopen bij veel regels).
   */
  function getGcodeEffectiveLineHeight(lineCount) {
    if (!gcodeOutput || lineCount <= 0) return 18;
    const paddingTop = getGcodePaddingTop();
    const paddingBottom = getGcodePaddingBottom();
    const contentHeight = gcodeOutput.scrollHeight - paddingTop - paddingBottom;
    const lineHeight = contentHeight / lineCount;
    return lineHeight > 0 ? lineHeight : 18;
  }

  function updateGcodeLineHighlight() {
    if (!gcodeOutput || !gcodeLineHighlightInner || !gcodeLineHighlightBar) return;
    const text = gcodeOutput.value;
    const lines = text.split("\n");
    const lineCount = lines.length;
    const paddingTop = getGcodePaddingTop();
    const lineHeight = getGcodeEffectiveLineHeight(lineCount);
    const lineIndex = getCurrentLineIndex();

    gcodeLineHighlightInner.style.height = `${gcodeOutput.scrollHeight}px`;

    if (lineCount === 0) {
      gcodeLineHighlightBar.style.display = "none";
      syncGcodeOverlayScroll();
      return;
    }
    gcodeLineHighlightBar.style.display = "block";
    const clampedIndex = Math.max(0, Math.min(lineIndex, lineCount - 1));
    gcodeLineHighlightBar.style.top = `${paddingTop + clampedIndex * lineHeight}px`;
    gcodeLineHighlightBar.style.height = `${lineHeight}px`;

    // Alleen mee scrollen als gcode-veld focus heeft (anders niet storen bij scrollen/klikken elders)
    if (document.activeElement === gcodeOutput) {
      const targetScrollTop = Math.max(
        0,
        paddingTop + clampedIndex * lineHeight - gcodeOutput.clientHeight / 2 + lineHeight / 2
      );
      gcodeOutput.scrollTop = Math.round(targetScrollTop);
    }
    syncGcodeOverlayScroll();
  }

  function syncGcodeOverlayScroll() {
    if (gcodeLineHighlightInner && gcodeOutput) {
      gcodeLineHighlightInner.style.transform = `translateY(-${gcodeOutput.scrollTop}px)`;
    }
  }

  function getFeedrateMmMin() {
    const feedrateInput = document.getElementById("feedrate");
    const feedrateDisplay =
      feedrateInput && feedrateInput instanceof HTMLInputElement
        ? toNumber(feedrateInput.value) || 800
        : 800;
    return getDisplayUnit() === "inch" ? toMm(feedrateDisplay, "inch") : feedrateDisplay;
  }

  function playbackTick() {
    if (!isPlaying || !lastToolpath.moves.length) return;
    const elapsedMs = (Date.now() - playbackStartTime) * playbackSpeedMultiplier;
    if (elapsedMs >= playbackTotalDurationMs) {
      playbackElapsedMs = playbackTotalDurationMs;
      stopPlayback();
      updatePlaybackButtonsState();
      return;
    }
    syncGcodeCursorToPlayback();
    if (previewCanvas) renderPreview(lastToolpath, previewCanvas, currentPreviewView, getDisplayedColumn());
  }

  function stopPlayback() {
    isPlaying = false;
    if (playbackIntervalId !== null) {
      clearInterval(playbackIntervalId);
      playbackIntervalId = null;
    }
    if (previewCanvas) renderPreview(lastToolpath, previewCanvas, currentPreviewView, getDisplayedColumn());
  }

  const playPauseBtn = /** @type {HTMLButtonElement} */ (document.getElementById("preview-play-pause-btn"));
  const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById("preview-reset-btn"));
  const speedSlider = /** @type {HTMLInputElement} */ (document.getElementById("preview-speed"));
  const speedValueEl = document.getElementById("preview-speed-value");

  // Snelheidsslider: 0.2, 0.5, 1, 1.5, 2, 3, 5, 7, 10, 15
  const ALLOWED_MULTIPLIERS = [0.2, 0.5, 1, 1.5, 2, 3, 5, 7, 10, 15];
  const MULTIPLIER_DEFAULT = 1;

  function speedSliderToMultiplier(norm) {
    const n = Number.isFinite(norm) ? norm : 0;
    const index = Math.round(n * (ALLOWED_MULTIPLIERS.length - 1));
    return ALLOWED_MULTIPLIERS[Math.max(0, Math.min(index, ALLOWED_MULTIPLIERS.length - 1))];
  }

  function speedMultiplierToSlider(value) {
    let bestIndex = 0;
    let bestDist = Math.abs(ALLOWED_MULTIPLIERS[0] - value);
    for (let i = 1; i < ALLOWED_MULTIPLIERS.length; i++) {
      const d = Math.abs(ALLOWED_MULTIPLIERS[i] - value);
      if (d < bestDist) {
        bestDist = d;
        bestIndex = i;
      }
    }
    return bestIndex / (ALLOWED_MULTIPLIERS.length - 1);
  }

  function formatMultiplierForDisplay(value) {
    return `${value}×`;
  }

  if (speedSlider) {
    speedSlider.min = "0";
    speedSlider.max = "1";
    speedSlider.step = String(1 / (ALLOWED_MULTIPLIERS.length - 1));
    speedSlider.value = String(speedMultiplierToSlider(MULTIPLIER_DEFAULT));
    if (speedValueEl) speedValueEl.textContent = formatMultiplierForDisplay(MULTIPLIER_DEFAULT);
    playbackSpeedMultiplier = MULTIPLIER_DEFAULT;
  }

  if (playPauseBtn) {
    playPauseBtn.addEventListener("click", () => {
      if (!lastToolpath.moves.length) return;
      if (isPlaying) {
        playbackElapsedMs = (Date.now() - playbackStartTime) * playbackSpeedMultiplier;
        stopPlayback();
      } else {
        const feedrateMmMin = getFeedrateMmMin();
        const { cumulative, total } = buildCumulativeTimesMs(lastToolpath.moves, feedrateMmMin);
        playbackCumulativeTimesMs = cumulative;
        playbackTotalDurationMs = total;
        if (playbackTotalDurationMs <= 0) return;
        playbackStartTime = Date.now() - playbackElapsedMs / playbackSpeedMultiplier;
        isPlaying = true;
        playbackIntervalId = setInterval(playbackTick, PREVIEW_TICK_MS);
        syncGcodeCursorToPlayback();
        if (previewCanvas) renderPreview(lastToolpath, previewCanvas, currentPreviewView, getDisplayedColumn());
      }
      updatePlaybackButtonsState();
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (!lastToolpath.moves.length) return;
      playbackElapsedMs = 0;
      stopPlayback();
      syncGcodeCursorToPlayback(GCODE_HEADER_LINES);
      if (previewCanvas) renderPreview(lastToolpath, previewCanvas, currentPreviewView, getDisplayedColumn());
      updatePlaybackButtonsState();
    });
  }
  if (speedSlider) {
    speedSlider.addEventListener("input", () => {
      const previousSpeedMultiplier = playbackSpeedMultiplier;
      const norm = Number(speedSlider.value);
      const nextSpeedMultiplier = speedSliderToMultiplier(norm);
      playbackSpeedMultiplier = nextSpeedMultiplier;
      speedSlider.value = String(speedMultiplierToSlider(playbackSpeedMultiplier));
      if (speedValueEl) speedValueEl.textContent = formatMultiplierForDisplay(playbackSpeedMultiplier);
      if (isPlaying && playbackIntervalId !== null) {
        // Keep current playback position stable and only change speed from "now" onward.
        playbackElapsedMs = (Date.now() - playbackStartTime) * previousSpeedMultiplier;
        playbackStartTime = Date.now() - playbackElapsedMs / playbackSpeedMultiplier;
      }
      saveLastSettings();
    });
  }

  function updatePreviewWithCursorPoint() {
    if (!gcodeOutput || !previewCanvas) return;
    const text = gcodeOutput.value;
    const pos = gcodeOutput.selectionStart;
    const lineIndex = text.substring(0, pos).split("\n").length - 1;
    const lines = text.split("\n");
    const line = lines[lineIndex] ?? "";
    let point = parseGcodeLineForPoint(line);
    if (point) {
      const gcodeUnit = getGcodeUnitFromText(text);
      if (gcodeUnit === "inch") {
        point = {
          x: toMm(point.x, "inch"),
          y: toMm(point.y, "inch"),
          z: toMm(point.z, "inch"),
        };
      }
      const engravingToolD = getEngravingToolDiameterMm(
        shapeSelect.value,
        /** @type {HTMLSelectElement | null} */ (document.getElementById("contour-type"))?.value,
        letterModeSelect?.value || "outline"
      );
      const diameter = engravingToolD != null ? engravingToolD : (toolDiameterInput ? toNumber(toolDiameterInput.value) || 6 : 6);
      cursorColumnForPreview = {
        ...point,
        diameter,
      };
    } else {
      cursorColumnForPreview = null;
    }
    renderPreview(lastToolpath, previewCanvas, currentPreviewView, getDisplayedColumn());
    updateGcodeLineHighlight();
  }

  function clearPreviewCursorPoint() {
    cursorColumnForPreview = null;
    if (previewCanvas) renderPreview(lastToolpath, previewCanvas, currentPreviewView, getDisplayedColumn());
  }

  function updatePlaybackButtonsState() {
    const hasMoves = lastToolpath.moves.length > 0;
    if (playPauseBtn) {
      playPauseBtn.disabled = !hasMoves;
      playPauseBtn.textContent = isPlaying ? t("preview.pause") : t("preview.play");
    }
    if (resetBtn) resetBtn.disabled = !hasMoves;
  }
  document.addEventListener("languagechange", updatePlaybackButtonsState);
  document.addEventListener("languagechange", renderChainStepsBar);

  if (gcodeOutput) {
    gcodeOutput.addEventListener("focus", updatePreviewWithCursorPoint);
    gcodeOutput.addEventListener("blur", clearPreviewCursorPoint);
    gcodeOutput.addEventListener("keyup", updatePreviewWithCursorPoint);
    gcodeOutput.addEventListener("click", updatePreviewWithCursorPoint);
    gcodeOutput.addEventListener("input", updatePreviewWithCursorPoint);
    gcodeOutput.addEventListener("scroll", syncGcodeOverlayScroll);
  }

  CHAIN_BASELINE_FIELD_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", onChainBaselineFieldsChanged);
    el.addEventListener("change", onChainBaselineFieldsChanged);
  });

  form.addEventListener("input", updateRegenerateIndicator);
  form.addEventListener("change", updateRegenerateIndicator);
  form.querySelectorAll("input, select, textarea").forEach((el) => {
    el.addEventListener("input", updateRegenerateIndicator);
    el.addEventListener("change", updateRegenerateIndicator);
  });
  ["spindle-speed-enabled", "spindle-speed", "mist-coolant-enabled", "flood-coolant-enabled", "mirror-x-enabled", "mirror-y-enabled", "use-arcs-enabled"]
    .forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", updateRegenerateIndicator);
      el.addEventListener("change", updateRegenerateIndicator);
    });
  const dxfFileEl = document.getElementById("dxf-file");
  if (dxfFileEl) dxfFileEl.addEventListener("change", updateRegenerateIndicator);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (errorMessage) errorMessage.textContent = "";

    try {
      if (isChainModeEnabled()) {
        await saveActiveChainStepFromForm();
        if (chainJobSteps.length === 0) {
          if (errorMessage) errorMessage.textContent = t("chain.needSteps");
          return;
        }
        const baseline = extractBaselineFieldsFromFormState(chainJobSteps[0].formState);
        /** @type {{ toolpath: Toolpath, params: * }[]} */
        const stepResults = [];
        for (let i = 0; i < chainJobSteps.length; i++) {
          const raw = await prepareRawFromChainStep(chainJobSteps[i], i === 0 ? null : baseline);
          const validation = validateInputs(raw);
          if (!validation.ok) {
            if (errorMessage) errorMessage.textContent = t("chain.stepError", { n: i + 1 }) + validation.errors.join(" ");
            if (chainActiveStepId) loadChainStepToForm(chainActiveStepId);
            return;
          }
          if (validation.params.shape === ShapeType.LETTERS) {
            try {
              validation.params.letterFont = await loadLetterFont();
            } catch (fontErr) {
              const msg = fontErr instanceof Error ? fontErr.message : String(fontErr);
              if (errorMessage) errorMessage.textContent = t("chain.stepError", { n: i + 1 }) + msg;
              if (chainActiveStepId) loadChainStepToForm(chainActiveStepId);
              return;
            }
          }
          const toolpath = generateToolpath(validation.params);
          stepResults.push({ toolpath, params: validation.params });
        }
        if (chainActiveStepId) loadChainStepToForm(chainActiveStepId);
        const mergedToolpath = mergeChainToolpaths(stepResults);
        const gcode = jobToolpathsToGcode(stepResults);
        lastToolpath = mergedToolpath;

        stopPlayback();
        playbackElapsedMs = 0;
        updatePlaybackButtonsState();

        if (gcodeOutput) {
          gcodeOutput.value = gcode;
          gcodeOutput.selectionStart = 0;
          gcodeOutput.selectionEnd = 0;
          gcodeOutput.scrollTop = 0;
          gcodeOutput.scrollIntoView({ behavior: "smooth", block: "nearest" });
          updateGcodeLineHighlight();
        }
        const gcodeEstimateEl = document.getElementById("gcode-estimate");
        if (gcodeEstimateEl) {
          let totalMinutes = 0;
          stepResults.forEach((sr) => {
            totalMinutes += estimateMillingTime(sr.toolpath, sr.params.cutParams).totalMinutes;
          });
          gcodeEstimateEl.textContent = t("preview.estimatedTime", {
            time: formatEstimatedTime(totalMinutes),
          });
        }
        if (previewCanvas) renderPreview(mergedToolpath, previewCanvas, currentPreviewView, getDisplayedColumn());

        saveLastSettings();
        lastGenerationSnapshot = getParamsSnapshotReadOnly();
        updateRegenerateIndicator();

        if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.onclick = () => {
            const ts = getGcodeTimestamp();
            promptAndDownloadGcode(`gcode_job_${chainJobSteps.length}steps_${ts}.nc`, gcode);
          };
        }
        if (copyBtn) {
          copyBtn.disabled = false;
          copyBtn.onclick = () => copyGcodeToClipboard(gcode);
        }
        return;
      }

      const raw = readInputsFromForm();
      if (raw.shape === ShapeType.DXF) {
        const dxfFileInput = document.getElementById("dxf-file");
        const file = dxfFileInput && dxfFileInput.files && dxfFileInput.files[0];
        if (!file) {
          if (errorMessage) errorMessage.textContent = t("error.dxfNoFile");
          return;
        }
        try {
          const text = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result ?? ""));
            r.onerror = () => reject(new Error("File read failed"));
            r.readAsText(file);
          });
          const dxfOrientation = Number(raw.shapeParams.dxfOrientation) || 0;
          const orientedContours = getOrientedDxfContoursFromText(text, dxfOrientation);
          applyDxfOriginToRaw(raw, orientedContours);
        } catch (dxfErr) {
          const msg = dxfErr instanceof Error ? dxfErr.message : String(dxfErr);
          if (errorMessage) errorMessage.textContent = msg;
          return;
        }
      }
      const validation = validateInputs(raw);
      if (!validation.ok) {
        if (errorMessage) errorMessage.textContent = validation.errors.join(" ");
        if (gcodeOutput) gcodeOutput.value = "";
        const gcodeEstimateEl = document.getElementById("gcode-estimate");
        if (gcodeEstimateEl) gcodeEstimateEl.textContent = "";
        if (downloadBtn) downloadBtn.disabled = true;
        if (copyBtn) copyBtn.disabled = true;
        lastToolpath = { moves: [] };
        stopPlayback();
        playbackElapsedMs = 0;
        updatePlaybackButtonsState();
        if (previewCanvas) renderPreview(lastToolpath, previewCanvas, currentPreviewView);
        updateGcodeLineHighlight();
        return;
      }

      if (validation.params.shape === ShapeType.LETTERS) {
        try {
          validation.params.letterFont = await loadLetterFont();
        } catch (fontErr) {
          const msg = fontErr instanceof Error ? fontErr.message : String(fontErr);
          if (errorMessage) errorMessage.textContent = msg;
          return;
        }
      }

      const toolpath = generateToolpath(validation.params);
      lastToolpath = toolpath;
      const gcode = toolpathToGcode(toolpath, validation.params);

      stopPlayback();
      playbackElapsedMs = 0;
      updatePlaybackButtonsState();

      if (gcodeOutput) {
        gcodeOutput.value = gcode;
        gcodeOutput.selectionStart = 0;
        gcodeOutput.selectionEnd = 0;
        gcodeOutput.scrollTop = 0;
        gcodeOutput.scrollIntoView({ behavior: "smooth", block: "nearest" });
        updateGcodeLineHighlight();
      }
      const gcodeEstimateEl = document.getElementById("gcode-estimate");
      if (gcodeEstimateEl) {
        const est = estimateMillingTime(toolpath, validation.params.cutParams);
        gcodeEstimateEl.textContent = t("preview.estimatedTime", {
          time: formatEstimatedTime(est.totalMinutes),
        });
      }
      if (previewCanvas) renderPreview(toolpath, previewCanvas, currentPreviewView, getDisplayedColumn());

      saveLastSettings();
      lastGenerationSnapshot = getParamsSnapshotReadOnly();
      updateRegenerateIndicator();

      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.onclick = () => {
          promptAndDownloadGcode(getSuggestedGcodeFilename(raw), gcode);
        };
      }
      if (copyBtn) {
        copyBtn.disabled = false;
        copyBtn.onclick = () => {
          copyGcodeToClipboard(gcode);
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isCompleteMessage = e instanceof Error && e.dxfProcessingError;
      if (errorMessage) errorMessage.textContent = isCompleteMessage ? msg : t("error.generateFailed") + msg;
    }
  });

  // init defaults
  updateUIForOperationTypeAndShape();
  restoreLastSettings();
  initChainModeOnStartup(true);
  updateRegenerateIndicator();

  // lege preview
  lastToolpath = { moves: [] };
  updatePlaybackButtonsState();
  renderPreview(lastToolpath, previewCanvas, currentPreviewView);
}

document.addEventListener("DOMContentLoaded", setupUI);

function bootChainModeImmediately() {
  initChainModeOnStartup(false);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootChainModeImmediately);
} else {
  bootChainModeImmediately();
}

