import React, {useEffect, useRef, useState} from 'react';
import {AlertCircle, AlertTriangle, Camera, CheckCircle2, Eye, Info, Mic, RotateCcw} from 'lucide-react';
import {EdgeAiDiagnostics} from '../types/triage';

interface EdgeAiDiagnosticsPanelProps {
  diagnostics: EdgeAiDiagnostics;
  onChange: (next: EdgeAiDiagnostics) => void;
}

export const EdgeAiDiagnosticsPanel: React.FC<EdgeAiDiagnosticsPanelProps> = ({
  diagnostics,
  onChange,
}) => {
  const [activeTab, setActiveTab] = useState<'anemia' | 'cough'>('anemia');

  // Real Camera Check State (never fabricates readings without active camera)
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanningEye, setIsScanningEye] = useState(false);

  // Real Microphone Check State (never fabricates readings without active microphone)
  const [isRecordingCough, setIsRecordingCough] = useState(false);
  const [coughError, setCoughError] = useState<string | null>(null);
  const [coughBars, setCoughBars] = useState<number[]>([16, 16, 16, 16, 16, 16, 16, 16]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const scanTimerRef = useRef<number | null>(null);
  const coughPollIntervalRef = useRef<number | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const diagnosticsRef = useRef<EdgeAiDiagnostics>(diagnostics);

  useEffect(() => {
    diagnosticsRef.current = diagnostics;
  }, [diagnostics]);

  const stopCoughSampling = (resetUiState = false) => {
    if (coughPollIntervalRef.current !== null) {
      window.clearInterval(coughPollIntervalRef.current);
      coughPollIntervalRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      const ctxToClose = audioCtxRef.current;
      audioCtxRef.current = null;
      ctxToClose.close().catch(() => {});
    }
    if (resetUiState && isMountedRef.current) {
      setIsRecordingCough(false);
    }
  };

  const stopCamera = (updateState = true) => {
    if (scanTimerRef.current !== null) {
      window.clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (updateState && isMountedRef.current) {
      setIsScanningEye(false);
      setCameraActive(false);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopCamera(false);
      stopCoughSampling(false);
    };
  }, []);

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      void videoRef.current.play().catch(() => {});
    }
  }, [cameraActive]);

  const startCameraPreview = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Camera access is not supported in this browser. Check lower-eyelid paleness visually and refer to the clinic for a blood hemoglobin test.'
      );
      return;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {facingMode: {ideal: 'environment'}, width: {ideal: 480}, height: {ideal: 320}},
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({video: true});
      }
      if (!isMountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => {});
      }
    } catch {
      if (!isMountedRef.current) return;
      setCameraError(
        'Camera permission was declined or no camera was found. Please check the patient visually and use a clinic blood test if paleness is suspected.'
      );
    }
  };

  const handleScanEyelid = () => {
    if (
      !cameraActive ||
      !videoRef.current ||
      videoRef.current.readyState < 2 ||
      videoRef.current.videoWidth === 0
    ) {
      setCameraError('Camera is still focusing — wait a moment and tap Check Camera Frame again.');
      return;
    }

    setIsScanningEye(true);
    setCameraError(null);

    const canvas = canvasRef.current ?? document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      setIsScanningEye(false);
      setCameraError('Unable to read camera frame on this device.');
      return;
    }

    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const roi = ctx.getImageData(60, 45, 120, 70).data;

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    const pixelCount = roi.length / 4;
    for (let i = 0; i < roi.length; i += 4) {
      sumR += roi[i];
      sumG += roi[i + 1];
      sumB += roi[i + 2];
    }

    const avgR = Math.round(sumR / pixelCount);
    const avgG = Math.round(sumG / pixelCount);
    const avgB = Math.round(sumB / pixelCount);
    const ratio = Number((avgR / Math.max(1, avgG + avgB)).toFixed(2));
    const pallorDetected = ratio < 0.65;
    const estimatedHb = Number(Math.min(14.5, Math.max(6.5, 6.2 + ratio * 9.5)).toFixed(1));
    const label = pallorDetected
      ? 'Pale eyelid color noticed — schedule clinic blood test'
      : 'Normal redness observed in camera frame';

    if (scanTimerRef.current !== null) {
      window.clearTimeout(scanTimerRef.current);
    }
    scanTimerRef.current = window.setTimeout(() => {
      scanTimerRef.current = null;
      if (!isMountedRef.current) return;
      setIsScanningEye(false);
      onChange({
        ...diagnosticsRef.current,
        anemiaSuspected: pallorDetected,
        estimatedHb,
        conjunctivaMetrics: {
          avgR,
          avgG,
          avgB,
          redGreenBlueRatio: ratio,
          erythemaIndex: Number((avgR - avgG).toFixed(1)),
          estimatedHb,
          pallorDetected,
          diagnosticLabel: label,
        },
      });
    }, 250);
  };

  const handleRecordCough = async () => {
    if (isRecordingCough) return;
    setCoughError(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCoughError(
        'Microphone access is not supported in this browser. Listen to breathing manually and mark "Cough" in symptoms if present.'
      );
      return;
    }

    stopCoughSampling(false);

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({audio: true});
      if (!isMountedRef.current) {
        micStream.getTracks().forEach((t) => t.stop());
        return;
      }

      micStreamRef.current = micStream;
      setIsRecordingCough(true);

      const Ctor =
        window.AudioContext ||
        (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
      const audioCtx = new Ctor();
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(() => {});
      }

      const source = audioCtx.createMediaStreamSource(micStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);

      const freqData = new Uint8Array(analyser.frequencyBinCount);
      let peakHz = 0;
      let maxEnergy = 0;
      let completedSteps = 0;
      const sampleRate = audioCtx.sampleRate;

      coughPollIntervalRef.current = window.setInterval(() => {
        if (!isMountedRef.current) {
          stopCoughSampling(false);
          return;
        }

        analyser.getByteFrequencyData(freqData);
        const bars = Array.from({length: 8}, (_, idx) => {
          const val = freqData[idx * 6 + 3] || 0;
          return Math.max(12, Math.min(96, Math.round((val / 255) * 100)));
        });
        setCoughBars(bars);

        const stepMax = Math.max(...Array.from(freqData));
        if (stepMax > maxEnergy) {
          maxEnergy = stepMax;
          const maxBin = freqData.indexOf(stepMax);
          if (maxBin > 0) {
            peakHz = Math.round((maxBin * sampleRate) / analyser.fftSize);
          }
        }

        completedSteps += 1;
        if (completedSteps >= 8) {
          stopCoughSampling(true);

          if (!isMountedRef.current) return;
          if (maxEnergy < 12) {
            setCoughError(
              'No clear cough sound was heard. Move closer in a quiet room and try again.'
            );
            return;
          }

          const highPitchFlag = peakHz >= 600;
          const label = highPitchFlag
            ? 'High-pitched cough sound noticed — doctor chest check advised'
            : 'Cough audio sample recorded — no high-pitch flag';

          onChange({
            ...diagnosticsRef.current,
            respiratoryRiskHigh: highPitchFlag,
            coughPeakHz: peakHz,
            coughMetrics: {
              dominantFrequencyHz: peakHz,
              rmsIntensity: Number((maxEnergy / 255).toFixed(2)),
              highRespiratoryRisk: highPitchFlag,
              diagnosticLabel: label,
            },
          });
        }
      }, 200);
    } catch {
      stopCoughSampling(false);
      if (!isMountedRef.current) return;
      setIsRecordingCough(false);
      setCoughError(
        'Microphone permission was declined or unavailable. Mark cough symptoms manually above.'
      );
    }
  };

  const handleClearChecks = () => {
    stopCamera();
    stopCoughSampling(true);
    setCameraError(null);
    setCoughError(null);
    setCoughBars([16, 16, 16, 16, 16, 16, 16, 16]);
    onChange({
      anemiaSuspected: false,
      respiratoryRiskHigh: false,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Optional Camera &amp; Cough Observation
          </h3>
          <p className="mt-0.5 text-sm text-slate-600">
            Supportive visual redness and microphone check when laboratory tools are not nearby.
          </p>
        </div>

        {(diagnostics.anemiaSuspected ||
          diagnostics.respiratoryRiskHigh ||
          diagnostics.conjunctivaMetrics ||
          diagnostics.coughMetrics) && (
          <button
            type="button"
            onClick={handleClearChecks}
            className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset</span>
          </button>
        )}
      </div>

      {/* Clear, Non-Dismissible Medical Disclaimer */}
      <div
        role="note"
        aria-label="Screening Disclaimer"
        className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs leading-relaxed text-amber-950"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <p>
          <strong>Important Notice:</strong> Phone cameras and microphones cannot diagnose anemia or
          lung disease and depend on room lighting and background noise. Always confirm suspected
          findings with a standard clinic blood test and a doctor&apos;s examination.
        </p>
      </div>

      {/* Clean Segmented Control */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => {
            stopCoughSampling(true);
            setActiveTab('anemia');
          }}
          className={`flex min-h-[42px] items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'anemia'
              ? 'bg-white text-slate-900 font-semibold shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Eye className="h-4 w-4 shrink-0 text-teal-700" />
          <span>Eyelid Color Check</span>
        </button>
        <button
          type="button"
          onClick={() => {
            stopCamera();
            setActiveTab('cough');
          }}
          className={`flex min-h-[42px] items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'cough'
              ? 'bg-white text-slate-900 font-semibold shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Mic className="h-4 w-4 shrink-0 text-teal-700" />
          <span>Cough Sound Check</span>
        </button>
      </div>

      {activeTab === 'anemia' ? (
        <div className="space-y-3">
          <div className="relative h-44 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
            {cameraActive ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-16 w-36 rounded-xl border-2 border-dashed border-white/90 shadow-xs" />
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                <Camera className="mb-2 h-6 w-6 text-slate-400" />
                <p className="text-sm font-medium text-slate-700">
                  Use natural daylight and center the inner lower eyelid in the frame.
                </p>
                <button
                  type="button"
                  onClick={startCameraPreview}
                  className="mt-3 inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                >
                  <Camera className="h-4 w-4 text-teal-700" />
                  <span>Turn On Camera</span>
                </button>
              </div>
            )}
          </div>

          <canvas ref={canvasRef} className="hidden" />

          {cameraActive && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleScanEyelid}
                disabled={isScanningEye}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
              >
                <Camera className="h-4 w-4" />
                <span>{isScanningEye ? 'Checking Image...' : 'Check Camera Frame'}</span>
              </button>
              <button
                type="button"
                onClick={() => stopCamera()}
                className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Stop Camera
              </button>
            </div>
          )}

          {cameraError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-700"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <span>{cameraError}</span>
            </div>
          )}

          {diagnostics.conjunctivaMetrics && (
            <div
              className={`flex items-start gap-2.5 rounded-xl border p-3.5 text-sm ${
                diagnostics.anemiaSuspected
                  ? 'border-amber-200 bg-amber-50/80 text-amber-950'
                  : 'border-emerald-200 bg-emerald-50/70 text-emerald-950'
              }`}
            >
              {diagnostics.anemiaSuspected ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              )}
              <div>
                <p className="font-semibold">
                  {diagnostics.conjunctivaMetrics.diagnosticLabel}
                </p>
                <p className="mt-0.5 text-xs text-slate-600 tabular-nums">
                  Camera redness ratio: {diagnostics.conjunctivaMetrics.redGreenBlueRatio} · Confirm
                  with clinic blood hemoglobin test.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <svg
              viewBox="0 0 184 64"
              aria-hidden="true"
              className="mx-auto h-16 w-44 overflow-visible"
            >
              {coughBars.map((pct, idx) => {
                const barHeight = Math.max(8, Math.round((pct / 100) * 60));
                return (
                  <rect
                    key={idx}
                    x={idx * 24 + 4}
                    y={64 - barHeight}
                    width={14}
                    height={barHeight}
                    rx={4}
                    className={isRecordingCough ? 'fill-teal-600' : 'fill-slate-300'}
                  />
                );
              })}
            </svg>
            <p className="mt-2.5 text-center text-xs text-slate-600">
              {isRecordingCough
                ? 'Listening to cough sample for 1.6 seconds...'
                : 'Hold phone 20 cm away in a quiet room and record a brief cough.'}
            </p>
          </div>

          <button
            type="button"
            onClick={handleRecordCough}
            disabled={isRecordingCough}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
          >
            <Mic className="h-4 w-4 text-teal-700" />
            <span>{isRecordingCough ? 'Listening...' : 'Record Short Cough Sample'}</span>
          </button>

          {coughError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-700"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <span>{coughError}</span>
            </div>
          )}

          {diagnostics.coughMetrics && (
            <div
              className={`flex items-start gap-2.5 rounded-xl border p-3.5 text-sm ${
                diagnostics.respiratoryRiskHigh
                  ? 'border-amber-200 bg-amber-50/80 text-amber-950'
                  : 'border-emerald-200 bg-emerald-50/70 text-emerald-950'
              }`}
            >
              {diagnostics.respiratoryRiskHigh ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              )}
              <div>
                <p className="font-semibold">{diagnostics.coughMetrics.diagnosticLabel}</p>
                <p className="mt-0.5 text-xs text-slate-600 tabular-nums">
                  Measured pitch peak: {diagnostics.coughMetrics.dominantFrequencyHz} Hz · Confirm
                  with stethoscope exam.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
