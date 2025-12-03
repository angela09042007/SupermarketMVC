const db = require('../db');

const Orders = {
    /**
     * Create an order and order items inside an active transaction.
     * Expects stock updates to have succeeded before calling.
     */
    create(userId, items, callback) {
        const total = items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
        // Column is named `users_id` in the schema
        db.query('INSERT INTO orders (users_id, total) VALUES (?, ?)', [userId, total], (err, result) => {
            if (err) return callback(err);
            const orderId = result.insertId;
            const values = items.map(i => [
                orderId,
                i.id,
                i.productName,
                Number(i.price),
                i.quantity,
                i.image || null
            ]);
            if (!values.length) return callback(null, { orderId, total });

            db.query(
                'INSERT INTO order_items (order_id, product_id, product_name, price, quantity, image) VALUES ?',
                [values],
                (itemsErr) => {
                    if (itemsErr) return callback(itemsErr);
                    return callback(null, { orderId, total });
                }
            );
        });
    },

    /**
     * List orders (with items) for a given user. If admin, list all.
     */
    list(user, callback) {
        const isAdmin = user && user.role === 'admin';
        const params = [];
        const where = isAdmin ? '' : 'WHERE o.users_id = ?';
        if (!isAdmin) params.push(user.id);

        const sql = `
            SELECT o.id, o.users_id AS user_id, o.total, o.created_at,
                   oi.product_id, oi.product_name, oi.price, oi.quantity, oi.image
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id
            ${where}
            ORDER BY o.created_at DESC, oi.id ASC
        `;

        db.query(sql, params, (err, rows) => {
            if (err) return callback(err);
            const orders = [];
            const map = new Map();

            rows.forEach(r => {
                if (!map.has(r.id)) {
                    const order = {
                        id: r.id,
                        userId: r.user_id,
                        total: Number(r.total),
                        createdAt: r.created_at,
                        items: []
                    };
                    orders.push(order);
                    map.set(r.id, order);
                }
                map.get(r.id).items.push({
                    productId: r.product_id,
                    productName: r.product_name,
                    price: Number(r.price),
                    quantity: r.quantity,
                    image: r.image
                });
            });

            callback(null, orders);
        });
    },

    /**
     * Search orders by order id or product name.
     */
    search(user, term, callback) {
        const isAdmin = user && user.role === 'admin';
        const params = [];
        const where = [];

        if (!isAdmin) {
            where.push('o.users_id = ?');
            params.push(user.id);
        }

        const like = `%${term}%`;
        if (!Number.isNaN(Number(term))) {
            where.push('(o.id = ? OR oi.product_name LIKE ? )');
            params.push(Number(term), like);
        } else {
            where.push('oi.product_name LIKE ?');
            params.push(like);
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const sql = `
            SELECT o.id, o.users_id AS user_id, o.total, o.created_at,
                   oi.product_id, oi.product_name, oi.price, oi.quantity, oi.image
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id
            ${whereSql}
            ORDER BY o.created_at DESC, oi.id ASC
        `;

        db.query(sql, params, (err, rows) => {
            if (err) return callback(err);
            const orders = [];
            const map = new Map();

            rows.forEach(r => {
                if (!map.has(r.id)) {
                    const order = {
                        id: r.id,
                        userId: r.user_id,
                        total: Number(r.total),
                        createdAt: r.created_at,
                        items: []
                    };
                    orders.push(order);
                    map.set(r.id, order);
                }
                map.get(r.id).items.push({
                    productId: r.product_id,
                    productName: r.product_name,
                    price: Number(r.price),
                    quantity: r.quantity,
                    image: r.image
                });
            });

            callback(null, orders);
        });
    }
};

module.exports = Orders;
