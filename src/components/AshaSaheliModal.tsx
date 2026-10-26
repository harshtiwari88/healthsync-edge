import React, {useEffect, useRef, useState} from 'react';
import {Mic, MicOff, Volume2, X} from 'lucide-react';
import {SymptomKey, VitalsSnapshot} from '../types/triage';
import {
  BrowserSpeechRecognition,
  createBrowserSpeechRecognition,
  DetectedEntityBadge,
  parseClinicalTranscript,
  speakClinicalGuidance,
} from '../utils/speechEngine';

interface ChatTurn {
  id: string;
  sender: 'saheli' | 'asha';
  text: string;
  badges?: DetectedEntityBadge[];
}

interface AshaSaheliModalProps {
  open: boolean;
  onClose: () => void;
  onApplyVoiceEntities: (
    vitalsPatch: Partial<VitalsSnapshot>,
    symptoms: SymptomKey[],
    transcript: string
  ) => void;
}

const VOICE_QUICK_PHRASES = [
  'BP 160/100 SpO2 88%',
  'Bukhar 102 khansi',
  'Emergency First-Aid',
];

export const AshaSaheliModal: React.FC<AshaSaheliModalProps> = ({
  open,
  onClose,
  onApplyVoiceEntities,
}) => {
  const [speechLang, setSpeechLang] = useState<'hi-IN' | 'en-IN'>('hi-IN');
  const [isListening, setIsListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [speechStatus, setSpeechStatus] = useState<string>('');
  const [turns, setTurns] = useState<ChatTurn[]>([
    {
      id: 'welcome',
      sender: 'saheli',
      text: 'Namaste Sunita Didi! Speak patient vitals in Hindi or English (e.g. "BP 160/100 SpO2 88%" or "Bukhar 102 khansi") to populate the triage form automatically.',
    },
  ]);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  useEffect(() => {
    if (!open && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore
      }
      setIsListening(false);
    }
  }, [open]);

  if (!open) return null;

  const processUtterance = (utteranceText: string) => {
    const clean = utteranceText.trim();
    if (!clean) return;

    const parsed = parseClinicalTranscript(clean);
    onApplyVoiceEntities(parsed.vitalsPatch, parsed.detectedSymptoms, clean);

    let replyText = '';
    if (parsed.isEmergencyFirstAidQuery) {
      replyText =
        'Emergency First-Aid Protocol: Keep patient seated upright at 45 degrees, loosen tight clothing, monitor SpO2 continuously, and dispatch the Encrypted Binary SMS immediately.';
    } else if (
      (parsed.vitalsPatch.systolic && parsed.vitalsPatch.systolic >= 160) ||
      (parsed.vitalsPatch.spo2 && parsed.vitalsPatch.spo2 < 90)
    ) {
      replyText =
        'CRITICAL RED ALERT detected! Vitals applied to form. Keep patient calm and upright, and save or send Emergency SMS right away.';
    } else if (Object.keys(parsed.vitalsPatch).length > 0 || parsed.detectedSymptoms.length > 0) {
      replyText =
        'Extracted vitals and symptoms into the patient form. Please verify values and save the record.';
    } else {
      replyText =
        'Clinical voice note captured. Say numbers like "BP 160/100 SpO2 88%" or "Bukhar 102" to extract vitals.';
    }

    setTurns((prev) => [
      ...prev,
      {id: `u-${Date.now()}`, sender: 'asha', text: clean, badges: parsed.badges},
      {id: `s-${Date.now() + 1}`, sender: 'saheli', text: replyText},
    ]);

    speakClinicalGuidance(replyText, speechLang, false);
  };

  const toggleMicrophone = () => {
    if (isListening && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore
      }
      setIsListening(false);
      return;
    }

    const recognition = createBrowserSpeechRecognition(speechLang);
    if (!recognition) {
      setSpeechStatus(
        'Web Speech API unavailable in this browser frame — tap a quick phrase or type below.'
      );
      return;
    }

    recognitionRef.current = recognition;
    setSpeechStatus('Listening via device microphone...');
    setLiveTranscript('');
    setIsListening(true);

    let latestTranscript = '';

    recognition.onresult = (event) => {
      let combined = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        combined += event.results[i][0].transcript;
      }
      latestTranscript = combined;
      setLiveTranscript(combined);
    };

    recognition.onerror = (err) => {
      setIsListening(false);
      setSpeechStatus(`Microphone status (${err.error}): Tap a quick phrase or type below.`);
    };

    recognition.onend = () => {
      setIsListening(false);
      setSpeechStatus('');
      if (latestTranscript.trim()) {
        processUtterance(latestTranscript);
      }
    };

    try {
      recognition.start();
    } catch {
      setIsListening(false);
      setSpeechStatus('Could not start microphone session. Tap a quick phrase below.');
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    processUtterance(manualInput);
    setLiveTranscript(manualInput);
    setManualInput('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="saheli-modal-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-3.5">
          <div>
            <h2 id="saheli-modal-title" className="text-base font-bold text-slate-100">
              ASHA Saheli Speech Assistant
            </h2>
            <p className="text-xs text-slate-400">Live BP, SpO2 &amp; Temperature Voice Parser</p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={speechLang}
              onChange={(e) => setSpeechLang(e.target.value as 'hi-IN' | 'en-IN')}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-200 focus:border-teal-500 focus:outline-none"
              aria-label="Speech Recognition Language"
            >
              <option value="hi-IN">हिन्दी (hi-IN)</option>
              <option value="en-IN">English (en-IN)</option>
            </select>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-100 cursor-pointer"
              aria-label="Close voice assistant"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Microphone Controls */}
        <div className="border-b border-slate-800 bg-slate-900/80 px-5 py-4">
          <button
            type="button"
            onClick={toggleMicrophone}
            className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition cursor-pointer ${
              isListening ? 'bg-red-600 hover:bg-red-500' : 'bg-teal-600 hover:bg-teal-500'
            }`}
          >
            {isListening ? (
              <>
                <MicOff className="h-4 w-4" />
                <span>Stop Microphone (Listening...)</span>
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" />
                <span>Start Voice Recognition</span>
              </>
            )}
          </button>

          {speechStatus && (
            <p className="mt-2 text-xs font-medium text-amber-300">{speechStatus}</p>
          )}

          {liveTranscript && (
            <p className="mt-2.5 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200">
              <strong className="text-teal-400">Live Transcript:</strong> “{liveTranscript}”
            </p>
          )}

          <div className="mt-3">
            <p className="mb-1.5 text-xs font-medium text-slate-400">Test Voice Phrases:</p>
            <div className="flex flex-wrap gap-1.5">
              {VOICE_QUICK_PHRASES.map((phrase) => (
                <button
                  key={phrase}
                  type="button"
                  onClick={() => {
                    setLiveTranscript(phrase);
                    processUtterance(phrase);
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-teal-300 transition hover:border-teal-500/60 hover:text-teal-200 cursor-pointer"
                >
                  “{phrase}”
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Conversation History */}
        <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {turns.map((turn) => (
            <div
              key={turn.id}
              className={`rounded-xl border p-3 text-xs leading-relaxed ${
                turn.sender === 'asha'
                  ? 'ml-6 border-teal-500/30 bg-teal-950/30 text-slate-100'
                  : 'mr-4 border-slate-800 bg-slate-950 text-slate-300'
              }`}
            >
              <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-400">
                <span>{turn.sender === 'asha' ? 'ASHA Worker' : 'ASHA Saheli'}</span>
                {turn.sender === 'saheli' && (
                  <button
                    type="button"
                    onClick={() => speakClinicalGuidance(turn.text, speechLang, false)}
                    className="inline-flex items-center gap-1 text-teal-400 hover:underline cursor-pointer"
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    <span>Audio</span>
                  </button>
                )}
              </div>
              <p>{turn.text}</p>
              {turn.badges && turn.badges.length > 0 && (
                <p className="mt-2 font-mono text-[11px] text-teal-300">
                  Parsed: {turn.badges.map((b) => b.label).join(' · ')}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Footer Form */}
        <form
          onSubmit={handleManualSubmit}
          className="flex items-center gap-2 border-t border-slate-800 bg-slate-950 px-4 py-3"
        >
          <input
            type="text"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="Type vitals phrase e.g. BP 160/100 SpO2 88%..."
            className="min-h-[42px] flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 focus:border-teal-500 focus:outline-none"
          />
          <button
            type="submit"
            className="min-h-[42px] rounded-xl border border-slate-700 bg-slate-800 px-3 text-xs font-semibold text-slate-100 hover:bg-slate-700 cursor-pointer"
          >
            Parse
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] rounded-xl bg-teal-600 px-3 text-xs font-bold text-white hover:bg-teal-500 cursor-pointer"
          >
            Done
          </button>
        </form>
      </div>
    </div>
  );
};
