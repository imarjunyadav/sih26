import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.warn(`[config] Missing env var: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  googleKey: requireEnv('GOOGLE_BACKEND_MAPS_KEY'),
  googleFrontendKey:
    process.env.GOOGLE_FRONTEND_MAPS_KEY ||
    process.env.GOOGLE_ANDROID_MAPS_KEY ||
    process.env.GOOGLE_BACKEND_MAPS_KEY,
  railRadarKey: requireEnv('RAILRADAR_API_KEY'),
  mapplsStaticKey: process.env.MAPPLS_STATIC_KEY || null
};
