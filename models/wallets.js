const db = require('../db');

function normalizeAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    if (amount <= 0) return null;
    return Number(amount.toFixed(2));
}

const Wallets = {
    getOrCreate(userId, callback) {
        const insertSql = `
            INSERT INTO wallets (user_id, balance)
            VALUES (?, 0)
            ON DUPLICATE KEY UPDATE balance = balance
        `;
        db.query(insertSql, [userId], (insertErr) => {
            if (insertErr) return callback(insertErr);
            const sql = 'SELECT id, user_id, balance FROM wallets WHERE user_id = ? LIMIT 1';
            db.query(sql, [userId], (err, rows) => {
                if (err) return callback(err);
                const row = rows && rows[0];
                if (!row) return callback(null, null);
                return callback(null, {
                    id: row.id,
                    userId: row.user_id,
                    balance: Number(row.balance)
                });
            });
        });
    },

    listTransactions(userId, limit, callback) {
        const sql = `
            SELECT wt.id, wt.amount, wt.type, wt.description, wt.reference_type, wt.reference_id, wt.created_at
            FROM wallet_transactions wt
            JOIN wallets w ON w.id = wt.wallet_id
            WHERE w.user_id = ?
            ORDER BY wt.created_at DESC
            LIMIT ?
        `;
        db.query(sql, [userId, limit], (err, rows) => {
            if (err) return callback(err);
            const transactions = (rows || []).map(r => ({
                id: r.id,
                amount: Number(r.amount),
                type: r.type,
                description: r.description,
                referenceType: r.reference_type,
                referenceId: r.reference_id,
                createdAt: r.created_at
            }));
            return callback(null, transactions);
        });
    },

    credit(userId, amount, meta, callback) {
        const normalized = normalizeAmount(amount);
        if (!normalized) return callback(new Error('Invalid amount'));
        const sql = `
            INSERT INTO wallets (user_id, balance)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)
        `;
        db.query(sql, [userId, normalized], (err) => {
            if (err) return callback(err);
            Wallets.getOrCreate(userId, (walletErr, wallet) => {
                if (walletErr) return callback(walletErr);
                if (!wallet) return callback(new Error('Wallet not found'));
                const txSql = `
                    INSERT INTO wallet_transactions (wallet_id, amount, type, description, reference_type, reference_id)
                    VALUES (?, ?, 'credit', ?, ?, ?)
                `;
                const params = [
                    wallet.id,
                    normalized,
                    (meta && meta.description) || 'Wallet credit',
                    (meta && meta.referenceType) || null,
                    (meta && meta.referenceId) || null
                ];
                db.query(txSql, params, (txErr, result) => {
                    if (txErr) return callback(txErr);
                    return callback(null, result.insertId);
                });
            });
        });
    },

    debit(userId, amount, meta, callback) {
        const normalized = normalizeAmount(amount);
        if (!normalized) return callback(new Error('Invalid amount'));
        Wallets.getOrCreate(userId, (walletErr, wallet) => {
            if (walletErr) return callback(walletErr);
            if (!wallet) return callback(new Error('Wallet not found'));
            const sql = `
                UPDATE wallets
                SET balance = balance - ?
                WHERE user_id = ? AND balance >= ?
            `;
            db.query(sql, [normalized, userId, normalized], (err, result) => {
                if (err) return callback(err);
                if (!result || result.affectedRows === 0) {
                    const insufficient = new Error('INSUFFICIENT_BALANCE');
                    insufficient.code = 'INSUFFICIENT_BALANCE';
                    return callback(insufficient);
                }
                const txSql = `
                    INSERT INTO wallet_transactions (wallet_id, amount, type, description, reference_type, reference_id)
                    VALUES (?, ?, 'debit', ?, ?, ?)
                `;
                const params = [
                    wallet.id,
                    normalized,
                    (meta && meta.description) || 'Wallet debit',
                    (meta && meta.referenceType) || null,
                    (meta && meta.referenceId) || null
                ];
                db.query(txSql, params, (txErr, txResult) => {
                    if (txErr) return callback(txErr);
                    return callback(null, txResult.insertId);
                });
            });
        });
    }
};

module.exports = Wallets;
