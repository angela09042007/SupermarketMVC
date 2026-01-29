const Cart = require('../models/cart');
const Wallets = require('../models/wallets');
const cartController = require('./cartController');
const paypal = require('../services/paypal');
const nets = require('../services/nets');

function normalizeAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    if (amount <= 0) return null;
    return Number(amount.toFixed(2));
}

function getCartTotal(cart) {
    return cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
}


function resolveCartDiscount(req, cartTotal) {
    const discount = req.session.cartDiscount && Number(req.session.cartDiscount.amount);
    if (!Number.isFinite(discount) || discount <= 0) return 0;
    return Number(Math.min(discount, cartTotal).toFixed(2));
}

const walletController = {
    view(req, res) {
        const userId = req.session.user && req.session.user.id;
        if (!userId) {
            req.flash('error', 'Please log in to view your wallet.');
            return res.redirect('/login');
        }

        Wallets.getOrCreate(userId, (walletErr, wallet) => {
            if (walletErr) {
                req.flash('error', 'Could not load wallet.');
                return res.redirect('/shopping');
            }
            return Wallets.listTransactions(userId, 20, (txErr, transactions) => {
                if (txErr) {
                    req.flash('error', 'Could not load wallet history.');
                    return res.redirect('/shopping');
                }
                return res.render('wallet', {
                    user: req.session.user,
                    wallet,
                    transactions,
                    messages: req.flash('success'),
                    errors: req.flash('error')
                });
            });
        });
    },

    applyToCart(req, res) {
        const userId = req.session.user && req.session.user.id;
        if (!userId) {
            req.flash('cartError', 'Please log in to use your wallet.');
            return res.redirect('/login');
        }
        const requestedAmount = normalizeAmount(req.body.amount);

        Cart.getCart(userId, (cartErr, cart) => {
            if (cartErr) {
                req.flash('cartError', 'Could not load cart.');
                return res.redirect('/cart');
            }
            const cartTotal = getCartTotal(cart);
            if (!cartTotal) {
                req.flash('cartError', 'Your cart is empty.');
                return res.redirect('/cart');
            }
            const discountAmount = resolveCartDiscount(req, cartTotal);
            const discountedTotal = Number(Math.max(0, cartTotal - discountAmount).toFixed(2));

            Wallets.getOrCreate(userId, (walletErr, wallet) => {
                if (walletErr) {
                    req.flash('cartError', 'Could not load wallet.');
                    return res.redirect('/cart');
                }
                const balance = wallet ? Number(wallet.balance) : 0;
                const maxApply = Math.min(balance, discountedTotal);
                const applyAmount = requestedAmount ? Math.min(requestedAmount, maxApply) : maxApply;

                if (!applyAmount || applyAmount <= 0) {
                    delete req.session.walletAppliedAmount;
                    req.flash('cartError', 'No wallet balance available to apply.');
                    return res.redirect('/cart');
                }

                req.session.walletAppliedAmount = Number(applyAmount.toFixed(2));
                req.flash('cartMessage', `Wallet applied: S$${applyAmount.toFixed(2)}.`);
                return res.redirect('/cart');
            });
        });
    },

    removeFromCart(req, res) {
        delete req.session.walletAppliedAmount;
        req.flash('cartMessage', 'Wallet removed from cart.');
        return res.redirect('/cart');
    },

    checkout(req, res) {
        const userId = req.session.user && req.session.user.id;
        if (!userId) {
            req.flash('cartError', 'Please log in to use your wallet.');
            return res.redirect('/login');
        }

        Cart.getCart(userId, (cartErr, cart) => {
            if (cartErr) {
                req.flash('cartError', 'Could not load cart.');
                return res.redirect('/cart');
            }
            const cartTotal = getCartTotal(cart);
            if (!cartTotal) {
                req.flash('cartError', 'Your cart is empty.');
                return res.redirect('/cart');
            }
            const discountAmount = resolveCartDiscount(req, cartTotal);
            const discountedTotal = Number(Math.max(0, cartTotal - discountAmount).toFixed(2));
            Wallets.getOrCreate(userId, (walletErr, wallet) => {
                if (walletErr) {
                    req.flash('cartError', 'Could not load wallet.');
                    return res.redirect('/cart');
                }
                const balance = wallet ? Number(wallet.balance) : 0;
                if (balance < discountedTotal) {
                    req.flash('cartError', 'Wallet balance is not enough to cover this order.');
                    return res.redirect('/cart');
                }
                req.session.walletAppliedAmount = Number(discountedTotal.toFixed(2));
                return cartController.checkout(req, res);
            });
        });
    },

    createTopupPaypalOrder(req, res) {
        const userId = req.session.user && req.session.user.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const amount = normalizeAmount(req.body.amount);
        if (!amount) {
            return res.status(400).json({ error: 'Invalid top up amount.' });
        }
        req.session.walletTopupAmount = amount;
        req.session.walletTopupMethod = 'paypal';
        return paypal.createOrder(amount.toFixed(2), 'SGD')
            .then(order => {
                if (order && order.id) {
                    return res.json({ id: order.id });
                }
                return res.status(500).json({ error: 'Failed to create PayPal order', details: order });
            })
            .catch(err => {
                return res.status(500).json({ error: 'Failed to create PayPal order', message: err.message });
            });
    },

    captureTopupPaypalOrder(req, res) {
        const userId = req.session.user && req.session.user.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { orderID } = req.body;
        if (!orderID) {
            return res.status(400).json({ error: 'Missing orderID' });
        }
        return paypal.captureOrder(orderID)
            .then(capture => {
                if (capture.status !== 'COMPLETED') {
                    return res.status(400).json({ error: 'Payment not completed', details: capture });
                }
                const unit = capture.purchase_units && capture.purchase_units[0];
                const cap = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
                const capturedAmount = cap && cap.amount ? Number(cap.amount.value) : 0;
                const sessionAmount = normalizeAmount(req.session.walletTopupAmount);
                if (!sessionAmount || capturedAmount <= 0 || Math.abs(capturedAmount - sessionAmount) > 0.01) {
                    return res.status(400).json({ error: 'Top up amount mismatch.' });
                }
                return Wallets.credit(userId, capturedAmount, {
                    description: `Wallet top up via PayPal (${cap && cap.id ? cap.id : 'capture'})`,
                    referenceType: 'paypal'
                }, (walletErr) => {
                    if (walletErr) {
                        return res.status(500).json({ error: 'Could not credit wallet.' });
                    }
                    delete req.session.walletTopupAmount;
                    delete req.session.walletTopupMethod;
                    return res.json({ success: true, amount: capturedAmount });
                });
            })
            .catch(err => {
                return res.status(500).json({ error: 'Failed to capture PayPal order', message: err.message });
            });
    },

    topupWithNets(req, res) {
        const userId = req.session.user && req.session.user.id;
        if (!userId) {
            req.flash('error', 'Please log in to top up your wallet.');
            return res.redirect('/login');
        }
        const amount = normalizeAmount(req.body.amount);
        if (!amount) {
            req.flash('error', 'Please enter a valid top up amount.');
            return res.redirect('/wallet');
        }
        req.session.walletTopupAmount = amount;
        req.session.walletTopupMethod = 'nets';

        return nets.requestQrCode(amount.toFixed(2))
            .then(response => {
                const qrData = response && response.result && response.result.data ? response.result.data : {};
                if (qrData.response_code === '00' && qrData.txn_status === 1 && qrData.qr_code) {
                    req.session.walletTopupTxnRef = qrData.txn_retrieval_ref;
                    return res.render('netsQr', {
                        title: 'NETS Wallet Top Up',
                        total: amount.toFixed(2),
                        qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
                        txnRetrievalRef: qrData.txn_retrieval_ref,
                        timer: 300,
                        backUrl: '/wallet',
                        successUrl: '/wallet/topup/nets/success',
                        failUrl: '/wallet/topup/nets/fail'
                    });
                }

                let errorMsg = 'An error occurred while generating the QR code.';
                if (qrData.network_status !== 0) {
                    errorMsg = qrData.error_message || 'Transaction failed. Please try again.';
                }
                return res.render('netsQrFail', {
                    title: 'NETS QR Error',
                    responseCode: qrData.response_code || 'N.A.',
                    instructions: qrData.instruction || '',
                    errorMsg
                });
            })
            .catch(error => {
                console.error('NETS top up error:', error.message);
                req.flash('error', 'Could not start NETS top up.');
                return res.redirect('/wallet');
            });
    },

    topupNetsSuccess(req, res) {
        const userId = req.session.user && req.session.user.id;
        if (!userId) {
            req.flash('error', 'Please log in to view your wallet.');
            return res.redirect('/login');
        }
        const txnRef = req.query.txn_retrieval_ref;
        const expectedRef = req.session.walletTopupTxnRef;
        const amount = normalizeAmount(req.session.walletTopupAmount);
        if (!amount || !expectedRef || txnRef !== expectedRef) {
            req.flash('error', 'Unable to confirm NETS top up.');
            return res.redirect('/wallet');
        }

        return Wallets.credit(userId, amount, {
            description: `Wallet top up via NETS (${txnRef})`,
            referenceType: 'nets'
        }, (walletErr) => {
            if (walletErr) {
                req.flash('error', 'Could not credit wallet.');
                return res.redirect('/wallet');
            }
            delete req.session.walletTopupAmount;
            delete req.session.walletTopupMethod;
            delete req.session.walletTopupTxnRef;
            req.flash('success', `Wallet topped up by S$${amount.toFixed(2)}.`);
            return res.redirect('/wallet');
        });
    },

    topupNetsFail(req, res) {
        delete req.session.walletTopupAmount;
        delete req.session.walletTopupMethod;
        delete req.session.walletTopupTxnRef;
        req.flash('error', 'NETS top up failed or timed out.');
        return res.redirect('/wallet');
    }
};

module.exports = walletController;
