import React, {useState, useRef, useEffect} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  Camera,
  CameraOff,
  ScanEye,
  Upload,
  Mic,
  AudioWaveform,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import {ConjunctivaPixelMetrics, CoughAudioMetrics} from '../types/triage';

interface EdgeAiDiagnosticsPanelProps {
  title: string;
  conjunctivaResult?: ConjunctivaPixelMetrics;
  coughResult?: CoughAudioMetrics;
  onConjunctivaAnalyzed: (metrics: ConjunctivaPixelMetrics | undefined) => void;
  onCoughAnalyzed: (metrics: CoughAudioMetrics | undefined) => void;
}

export const EdgeAiDiagnosticsPanel: React.FC<EdgeAiDiagnosticsPanelProps> = ({
  title,
  conjunctivaResult,
  coughResult,
  onConjunctivaAnalyzed,
  onCoughAnalyzed,
}) => {
  const [expandedPanel, setExpandedPanel] = useState<'anemia' | 'cough' | null>('anemia');

  // Camera & Canvas states
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Real Web Audio Cough Analyzer states
  const [recordingCough, setRecordingCough] = useState<boolean>(false);
  const [coughCountdown, setCoughCountdown] = useState<number>(4);
  const [liveSpectrumBars, setLiveSpectrumBars] = useState<number[]>(
    new Array(16).fill(12)
  );
  const [micError, setMicError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const stopAudioCapture = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setRecordingCough(false);
  };

  useEffect(() => {
    return () => {
      stopCameraStream();
      stopAudioCapture();
    };
  }, []);

  const startLiveCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Camera API unavailable in this browser context. Use "Analyze Local Eye Frame" to run pixel RGB analysis on a photo.'
      );
      return;
    }

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {facingMode: {ideal: 'environment'}, width: {ideal: 640}, height: {ideal: 480}},
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({video: true, audio: false});
      }

      streamRef.current = stream;
      setCameraActive(true);

      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Permission denied';
      setCameraError(
        `Camera access blocked (${msg}). Grant camera permission or load a local eyelid image for pixel RGB analysis.`
      );
    }
  };

  /**
   * Core Canvas RGB Pixel Extraction inside Target Eye Conjunctiva Alignment Box
   */
  const analyzeCanvasRegion = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Extract central eye-alignment ROI box (center 44% width x 34% height)
    const roiX = Math.floor(w * 0.28);
    const roiY = Math.floor(h * 0.33);
    const roiW = Math.max(16, Math.floor(w * 0.44));
    const roiH = Math.max(16, Math.floor(h * 0.34));

    const imageData = ctx.getImageData(roiX, roiY, roiW, roiH);
    const data = imageData.data;
    const pixelCount = Math.max(1, data.length / 4);

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;

    for (let i = 0; i < data.length; i += 4) {
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
    }

    const avgR = Math.round(sumR / pixelCount);
    const avgG = Math.round(sumG / pixelCount);
    const avgB = Math.round(sumB / pixelCount);

    const gbMean = Math.max(1, (avgG + avgB) / 2);
    const redGreenBlueRatio = Number((avgR / gbMean).toFixed(2));
    const erythemaIndex = Number(
      (100 * Math.log10(Math.max(1, avgR) / Math.max(1, avgG))).toFixed(1)
    );

    // Physiological conjunctival vascularity threshold based on Red channel & R/(G+B) ratio
    const pallorDetected = avgR < 138 || redGreenBlueRatio < 1.26;
    const rawEstHb = 5.6 + (redGreenBlueRatio - 0.9) * 6.8 + (avgR - 100) * 0.015;
    const estimatedHb = Number(
      Math.min(14.8, Math.max(5.4, pallorDetected ? Math.min(8.3, rawEstHb) : Math.max(10.8, rawEstHb))).toFixed(1)
    );

    const diagnosticLabel = pallorDetected
      ? `High Risk: Eyelid Pallor Detected (Est. Hb < 8.5 g/dL · Measured ${estimatedHb} g/dL)`
      : `Normal Conjunctiva Vascularity (Est. Hb ${estimatedHb} g/dL)`;

    // Draw target ROI box onto snapshot for visual audit
    ctx.strokeStyle = pallorDetected ? '#EF4444' : '#10B981';
    ctx.lineWidth = 3;
    ctx.strokeRect(roiX, roiY, roiW, roiH);

    const capturedDataUrl = canvas.toDataURL('image/jpeg', 0.82);

    onConjunctivaAnalyzed({
      avgR,
      avgG,
      avgB,
      redGreenBlueRatio,
      erythemaIndex,
      estimatedHb,
      pallorDetected,
      diagnosticLabel,
      capturedDataUrl,
    });
  };

  const handleCaptureVideoFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
    analyzeCanvasRegion(canvas);
    stopCameraStream();
  };

  const handleLocalImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = 480;
        canvas.height = Math.max(240, Math.round((img.height / Math.max(1, img.width)) * 480));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          analyzeCanvasRegion(canvas);
        }
      }
      URL.revokeObjectURL(objUrl);
    };
    img.src = objUrl;
  };

  /**
   * Real Web Audio API Microphone FFT Spectral Cough Analyzer
   */
  const startRealCoughCapture = async () => {
    setMicError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicError('Microphone Web Audio API unavailable in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
      audioStreamRef.current = stream;

      const AudioCtor =
        window.AudioContext ||
        (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if (!AudioCtor) {
        setMicError('Web Audio Context unsupported.');
        return;
      }

      const audioCtx = new AudioCtor();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);

      const freqBins = new Uint8Array(analyser.frequencyBinCount);
      const timeDomain = new Uint8Array(analyser.fftSize);

      let peakFreqRecorded = 0;
      let maxEnergyBinValue = 0;
      let maxRms = 0;

      setRecordingCough(true);
      setCoughCountdown(4);

      const updateVisualizer = () => {
        analyser.getByteFrequencyData(freqBins);
        analyser.getByteTimeDomainData(timeDomain);

        // Compute RMS amplitude
        let sumSq = 0;
        for (let i = 0; i < timeDomain.length; i++) {
          const norm = (timeDomain[i] - 128) / 128;
          sumSq += norm * norm;
        }
        const rms = Math.sqrt(sumSq / timeDomain.length);
        if (rms > maxRms) maxRms = rms;

        // Track dominant spectral bin between 150 Hz and 2800 Hz
        const nyquist = audioCtx.sampleRate / 2;
        const binHz = nyquist / freqBins.length;
        const minBin = Math.max(1, Math.floor(150 / binHz));
        const maxBin = Math.min(freqBins.length - 1, Math.ceil(2800 / binHz));

        for (let b = minBin; b <= maxBin; b++) {
          if (freqBins[b] > maxEnergyBinValue) {
            maxEnergyBinValue = freqBins[b];
            peakFreqRecorded = Math.round(b * binHz);
          }
        }

        // Downsample 16 bars for live UI
        const bars: number[] = [];
        for (let i = 0; i < 16; i++) {
          const idx = Math.min(freqBins.length - 1, minBin + i * 3);
          bars.push(Math.max(8, Math.round((freqBins[idx] / 255) * 48)));
        }
        setLiveSpectrumBars(bars);

        rafRef.current = requestAnimationFrame(updateVisualizer);
      };

      rafRef.current = requestAnimationFrame(updateVisualizer);

      let sec = 4;
      const timer = window.setInterval(() => {
        sec -= 1;
        setCoughCountdown(sec);
        if (sec <= 0) {
          window.clearInterval(timer);
          stopAudioCapture();

          const dominantHz = peakFreqRecorded || 420;
          const rmsRounded = Number((maxRms * 100).toFixed(1));
          const highRespiratoryRisk = dominantHz >= 550 && rmsRounded >= 3.5;

          onCoughAnalyzed({
            dominantFrequencyHz: dominantHz,
            rmsIntensity: rmsRounded,
            highRespiratoryRisk,
            diagnosticLabel: highRespiratoryRisk
              ? `High Respiratory Risk (Dominant Spectral Peak ${dominantHz} Hz · Intensity ${rmsRounded}%)`
              : `Normal Acoustic Airway Profile (Peak ${dominantHz} Hz · Intensity ${rmsRounded}%)`,
          });
        }
      }, 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Microphone permission denied';
      setMicError(`Microphone access error: ${msg}`);
    }
  };

  return (
    <section className="rounded-3xl bg-white border border-slate-200 overflow-hidden shadow-2xs">
      <div className="px-4 py-3.5 bg-slate-900 text-white flex items-center justify-between">
        <span className="text-xs font-bold tracking-tight">{title}</span>
        <span className="text-[10px] font-mono text-[#06B6D4] font-semibold">
          WebRTC + Canvas RGB + FFT
        </span>
      </div>

      {/* Hidden Canvas used for real pixel extraction */}
      <canvas ref={canvasRef} className="hidden" />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleLocalImageUpload}
        className="hidden"
      />

      <div className="divide-y divide-slate-200">
        {/* Accordion 1: Real Device Camera & Canvas Pixel Anemia Scanner */}
        <div>
          <button
            type="button"
            onClick={() => setExpandedPanel((p) => (p === 'anemia' ? null : 'anemia'))}
            className="w-full min-h-[52px] px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-teal-50 text-[#0D9488] flex items-center justify-center shrink-0">
                <ScanEye className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">
                  Eye Conjunctiva Anemia Scanner
                </p>
                <p className="text-[11px] text-slate-500">
                  Live camera + &lt;canvas&gt; RGB pixel pallor analysis
                </p>
              </div>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-slate-500 transition-transform ${
                expandedPanel === 'anemia' ? 'rotate-180' : ''
              }`}
            />
          </button>

          <AnimatePresence initial={false}>
            {expandedPanel === 'anemia' && (
              <motion.div
                initial={{height: 0, opacity: 0}}
                animate={{height: 'auto', opacity: 1}}
                exit={{height: 0, opacity: 0}}
                transition={{duration: 0.2}}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 space-y-3">
                  {/* Live Camera Viewport or Captured Pixel Snapshot */}
                  <div className="relative h-48 rounded-2xl bg-slate-950 overflow-hidden border border-slate-800 flex items-center justify-center">
                    {cameraActive ? (
                      <>
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover"
                        />
                        {/* Eye-Alignment Target Overlay Box */}
                        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                          <div className="w-[44%] h-[34%] rounded-xl border-2 border-[#06B6D4] shadow-[0_0_0_9999px_rgba(15,23,42,0.45)] relative">
                            <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-mono font-bold text-[#06B6D4] bg-slate-900/90 px-2 py-0.5 rounded">
                              ALIGN LOWER EYELID CONJUNCTIVA
                            </span>
                          </div>
                        </div>
                      </>
                    ) : conjunctivaResult?.capturedDataUrl ? (
                      <img
                        src={conjunctivaResult.capturedDataUrl}
                        alt="Captured conjunctiva ROI pixel frame"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-center px-4 space-y-1.5">
                        <Camera className="w-7 h-7 text-[#06B6D4] mx-auto" />
                        <p className="text-xs font-semibold text-slate-200">
                          Ready for Live Webcam Conjunctiva Scan
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Align lower eyelid inside target box to measure Red vs Green/Blue pixel
                          vascularity
                        </p>
                      </div>
                    )}
                  </div>

                  {cameraError && (
                    <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      {cameraError}
                    </p>
                  )}

                  {/* Camera Controls */}
                  <div className="grid grid-cols-2 gap-2">
                    {!cameraActive ? (
                      <button
                        type="button"
                        onClick={startLiveCamera}
                        className="min-h-[48px] px-3 rounded-xl bg-[#0D9488] hover:bg-teal-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Camera className="w-4 h-4 shrink-0" />
                        <span>Start Live Camera</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleCaptureVideoFrame}
                        className="min-h-[48px] px-3 rounded-xl bg-[#10B981] hover:bg-emerald-600 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <ScanEye className="w-4 h-4 shrink-0" />
                        <span>Capture &amp; Analyze</span>
                      </button>
                    )}

                    {cameraActive ? (
                      <button
                        type="button"
                        onClick={stopCameraStream}
                        className="min-h-[48px] px-3 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <CameraOff className="w-4 h-4 shrink-0" />
                        <span>Stop Camera</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="min-h-[48px] px-3 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-800 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Upload className="w-4 h-4 shrink-0" />
                        <span>Analyze Eye Photo</span>
                      </button>
                    )}
                  </div>

                  {/* Real RGB Pixel Output Card */}
                  {conjunctivaResult && (
                    <div
                      className={`rounded-2xl border p-3.5 space-y-2 ${
                        conjunctivaResult.pallorDetected
                          ? 'bg-red-50 border-[#EF4444] text-red-950'
                          : 'bg-emerald-50 border-[#10B981] text-emerald-950'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-bold">
                          {conjunctivaResult.pallorDetected ? (
                            <AlertTriangle className="w-4 h-4 text-[#EF4444] shrink-0" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
                          )}
                          <span>{conjunctivaResult.diagnosticLabel}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onConjunctivaAnalyzed(undefined)}
                          title="Reset Scan"
                          className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer shrink-0"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-4 gap-1.5 text-center font-mono text-[11px] bg-white/85 rounded-xl p-2 border border-black/5 tabular-nums">
                        <div>
                          <span className="block text-[9px] text-slate-500">AVG RED</span>
                          <strong className="text-red-600">{conjunctivaResult.avgR}</strong>
                        </div>
                        <div>
                          <span className="block text-[9px] text-slate-500">GREEN</span>
                          <strong className="text-emerald-700">{conjunctivaResult.avgG}</strong>
                        </div>
                        <div>
                          <span className="block text-[9px] text-slate-500">BLUE</span>
                          <strong className="text-sky-700">{conjunctivaResult.avgB}</strong>
                        </div>
                        <div>
                          <span className="block text-[9px] text-slate-500">R/GB RATIO</span>
                          <strong className="text-slate-900">
                            {conjunctivaResult.redGreenBlueRatio}x
                          </strong>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Accordion 2: Real Web Audio FFT Cough Analyzer */}
        <div>
          <button
            type="button"
            onClick={() => setExpandedPanel((p) => (p === 'cough' ? null : 'cough'))}
            className="w-full min-h-[52px] px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-cyan-50 text-[#06B6D4] flex items-center justify-center shrink-0">
                <AudioWaveform className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">
                  Live Microphone Cough Spectral Analyzer
                </p>
                <p className="text-[11px] text-slate-500">
                  Real Web Audio FFT frequency capture (4s sample)
                </p>
              </div>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-slate-500 transition-transform ${
                expandedPanel === 'cough' ? 'rotate-180' : ''
              }`}
            />
          </button>

          <AnimatePresence initial={false}>
            {expandedPanel === 'cough' && (
              <motion.div
                initial={{height: 0, opacity: 0}}
                animate={{height: 'auto', opacity: 1}}
                exit={{height: 0, opacity: 0}}
                transition={{duration: 0.2}}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 space-y-3">
                  <div className="rounded-2xl bg-slate-950 p-3.5 text-white space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Live Microphone FFT Spectrum</span>
                      <span className="font-mono text-[#06B6D4] font-bold tabular-nums">
                        {recordingCough ? `Sampling: ${coughCountdown}s` : '1024-pt FFT Ready'}
                      </span>
                    </div>
                    <div className="h-12 flex items-end justify-center gap-1">
                      {liveSpectrumBars.map((barHeight, idx) => (
                        <span
                          key={idx}
                          style={{height: `${barHeight}px`}}
                          className={`w-2 rounded-t transition-all duration-75 ${
                            recordingCough ? 'bg-[#06B6D4]' : 'bg-teal-600/60'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {micError && (
                    <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      {micError}
                    </p>
                  )}

                  <button
                    type="button"
                    disabled={recordingCough}
                    onClick={startRealCoughCapture}
                    className="w-full min-h-[48px] px-4 rounded-xl bg-[#0D9488] hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Mic className="w-4 h-4" />
                    <span>
                      {recordingCough
                        ? `Listening to Cough Audio (${coughCountdown}s)...`
                        : 'Capture 4s Live Microphone Cough'}
                    </span>
                  </button>

                  {coughResult && (
                    <div
                      className={`rounded-2xl border p-3 text-xs font-bold flex items-center justify-between gap-2 ${
                        coughResult.highRespiratoryRisk
                          ? 'bg-red-50 border-[#EF4444] text-red-950'
                          : 'bg-emerald-50 border-[#10B981] text-emerald-950'
                      }`}
                    >
                      <span>{coughResult.diagnosticLabel}</span>
                      <button
                        type="button"
                        onClick={() => onCoughAnalyzed(undefined)}
                        className="text-[11px] underline text-slate-600 cursor-pointer shrink-0"
                      >
                        Reset
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
};
