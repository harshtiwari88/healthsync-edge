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
import {
  BrowserSpeechRecognition,
  createBrowserSpeechRecognition,
  parseClinicalTranscript,
  speakClinicalGuidance,
} from '../utils/speechEngine';

export interface SaheliFormPatch {
  vitals?: Partial<VitalsSnapshot>;
  symptoms?: SymptomKey[];
  clinicalNotes?: string;
  rawTranscript?: string;
}

interface ChatMessage {
  id: string;
  sender: 'bot' | 'asha';
  text: string;
  lang: 'hi-IN' | 'en-IN';
  appliedSummary?: string;
}

interface AshaSaheliModalProps {
  isOpen: boolean;
  audioMuted: boolean;
  onClose: () => void;
  onApplyFormPatch: (patch: SaheliFormPatch) => void;
}

const DEMO_CHIPS = [
  'BP 160/100 SpO2 88%',
  'Bukhar 102°F khansi',
  'Emergency First-Aid Steps',
] as const;

export const AshaSaheliModal: React.FC<AshaSaheliModalProps> = ({
  isOpen,
  audioMuted,
  onClose,
  onApplyFormPatch,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm-welcome',
      sender: 'bot',
      lang: 'hi-IN',
      text: 'नमस्ते सुनीता दीदी! मरीज़ का बीपी (जैसे BP 150 by 95), ऑक्सीजन (SpO2), बुखार या लक्षण बोलिए।',
    },
  ]);
  const [inputText, setInputText] = useState<string>('');
  const [liveInterim, setLiveInterim] = useState<string>('');
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(!audioMuted);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [speechStatusMsg, setSpeechStatusMsg] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  useEffect(() => {
    setTtsEnabled(!audioMuted);
  }, [audioMuted]);

  useEffect(() => {
    if (isOpen && ttsEnabled) {
      speakClinicalGuidance(
        'नमस्ते दीदी, मरीज़ के वाइटल्स और लक्षण बताइए।',
        'hi-IN',
        false
      );
    }
  }, [isOpen, ttsEnabled]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, liveInterim, isOpen]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const handleProcessInput = (utterance: string) => {
    const trimmed = utterance.trim();
    if (!trimmed) return;

    const parsed = parseClinicalTranscript(trimmed);
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'asha',
      lang: 'hi-IN',
      text: trimmed,
    };

    let botReply = '';
    let summary = '';

    if (parsed.isEmergencyFirstAidQuery) {
      botReply =
        'दीदी, आपातकालीन प्राथमिक उपचार: 1. मरीज़ को सहारा देकर आधा बिठाएं। 2. गले और छाती के कपड़े ढीले करें। 3. नीचे लाल बटन से तुरंत एन्क्रिप्टेड इमरजेंसी एसएमएस भेजें और 108 एम्बुलेंस बुलाएं।';
      summary = 'First-Aid Protocol Spoken Aloud';
      onApplyFormPatch({
        clinicalNotes: 'Emergency First-Aid stabilization steps initiated via ASHA Saheli.',
        rawTranscript: trimmed,
      });
    } else if (parsed.badges.length > 0) {
      onApplyFormPatch({
        vitals: parsed.vitalsPatch,
        symptoms: parsed.detectedSymptoms,
        clinicalNotes: `Voice Dictation: "${trimmed}"`,
        rawTranscript: trimmed,
      });
      summary = parsed.badges.map((b) => b.label).join(' · ');
      const hasCritical = parsed.badges.some((b) => b.tone === 'red');
      botReply = hasCritical
        ? `सावधान दीदी! ${summary} गंभीर खतरे का संकेत है। मैंने फॉर्म भर दिया है, कृपया तुरंत एन्क्रिप्टेड एसएमएस भेजें!`
        : `धन्यवाद दीदी! मैंने ${summary} मरीज़ के फॉर्म में दर्ज कर दिया है।`;
    } else {
      onApplyFormPatch({
        clinicalNotes: `Voice Note: "${trimmed}"`,
        rawTranscript: trimmed,
      });
      botReply =
        'दीदी, आपका नोट सुरक्षित कर लिया गया है। वाइटल्स भरने के लिए "BP 140 by 90" या "Oxygen 92" बोलें।';
      summary = 'Voice note saved';
    }

    const botMsg: ChatMessage = {
      id: `b-${Date.now() + 1}`,
      sender: 'bot',
      lang: 'hi-IN',
      text: botReply,
      appliedSummary: summary,
    };

    setMessages((prev) => [...prev, userMsg, botMsg]);
    setInputText('');
    setLiveInterim('');

    if (ttsEnabled) {
      speakClinicalGuidance(botReply, 'hi-IN', false);
    }
  };

  const toggleRealSpeechRecognition = () => {
    setSpeechStatusMsg(null);
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = createBrowserSpeechRecognition('hi-IN');
    if (!recognition) {
      setSpeechStatusMsg(
        'Web Speech API is not supported in this browser (use Chrome/Edge, or type/tap a test phrase below).'
      );
      return;
    }

    let finalSpoken = '';
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalSpoken += chunk + ' ';
        } else {
          interim += chunk;
        }
      }
      setLiveInterim((finalSpoken + interim).trim());
    };

    recognition.onerror = (ev) => {
      setIsListening(false);
      setSpeechStatusMsg(`Microphone recognition status: ${ev.error}. Check mic permissions.`);
    };

    recognition.onend = () => {
      setIsListening(false);
      if (finalSpoken.trim()) {
        handleProcessInput(finalSpoken.trim());
      }
    };

    try {
      recognitionRef.current = recognition;
      setIsListening(true);
      recognition.start();
    } catch {
      setIsListening(false);
      setSpeechStatusMsg('Could not start SpeechRecognition.');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 backdrop-blur-xs p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="asha-saheli-dialog-title"
        >
          <motion.div
            initial={{opacity: 0, scale: 0.95, y: 14}}
            animate={{opacity: 1, scale: 1, y: 0}}
            exit={{opacity: 0, scale: 0.95, y: 14}}
            transition={{type: 'spring', stiffness: 360, damping: 28}}
            className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
          >
            <div className="bg-[#0F172A] text-white px-5 py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-[#0D9488] flex items-center justify-center shrink-0">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h2 id="asha-saheli-dialog-title" className="text-base font-bold truncate">
                    ASHA Saheli Voice Assistant
                  </h2>
                  <p className="text-xs text-[#06B6D4] truncate">
                    Real Web Speech API + Hindi Audio Guidance
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const next = !ttsEnabled;
                    setTtsEnabled(next);
                    if (!next && 'speechSynthesis' in window) {
                      window.speechSynthesis.cancel();
                    }
                  }}
                  title={ttsEnabled ? 'Mute TTS Voice' : 'Unmute TTS Voice'}
                  className="min-h-[44px] min-w-[44px] rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer"
                >
                  {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close Voice Assistant"
                  className="min-h-[44px] min-w-[44px] rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-[#F8FAFC] min-h-[250px]"
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
                        ? 'bg-[#0F172A] text-white'
                        : 'bg-teal-100 text-[#0D9488]'
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
                        ? 'bg-[#0D9488] text-white rounded-tr-sm'
                        : 'bg-white border border-slate-200 text-slate-900 rounded-tl-sm shadow-2xs'
                    }`}
                  >
                    <p className="font-medium">{msg.text}</p>
                    {msg.sender === 'bot' && (
                      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        {msg.appliedSummary ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0D9488]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                            <span>{msg.appliedSummary}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">hi-IN SpeechSynthesis</span>
                        )}
                        <button
                          type="button"
                          onClick={() => speakClinicalGuidance(msg.text, msg.lang, false)}
                          className="px-2 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-[#0D9488] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Volume2 className="w-3 h-3" />
                          <span>Play</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {liveInterim && (
                <div className="rounded-2xl bg-teal-50 border border-teal-200 px-4 py-2.5 text-xs font-semibold text-teal-950">
                  Live Microphone Transcript: “{liveInterim}”
                </div>
              )}

              {speechStatusMsg && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                  {speechStatusMsg}
                </div>
              )}
            </div>

            <div className="px-4 py-3 bg-white border-t border-slate-200">
              <p className="text-[11px] font-bold text-slate-500 mb-2">
                Quick Voice Test Chips (Runs real regex parser + Hindi TTS):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {DEMO_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleProcessInput(chip)}
                    className="min-h-[38px] px-3 py-1.5 rounded-full border border-teal-200 bg-teal-50 hover:bg-teal-100 text-xs font-bold text-[#0D9488] transition-colors cursor-pointer"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleProcessInput(inputText);
              }}
              className="p-3 bg-slate-50 border-t border-slate-200 flex items-center gap-2"
            >
              <button
                type="button"
                onClick={toggleRealSpeechRecognition}
                aria-label="Start or stop microphone recognition"
                className={`min-h-[48px] min-w-[48px] rounded-xl flex items-center justify-center text-white transition-colors cursor-pointer shrink-0 ${
                  isListening ? 'bg-[#EF4444] animate-pulse' : 'bg-[#0D9488] hover:bg-teal-700'
                }`}
              >
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Speak via mic or type e.g. BP 140 by 90..."
                className="flex-1 min-h-[48px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900"
              />

              <button
                type="submit"
                aria-label="Submit phrase"
                className="min-h-[48px] min-w-[48px] rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white flex items-center justify-center cursor-pointer shrink-0"
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
