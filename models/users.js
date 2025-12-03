const db = require('../db');

const Users = {
    create(user, callback) {
        const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
        const params = [user.username, user.email, user.password, user.address, user.contact, user.role];
        db.query(sql, params, callback);
    },

    findByCredentials(email, password, callback) {
        const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
        db.query(sql, [email, password], (err, results) => {
            if (err) return callback(err);
            return callback(null, results.length ? results[0] : null);
        });
    }
};

module.exports = Users;
