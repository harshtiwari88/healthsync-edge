import React, {useState} from 'react';
import {CheckCircle2, IndianRupee, Send, ShieldCheck, X} from 'lucide-react';
import {IncentiveEntry} from '../types/triage';

interface IncentiveLedgerModalProps {
  open: boolean;
  onClose: () => void;
  entries: IncentiveEntry[];
}

export const IncentiveLedgerModal: React.FC<IncentiveLedgerModalProps> = ({
  open,
  onClose,
  entries,
}) => {
  const [submittedToBmo, setSubmittedToBmo] = useState(false);

  if (!open) return null;

  const totalEarned = entries.reduce((sum, item) => sum + item.amountInr, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="incentive-modal-title"
    >
      <div className="max-h-[85vh] w-full max-w-md flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600/20 text-teal-400">
              <IndianRupee className="h-5 w-5" />
            </div>
            <div>
              <h2 id="incentive-modal-title" className="text-base font-bold text-slate-100">
                Mera Incentive Ledger
              </h2>
              <p className="text-xs text-slate-400">
                Sunita Devi · +₹50 High Risk · +₹20 NCD Screening
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-400 transition hover:text-slate-100 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Summary Strip */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-emerald-950/30 px-5 py-3.5">
          <div>
            <p className="text-xs font-medium text-emerald-400">Daily Verified Total</p>
            <p className="mt-0.5 text-2xl font-bold text-slate-100 tabular-nums">
              ₹{totalEarned}{' '}
              <span className="text-xs font-normal text-slate-400">Earned Today</span>
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
            ABDM Verified
          </span>
        </div>

        {/* Scrollable Entries */}
        <div className="custom-scrollbar flex-1 divide-y divide-slate-800/80 overflow-y-auto px-5 py-2">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between py-3">
              <div className="pr-3">
                <p className="text-sm font-semibold text-slate-100">{entry.taskTitle}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {entry.patientRef} · <span className="font-mono">{entry.programCode}</span> ·{' '}
                  {entry.timestamp}
                </p>
              </div>
              <span className="shrink-0 font-mono text-sm font-bold text-emerald-400 tabular-nums">
                +₹{entry.amountInr}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 bg-slate-950 px-5 py-4">
          {submittedToBmo ? (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/50 px-4 py-3 text-xs font-semibold text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>Voucher submitted to Block Medical Officer (BMO) for PFMS payout.</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSubmittedToBmo(true)}
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-teal-500 cursor-pointer"
            >
              <Send className="h-4 w-4" />
              <span>Submit Claim to BMO (₹{totalEarned})</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
