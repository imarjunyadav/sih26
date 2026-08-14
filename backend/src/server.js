import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { journeysRouter } from './api/journeys.js';
import { placesRouter }   from './api/places.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, '../../frontend/dist');

const app = express();
app.use(express.json({ limit: '256kb' }));

app.use('/api', journeysRouter);
app.use('/api', placesRouter);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'sih26-backend',
    env: config.nodeEnv,
    time: new Date().toISOString(),
    providers: {
      googleRoutes: Boolean(config.googleKey),
      railRadar: Boolean(config.railRadarKey)
    }
  });
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
