import React, {useEffect, useRef, useState} from 'react';
import {FileText, Info, Mic, MicOff, Volume2, X} from 'lucide-react';
import {EdgeAiDiagnostics, NetworkState, SymptomKey, VitalsSnapshot} from '../types/triage';
import {
  BrowserSpeechRecognition,
  createBrowserSpeechRecognition,
  DetectedEntityBadge,
  parseClinicalTranscript,
  speakClinicalGuidance,
} from '../utils/speechEngine';
import {safeReadJson} from '../utils/safeFetchJson';

interface ChatTurn {
  id: string;
  sender: 'saheli' | 'asha';
  text: string;
  badges?: DetectedEntityBadge[];
  isGemini?: boolean;
}

interface AshaSaheliModalProps {
  open: boolean;
  inline?: boolean;
  onClose: () => void;
  sessionToken: string;
  networkState: NetworkState;
  currentVitals: VitalsSnapshot;
  currentSymptoms: SymptomKey[];
  currentEdgeAi: EdgeAiDiagnostics;
  patientName: string;
  patientAge: number;
  onApplyVoiceEntities: (
    vitalsPatch: Partial<VitalsSnapshot>,
    symptoms: SymptomKey[],
    transcript: string
  ) => void;
}

const EXAMPLE_VOICE_PHRASES = [
  'BP 145/92 SpO2 94%',
  'Bukhar 101 khansi',
  'Emergency First-Aid',
];

export const AshaSaheliModal: React.FC<AshaSaheliModalProps> = ({
  open,
  inline = false,
  onClose,
  sessionToken,
  networkState,
  currentVitals,
  currentSymptoms,
  currentEdgeAi,
  patientName,
  patientAge,
  onApplyVoiceEntities,
}) => {
  const [speechLang, setSpeechLang] = useState<'hi-IN' | 'en-IN'>('en-IN');
  const [isListening, setIsListening] = useState(false);
  const [isCallingGemini, setIsCallingGemini] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [speechStatus, setSpeechStatus] = useState<string>('');
  const [turns, setTurns] = useState<ChatTurn[]>([
    {
      id: 'welcome',
      sender: 'saheli',
      text: 'Speak or type a patient’s readings in English or Hindi (for example, "BP 138/88 SpO2 97%") to fill in the checkup form automatically, or request a plain-language Care Summary for the doctor.',
    },
  ]);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stopActiveRecognition = () => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        // Ignore
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopActiveRecognition();
      abortControllerRef.current?.abort();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // Ignore
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!open && !inline && recognitionRef.current) {
      stopActiveRecognition();
      setIsListening(false);
    }
  }, [open, inline]);

  if (!open && !inline) return null;

  const processUtterance = (utteranceText: string) => {
    const clean = utteranceText.trim();
    if (!clean) return;

    const parsed = parseClinicalTranscript(clean);
    onApplyVoiceEntities(parsed.vitalsPatch, parsed.detectedSymptoms, clean);

    let replyText = '';
    if (parsed.isEmergencyFirstAidQuery) {
      replyText =
        'First-Aid Guidance: Help the patient sit upright comfortably, loosen tight clothing, keep checking breathing and oxygen, and contact the clinic doctor or 108 ambulance right away.';
    } else if (
      (parsed.vitalsPatch.systolic && parsed.vitalsPatch.systolic >= 160) ||
      (parsed.vitalsPatch.spo2 && parsed.vitalsPatch.spo2 < 90)
    ) {
      replyText =
        'Urgent readings added to the form. Help the patient rest upright and send an urgent referral to the hospital doctor immediately.';
    } else if (Object.keys(parsed.vitalsPatch).length > 0 || parsed.detectedSymptoms.length > 0) {
      replyText =
        'Added these vital signs and symptoms to the checkup form. Please review the numbers before saving.';
    } else {
      replyText =
        'Note saved. To fill vital signs automatically, include numbers such as "BP 130/84 SpO2 98%" or "Temperature 100.4".';
    }

    setTurns((prev) => [
      ...prev,
      {id: `u-${Date.now()}`, sender: 'asha', text: clean, badges: parsed.badges},
      {id: `s-${Date.now() + 1}`, sender: 'saheli', text: replyText},
    ]);

    speakClinicalGuidance(replyText, speechLang, false);
  };

  const handleRequestGeminiSummary = async () => {
    if (networkState === 'offline' || sessionToken === 'OFFLINE_LOCAL_SESSION') {
      setSpeechStatus(
        'Care Summary requires an internet connection. Your checkup form still works completely offline.'
      );
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsCallingGemini(true);
    setSpeechStatus('');

    try {
      const resp = await fetch('/api/gemini/clinical-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          patientName: patientName || 'Patient',
          age: patientAge,
          vitals: currentVitals,
          symptoms: currentSymptoms,
          edgeAi: currentEdgeAi,
          transcript: liveTranscript || undefined,
          language: speechLang === 'hi-IN' ? 'hi' : 'en',
        }),
      });
      const parsed = await safeReadJson<{
        error?: string;
        handoffSummary?: string;
        redFlags?: string[];
        stabilizationSteps?: string[];
        hindiGuidance?: string;
        disclaimer?: string;
      }>(resp);

      if (!isMountedRef.current) return;

      if (!parsed.isJson) {
        throw new Error(
          'Care Summary service is unavailable on this connection. Voice readings and local checkup guidance remain active.'
        );
      }

      const data = parsed.data || {};
      if (!resp.ok || !data.handoffSummary) {
        throw new Error(data.error || 'Could not generate Care Summary right now.');
      }

      const formatted = [
        `Doctor Handoff Summary:\n${data.handoffSummary}`,
        data.redFlags && data.redFlags.length > 0
          ? `Key Signs to Watch:\n• ${data.redFlags.join('\n• ')}`
          : '',
        data.stabilizationSteps && data.stabilizationSteps.length > 0
          ? `Recommended Care Steps:\n• ${data.stabilizationSteps.join('\n• ')}`
          : '',
        data.hindiGuidance ? `हिन्दी मार्गदर्शन:\n${data.hindiGuidance}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      setTurns((prev) => [
        ...prev,
        {
          id: `gem-${Date.now()}`,
          sender: 'saheli',
          text: formatted,
          isGemini: true,
        },
      ]);

      if (data.hindiGuidance && speechLang === 'hi-IN') {
        speakClinicalGuidance(data.hindiGuidance, 'hi-IN', false);
      } else {
        speakClinicalGuidance(data.handoffSummary, 'en-IN', false);
      }
    } catch (err) {
      if (!isMountedRef.current || (err instanceof Error && err.name === 'AbortError')) return;
      setSpeechStatus(err instanceof Error ? err.message : 'Care Summary request failed.');
    } finally {
      if (isMountedRef.current) {
        setIsCallingGemini(false);
      }
    }
  };

  const toggleMicrophone = () => {
    if (isListening && recognitionRef.current) {
      stopActiveRecognition();
      setIsListening(false);
      return;
    }

    const recognition = createBrowserSpeechRecognition(speechLang);
    if (!recognition) {
      setSpeechStatus(
        'Voice input is not supported in this browser. You can type readings below or tap an example phrase.'
      );
      return;
    }

    stopActiveRecognition();
    recognitionRef.current = recognition;
    setSpeechStatus('Listening... Speak clearly into your microphone.');
    setLiveTranscript('');
    setIsListening(true);

    let latestTranscript = '';

    recognition.onresult = (event) => {
      if (!isMountedRef.current) return;
      let combined = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        combined += event.results[i][0].transcript;
      }
      latestTranscript = combined;
      setLiveTranscript(combined);
    };

    recognition.onerror = (err) => {
      if (!isMountedRef.current) return;
      setIsListening(false);
      setSpeechStatus(`Microphone unavailable (${err.error}). Type readings below instead.`);
    };

    recognition.onend = () => {
      if (!isMountedRef.current) return;
      setIsListening(false);
      setSpeechStatus('');
      if (latestTranscript.trim()) {
        processUtterance(latestTranscript);
      }
    };

    try {
      recognition.start();
    } catch {
      if (!isMountedRef.current) return;
      setIsListening(false);
      setSpeechStatus('Could not start microphone. Type readings below instead.');
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    processUtterance(manualInput);
    setLiveTranscript(manualInput);
    setManualInput('');
  };

  const panelBody = (
    <div
      className={
        inline
          ? 'flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden'
          : 'flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-lg'
      }
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
        <div>
          <h2 id="saheli-modal-title" className="text-base font-bold text-slate-900">
            Voice Input &amp; Care Summary Helper
          </h2>
          <p className="text-xs text-slate-600">
            Speak patient readings to fill the form faster or prepare a doctor summary
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={speechLang}
            onChange={(e) => setSpeechLang(e.target.value as 'hi-IN' | 'en-IN')}
            className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-teal-700 focus:outline-none"
            aria-label="Voice Language"
          >
            <option value="en-IN">English (India)</option>
            <option value="hi-IN">हिन्दी (Hindi)</option>
          </select>

          {!inline && (
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
              aria-label="Close voice helper"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Primary Voice & Summary Actions */}
      <div className="space-y-3 border-b border-slate-200 bg-slate-50/70 px-5 py-4">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            onClick={toggleMicrophone}
            className={`flex min-h-[46px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors whitespace-nowrap cursor-pointer ${
              isListening ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-700 hover:bg-teal-800'
            }`}
          >
            {isListening ? (
              <>
                <MicOff className="h-4 w-4 shrink-0" />
                <span>Stop Listening</span>
              </>
            ) : (
              <>
                <Mic className="h-4 w-4 shrink-0" />
                <span>Speak Vital Signs</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleRequestGeminiSummary}
            disabled={isCallingGemini || networkState === 'offline'}
            className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <FileText className="h-4 w-4 shrink-0 text-teal-700" />
            <span>{isCallingGemini ? 'Preparing Summary...' : 'Prepare Doctor Summary'}</span>
          </button>
        </div>

        {speechStatus && (
          <p role="status" className="text-xs font-medium text-amber-800">
            {speechStatus}
          </p>
        )}

        {liveTranscript && (
          <p className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-700">
            <strong className="font-semibold text-slate-900">Heard:</strong> “{liveTranscript}”
          </p>
        )}

        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-600">Try a quick phrase:</p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_VOICE_PHRASES.map((phrase) => (
              <button
                key={phrase}
                type="button"
                onClick={() => {
                  setLiveTranscript(phrase);
                  processUtterance(phrase);
                }}
                className="min-h-[34px] rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-teal-600/40 hover:text-teal-800 cursor-pointer"
              >
                “{phrase}”
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto px-5 py-4 max-h-[360px]">
        {turns.map((turn) => (
          <div
            key={turn.id}
            className={`rounded-xl border p-3.5 text-sm leading-relaxed whitespace-pre-line ${
              turn.sender === 'asha'
                ? 'ml-6 border-teal-200 bg-teal-50/60 text-slate-900'
                : 'mr-4 border-slate-200 bg-slate-50/70 text-slate-800'
            }`}
          >
            <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">
              <span>
                {turn.sender === 'asha'
                  ? 'You said'
                  : turn.isGemini
                  ? 'Care Summary (Decision Support)'
                  : 'Care Helper'}
              </span>
              {turn.sender === 'saheli' && (
                <button
                  type="button"
                  onClick={() => speakClinicalGuidance(turn.text, speechLang, false)}
                  className="inline-flex items-center gap-1 text-teal-700 hover:underline cursor-pointer"
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  <span>Read Aloud</span>
                </button>
              )}
            </div>
            <p>{turn.text}</p>
            {turn.badges && turn.badges.length > 0 && (
              <p className="mt-2 text-xs font-medium text-teal-800">
                Filled into form: {turn.badges.map((b) => b.label).join(' · ')}
              </p>
            )}
          </div>
        ))}

        <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <span>
            Decision-support summaries assist handoff to a licensed doctor and are not a medical
            diagnosis.
          </span>
        </div>
      </div>

      {/* Manual Text Entry */}
      <form
        onSubmit={handleManualSubmit}
        className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3"
      >
        <input
          type="text"
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          placeholder="Or type readings e.g. BP 140/90 SpO2 96%"
          className="min-h-[44px] min-w-[180px] flex-1 rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
        />
        <button
          type="submit"
          className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
        >
          Fill Form
        </button>
        {!inline && (
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 cursor-pointer"
          >
            Done
          </button>
        )}
      </form>
    </div>
  );

  if (inline) {
    return panelBody;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="saheli-modal-title"
    >
      {panelBody}
    </div>
  );
};
