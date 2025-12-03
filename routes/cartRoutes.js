const express = require('express');
const router = express.Router();
const { checkAuthenticated } = require('../middleware');
const cartController = require('../controllers/cartController');

router.post('/add-to-cart/:id', checkAuthenticated, cartController.addToCart);
router.post('/cart/update/:id', checkAuthenticated, cartController.updateCartItem);
router.post('/cart/remove/:id', checkAuthenticated, cartController.removeCartItem);
router.post('/cart/clear', checkAuthenticated, cartController.clearCart);
router.post('/cart/checkout', checkAuthenticated, cartController.checkout);
router.get('/cart', checkAuthenticated, cartController.viewCart);

router.get('/invoice', checkAuthenticated, (req, res) => {
    const invoice = req.session.lastInvoice;
    if (!invoice || !invoice.items || !invoice.items.length) {
        req.flash('cartError', 'No recent purchase to show.');
        return res.redirect('/cart');
    }
    res.render('invoice', {
        invoice,
        user: req.session.user,
        messages: req.flash('cartMessage'),
        errors: req.flash('cartError')
    });
});

module.exports = router;
