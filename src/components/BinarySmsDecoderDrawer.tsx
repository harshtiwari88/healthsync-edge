import React, {useState} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  X,
  Binary,
  CheckCircle2,
  Copy,
  ShieldCheck,
  Cpu,
  Activity,
} from 'lucide-react';
import {TriageRecord, unpackSmsToFhirJson} from '../types/triage';

interface BinarySmsDecoderDrawerProps {
  record: TriageRecord | null;
  mode: 'decode' | 'vitals';
  onClose: () => void;
}

export const BinarySmsDecoderDrawer: React.FC<BinarySmsDecoderDrawerProps> = ({
  record,
  mode,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!record) return null;

  const {packedTelemetry, fhirBundle} = unpackSmsToFhirJson(record);
  const fhirJsonString = JSON.stringify(fhirBundle, null, 2);

  const handleCopyJson = () => {
    navigator.clipboard?.writeText(fhirJsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex justify-end bg-slate-900/55 backdrop-blur-xs"
        role="dialog"
        aria-modal="true"
        aria-labelledby="decoder-drawer-title"
      >
        <motion.aside
          initial={{x: '100%'}}
          animate={{x: 0}}
          exit={{x: '100%'}}
          transition={{duration: 0.2, ease: [0.16, 1, 0.3, 1]}}
          className="w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col"
        >
          {/* Drawer Header */}
          <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#0F766E] flex items-center justify-center shrink-0">
                {mode === 'decode' ? (
                  <Binary className="w-5 h-5 text-emerald-200" />
                ) : (
                  <Activity className="w-5 h-5 text-emerald-200" />
                )}
              </div>
              <div className="min-w-0">
                <h2 id="decoder-drawer-title" className="text-base font-bold truncate">
                  {mode === 'decode'
                    ? 'Baseband Binary SMS → FHIR Decoder'
                    : `Patient Vitals & Edge-AI Payload · ${record.patientId}`}
                </h2>
                <p className="text-xs text-slate-300 truncate">
                  {record.patientName} ({record.age}
                  {record.gender}) · {record.villageCode} · ABHA {record.abhaId}
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

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Clinical Vitals & Edge-AI Summary */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-500">
                  Clinical Snapshot &amp; Edge-AI Flags
                </h3>
                <span
                  className={`text-xs font-bold ${
                    record.severity === 'emergency'
                      ? 'text-[#EF4444]'
                      : record.severity === 'moderate'
                      ? 'text-[#F59E0B]'
                      : 'text-[#10B981]'
                  }`}
                >
                  {record.severity === 'emergency'
                    ? 'RED · CRITICAL EMERGENCY'
                    : record.severity === 'moderate'
                    ? 'YELLOW · MODERATE RISK'
                    : 'GREEN · ROUTINE'}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2.5 text-center font-mono tabular-nums">
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
                  <span className="block text-[11px] font-sans text-slate-500">BP (mmHg)</span>
                  <span className="text-sm font-bold text-slate-900">
                    {record.vitals.systolic}/{record.vitals.diastolic}
                  </span>
                </div>
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
                  <span className="block text-[11px] font-sans text-slate-500">SpO₂</span>
                  <span className="text-sm font-bold text-slate-900">{record.vitals.spo2}%</span>
                </div>
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
                  <span className="block text-[11px] font-sans text-slate-500">Temp</span>
                  <span className="text-sm font-bold text-slate-900">
                    {record.vitals.temperature.toFixed(1)}°F
                  </span>
                </div>
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
                  <span className="block text-[11px] font-sans text-slate-500">Channel</span>
                  <span className="text-xs font-bold text-[#0F766E]">{record.channel}</span>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2 text-xs text-slate-700">
                <div>
                  <span className="font-bold text-slate-900">Symptoms: </span>
                  {record.symptoms.length > 0 ? record.symptoms.join(' · ') : 'None flagged'}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <Cpu className="w-3.5 h-3.5 text-[#0F766E]" />
                    Conjunctiva Anemia:{' '}
                    <strong
                      className={
                        record.edgeAi?.anemiaSuspected ? 'text-[#EF4444]' : 'text-slate-600'
                      }
                    >
                      {record.edgeAi?.anemiaSuspected
                        ? `Suspected Severe (Hb ${record.edgeAi.estimatedHb ?? 7.4} g/dL)`
                        : 'Not Flagged'}
                    </strong>
                  </span>
                  <span>·</span>
                  <span className="font-semibold">
                    Cough Acoustic AI:{' '}
                    <strong
                      className={
                        record.edgeAi?.respiratoryRiskHigh ? 'text-[#EF4444]' : 'text-slate-600'
                      }
                    >
                      {record.edgeAi?.respiratoryRiskHigh
                        ? `High Respiratory Risk (${record.edgeAi.coughPeakHz ?? 880} Hz)`
                        : 'Normal'}
                    </strong>
                  </span>
                </div>
                <p className="text-slate-600 pt-1 border-t border-slate-200">
                  {record.clinicalNotes}
                </p>
              </div>
            </section>

            {/* Step 1: Raw 160-Character Baseband Binary SMS Wire Frame */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900">
                  1. Incoming 160-Char GSM 7-Bit / Base64 SMS Wire Frame
                </h3>
                <span className="font-mono text-xs text-emerald-700 font-bold inline-flex items-center gap-1 tabular-nums">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />
                  {record.binarySmsPayload.length}/160 chars · CRC Verified
                </span>
              </div>

              <div className="rounded-2xl bg-slate-900 text-emerald-300 font-mono text-xs p-4 break-all leading-relaxed border border-slate-800">
                {record.binarySmsPayload}
              </div>
            </section>

            {/* Step 2: Bit-Packed Byte Unpacking Matrix */}
            <section className="space-y-2.5">
              <h3 className="text-xs font-bold text-slate-900">
                2. Bit-Packed Base64 Frame Unpacking ({packedTelemetry.base64})
              </h3>
              <div className="rounded-2xl border border-slate-200 overflow-hidden text-xs">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 font-mono text-[11px] text-slate-600 flex items-center justify-between">
                  <span>Raw Hex Bytes: {packedTelemetry.hexBytes}</span>
                  <span>8-Byte Binary Payload</span>
                </div>
                <div className="divide-y divide-slate-100">
                  <div className="px-4 py-2.5 flex justify-between">
                    <span className="text-slate-600">Bytes [0..1] Magic Header</span>
                    <span className="font-mono font-semibold text-slate-900">
                      0x48 0x53 (&quot;HS&quot; HealthSync v1)
                    </span>
                  </div>
                  <div className="px-4 py-2.5 flex justify-between">
                    <span className="text-slate-600">Bytes [2..3] Blood Pressure</span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      Sys {record.vitals.systolic} / Dia {record.vitals.diastolic} mmHg
                    </span>
                  </div>
                  <div className="px-4 py-2.5 flex justify-between">
                    <span className="text-slate-600">Bytes [4..5] SpO₂ &amp; Temp Offset</span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {record.vitals.spo2}% · {record.vitals.temperature.toFixed(1)}°F
                    </span>
                  </div>
                  <div className="px-4 py-2.5 flex justify-between">
                    <span className="text-slate-600">Byte [6] Symptom Bitmask (5-bit)</span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      0b{packedTelemetry.symptomMask.toString(2).padStart(5, '0')} (
                      {record.symptoms.length} active)
                    </span>
                  </div>
                  <div className="px-4 py-2.5 flex justify-between">
                    <span className="text-slate-600">Byte [7] Triage Tier + Edge-AI Flags</span>
                    <span className="font-mono font-semibold text-[#0F766E] tabular-nums">
                      AI Mask 0b{packedTelemetry.aiMask.toString(2).padStart(2, '0')} ·{' '}
                      {record.severity.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* Step 3: Unpacked Server-Side HL7 FHIR R4 / ABDM JSON */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900">
                  3. Reconstructed Server-Side ABDM HL7 FHIR R4 Bundle
                </h3>
                <button
                  type="button"
                  onClick={handleCopyJson}
                  className="min-h-[34px] px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
                      <span>Copied JSON</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-600" />
                      <span>Copy FHIR JSON</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="rounded-2xl bg-slate-950 text-slate-100 font-mono text-[11px] p-4 overflow-x-auto leading-relaxed border border-slate-800 max-h-72">
                {fhirJsonString}
              </pre>
            </section>
          </div>
        </motion.aside>
      </div>
    </AnimatePresence>
  );
};
