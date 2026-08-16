import { useState, useMemo } from 'react';
import JourneyCard from './JourneyCard.jsx';

const MODE_FILTER_LABELS = {
  LOCAL_TRAIN: '🚆 Train',
  METRO: '🚇 Metro',
  BUS: '🚌 Bus',
  BIKE: '🚲 Bike',
  FERRY: '⛴ Ferry',
};

export default function ResultsPanel({ journeys, warnings, error, loading, onSelect, onBack }) {
  const [activeFilter, setActiveFilter] = useState(null);
  const [sort, setSort] = useState('fastest');

  const availableModes = useMemo(() => {
    const s = new Set();
    journeys.forEach(j => j.legs?.forEach(l => {
      if (MODE_FILTER_LABELS[l.mode]) s.add(l.mode);
    }));
    return [...s];
  }, [journeys]);

  const filtered = useMemo(() => {
    if (!activeFilter) return journeys;
    return journeys.filter(j => j.legs?.some(l => l.mode === activeFilter));
  }, [journeys, activeFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === 'fastest')  arr.sort((a, b) => (a.durationSecs ?? 0) - (b.durationSecs ?? 0));
    if (sort === 'cheapest') arr.sort((a, b) => (a.fare?.amount ?? a.fare ?? 0) - (b.fare?.amount ?? b.fare ?? 0));
    if (sort === 'fewest')   arr.sort((a, b) => (a.transferCount ?? 0) - (b.transferCount ?? 0));
    if (sort === 'earliest') arr.sort((a, b) => new Date(a.arrival) - new Date(b.arrival));
    return arr;
  }, [filtered, sort]);

  const showControls = !loading && !error && journeys.length > 0;

  return (
    <div className="results-panel">
      <div className="results-header">
        <button className="back-btn" onClick={onBack} type="button" aria-label="Back to search">
          ← Back
        </button>
        <h2 className="results-title">Routes</h2>
        {showControls && (
          <span className="results-count">{sorted.length} option{sorted.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {showControls && availableModes.length > 1 && (
        <div className="filter-row" role="group" aria-label="Filter by mode">
          <button
            className={`filter-chip${!activeFilter ? ' filter-chip--active' : ''}`}
            onClick={() => setActiveFilter(null)}
            type="button"
          >
            All
          </button>
          {availableModes.map(mode => (
            <button
              key={mode}
              className={`filter-chip${activeFilter === mode ? ' filter-chip--active' : ''}`}
              onClick={() => setActiveFilter(activeFilter === mode ? null : mode)}
              type="button"
            >
              {MODE_FILTER_LABELS[mode]}
            </button>
          ))}
        </div>
      )}

      {showControls && journeys.length > 1 && (
        <div className="sort-row">
          <label className="sort-label" htmlFor="route-sort">Sort:</label>
          <select
            id="route-sort"
            className="sort-select"
            value={sort}
            onChange={e => setSort(e.target.value)}
          >
            <option value="fastest">Fastest</option>
            <option value="earliest">Earliest arrival</option>
            <option value="fewest">Fewest transfers</option>
            <option value="cheapest">Cheapest</option>
          </select>
        </div>
      )}

      {warnings && warnings.length > 0 && (
        <ul className="warning-list">
          {warnings.map((w, i) => <li key={i} className="warning-item">{w}</li>)}
        </ul>
      )}

      {loading && (
        <div className="loading-state">
          <div className="spinner" aria-label="Finding routes…" />
          <p className="muted">Finding routes…</p>
        </div>
      )}

      {!loading && error && (
        <div className="empty-state"><p className="error">{error}</p></div>
      )}

      {!loading && !error && journeys.length === 0 && (
        <div className="empty-state">
          <p className="muted">No routes found. Try adjusting your origin or destination.</p>
        </div>
      )}

      {!loading && !error && sorted.length > 0 && (
        <ul className="journey-list">
          {sorted.map(j => (
            <li key={j.id}>
              <JourneyCard journey={j} onClick={() => onSelect(j)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
