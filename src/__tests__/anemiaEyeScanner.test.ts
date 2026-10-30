import {describe, expect, it} from 'vitest';
import {
  analyzeConjunctivaRoiPixels,
  buildQuickDemoScanMetrics,
  estimateHemoglobinFromRgb,
  getConjunctivaRoiBounds,
} from '../utils/anemiaEyeScanner';
import {evaluateTriage} from '../types/triage';

function makeUniformRgbaBuffer(r: number, g: number, b: number, a = 255, pixels = 64): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
  }
  return buf;
}

describe('Anemia Eye Scanner & Hemoglobin Estimator (Client-Side RGB + Triage Integration)', () => {
  it('computes centered palpebral conjunctiva ROI bounds accurately', () => {
    const roi = getConjunctivaRoiBounds(320, 200);
    expect(roi).toEqual({x: 80, y: 55, width: 160, height: 90});
  });

  it('estimates higher normal Hemoglobin (12.5–14.5 g/dL) for healthy high-Red conjunctiva pixels', () => {
    const rgba = makeUniformRgbaBuffer(216, 108, 106);
    const result = analyzeConjunctivaRoiPixels(rgba);

    expect(result.ok).toBe(true);
    expect(result.anemiaRisk).toBe(false);
    expect(result.severeAnemiaRisk).toBe(false);
    expect(result.metrics).toBeDefined();
    expect(result.metrics!.estimatedHb).toBeGreaterThanOrEqual(12.5);
    expect(result.metrics!.estimatedHb).toBeLessThanOrEqual(14.5);
    expect(result.metrics!.pallorDetected).toBe(false);
  });

  it('estimates lower Hemoglobin (7.0–9.5 g/dL) and flags Anemia Risk for pale lower-Red pixels', () => {
    const rgba = makeUniformRgbaBuffer(214, 174, 170);
    const result = analyzeConjunctivaRoiPixels(rgba);

    expect(result.ok).toBe(true);
    expect(result.anemiaRisk).toBe(true);
    expect(result.severeAnemiaRisk).toBe(false);
    expect(result.metrics).toBeDefined();
    expect(result.metrics!.estimatedHb).toBeGreaterThanOrEqual(7.0);
    expect(result.metrics!.estimatedHb).toBeLessThanOrEqual(9.5);
    expect(result.metrics!.pallorDetected).toBe(true);
  });

  it('flags severe anemia (< 7.0 g/dL) on blanched conjunctiva and rejects covered-lens dark frames', () => {
    const blanched = estimateHemoglobinFromRgb(205, 205, 205);
    expect(blanched.estimatedHb).toBeLessThan(7.0);
    expect(blanched.anemiaRisk).toBe(true);
    expect(blanched.severeAnemiaRisk).toBe(true);

    const blackFrame = analyzeConjunctivaRoiPixels(makeUniformRgbaBuffer(5, 5, 5));
    expect(blackFrame.ok).toBe(false);
    expect(blackFrame.error).toContain('too dark');
  });

  it('generates deterministic 8.8 g/dL Anemia Detected result for Quick Demo Scan', () => {
    const demo = buildQuickDemoScanMetrics('data:image/png;base64,demo');
    expect(demo.estimatedHb).toBe(8.8);
    expect(demo.pallorDetected).toBe(true);
    expect(demo.diagnosticLabel).toContain('8.8 g/dL');
  });

  it('updates patient triage badge automatically when Hemoglobin < 10.0 g/dL (Yellow/Red triggers)', () => {
    const normalVitals = {
      systolic: 118,
      diastolic: 76,
      spo2: 98,
      temperature: 98.4,
      heartRate: 74,
    };

    const normalHbTriage = evaluateTriage(normalVitals, [], {
      anemiaSuspected: false,
      estimatedHb: 13.4,
      respiratoryRiskHigh: false,
    });
    expect(normalHbTriage.severity).toBe('routine');
    expect(normalHbTriage.scoreCode).toBe('TR1');

    const moderateAnemiaTriage = evaluateTriage(normalVitals, [], {
      anemiaSuspected: true,
      estimatedHb: 8.8,
      respiratoryRiskHigh: false,
    });
    expect(moderateAnemiaTriage.severity).toBe('moderate');
    expect(moderateAnemiaTriage.scoreCode).toBe('TR2');
    expect(moderateAnemiaTriage.triggers.some((t) => t.includes('Anemia Risk Flagged'))).toBe(true);

    const severeAnemiaTriage = evaluateTriage(normalVitals, [], {
      anemiaSuspected: true,
      estimatedHb: 6.6,
      respiratoryRiskHigh: false,
    });
    expect(severeAnemiaTriage.severity).toBe('emergency');
    expect(severeAnemiaTriage.scoreCode).toBe('TR3');
    expect(severeAnemiaTriage.triggers.some((t) => t.includes('Severe Anemia Risk'))).toBe(true);
  });
});
