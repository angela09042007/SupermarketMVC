const db = require('../db');

const PayPalTransactions = {
  create(data, callback) {
    const sql = `
      INSERT INTO paypal_transactions
      (order_id, paypal_order_id, capture_id, payer_id, payer_email, amount, currency, status, captured_at, raw_response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.orderId || null,
      data.paypalOrderId,
      data.captureId || null,
      data.payerId || null,
      data.payerEmail || null,
      data.amount,
      data.currency,
      data.status,
      data.capturedAt || null,
      JSON.stringify(data.raw || {})
    ];
    db.query(sql, params, callback);
  }
};

module.exports = PayPalTransactions;
