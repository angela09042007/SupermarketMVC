const Orders = require('../models/orders');
const OrderPayments = require('../models/orderPayments');
const OrderDiscounts = require('../models/orderDiscounts');

function roundCurrency(value) {
    return Number(Number(value || 0).toFixed(2));
}

function buildPaymentSummary(payments) {
    return (payments || []).reduce((acc, payment) => {
        if (payment.method === 'paypal') acc.paypal += payment.amount;
        if (payment.method === 'wallet') acc.wallet += payment.amount;
        if (payment.method === 'nets') acc.nets += payment.amount;
        return acc;
    }, { paypal: 0, wallet: 0, nets: 0 });
}

function buildRefundBreakdown(refundTotal, payments) {
    const totals = buildPaymentSummary(payments);
    const totalPaid = totals.paypal + totals.wallet + totals.nets;
    if (!totalPaid) {
        return { paypal: 0, wallet: refundTotal };
    }

    let paypalAmount = totals.paypal
        ? roundCurrency(refundTotal * (totals.paypal / totalPaid))
        : 0;
    paypalAmount = Math.min(paypalAmount, totals.paypal, refundTotal);
    let walletAmount = roundCurrency(refundTotal - paypalAmount);
    const walletCap = totals.wallet + totals.nets;
    if (walletAmount > walletCap) {
        walletAmount = walletCap;
        paypalAmount = roundCurrency(refundTotal - walletAmount);
    }

    return { paypal: paypalAmount, wallet: walletAmount };
}

function enrichOrders(orders, callback) {
    if (!orders || !orders.length) return callback(null, orders);
    let remaining = orders.length;
    let hasError = false;

    const done = (err) => {
        if (err) {
            hasError = true;
            console.error('Order enrichment error:', err);
        }
        remaining -= 1;
        if (remaining <= 0) {
            return callback(hasError ? new Error('Order enrichment failed') : null, orders);
        }
    };

    orders.forEach(order => {
        OrderPayments.listByOrderId(order.id, (payErr, payments) => {
            if (payErr) {
                order.payments = [];
                order.paymentSummary = buildPaymentSummary([]);
            } else {
                order.payments = payments || [];
                order.paymentSummary = buildPaymentSummary(order.payments);
            }

            OrderDiscounts.getByOrderId(order.id, (discErr, discount) => {
                if (discErr) {
                    order.discount = null;
                } else {
                    order.discount = discount;
                }

                const discountAmount = order.discount ? Number(order.discount.amount) : 0;
                order.netTotal = roundCurrency(Math.max(0, Number(order.total) - discountAmount));

                if (order.items && order.items.length) {
                    order.items = order.items.map(item => {
                        const refundAmount = item.refundAmount ? Number(item.refundAmount) : 0;
                        if (refundAmount > 0 && order.payments && order.payments.length) {
                            return {
                                ...item,
                                refundBreakdown: buildRefundBreakdown(refundAmount, order.payments)
                            };
                        }
                        return item;
                    });
                }
                return done(payErr || discErr ? new Error('Order enrichment failed') : null);
            });
        });
    });
}

const orderController = {
    list(req, res) {
        const term = (req.query.q || '').trim();
        const callback = (err, orders) => {
            if (err) {
                req.flash('error', 'Unable to load orders.');
                return res.redirect('/shopping');
            }
            if (term && orders && orders.length === 1) {
                return res.redirect(`/orders?focus=${orders[0].id}#order-${orders[0].id}`);
            }
            return enrichOrders(orders, () => {
                res.render('orders', {
                    user: req.session.user,
                    orders,
                    messages: req.flash('success'),
                    errors: req.flash('error'),
                    searchTerm: term,
                    focusId: req.query.focus
                });
            });
        };

        if (term) {
            Orders.search(req.session.user, term, callback);
        } else {
            Orders.list(req.session.user, callback);
        }
    }
};

module.exports = orderController;
