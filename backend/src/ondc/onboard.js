/**
 * ONDC onboarding artifacts.
 *
 * Covers:
 *   GET  /ondc/ondc-site-verification.html  — site ownership proof
 *   POST /ondc/on_subscribe                 — challenge-response for key proof
 *
 * The on_subscribe handler decrypts a challenge using the BAP's X25519
 * encryption private key (DH with the registry's ephemeral public key)
 * and returns it in plaintext. Uses Node.js built-in crypto.
 */

import crypto from 'node:crypto';
import { ondcConfig } from './config.js';

// ── DER key wrappers for X25519 (OID 1.3.101.110 = 2b 65 6e) ────────────────
const PKCS8_X25519_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

function x25519PrivateKey(base64) {
  const raw = Buffer.from(base64, 'base64').subarray(0, 32);
  return crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_X25519_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  });
}

function x25519PublicKey(base64) {
  const raw = Buffer.from(base64, 'base64');
  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_X25519_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

/**
 * Serve the ONDC site verification HTML.
 *
 * The meta tag value is: base64( Ed25519_sign(unique_req_id, privKey) )
 * where unique_req_id comes from the ONDC portal during onboarding.
 *
 * The portal checks this page to confirm we control the domain.
 */
export function siteVerificationHandler(req, res) {
  const signedContent = process.env.ONDC_SITE_VERIFICATION_SIGNED || '';

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
  <head>
    <meta name="ondc-site-verification" content="${signedContent}" />
  </head>
  <body>CityLink ONDC BAP</body>
</html>`);
}

/**
 * POST /ondc/on_subscribe
 *
 * ONDC registry calls this during subscriber onboarding.
 * Request body: { subscriber_id, challenge }
 *   where challenge is encrypted with our X25519 public key.
 *
 * We decrypt and return { answer: <plaintext challenge> }.
 *
 * Encryption scheme (ONDC spec):
 *   1. Registry generates ephemeral X25519 key pair
 *   2. ECDH with BAP's X25519 pub key → shared secret
 *   3. AES-128-ECB encrypt the challenge string
 *   4. Base64 encode
 *
 * Decryption:
 *   1. Parse the registry's ephemeral X25519 public key from the request
 *   2. ECDH with our X25519 private key → shared secret
 *   3. SHA-256 the shared secret → 16-byte AES key
 *   4. AES-128-ECB decrypt → challenge string
 */
export async function onSubscribeHandler(req, res) {
  try {
    const { subscriber_id, challenge } = req.body ?? {};

    if (!challenge) {
      return res.status(400).json({ error: 'Missing challenge' });
    }

    if (!ondcConfig.encryptionPrivateKey) {
      console.error('[on_subscribe] ONDC_ENCRYPTION_PRIVATE_KEY not set');
      return res.status(500).json({ error: 'Encryption key not configured' });
    }

    // The challenge payload is: base64( AES-128-ECB( challengeString, sharedSecret ) )
    // where sharedSecret = SHA-256( X25519-DH( ourPrivKey, registryEphemeralPubKey ) )
    //
    // Note: In some ONDC implementations, the challenge is sent with the registry's
    // ephemeral public key embedded. For now, we attempt direct decryption with the
    // onboarding's documented scheme. Adjust if the actual payload format differs.

    const answer = decryptChallenge(challenge, ondcConfig.encryptionPrivateKey);
    return res.json({ answer });
  } catch (err) {
    console.error('[on_subscribe] Error:', err.message);
    return res.status(500).json({ error: 'Failed to decrypt challenge', detail: err.message });
  }
}

function decryptChallenge(encryptedBase64, encPrivBase64) {
  // This implements the ONDC AES-128-ECB decryption scheme.
  // The registry uses our X25519 public key to derive a shared secret,
  // then encrypts the challenge with AES-128-ECB using SHA-256(sharedSecret)[0:16].
  //
  // For proper decryption we need the registry's ephemeral public key.
  // ONDC implementations typically embed it in the request or use a well-known key.
  // Implement full DH when the actual on_subscribe request format is confirmed.
  //
  // Fallback: attempt decryption with the encryption private key directly (some BPPs
  // send a simpler AES-only challenge without DH).

  const privKey = x25519PrivateKey(encPrivBase64);

  // Try to extract ephemeral pub key from challenge (ONDC format varies per implementation)
  // Standard format: { ephemeral_public_key: '<base64>', challenge: '<base64>' }
  let ephemeralPubKey = null;
  let challengeData = encryptedBase64;

  try {
    const parsed = JSON.parse(Buffer.from(encryptedBase64, 'base64').toString('utf8'));
    if (parsed.ephemeral_public_key) {
      ephemeralPubKey = parsed.ephemeral_public_key;
      challengeData = parsed.challenge;
    }
  } catch {
    // Not a JSON payload, treat as raw base64 ciphertext
  }

  if (!ephemeralPubKey) {
    throw new Error(
      'Cannot decrypt challenge without ephemeral public key. ' +
      'Check the on_subscribe request format from the ONDC registry.',
    );
  }

  const registryPubKey = x25519PublicKey(ephemeralPubKey);
  const sharedSecret = crypto.diffieHellman({ privateKey: privKey, publicKey: registryPubKey });

  // AES key = SHA-256(sharedSecret), take first 16 bytes for AES-128
  const aesKey = crypto.createHash('sha256').update(sharedSecret).digest().subarray(0, 16);
  const ciphertext = Buffer.from(challengeData, 'base64');

  const decipher = crypto.createDecipheriv('aes-128-ecb', aesKey, null);
  decipher.setAutoPadding(true);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return plaintext.toString('utf8');
}
