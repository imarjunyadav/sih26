import { fmtTime, fmtDuration, leavesIn } from './format.js';

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

function buildSummary(legs) {
  return legs
    .filter((l) => l.mode !== 'WALK')
    .map((l) => (l.line ? `${MODE_ICONS[l.mode] ?? '•'} ${l.line}` : MODE_ICONS[l.mode] ?? l.mode));
}

export default function JourneyCard({ journey, onClick }) {
  const departs = journey.legs[0]?.departure;
  const arrives = journey.legs[journey.legs.length - 1]?.arrival;
  const eta = leavesIn(departs);
  const transitLegs = journey.legs.filter((l) => l.mode !== 'WALK');
  const summary = buildSummary(journey.legs);
  const walkMins = Math.round((journey.totalWalkSecs ?? 0) / 60);

  return (
    <button className="journey-card" onClick={onClick} type="button" aria-label="View journey details">
      <div className="journey-card-top">
        <div className="journey-time-block">
          <span className="journey-depart">{fmtTime(departs)}</span>
          <span className="journey-arrow">→</span>
          <span className="journey-arrive">{fmtTime(arrives)}</span>
        </div>
        <div className="journey-duration">{fmtDuration(
          journey.legs.reduce((s, l) => s + (l.durationSecs ?? 0), 0)
        )}</div>
      </div>

      <div className="journey-card-mid">
        <div className="journey-modes">
          {journey.legs.map((leg, i) => (
            <span key={i} className={`leg-chip ${modeCssClass(leg.mode)}`}>
              {MODE_ICONS[leg.mode] ?? leg.mode}
              {leg.line && <span className="leg-line"> {leg.line}</span>}
            </span>
          ))}
        </div>
        {eta && <span className="journey-eta">{eta}</span>}
      </div>

      <div className="journey-card-bot">
        {walkMins > 0 && (
          <span className="journey-walk">{walkMins} min walk</span>
        )}
        {journey.fare != null && (
          <span className="journey-fare">₹{journey.fare?.amount ?? journey.fare}</span>
        )}
        {journey.transferCount > 0 && (
          <span className="journey-transfers">{journey.transferCount} change{journey.transferCount > 1 ? 's' : ''}</span>
        )}
      </div>
    </button>
  );
}
