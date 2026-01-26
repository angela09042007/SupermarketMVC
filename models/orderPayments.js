const db = require('../db');

const OrderPayments = {
    createMany(orderId, payments, callback) {
        if (!payments || !payments.length) {
            return callback(null);
        }
        const values = payments.map(p => [
            orderId,
            p.method,
            p.amount,
            p.currency || 'SGD',
            p.referenceId || null
        ]);
        const sql = `
            INSERT INTO order_payments (order_id, method, amount, currency, reference_id)
            VALUES ?
        `;
        db.query(sql, [values], callback);
    },

    listByOrderId(orderId, callback) {
        const sql = `
            SELECT id, order_id, method, amount, currency, reference_id
            FROM order_payments
            WHERE order_id = ?
            ORDER BY id ASC
        `;
        db.query(sql, [orderId], (err, rows) => {
            if (err) return callback(err);
            const payments = (rows || []).map(r => ({
                id: r.id,
                orderId: r.order_id,
                method: r.method,
                amount: Number(r.amount),
                currency: r.currency,
                referenceId: r.reference_id
            }));
            return callback(null, payments);
        });
    }
};

module.exports = OrderPayments;
