import { useState, useEffect } from 'react';
import PlaceInput from './PlaceInput.jsx';

function toLocalDatetimeStr(date) {
  const off = date.getTimezoneOffset();
  const local = new Date(date.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}

function nowIST() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

export default function SearchPanel({ onSearch, initialOrigin, initialDestination }) {
  const [origin, setOrigin] = useState(initialOrigin ?? null);
  const [destination, setDestination] = useState(initialDestination ?? null);
  const [swapCount, setSwapCount] = useState(0);
  const [gpsError, setGpsError] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [isNow, setIsNow] = useState(true);
  const [depTime, setDepTime] = useState(toLocalDatetimeStr(new Date()));
  const [clock, setClock] = useState('');

  useEffect(() => {
    function tick() {
      setClock(new Date().toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
      }));
      if (isNow) setDepTime(toLocalDatetimeStr(new Date()));
    }
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [isNow]);

  function swap() {
    setOrigin(destination);
    setDestination(origin);
    setSwapCount((c) => c + 1);
  }

  function handleGps() {
    if (!navigator.geolocation) {
      setGpsError('Geolocation not supported by this browser');
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLoading(false);
        setOrigin({
          name: 'Current location',
          address: '',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        setGpsLoading(false);
        setGpsError(
          err.code === 1 ? 'Location access denied' : 'Could not get your location'
        );
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!origin || !destination) return;
    const departureTime = isNow ? new Date().toISOString() : new Date(depTime).toISOString();
    onSearch(origin, destination, departureTime);
  }

  const biasCoords = origin ? { lat: origin.lat, lng: origin.lng } : undefined;

  return (
    <form className="search-panel" onSubmit={handleSubmit} noValidate>
      <div className="search-fields">
        <div className="search-origin-row">
          <PlaceInput
            key={`origin-${swapCount}`}
            label="From"
            value={origin}
            onSelect={setOrigin}
          />
          <button
            type="button"
            className={`gps-btn${gpsLoading ? ' gps-btn--loading' : ''}`}
            aria-label="Use my location"
            onClick={handleGps}
            disabled={gpsLoading}
          >
            {gpsLoading ? '…' : '⊙'}
          </button>
        </div>

        <div className="search-swap-row">
          <button
            type="button"
            className="swap-btn"
            aria-label="Swap origin and destination"
            onClick={swap}
          >
            ⇅
          </button>
        </div>

        <PlaceInput
          key={`dest-${swapCount}`}
          label="To"
          value={destination}
          onSelect={setDestination}
          biasCoords={biasCoords}
        />
      </div>

      <div className="search-time-row">
        <span className="search-clock">{clock} IST</span>
        <div className="time-picker-row">
          <button
            type="button"
            className={`time-now-btn${isNow ? ' time-now-btn--active' : ''}`}
            onClick={() => { setIsNow(true); setDepTime(toLocalDatetimeStr(new Date())); }}
          >
            Now
          </button>
          <input
            type="datetime-local"
            className="time-input"
            value={depTime}
            onChange={(e) => { setIsNow(false); setDepTime(e.target.value); }}
          />
        </div>
      </div>

      {gpsError && <p className="error gps-error">{gpsError}</p>}

      <button
        type="submit"
        className="search-btn"
        disabled={!origin || !destination}
      >
        Find routes
      </button>
    </form>
  );
}
