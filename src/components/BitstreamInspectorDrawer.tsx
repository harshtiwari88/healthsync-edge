import React, {useState} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  Terminal,
  ChevronUp,
  ChevronDown,
  Copy,
  Check,
  GitMerge,
  Binary,
  ShieldCheck,
} from 'lucide-react';
import {
  EdgeAiDiagnostics,
  SeverityLevel,
  SymptomKey,
  VitalsSnapshot,
} from '../types/triage';
import {
  computeCrc32,
  encodeVitalsToSMS,
  serializeVitalsBitfields,
} from '../utils/binarySmsCodec';
import {CrdtVectorClock} from '../utils/deviceTelemetry';

interface BitstreamInspectorDrawerProps {
  patientId: string;
  villageCode: string;
  vitals: VitalsSnapshot;
  symptoms: SymptomKey[];
  edgeAi?: EdgeAiDiagnostics;
  severity: SeverityLevel;
  crdtClock: CrdtVectorClock;
  connectedPeers: number;
}

export const BitstreamInspectorDrawer: React.FC<BitstreamInspectorDrawerProps> = ({
  patientId,
  villageCode,
  vitals,
  symptoms,
  edgeAi,
  severity,
  crdtClock,
  connectedPeers,
}) => {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [copiedPacket, setCopiedPacket] = useState<boolean>(false);

  const registers = serializeVitalsBitfields({
    patientId,
    villageCode,
    vitals,
    symptoms,
    edgeAi,
    severity,
    crdtNodeId: crdtClock.nodeId,
    crdtSeq: crdtClock.seq,
  });

  const packet160 = encodeVitalsToSMS({
    patientId,
    villageCode,
    vitals,
    symptoms,
    edgeAi,
    severity,
    crdtNodeId: crdtClock.nodeId,
    crdtSeq: crdtClock.seq,
  });

  const rawEncoder = new TextEncoder().encode(packet160.slice(4));
  const packetCrcHex = `0x${computeCrc32(rawEncoder)
    .toString(16)
    .toUpperCase()
    .padStart(8, '0')}`;

  const handleCopyPacket = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(packet160);
    setCopiedPacket(true);
    setTimeout(() => setCopiedPacket(false), 1800);
  };

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-800 bg-[#090D16]/95 backdrop-blur-md">
      {/* Collapsed Persistent Bottom Telemetry Handle */}
      <div className="max-w-[1440px] mx-auto px-3 sm:px-5 h-10 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="flex items-center gap-2.5 text-left min-w-0 flex-1 h-full cursor-pointer group"
        >
          <Terminal className="w-4 h-4 text-[#06B6D4] shrink-0" />
          <span className="font-mono text-xs font-semibold text-slate-200 whitespace-nowrap shrink-0">
            Bitstream &amp; Protocol Inspector
          </span>
          <span className="hidden md:inline font-mono text-[11px] text-slate-500 truncate">
            · node_id: <span className="text-[#F59E0B]">{crdtClock.nodeId}</span>, seq:{' '}
            <span className="text-[#06B6D4] tabular-nums">{crdtClock.seq}</span> ·{' '}
            {packet160.length}-char Base64 SMS · CRC32 {packetCrcHex}
          </span>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-white shrink-0 ml-auto" />
          ) : (
            <ChevronUp className="w-4 h-4 text-slate-400 group-hover:text-white shrink-0 ml-auto" />
          )}
        </button>

        <button
          type="button"
          onClick={handleCopyPacket}
          className="h-7 px-2.5 rounded bg-[#11192C] hover:bg-slate-800 border border-slate-700 font-mono text-[11px] text-[#06B6D4] inline-flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap"
        >
          {copiedPacket ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span>Copied 160B</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy SMS Packet</span>
            </>
          )}
        </button>
      </div>

      {/* Slide-Out Expanded Bitstream Serialization & CRDT Console */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{opacity: 0, y: 12}}
            animate={{opacity: 1, y: 0}}
            exit={{opacity: 0, y: 12}}
            transition={{duration: 0.16}}
            className="border-t border-slate-800 bg-[#070B13] max-h-[58vh] overflow-y-auto"
          >
            <div className="max-w-[1440px] mx-auto p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left 6 Cols: Live Bit-Level Hardware Register Serialization */}
              <div className="lg:col-span-6 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5">
                    <Binary className="w-3.5 h-3.5 text-[#06B6D4]" />
                    Real-Time Binary Register Serialization
                  </span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    Big-Endian Network Byte Order
                  </span>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0B101C] divide-y divide-slate-800/80 font-mono text-[11px]">
                  {registers.map((reg) => (
                    <div
                      key={reg.registerName}
                      className="px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="min-w-[155px]">
                        <span className="text-slate-400 block text-[10px]">
                          {reg.registerName}
                        </span>
                        <span className="text-slate-200 font-semibold">
                          {reg.fieldLabel}: <span className="text-[#F59E0B]">{reg.rawValue}</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-2 ml-auto tabular-nums">
                        <div className="flex items-center gap-0.5">
                          {reg.binaryString.split('').map((ch, idx) =>
                            ch === ' ' ? (
                              <span key={idx} className="w-1.5" />
                            ) : (
                              <span
                                key={idx}
                                className={`w-4 h-5 rounded-xs flex items-center justify-center text-[10px] border ${
                                  ch === '1'
                                    ? 'bg-[#06B6D4]/20 border-[#06B6D4]/60 text-[#06B6D4] font-bold'
                                    : 'bg-[#090D16] border-slate-800 text-slate-600'
                                }`}
                              >
                                {ch}
                              </span>
                            )
                          )}
                        </div>
                        <span className="text-slate-400 w-14 text-right">{reg.hexValue}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right 6 Cols: 160-Char Compressed Base64 SMS Packet + CRDT Vector Clock */}
              <div className="lg:col-span-6 space-y-4">
                {/* 160-Char GSM-7 Base64 Packet */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#F59E0B]" />
                      Compressed GSM-7 Base64 SMS Frame (Single Segment)
                    </span>
                    <span className="font-mono text-[11px] text-[#06B6D4] tabular-nums">
                      {packet160.length} / 160 chars · CRC32 {packetCrcHex}
                    </span>
                  </div>

                  <div className="rounded-lg border border-slate-800 bg-[#0B101C] p-3 font-mono text-xs text-[#06B6D4] break-all leading-relaxed select-all">
                    <span className="text-[#F59E0B] font-bold">HS3#</span>
                    {packet160.slice(4)}
                  </div>
                </div>

                {/* CRDT Vector Clock Synchronization States */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5">
                      <GitMerge className="w-3.5 h-3.5 text-[#06B6D4]" />
                      CRDT LWW-Element-Set Vector Clock State
                    </span>
                    <span className="font-mono text-[11px] text-emerald-400 tabular-nums">
                      {connectedPeers} Active Peer{connectedPeers === 1 ? '' : 's'} · CONVERGED
                    </span>
                  </div>

                  <div className="rounded-lg border border-slate-800 bg-[#0B101C] p-3 font-mono text-xs space-y-2">
                    <div className="flex items-center justify-between text-[#F59E0B]">
                      <span>
                        local_clock &rarr; node_id: {crdtClock.nodeId}, seq: {crdtClock.seq}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {crdtClock.lastMergedIso.slice(11, 19)}Z
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-[11px] tabular-nums">
                      {Object.entries(crdtClock.peers).map(([peerNode, peerSeq]) => (
                        <div
                          key={peerNode}
                          className="rounded bg-[#090D16] border border-slate-800 px-2.5 py-1.5"
                        >
                          <span className="block text-[10px] text-slate-500 truncate">
                            {peerNode}
                          </span>
                          <span className="text-slate-200 font-bold">seq: {peerSeq}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
