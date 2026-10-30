import React, {useEffect, useRef, useState} from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Eye,
  Image as ImageIcon,
  Info,
  Mic,
  RotateCcw,
  Upload,
  Zap,
} from 'lucide-react';
import {EdgeAiDiagnostics} from '../types/triage';
import {
  analyzeConjunctivaRoiPixels,
  buildQuickDemoScanMetrics,
  drawSampleConjunctivaOnCanvas,
  EYE_SCAN_CANVAS_HEIGHT,
  EYE_SCAN_CANVAS_WIDTH,
  getConjunctivaRoiBounds,
} from '../utils/anemiaEyeScanner';

interface EdgeAiDiagnosticsPanelProps {
  diagnostics: EdgeAiDiagnostics;
  onChange: (next: EdgeAiDiagnostics) => void;
}

const DEMO_PROGRESS_WIDTH_CLASS: Record<number, string> = {
  0: 'w-0',
  1: 'w-1/4',
  2: 'w-2/4',
  3: 'w-3/4',
  4: 'w-full',
};

export const EdgeAiDiagnosticsPanel: React.FC<EdgeAiDiagnosticsPanelProps> = ({
  diagnostics,
  onChange,
}) => {
  const [activeTab, setActiveTab] = useState<'anemia' | 'cough'>('anemia');

  // Eye Scanner / Hemoglobin Estimator State
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scannerToast, setScannerToast] = useState<string | null>(null);
  const [isScanningEye, setIsScanningEye] = useState(false);
  const [isDemoScanning, setIsDemoScanning] = useState(false);
  const [demoStep, setDemoStep] = useState<number>(0);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(
    diagnostics?.conjunctivaMetrics?.capturedDataUrl ?? null
  );
  const [sampleVariant, setSampleVariant] = useState<'anemic' | 'normal'>('anemic');

  // Cough Audio Check State
  const [isRecordingCough, setIsRecordingCough] = useState(false);
  const [coughError, setCoughError] = useState<string | null>(null);
  const [coughBars, setCoughBars] = useState<number[]>([16, 16, 16, 16, 16, 16, 16, 16]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const scanSessionIdRef = useRef<number>(0);
  const scanTimerRef = useRef<number | null>(null);
  const demoIntervalRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const coughPollIntervalRef = useRef<number | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const diagnosticsRef = useRef<EdgeAiDiagnostics>(
    diagnostics || {anemiaSuspected: false, respiratoryRiskHigh: false}
  );

  useEffect(() => {
    diagnosticsRef.current = diagnostics || {anemiaSuspected: false, respiratoryRiskHigh: false};
    if (diagnostics?.conjunctivaMetrics?.capturedDataUrl) {
      setPreviewImageUrl(diagnostics.conjunctivaMetrics.capturedDataUrl);
    }
  }, [diagnostics]);

  const revokeActiveObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const clearEyeScanTimers = () => {
    if (scanTimerRef.current !== null) {
      window.clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (demoIntervalRef.current !== null) {
      window.clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = null;
    }
  };

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
    scanSessionIdRef.current += 1;
    clearEyeScanTimers();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (updateState && isMountedRef.current) {
      setIsScanningEye(false);
      setIsDemoScanning(false);
      setDemoStep(0);
      setCameraReady(false);
      setCameraActive(false);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopCamera(false);
      stopCoughSampling(false);
      revokeActiveObjectUrl();
      if (toastTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  const showScannerToast = (message: string) => {
    if (!isMountedRef.current) return;
    setScannerToast(message);
    if (toastTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(toastTimerRef.current);
    }
    if (typeof window !== 'undefined') {
      toastTimerRef.current = window.setTimeout(() => {
        if (isMountedRef.current) {
          setScannerToast(null);
        }
      }, 6000);
    }
  };

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      void videoRef.current.play().catch((err) => {
        console.warn('[SwasthyaSetu Camera] Video preview play deferred:', err);
      });
    }
  }, [cameraActive]);

  const startCameraPreview = async () => {
    stopCamera(false);
    setCameraError(null);
    setScannerToast(null);
    setIsDemoScanning(false);
    setDemoStep(0);
    const sessionId = ++scanSessionIdRef.current;

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      const noMediaMsg =
        'Camera API unavailable in this browser — automatically running ⚡ Quick Demo Scan.';
      console.warn('[SwasthyaSetu Camera] navigator.mediaDevices.getUserMedia unavailable; auto-toggling Quick Demo Scan.');
      handleQuickDemoScan(noMediaMsg);
      return;
    }

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {facingMode: 'environment'},
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({video: true});
      }

      if (!isMountedRef.current || sessionId !== scanSessionIdRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      setPreviewImageUrl(null);
      setCameraReady(false);
      setCameraActive(true);
    } catch (err) {
      if (!isMountedRef.current || sessionId !== scanSessionIdRef.current) return;
      const errName = err instanceof Error ? err.name : 'CameraError';
      console.warn(
        `[SwasthyaSetu Camera] getUserMedia failed (${errName}); automatically toggling Quick Demo Scan.`
      );
      setCameraActive(false);
      setCameraReady(false);
      const reasonMsg =
        errName === 'NotAllowedError' || errName === 'PermissionDeniedError'
          ? 'Camera permission denied — automatically switched to ⚡ Quick Demo Scan (or use Upload Photo below).'
          : errName === 'NotFoundError' || errName === 'DevicesNotFoundError'
          ? 'No camera hardware detected — automatically switched to ⚡ Quick Demo Scan.'
          : errName === 'NotReadableError' || errName === 'TrackStartError'
          ? 'Camera is busy in another app — automatically switched to ⚡ Quick Demo Scan.'
          : 'Camera unavailable — automatically switched to ⚡ Quick Demo Scan.';
      handleQuickDemoScan(reasonMsg);
    }
  };

  const runCanvasRgbAnalysis = (
    drawSourceOntoCanvas: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
  ) => {
    const canvas = canvasRef.current ?? document.createElement('canvas');
    canvas.width = EYE_SCAN_CANVAS_WIDTH;
    canvas.height = EYE_SCAN_CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d', {willReadFrequently: true});

    if (!ctx) {
      setIsScanningEye(false);
      setCameraError('HTML5 Canvas color analysis is unavailable in this browser.');
      return;
    }

    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawSourceOntoCanvas(ctx, canvas.width, canvas.height);

      const roiBounds = getConjunctivaRoiBounds(canvas.width, canvas.height);
      const imageData = ctx.getImageData(
        roiBounds.x,
        roiBounds.y,
        roiBounds.width,
        roiBounds.height
      );

      let snapshotUrl: string | undefined;
      try {
        snapshotUrl = canvas.toDataURL('image/jpeg', 0.85);
      } catch {
        snapshotUrl = undefined;
      }

      const outcome = analyzeConjunctivaRoiPixels(imageData.data, snapshotUrl);
      if (!outcome.ok || !outcome.metrics) {
        setIsScanningEye(false);
        setCameraError(outcome.error || 'Could not analyze eyelid region. Please try again.');
        return;
      }

      if (snapshotUrl) {
        setPreviewImageUrl(snapshotUrl);
      }
      setIsScanningEye(false);
      setCameraError(null);

      onChange({
        ...diagnosticsRef.current,
        anemiaSuspected: outcome.anemiaRisk,
        estimatedHb: outcome.metrics.estimatedHb,
        conjunctivaMetrics: outcome.metrics,
      });
    } catch {
      setIsScanningEye(false);
      setCameraError(
        'Could not read image pixels on this device. Try another photo or tap Quick Demo Scan.'
      );
    }
  };

  const handleScanLiveCamera = () => {
    if (isScanningEye || isDemoScanning) return;
    const videoEl = videoRef.current;
    if (!cameraActive || !videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) {
      setCameraError(
        'Camera is still focusing — wait a second and tap Capture & Estimate Hb again, or use Upload Photo / Quick Demo Scan.'
      );
      return;
    }

    setIsScanningEye(true);
    setCameraError(null);

    // Capture current frame immediately before stopping preview so there is zero frame freeze
    runCanvasRgbAnalysis((ctx, width, height) => {
      ctx.drawImage(videoEl, 0, 0, width, height);
    });
    stopCamera(true);
  };

  const handlePhotoUploadChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setCameraError('Please select a valid image file (JPG, PNG, or WebP).');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setCameraError('Image file is too large (max 15 MB). Please choose a smaller photo.');
      return;
    }

    stopCamera(true);
    setCameraError(null);
    setIsScanningEye(true);
    const sessionId = ++scanSessionIdRef.current;

    revokeActiveObjectUrl();
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;

    const img = new Image();
    img.onload = () => {
      revokeActiveObjectUrl();
      if (!isMountedRef.current || sessionId !== scanSessionIdRef.current) return;
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        setIsScanningEye(false);
        setCameraError('Uploaded photo could not be decoded. Please try a different image.');
        return;
      }

      runCanvasRgbAnalysis((ctx, width, height) => {
        // Center-crop aspect-fill onto analysis canvas so conjunctiva stays centered
        const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
        const drawWidth = img.naturalWidth * scale;
        const drawHeight = img.naturalHeight * scale;
        const offsetX = (width - drawWidth) / 2;
        const offsetY = (height - drawHeight) / 2;
        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
      });
    };
    img.onerror = () => {
      revokeActiveObjectUrl();
      if (!isMountedRef.current || sessionId !== scanSessionIdRef.current) return;
      setIsScanningEye(false);
      setCameraError('Could not load the selected photo. Please try another image file.');
    };
    img.src = objectUrl;
  };

  const handleUseSampleImage = () => {
    if (isScanningEye || isDemoScanning) return;
    stopCamera(true);
    setCameraError(null);
    setIsScanningEye(true);

    const variantToRun = sampleVariant;
    setSampleVariant((prev) => (prev === 'anemic' ? 'normal' : 'anemic'));

    const tempCanvas = document.createElement('canvas');
    drawSampleConjunctivaOnCanvas(tempCanvas, variantToRun);

    runCanvasRgbAnalysis((ctx, width, height) => {
      ctx.drawImage(tempCanvas, 0, 0, width, height);
    });
  };

  const handleQuickDemoScan = (autoFallbackNotice?: string) => {
    if (isDemoScanning) return;
    stopCamera(true);
    if (typeof autoFallbackNotice === 'string' && autoFallbackNotice) {
      setCameraError(autoFallbackNotice);
      showScannerToast(autoFallbackNotice);
    } else {
      setCameraError(null);
      setScannerToast(null);
    }

    const sessionId = ++scanSessionIdRef.current;
    const sampleCanvas = canvasRef.current ?? document.createElement('canvas');
    const sampleUrl = drawSampleConjunctivaOnCanvas(sampleCanvas, 'anemic');
    if (sampleUrl) {
      setPreviewImageUrl(sampleUrl);
    }

    setIsDemoScanning(true);
    setIsScanningEye(true);
    setDemoStep(1);

    demoIntervalRef.current = window.setInterval(() => {
      if (!isMountedRef.current || sessionId !== scanSessionIdRef.current) {
        clearEyeScanTimers();
        return;
      }
      setDemoStep((prev) => Math.min(4, prev + 1));
    }, 500);

    scanTimerRef.current = window.setTimeout(() => {
      clearEyeScanTimers();
      if (!isMountedRef.current || sessionId !== scanSessionIdRef.current) return;

      const demoMetrics = buildQuickDemoScanMetrics(sampleUrl);
      setIsDemoScanning(false);
      setIsScanningEye(false);
      setDemoStep(0);

      onChange({
        ...diagnosticsRef.current,
        anemiaSuspected: true,
        estimatedHb: demoMetrics.estimatedHb,
        conjunctivaMetrics: demoMetrics,
      });
    }, 2000);
  };

  const handleRecordCough = async () => {
    if (isRecordingCough) return;
    setCoughError(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
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
        (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if (!Ctor) {
        stopCoughSampling(true);
        setCoughError(
          'Web Audio spectrum analyzer unavailable in this browser. Mark cough symptoms manually above.'
        );
        return;
      }
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
    revokeActiveObjectUrl();
    setPreviewImageUrl(null);
    setCameraError(null);
    setCoughError(null);
    setCoughBars([16, 16, 16, 16, 16, 16, 16, 16]);
    onChange({
      anemiaSuspected: false,
      respiratoryRiskHigh: false,
    });
  };

  const currentHb = diagnostics?.estimatedHb ?? diagnostics?.conjunctivaMetrics?.estimatedHb;
  const isAnemiaFlagged =
    (typeof currentHb === 'number' && currentHb < 10.0) || Boolean(diagnostics?.anemiaSuspected);
  const isSevereAnemia = typeof currentHb === 'number' && currentHb < 7.0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Anemia Eye Scanner &amp; Cough Check
          </h3>
          <p className="mt-0.5 text-sm text-slate-600">
            Client-side eyelid RGB hemoglobin estimator and cough pitch check — runs 100% on-device.
          </p>
        </div>

        {(diagnostics?.anemiaSuspected ||
          diagnostics?.estimatedHb !== undefined ||
          diagnostics?.respiratoryRiskHigh ||
          diagnostics?.conjunctivaMetrics ||
          diagnostics?.coughMetrics) && (
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

      {scannerToast && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50/80 px-3.5 py-2.5 text-xs font-medium text-teal-950"
        >
          <Zap className="h-4 w-4 shrink-0 text-teal-700" />
          <span>{scannerToast}</span>
        </div>
      )}

      {/* Clear, Non-Dismissible Medical Disclaimer */}
      <div
        role="note"
        aria-label="Screening Disclaimer"
        className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs leading-relaxed text-amber-950"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <p>
          <strong>Important Notice:</strong> Optical eyelid RGB hemoglobin estimation is a rapid
          screening aid and depends on ambient lighting. Always confirm suspected anemia (&lt; 10.0
          g/dL) with a clinic laboratory blood hemoglobin test.
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
          <span>Anemia Eye Scanner</span>
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
          {/* Hidden File Input & Offscreen Analysis Canvas */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoUploadChange}
            className="hidden"
            aria-label="Upload lower eyelid photo for hemoglobin estimation"
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Viewport: Live Camera, Captured/Sample Snapshot, or Ready Prompt */}
          <div className="relative h-48 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
            {cameraActive ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={() => setCameraReady(true)}
                  onCanPlay={() => setCameraReady(true)}
                  className="h-full w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <div className="h-20 w-40 rounded-xl border-2 border-dashed border-white/95 shadow-xs" />
                  <span className="mt-1.5 rounded-md bg-slate-900/65 px-2 py-0.5 text-[11px] font-medium text-white">
                    Center inner lower eyelid in ROI box
                  </span>
                </div>
              </>
            ) : previewImageUrl ? (
              <>
                <img
                  src={previewImageUrl}
                  alt="Captured lower eyelid conjunctiva region"
                  className="h-full w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-slate-900/15">
                  <div
                    className={`h-20 w-40 rounded-xl border-2 border-dashed transition-colors ${
                      isDemoScanning
                        ? 'animate-pulse border-teal-300 bg-teal-500/15'
                        : 'border-white/95'
                    }`}
                  />
                  <span className="mt-1.5 rounded-md bg-slate-900/75 px-2.5 py-0.5 text-[11px] font-medium text-white">
                    {isDemoScanning
                      ? 'Scanning palpebral conjunctiva RGB channels...'
                      : 'Analyzed Conjunctiva ROI'}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                <Camera className="mb-2 h-6 w-6 text-slate-400" />
                <p className="max-w-sm text-sm font-medium text-slate-700">
                  Gently pull down the lower eyelid in natural daylight, or upload/select a photo.
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={startCameraPreview}
                    disabled={isDemoScanning}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                  >
                    <Camera className="h-4 w-4" />
                    <span>Turn On Camera</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isDemoScanning}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
                  >
                    <Upload className="h-4 w-4 text-teal-700" />
                    <span>Upload Photo</span>
                  </button>
                </div>
              </div>
            )}

            {/* Smooth 2-Second Scan Progress Bar (Pure Tailwind classes, zero inline styles) */}
            {isDemoScanning && (
              <div
                role="status"
                aria-live="polite"
                className="absolute inset-x-0 bottom-0 bg-slate-900/80 px-4 py-2 text-white"
              >
                <div className="mb-1 flex items-center justify-between text-[11px] font-medium">
                  <span>Analyzing Conjunctiva R/G/B Ratio...</span>
                  <span className="font-mono tabular-nums">{demoStep * 25}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
                  <div
                    className={`h-full rounded-full bg-teal-400 transition-all duration-500 ${
                      DEMO_PROGRESS_WIDTH_CLASS[demoStep] ?? 'w-2/4'
                    }`}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Live Camera Action Bar */}
          {cameraActive && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleScanLiveCamera}
                disabled={isScanningEye || !cameraReady}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
              >
                <Camera className="h-4 w-4" />
                <span>
                  {!cameraReady
                    ? 'Starting Camera...'
                    : isScanningEye
                    ? 'Analyzing RGB...'
                    : 'Capture & Estimate Hb'}
                </span>
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

          {/* Always-Available Fallback & Hackathon Demo Controls */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isDemoScanning}
              className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5 shrink-0 text-teal-700" />
              <span>Upload Photo</span>
            </button>

            <button
              type="button"
              onClick={handleUseSampleImage}
              disabled={isDemoScanning}
              className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
            >
              <ImageIcon className="h-3.5 w-3.5 shrink-0 text-teal-700" />
              <span>
                Use Sample ({sampleVariant === 'anemic' ? 'Pale Eyelid' : 'Healthy Eyelid'})
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickDemoScan()}
              disabled={isDemoScanning}
              className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-900 hover:bg-teal-100 disabled:opacity-60 cursor-pointer"
            >
              <Zap className="h-3.5 w-3.5 shrink-0 text-teal-700" />
              <span>{isDemoScanning ? 'Scanning (2s)...' : '⚡ Quick Demo Scan'}</span>
            </button>
          </div>

          {/* Graceful Camera / Upload Fallback Notice */}
          {cameraError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs leading-relaxed text-amber-950"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="space-y-2">
                <p>{cameraError}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                  >
                    <Upload className="h-3.5 w-3.5 text-teal-700" />
                    <span>Upload Photo</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleUseSampleImage}
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                  >
                    <ImageIcon className="h-3.5 w-3.5 text-teal-700" />
                    <span>Use Sample Image</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Hemoglobin & RGB Analysis Result Card */}
          {(diagnostics?.conjunctivaMetrics || currentHb !== undefined) && !isDemoScanning && (
            <div
              className={`rounded-xl border p-4 text-sm space-y-2.5 ${
                isSevereAnemia
                  ? 'border-red-200 bg-red-50/80 text-red-950'
                  : isAnemiaFlagged
                  ? 'border-amber-200 bg-amber-50/80 text-amber-950'
                  : 'border-emerald-200 bg-emerald-50/70 text-emerald-950'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {isSevereAnemia ? (
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                  ) : isAnemiaFlagged ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                  )}
                  <span className="font-semibold">
                    {diagnostics?.conjunctivaMetrics?.diagnosticLabel ??
                      (isAnemiaFlagged
                        ? 'Anemia Risk Flagged (< 10.0 g/dL)'
                        : 'Hemoglobin Within Normal Range')}
                  </span>
                </div>

                {currentHb !== undefined && (
                  <span
                    className={`inline-flex items-center rounded-lg px-2.5 py-1 font-mono text-xs font-bold tabular-nums ${
                      isSevereAnemia
                        ? 'bg-red-100 text-red-900'
                        : isAnemiaFlagged
                        ? 'bg-amber-100 text-amber-950'
                        : 'bg-emerald-100 text-emerald-900'
                    }`}
                  >
                    Est. Hb: {currentHb.toFixed(1)} g/dL
                  </span>
                )}
              </div>

              {diagnostics?.conjunctivaMetrics && (
                <p className="text-xs text-slate-700 tabular-nums">
                  Conjunctiva ROI Avg RGB: R {diagnostics.conjunctivaMetrics.avgR} · G{' '}
                  {diagnostics.conjunctivaMetrics.avgG} · B {diagnostics.conjunctivaMetrics.avgB} ·
                  Redness Ratio {diagnostics.conjunctivaMetrics.redGreenBlueRatio}
                </p>
              )}

              <p className="text-xs text-slate-600">
                Auto-populated into the Patient Screening Form above.{' '}
                {isAnemiaFlagged
                  ? 'Anemia Risk (< 10.0 g/dL) has updated the patient triage status.'
                  : 'Continue routine checkup and confirm with clinic blood test if needed.'}
              </p>
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
              {(coughBars || []).map((pct, idx) => {
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

          {diagnostics?.coughMetrics && (
            <div
              className={`flex items-start gap-2.5 rounded-xl border p-3.5 text-sm ${
                diagnostics?.respiratoryRiskHigh
                  ? 'border-amber-200 bg-amber-50/80 text-amber-950'
                  : 'border-emerald-200 bg-emerald-50/70 text-emerald-950'
              }`}
            >
              {diagnostics?.respiratoryRiskHigh ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              )}
              <div>
                <p className="font-semibold">{diagnostics.coughMetrics.diagnosticLabel}</p>
                <p className="mt-0.5 text-xs text-slate-600 tabular-nums">
                  Measured pitch peak: {diagnostics.coughMetrics.dominantFrequencyHz ?? 0} Hz · Confirm
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
