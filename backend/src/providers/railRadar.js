import { get } from 'node:https';
import { config } from '../config.js';
import { Mode, makeLeg } from '../models/journey.js';
import { STATION_BY_CODE } from '../data/mumbaiLocalStations.js';

const BASE = 'https://api.railradar.in';

function apiGet(path) {
  return new Promise((resolve, reject) => {
    const req = get(
      `${BASE}${path}`,
      {
        headers: {
          Authorization: `Bearer ${config.railRadarKey}`,
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(`RailRadar HTTP ${res.statusCode}: ${JSON.stringify(body).slice(0, 300)}`));
            } else {
              resolve(body);
            }
          } catch {
            reject(new Error(`RailRadar parse error: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
  });
}

// ── response parsers ───────────────────────────────────────────────────────

function parseTime(str) {
  if (!str) return null;
  // Handle "HH:MM" or "HH:MM:SS" — create a Date on today's date in IST
  const [h, m] = str.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function stationPoint(code, fallbackName) {
  const s = STATION_BY_CODE[code];
  return {
    name: s?.name ?? fallbackName ?? code,
    lat: s?.lat ?? null,
    lng: s?.lng ?? null,
  };
}

// Normalise one train entry from the /v1/trains/between response into a Leg.
// RailRadar returns schedules; we produce a LOCAL_TRAIN leg with scheduled
// departure/arrival. The caller must filter by whether it fits the journey time.
function normalizeTrainEntry(entry, fromCode, toCode) {
  // Try both flat and nested shapes the API might return
  const train = entry.train ?? entry;
  const number = String(train.number ?? train.trainNumber ?? train.train_number ?? '');
  const name   = train.name ?? train.trainName ?? null;

  // Stops array contains per-station timing
  const stops = entry.stops ?? entry.schedule ?? train.stops ?? [];

  // Find the departure from fromCode and arrival at toCode
  let depStop = null;
  let arrStop = null;
  for (const stop of stops) {
    const sc = stop.station?.code ?? stop.stationCode ?? stop.code ?? '';
    if (sc === fromCode) depStop = stop;
    if (sc === toCode)   arrStop = stop;
  }

  // Fall back to top-level timing fields if stops are absent
  const depTime = parseTime(
    depStop?.scheduledDeparture ?? depStop?.departureTime ??
    depStop?.departure ?? entry.departureTime ?? null
  );
  const arrTime = parseTime(
    arrStop?.scheduledArrival ?? arrStop?.arrivalTime ??
    arrStop?.arrival ?? entry.arrivalTime ?? null
  );

  const durationSecs = (depTime && arrTime)
    ? Math.max(0, (arrTime - depTime) / 1000)
    : 0;

  return makeLeg({
    mode: Mode.LOCAL_TRAIN,
    provider: 'railradar',
    from: stationPoint(fromCode, depStop?.station?.name),
    to:   stationPoint(toCode,   arrStop?.station?.name),
    departure: depTime,
    arrival:   arrTime,
    durationSecs,
    distanceMeters: 0,
    line: number || null,
    agency: 'Central Railway / Western Railway',
    vehicle: 'LOCAL_TRAIN',
    headsign: name ?? null,
    metadata: { trainNumber: number, trainName: name },
  });
}

// ── provider ───────────────────────────────────────────────────────────────

export const railRadarProvider = {
  /**
   * Fetch scheduled trains between two station codes.
   * Returns an array of LOCAL_TRAIN Legs (one per train).
   */
  async trainsBetween(fromCode, toCode) {
    const body = await apiGet(`/v1/trains/between/${fromCode}/${toCode}`);
    const trains = body?.data?.trains ?? body?.trains ?? [];
    if (!Array.isArray(trains)) return [];
    return trains
      .map(t => normalizeTrainEntry(t, fromCode, toCode))
      .filter(l => l.from.lat !== null && l.to.lat !== null);
  },

  /**
   * Fetch the live station departure board.
   * Returns { departures: Leg[], arrivals: Leg[] }.
   */
  async stationBoard(stationCode) {
    const body = await apiGet(`/v1/stations/${stationCode}/live`);
    const data = body?.data ?? body;

    function parseBoardEntries(entries, direction) {
      if (!Array.isArray(entries)) return [];
      return entries.map(entry => {
        const train = entry.train ?? entry;
        const number = String(train.number ?? train.trainNumber ?? '');
        const name   = train.name ?? null;
        const otherCode = direction === 'departure'
          ? (entry.to?.code ?? train.to?.code ?? null)
          : (entry.from?.code ?? train.from?.code ?? null);
        const timeStr = direction === 'departure'
          ? (entry.scheduledDeparture ?? entry.expectedDeparture ?? entry.departureTime ?? null)
          : (entry.scheduledArrival ?? entry.expectedArrival ?? entry.arrivalTime ?? null);
        const t = parseTime(timeStr);
        return makeLeg({
          mode: Mode.LOCAL_TRAIN,
          provider: 'railradar',
          from: direction === 'departure'
            ? stationPoint(stationCode, null)
            : stationPoint(otherCode, entry.from?.name ?? null),
          to: direction === 'departure'
            ? stationPoint(otherCode, entry.to?.name ?? null)
            : stationPoint(stationCode, null),
          departure: direction === 'departure' ? t : null,
          arrival:   direction === 'arrival'   ? t : null,
          durationSecs: 0,
          distanceMeters: 0,
          line: number || null,
          agency: 'Central Railway / Western Railway',
          vehicle: 'LOCAL_TRAIN',
          headsign: name ?? null,
          metadata: { trainNumber: number, trainName: name },
        });
      });
    }

    return {
      departures: parseBoardEntries(data?.departures, 'departure'),
      arrivals:   parseBoardEntries(data?.arrivals,   'arrival'),
    };
  },

  /**
   * Fetch live running status for a single train.
   * Returns raw body; callers use this for live delay / current station info.
   */
  async trainLive(trainNumber) {
    return apiGet(`/v1/trains/${trainNumber}/live`);
  },
};
