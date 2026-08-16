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

  // Pure walk or unknown mode
  if (journey.category === Category.WALK) {
    return { cost: Math.round(walkSecs * cfg.WALK_MULTIPLIER), walkSecs, transitSecs: 0, waitSecs: 0 };
  }

  // Driving and cycling — comfortable, no effort premium
  if (journey.category === Category.CAR || journey.category === Category.BIKE) {
    return { cost: Math.round(journey.totalDurationSecs * cfg.TRANSIT_MULTIPLIER), walkSecs: 0, transitSecs: journey.totalDurationSecs, waitSecs: 0 };
  }

  // MULTIMODAL / BUS — decompose into transit + walk + wait
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
  // Starts when the train arrives (fall back to departure + duration if no arrival)
  const trainArrival = trainLeg.arrival
    ?? new Date(trainLeg.departure.getTime() + trainLeg.durationSecs * 1000);
  const leg3 = buildWalkLeg(
    { name: alight.name,                    lat: alight.lat,      lng: alight.lng      },
    { name: destination.name ?? 'Destination', lat: destination.lat, lng: destination.lng },
    trainArrival
  );

  const base = makeJourney({
    category: Category.MULTIMODAL,
    legs: [leg1, trainLeg, leg3],
  });

  // Override totalDurationSecs to include the platform wait gap (not a leg, not counted by makeJourney)
  const totalDurationSecs = leg1.durationSecs + Math.round(waitSecs) + trainLeg.durationSecs + leg3.durationSecs;

  // Unique ID that includes departure time to distinguish trains on the same pair
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

// ── Filter and rank ────────────────────────────────────────────────────────────

function isLocalJourney(j) {
  return j.legs.some(l => l.mode === Mode.LOCAL_TRAIN);
}

function diversityKey(journey) {
  const modes = new Set(journey.legs.filter(l => l.mode !== Mode.WALK).map(l => l.mode));
  if (modes.has(Mode.LOCAL_TRAIN)) return 'LOCAL_TRAIN';
  if (modes.has(Mode.METRO)) return 'METRO';
  if (modes.size > 1) return 'MULTIMODAL';
  if (modes.has(Mode.BUS)) return 'BUS';
  if (journey.category === Category.CAR) return 'CAR';
  if (journey.category === Category.BIKE) return 'BIKE';
  return 'WALK';
}

function filterAndRank(all, directWalkSecs) {
  // Annotate all journeys with effective cost
  const annotated = all.map(j => {
    const { cost, walkSecs, transitSecs, waitSecs } = computeEffectiveCost(j, j.waitSecs);
    return {
      ...j,
      effectiveCost: cost,
      _costBreakdown: { walkSecs, transitSecs, waitSecs },
    };
  });

  // ── Hard filter 1: standalone walk > 60 min ─────────────────────────────────
  const f1 = annotated.filter(j => {
    if (j.category === Category.WALK && j.totalDurationSecs > cfg.MAX_WALK_ONLY_SECS) {
      console.log(`  [filter:DROP] walk-only ${fmt(j.totalDurationSecs)} > 60 min cap`);
      return false;
    }
    return true;
  });

  // ── Hard filter 2: combined walk inside Local > 40 min ──────────────────────
  const f2 = f1.filter(j => {
    if (isLocalJourney(j) && j.totalWalkSecs > cfg.MAX_COMBINED_WALK_SECS) {
      console.log(`  [filter:DROP] local combined walk ${fmt(j.totalWalkSecs)} > 40 min`);
      return false;
    }
    return true;
  });

  // ── Hard filter 3: Local wait ≥ 45 min when a better alternative exists ─────
  const hasAlternative = f2.some(j => !isLocalJourney(j) || (j.waitSecs ?? 0) < cfg.MAX_WAIT_HARD_SECS);
  const f3 = f2.filter(j => {
    if (isLocalJourney(j) && (j.waitSecs ?? 0) >= cfg.MAX_WAIT_HARD_SECS && hasAlternative) {
      console.log(`  [filter:DROP] local wait ${fmt(j.waitSecs)} ≥ 45 min with alternatives available`);
      return false;
    }
    return true;
  });

  // ── Hard filter 4: Local journey no faster than walking directly ─────────────
  const f4 = f3.filter(j => {
    if (isLocalJourney(j) && j.totalDurationSecs >= directWalkSecs) {
      console.log(`  [filter:DROP] local total ${fmt(j.totalDurationSecs)} ≥ direct walk ${fmt(directWalkSecs)}`);
      return false;
    }
    return true;
  });

  // Sort by effective cost
  f4.sort((a, b) => a.effectiveCost - b.effectiveCost);

  const bestCost = f4[0]?.effectiveCost ?? Infinity;

  // ── Soft filter 5: outlier > 2.5× best, unless sole mode representative ──────
  const modeRep = {};
  for (const j of f4) modeRep[j.category] = (modeRep[j.category] ?? 0) + 1;

  const f5 = f4.filter(j => {
    if (j.effectiveCost <= bestCost * cfg.OUTLIER_MULTIPLIER) return true;
    if (modeRep[j.category] === 1) return true;
    console.log(`  [filter:DROP] outlier effectiveCost=${fmt(j.effectiveCost)} > ${cfg.OUTLIER_MULTIPLIER}× best ${fmt(bestCost)}`);
    return false;
  });

  // ── Soft filter 6: per-pair cap + near-duplicate suppression ─────────────────
  const pairKept = {};
  const deduped = [];

  for (const j of f5) {
    if (isLocalJourney(j)) {
      const pairKey = `${j.boardCode}:${j.alightCode}`;
      const kept = pairKept[pairKey] ?? [];

      const isNearDup = kept.some(prev => {
        const depDiff  = Math.abs((j.departure?.getTime() ?? 0) - (prev.departure?.getTime() ?? 0)) / 1000;
        const costDiff = Math.abs(j.effectiveCost - prev.effectiveCost);
        return depDiff  < cfg.NEAR_DUP_DEPARTURE_DIFF_SECS &&
               costDiff < cfg.NEAR_DUP_EFFECTIVE_COST_DIFF_SECS;
      });

      if (isNearDup) {
        console.log(`  [filter:DROP] near-dup local ${j.boardCode}→${j.alightCode}`);
        continue;
      }

      if (kept.length >= cfg.MAX_OUTPUT_PER_PAIR) {
        console.log(`  [filter:DROP] pair-cap ${j.boardCode}→${j.alightCode} (already have ${kept.length})`);
        continue;
      }

      pairKept[pairKey] = [...kept, j];
    }

    deduped.push(j);
  }

  // ── Diversity-aware selection ────────────────────────────────────────────────
  // Pass 1: one best representative from each diversity group
  const groupBest = {};
  for (const j of deduped) {
    const key = diversityKey(j);
    if (!groupBest[key]) groupBest[key] = j;
  }

  const result = Object.values(groupBest);
  const inResult = new Set(result.map(j => j.id));

  // Pass 2: fill remaining slots from ranked pool
  for (const j of deduped) {
    if (result.length >= cfg.MAX_RESULTS) break;
    if (inResult.has(j.id)) continue;
    result.push(j);
    inResult.add(j.id);
  }

  result.sort((a, b) => a.effectiveCost - b.effectiveCost);
  return result;
}

// ── Formatting helper (test output only) ──────────────────────────────────────

function fmt(secs) {
  if (!secs && secs !== 0) return '?';
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Find ranked multimodal journeys from origin to destination.
 *
 * @param {{ lat: number, lng: number, name?: string }} origin
 * @param {{ lat: number, lng: number, name?: string }} destination
 * @param {Date} departureTime
 * @returns {Promise<Array>} Up to MAX_RESULTS ranked journey objects
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
    if (!j.legs.some(l => l.mode === Mode.LOCAL_TRAIN)) return true;
    if (railRadarHasData) {
      console.log('  [filter] DROP Google journey with LOCAL_TRAIN leg (using RailRadar)');
      return false;
    }
    console.log('  [fallback] Keeping Google LOCAL_TRAIN leg (RailRadar returned no data)');
    return true;
  });

  const all = [...localCandidates, ...filteredGoogleCandidates];
  return { journeys: filterAndRank(all, directWalkSecs), warnings };
}

// Re-export the fmt helper so the test script can use it
export { fmt };
