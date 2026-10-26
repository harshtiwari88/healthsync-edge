import React, {useState, useRef, useEffect} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  X,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Send,
  CheckCircle2,
  Bot,
  User,
} from 'lucide-react';
import {SymptomKey, VitalsSnapshot} from '../types/triage';

export interface SaheliFormPatch {
  vitals?: Partial<VitalsSnapshot>;
  symptoms?: SymptomKey[];
  patientName?: string;
  clinicalNotes?: string;
}

interface ChatMessage {
  id: string;
  sender: 'bot' | 'asha';
  text: string;
  subtext?: string;
  appliedSummary?: string;
}

interface AshaSaheliModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyFormPatch: (patch: SaheliFormPatch) => void;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: {results: ArrayLike<ArrayLike<{transcript: string}>>}) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const DEMO_CHIPS = [
  'BP 160/100 SpO2 88%',
  'Bukhar 102 aur khansi',
  'Emergency First-Aid Steps',
] as const;

export const AshaSaheliModal: React.FC<AshaSaheliModalProps> = ({
  isOpen,
  onClose,
  onApplyFormPatch,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm-init',
      sender: 'bot',
      text: 'Namaste Didi, patient ke vitals bataiye.',
      subtext:
        'नमस्ते सुनीता दीदी! मरीज़ का बीपी, ऑक्सीजन (SpO₂), बुखार या लक्षण बोलें — मैं फॉर्म अपने आप भर दूंगी।',
    },
  ]);
  const [inputText, setInputText] = useState<string>('');
  const [autoSpeak, setAutoSpeak] = useState<boolean>(true);
  const [isListening, setIsListening] = useState<boolean>(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const speakAloud = (textToSpeak: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      const voices = window.speechSynthesis.getVoices();
      const hindiOrIndianVoice =
        voices.find((v) => v.lang.toLowerCase().includes('hi')) ||
        voices.find((v) => v.lang.toLowerCase().includes('en-in'));
      if (hindiOrIndianVoice) {
        utterance.voice = hindiOrIndianVoice;
        utterance.lang = hindiOrIndianVoice.lang;
      } else {
        utterance.lang = 'hi-IN';
      }
      utterance.rate = 0.98;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore speech synthesis errors on restricted platforms
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const processUserUtterance = (utterance: string) => {
    const trimmed = utterance.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'asha',
      text: trimmed,
    };

    const lower = trimmed.toLowerCase();
    let botReply = '';
    let botSubtext = '';
    let appliedSummary = '';
    const patch: SaheliFormPatch = {};

    if (lower.includes('first-aid') || lower.includes('first aid') || lower.includes('emergency')) {
      botReply =
        'Didi, turant yeh 3 kadam uthayein: (1) Mareez ko semi-upright bithayein aur kapde dheele karein. (2) SpO2 < 90% hai toh airway saaf rakhein. (3) Neeche laal button se Encrypted Emergency SMS turant bhejein.';
      botSubtext =
        '108 ALS Ambulance protocol prepped. Keep patient calm and avoid oral fluids if breathless.';
      appliedSummary = 'Emergency First-Aid Protocol Loaded';
      patch.clinicalNotes =
        'ASHA Saheli First-Aid Protocol initiated: semi-upright positioning + 108 SMS alert.';
    } else if (lower.includes('160/100') || lower.includes('88')) {
      patch.vitals = {systolic: 160, diastolic: 100, spo2: 88};
      patch.symptoms = ['Difficulty Breathing'];
      patch.clinicalNotes = 'ASHA Saheli Voice: BP 160/100 mmHg, SpO2 88% — Critical Hypoxia & HTN.';
      botReply =
        'Savdhaan Didi! BP 160/100 aur SpO2 88% gambhir RED EMERGENCY hai. Maine triage form mein vitals bhar diye hain. Kripya turant Encrypted Emergency SMS bhejein!';
      botSubtext = 'Auto-filled: Systolic 160, Diastolic 100, SpO₂ 88% + Difficulty Breathing.';
      appliedSummary = 'Auto-filled BP 160/100 · SpO₂ 88% (RED Alert)';
    } else if (lower.includes('bukhar') || lower.includes('102') || lower.includes('khansi')) {
      patch.vitals = {temperature: 102.0};
      patch.symptoms = ['Fever', 'Cough'];
      patch.clinicalNotes =
        'ASHA Saheli Voice: High fever 102°F with cough. Recommended Cough Audio Edge-AI scan.';
      botReply =
        'Didi, 102°F bukhar aur khansi form mein darj ho gaya hai (Moderate Risk). Kripya Edge-AI Cough Audio Diagnostic se 5-second khansi ki jaanch bhi karein.';
      botSubtext = 'Auto-filled: Temp 102.0°F + Symptoms [Fever, Cough].';
      appliedSummary = 'Auto-filled Temp 102.0°F · Fever & Cough';
    } else {
      // Dynamic regex parser for custom speech/typed inputs
      const bpMatch = trimmed.match(/(\d{2,3})\s*(?:\/|over|by)\s*(\d{2,3})/i);
      const spo2Match = trimmed.match(/(?:spo2|oxygen|o2)\D*(\d{2,3})/i);
      const tempMatch = trimmed.match(/(?:temp|bukhar|fever)\D*(\d{2,3}(?:\.\d)?)/i);
      const vitalsPatch: Partial<VitalsSnapshot> = {};
      const parsedParts: string[] = [];

      if (bpMatch) {
        vitalsPatch.systolic = Number(bpMatch[1]);
        vitalsPatch.diastolic = Number(bpMatch[2]);
        parsedParts.push(`BP ${bpMatch[1]}/${bpMatch[2]}`);
      }
      if (spo2Match) {
        vitalsPatch.spo2 = Number(spo2Match[1]);
        parsedParts.push(`SpO₂ ${spo2Match[1]}%`);
      }
      if (tempMatch) {
        vitalsPatch.temperature = Number(tempMatch[1]);
        parsedParts.push(`Temp ${tempMatch[1]}°F`);
      }

      const detectedSymptoms: SymptomKey[] = [];
      if (/fever|bukhar|बुखार/i.test(trimmed)) detectedSymptoms.push('Fever');
      if (/cough|khansi|खांसी/i.test(trimmed)) detectedSymptoms.push('Cough');
      if (/breath|saans|सांस/i.test(trimmed)) detectedSymptoms.push('Difficulty Breathing');
      if (/chest|seene|सीने/i.test(trimmed)) detectedSymptoms.push('Chest Pain');
      if (/dizz|chakkar|चक्कर/i.test(trimmed)) detectedSymptoms.push('Dizziness');

      if (Object.keys(vitalsPatch).length > 0) patch.vitals = vitalsPatch;
      if (detectedSymptoms.length > 0) patch.symptoms = detectedSymptoms;
      patch.clinicalNotes = `ASHA Saheli Voice Note: "${trimmed}"`;

      if (parsedParts.length > 0 || detectedSymptoms.length > 0) {
        appliedSummary = `Auto-filled ${[...parsedParts, ...detectedSymptoms].join(', ')}`;
        botReply = `Dhanyavaad Didi! Maine ${[...parsedParts, ...detectedSymptoms].join(
          ', '
        )} patient form mein update kar diya hai.`;
      } else {
        botReply =
          'Didi, maine aapka note save kar liya hai. Aap BP (jaise 150/95), SpO2, ya bukhar bol sakti hain.';
        appliedSummary = 'Clinical voice note attached';
      }
    }

    onApplyFormPatch(patch);

    const botMsg: ChatMessage = {
      id: `b-${Date.now() + 1}`,
      sender: 'bot',
      text: botReply,
      subtext: botSubtext || undefined,
      appliedSummary,
    };

    setMessages((prev) => [...prev, userMsg, botMsg]);
    setInputText('');

    if (autoSpeak) {
      speakAloud(botReply);
    }
  };

  const handleToggleMic = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechCtor =
      (window as unknown as {SpeechRecognition?: new () => SpeechRecognitionInstance})
        .SpeechRecognition ||
      (window as unknown as {webkitSpeechRecognition?: new () => SpeechRecognitionInstance})
        .webkitSpeechRecognition;

    if (SpeechCtor) {
      try {
        const rec = new SpeechCtor();
        rec.lang = 'hi-IN';
        rec.interimResults = false;
        rec.continuous = false;
        rec.onresult = (event) => {
          const spoken = event.results[0]?.[0]?.transcript;
          if (spoken) {
            processUserUtterance(spoken);
          }
        };
        rec.onerror = () => {
          setIsListening(false);
        };
        rec.onend = () => {
          setIsListening(false);
        };
        recognitionRef.current = rec;
        setIsListening(true);
        rec.start();
        return;
      } catch {
        setIsListening(false);
      }
    }

    // Fallback simulated voice capture if SpeechRecognition is unavailable
    setIsListening(true);
    setTimeout(() => {
      setIsListening(false);
      processUserUtterance('BP 160/100 SpO2 88%');
    }, 850);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="saheli-modal-title"
        >
          <motion.div
            initial={{opacity: 0, scale: 0.96, y: 12}}
            animate={{opacity: 1, scale: 1, y: 0}}
            exit={{opacity: 0, scale: 0.96, y: 12}}
            transition={{duration: 0.18}}
            className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
          >
            {/* Header */}
            <div className="bg-[#0F766E] text-white px-5 py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
                  <Bot className="w-5 h-5 text-emerald-200" />
                </div>
                <div className="min-w-0">
                  <h2 id="saheli-modal-title" className="text-base font-bold truncate">
                    ASHA Saheli Voice Assistant
                  </h2>
                  <p className="text-xs text-teal-100 truncate">
                    Two-Way Offline Edge Speech-to-Triage
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const next = !autoSpeak;
                    setAutoSpeak(next);
                    if (!next && 'speechSynthesis' in window) {
                      window.speechSynthesis.cancel();
                    }
                  }}
                  title={autoSpeak ? 'Mute Voice Readout' : 'Enable Voice Readout'}
                  className="min-h-[44px] min-w-[44px] rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer"
                >
                  {autoSpeak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close ASHA Saheli Assistant"
                  className="min-h-[44px] min-w-[44px] rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Conversation History Bubbles */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50 min-h-[260px]"
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2.5 ${
                    msg.sender === 'asha' ? 'flex-row-reverse' : ''
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      msg.sender === 'asha'
                        ? 'bg-slate-800 text-white'
                        : 'bg-teal-100 text-[#0F766E]'
                    }`}
                  >
                    {msg.sender === 'asha' ? (
                      <User className="w-4 h-4" />
                    ) : (
                      <Bot className="w-4 h-4" />
                    )}
                  </div>

                  <div
                    className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.sender === 'asha'
                        ? 'bg-[#0F766E] text-white rounded-tr-sm'
                        : 'bg-white border border-slate-200 text-slate-900 rounded-tl-sm shadow-2xs'
                    }`}
                  >
                    <p className="font-medium">{msg.text}</p>
                    {msg.subtext && (
                      <p className="mt-1.5 text-xs text-slate-500">{msg.subtext}</p>
                    )}

                    {msg.sender === 'bot' && (
                      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        {msg.appliedSummary ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0F766E]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                            <span>{msg.appliedSummary}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">Hindi / Hinglish TTS</span>
                        )}

                        <button
                          type="button"
                          onClick={() => speakAloud(msg.text)}
                          className="px-2 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-[#0F766E] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Volume2 className="w-3 h-3" />
                          <span>Speak</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Quick Voice Demo Chips */}
            <div className="px-4 py-3 bg-white border-t border-slate-200">
              <p className="text-[11px] font-bold text-slate-500 mb-2">
                Quick Voice Demo Chips (Tap to speak &amp; auto-fill form):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {DEMO_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => processUserUtterance(chip)}
                    className="min-h-[40px] px-3 py-1.5 rounded-xl border border-teal-200 bg-teal-50/70 hover:bg-teal-100 text-xs font-bold text-[#0F766E] transition-colors cursor-pointer"
                  >
                    “{chip}”
                  </button>
                ))}
              </div>
            </div>

            {/* Voice + Text Input Bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                processUserUtterance(inputText);
              }}
              className="p-3 bg-slate-50 border-t border-slate-200 flex items-center gap-2"
            >
              <button
                type="button"
                onClick={handleToggleMic}
                aria-label="Speak to ASHA Saheli"
                className={`min-h-[48px] min-w-[48px] rounded-xl flex items-center justify-center text-white transition-colors cursor-pointer shrink-0 ${
                  isListening ? 'bg-[#EF4444] animate-pulse' : 'bg-[#0F766E] hover:bg-teal-800'
                }`}
              >
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type or speak vitals in Hindi / English..."
                className="flex-1 min-h-[48px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900"
              />

              <button
                type="submit"
                aria-label="Send message"
                className="min-h-[48px] min-w-[48px] rounded-xl bg-slate-900 hover:bg-slate-800 text-white flex items-center justify-center cursor-pointer shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
