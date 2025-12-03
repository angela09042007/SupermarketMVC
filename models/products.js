// ...existing code...
const db = require('../db');

const productsModel = {
    /**
     * Get all products
     * callback(err, results[])
     */
    getAll(callback) {
        const sql = 'SELECT id, productName, quantity, price, image FROM products';
        db.query(sql, (err, results) => {
            return callback(err, results);
        });
    },

    /**
     * Search products by name (and optionally exact id if numeric).
     * callback(err, results[])
     */
    searchByName(term, callback) {
        const lowerTerm = term.toLowerCase();
        const like = `%${lowerTerm}%`;
        const maybeId = Number(term);

        const params = [lowerTerm, like];
        let sql = `
            SELECT id, productName, quantity, price, image,
                   (LOWER(productName) = ?) AS exactMatch
            FROM products
            WHERE LOWER(productName) LIKE ?
        `;
        if (!Number.isNaN(maybeId)) {
            sql += ' OR id = ?';
            params.push(maybeId);
        }
        sql += ' ORDER BY exactMatch DESC, productName ASC';

        db.query(sql, params, (err, results) => {
            return callback(err, results);
        });
    },

    /**
     * Get a single product by ID
     * callback(err, product|null)
     */
    getById(id, callback) {
        const sql = 'SELECT id, productName, quantity, price, image FROM products WHERE id = ?';
        db.query(sql, [id], (err, results) => {
            if (err) return callback(err);
            return callback(null, results.length ? results[0] : null);
        });
    },

    /**
     * Add a new product
     * product = { productName, quantity, price, image }
     * callback(err, insertedProduct)
     */
    add(product, callback) {
        const sql = 'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)';
        const params = [product.productName, product.quantity, product.price, product.image];
        db.query(sql, params, (err, result) => {
            if (err) return callback(err);
            const inserted = Object.assign({ id: result.insertId }, product);
            return callback(null, inserted);
        });
    },

    /**
     * Update an existing product by ID
     * product = { productName, quantity, price, image }
     * callback(err, result)
     */
    update(id, product, callback) {
        const sql = 'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ? WHERE id = ?';
        const params = [product.productName, product.quantity, product.price, product.image, id];
        db.query(sql, params, (err, result) => {
            return callback(err, result);
        });
    },

    /**
     * Delete a product by ID
     * callback(err, result)
     */
    delete(id, callback) {
        const sql = 'DELETE FROM products WHERE id = ?';
        db.query(sql, [id], (err, result) => {
            return callback(err, result);
        });
    }
};

module.exports = productsModel;
// ...existing code...
