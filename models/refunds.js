const db = require('../db');

const Refunds = {
    getById(refundId, callback) {
        const sql = `
            SELECT id, order_id, order_item_id, user_id, status, reason, refund_amount, currency, payment_method, refund_txn_id
            FROM refunds
            WHERE id = ?
            LIMIT 1
        `;
        db.query(sql, [refundId], (err, rows) => {
            if (err) return callback(err);
            const row = rows && rows[0];
            if (!row) return callback(null, null);
            return callback(null, {
                id: row.id,
                orderId: row.order_id,
                orderItemId: row.order_item_id,
                userId: row.user_id,
                status: row.status,
                reason: row.reason,
                refundAmount: row.refund_amount,
                currency: row.currency,
                paymentMethod: row.payment_method,
                refundTxnId: row.refund_txn_id
            });
        });
    },

    getRefundWithItem(refundId, callback) {
        const sql = `
            SELECT
                r.id AS refund_id,
                r.order_id,
                r.order_item_id,
                r.user_id,
                r.status,
                r.reason,
                r.refund_amount,
                r.currency,
                r.payment_method,
                r.refund_txn_id,
                oi.price,
                oi.quantity
            FROM refunds r
            JOIN order_items oi ON oi.id = r.order_item_id
            WHERE r.id = ?
            LIMIT 1
        `;
        db.query(sql, [refundId], (err, rows) => {
            if (err) return callback(err);
            const row = rows && rows[0];
            if (!row) return callback(null, null);
            return callback(null, {
                id: row.refund_id,
                orderId: row.order_id,
                orderItemId: row.order_item_id,
                userId: row.user_id,
                status: row.status,
                reason: row.reason,
                refundAmount: row.refund_amount,
                currency: row.currency,
                paymentMethod: row.payment_method,
                refundTxnId: row.refund_txn_id,
                itemPrice: Number(row.price),
                itemQuantity: row.quantity
            });
        });
    },

    getOrderItem(orderItemId, callback) {
        const sql = `
            SELECT
                oi.id AS order_item_id,
                oi.order_id,
                o.users_id AS user_id,
                r.id AS refund_id,
                r.status AS refund_status
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            LEFT JOIN refunds r ON r.order_item_id = oi.id
            WHERE oi.id = ?
            LIMIT 1
        `;

        db.query(sql, [orderItemId], (err, rows) => {
            if (err) return callback(err);
            const row = rows && rows[0];
            if (!row) return callback(null, null);
            return callback(null, {
                orderItemId: row.order_item_id,
                orderId: row.order_id,
                userId: row.user_id,
                refundId: row.refund_id,
                refundStatus: row.refund_status
            });
        });
    },

    getApprovedTotalForOrder(orderId, callback) {
        const sql = `
            SELECT COALESCE(SUM(refund_amount), 0) AS total
            FROM refunds
            WHERE order_id = ? AND status = 'approved'
        `;
        db.query(sql, [orderId], (err, rows) => {
            if (err) return callback(err);
            const total = rows && rows[0] ? Number(rows[0].total) : 0;
            return callback(null, total);
        });
    },

    updateStatus(refundId, status, data, callback) {
        const sql = `
            UPDATE refunds
            SET status = ?,
                refund_amount = ?,
                currency = ?,
                payment_method = ?,
                refund_txn_id = ?,
                processed_by = ?,
                processed_at = NOW()
            WHERE id = ? AND status = 'pending'
        `;
        const params = [
            status,
            data.refundAmount || null,
            data.currency || null,
            data.paymentMethod || null,
            data.refundTxnId || null,
            data.processedBy || null,
            refundId
        ];
        db.query(sql, params, callback);
    },

    create(data, callback) {
        const sql = `
            INSERT INTO refunds (order_id, order_item_id, user_id, reason, status)
            VALUES (?, ?, ?, ?, 'pending')
        `;
        const params = [
            data.orderId,
            data.orderItemId,
            data.userId,
            data.reason
        ];
        db.query(sql, params, callback);
    }
};

module.exports = Refunds;
