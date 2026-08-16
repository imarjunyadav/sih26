import { nearbyStations } from '../utils/nearbyStations.js';
import { railRadarProvider } from '../providers/railRadar.js';
import { googleRoutesProvider } from '../providers/googleRoutes.js';
import { Mode, Category, makeLeg, makeJourney } from '../models/journey.js';
import { JOURNEY_CONFIG as cfg } from '../journeyConfig.js';

// ── Walk helpers ───────────────────────────────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function walkEstimate(fromLat, fromLng, toLat, toLng) {
  const distanceMeters = Math.round(
    haversineKm(fromLat, fromLng, toLat, toLng) * 1000 * cfg.STREET_FACTOR
  );
  const durationSecs = Math.round(distanceMeters / cfg.WALK_SPEED_MPS);
  return { distanceMeters, durationSecs };
}

function buildWalkLeg(from, to, departureDate) {
  const est = walkEstimate(from.lat, from.lng, to.lat, to.lng);
  const arrival = new Date(departureDate.getTime() + est.durationSecs * 1000);
  return makeLeg({
    mode: Mode.WALK,
    provider: 'estimated',
    from: { name: from.name ?? 'Origin', lat: from.lat, lng: from.lng },
    to:   { name: to.name ?? 'Destination', lat: to.lat, lng: to.lng },
    departure: departureDate,
    arrival,
    durationSecs: est.durationSecs,
    distanceMeters: est.distanceMeters,
    metadata: { estimated: true },
  });
}

// ── Line compatibility ─────────────────────────────────────────────────────────

function lineValues(station) {
  return new Set(station.line.split('/'));
}

function sharesLine(a, b) {
  const la = lineValues(a);
  for (const v of lineValues(b)) {
    if (la.has(v)) return true;
  }
  return false;
}

// ── Effective cost ─────────────────────────────────────────────────────────────

/**
 * Compute effective cost in seconds, weighting walk and wait more than transit.
 * For Local stitched journeys, pass waitSecs explicitly (it's not a leg).
 * For Google journeys, wait is inferred from total - walk - transit.
 */
function computeEffectiveCost(journey, explicitWaitSecs) {
  const walkSecs = journey.legs
    .filter(l => l.mode === Mode.WALK)
    .reduce((s, l) => s + (l.durationSecs || 0), 0);

  if (journey.category === Category.WALK) {
    return { cost: Math.round(walkSecs * cfg.WALK_MULTIPLIER), walkSecs, transitSecs: 0, waitSecs: 0 };
  }

  if (journey.category === Category.CAR || journey.category === Category.BIKE) {
    return { cost: Math.round(journey.totalDurationSecs * cfg.TRANSIT_MULTIPLIER), walkSecs: 0, transitSecs: journey.totalDurationSecs, waitSecs: 0 };
  }

  const transitSecs = journey.legs
    .filter(l => l.mode !== Mode.WALK)
    .reduce((s, l) => s + (l.durationSecs || 0), 0);

  const waitSecs = explicitWaitSecs != null
    ? explicitWaitSecs
    : Math.max(0, journey.totalDurationSecs - walkSecs - transitSecs);

  const cost = Math.round(
    transitSecs * cfg.TRANSIT_MULTIPLIER +
    walkSecs    * cfg.WALK_MULTIPLIER    +
    waitSecs    * cfg.WAIT_MULTIPLIER
  );

  return { cost, walkSecs, transitSecs, waitSecs };
}

// ── Station pair pruning ───────────────────────────────────────────────────────

function pruneStationPairs(boardCandidates, alightCandidates, origin, destination) {
  const directWalk = walkEstimate(origin.lat, origin.lng, destination.lat, destination.lng);

  const pairs = [];
  for (const board of boardCandidates) {
    for (const alight of alightCandidates) {
      if (board.code === alight.code) continue;

      // Different railway lines with no interchange in this MVP
      if (!sharesLine(board, alight)) continue;

      // Minimum possible multimodal time: walk-to + 5-min train minimum + walk-from
      const toBoard    = walkEstimate(origin.lat, origin.lng, board.lat, board.lng);
      const fromAlight = walkEstimate(alight.lat, alight.lng, destination.lat, destination.lng);
      const minMultimodal = toBoard.durationSecs + 5 * 60 + fromAlight.durationSecs;

      // Direct walk is faster than the best conceivable multimodal — skip
      if (directWalk.durationSecs <= minMultimodal) continue;

      pairs.push({ board, alight, toBoard, fromAlight });
    }
  }

  return { pairs, directWalkSecs: directWalk.durationSecs };
}

// ── Local journey stitching ────────────────────────────────────────────────────

function localFingerprint(trainLeg, boardCode, alightCode) {
  const bucket = trainLeg.departure
    ? Math.floor(trainLeg.departure.getTime() / (5 * 60 * 1000))
    : 0;
  return `${trainLeg.line}:${boardCode}:${alightCode}:${bucket}`;
}

function stitchLocalJourney(origin, destination, pair, trainLeg, departureDate) {
  const { board, alight, toBoard, fromAlight } = pair;

  // Leg 1: walk to boarding station
  const leg1 = buildWalkLeg(
    { name: origin.name ?? 'Origin',   lat: origin.lat,   lng: origin.lng },
    { name: board.name,                 lat: board.lat,    lng: board.lng  },
    departureDate
  );

  // Platform wait: time between arriving at station and train departure
  const waitSecs = trainLeg.departure
    ? Math.max(0, (trainLeg.departure.getTime() - leg1.arrival.getTime()) / 1000)
    : 0;

  // Leg 3: walk from alighting station to destination
  const trainArrival = trainLeg.arrival
    ?? new Date(trainLeg.departure.getTime() + trainLeg.durationSecs * 1000);
  const leg3 = buildWalkLeg(
    { name: alight.name,                    lat: alight.lat,      lng: alight.lng      },
    { name: destination.name ?? 'Destination', lat: destination.lat, lng: destination.lng },
    trainArrival
  );

  const base = makeJourney({
    category: Category.LOCAL_TRAIN,
    legs: [leg1, trainLeg, leg3],
  });

  // Override totalDurationSecs to include the platform wait gap
  const totalDurationSecs = leg1.durationSecs + Math.round(waitSecs) + trainLeg.durationSecs + leg3.durationSecs;

  const uniqueId = `local:${board.code}:${alight.code}:${trainLeg.line}:${(trainLeg.departure?.getTime() ?? 0).toString(36)}`;

  return {
    ...base,
    id: uniqueId,
    totalDurationSecs,
    waitSecs: Math.round(waitSecs),
    boardCode: board.code,
    alightCode: alight.code,
    source: 'stitched',
  };
}

// ── Local candidates ───────────────────────────────────────────────────────────

async function fetchLocalCandidates(pairs, origin, destination, departureDate, warnings) {
  const seen = new Set();
  const candidates = [];

  const settled = await Promise.allSettled(
    pairs.map(p => railRadarProvider.trainsBetween(p.board.code, p.alight.code))
  );

  let railRadarFailed = false;
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const pair = pairs[i];

    if (result.status === 'rejected') {
      console.warn(`[journeyService] RailRadar ${pair.board.code}→${pair.alight.code} failed: ${result.reason?.message?.slice(0, 80)}`);
      if (!railRadarFailed) {
        railRadarFailed = true;
        warnings.push('Local train options may be incomplete — RailRadar service temporarily unavailable');
      }
      continue;
    }

    const trains = result.value;
    const earliestBoard = new Date(departureDate.getTime() + pair.toBoard.durationSecs * 1000);

    const eligible = trains
      .filter(t => t.departure && t.departure >= earliestBoard)
      .slice(0, cfg.TRAINS_PER_PAIR);

    for (const trainLeg of eligible) {
      const fp = localFingerprint(trainLeg, pair.board.code, pair.alight.code);
      if (seen.has(fp)) continue;
      seen.add(fp);
      candidates.push(stitchLocalJourney(origin, destination, pair, trainLeg, departureDate));
    }
  }

  return candidates;
}

// ── Google candidates ──────────────────────────────────────────────────────────

async function fetchGoogleCandidates(origin, destination, departureDate) {
  const [transitRes, walkRes, driveRes, bikeRes] = await Promise.allSettled([
    googleRoutesProvider.routeTransit(origin, destination, { departureTime: departureDate }),
    googleRoutesProvider.routeWalk(origin, destination, { departureTime: departureDate }),
    googleRoutesProvider.routeCar(origin, destination, { departureTime: departureDate }),
    googleRoutesProvider.routeBike(origin, destination, { departureTime: departureDate }),
  ]);

  const candidates = [];

  if (transitRes.status === 'fulfilled') {
    for (const j of transitRes.value) {
      candidates.push({ ...j, source: 'google-transit' });
    }
  } else {
    console.warn('[journeyService] Google transit failed:', transitRes.reason?.message?.slice(0, 100));
  }

  if (walkRes.status === 'fulfilled') {
    candidates.push(...walkRes.value.map(j => ({ ...j, source: 'google-walk' })));
  }

  if (driveRes.status === 'fulfilled') {
    candidates.push(...driveRes.value.map(j => ({ ...j, source: 'google-drive' })));
  }

  if (bikeRes.status === 'fulfilled') {
    candidates.push(...bikeRes.value.map(j => ({ ...j, source: 'google-bike' })));
  }

  return candidates;
}

// ── Per-category selection ─────────────────────────────────────────────────────

// Canonical display order for result categories
const CATEGORY_ORDER = [
  Category.LOCAL_TRAIN,
  Category.METRO,
  Category.BUS,
  Category.MULTIMODAL,
  Category.WALK,
  Category.BIKE,
  Category.CAR,
];

function selectBestPerCategory(all, directWalkSecs) {
  // Annotate all journeys with effective cost
  const annotated = all.map(j => {
    const { cost } = computeEffectiveCost(j, j.waitSecs);
    return { ...j, effectiveCost: cost };
  });

  // Hard filter 1: standalone walk-only routes > 60 min are not useful
  const f1 = annotated.filter(j =>
    !(j.category === Category.WALK && j.totalDurationSecs > cfg.MAX_WALK_ONLY_SECS)
  );

  // Hard filter 2: LOCAL_TRAIN journey with excessive combined walk (to + from station)
  const f2 = f1.filter(j =>
    !(j.category === Category.LOCAL_TRAIN && j.totalWalkSecs > cfg.MAX_COMBINED_WALK_SECS)
  );

  // Hard filter 3: LOCAL_TRAIN journey no faster than walking directly
  const f3 = f2.filter(j =>
    !(j.category === Category.LOCAL_TRAIN && j.totalDurationSecs >= directWalkSecs)
  );

  // Sort by effective cost (ascending)
  f3.sort((a, b) => a.effectiveCost - b.effectiveCost);

  // Pick the single best journey per category
  const byCategory = {};
  for (const j of f3) {
    if (!byCategory[j.category]) {
      byCategory[j.category] = j;
    }
  }

  // Return in canonical order, omitting empty categories
  return CATEGORY_ORDER.map(cat => byCategory[cat]).filter(Boolean);
}

// ── Formatting helper (test output only) ──────────────────────────────────────

function fmt(secs) {
  if (!secs && secs !== 0) return '?';
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Find the best journey for each supported category: LOCAL_TRAIN, METRO, BUS,
 * MULTIMODAL, WALK, BIKE, CAR. Returns at most one result per category.
 *
 * @param {{ lat: number, lng: number, name?: string }} origin
 * @param {{ lat: number, lng: number, name?: string }} destination
 * @param {Date} departureTime
 * @returns {Promise<{ journeys: Array, warnings: string[] }>}
 */
export async function findJourneys(origin, destination, departureTime) {
  const depDate = departureTime instanceof Date ? departureTime : new Date(departureTime);

  // Phase 1: nearby stations + pair pruning
  const boardCandidates  = nearbyStations(origin.lat,      origin.lng,      cfg.NEARBY_RADIUS_KM, cfg.NEARBY_MAX_STATIONS);
  const alightCandidates = nearbyStations(destination.lat, destination.lng, cfg.NEARBY_RADIUS_KM, cfg.NEARBY_MAX_STATIONS);
  const { pairs, directWalkSecs } = pruneStationPairs(boardCandidates, alightCandidates, origin, destination);

  // Phase 2: fetch candidates (Local + Google in parallel)
  const warnings = [];
  const [localCandidates, googleCandidates] = await Promise.all([
    pairs.length > 0
      ? fetchLocalCandidates(pairs, origin, destination, depDate, warnings)
      : Promise.resolve([]),
    fetchGoogleCandidates(origin, destination, depDate),
  ]);

  // Phase 3: apply LOCAL_TRAIN filter to Google candidates.
  // When RailRadar produced data, drop Google's LOCAL_TRAIN journeys to avoid duplicates.
  // When RailRadar returned nothing (quota / outage), keep Google LOCAL_TRAIN as fallback.
  const railRadarHasData = localCandidates.length > 0;
  const filteredGoogleCandidates = googleCandidates.filter(j => {
    if (j.category !== Category.LOCAL_TRAIN) return true;
    if (railRadarHasData) {
      console.log('  [filter] DROP Google LOCAL_TRAIN journey (using RailRadar)');
      return false;
    }
    console.log('  [fallback] Keeping Google LOCAL_TRAIN journey (RailRadar returned no data)');
    return true;
  });

  const all = [...localCandidates, ...filteredGoogleCandidates];
  return { journeys: selectBestPerCategory(all, directWalkSecs), warnings };
}

// Re-export the fmt helper so the test script can use it
export { fmt };
