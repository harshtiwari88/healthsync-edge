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
        className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sms-decoder-drawer-heading"
      >
        <motion.aside
          initial={{x: '100%'}}
          animate={{x: 0}}
          exit={{x: '100%'}}
          transition={{duration: 0.18}}
          className="w-full max-w-xl bg-[#090D16] text-slate-100 h-full shadow-2xl border-l border-slate-800 flex flex-col"
        >
          <div className="px-5 py-4 bg-[#060911] border-b border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-[#06B6D4]/15 border border-[#06B6D4]/50 flex items-center justify-center shrink-0">
                {mode === 'decode' ? (
                  <Binary className="w-4 h-4 text-[#06B6D4]" />
                ) : (
                  <Activity className="w-4 h-4 text-[#F59E0B]" />
                )}
              </div>
              <div className="min-w-0">
                <h2
                  id="sms-decoder-drawer-heading"
                  className="text-sm font-semibold text-white truncate"
                >
                  {mode === 'decode'
                    ? 'Packet Bitstream & CRC32 Inspector'
                    : `Clinical Telemetry Bundle · ${record?.patientId ?? decoded.patientId}`}
                </h2>
                <p className="font-mono text-[11px] text-slate-400 truncate">
                  {decoded.protocolVersion} · CRDT {decoded.crdtNodeId}:{decoded.crdtSeq}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Inspector"
              className="min-h-[40px] min-w-[40px] rounded-lg bg-[#11192C] hover:bg-slate-800 border border-slate-700 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <section className="space-y-2">
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="text-slate-300">RAW BASE64 SMS PACKET</span>
                <span className="text-[#06B6D4] tabular-nums">
                  {testPayloadInput.length} chars
                </span>
              </div>
              <input
                type="text"
                aria-label="SMS Packet Input"
                value={testPayloadInput}
                onChange={(e) => setTestPayloadInput(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-lg bg-[#05080F] text-[#06B6D4] font-mono text-xs border border-slate-800"
              />

              {decoded.valid ? (
                <div
                  className={`rounded-lg px-3.5 py-2.5 font-mono text-xs flex items-center justify-between border ${
                    decoded.crcValid
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                      : 'bg-[#EF4444]/15 border-[#EF4444] text-red-200'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {decoded.crcValid ? (
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
                    )}
                    {decoded.crcValid ? 'CHECKSUM & BITSTREAM VERIFIED' : decoded.error}
                  </span>
                  <span className="tabular-nums">{decoded.receivedCrcHex}</span>
                </div>
              ) : (
                <div className="rounded-lg px-3.5 py-2.5 font-mono text-xs bg-[#EF4444]/15 border border-[#EF4444] text-red-200">
                  {decoded.error}
                </div>
              )}
            </section>

            {decoded.valid && (
              <>
                <section className="rounded-lg bg-[#0D1322] border border-slate-800 p-3.5 space-y-2 font-mono text-xs tabular-nums">
                  <div className="text-[11px] text-slate-400">
                    HEX HEADER: {decoded.hexDump}
                  </div>
                  <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-800 text-center">
                    <div>
                      <span className="block text-[10px] text-slate-500">NIBP</span>
                      <strong className="text-white">
                        {decoded.vitals.systolic}/{decoded.vitals.diastolic}
                      </strong>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-500">SpO₂</span>
                      <strong className="text-[#06B6D4]">{decoded.vitals.spo2}%</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-500">HR</span>
                      <strong className="text-[#F59E0B]">{decoded.vitals.heartRate}</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-500">TEMP</span>
                      <strong className="text-white">
                        {decoded.vitals.temperature.toFixed(1)}°F
                      </strong>
                    </div>
                  </div>
                </section>

                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-slate-200">
                      HL7 FHIR R4 OBSERVATION BUNDLE
                    </span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="min-h-[34px] px-3 rounded bg-[#11192C] hover:bg-slate-800 border border-slate-700 font-mono text-xs text-[#06B6D4] inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {copied ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy JSON</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="rounded-lg bg-[#05080F] text-slate-200 font-mono text-[11px] p-4 overflow-x-auto leading-relaxed border border-slate-800">
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
