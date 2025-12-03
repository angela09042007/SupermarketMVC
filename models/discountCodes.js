const db = require('../db');

/**
 * DiscountCode model handles CRUD and lookup for promo codes.
 */
const DiscountCodes = {
    getAll(callback) {
        const sql = 'SELECT * FROM discount_codes ORDER BY created_at DESC';
        db.query(sql, callback);
    },

    getById(id, callback) {
        const sql = 'SELECT * FROM discount_codes WHERE id = ?';
        db.query(sql, [id], (err, rows) => callback(err, rows && rows[0]));
    },

    getByCode(code, callback) {
        const sql = `
            SELECT *
            FROM discount_codes
            WHERE code = ?
              AND (expires_at IS NULL OR expires_at > NOW())
              AND (uses_remaining IS NULL OR uses_remaining > 0)
        `;
        db.query(sql, [code], (err, rows) => callback(err, rows && rows[0]));
    },

    create(data, callback) {
        const sql = `
            INSERT INTO discount_codes (code, description, percent_off, uses_remaining, expires_at, active)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const params = [
            data.code,
            data.description || '',
            data.percent_off || null,
            data.uses_remaining || null,
            data.expires_at || null,
            data.active ? 1 : 0
        ];
        db.query(sql, params, callback);
    },

    update(id, data, callback) {
        const sql = `
            UPDATE discount_codes
            SET code = ?, description = ?, percent_off = ?,
                uses_remaining = ?, expires_at = ?, active = ?
            WHERE id = ?
        `;
        const params = [
            data.code,
            data.description || '',
            data.percent_off || null,
            data.uses_remaining || null,
            data.expires_at || null,
            data.active ? 1 : 0,
            id
        ];
        db.query(sql, params, callback);
    },

    delete(id, callback) {
        const sql = 'DELETE FROM discount_codes WHERE id = ?';
        db.query(sql, [id], callback);
    },

    decrementUse(id, callback) {
        const sql = `
            UPDATE discount_codes
            SET uses_remaining = CASE
                WHEN uses_remaining IS NULL THEN NULL
                WHEN uses_remaining > 0 THEN uses_remaining - 1
                ELSE 0 END
            WHERE id = ?
        `;
        db.query(sql, [id], callback);
    }
};

module.exports = DiscountCodes;
