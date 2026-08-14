import { useEffect, useState } from 'react';

export default function App() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Mumbai Multimodal</h1>
        <p className="tagline">Real Local + Metro + BEST + Walk</p>
      </header>

      <main className="app-main">
        <section className="card">
          <h2>Backend status</h2>
          {error && <p className="error">Error: {error}</p>}
          {!error && !health && <p className="muted">Checking…</p>}
          {health && (
            <ul className="status">
              <li>
                <span>Service</span>
                <strong>{health.service}</strong>
              </li>
              <li>
                <span>Environment</span>
                <strong>{health.env}</strong>
              </li>
              <li>
                <span>Google Routes</span>
                <strong className={health.providers.googleRoutes ? 'ok' : 'bad'}>
                  {health.providers.googleRoutes ? 'ready' : 'missing key'}
                </strong>
              </li>
              <li>
                <span>RailRadar</span>
                <strong className={health.providers.railRadar ? 'ok' : 'bad'}>
                  {health.providers.railRadar ? 'ready' : 'missing key'}
                </strong>
              </li>
            </ul>
          )}
        </section>

        <section className="card placeholder">
          <h2>Coming next</h2>
          <p className="muted">Destination search, route options, journey timeline.</p>
        </section>
      </main>
    </div>
  );
}
