// svg-import.js - SVG contour parser for Gcode Toolbox (loaded before main.js)

/** @param {string|number|null|undefined} value @param {number} fallbackUnits */
function parseSvgLengthToMm(value, fallbackUnits) {
  if (value == null || value === "") return fallbackUnits;
  const str = String(value).trim();
  const m = str.match(/^(-?[\d.]+)\s*(mm|cm|in|pt|pc|px|%)?$/i);
  if (!m) {
    const n = parseFloat(str);
    return Number.isFinite(n) ? n : fallbackUnits;
  }
  const num = parseFloat(m[1]);
  const unit = (m[2] || "").toLowerCase();
  switch (unit) {
    case "mm": return num;
    case "cm": return num * 10;
    case "in": return num * 25.4;
    case "pt": return num * 25.4 / 72;
    case "pc": return num * 25.4 / 6;
    case "px": return num * 25.4 / 96;
    case "%": return fallbackUnits * (num / 100);
    default: return num;
  }
}

/** @typedef {{ a: number, b: number, c: number, d: number, e: number, f: number }} SvgMatrix */

/** @param {SvgMatrix} m1 @param {SvgMatrix} m2 @returns {SvgMatrix} */
function multiplySvgMatrix(m1, m2) {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

/** @param {SvgMatrix} m @param {number} x @param {number} y */
function applySvgMatrix(m, x, y) {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** @param {number} deg */
function svgDegToRad(deg) {
  return (deg * Math.PI) / 180;
}

/** @param {string|null|undefined} transformAttr @returns {SvgMatrix} */
function parseSvgTransformToMatrix(transformAttr) {
  /** @type {SvgMatrix} */
  let result = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  if (!transformAttr) return result;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(transformAttr)) !== null) {
    const type = match[1].toLowerCase();
    const args = match[2].trim().split(/[\s,]+/).filter(Boolean).map(parseFloat);
    /** @type {SvgMatrix} */
    let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    if (type === "matrix" && args.length >= 6) {
      m = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
    } else if (type === "translate") {
      m.e = args[0] || 0;
      m.f = args[1] || 0;
    } else if (type === "scale") {
      m.a = args[0] ?? 1;
      m.d = args.length > 1 ? args[1] : (args[0] ?? 1);
    } else if (type === "rotate") {
      const ang = svgDegToRad(args[0] || 0);
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const cx = args.length >= 3 ? args[1] : 0;
      const cy = args.length >= 3 ? args[2] : 0;
      const t1 = { a: 1, b: 0, c: 0, d: 1, e: cx, f: cy };
      const r = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
      const t2 = { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy };
      m = multiplySvgMatrix(t1, multiplySvgMatrix(r, t2));
    } else if (type === "skewx") {
      m.c = Math.tan(svgDegToRad(args[0] || 0));
    } else if (type === "skewy") {
      m.b = Math.tan(svgDegToRad(args[0] || 0));
    }
    result = multiplySvgMatrix(result, m);
  }
  return result;
}

/**
 * @param {number} radiusMm
 * @returns {number}
 */
function svgSegmentsForRadius(radiusMm) {
  const r = Math.abs(radiusMm);
  if (r <= 0) return 8;
  return Math.max(8, Math.min(120, Math.ceil(r * 2)));
}

/**
 * @param {{ x: number, y: number, z: number }[]} contour
 * @returns {boolean}
 */
function svgIsClosedContour(contour) {
  return contour.length >= 3 &&
    Math.hypot(contour[contour.length - 1].x - contour[0].x, contour[contour.length - 1].y - contour[0].y) < 1e-6;
}

/**
 * @param {number} vbX @param {number} vbY @param {number} scale
 * @param {SvgMatrix} matrix
 * @param {number} x @param {number} y
 * @returns {{ x: number, y: number, z: number }}
 */
function svgUserPointToContour(vbX, vbY, scale, matrix, x, y) {
  const p = applySvgMatrix(matrix, x, y);
  return { x: (p.x - vbX) * scale, y: -(p.y - vbY) * scale, z: 0 };
}

/**
 * @param {number} vbX @param {number} vbY @param {number} scale @param {SvgMatrix} matrix
 * @param {string} d
 * @returns {{ x: number, y: number, z: number }[][]}
 */
function parseSvgPathDataToContours(vbX, vbY, scale, matrix, d) {
  /** @type {{ x: number, y: number, z: number }[][]} */
  const contours = [];
  /** @type {{ x: number, y: number, z: number }[]} */
  let current = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;

  const pushCurrent = () => {
    if (current.length >= 2) contours.push(current);
    current = [];
  };

  const addPoint = (x, y) => {
    const pt = svgUserPointToContour(vbX, vbY, scale, matrix, x, y);
    if (current.length === 0 || Math.hypot(pt.x - current[current.length - 1].x, pt.y - current[current.length - 1].y) > 1e-9) {
      current.push(pt);
    }
  };

  const sampleCubic = (x0, y0, x1, y1, x2, y2, x3, y3) => {
    const chord = Math.hypot(x3 - x0, y3 - y0);
    const n = Math.max(4, Math.min(64, Math.ceil(chord / 0.5)));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      addPoint(
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
      );
    }
  };

  const sampleQuadratic = (x0, y0, x1, y1, x2, y2) => {
    const chord = Math.hypot(x2 - x0, y2 - y0);
    const n = Math.max(4, Math.min(48, Math.ceil(chord / 0.5)));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      addPoint(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
    }
  };

  const sampleArc = (x0, y0, rx, ry, xAxisRotDeg, largeArc, sweep, x1, y1) => {
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (rx < 1e-9 && ry < 1e-9) {
      addPoint(x1, y1);
      return;
    }
    if (rx < 1e-9) rx = ry;
    if (ry < 1e-9) ry = rx;
    const phi = svgDegToRad(xAxisRotDeg);
    const dx2 = (x0 - x1) / 2;
    const dy2 = (y0 - y1) / 2;
    const x1p = Math.cos(phi) * dx2 + Math.sin(phi) * dy2;
    const y1p = -Math.sin(phi) * dx2 + Math.cos(phi) * dy2;
    let rxSq = rx * rx;
    let rySq = ry * ry;
    const x1pSq = x1p * x1p;
    const y1pSq = y1p * y1p;
    let lambda = x1pSq / rxSq + y1pSq / rySq;
    if (lambda > 1) {
      const s = Math.sqrt(lambda);
      rx *= s;
      ry *= s;
      rxSq = rx * rx;
      rySq = ry * ry;
    }
    const sign = largeArc === sweep ? -1 : 1;
    const sq = Math.max(0, (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq));
    const coef = sign * Math.sqrt(sq);
    const cxp = coef * (rx * y1p / ry);
    const cyp = coef * (-ry * x1p / rx);
    const cxArc = Math.cos(phi) * cxp - Math.sin(phi) * cyp + (x0 + x1) / 2;
    const cyArc = Math.sin(phi) * cxp + Math.cos(phi) * cyp + (y0 + y1) / 2;
    const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
    if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
    const avgR = (rx + ry) / 2;
    const n = Math.max(4, Math.min(120, Math.ceil((Math.abs(dTheta) / (2 * Math.PI)) * svgSegmentsForRadius(avgR))));
    for (let i = 1; i <= n; i++) {
      const t = theta1 + (i / n) * dTheta;
      const lx = rx * Math.cos(t);
      const ly = ry * Math.sin(t);
      addPoint(Math.cos(phi) * lx - Math.sin(phi) * ly + cxArc, Math.sin(phi) * lx + Math.cos(phi) * ly + cyArc);
    }
  };

  const tokens = String(d || "").match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!tokens || tokens.length === 0) return contours;

  let i = 0;
  let cmd = "M";
  while (i < tokens.length) {
    const tok = tokens[i];
    if (/^[a-zA-Z]$/.test(tok)) {
      cmd = tok;
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();

    if (c === "M") {
      pushCurrent();
      cx = rel ? cx + parseFloat(tokens[i++]) : parseFloat(tokens[i++]);
      cy = rel ? cy + parseFloat(tokens[i++]) : parseFloat(tokens[i++]);
      sx = cx;
      sy = cy;
      addPoint(cx, cy);
      cmd = rel ? "l" : "L";
      continue;
    }
    if (c === "L") {
      cx = rel ? cx + parseFloat(tokens[i++]) : parseFloat(tokens[i++]);
      cy = rel ? cy + parseFloat(tokens[i++]) : parseFloat(tokens[i++]);
      addPoint(cx, cy);
      continue;
    }
    if (c === "H") {
      cx = rel ? cx + parseFloat(tokens[i++]) : parseFloat(tokens[i++]);
      addPoint(cx, cy);
      continue;
    }
    if (c === "V") {
      cy = rel ? cy + parseFloat(tokens[i++]) : parseFloat(tokens[i++]);
      addPoint(cx, cy);
      continue;
    }
    if (c === "C") {
      const x1 = parseFloat(tokens[i++]);
      const y1 = parseFloat(tokens[i++]);
      const x2 = parseFloat(tokens[i++]);
      const y2 = parseFloat(tokens[i++]);
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      const ax1 = rel ? cx + x1 : x1;
      const ay1 = rel ? cy + y1 : y1;
      const ax2 = rel ? cx + x2 : x2;
      const ay2 = rel ? cy + y2 : y2;
      const ax = rel ? cx + x : x;
      const ay = rel ? cy + y : y;
      sampleCubic(cx, cy, ax1, ay1, ax2, ay2, ax, ay);
      cx = ax;
      cy = ay;
      continue;
    }
    if (c === "Q") {
      const x1 = parseFloat(tokens[i++]);
      const y1 = parseFloat(tokens[i++]);
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      const ax1 = rel ? cx + x1 : x1;
      const ay1 = rel ? cy + y1 : y1;
      const ax = rel ? cx + x : x;
      const ay = rel ? cy + y : y;
      sampleQuadratic(cx, cy, ax1, ay1, ax, ay);
      cx = ax;
      cy = ay;
      continue;
    }
    if (c === "A") {
      const rx = parseFloat(tokens[i++]);
      const ry = parseFloat(tokens[i++]);
      const rot = parseFloat(tokens[i++]);
      const largeArc = parseFloat(tokens[i++]) !== 0;
      const sweep = parseFloat(tokens[i++]) !== 0;
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      const ax = rel ? cx + x : x;
      const ay = rel ? cy + y : y;
      sampleArc(cx, cy, rx, ry, rot, largeArc, sweep, ax, ay);
      cx = ax;
      cy = ay;
      continue;
    }
    if (c === "Z") {
      if (current.length >= 2) {
        addPoint(sx, sy);
        contours.push(current);
        current = [];
      }
      cx = sx;
      cy = sy;
      continue;
    }
    i++;
  }
  pushCurrent();
  return contours.map((contour) => {
    if (contour.length >= 3 && !svgIsClosedContour(contour)) {
      return [...contour, { ...contour[0], z: 0 }];
    }
    return contour;
  });
}

/**
 * Parse SVG-tekst en extraheer gesloten contouren.
 * @param {string} svgString
 * @param {(key: string) => string} t - translation function
 * @returns {{ x: number, y: number, z: number }[][]}
 */
function parseSvgToContours(svgString, t) {
  if (typeof DOMParser === "undefined") {
    throw new Error(t("error.svgParserNotLoaded"));
  }
  const parser = new DOMParser();
  let doc;
  try {
    doc = parser.parseFromString(svgString, "image/svg+xml");
  } catch (e) {
    throw new Error(t("error.svgParseFailed") + (e && e.message ? e.message : String(e)));
  }
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(t("error.svgParseFailed") + (parseError.textContent || "").trim());
  }
  const svg = doc.documentElement;
  if (!svg || (svg.localName || svg.tagName || "").toLowerCase() !== "svg") {
    throw new Error(t("error.svgParseFailed") + "No SVG root element");
  }

  let vbX = 0;
  let vbY = 0;
  let vbW = 100;
  let vbH = 100;
  const vbAttr = svg.getAttribute("viewBox");
  if (vbAttr) {
    const parts = vbAttr.trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts.every(Number.isFinite)) {
      [vbX, vbY, vbW, vbH] = parts;
    }
  }
  const widthMm = parseSvgLengthToMm(svg.getAttribute("width"), vbW);
  const heightMm = parseSvgLengthToMm(svg.getAttribute("height"), vbH);
  const scale = vbW > 1e-9 && vbH > 1e-9 ? Math.min(widthMm / vbW, heightMm / vbH) : 1;

  /** @type {{ x: number, y: number, z: number }[][]} */
  const contours = [];

  /**
   * @param {Element} el
   * @param {SvgMatrix} parentMatrix
   */
  function walkElement(el, parentMatrix) {
    const tag = (el.localName || el.tagName || "").toLowerCase();
    if (tag === "defs" || tag === "metadata" || tag === "style" || tag === "title" || tag === "desc") return;

    const localMatrix = parseSvgTransformToMatrix(el.getAttribute("transform"));
    const matrix = multiplySvgMatrix(parentMatrix, localMatrix);

    if (tag === "g" || tag === "svg") {
      for (const child of el.children) walkElement(child, matrix);
      return;
    }

    const addContourFromPoints = (points) => {
      if (!points || points.length < 2) return;
      /** @type {{ x: number, y: number, z: number }[]} */
      const contour = [];
      for (const pt of points) {
        const c = svgUserPointToContour(vbX, vbY, scale, matrix, pt.x, pt.y);
        if (contour.length === 0 || Math.hypot(c.x - contour[contour.length - 1].x, c.y - contour[contour.length - 1].y) > 1e-9) {
          contour.push(c);
        }
      }
      if (contour.length >= 3 && !svgIsClosedContour(contour)) {
        contour.push({ ...contour[0], z: 0 });
      }
      if (contour.length >= 3) contours.push(contour);
      else if (contour.length === 2) contours.push(contour);
    };

    if (tag === "path") {
      const d = el.getAttribute("d");
      if (d) contours.push(...parseSvgPathDataToContours(vbX, vbY, scale, matrix, d));
    } else if (tag === "line") {
      addContourFromPoints([
        { x: parseFloat(el.getAttribute("x1") || "0"), y: parseFloat(el.getAttribute("y1") || "0") },
        { x: parseFloat(el.getAttribute("x2") || "0"), y: parseFloat(el.getAttribute("y2") || "0") },
      ]);
    } else if (tag === "polyline" || tag === "polygon") {
      const raw = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(parseFloat);
      /** @type {{ x: number, y: number }[]} */
      const pts = [];
      for (let j = 0; j + 1 < raw.length; j += 2) {
        if (Number.isFinite(raw[j]) && Number.isFinite(raw[j + 1])) pts.push({ x: raw[j], y: raw[j + 1] });
      }
      if (tag === "polygon" && pts.length >= 2) pts.push({ ...pts[0] });
      addContourFromPoints(pts);
    } else if (tag === "rect") {
      const x = parseFloat(el.getAttribute("x") || "0");
      const y = parseFloat(el.getAttribute("y") || "0");
      const w = parseFloat(el.getAttribute("width") || "0");
      const h = parseFloat(el.getAttribute("height") || "0");
      if (w > 1e-9 && h > 1e-9) {
        addContourFromPoints([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }]);
      }
    } else if (tag === "circle") {
      const cx = parseFloat(el.getAttribute("cx") || "0");
      const cy = parseFloat(el.getAttribute("cy") || "0");
      const r = Math.abs(parseFloat(el.getAttribute("r") || "0"));
      if (r > 1e-9) {
        const n = svgSegmentsForRadius(r * scale);
        /** @type {{ x: number, y: number, z: number }[]} */
        const contour = [];
        for (let k = 0; k <= n; k++) {
          const ang = (k / n) * 2 * Math.PI;
          contour.push(svgUserPointToContour(vbX, vbY, scale, matrix, cx + r * Math.cos(ang), cy + r * Math.sin(ang)));
        }
        contours.push(contour);
      }
    } else if (tag === "ellipse") {
      const cx = parseFloat(el.getAttribute("cx") || "0");
      const cy = parseFloat(el.getAttribute("cy") || "0");
      const rx = Math.abs(parseFloat(el.getAttribute("rx") || "0"));
      const ry = Math.abs(parseFloat(el.getAttribute("ry") || "0"));
      if (rx > 1e-9 && ry > 1e-9) {
        const n = svgSegmentsForRadius(Math.max(rx, ry) * scale);
        /** @type {{ x: number, y: number, z: number }[]} */
        const contour = [];
        for (let k = 0; k <= n; k++) {
          const ang = (k / n) * 2 * Math.PI;
          contour.push(svgUserPointToContour(vbX, vbY, scale, matrix, cx + rx * Math.cos(ang), cy + ry * Math.sin(ang)));
        }
        contours.push(contour);
      }
    } else {
      for (const child of el.children) walkElement(child, matrix);
    }
  }

  walkElement(svg, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  return contours;
}
