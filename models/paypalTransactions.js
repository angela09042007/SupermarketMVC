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
  },
  findByOrderId(orderId, callback) {
    const sql = `
      SELECT id, order_id, paypal_order_id, capture_id, payer_id, payer_email, amount, currency, status, captured_at
      FROM paypal_transactions
      WHERE order_id = ?
      ORDER BY id DESC
      LIMIT 1
    `;
    db.query(sql, [orderId], (err, rows) => {
      if (err) return callback(err);
      const row = rows && rows[0];
      if (!row) return callback(null, null);
      return callback(null, {
        id: row.id,
        orderId: row.order_id,
        paypalOrderId: row.paypal_order_id,
        captureId: row.capture_id,
        payerId: row.payer_id,
        payerEmail: row.payer_email,
        amount: Number(row.amount),
        currency: row.currency,
        status: row.status,
        capturedAt: row.captured_at
      });
    });
  }
};

module.exports = PayPalTransactions;
