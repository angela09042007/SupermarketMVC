const db = require('../db');

const OrderDiscounts = {
    create(orderId, data, callback) {
        if (!data || !data.amount || data.amount <= 0) {
            return callback(null);
        }
        const sql = `
            INSERT INTO order_discounts (order_id, code, amount, currency)
            VALUES (?, ?, ?, ?)
        `;
        const params = [
            orderId,
            data.code || null,
            data.amount,
            data.currency || 'SGD'
        ];
        db.query(sql, params, callback);
    },

    getByOrderId(orderId, callback) {
        const sql = `
            SELECT id, order_id, code, amount, currency
            FROM order_discounts
            WHERE order_id = ?
            LIMIT 1
        `;
        db.query(sql, [orderId], (err, rows) => {
            if (err) return callback(err);
            const row = rows && rows[0];
            if (!row) return callback(null, null);
            return callback(null, {
                id: row.id,
                orderId: row.order_id,
                code: row.code,
                amount: Number(row.amount),
                currency: row.currency
            });
        });
    }
};

module.exports = OrderDiscounts;
