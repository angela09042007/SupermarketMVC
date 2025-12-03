const Users = require('../models/users');

const authController = {
    showRegister(req, res) {
        return res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
    },

    register(req, res) {
        const { username, email, password, address, contact, role } = req.body;
        const user = { username, email, password, address, contact, role };

        Users.create(user, (err) => {
            if (err) {
                req.flash('error', 'Could not complete registration.');
                req.flash('formData', req.body);
                return res.redirect('/register');
            }
            req.flash('success', 'Registration successful! Please log in.');
            return res.redirect('/login');
        });
    },

    showLogin(req, res) {
        return res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
    },

    login(req, res) {
        const { email, password } = req.body;

        if (!email || !password) {
            req.flash('error', 'All fields are required.');
            return res.redirect('/login');
        }

        Users.findByCredentials(email, password, (err, user) => {
            if (err) {
                req.flash('error', 'Unable to log in right now.');
                return res.status(500).redirect('/login');
            }

            if (!user) {
                req.flash('error', 'Invalid email or password.');
                return res.redirect('/login');
            }

            req.session.user = user;
            req.flash('success', 'Login successful!');
            return user.role === 'user' ? res.redirect('/shopping') : res.redirect('/inventory');
        });
    },

    logout(req, res) {
        req.flash('success', 'Logged out successfully.');
        req.session.user = null;
        req.session.save(() => res.redirect('/'));
    }
};

module.exports = authController;
