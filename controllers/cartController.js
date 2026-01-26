const Cart = require('../models/cart');
const Orders = require('../models/orders');
const paypal = require('../services/paypal');
const PayPalTransactions = require('../models/paypalTransactions');
const Wallets = require('../models/wallets');
const OrderPayments = require('../models/orderPayments');
const OrderDiscounts = require('../models/orderDiscounts');

function getCartTotal(cart) {
    return cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
}

function normalizeAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    if (amount <= 0) return null;
    return Number(amount.toFixed(2));
}

function resolveWalletApplied(req, cartTotal, walletBalance) {
    const applied = normalizeAmount(req.session.walletAppliedAmount);
    if (!applied) return 0;
    return Number(Math.min(applied, walletBalance, cartTotal).toFixed(2));
}

function resolveCartDiscount(req, cartTotal) {
    const discount = req.session.cartDiscount && Number(req.session.cartDiscount.amount);
    if (!Number.isFinite(discount) || discount <= 0) {
        return 0;
    }
    return Number(Math.min(discount, cartTotal).toFixed(2));
}

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

        const cartTotal = getCartTotal(cart);
        const discountAmount = resolveCartDiscount(req, cartTotal);
        const discountedTotal = Number(Math.max(0, cartTotal - discountAmount).toFixed(2));

        Wallets.getOrCreate(userId, (walletErr, wallet) => {
            if (walletErr) {
                console.error('Wallet load error:', walletErr);
                req.flash('cartError', 'Could not load wallet.');
                return res.redirect('/cart');
            }
            const walletBalance = wallet ? Number(wallet.balance) : 0;
            const walletApplied = resolveWalletApplied(req, discountedTotal, walletBalance);
            if (walletApplied > 0) {
                req.session.walletAppliedAmount = walletApplied;
            } else {
                delete req.session.walletAppliedAmount;
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

                            const finalizeCommit = () => {
                                const payments = [];
                                if (walletApplied > 0) {
                                    payments.push({
                                        method: 'wallet',
                                        amount: walletApplied,
                                        currency: 'SGD'
                                    });
                                }
                                const netsAmount = normalizeAmount(req.session.netsPaidAmount);
                                if (netsAmount) {
                                    payments.push({
                                        method: 'nets',
                                        amount: netsAmount,
                                        currency: 'SGD',
                                        referenceId: req.session.netsPaidTxnRef || null
                                    });
                                }

                                return OrderDiscounts.create(order.orderId, {
                                    code: req.session.cartDiscount && req.session.cartDiscount.code,
                                    amount: discountAmount,
                                    currency: 'SGD'
                                }, (discountErr) => {
                                    if (discountErr) {
                                        console.error('Order discount save error:', discountErr);
                                        return Cart.rollback(() => {
                                            req.flash('cartError', 'Could not complete purchase. Please try again.');
                                            res.redirect('/cart');
                                        });
                                    }

                                    return OrderPayments.createMany(order.orderId, payments, (payErr) => {
                                    if (payErr) {
                                        console.error('Order payment save error:', payErr);
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
                                            delete req.session.walletAppliedAmount;
                                            delete req.session.cartDiscount;
                                            delete req.session.netsPaidAmount;
                                            delete req.session.netsPaidTxnRef;
                                            delete req.session.netsTxnRetrievalRef;
                                            delete req.session.netsCartTotal;
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
                                });
                            };

                            if (walletApplied > 0) {
                                return Wallets.debit(userId, walletApplied, {
                                    description: `Wallet payment for order #${order.orderId}`,
                                    referenceType: 'order',
                                    referenceId: order.orderId
                                }, (walletDebitErr) => {
                                    if (walletDebitErr) {
                                        console.error('Wallet debit error:', walletDebitErr);
                                        return Cart.rollback(() => {
                                            req.flash('cartError', 'Wallet payment could not be completed.');
                                            res.redirect('/cart');
                                        });
                                    }
                                    return finalizeCommit();
                                });
                            }

                            return finalizeCommit();
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
        const cartTotal = getCartTotal(cart);
        const discountAmount = resolveCartDiscount(req, cartTotal);
        const discountedTotal = Number(Math.max(0, cartTotal - discountAmount).toFixed(2));
        Wallets.getOrCreate(userId, (walletErr, wallet) => {
            if (walletErr) {
                console.error('Wallet load error:', walletErr);
            }
            const walletBalance = wallet ? Number(wallet.balance) : 0;
            const walletApplied = resolveWalletApplied(req, discountedTotal, walletBalance);
            if (walletApplied > 0) {
                req.session.walletAppliedAmount = walletApplied;
            } else {
                delete req.session.walletAppliedAmount;
            }
            res.render('cart', {
                cart,
                cartTotal,
                discountAmount,
                walletBalance,
                walletApplied,
                payableTotal: Number(Math.max(0, discountedTotal - walletApplied).toFixed(2)),
                user: req.session.user,
                messages: req.flash('cartMessage'),
                errors: req.flash('cartError')
            });
        });
    });
};

const createPaypalOrder = (req, res) => {
    const userId = req.session.user && (req.session.user.id || req.session.user.user_id || req.session.user.userId);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    Cart.getCart(userId, async (cartErr, cart) => {
        if (cartErr) {
            return res.status(500).json({ error: 'Could not load cart.' });
        }
        if (!cart.length) {
            return res.status(400).json({ error: 'Cart is empty.' });
        }
        const total = getCartTotal(cart);
        const discountAmount = resolveCartDiscount(req, total);
        const discountedTotal = Number(Math.max(0, total - discountAmount).toFixed(2));
        Wallets.getOrCreate(userId, async (walletErr, wallet) => {
            if (walletErr) {
                return res.status(500).json({ error: 'Could not load wallet.' });
            }
            const walletBalance = wallet ? Number(wallet.balance) : 0;
            const walletApplied = resolveWalletApplied(req, discountedTotal, walletBalance);
            if (walletApplied > 0) {
                req.session.walletAppliedAmount = walletApplied;
            } else {
                delete req.session.walletAppliedAmount;
            }
            const payableTotal = Number(Math.max(0, discountedTotal - walletApplied).toFixed(2));
            if (payableTotal <= 0) {
                return res.status(400).json({ error: 'Wallet covers the full total. Use wallet checkout.' });
            }
            try {
                const order = await paypal.createOrder(payableTotal.toFixed(2), 'SGD');
                if (order && order.id) {
                    return res.json({ id: order.id });
                }
                return res.status(500).json({ error: 'Failed to create PayPal order', details: order });
            } catch (err) {
                return res.status(500).json({ error: 'Failed to create PayPal order', message: err.message });
            }
        });
    });
};

const capturePaypalOrder = async (req, res) => {
    try {
        const { orderID } = req.body;
        if (!orderID) {
            return res.status(400).json({ error: 'Missing orderID' });
        }
        const capture = await paypal.captureOrder(orderID);
        if (capture.status !== 'COMPLETED') {
            return res.status(400).json({ error: 'Payment not completed', details: capture });
        }
        return finalizePaypalCheckout(req, res, capture);
    } catch (err) {
        return res.status(500).json({ error: 'Failed to capture PayPal order', message: err.message });
    }
};

function finalizePaypalCheckout(req, res, capture) {
    const userId = req.session.user && (req.session.user.id || req.session.user.user_id || req.session.user.userId);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    Cart.getCart(userId, (cartErr, cart) => {
        if (cartErr) {
            return res.status(500).json({ error: 'Could not load cart.' });
        }
        if (!cart.length) {
            return res.status(400).json({ error: 'Cart is empty.' });
        }

        const total = getCartTotal(cart);
        const discountAmount = resolveCartDiscount(req, total);
        const discountedTotal = Number(Math.max(0, total - discountAmount).toFixed(2));
        const unit = capture.purchase_units && capture.purchase_units[0];
        const cap = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
        const capturedAmount = cap && cap.amount ? Number(cap.amount.value) : 0;

        Wallets.getOrCreate(userId, (walletErr, wallet) => {
            if (walletErr) {
                return res.status(500).json({ error: 'Could not load wallet.' });
            }
            const walletBalance = wallet ? Number(wallet.balance) : 0;
            const walletApplied = resolveWalletApplied(req, discountedTotal, walletBalance);
            if (walletApplied > 0) {
                req.session.walletAppliedAmount = walletApplied;
            } else {
                delete req.session.walletAppliedAmount;
            }
            const payableTotal = Number(Math.max(0, discountedTotal - walletApplied).toFixed(2));

            if (capturedAmount && Math.abs(capturedAmount - payableTotal) > 0.01) {
                return res.status(400).json({
                    error: 'Paid amount mismatch',
                    expected: payableTotal.toFixed(2),
                    received: capturedAmount
                });
            }

            Cart.startTransaction(err => {
                if (err) {
                    return res.status(500).json({ error: 'Could not start transaction.' });
                }

                const processItem = (index) => {
                    if (index >= cart.length) {
                        return Orders.create(userId, cart, (orderErr, order) => {
                            if (orderErr) {
                                return Cart.rollback(() => res.status(500).json({ error: 'Could not save order.' }));
                            }

                            const capturedAt = cap && cap.create_time
                                ? cap.create_time.replace('T', ' ').replace('Z', '')
                                : null;
                            const tx = {
                                orderId: order.orderId,
                                paypalOrderId: capture.id,
                                captureId: cap && cap.id,
                                payerId: capture.payer && capture.payer.payer_id,
                                payerEmail: capture.payer && capture.payer.email_address,
                                amount: capturedAmount || payableTotal,
                                currency: (cap && cap.amount && cap.amount.currency_code) || 'SGD',
                                status: capture.status,
                                capturedAt,
                                raw: capture
                            };

                            const commitOrder = () => {
                                const payments = [];
                                if (walletApplied > 0) {
                                    payments.push({
                                        method: 'wallet',
                                        amount: walletApplied,
                                        currency: 'SGD'
                                    });
                                }
                                payments.push({
                                    method: 'paypal',
                                    amount: capturedAmount || payableTotal,
                                    currency: (cap && cap.amount && cap.amount.currency_code) || 'SGD',
                                    referenceId: cap && cap.id
                                });

                                return OrderDiscounts.create(order.orderId, {
                                    code: req.session.cartDiscount && req.session.cartDiscount.code,
                                    amount: discountAmount,
                                    currency: 'SGD'
                                }, (discountErr) => {
                                    if (discountErr) {
                                        return Cart.rollback(() => res.status(500).json({ error: 'Could not save discount.' }));
                                    }

                                    return OrderPayments.createMany(order.orderId, payments, (payErr) => {
                                        if (payErr) {
                                            return Cart.rollback(() => res.status(500).json({ error: 'Could not save payment breakdown.' }));
                                        }
                                        return PayPalTransactions.create(tx, (txErr) => {
                                    if (txErr) {
                                        return Cart.rollback(() => res.status(500).json({ error: 'Could not save payment record.' }));
                                    }

                                    return Cart.commit(commitErr => {
                                        if (commitErr) {
                                            return res.status(500).json({ error: 'Could not finalize order.' });
                                        }
                                        const invoiceItems = cart.map(item => ({
                                            id: item.id,
                                            productName: item.productName,
                                            price: item.price,
                                            quantity: item.quantity,
                                            subtotal: Number(item.price) * item.quantity,
                                            image: item.image
                                        }));
                                        Cart.clearCart(userId, () => {
                                            delete req.session.walletAppliedAmount;
                                            delete req.session.cartDiscount;
                                            delete req.session.netsPaidAmount;
                                            delete req.session.netsPaidTxnRef;
                                            delete req.session.netsTxnRetrievalRef;
                                            delete req.session.netsCartTotal;
                                            req.session.lastInvoice = {
                                                orderId: order.orderId,
                                                items: invoiceItems,
                                                total,
                                                purchasedAt: new Date()
                                            };
                                            res.json({ success: true, orderId: order.orderId });
                                        });
                                    });
                                        });
                                    });
                                });
                            };

                            if (walletApplied > 0) {
                                return Wallets.debit(userId, walletApplied, {
                                    description: `Wallet payment for order #${order.orderId}`,
                                    referenceType: 'order',
                                    referenceId: order.orderId
                                }, (walletDebitErr) => {
                                    if (walletDebitErr) {
                                        return Cart.rollback(() => res.status(500).json({ error: 'Wallet payment failed.' }));
                                    }
                                    return commitOrder();
                                });
                            }

                            return commitOrder();
                        });
                    }

                    const item = cart[index];
                    Cart.decrementStock(item.id, item.quantity, (updateErr, result) => {
                        if (updateErr) {
                            return Cart.rollback(() => res.status(500).json({ error: 'Could not update stock.' }));
                        }

                        if (result.affectedRows === 0) {
                            return Cart.rollback(() => res.status(409).json({ error: `Not enough stock for ${item.productName}.` }));
                        }

                        processItem(index + 1);
                    });
                };

                processItem(0);
            });
        });
    });
}

module.exports = {
    addToCart,
    updateCartItem,
    removeCartItem,
    clearCart,
    checkout,
    viewCart,
    createPaypalOrder,
    capturePaypalOrder
};
