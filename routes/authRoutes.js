const express = require('express');
const router = express.Router();
const { validateRegistration } = require('../middleware');
const authController = require('../controllers/authController');

router.get('/register', authController.showRegister);
router.post('/register', validateRegistration, authController.register);

router.get('/login', authController.showLogin);
router.post('/login', authController.login);

router.get('/logout', authController.logout);

module.exports = router;
