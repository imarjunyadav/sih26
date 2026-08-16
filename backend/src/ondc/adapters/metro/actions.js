/**
 * Metro TRV11 2.0.0 — BAP action payload builders.
 *
 * Each function returns a complete { context, message } object
 * ready to be signed and sent to the BPP or Gateway.
 *
 * Validated against:
 *   - api/components/examples/metro/ (search, select, init, confirm, status, support)
 *   - api/components/attributes/metro/index.yaml
 */

import crypto from 'node:crypto';
import { buildContext } from '../../core/context.js';
import { ondcConfig } from '../../config.js';

// ── Payment tags ──────────────────────────────────────────────────────────────
// Derived from TRV11 2.0.0 search/example_0.yaml and init/example_0.yaml

function buyerFinderFeesTags() {
  return [
    {
      descriptor: { code: 'BUYER_FINDER_FEES' },
      display: false,
      list: [
        { descriptor: { code: 'BUYER_FINDER_FEES_PERCENTAGE' }, value: ondcConfig.buyerFinderFeesPct },
        { descriptor: { code: 'BUYER_FINDER_FEES_TYPE' }, value: 'percent' },
      ],
    },
  ];
}

function settlementTermsTags(settlementAmount) {
  const tags = [
    { descriptor: { code: 'SETTLEMENT_WINDOW' }, value: 'PT60M' },
    { descriptor: { code: 'SETTLEMENT_BASIS' }, value: 'Delivery' },
    { descriptor: { code: 'SETTLEMENT_TYPE' }, value: 'NEFT' },
    { descriptor: { code: 'MANDATORY_ARBITRATION' }, value: 'true' },
    { descriptor: { code: 'COURT_JURISDICTION' }, value: ondcConfig.courtJurisdiction },
    { descriptor: { code: 'DELAY_INTEREST' }, value: '2.5' },
  ];

  if (ondcConfig.staticTermsUrl) {
    tags.push({ descriptor: { code: 'STATIC_TERMS' }, value: ondcConfig.staticTermsUrl });
  }

  if (settlementAmount != null) {
    tags.push({ descriptor: { code: 'SETTLEMENT_AMOUNT' }, value: String(settlementAmount) });
  }

  return [{ descriptor: { code: 'SETTLEMENT_TERMS' }, display: false, list: tags }];
}

function paymentTags(settlementAmount) {
  return [...buyerFinderFeesTags(), ...settlementTermsTags(settlementAmount)];
}

// ── Action builders ───────────────────────────────────────────────────────────

/**
 * Build a GPS-based Metro search (TRV11 2.0.0 search/example_0.yaml).
 * Also supports station-code-based search (stops with location.descriptor.code).
 *
 * @param {string} transactionId
 * @param {object} from  { gps?: '12.9,77.6', code?: 'STATION_CODE', name?: 'Station Name' }
 * @param {object} to    same
 * @returns {{ context, message }}
 */
export function buildSearch({ transactionId, from, to }) {
  const context = buildContext({ action: 'search', transactionId });

  const makeStop = (type, loc) => {
    const stop = { type, location: {} };
    if (loc.gps) stop.location.gps = loc.gps;
    if (loc.code) stop.location.descriptor = { code: loc.code };
    if (loc.name && !loc.code) stop.location.descriptor = { name: loc.name };
    return stop;
  };

  return {
    context,
    message: {
      intent: {
        fulfillment: {
          stops: [makeStop('START', from), makeStop('END', to)],
          vehicle: { category: 'METRO' },
        },
        payment: {
          collected_by: 'BAP',
          tags: paymentTags(null),
        },
      },
    },
  };
}

/**
 * Build a select message to get a fare quote.
 * TRV11 2.0.0 select/example_0.yaml
 */
export function buildSelect({ transactionId, bppId, bppUri, providerId, itemId, quantity = 1 }) {
  const context = buildContext({ action: 'select', transactionId, bppId, bppUri });
  return {
    context,
    message: {
      order: {
        provider: { id: providerId },
        items: [{ id: itemId, quantity: { selected: { count: quantity } } }],
      },
    },
  };
}

/**
 * Build an init message with billing and payment (status: NOT-PAID).
 * TRV11 2.0.0 init/example_0.yaml
 */
export function buildInit({ transactionId, bppId, bppUri, providerId, itemId, quantity = 1, billing }) {
  const context = buildContext({ action: 'init', transactionId, bppId, bppUri });
  return {
    context,
    message: {
      order: {
        provider: { id: providerId },
        items: [{ id: itemId, quantity: { selected: { count: quantity } } }],
        billing: {
          name: billing.name,
          email: billing.email,
          phone: billing.phone,
        },
        payments: [
          {
            collected_by: 'BAP',
            status: 'NOT-PAID',
            type: 'PRE-ORDER',
            tags: paymentTags(null),
          },
        ],
      },
    },
  };
}

/**
 * Build a confirm message with payment (status: PAID).
 * TRV11 2.0.0 confirm/example_0.yaml
 *
 * @param {object} opts
 * @param {string} opts.paymentId           Payment ID from on_init
 * @param {object} opts.onInitPayment       Full payment object from on_init
 * @param {string} opts.paymentTransactionId  Our payment txn ID (or generated UUID for ONDC_MOCK_PAYMENT)
 * @param {string} opts.totalAmount         Total order amount (e.g. '60')
 */
export function buildConfirm({
  transactionId,
  bppId,
  bppUri,
  providerId,
  itemId,
  quantity = 1,
  billing,
  onInitPayment,
  paymentTransactionId,
  totalAmount,
}) {
  const context = buildContext({ action: 'confirm', transactionId, bppId, bppUri });

  const txnId = ondcConfig.mockPayment
    ? crypto.randomUUID()
    : (paymentTransactionId ?? crypto.randomUUID());

  // Settle 99% of the total (BFF takes 1% finder fee)
  const feePct = Number(ondcConfig.buyerFinderFeesPct) / 100;
  const settlementAmt = totalAmount
    ? Math.floor(Number(totalAmount) * (1 - feePct)).toString()
    : null;

  const payment = {
    id: onInitPayment?.id,
    collected_by: 'BAP',
    status: 'PAID',
    type: 'PRE-ORDER',
    params: {
      transaction_id: txnId,
      currency: 'INR',
      amount: totalAmount,
      ...(onInitPayment?.params?.bank_code && { bank_code: onInitPayment.params.bank_code }),
      ...(onInitPayment?.params?.bank_account_number && {
        bank_account_number: onInitPayment.params.bank_account_number,
      }),
    },
    tags: paymentTags(settlementAmt),
  };

  // Remove undefined id
  if (!payment.id) delete payment.id;

  return {
    context,
    message: {
      order: {
        provider: { id: providerId },
        items: [{ id: itemId, quantity: { selected: { count: quantity } } }],
        billing: {
          name: billing.name,
          email: billing.email,
          phone: billing.phone,
        },
        payments: [payment],
      },
    },
  };
}

/**
 * Build a status check message.
 * TRV11 2.0.0 status/example_0.yaml
 */
export function buildStatus({ transactionId, bppId, bppUri, orderId }) {
  const context = buildContext({ action: 'status', transactionId, bppId, bppUri });
  return {
    context,
    message: { order_id: orderId },
  };
}

/**
 * Build a support message.
 * TRV11 2.0.0 support/example_0.yaml
 */
export function buildSupport({ transactionId, bppId, bppUri, refId }) {
  const context = buildContext({ action: 'support', transactionId, bppId, bppUri });
  return {
    context,
    message: { ref_id: refId },
  };
}
