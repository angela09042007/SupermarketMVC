const express = require('express');
const router = express.Router();
const { checkAuthenticated } = require('../middleware');
const orderController = require('../controllers/orderController');

router.get('/orders', checkAuthenticated, orderController.list);

module.exports = router;
