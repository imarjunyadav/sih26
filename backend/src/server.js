import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { journeysRouter } from './api/journeys.js';
import { placesRouter }   from './api/places.js';
import { ondcRouter }     from './ondc/router.js';
import { siteVerificationHandler } from './ondc/onboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, '../../frontend/dist');

const app = express();
// Capture raw body bytes for ONDC signature verification
app.use(express.json({
  limit: '256kb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

app.use('/api', journeysRouter);
app.use('/api', placesRouter);
// Registry verifies domain ownership by fetching this at the root path (no /ondc prefix)
app.get('/ondc-site-verification.html', siteVerificationHandler);
app.use('/ondc', ondcRouter);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'sih26-backend',
    env: config.nodeEnv,
    time: new Date().toISOString(),
    providers: {
      googleRoutes: Boolean(config.googleKey),
      railRadar: Boolean(config.railRadarKey),
      railRadarKeyConfigured: Boolean(config.railRadarKey),
    }
  });
});

// Probe RailRadar connectivity — useful for diagnosing key issues from Cloud Run.
// Only calls the API if the key is configured; does not count toward rate limits beyond one call.
app.get('/api/health/railradar', async (req, res) => {
  const { railRadarProvider } = await import('./providers/railRadar.js');
  if (!config.railRadarKey) {
    return res.status(503).json({ ok: false, error: 'RAILRADAR_API_KEY not configured' });
  }
  try {
    // Use a known busy station pair as a connectivity check
    await railRadarProvider.trainsBetween('CSMT', 'DR');
    res.json({ ok: true, message: 'RailRadar API reachable and key valid' });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

app.get('/api/config/public', (req, res) => {
  res.json({
    googleMapsKey: config.googleFrontendKey || null
  });
});

app.use(express.static(frontendDist));
app.get(/^(?!\/api).*/, (req, res, next) => {
  res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
    if (err) next();
  });
});

app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(500).json({ error: 'internal_error', message: err.message });
});

app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});
