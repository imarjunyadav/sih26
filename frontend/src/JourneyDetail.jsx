import { fmtTime, fmtDuration, fmtDistance, modeLabel } from './format.js';
import JourneyMap from './JourneyMap.jsx';

const MODE_ICONS = {
  LOCAL_TRAIN: '🚆',
  METRO: '🚇',
  BUS: '🚌',
  WALK: '🚶',
  CAR: '🚗',
  BIKE: '🚲',
  FERRY: '⛴',
  TAXI: '🚕',
  AUTO: '🛺',
};

function modeCssClass(mode) {
  const map = {
    LOCAL_TRAIN: 'train',
    METRO: 'metro',
    BUS: 'bus',
    WALK: 'walk',
    CAR: 'car',
    BIKE: 'bike',
    FERRY: 'walk',
    TAXI: 'car',
    AUTO: 'car',
  };
  return `mode-${map[mode] ?? 'walk'}`;
}

function WaitIndicator({ minutes }) {
  return (
    <div className="leg-wait">
      <div className="leg-icon-col">
        <span className="leg-connector leg-connector--wait" aria-hidden="true" />
      </div>
      <div className="leg-wait-body">
        <span className="leg-wait-text">Wait {minutes} min</span>
      </div>
    </div>
  );
}

function LegRow({ leg }) {
  const cls = modeCssClass(leg.mode);
  return (
    <div className={`leg-row leg-row--${cls}`}>
      <div className="leg-icon-col">
        <span className={`leg-mode-dot ${cls}`} aria-hidden="true" />
        <span className="leg-connector" aria-hidden="true" />
      </div>
      <div className="leg-body">
        <div className="leg-from-time">
          <span className="leg-place">{leg.from?.name ?? leg.from}</span>
          <span className="leg-time">{fmtTime(leg.departure)}</span>
        </div>
        <div className="leg-info">
          <span className={`leg-chip ${cls}`}>
            {MODE_ICONS[leg.mode] ?? '•'} {modeLabel(leg.mode)}
            {leg.line ? ` · ${leg.line}` : ''}
            {leg.headsign ? ` → ${leg.headsign}` : ''}
          </span>
          <span className="leg-meta">
            {fmtDuration(leg.durationSecs)}
            {leg.distanceMeters ? ` · ${fmtDistance(leg.distanceMeters)}` : ''}
            {leg.isEstimated ? ' · est.' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function JourneyDetail({ journey, requestedAt, onBack }) {
  const totalSecs = journey.durationSecs ?? 0;
  const walkMins = Math.round((journey.totalWalkSecs ?? 0) / 60);
  const waitMins = Math.round((journey.waitSecs ?? 0) / 60);

  const firstDep = journey.departure ? new Date(journey.departure) : null;
  const reqAt = requestedAt ? new Date(requestedAt) : null;
  const preDepartureWaitMins = (firstDep && reqAt && firstDep > reqAt)
    ? Math.round((firstDep - reqAt) / 60000)
    : 0;

  return (
    <div className="detail-panel">
      <div className="results-header">
        <button className="back-btn" onClick={onBack} type="button" aria-label="Back to results">
          ← Results
        </button>
        <h2 className="results-title">Journey detail</h2>
      </div>

      <div className="detail-summary card">
        <div className="detail-summary-row">
          <span className="detail-label">Total time</span>
          <span className="detail-value">{fmtDuration(totalSecs)}</span>
        </div>
        {preDepartureWaitMins >= 5 && (
          <div className="detail-summary-row">
            <span className="detail-label">Wait before departure</span>
            <span className="detail-value detail-value--warn">{fmtDuration(preDepartureWaitMins * 60)}</span>
          </div>
        )}
        {waitMins > 0 && (
          <div className="detail-summary-row">
            <span className="detail-label">Transfer waiting</span>
            <span className="detail-value">{fmtDuration(journey.waitSecs)}</span>
          </div>
        )}
        {walkMins > 0 && (
          <div className="detail-summary-row">
            <span className="detail-label">Walking</span>
            <span className="detail-value">{fmtDuration(journey.totalWalkSecs)}</span>
          </div>
        )}
        {journey.transferCount > 0 && (
          <div className="detail-summary-row">
            <span className="detail-label">Transfers</span>
            <span className="detail-value">{journey.transferCount}</span>
          </div>
        )}
        {journey.fare != null && (
          <div className="detail-summary-row">
            <span className="detail-label">Fare</span>
            <span className="detail-value">₹{journey.fare?.amount ?? journey.fare}</span>
          </div>
        )}
      </div>

      <div className="leg-timeline">
        {journey.legs.map((leg, i) => {
          const prev = journey.legs[i - 1];
          let waitBetween = 0;
          if (prev?.arrival && leg.departure) {
            waitBetween = Math.round(
              (new Date(leg.departure) - new Date(prev.arrival)) / 60000
            );
          }
          return (
            <div key={i}>
              {waitBetween >= 2 && <WaitIndicator minutes={waitBetween} />}
              <LegRow leg={leg} />
            </div>
          );
        })}
        {/* Arrival terminus */}
        <div className="leg-terminus">
          <div className="leg-icon-col">
            <span className="leg-terminus-dot" aria-hidden="true" />
          </div>
          <div className="leg-body">
            <div className="leg-from-time">
              <span className="leg-place">
                {journey.legs[journey.legs.length - 1]?.to?.name ?? journey.legs[journey.legs.length - 1]?.to}
              </span>
              <span className="leg-time">
                {fmtTime(journey.legs[journey.legs.length - 1]?.arrival)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <JourneyMap journey={journey} />
    </div>
  );
}
