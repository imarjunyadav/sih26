import { fmtTime, fmtDuration, fmtDistance, modeLabel } from './format.js';

const MODE_ICONS = {
  LOCAL_TRAIN: '🚆',
  METRO: '🚇',
  BUS: '🚌',
  WALK: '🚶',
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
    FERRY: 'walk',
    TAXI: 'car',
    AUTO: 'car',
  };
  return `mode-${map[mode] ?? 'walk'}`;
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
        <div className="leg-to-time">
          <span className="leg-place">{leg.to?.name ?? leg.to}</span>
          <span className="leg-time">{fmtTime(leg.arrival)}</span>
        </div>
      </div>
    </div>
  );
}

export default function JourneyDetail({ journey, onBack }) {
  const totalSecs = journey.legs.reduce((s, l) => s + (l.durationSecs ?? 0), 0);

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
        {journey.totalWalkSecs != null && (
          <div className="detail-summary-row">
            <span className="detail-label">Walking</span>
            <span className="detail-value">{fmtDuration(journey.totalWalkSecs)}</span>
          </div>
        )}
        {journey.transferCount != null && (
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
        {journey.legs.map((leg, i) => (
          <LegRow key={i} leg={leg} />
        ))}
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

      <div className="map-placeholder card">
        <p className="muted">Map view coming in Step 7</p>
      </div>
    </div>
  );
}
