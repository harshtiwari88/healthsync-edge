import {
  EdgeAiDiagnostics,
  evaluateTriage,
  NetworkState,
  SymptomKey,
  VitalsSnapshot,
} from '../types/triage';
import {safeReadJson} from './safeFetchJson';

const SESSION_TOKEN_STORAGE_KEY = 'healthsync_active_session_token';

const CLIENT_MEDICAL_DISCLAIMER =
  'Decision-Support Notice: This summary assists clinical handoff to a licensed Medical Officer and is not a medical diagnosis.';

export interface CareSummaryResult {
  handoffSummary: string;
  redFlags: string[];
  stabilizationSteps: string[];
  hindiGuidance: string;
  disclaimer: string;
  model: string;
}

export interface RequestCareSummaryParams {
  sessionToken?: string;
  networkState?: NetworkState;
  patientName?: string;
  age?: number;
  vitals: VitalsSnapshot;
  symptoms: SymptomKey[];
  edgeAi?: EdgeAiDiagnostics;
  transcript?: string;
  language?: 'hi' | 'en';
  explicitAiConsent?: boolean;
  signal?: AbortSignal;
}

let inMemoryActiveToken = '';

export function persistActiveAuthToken(token: string | null | undefined): void {
  const clean = (token || '').trim();
  if (!clean || clean === 'OFFLINE_LOCAL_SESSION') {
    inMemoryActiveToken = '';
  } else {
    inMemoryActiveToken = clean;
  }

  if (typeof window === 'undefined') return;
  try {
    if (!inMemoryActiveToken) {
      window.sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, inMemoryActiveToken);
    }
  } catch {
    // Ignore storage access errors in restricted webviews
  }
}

export function resolveActiveAuthToken(propToken?: string): string {
  const direct = (propToken || '').trim();
  if (direct && direct !== 'OFFLINE_LOCAL_SESSION') {
    return direct;
  }
  if (inMemoryActiveToken) {
    return inMemoryActiveToken;
  }
  if (typeof window !== 'undefined') {
    try {
      const stored = (window.sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || '').trim();
      if (stored && stored !== 'OFFLINE_LOCAL_SESSION') {
        inMemoryActiveToken = stored;
        return stored;
      }
    } catch {
      // Ignore storage access errors
    }
  }
  return '';
}

export function buildClientClinicalSummaryFallback(
  params: RequestCareSummaryParams
): CareSummaryResult {
  const safeAge =
    params?.age !== undefined && Number.isFinite(Number(params.age))
      ? Math.min(120, Math.max(0, Math.round(Number(params.age))))
      : 35;
  const safeVitals: VitalsSnapshot = {
    systolic: Number.isFinite(Number(params?.vitals?.systolic)) ? Number(params.vitals.systolic) : 120,
    diastolic: Number.isFinite(Number(params?.vitals?.diastolic)) ? Number(params.vitals.diastolic) : 80,
    spo2: Number.isFinite(Number(params?.vitals?.spo2)) ? Number(params.vitals.spo2) : 98,
    temperature: Number.isFinite(Number(params?.vitals?.temperature))
      ? Number(params.vitals.temperature)
      : 98.6,
    heartRate: Number.isFinite(Number(params?.vitals?.heartRate))
      ? Number(params.vitals.heartRate)
      : 76,
  };
  const symptoms = Array.isArray(params?.symptoms) ? params.symptoms : [];
  const triage = evaluateTriage(safeVitals, symptoms, params?.edgeAi);

  const severityLabel =
    triage.severity === 'emergency'
      ? 'Urgent Referral Required'
      : triage.severity === 'moderate'
      ? 'Same-Day Medical Officer Review'
      : 'Routine Community Checkup';

  const symptomText = symptoms.length > 0 ? symptoms.join(', ') : 'no acute symptoms reported';
  const screeningNotes: string[] = [];
  if (params?.edgeAi?.anemiaSuspected) {
    screeningNotes.push(
      `conjunctival pallor noted${
        typeof params.edgeAi?.estimatedHb === 'number'
          ? ` (est. Hb ${params.edgeAi.estimatedHb.toFixed(1)} g/dL)`
          : ''
      }`
    );
  }
  if (params?.edgeAi?.respiratoryRiskHigh) {
    screeningNotes.push(
      `elevated acoustic cough profile${
        typeof params.edgeAi?.coughPeakHz === 'number'
          ? ` (${Math.round(params.edgeAi.coughPeakHz)} Hz)`
          : ''
      }`
    );
  }

  const handoffSummary = [
    `${severityLabel} (${triage.scoreCode}) for ${safeAge}-year-old patient.`,
    `Recorded vitals: BP ${safeVitals.systolic}/${safeVitals.diastolic} mmHg, SpO₂ ${safeVitals.spo2}%, Temp ${safeVitals.temperature}°F, Pulse ${safeVitals.heartRate} bpm; ${symptomText}.`,
    screeningNotes.length > 0 ? `Field screening: ${screeningNotes.join('; ')}.` : '',
    triage.protocolEn,
  ]
    .filter(Boolean)
    .join(' ');

  const stabilizationSteps: string[] = [];
  if (safeVitals.spo2 < 90) {
    stabilizationSteps.push(
      'Position patient upright (semi-Fowler), loosen tight clothing, and monitor airway and SpO₂ continuously during 108 transport.'
    );
  }
  if (safeVitals.systolic >= 160 || safeVitals.diastolic >= 105) {
    stabilizationSteps.push(
      'Keep patient calm and seated at rest; recheck blood pressure on the opposite arm after 5 minutes and arrange urgent physician evaluation.'
    );
  }
  if (symptoms.includes('Severe Chest Pain') || symptoms.includes('Bleeding')) {
    stabilizationSteps.push(
      'Avoid physical exertion, keep patient accompanied, and notify the receiving Primary Health Center or District Hospital ahead of arrival.'
    );
  }
  if (safeVitals.temperature >= 100.4 || symptoms.includes('Fever')) {
    stabilizationSteps.push(
      'Encourage oral hydration if alert, apply tepid sponging for high fever, and log symptom duration for the Medical Officer.'
    );
  }
  if (params?.edgeAi?.anemiaSuspected) {
    stabilizationSteps.push(
      'Refer to PHC laboratory for confirmatory venous hemoglobin testing before modifying iron/folic acid supplementation.'
    );
  }
  if (stabilizationSteps.length === 0) {
    stabilizationSteps.push(
      'Continue routine wellness counseling, balanced nutrition, and scheduled sub-center follow-up.'
    );
    stabilizationSteps.push(
      'Advise immediate clinic return if breathlessness, chest pain, persistent high fever, or dizziness develops.'
    );
  }

  return {
    handoffSummary,
    redFlags: triage.triggers.slice(0, 4),
    stabilizationSteps: stabilizationSteps.slice(0, 4),
    hindiGuidance: triage.protocolHi,
    disclaimer: CLIENT_MEDICAL_DISCLAIMER,
    model: 'clinical-protocol-fallback',
  };
}

export async function fetchCareSummaryWithFallback(
  params: RequestCareSummaryParams
): Promise<CareSummaryResult> {
  const isOffline =
    params?.networkState === 'offline' ||
    (typeof navigator !== 'undefined' && navigator.onLine === false);

  if (isOffline) {
    return buildClientClinicalSummaryFallback(params);
  }

  const authToken = resolveActiveAuthToken(params?.sessionToken);
  const allowIdentifiableName =
    Boolean(params?.explicitAiConsent) &&
    params?.age !== undefined &&
    Number(params.age) >= 18 &&
    Boolean(params?.patientName?.trim());

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(authToken ? {Authorization: `Bearer ${authToken}`} : {}),
  };

  const timeoutController =
    !params?.signal && typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId =
    timeoutController !== null
      ? setTimeout(() => {
          timeoutController.abort();
        }, 12_000)
      : null;

  try {
    const resp = await fetch('/api/gemini/clinical-summary', {
      method: 'POST',
      headers,
      signal: params?.signal ?? timeoutController?.signal,
      body: JSON.stringify({
        ...(allowIdentifiableName
          ? {
              patientName: params.patientName!.trim(),
              explicitAiConsent: true,
              lawfulBasis: 'explicit_consent',
            }
          : {}),
        age: params?.age,
        vitals: params?.vitals,
        symptoms: params?.symptoms || [],
        edgeAi: params?.edgeAi,
        transcript: params?.transcript || undefined,
        language: params?.language ?? 'en',
      }),
    });

    const parsed = await safeReadJson<
      Partial<CareSummaryResult> & {
        error?: string;
        isDemoFallback?: boolean;
        data?: Partial<CareSummaryResult>;
      }
    >(resp);

    const payload = parsed.data?.handoffSummary
      ? parsed.data
      : parsed.data?.data?.handoffSummary
      ? parsed.data.data
      : null;

    if (resp.ok && parsed.isJson && payload?.handoffSummary) {
      return {
        handoffSummary: payload.handoffSummary,
        redFlags: Array.isArray(payload.redFlags) ? payload.redFlags : [],
        stabilizationSteps: Array.isArray(payload.stabilizationSteps)
          ? payload.stabilizationSteps
          : [],
        hindiGuidance: payload.hindiGuidance || '',
        disclaimer: payload.disclaimer || CLIENT_MEDICAL_DISCLAIMER,
        model: payload.model || 'gemini-3.8-flash',
      };
    }

    console.warn(
      `[SwasthyaSetu CareSummary] Server summary unavailable (HTTP ${resp.status}); using local clinical fallback.`
    );
    return buildClientClinicalSummaryFallback(params);
  } catch (err) {
    if (params?.signal?.aborted && err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    console.warn(
      '[SwasthyaSetu CareSummary] Network/timeout error; using local clinical fallback:',
      err instanceof Error ? err.message : err
    );
    return buildClientClinicalSummaryFallback(params);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}
