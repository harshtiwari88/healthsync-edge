import React, {useState} from 'react';
import {CheckCircle2, ClipboardCheck, IndianRupee, Send, ShieldCheck, X} from 'lucide-react';
import {IncentiveEntry} from '../types/triage';

interface IncentiveLedgerModalProps {
  open: boolean;
  inline?: boolean;
  workerName?: string;
  onClose: () => void;
  onStartCheckup?: () => void;
  entries: IncentiveEntry[];
}

export const IncentiveLedgerModal: React.FC<IncentiveLedgerModalProps> = ({
  open,
  inline = false,
  workerName,
  onClose,
  onStartCheckup,
  entries = [],
}) => {
  const [submittedToBmo, setSubmittedToBmo] = useState(false);

  if (!open && !inline) return null;

  const safeEntries = Array.isArray(entries) ? entries : [];
  const totalEarned = safeEntries.reduce((sum, item) => sum + (Number(item?.amountInr) || 0), 0);

  const content = (
    <div
      className={
        inline
          ? 'flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden'
          : 'flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-lg'
      }
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <IndianRupee className="h-5 w-5" />
          </div>
          <div>
            <h2 id="incentive-modal-title" className="text-base font-bold text-slate-900">
              Completed Visits &amp; Stipend Log
            </h2>
            <p className="text-xs text-slate-600">
              {workerName ? `${workerName} · ` : ''}NHM community health visit log
            </p>
          </div>
        </div>
        {!inline && (
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
            aria-label="Close activity log"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Summary Strip */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
        <div>
          <p className="text-xs font-medium text-slate-600">Recorded Health Stipend</p>
          <p className="mt-0.5 text-2xl font-bold text-slate-900 tabular-nums">
            ₹{totalEarned}{' '}
            <span className="text-xs font-normal text-slate-500">
              across {safeEntries.length} {safeEntries.length === 1 ? 'visit' : 'visits'}
            </span>
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <ShieldCheck className="h-4 w-4" />
          <span>Verified Log</span>
        </span>
      </div>

      {/* Entries or Honest Empty State */}
      {safeEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <ClipboardCheck className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-sm font-semibold text-slate-900">No visits logged yet</h3>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-600">
            Each time you complete and save a patient health checkup, your verified NHM visit entry
            will appear here automatically.
          </p>
          {onStartCheckup && (
            <button
              type="button"
              onClick={onStartCheckup}
              className="mt-4 min-h-[42px] rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer"
            >
              Start a Patient Checkup
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="custom-scrollbar flex-1 divide-y divide-slate-100 overflow-y-auto px-5 py-2 max-h-[340px]">
            {safeEntries.map((entry, idx) => (
              <div
                key={entry?.id || `inc-row-${idx}`}
                className="flex items-center justify-between gap-3 py-3.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {entry?.taskTitle || 'Community Health Visit'}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 truncate">
                    {entry?.patientRef || 'Patient Checkup'} · {entry?.programCode || 'NHM-VISIT'} ·{' '}
                    {entry?.timestamp || 'Just now'}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-sm font-semibold text-emerald-700 tabular-nums">
                  +₹{Number(entry?.amountInr) || 0}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
            {submittedToBmo ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                <span>Summary marked ready for Block Medical Officer review.</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSubmittedToBmo(true)}
                className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-800 cursor-pointer"
              >
                <Send className="h-4 w-4" />
                <span>Submit Visit Summary (₹{totalEarned})</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  if (inline) {
    return content;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="incentive-modal-title"
    >
      {content}
    </div>
  );
};
