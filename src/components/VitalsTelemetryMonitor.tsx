import React, {useRef, useEffect, useState} from 'react';
import {Minus, Plus, Activity, Heart, Thermometer} from 'lucide-react';
import {
  ALL_SYMPTOMS,
  SymptomKey,
  VitalsSnapshot,
  evaluateVitalStatus,
} from '../types/triage';
import {LungsIcon} from './Icons';

interface VitalsTelemetryMonitorProps {
  vitals: VitalsSnapshot;
  symptoms: SymptomKey[];
  onChangeVitals: (next: VitalsSnapshot) => void;
  onToggleSymptom: (sym: SymptomKey) => void;
}

/**
 * Synthesizes a realistic normalized Lead-II P-QRS-T cardiac cycle for phase t in [0, 1)
 */
function sampleEcgWaveform(phase: number): number {
  const p = phase % 1;
  // P wave
  const pWave = 0.14 * Math.exp(-Math.pow((p - 0.16) / 0.035, 2));
  // Q dip
  const qWave = -0.16 * Math.exp(-Math.pow((p - 0.27) / 0.012, 2));
  // R spike
  const rWave = 1.0 * Math.exp(-Math.pow((p - 0.30) / 0.014, 2));
  // S dip
  const sWave = -0.26 * Math.exp(-Math.pow((p - 0.33) / 0.014, 2));
  // T wave
  const tWave = 0.28 * Math.exp(-Math.pow((p - 0.54) / 0.055, 2));
  return pWave + qWave + rWave + sWave + tWave;
}

/**
 * Synthesizes a realistic Photoplethysmogram (PPG / SpO2) pulse wave with dicrotic notch
 */
function samplePpgWaveform(phase: number, perfusionScale: number): number {
  const p = phase % 1;
  const systolicPeak = 0.88 * Math.exp(-Math.pow((p - 0.24) / 0.085, 2));
  const dicroticWave = 0.36 * Math.exp(-Math.pow((p - 0.44) / 0.11, 2));
  return (systolicPeak + dicroticWave - 0.18) * perfusionScale;
}

export const VitalsTelemetryMonitor: React.FC<VitalsTelemetryMonitorProps> = ({
  vitals,
  symptoms,
  onChangeVitals,
  onToggleSymptom,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const vitalsRef = useRef<VitalsSnapshot>(vitals);
  const [probeCoords, setProbeCoords] = useState<{ms: number; mv: string} | null>(null);

  useEffect(() => {
    vitalsRef.current = vitals;
  }, [vitals]);

  // Real-time 60fps Dual-Trace PPG + ECG HTML5 Canvas Sweep Renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const ecgBuffer = new Float32Array(width);
    const ppgBuffer = new Float32Array(width);

    let sweepX = 0;
    let phase = 0;
    let lastTs = performance.now();
    let rafId = 0;

    // Initial background fill
    ctx.fillStyle = '#060A12';
    ctx.fillRect(0, 0, width, height);

    const renderFrame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.004, (now - lastTs) / 1000));
      lastTs = now;

      const cur = vitalsRef.current;
      const beatsPerSec = Math.max(0.55, Math.min(3.5, cur.heartRate / 60));
      const perfusionScale = Math.max(0.35, Math.min(1.15, (cur.spo2 - 70) / 28));
      const pulsePressureScale = Math.max(
        0.65,
        Math.min(1.35, (cur.systolic - cur.diastolic) / 45)
      );

      // Advance sweep 2 pixels per frame (~120px/sec)
      const steps = 2;
      for (let s = 0; s < steps; s++) {
        phase = (phase + (beatsPerSec * dt) / steps) % 1;
        ecgBuffer[sweepX] = sampleEcgWaveform(phase) * pulsePressureScale;
        ppgBuffer[sweepX] = samplePpgWaveform((phase + 0.85) % 1, perfusionScale);
        sweepX = (sweepX + 1) % width;
      }

      // Redraw clean oscilloscope graticule & dual traces
      ctx.fillStyle = '#060A12';
      ctx.fillRect(0, 0, width, height);

      // Millimeter graticule grid
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.08)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < width; gx += 24) {
        ctx.beginPath();
        ctx.moveTo(gx + 0.5, 0);
        ctx.lineTo(gx + 0.5, height);
        ctx.stroke();
      }
      for (let gy = 0; gy < height; gy += 24) {
        ctx.beginPath();
        ctx.moveTo(0, gy + 0.5);
        ctx.lineTo(width, gy + 0.5);
        ctx.stroke();
      }

      // Center channel divider
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      const hrEmergency = cur.heartRate >= 130 || cur.heartRate < 45 || cur.systolic >= 160;
      const spo2Emergency = cur.spo2 < 90;

      // Trace 1 (Top Half): Lead-II ECG (#F59E0B Amber or #EF4444 Cyber Red on critical)
      ctx.strokeStyle = hrEmergency ? '#EF4444' : '#F59E0B';
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      let penDown = false;
      for (let x = 0; x < width; x++) {
        const distAhead = (x - sweepX + width) % width;
        if (distAhead < 14) {
          penDown = false;
          continue;
        }
        const y = height * 0.29 - ecgBuffer[x] * (height * 0.21);
        if (!penDown) {
          ctx.moveTo(x, y);
          penDown = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Trace 2 (Bottom Half): SpO2 PPG Sine/Plethysmograph (#06B6D4 Emerald Teal or #EF4444)
      ctx.strokeStyle = spo2Emergency ? '#EF4444' : '#06B6D4';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      penDown = false;
      for (let x = 0; x < width; x++) {
        const distAhead = (x - sweepX + width) % width;
        if (distAhead < 14) {
          penDown = false;
          continue;
        }
        const y = height * 0.78 - ppgBuffer[x] * (height * 0.22);
        if (!penDown) {
          ctx.moveTo(x, y);
          penDown = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Phosphor leading cursor head
      const headX = (sweepX - 1 + width) % width;
      const ecgHeadY = height * 0.29 - ecgBuffer[headX] * (height * 0.21);
      const ppgHeadY = height * 0.78 - ppgBuffer[headX] * (height * 0.22);

      ctx.fillStyle = hrEmergency ? '#EF4444' : '#F59E0B';
      ctx.beginPath();
      ctx.arc(headX, ecgHeadY, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = spo2Emergency ? '#EF4444' : '#06B6D4';
      ctx.beginPath();
      ctx.arc(headX, ppgHeadY, 3, 0, Math.PI * 2);
      ctx.fill();

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const stepVital = (field: keyof VitalsSnapshot, delta: number) => {
    const raw = Number((vitals[field] + delta).toFixed(1));
    if (field === 'systolic') {
      onChangeVitals({...vitals, systolic: Math.min(240, Math.max(60, Math.round(raw)))});
    } else if (field === 'diastolic') {
      onChangeVitals({...vitals, diastolic: Math.min(150, Math.max(40, Math.round(raw)))});
    } else if (field === 'spo2') {
      onChangeVitals({...vitals, spo2: Math.min(100, Math.max(65, Math.round(raw)))});
    } else if (field === 'heartRate') {
      onChangeVitals({...vitals, heartRate: Math.min(200, Math.max(38, Math.round(raw)))});
    } else {
      onChangeVitals({...vitals, temperature: Math.min(107.0, Math.max(94.0, raw))});
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    const ms = Math.round(relX * 4000);
    const mv = ((0.5 - relY) * 2.4).toFixed(2);
    setProbeCoords({ms, mv});
  };

  const sysTone = evaluateVitalStatus('systolic', vitals.systolic);
  const spo2Tone = evaluateVitalStatus('spo2', vitals.spo2);
  const hrTone = evaluateVitalStatus('heartRate', vitals.heartRate);
  const tempTone = evaluateVitalStatus('temperature', vitals.temperature);

  const toneText = (level: 'routine' | 'moderate' | 'emergency') =>
    level === 'emergency'
      ? 'text-[#EF4444]'
      : level === 'moderate'
      ? 'text-[#F59E0B]'
      : 'text-[#06B6D4]';

  const toneWheel = (level: 'routine' | 'moderate' | 'emergency') =>
    level === 'emergency'
      ? 'red-wheel'
      : level === 'moderate'
      ? 'amber-wheel'
      : '';

  // Compute live 16-bit symptom bitmask integer
  let symptomMask = 0;
  ALL_SYMPTOMS.forEach((sym, idx) => {
    if (symptoms.includes(sym)) symptomMask |= 1 << idx;
  });

  return (
    <section className="rounded-xl bg-[#0D1322] border border-slate-800 overflow-hidden">
      {/* Dual-Trace Waveform Monitor Header */}
      <div className="px-4 py-2.5 bg-[#090D16] border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-200">
            01. Biometric Waveform &amp; Tactile Vitals Controller
          </span>
          <span className="text-[11px] font-mono text-slate-500">
            25 mm/s · 10 mm/mV
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums">
          <span className="text-[#F59E0B]">CH1: LEAD-II ECG ({vitals.heartRate} BPM)</span>
          <span className="text-slate-600">·</span>
          <span className="text-[#06B6D4]">CH2: PPG PLETH ({vitals.spo2}%)</span>
        </div>
      </div>

      {/* Live HTML5 Canvas PPG / ECG Oscilloscope */}
      <div className="relative bg-[#060A12] border-b border-slate-800">
        <canvas
          ref={canvasRef}
          width={640}
          height={156}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={() => setProbeCoords(null)}
          className="w-full h-[156px] block cursor-crosshair"
        />

        {/* Overlay Channel Telemetry Readouts */}
        <div className="pointer-events-none absolute top-2 left-3 flex items-center gap-3 font-mono text-[11px] text-[#F59E0B]/90 tabular-nums">
          <span>ECG-II</span>
          <span>HR {vitals.heartRate} /min</span>
          <span>MAP {Math.round((vitals.systolic + 2 * vitals.diastolic) / 3)} mmHg</span>
        </div>

        <div className="pointer-events-none absolute bottom-2 left-3 flex items-center gap-3 font-mono text-[11px] text-[#06B6D4]/90 tabular-nums">
          <span>SpO₂ PLETH</span>
          <span>PI {((vitals.spo2 - 80) * 0.18).toFixed(1)}%</span>
          <span>NIBP {vitals.systolic}/{vitals.diastolic} mmHg</span>
        </div>

        {probeCoords && (
          <div className="pointer-events-none absolute top-2 right-3 bg-[#090D16]/90 border border-slate-700 px-2 py-0.5 rounded font-mono text-[10px] text-slate-200 tabular-nums">
            t={probeCoords.ms}ms · {probeCoords.mv}mV
          </div>
        )}
      </div>

      {/* Outdoor-Glove-Friendly Tactile Stepper & Rotary Slider Wheels */}
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Control Module 1: Arterial Blood Pressure (SYS / DIA) */}
        <div className="rounded-lg bg-[#090D16] border border-slate-800 p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-300 inline-flex items-center gap-1.5">
              <Heart className="w-3.5 h-3.5 text-[#06B6D4]" />
              Arterial NIBP Cuff
            </span>
            <span className={`font-mono text-xs font-semibold ${toneText(sysTone)}`}>
              {sysTone === 'emergency' ? '✖ CRIT' : sysTone === 'moderate' ? '▲ ELEVATED' : '● NOMINAL'}
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <div>
              <span className={`text-2xl font-mono font-bold tabular-nums ${toneText(sysTone)}`}>
                {vitals.systolic}/{vitals.diastolic}
              </span>
              <span className="text-xs font-mono text-slate-500 ml-1.5 uppercase">mmHg</span>
            </div>
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
              PP {vitals.systolic - vitals.diastolic} mmHg
            </span>
          </div>

          {/* Systolic Wheel + Steppers */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span>SYSTOLIC DETENT</span>
              <span className="tabular-nums text-slate-200">{vitals.systolic} mmHg</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => stepVital('systolic', -5)}
                aria-label="Decrease Systolic BP"
                className="min-h-[48px] min-w-[48px] rounded-lg bg-[#11192C] hover:bg-slate-800 border border-slate-700 text-slate-100 flex items-center justify-center active:scale-95 transition-transform cursor-pointer shrink-0"
              >
                <Minus className="w-5 h-5" />
              </button>
              <input
                type="range"
                min={70}
                max={220}
                step={2}
                aria-label="Systolic BP Rotary Wheel"
                value={vitals.systolic}
                onChange={(e) =>
                  onChangeVitals({...vitals, systolic: Number(e.target.value)})
                }
                className={`w-full tactical-wheel ${toneWheel(sysTone)}`}
              />
              <button
                type="button"
                onClick={() => stepVital('systolic', 5)}
                aria-label="Increase Systolic BP"
                className="min-h-[48px] min-w-[48px] rounded-lg bg-[#11192C] hover:bg-slate-800 border border-slate-700 text-slate-100 flex items-center justify-center active:scale-95 transition-transform cursor-pointer shrink-0"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Diastolic Wheel + Steppers */}
          <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span>DIASTOLIC DETENT</span>
              <span className="tabular-nums text-slate-200">{vitals.diastolic} mmHg</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => stepVital('diastolic', -2)}
                aria-label="Decrease Diastolic BP"
                className="min-h-[48px] min-w-[48px] rounded-lg bg-[#11192C] hover:bg-slate-800 border border-slate-700 text-slate-100 flex items-center justify-center active:scale-95 transition-transform cursor-pointer shrink-0"
              >
                <Minus className="w-5 h-5" />
              </button>
              <input
                type="range"
                min={45}
                max={140}
                step={1}
                aria-label="Diastolic BP Rotary Wheel"
                value={vitals.diastolic}
                onChange={(e) =>
                  onChangeVitals({...vitals, diastolic: Number(e.target.value)})
                }
                className={`w-full tactical-wheel ${toneWheel(
                  evaluateVitalStatus('diastolic', vitals.diastolic)
                )}`}
              />
              <button
                type="button"
                onClick={() => stepVital('diastolic', 2)}
                aria-label="Increase Diastolic BP"
                className="min-h-[48px] min-w-[48px] rounded-lg bg-[#11192C] hover:bg-slate-800 border border-slate-700 text-slate-100 flex items-center justify-center active:scale-95 transition-transform cursor-pointer shrink-0"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Stack: SpO2, Pulse Rate & Core Temp Hardware Dials */}
        <div className="space-y-3">
          {/* SpO2 Oxygenation Dial */}
          <div className="rounded-lg bg-[#090D16] border border-slate-800 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300 inline-flex items-center gap-1.5">
                <LungsIcon className="w-3.5 h-3.5 text-[#06B6D4]" />
                Pulse Oximetry (SpO₂)
              </span>
              <div>
                <span className={`text-xl font-mono font-bold tabular-nums ${toneText(spo2Tone)}`}>
                  {vitals.spo2}
                </span>
                <span className="text-xs font-mono text-slate-500 ml-1">%</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => stepVital('spo2', -1)}
                aria-label="Decrease SpO2"
                className="min-h-[48px] min-w-[48px] rounded-lg bg-[#11192C] hover:bg-slate-800 border border-slate-700 text-slate-100 flex items-center justify-center active:scale-95 transition-transform cursor-pointer shrink-0"
              >
                <Minus className="w-5 h-5" />
              </button>
              <input
                type="range"
                min={70}
                max={100}
                step={1}
                aria-label="SpO2 Rotary Wheel"
                value={vitals.spo2}
                onChange={(e) => onChangeVitals({...vitals, spo2: Number(e.target.value)})}
                className={`w-full tactical-wheel ${toneWheel(spo2Tone)}`}
              />
              <button
                type="button"
                onClick={() => stepVital('spo2', 1)}
                aria-label="Increase SpO2"
                className="min-h-[48px] min-w-[48px] rounded-lg bg-[#11192C] hover:bg-slate-800 border border-slate-700 text-slate-100 flex items-center justify-center active:scale-95 transition-transform cursor-pointer shrink-0"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Heart Rate BPM Dial */}
          <div className="rounded-lg bg-[#090D16] border border-slate-800 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300 inline-flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-[#F59E0B]" />
                Cardiac Pulse Rate
              </span>
              <div>
                <span className={`text-xl font-mono font-bold tabular-nums ${toneText(hrTone)}`}>
                  {vitals.heartRate}
                </span>
                <span className="text-xs font-mono text-slate-500 ml-1">BPM</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => stepVital('heartRate', -4)}
                aria-label="Decrease Heart Rate"
                className="min-h-[48px] min-w-[48px] rounded-lg bg-[#11192C] hover:bg-slate-800 border border-slate-700 text-slate-100 flex items-center justify-center active:scale-95 transition-transform cursor-pointer shrink-0"
              >
                <Minus className="w-5 h-5" />
              </button>
              <input
                type="range"
                min={40}
                max={180}
                step={2}
                aria-label="Heart Rate Rotary Wheel"
                value={vitals.heartRate}
                onChange={(e) =>
                  onChangeVitals({...vitals, heartRate: Number(e.target.value)})
                }
                className={`w-full tactical-wheel ${
                  hrTone === 'routine' ? 'amber-wheel' : toneWheel(hrTone)
                }`}
              />
              <button
                type="button"
                onClick={() => stepVital('heartRate', 4)}
                aria-label="Increase Heart Rate"
                className="min-h-[48px] min-w-[48px] rounded-lg bg-[#11192C] hover:bg-slate-800 border border-slate-700 text-slate-100 flex items-center justify-center active:scale-95 transition-transform cursor-pointer shrink-0"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Core Temperature Dial */}
          <div className="rounded-lg bg-[#090D16] border border-slate-800 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300 inline-flex items-center gap-1.5">
                <Thermometer className="w-3.5 h-3.5 text-[#06B6D4]" />
                Core Thermal Probe
              </span>
              <div>
                <span className={`text-xl font-mono font-bold tabular-nums ${toneText(tempTone)}`}>
                  {vitals.temperature.toFixed(1)}
                </span>
                <span className="text-xs font-mono text-slate-500 ml-1">°F</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => stepVital('temperature', -0.4)}
                aria-label="Decrease Temperature"
                className="min-h-[48px] min-w-[48px] rounded-lg bg-[#11192C] hover:bg-slate-800 border border-slate-700 text-slate-100 flex items-center justify-center active:scale-95 transition-transform cursor-pointer shrink-0"
              >
                <Minus className="w-5 h-5" />
              </button>
              <input
                type="range"
                min={95}
                max={106}
                step={0.2}
                aria-label="Temperature Rotary Wheel"
                value={vitals.temperature}
                onChange={(e) =>
                  onChangeVitals({...vitals, temperature: Number(e.target.value)})
                }
                className={`w-full tactical-wheel ${toneWheel(tempTone)}`}
              />
              <button
                type="button"
                onClick={() => stepVital('temperature', 0.4)}
                aria-label="Increase Temperature"
                className="min-h-[48px] min-w-[48px] rounded-lg bg-[#11192C] hover:bg-slate-800 border border-slate-700 text-slate-100 flex items-center justify-center active:scale-95 transition-transform cursor-pointer shrink-0"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 16-Bit Symptom Toggle Hardware Matrix */}
      <div className="px-4 pb-4 pt-1 border-t border-slate-800/80">
        <div className="flex items-center justify-between py-2 text-xs">
          <span className="font-semibold text-slate-300">
            Clinical Symptom Bitmask Switches
          </span>
          <span className="font-mono text-[11px] text-[#06B6D4] tabular-nums">
            UINT16 MASK: 0b{symptomMask.toString(2).padStart(16, '0')}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {ALL_SYMPTOMS.map((sym, bitIdx) => {
            const active = symptoms.includes(sym);
            const isCritical = sym === 'Severe Chest Pain' || sym === 'Bleeding';
            return (
              <button
                key={sym}
                type="button"
                onClick={() => onToggleSymptom(sym)}
                aria-pressed={active}
                className={`min-h-[50px] px-3 py-2 rounded-lg border text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                  active
                    ? isCritical
                      ? 'bg-[#EF4444]/20 border-[#EF4444] text-white'
                      : 'bg-[#06B6D4]/15 border-[#06B6D4] text-white'
                    : 'bg-[#090D16] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <span className="text-xs font-semibold truncate">{sym}</span>
                <span
                  className={`font-mono text-[10px] shrink-0 ${
                    active
                      ? isCritical
                        ? 'text-[#EF4444]'
                        : 'text-[#06B6D4]'
                      : 'text-slate-600'
                  }`}
                >
                  B{bitIdx}:{active ? '1' : '0'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
