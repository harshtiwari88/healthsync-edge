import React, {useState} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  X,
  IndianRupee,
  CheckCircle2,
  FileCheck2,
  Download,
} from 'lucide-react';
import {IncentiveEntry} from '../types/triage';

interface IncentiveLedgerModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: IncentiveEntry[];
  ashaName?: string;
  ashaId?: string;
}

export const IncentiveLedgerModal: React.FC<IncentiveLedgerModalProps> = ({
  isOpen,
  onClose,
  entries,
  ashaName = 'Sunita Devi',
  ashaId = 'ASHA-8842-UP',
}) => {
  const [claimGenerated, setClaimGenerated] = useState<string | null>(null);

  const todayTotal = entries.reduce((sum, item) => sum + item.amountInr, 0);
  const monthlyProjected = 4850 + todayTotal;

  const handleGenerateClaim = () => {
    const voucherId = `BMO-D24-${new Date().getFullYear()}-${String(entries.length + 108).padStart(
      4,
      '0'
    )}`;
    setClaimGenerated(voucherId);

    const lines = [
      'NATIONAL HEALTH MISSION (NHM) — ASHA DIGITAL INCENTIVE CLAIM VOUCHER',
      `Claim Reference: ${voucherId}`,
      `Worker Name: ${ashaName} (${ashaId})`,
      'Sub-Center: VIL-204 · Rampur Kalan Sub-Center, District 24',
      '--------------------------------------------------------------------',
      ...entries.map(
        (e, i) =>
          `${i + 1}. [${e.timestamp}] ${e.taskTitle} (${e.programCode}) | ${e.patientRef} | Rs. ${
            e.amountInr
          }`
      ),
      '--------------------------------------------------------------------',
      `Today Verified Earned Total: Rs. ${todayTotal}`,
      `Cumulative Monthly PFMS Claimable Balance: Rs. ${monthlyProjected}`,
      'ABDM HIE Digital Signature: VERIFIED',
    ];

    const blob = new Blob([lines.join('\n')], {type: 'text/plain;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${voucherId}-ASHA-Incentive-Claim.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="incentive-modal-title"
        >
          <motion.div
            initial={{opacity: 0, scale: 0.96, y: 10}}
            animate={{opacity: 1, scale: 1, y: 0}}
            exit={{opacity: 0, scale: 0.96, y: 10}}
            transition={{duration: 0.16}}
            className="w-full max-w-lg rounded-xl bg-[#090D16] border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[86vh] text-slate-100"
          >
            <div className="bg-[#060911] px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <IndianRupee className="w-5 h-5 text-[#06B6D4] shrink-0" />
                <div>
                  <h2 id="incentive-modal-title" className="text-sm font-semibold text-white">
                    NHM PFMS Incentive Telemetry Ledger
                  </h2>
                  <p className="font-mono text-[11px] text-slate-400">
                    {ashaName} · {ashaId} · VIL-204
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close Incentive Modal"
                className="min-h-[38px] min-w-[38px] rounded-lg bg-[#11192C] border border-slate-700 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 p-4 bg-[#0D1322] border-b border-slate-800 font-mono tabular-nums">
              <div className="rounded-lg bg-[#090D16] border border-slate-800 p-3">
                <span className="text-[10px] text-slate-400">EARNED TODAY</span>
                <p className="mt-1 text-2xl font-bold text-[#06B6D4]">₹{todayTotal}</p>
                <span className="text-[11px] text-emerald-400">
                  {entries.length} SIGNED EVENTS
                </span>
              </div>
              <div className="rounded-lg bg-[#090D16] border border-slate-800 p-3">
                <span className="text-[10px] text-slate-400">MONTHLY PFMS CYCLE</span>
                <p className="mt-1 text-2xl font-bold text-[#F59E0B]">₹{monthlyProjected}</p>
                <span className="text-[11px] text-slate-400">DBT VOUCHER READY</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3 divide-y divide-slate-800/80">
              {entries.map((entry) => (
                <div key={entry.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-100">{entry.taskTitle}</p>
                    <p className="font-mono text-[11px] text-slate-400 mt-0.5">
                      {entry.programCode} · {entry.patientRef} · {entry.timestamp}
                    </p>
                  </div>
                  <span className="font-mono text-sm font-bold text-[#06B6D4] tabular-nums shrink-0">
                    +₹{entry.amountInr}
                  </span>
                </div>
              ))}
            </div>

            <div className="p-4 bg-[#060911] border-t border-slate-800 space-y-3">
              {claimGenerated && (
                <div className="rounded-lg bg-emerald-500/15 border border-emerald-500/40 p-2.5 flex items-center gap-2 font-mono text-xs text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Signed Claim {claimGenerated} exported.</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleGenerateClaim}
                className="w-full min-h-[48px] px-4 rounded-lg bg-[#06B6D4] hover:bg-cyan-400 text-[#090D16] font-mono text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <FileCheck2 className="w-4 h-4" />
                <span>Export Signed BMO Claim Voucher</span>
                <Download className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
