const Cart = require('../models/cart');
const Orders = require('../models/orders');

const addToCart = (req, res) => {
    const productId = parseInt(req.params.id, 10);
    const quantity = parseInt(req.body.quantity, 10) || 1;
    const userId = req.session.user && req.session.user.id;
    if (!userId) {
        req.flash('cartError', 'Please log in to add items.');
        return res.redirect('/login');
    }

    Cart.getProductById(productId, (error, product) => {
        if (error) throw error;

        if (!product) {
            return res.status(404).send("Product not found");
        }

        Cart.getCart(userId, (cartErr, cartItems) => {
            if (cartErr) throw cartErr;

            const existingItem = cartItems.find(item => item.id === productId);
            const alreadyInCart = existingItem ? existingItem.quantity : 0;
            const available = Math.max(0, product.quantity - alreadyInCart);

            if (available <= 0) {
                req.flash('cartError', 'No stock left for this item.');
                return res.redirect('/cart');
            }

            const quantityToAdd = Math.min(quantity, available);

            Cart.upsertCartItem(userId, productId, quantityToAdd, (upsertErr) => {
                if (upsertErr) throw upsertErr;

                if (quantity > available) {
                    req.flash('cartError', `Only ${available} left in stock. Added the maximum available.`);
                }

                return res.redirect('/cart');
            });
        });
    });
};

const updateCartItem = (req, res) => {
    const productId = parseInt(req.params.id, 10);
    const quantity = Math.max(1, parseInt(req.body.quantity, 10) || 1);
    const userId = req.session.user && req.session.user.id;
    if (!userId) {
        req.flash('cartError', 'Please log in to update cart.');
        return res.redirect('/login');
    }

    Cart.getProductQuantity(productId, (error, available) => {
        if (error) throw error;

        const newQuantity = Math.min(quantity, available);

        Cart.setCartQuantity(userId, productId, newQuantity, (updateErr) => {
            if (updateErr) throw updateErr;

            if (quantity > available) {
                req.flash('cartError', `Only ${available} left in stock. Adjusted quantity.`);
            }

            res.redirect('/cart');
        });
    });
};

const removeCartItem = (req, res) => {
    const productId = parseInt(req.params.id, 10);
    const userId = req.session.user && req.session.user.id;
    if (!userId) {
        req.flash('cartError', 'Please log in to update cart.');
        return res.redirect('/login');
    }
    Cart.removeCartItem(userId, productId, () => res.redirect('/cart'));
};

const clearCart = (req, res) => {
    const userId = req.session.user && req.session.user.id;
    if (!userId) {
        req.flash('cartError', 'Please log in to update cart.');
        return res.redirect('/login');
    }
    Cart.clearCart(userId, () => res.redirect('/cart'));
};

const checkout = (req, res) => {
    const userId = req.session.user && (req.session.user.id || req.session.user.user_id || req.session.user.userId);

    if (!userId) {
        req.flash('cartError', 'Unable to identify user. Please log in again.');
        return res.redirect('/login');
    }

    Cart.getCart(userId, (cartErr, cart) => {
        if (cartErr) {
            console.error('Cart load error:', cartErr);
            req.flash('cartError', 'Could not load cart.');
            return res.redirect('/cart');
        }

        if (!cart.length) {
            req.flash('cartError', 'Your cart is empty.');
            return res.redirect('/cart');
        }

    Cart.startTransaction(err => {
        if (err) {
            console.error('Transaction error:', err);
            req.flash('cartError', 'Could not complete purchase. Please try again.');
            return res.redirect('/cart');
        }

        const processItem = (index) => {
            if (index >= cart.length) {
                // After stock updates, create order record then commit
                return Orders.create(userId, cart, (orderErr, order) => {
                    if (orderErr) {
                        console.error('Order save error:', orderErr);
                        return Cart.rollback(() => {
                            req.flash('cartError', 'Could not complete purchase. Please try again.');
                            res.redirect('/cart');
                        });
                    }

                    Cart.commit(commitErr => {
                        if (commitErr) {
                            console.error('Commit error:', commitErr);
                            req.flash('cartError', 'Could not complete purchase. Please try again.');
                            return res.redirect('/cart');
                        }
                        const invoiceItems = cart.map(item => ({
                            id: item.id,
                            productName: item.productName,
                            price: item.price,
                            quantity: item.quantity,
                            subtotal: Number(item.price) * item.quantity,
                            image: item.image
                        }));
                        const total = invoiceItems.reduce((sum, item) => sum + item.subtotal, 0);
                        Cart.clearCart(userId, () => {
                            req.session.lastInvoice = {
                                orderId: order.orderId,
                                items: invoiceItems,
                                total,
                                purchasedAt: new Date()
                            };
                            req.flash('cartMessage', `Purchase successful. Order #${order.orderId}`);
                            res.redirect('/invoice');
                        });
                    });
                });
            }

            const item = cart[index];
            Cart.decrementStock(item.id, item.quantity, (updateErr, result) => {
                if (updateErr) {
                    console.error('Update error:', updateErr);
                    return Cart.rollback(() => {
                        req.flash('cartError', 'Could not complete purchase. Please try again.');
                        res.redirect('/cart');
                    });
                }

                if (result.affectedRows === 0) {
                    return Cart.rollback(() => {
                        req.flash('cartError', `Not enough stock for ${item.productName}.`);
                        res.redirect('/cart');
                    });
                }

                processItem(index + 1);
            });
        };

        processItem(0);
    });
    });
};

const viewCart = (req, res) => {
    const userId = req.session.user && req.session.user.id;
    if (!userId) {
        req.flash('cartError', 'Please log in to view cart.');
        return res.redirect('/login');
    }
    Cart.getCart(userId, (err, cart) => {
        if (err) {
            console.error('Cart load error:', err);
            req.flash('cartError', 'Could not load cart.');
            return res.redirect('/shopping');
        }
        res.render('cart', {
            cart,
            user: req.session.user,
            messages: req.flash('cartMessage'),
            errors: req.flash('cartError')
        });
    });
};

module.exports = {
    addToCart,
    updateCartItem,
    removeCartItem,
    clearCart,
    checkout,
    viewCart
};
