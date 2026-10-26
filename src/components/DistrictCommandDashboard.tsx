import React, {useMemo, useState} from 'react';
import {
  Ambulance,
  BellRing,
  CheckCircle2,
  Code2,
  FileJson,
  MapPin,
  ShieldCheck,
  Terminal,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {BASELINE_MORNING_SCREENINGS, VILLAGE_SUB_CENTERS} from '../data/initialData';
import {TriageRecord} from '../types/triage';
import {buildFhirBundleFromDecoded, decodeSMSPayload} from '../utils/binarySmsCodec';

interface DistrictCommandDashboardProps {
  dmoEmail: string;
  records: TriageRecord[];
  sirenActive: boolean;
  sirenMuted: boolean;
  onTriggerTestSiren: () => void;
  onToggleMuteSiren: () => void;
  onDispatchAmbulance: (recordId: string) => void;
}

export const DistrictCommandDashboard: React.FC<DistrictCommandDashboardProps> = ({
  dmoEmail,
  records,
  sirenActive,
  sirenMuted,
  onTriggerTestSiren,
  onToggleMuteSiren,
  onDispatchAmbulance,
}) => {
  const [selectedVillage, setSelectedVillage] = useState<string>('ALL');
  const [rawSmsInput, setRawSmsInput] = useState('HS#A8842#BP160/100#SPO288#RED');
  const [decodedQuery, setDecodedQuery] = useState('HS#A8842#BP160/100#SPO288#RED');

  const decodedResult = useMemo(() => decodeSMSPayload(decodedQuery), [decodedQuery]);
  const fhirBundleJson = useMemo(
    () => JSON.stringify(buildFhirBundleFromDecoded(decodedResult), null, 2),
    [decodedResult]
  );

  // District KPI Totals
  const totalScreeningsToday = BASELINE_MORNING_SCREENINGS + records.length;
  const criticalRedCount = records.filter((r) => r.severity === 'emergency').length;
  const moderateRiskCount = records.filter((r) => r.severity === 'moderate').length;
  const pendingOfflineSyncs = records.filter((r) => r.syncStatus === 'Queued Offline').length;

  // Filtered stream for Left Column Map & Metrics Table
  const filteredMetricsRecords = useMemo(() => {
    const list =
      selectedVillage === 'ALL'
        ? records
        : records.filter((r) => r.villageCode === selectedVillage);
    return [...list].sort((a, b) => b.createdAtMs - a.createdAtMs);
  }, [records, selectedVillage]);

  // Priority Emergency Queue for Right Column (RED alerts floated to top)
  const emergencyQueue = useMemo(() => {
    return [...records]
      .filter((r) => r.severity === 'emergency' || r.severity === 'moderate')
      .sort((a, b) => {
        const aRed = a.severity === 'emergency' ? 1 : 0;
        const bRed = b.severity === 'emergency' ? 1 : 0;
        if (aRed !== bRed) return bRed - aRed;
        return b.createdAtMs - a.createdAtMs;
      });
  }, [records]);

  const sampleBitPackedPayload =
    records.find((r) => r.binarySmsPayload.startsWith('HS#B'))?.binarySmsPayload ??
    'HS#BAiN7AMwAoFhkA6x8HA4iog==';

  return (
    <div className="max-w-7xl mx-auto w-full p-6 space-y-6">
      {/* Top Command Bar */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-center">
        <div>
          <p className="text-xs font-medium text-teal-400">
            District 24 Tele-Triage Command Portal · {dmoEmail}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-100">
            District Hospital Command Center
          </h1>
        </div>

        {/* Real Web Audio Emergency Siren Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onTriggerTestSiren}
            className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-white transition whitespace-nowrap shrink-0 cursor-pointer ${
              sirenActive ? 'bg-red-500 ring-2 ring-red-400/50' : 'bg-red-600 hover:bg-red-500'
            }`}
          >
            <BellRing className="h-4 w-4 shrink-0" />
            <span>{sirenActive ? 'Stop Active Siren' : 'Trigger Emergency Siren'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleMuteSiren}
            className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition whitespace-nowrap shrink-0 cursor-pointer ${
              sirenMuted
                ? 'border-amber-500/50 bg-amber-950/60 text-amber-300'
                : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600'
            }`}
          >
            {sirenMuted ? (
              <>
                <VolumeX className="h-4 w-4 text-amber-400 shrink-0" />
                <span>Alarm Muted (Click to Unmute)</span>
              </>
            ) : (
              <>
                <Volume2 className="h-4 w-4 text-teal-400 shrink-0" />
                <span>Mute Alarm</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 4-Column District KPI Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs font-medium text-slate-400">Total Screenings Today</p>
          <p className="mt-1.5 text-2xl font-bold text-slate-100 tabular-nums">
            {totalScreeningsToday}
          </p>
          <p className="mt-1 text-xs text-slate-500">3 Active Rural Sub-Centers</p>
        </div>

        <div className="rounded-xl border border-red-500/40 bg-slate-900 p-4">
          <p className="text-xs font-medium text-red-400">Critical RED Emergencies</p>
          <p className="mt-1.5 text-2xl font-bold text-red-400 tabular-nums">
            {criticalRedCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">108 Ambulance Priority</p>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-slate-900 p-4">
          <p className="text-xs font-medium text-amber-400">Moderate Yellow Risk</p>
          <p className="mt-1.5 text-2xl font-bold text-amber-300 tabular-nums">
            {moderateRiskCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">PHC Doctor Tele-Consult</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs font-medium text-teal-400">Pending Offline Syncs</p>
          <p className="mt-1.5 text-2xl font-bold text-slate-100 tabular-nums">
            {pendingOfflineSyncs}
          </p>
          <p className="mt-1 text-xs text-slate-500">LocalStorage / IDB Queue</p>
        </div>
      </div>

      {/* Rock-Solid 12-Column Main Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (7 Cols): Sub-Center Telemetry Map & Metrics Stream */}
        <div className="lg:col-span-7 space-y-6">
          {/* Interactive Village Sub-Center Map Panel */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-100">
                  Sub-Center Geolocation &amp; Coverage Map
                </h2>
                <p className="text-xs text-slate-400">
                  Select a rural sub-center node to filter the live patient metrics stream
                </p>
              </div>

              {/* Interactive Sub-Center Filter Buttons */}
              <div className="flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
                <button
                  type="button"
                  onClick={() => setSelectedVillage('ALL')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                    selectedVillage === 'ALL'
                      ? 'bg-teal-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All Nodes
                </button>
                {VILLAGE_SUB_CENTERS.map((vil) => (
                  <button
                    key={vil.code}
                    type="button"
                    onClick={() => setSelectedVillage(vil.code)}
                    className={`rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                      selectedVillage === vil.code
                        ? 'bg-teal-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {vil.code}
                  </button>
                ))}
              </div>
            </div>

            {/* Interactive SVG District Map */}
            <div className="relative h-64 w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
              <svg
                viewBox="0 0 600 260"
                className="h-full w-full"
                role="img"
                aria-label="District 24 Rural Sub-Center Map"
              >
                {/* Subtle Coordinate Grid */}
                <g stroke="#1E293B" strokeWidth="1">
                  <line x1="0" y1="65" x2="600" y2="65" />
                  <line x1="0" y1="130" x2="600" y2="130" />
                  <line x1="0" y1="195" x2="600" y2="195" />
                  <line x1="150" y1="0" x2="150" y2="260" />
                  <line x1="300" y1="0" x2="300" y2="260" />
                  <line x1="450" y1="0" x2="450" y2="260" />
                </g>

                {/* Highway & Ambulance Route Corridors to District Hospital Hub (300, 145) */}
                {VILLAGE_SUB_CENTERS.map((vil) => {
                  const cx = (vil.x / 100) * 600;
                  const cy = (vil.y / 100) * 260;
                  return (
                    <line
                      key={`route-${vil.code}`}
                      x1={300}
                      y1={145}
                      x2={cx}
                      y2={cy}
                      stroke="#0F766E"
                      strokeWidth="2"
                      strokeDasharray="5 5"
                    />
                  );
                })}

                {/* Central District 24 Hospital Command Node */}
                <g transform="translate(300, 145)">
                  <rect
                    x="-16"
                    y="-16"
                    width="32"
                    height="32"
                    rx="8"
                    fill="#0F766E"
                    stroke="#5EEAD4"
                    strokeWidth="2"
                  />
                  <text
                    x="0"
                    y="4"
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize="11"
                    fontWeight="bold"
                  >
                    DH
                  </text>
                  <text
                    x="0"
                    y="30"
                    textAnchor="middle"
                    fill="#94A3B8"
                    fontSize="11"
                    fontWeight="600"
                  >
                    District 24 Hospital
                  </text>
                </g>

                {/* Village Sub-Center Pins */}
                {VILLAGE_SUB_CENTERS.map((vil) => {
                  const cx = (vil.x / 100) * 600;
                  const cy = (vil.y / 100) * 260;
                  const vilRecords = records.filter((r) => r.villageCode === vil.code);
                  const hasRed = vilRecords.some(
                    (r) => r.severity === 'emergency' && r.dispatchStatus !== 'Dispatched'
                  );
                  const isSelected = selectedVillage === vil.code;
                  const pinFill = hasRed ? '#EF4444' : '#10B981';

                  return (
                    <g
                      key={vil.code}
                      transform={`translate(${cx}, ${cy})`}
                      onClick={() =>
                        setSelectedVillage((prev) => (prev === vil.code ? 'ALL' : vil.code))
                      }
                      className="cursor-pointer"
                    >
                      {isSelected && (
                        <circle
                          r="20"
                          fill="none"
                          stroke="#2DD4BF"
                          strokeWidth="2"
                        />
                      )}
                      <circle
                        r="12"
                        fill={pinFill}
                        stroke="#020617"
                        strokeWidth="2.5"
                      />
                      <text
                        x="0"
                        y="4"
                        textAnchor="middle"
                        fill="#FFFFFF"
                        fontSize="10"
                        fontWeight="bold"
                      >
                        {vilRecords.length}
                      </text>
                      <text
                        x="0"
                        y="-18"
                        textAnchor="middle"
                        fill="#E2E8F0"
                        fontSize="11"
                        fontWeight="600"
                      >
                        {vil.name} ({vil.code})
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Sub-Center Distance Metadata */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              {VILLAGE_SUB_CENTERS.map((vil) => (
                <span key={vil.code} className="inline-flex items-center gap-1 tabular-nums">
                  <MapPin className="h-3.5 w-3.5 text-teal-400" />
                  <span>
                    {vil.code}: {vil.phcDistanceKm} km · {vil.ashaName}
                  </span>
                </span>
              ))}
            </div>
          </section>

          {/* Metrics Stream Table */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-100">
                  Field Triage Metrics Stream
                </h2>
                <p className="text-xs text-slate-400">
                  Showing {filteredMetricsRecords.length} patient records{' '}
                  {selectedVillage !== 'ALL' ? `for ${selectedVillage}` : 'across all sub-centers'}
                </p>
              </div>
            </div>

            <div className="custom-scrollbar max-h-[380px] overflow-x-auto overflow-y-auto rounded-xl border border-slate-800">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-slate-950 text-slate-400">
                  <tr className="border-b border-slate-800">
                    <th className="px-3.5 py-2.5 font-semibold">Patient</th>
                    <th className="px-3 py-2.5 font-semibold">Node</th>
                    <th className="px-3 py-2.5 text-right font-semibold">BP</th>
                    <th className="px-3 py-2.5 text-right font-semibold">SpO2</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Temp</th>
                    <th className="px-3 py-2.5 font-semibold">Sync</th>
                    <th className="px-3.5 py-2.5 text-right font-semibold">SMS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 bg-slate-900">
                  {filteredMetricsRecords.map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-800/50">
                      <td className="px-3.5 py-2.5">
                        <div className="font-semibold text-slate-100">{rec.patientName}</div>
                        <div className="text-[11px] text-slate-400">
                          {rec.patientId} · {rec.timestamp}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-300">{rec.villageCode}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-200 tabular-nums">
                        {rec.vitals.systolic}/{rec.vitals.diastolic}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono font-bold tabular-nums ${
                          rec.vitals.spo2 < 90 ? 'text-red-400' : 'text-slate-200'
                        }`}
                      >
                        {rec.vitals.spo2}%
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-200 tabular-nums">
                        {rec.vitals.temperature}°F
                      </td>
                      <td className="px-3 py-2.5 text-slate-300">{rec.syncStatus}</td>
                      <td className="px-3.5 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setRawSmsInput(rec.binarySmsPayload);
                            setDecodedQuery(rec.binarySmsPayload);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] font-semibold text-teal-300 hover:border-teal-500/60 cursor-pointer whitespace-nowrap"
                        >
                          <Code2 className="h-3 w-3" />
                          <span>Decode</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN (5 Cols): Emergency Alert Queue & Real-Time SMS Payload Decoder */}
        <div className="lg:col-span-5 space-y-6">
          {/* Emergency Alert Queue */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-100">Emergency Alert Queue</h2>
                <p className="text-xs text-slate-400">
                  Critical RED &amp; High-Risk referrals requiring immediate action
                </p>
              </div>
              <span className="font-mono text-xs font-bold text-red-400 tabular-nums">
                {emergencyQueue.length} Active
              </span>
            </div>

            <div className="custom-scrollbar max-h-[380px] space-y-3 overflow-y-auto pr-1">
              {emergencyQueue.map((rec) => {
                const isRed = rec.severity === 'emergency';
                const isDispatched = rec.dispatchStatus === 'Dispatched';

                return (
                  <div
                    key={rec.id}
                    className={`rounded-xl border p-3.5 ${
                      isRed && !isDispatched
                        ? 'flashing-red-border border-2 border-red-500 bg-red-950/35'
                        : isRed
                        ? 'border-red-500/40 bg-slate-950'
                        : 'border-amber-500/35 bg-slate-950'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold">
                          <span className={isRed ? 'text-red-400' : 'text-amber-400'}>
                            {isRed ? 'CRITICAL RED' : 'MODERATE RISK'}
                          </span>
                          <span className="text-slate-500"> · </span>
                          <span className="text-slate-400">
                            {rec.villageCode} · {rec.timestamp}
                          </span>
                        </p>
                        <h3 className="mt-1 text-sm font-bold text-slate-100">
                          {rec.patientName}{' '}
                          <span className="font-normal text-slate-400">
                            ({rec.age}y {rec.gender})
                          </span>
                        </h3>
                        <p className="mt-0.5 text-xs text-slate-400">{rec.ashaWorker}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setRawSmsInput(rec.binarySmsPayload);
                          setDecodedQuery(rec.binarySmsPayload);
                        }}
                        className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:border-teal-500/50 cursor-pointer whitespace-nowrap"
                      >
                        Load SMS
                      </button>
                    </div>

                    <p className="mt-2 font-mono text-xs text-slate-200 tabular-nums">
                      BP {rec.vitals.systolic}/{rec.vitals.diastolic} mmHg · SpO2 {rec.vitals.spo2}%
                      · Temp {rec.vitals.temperature}°F
                    </p>

                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-800/90 pt-2.5">
                      <span className="truncate font-mono text-[11px] text-slate-400">
                        {rec.binarySmsPayload}
                      </span>

                      {isDispatched ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-400 whitespace-nowrap tabular-nums">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Dispatched ({rec.etaMinutes ?? 11}m ETA)</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onDispatchAmbulance(rec.id)}
                          className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition cursor-pointer whitespace-nowrap ${
                            isRed ? 'bg-red-600 hover:bg-red-500' : 'bg-teal-600 hover:bg-teal-500'
                          }`}
                        >
                          <Ambulance className="h-3.5 w-3.5" />
                          <span>Dispatch 108</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Real-Time SMS Binary Payload Decoder */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-3.5">
            <div className="border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-teal-400" />
                <h2 className="text-base font-bold text-slate-100">
                  Real-Time SMS Payload Decoder
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                Decode incoming 28-char bit-packed Base64 SMS or gateway tag into FHIR R4 JSON
              </p>
            </div>

            <div className="space-y-2.5">
              <textarea
                rows={2}
                value={rawSmsInput}
                onChange={(e) => setRawSmsInput(e.target.value)}
                placeholder="Paste HS#B... or HS#A8842#BP160/100#SPO288#RED"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-xs font-bold text-emerald-300 focus:border-teal-500 focus:outline-none"
              />

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const s = 'HS#A8842#BP160/100#SPO288#RED';
                    setRawSmsInput(s);
                    setDecodedQuery(s);
                  }}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 font-mono text-[11px] text-slate-300 hover:border-teal-500/50 cursor-pointer"
                >
                  HS#A8842#BP160/100#SPO288#RED
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRawSmsInput(sampleBitPackedPayload);
                    setDecodedQuery(sampleBitPackedPayload);
                  }}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 font-mono text-[11px] text-teal-300 hover:border-teal-500/50 cursor-pointer"
                >
                  {sampleBitPackedPayload}
                </button>
              </div>

              <button
                type="button"
                onClick={() => setDecodedQuery(rawSmsInput)}
                className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-teal-500 cursor-pointer"
              >
                <ShieldCheck className="h-4 w-4" />
                <span>Decode SMS Payload</span>
              </button>
            </div>

            {decodedResult.valid ? (
              <div className="space-y-3 pt-1">
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs">
                  <div className="flex items-center justify-between text-emerald-400 font-semibold">
                    <span>{decodedResult.formatLabel}</span>
                    <span className="font-mono tabular-nums">CRC {decodedResult.checksumHex}</span>
                  </div>
                  <p className="mt-1 text-slate-400">
                    {decodedResult.ashaId} · {decodedResult.villageCode} · {decodedResult.patientId}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-800 pt-2 font-mono text-slate-100 tabular-nums">
                    <div>
                      <span className="block font-sans text-[10px] text-slate-400">BP</span>
                      <strong>
                        {decodedResult.vitals.systolic}/{decodedResult.vitals.diastolic} mmHg
                      </strong>
                    </div>
                    <div>
                      <span className="block font-sans text-[10px] text-slate-400">
                        SpO2 &amp; Temp
                      </span>
                      <strong>
                        {decodedResult.vitals.spo2}% · {decodedResult.vitals.temperature}°F
                      </strong>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <FileJson className="h-3.5 w-3.5 text-teal-400" />
                    <span>HL7 FHIR R4 Bundle</span>
                  </p>
                  <pre className="custom-scrollbar max-h-48 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-emerald-300">
                    {fhirBundleJson}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-red-500/40 bg-red-950/50 p-3 text-xs font-medium text-red-200">
                {decodedResult.error ?? 'Invalid SMS payload string.'}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
