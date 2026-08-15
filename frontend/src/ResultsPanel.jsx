import JourneyCard from './JourneyCard.jsx';

export default function ResultsPanel({ journeys, warnings, error, loading, onSelect, onBack }) {
  return (
    <div className="results-panel">
      <div className="results-header">
        <button className="back-btn" onClick={onBack} type="button" aria-label="Back to search">
          ← Back
        </button>
        <h2 className="results-title">Route options</h2>
      </div>

      {warnings && warnings.length > 0 && (
        <ul className="warning-list">
          {warnings.map((w, i) => (
            <li key={i} className="warning-item">{w}</li>
          ))}
        </ul>
      )}

      {loading && (
        <div className="loading-state">
          <div className="spinner" aria-label="Finding routes…" />
          <p className="muted">Finding routes…</p>
        </div>
      )}

      {!loading && error && (
        <div className="empty-state">
          <p className="error">{error}</p>
        </div>
      )}

      {!loading && !error && journeys.length === 0 && (
        <div className="empty-state">
          <p className="muted">No routes found. Try adjusting your origin or destination.</p>
        </div>
      )}

      {!loading && !error && journeys.length > 0 && (
        <ul className="journey-list">
          {journeys.map((j) => (
            <li key={j.id}>
              <JourneyCard journey={j} onClick={() => onSelect(j)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
