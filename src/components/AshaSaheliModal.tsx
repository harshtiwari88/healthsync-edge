import React, {useState, useRef, useEffect} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  X,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
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

const DEMO_VOICE_STREAMS = [
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
      text: 'नमस्ते सुनीता दीदी! मरीज़ का बीपी (BP 150 by 95), ऑक्सीजन (SpO2), बुखार या लक्षण बोलिए।',
    },
  ]);
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
        'दीदी, आपातकालीन प्रोटोकॉल: 1. मरीज़ को सहारा देकर आधा बिठाएं। 2. श्वास मार्ग खुला रखें। 3. तुरंत 160-बाइट इमरजेंसी एसएमएस ट्रांसमिट करें।';
      summary = 'Emergency Stabilization Protocol';
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
        ? `सावधान दीदी! ${summary} गंभीर खतरे का संकेत है। वाइटल्स टेलीमेट्री अपडेट कर दिया गया है!`
        : `धन्यवाद दीदी! ${summary} टेलीमेट्री कंट्रोलर में दर्ज कर दिया गया है।`;
    } else {
      onApplyFormPatch({
        clinicalNotes: `Voice Note: "${trimmed}"`,
        rawTranscript: trimmed,
      });
      botReply =
        'दीदी, आपका नोट सुरक्षित कर लिया गया है। वाइटल्स के लिए "BP 140 by 90" बोलें।';
      summary = 'Voice telemetry logged';
    }

    const botMsg: ChatMessage = {
      id: `b-${Date.now() + 1}`,
      sender: 'bot',
      lang: 'hi-IN',
      text: botReply,
      appliedSummary: summary,
    };

    setMessages((prev) => [...prev, userMsg, botMsg]);
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
        'Web Speech API unavailable here — tap a Voice Stream Trigger below.'
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
      setSpeechStatusMsg(`Speech status: ${ev.error}`);
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
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="asha-saheli-dialog-title"
        >
          <motion.div
            initial={{opacity: 0, scale: 0.96, y: 10}}
            animate={{opacity: 1, scale: 1, y: 0}}
            exit={{opacity: 0, scale: 0.96, y: 10}}
            transition={{duration: 0.16}}
            className="w-full max-w-md rounded-xl bg-[#090D16] border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[85vh] text-slate-100"
          >
            <div className="bg-[#060911] px-4 py-3.5 border-b border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Bot className="w-5 h-5 text-[#06B6D4] shrink-0" />
                <div className="min-w-0">
                  <h2 id="asha-saheli-dialog-title" className="text-sm font-semibold truncate">
                    ASHA Saheli · Two-Way Voice Console
                  </h2>
                  <p className="font-mono text-[11px] text-[#06B6D4] truncate">
                    ASR + SpeechSynthesis [hi-IN]
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
                  className="min-h-[38px] min-w-[38px] rounded-lg bg-[#11192C] border border-slate-700 flex items-center justify-center cursor-pointer"
                >
                  {ttsEnabled ? (
                    <Volume2 className="w-4 h-4 text-[#06B6D4]" />
                  ) : (
                    <VolumeX className="w-4 h-4 text-slate-500" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close Voice Console"
                  className="min-h-[38px] min-w-[38px] rounded-lg bg-[#11192C] border border-slate-700 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#090D16] min-h-[240px]"
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2.5 ${
                    msg.sender === 'asha' ? 'flex-row-reverse' : ''
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 border ${
                      msg.sender === 'asha'
                        ? 'bg-[#F59E0B]/15 border-[#F59E0B]/50 text-[#F59E0B]'
                        : 'bg-[#06B6D4]/15 border-[#06B6D4]/50 text-[#06B6D4]'
                    }`}
                  >
                    {msg.sender === 'asha' ? (
                      <User className="w-3.5 h-3.5" />
                    ) : (
                      <Bot className="w-3.5 h-3.5" />
                    )}
                  </div>

                  <div
                    className={`max-w-[82%] rounded-lg px-3.5 py-2.5 text-xs leading-relaxed border ${
                      msg.sender === 'asha'
                        ? 'bg-[#06B6D4]/15 border-[#06B6D4]/50 text-white'
                        : 'bg-[#0D1322] border-slate-800 text-slate-200'
                    }`}
                  >
                    <p>{msg.text}</p>
                    {msg.sender === 'bot' && (
                      <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between gap-2 font-mono text-[10px]">
                        {msg.appliedSummary ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <CheckCircle2 className="w-3 h-3 shrink-0" />
                            <span>{msg.appliedSummary}</span>
                          </span>
                        ) : (
                          <span className="text-slate-500">TTS READY</span>
                        )}
                        <button
                          type="button"
                          onClick={() => speakClinicalGuidance(msg.text, msg.lang, false)}
                          className="px-2 py-0.5 rounded bg-[#090D16] border border-slate-700 text-[#06B6D4] inline-flex items-center gap-1 cursor-pointer"
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
                <div className="rounded-lg bg-[#06B6D4]/15 border border-[#06B6D4] px-3 py-2 font-mono text-xs text-cyan-100">
                  &gt; {liveInterim}
                </div>
              )}

              {speechStatusMsg && (
                <div className="rounded-lg bg-[#F59E0B]/15 border border-[#F59E0B] px-3 py-2 font-mono text-xs text-amber-200">
                  {speechStatusMsg}
                </div>
              )}
            </div>

            <div className="p-4 bg-[#060911] border-t border-slate-800 space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {DEMO_VOICE_STREAMS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleProcessInput(chip)}
                    className="min-h-[34px] px-2.5 py-1 rounded bg-[#0D1322] hover:bg-slate-800 border border-slate-700 font-mono text-[11px] text-[#06B6D4] cursor-pointer"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={toggleRealSpeechRecognition}
                className={`w-full min-h-[48px] px-4 rounded-lg font-mono text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors ${
                  isListening
                    ? 'bg-[#EF4444] text-white'
                    : 'bg-[#06B6D4] hover:bg-cyan-400 text-[#090D16]'
                }`}
              >
                {isListening ? (
                  <>
                    <MicOff className="w-4 h-4" />
                    <span>Listening Live... Tap to Complete</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4" />
                    <span>Start Live Microphone Capture</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
