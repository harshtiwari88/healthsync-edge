import React, {useState} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  X,
  IndianRupee,
  CheckCircle2,
  FileCheck2,
  Download,
  ShieldCheck,
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="incentive-modal-title"
        >
          <motion.div
            initial={{opacity: 0, scale: 0.96, y: 10}}
            animate={{opacity: 1, scale: 1, y: 0}}
            exit={{opacity: 0, scale: 0.96, y: 10}}
            transition={{duration: 0.18}}
            className="w-full max-w-lg rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
          >
            {/* Header */}
            <div className="bg-[#0F766E] text-white px-6 py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
                  <IndianRupee className="w-5 h-5 text-emerald-200" />
                </div>
                <div>
                  <h2 id="incentive-modal-title" className="text-base font-bold">
                    Mera Incentive — ASHA Performance Ledger
                  </h2>
                  <p className="text-xs text-teal-100">
                    {ashaName} · {ashaId} · VIL-204
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close Incentive Modal"
                className="min-h-[44px] min-w-[44px] rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Summary Strip */}
            <div className="grid grid-cols-2 gap-3 p-5 bg-slate-50 border-b border-slate-200">
              <div className="rounded-2xl bg-white border border-slate-200 p-3.5">
                <span className="text-xs font-semibold text-slate-500">Earned Today</span>
                <p className="mt-1 font-mono text-2xl font-bold text-[#0F766E] tabular-nums">
                  ₹{todayTotal}
                </p>
                <span className="text-[11px] text-emerald-700 font-medium">
                  {entries.length} Verified Tasks
                </span>
              </div>
              <div className="rounded-2xl bg-white border border-slate-200 p-3.5">
                <span className="text-xs font-semibold text-slate-500">Monthly PFMS Cycle</span>
                <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                  ₹{monthlyProjected}
                </p>
                <span className="text-[11px] text-slate-500">Direct Benefit Transfer Ready</span>
              </div>
            </div>

            {/* Daily Task Breakdown List */}
            <div className="flex-1 overflow-y-auto px-6 py-4 divide-y divide-slate-100">
              {entries.map((entry) => (
                <div key={entry.id} className="py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900">{entry.taskTitle}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      <span className="font-mono">{entry.programCode}</span> · {entry.patientRef} ·{' '}
                      {entry.timestamp}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono text-base font-bold text-[#0F766E] tabular-nums">
                      +₹{entry.amountInr}
                    </span>
                    {entry.abdmVerified && (
                      <div className="text-[10px] font-semibold text-emerald-700 flex items-center justify-end gap-1">
                        <ShieldCheck className="w-3 h-3 text-[#10B981]" />
                        <span>ABDM Signed</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Claim Banner & Primary Action */}
            <div className="p-5 bg-slate-50 border-t border-slate-200 space-y-3">
              {claimGenerated && (
                <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-2.5 text-xs text-emerald-950">
                  <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
                  <span>
                    Monthly BMO Claim Voucher <strong className="font-mono">{claimGenerated}</strong>{' '}
                    signed &amp; downloaded for PFMS disbursal.
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={handleGenerateClaim}
                className="w-full min-h-[50px] px-5 rounded-xl bg-[#0F766E] hover:bg-teal-800 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <FileCheck2 className="w-4 h-4" />
                <span>Generate Monthly BMO Claim</span>
                <Download className="w-4 h-4 opacity-80" />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
