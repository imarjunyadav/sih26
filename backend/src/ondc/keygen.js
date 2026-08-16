/**
 * ONDC key generation utility.
 *
 * Generates the two key pairs required for ONDC BAP registration:
 *   1. Ed25519 signing key pair  (for request signing/verification)
 *   2. X25519 encryption key pair (for on_subscribe challenge decryption)
 *
 * Usage:
 *   node backend/src/ondc/keygen.js
 *
 * Output: base64-encoded keys to paste into .env and submit to ONDC portal.
 * Keys are in raw byte format (libsodium convention):
 *   private key — 64 bytes (seed[0:32] + public[32:64])
 *   public key  — 32 bytes
 */

import crypto from 'node:crypto';

function generateEd25519() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');

  // Export raw bytes
  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const pubDer = publicKey.export({ format: 'der', type: 'spki' });

  // Ed25519 PKCS8 DER: last 32 bytes = seed
  const seed = privDer.subarray(privDer.length - 32);
  // Ed25519 SPKI DER: last 32 bytes = public key
  const pub = pubDer.subarray(pubDer.length - 32);

  // libsodium format: seed(32) + public(32) for private key
  const libsodiumPriv = Buffer.concat([seed, pub]);

  return {
    privateKey: libsodiumPriv.toString('base64'),
    publicKey: pub.toString('base64'),
  };
}

function generateX25519() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');

  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const pubDer = publicKey.export({ format: 'der', type: 'spki' });

  // X25519 PKCS8 DER: last 32 bytes = raw private scalar
  const rawPriv = privDer.subarray(privDer.length - 32);
  // X25519 SPKI DER: last 32 bytes = raw public key
  const rawPub = pubDer.subarray(pubDer.length - 32);

  return {
    privateKey: rawPriv.toString('base64'),
    publicKey: rawPub.toString('base64'),
  };
}

const signing = generateEd25519();
const encryption = generateX25519();

console.log('\n=== ONDC Key Generation ===\n');
console.log('Copy these values into .env and submit public keys to the ONDC portal.\n');
console.log('# Ed25519 signing keys (for request signing):');
console.log(`ONDC_SIGNING_PRIVATE_KEY=${signing.privateKey}`);
console.log(`ONDC_SIGNING_PUBLIC_KEY=${signing.publicKey}`);
console.log('');
console.log('# X25519 encryption keys (for on_subscribe challenge decryption):');
console.log(`ONDC_ENCRYPTION_PRIVATE_KEY=${encryption.privateKey}`);
console.log(`ONDC_ENCRYPTION_PUBLIC_KEY=${encryption.publicKey}`);
console.log('');
console.log('# Submit these to the ONDC portal (signing_public_key, encryption_public_key):');
console.log(`signing_public_key:    ${signing.publicKey}`);
console.log(`encryption_public_key: ${encryption.publicKey}`);
console.log('');
