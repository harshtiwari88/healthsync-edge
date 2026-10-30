import {ConjunctivaPixelMetrics} from '../types/triage';

export const EYE_SCAN_CANVAS_WIDTH = 320;
export const EYE_SCAN_CANVAS_HEIGHT = 200;

/**
 * Center Region of Interest (palpebral conjunctiva / inner lower eyelid):
 * Central 50% width x 45% height of the normalized analysis canvas.
 */
export interface ConjunctivaRoiBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getConjunctivaRoiBounds(
  canvasWidth = EYE_SCAN_CANVAS_WIDTH,
  canvasHeight = EYE_SCAN_CANVAS_HEIGHT
): ConjunctivaRoiBounds {
  const width = Math.max(8, Math.round(canvasWidth * 0.5));
  const height = Math.max(8, Math.round(canvasHeight * 0.45));
  const x = Math.max(0, Math.floor((canvasWidth - width) / 2));
  const y = Math.max(0, Math.floor((canvasHeight - height) / 2));
  return {x, y, width, height};
}

export interface PixelAnalysisOutcome {
  ok: boolean;
  error?: string;
  anemiaRisk: boolean;
  severeAnemiaRisk: boolean;
  metrics?: ConjunctivaPixelMetrics;
}

/**
 * Estimates Hemoglobin (g/dL) from average palpebral conjunctiva RGB intensities.
 *
 * Calibration logic (client-side RGB ratio, no cloud required):
 * - Compares Red intensity against average Green & Blue intensity:
 *     redDominance = avgR / max(1, (avgG + avgB) / 2)
 * - Higher Red intensity relative to Green/Blue -> Higher Hb (12.5 - 14.5 g/dL, Normal)
 * - Pale / Lower Red ratio -> Lower Hb (7.0 - 9.5 g/dL, Moderate/Severe Anemia Flag)
 * - Very blanched / zero excess redness -> Severe Anemia (< 7.0 g/dL)
 */
export function estimateHemoglobinFromRgb(avgR: number, avgG: number, avgB: number): {
  estimatedHb: number;
  redGreenBlueRatio: number;
  erythemaIndex: number;
  anemiaRisk: boolean;
  severeAnemiaRisk: boolean;
  diagnosticLabel: string;
} {
  const safeR = Math.min(255, Math.max(0, avgR));
  const safeG = Math.min(255, Math.max(0, avgG));
  const safeB = Math.min(255, Math.max(0, avgB));

  const meanGB = Math.max(1, (safeG + safeB) / 2);
  const redDominance = safeR / meanGB;
  const redGreenBlueRatio = Number((safeR / Math.max(1, safeG + safeB)).toFixed(2));
  const erythemaIndex = Number((safeR - safeG).toFixed(1));

  let rawHb: number;
  if (redDominance <= 1.02) {
    // Blanched / severe pallor: 6.5 - 7.0 g/dL
    const t = Math.max(0, (redDominance - 0.88) / 0.14);
    rawHb = 6.5 + t * 0.5;
  } else if (redDominance <= 1.36) {
    // Pale lower-eyelid conjunctiva: 7.0 - 9.5 g/dL
    const t = (redDominance - 1.02) / (1.36 - 1.02);
    rawHb = 7.0 + t * 2.5;
  } else if (redDominance <= 1.65) {
    // Mild pallor to borderline normal: 9.5 - 12.5 g/dL (crosses 10.0 g/dL at ~1.41)
    const t = (redDominance - 1.36) / (1.65 - 1.36);
    rawHb = 9.5 + t * 3.0;
  } else {
    // Healthy vascularized red conjunctiva: 12.5 - 14.5 g/dL
    const t = Math.min(1, (redDominance - 1.65) / 0.5);
    rawHb = 12.5 + t * 2.0;
  }

  const estimatedHb = Number(Math.min(14.5, Math.max(6.5, rawHb)).toFixed(1));
  const anemiaRisk = estimatedHb < 10.0;
  const severeAnemiaRisk = estimatedHb < 7.0;

  let diagnosticLabel: string;
  if (severeAnemiaRisk) {
    diagnosticLabel = `Severe Pallor Detected (Est. Hb ${estimatedHb.toFixed(1)} g/dL — Urgent Anemia Risk)`;
  } else if (anemiaRisk) {
    diagnosticLabel = `Anemia Risk Detected (Est. Hb ${estimatedHb.toFixed(1)} g/dL — Pale Eyelid Color)`;
  } else {
    diagnosticLabel = `Normal Conjunctiva Redness (Est. Hb ${estimatedHb.toFixed(1)} g/dL — Normal Range)`;
  }

  return {
    estimatedHb,
    redGreenBlueRatio,
    erythemaIndex,
    anemiaRisk,
    severeAnemiaRisk,
    diagnosticLabel,
  };
}

/**
 * Analyzes RGBA pixel buffer from an already-cropped ROI ImageData array.
 */
export function analyzeConjunctivaRoiPixels(
  rgbaData: Uint8ClampedArray | number[],
  capturedDataUrl?: string
): PixelAnalysisOutcome {
  if (!rgbaData || rgbaData.length < 4) {
    return {
      ok: false,
      error: 'Unable to read eyelid pixels from image frame. Please try again.',
      anemiaRisk: false,
      severeAnemiaRisk: false,
    };
  }

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let validPixels = 0;

  for (let i = 0; i + 3 < rgbaData.length; i += 4) {
    const alpha = rgbaData[i + 3];
    if (alpha < 32) continue;
    sumR += rgbaData[i];
    sumG += rgbaData[i + 1];
    sumB += rgbaData[i + 2];
    validPixels += 1;
  }

  if (validPixels === 0) {
    return {
      ok: false,
      error: 'Selected image appears transparent or empty. Please upload a clear eyelid photo.',
      anemiaRisk: false,
      severeAnemiaRisk: false,
    };
  }

  const avgR = Math.round(sumR / validPixels);
  const avgG = Math.round(sumG / validPixels);
  const avgB = Math.round(sumB / validPixels);

  // Guard against covered camera lens / pitch-black frame
  if (avgR < 22 && avgG < 22 && avgB < 22) {
    return {
      ok: false,
      error:
        'Frame is too dark to measure eyelid redness. Face natural daylight, upload a clear photo, or use Quick Demo Scan.',
      anemiaRisk: false,
      severeAnemiaRisk: false,
    };
  }

  const calc = estimateHemoglobinFromRgb(avgR, avgG, avgB);

  return {
    ok: true,
    anemiaRisk: calc.anemiaRisk,
    severeAnemiaRisk: calc.severeAnemiaRisk,
    metrics: {
      avgR,
      avgG,
      avgB,
      redGreenBlueRatio: calc.redGreenBlueRatio,
      erythemaIndex: calc.erythemaIndex,
      estimatedHb: calc.estimatedHb,
      pallorDetected: calc.anemiaRisk,
      diagnosticLabel: calc.diagnosticLabel,
      capturedDataUrl,
    },
  };
}

/**
 * Draws a stylized clinical lower-eyelid palpebral conjunctiva sample onto an HTML5 Canvas
 * so "Use Sample Image" and "Quick Demo Scan" work 100% offline with zero external image URLs.
 */
export function drawSampleConjunctivaOnCanvas(
  canvas: HTMLCanvasElement,
  variant: 'anemic' | 'normal' = 'anemic'
): string | undefined {
  canvas.width = EYE_SCAN_CANVAS_WIDTH;
  canvas.height = EYE_SCAN_CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  if (!ctx) return undefined;

  // Surrounding warm skin tone background
  ctx.fillStyle = '#d8a488';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle sclera (upper white of the eye)
  ctx.fillStyle = '#f6f4f2';
  ctx.beginPath();
  ctx.ellipse(canvas.width / 2, canvas.height * 0.34, 118, 42, 0, 0, Math.PI * 2);
  ctx.fill();

  // Iris hint above ROI so frame looks unmistakably like an eye close-up
  ctx.fillStyle = '#4a3525';
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height * 0.25, 26, 0, Math.PI * 2);
  ctx.fill();

  // Palpebral conjunctiva (everted lower inner eyelid centered in the ROI)
  // Anemic variant: pale washed-out pink (R~214, G~174, B~170 -> ~8.6-8.9 g/dL)
  // Normal variant: healthy vascularized red-pink (R~216, G~108, B~106 -> ~13.9 g/dL)
  ctx.fillStyle = variant === 'anemic' ? '#d6aeaa' : '#d86c6a';
  ctx.beginPath();
  ctx.ellipse(canvas.width / 2, canvas.height * 0.52, 98, 50, 0, 0, Math.PI * 2);
  ctx.fill();

  // Inner mucosal highlight band inside ROI
  ctx.fillStyle = variant === 'anemic' ? '#dbb5b1' : '#de7270';
  ctx.beginPath();
  ctx.ellipse(canvas.width / 2, canvas.height * 0.53, 76, 34, 0, 0, Math.PI * 2);
  ctx.fill();

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}

/**
 * Deterministic Quick Demo Scan payload (8.8 g/dL - Anemia Detected) for 2-second live demos.
 */
export function buildQuickDemoScanMetrics(capturedDataUrl?: string): ConjunctivaPixelMetrics {
  return {
    avgR: 214,
    avgG: 172,
    avgB: 170,
    redGreenBlueRatio: 0.63,
    erythemaIndex: 42,
    estimatedHb: 8.8,
    pallorDetected: true,
    diagnosticLabel: 'Anemia Detected (Est. Hb 8.8 g/dL — Anemia Risk Flagged)',
    capturedDataUrl,
  };
}
