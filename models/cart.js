const db = require('../db');

const CartModel = {
    getProductById(id, callback) {
        const sql = 'SELECT * FROM products WHERE id = ?';
        db.query(sql, [id], (err, results) => {
            if (err) return callback(err);
            return callback(null, results.length ? results[0] : null);
        });
    },

    getProductQuantity(id, callback) {
        const sql = 'SELECT quantity FROM products WHERE id = ?';
        db.query(sql, [id], (err, results) => {
            if (err) return callback(err);
            return callback(null, results.length ? results[0].quantity : 0);
        });
    },

    getCart(userId, callback) {
        const sql = `
            SELECT ci.product_id AS id,
                   ci.quantity AS cartQuantity,
                   p.productName,
                   p.price,
                   p.image,
                   p.quantity AS stock
            FROM cart_items ci
            JOIN products p ON p.id = ci.product_id
            WHERE ci.user_id = ?
        `;
        db.query(sql, [userId], (err, results) => {
            if (err) return callback(err);
            const cart = results.map(r => ({
                id: r.id,
                productName: r.productName,
                price: Number(r.price),
                quantity: r.cartQuantity,
                image: r.image,
                stock: r.stock
            }));
            callback(null, cart);
        });
    },

    upsertCartItem(userId, productId, quantity, callback) {
        const sql = `
            INSERT INTO cart_items (user_id, product_id, quantity)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
        `;
        db.query(sql, [userId, productId, quantity], callback);
    },

    setCartQuantity(userId, productId, quantity, callback) {
        const sql = 'UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ?';
        db.query(sql, [quantity, userId, productId], callback);
    },

    removeCartItem(userId, productId, callback) {
        const sql = 'DELETE FROM cart_items WHERE user_id = ? AND product_id = ?';
        db.query(sql, [userId, productId], callback);
    },

    clearCart(userId, callback) {
        const sql = 'DELETE FROM cart_items WHERE user_id = ?';
        db.query(sql, [userId], callback);
    },

    decrementStock(id, quantity, callback) {
        const sql = 'UPDATE products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?';
        db.query(sql, [quantity, id, quantity], callback);
    },

    startTransaction(callback) {
        db.beginTransaction(callback);
    },

    commit(callback) {
        db.commit(callback);
    },

    rollback(callback) {
        db.rollback(callback);
    }
};

module.exports = CartModel;
