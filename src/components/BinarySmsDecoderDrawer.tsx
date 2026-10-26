import React, {useState, useEffect} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  X,
  Binary,
  CheckCircle2,
  AlertTriangle,
  Copy,
  ShieldCheck,
  Activity,
  FlaskConical,
} from 'lucide-react';
import {TriageRecord} from '../types/triage';
import {
  buildFhirBundleFromDecoded,
  decodeSMSPayload,
} from '../utils/binarySmsCodec';

interface BinarySmsDecoderDrawerProps {
  record: TriageRecord | null;
  isOpen: boolean;
  initialPayload?: string;
  mode: 'decode' | 'vitals';
  onClose: () => void;
}

export const BinarySmsDecoderDrawer: React.FC<BinarySmsDecoderDrawerProps> = ({
  record,
  isOpen,
  initialPayload,
  mode,
  onClose,
}) => {
  const [testPayloadInput, setTestPayloadInput] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (initialPayload) {
      setTestPayloadInput(initialPayload);
    } else if (record?.binarySmsPayload) {
      setTestPayloadInput(record.binarySmsPayload);
    }
  }, [initialPayload, record]);

  if (!isOpen) return null;

  const decoded = decodeSMSPayload(testPayloadInput);
  const fhirBundle = buildFhirBundleFromDecoded(decoded, {
    patientName: record?.patientName,
    abhaId: record?.abhaId,
    age: record?.age,
    gender: record?.gender,
  });
  const fhirJson = JSON.stringify(fhirBundle, null, 2);

  const handleCopy = () => {
    navigator.clipboard?.writeText(fhirJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex justify-end bg-slate-900/60 backdrop-blur-xs"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sms-decoder-drawer-heading"
      >
        <motion.aside
          initial={{x: '100%'}}
          animate={{x: 0}}
          exit={{x: '100%'}}
          transition={{type: 'spring', stiffness: 320, damping: 32}}
          className="w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col"
        >
          {/* Drawer Header */}
          <div className="px-6 py-4 bg-[#0F172A] text-white flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#0D9488] flex items-center justify-center shrink-0">
                {mode === 'decode' ? (
                  <Binary className="w-5 h-5 text-white" />
                ) : (
                  <Activity className="w-5 h-5 text-white" />
                )}
              </div>
              <div className="min-w-0">
                <h2 id="sms-decoder-drawer-heading" className="text-base font-bold truncate">
                  {mode === 'decode'
                    ? 'Bitwise Base64 Binary SMS Decoder'
                    : `Clinical Vitals & Telemetry · ${record?.patientId ?? decoded.patientId}`}
                </h2>
                <p className="text-xs text-slate-300 truncate">
                  Pure JavaScript DataView + CRC-16-CCITT Reverse Unpacker
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Decoder Drawer"
              className="min-h-[44px] min-w-[44px] rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Live Interactive SMS Payload Decoder Input */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="live-sms-decoder-input"
                  className="text-xs font-bold text-slate-900 inline-flex items-center gap-1.5"
                >
                  <FlaskConical className="w-4 h-4 text-[#0D9488]" />
                  <span>Paste or Edit `HS#` SMS Payload to Test Real-Time Bit Unpacking:</span>
                </label>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  {testPayloadInput.length} chars
                </span>
              </div>

              <input
                id="live-sms-decoder-input"
                type="text"
                value={testPayloadInput}
                onChange={(e) => setTestPayloadInput(e.target.value)}
                placeholder="HS#..."
                className="w-full min-h-[48px] px-4 rounded-xl bg-slate-950 text-[#06B6D4] font-mono text-sm border border-slate-800"
              />

              {decoded.valid ? (
                <div
                  className={`rounded-xl px-3.5 py-2.5 text-xs font-bold flex items-center justify-between ${
                    decoded.crcValid
                      ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                      : 'bg-red-50 border border-red-300 text-red-900'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {decoded.crcValid ? (
                      <ShieldCheck className="w-4 h-4 text-[#10B981]" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
                    )}
                    {decoded.crcValid
                      ? '18-Byte Binary Frame & CRC-16 Checksum Verified'
                      : decoded.error}
                  </span>
                  <span className="font-mono tabular-nums">
                    CRC {decoded.receivedCrcHex}
                  </span>
                </div>
              ) : (
                <div className="rounded-xl px-3.5 py-2.5 text-xs font-bold bg-red-50 border border-red-300 text-red-900">
                  {decoded.error}
                </div>
              )}
            </section>

            {/* Decoded Numerical Vitals Output */}
            {decoded.valid && (
              <>
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-700">
                      Decoded Numerical Vitals &amp; Identifiers
                    </h3>
                    <span
                      className={`text-xs font-bold ${
                        decoded.severity === 'emergency'
                          ? 'text-[#EF4444]'
                          : decoded.severity === 'moderate'
                          ? 'text-[#F59E0B]'
                          : 'text-[#10B981]'
                      }`}
                    >
                      {decoded.severity.toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-5 gap-2 text-center font-mono tabular-nums">
                    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-2.5">
                      <span className="block text-[10px] font-sans text-slate-500">BP</span>
                      <strong className="text-xs text-slate-900">
                        {decoded.vitals.systolic}/{decoded.vitals.diastolic}
                      </strong>
                    </div>
                    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-2.5">
                      <span className="block text-[10px] font-sans text-slate-500">SpO₂</span>
                      <strong className="text-xs text-slate-900">{decoded.vitals.spo2}%</strong>
                    </div>
                    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-2.5">
                      <span className="block text-[10px] font-sans text-slate-500">Temp</span>
                      <strong className="text-xs text-slate-900">
                        {decoded.vitals.temperature.toFixed(1)}°F
                      </strong>
                    </div>
                    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-2.5">
                      <span className="block text-[10px] font-sans text-slate-500">HR</span>
                      <strong className="text-xs text-slate-900">
                        {decoded.vitals.heartRate} bpm
                      </strong>
                    </div>
                    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-2.5">
                      <span className="block text-[10px] font-sans text-slate-500">Node</span>
                      <strong className="text-xs text-[#0D9488]">{decoded.villageCode}</strong>
                    </div>
                  </div>

                  {/* Bitwise Breakdown */}
                  <div className="rounded-2xl border border-slate-200 overflow-hidden text-xs">
                    <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 font-mono text-[11px] text-slate-600">
                      Hex Dump ({decoded.byteLength}B): {decoded.hexDump}
                    </div>
                    <div className="divide-y divide-slate-100">
                      <div className="px-4 py-2 flex justify-between">
                        <span className="text-slate-600">Patient &amp; Sub-Center IDs</span>
                        <span className="font-mono font-semibold text-slate-900">
                          {decoded.patientId} · {decoded.villageCode}
                        </span>
                      </div>
                      <div className="px-4 py-2 flex justify-between">
                        <span className="text-slate-600">Unpacked Symptoms (6-bit mask)</span>
                        <span className="font-mono font-semibold text-slate-900">
                          0b{decoded.symptomBitmask.toString(2).padStart(6, '0')} →{' '}
                          {decoded.symptoms.join(', ') || 'None'}
                        </span>
                      </div>
                      <div className="px-4 py-2 flex justify-between">
                        <span className="text-slate-600">Edge-AI Flags (2-bit mask)</span>
                        <span className="font-mono font-semibold text-[#0D9488]">
                          Pallor: {decoded.anemiaSuspected ? 'YES' : 'NO'} · Resp:{' '}
                          {decoded.respiratoryRiskHigh ? 'HIGH' : 'NORM'}
                        </span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* FHIR JSON Output */}
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-900">
                      ABDM HL7 FHIR R4 Observation Bundle
                    </h3>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="min-h-[34px] px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {copied ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-slate-600" />
                          <span>Copy JSON</span>
                        </>
                      )}
                    </button>
                  </div>

                  <pre className="rounded-2xl bg-slate-950 text-slate-100 font-mono text-[11px] p-4 overflow-x-auto leading-relaxed border border-slate-800 max-h-64">
                    {fhirJson}
                  </pre>
                </section>
              </>
            )}
          </div>
        </motion.aside>
      </div>
    </AnimatePresence>
  );
};
