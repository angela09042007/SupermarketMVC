const Refunds = require('../models/refunds');
const paypal = require('../services/paypal');
const PayPalTransactions = require('../models/paypalTransactions');

function normalizeAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    if (amount <= 0) return null;
    return Number(amount.toFixed(2));
}

function updateStatus(status) {
    return (req, res) => {
        const refundId = parseInt(req.params.refundId, 10);
        if (!refundId || Number.isNaN(refundId)) {
            req.flash('error', 'Invalid refund request.');
            return res.redirect('/orders');
        }

        if (status === 'rejected') {
            return Refunds.getById(refundId, (err, refund) => {
                if (err) {
                    console.error('Refund lookup error:', err);
                    req.flash('error', 'Could not load refund request.');
                    return res.redirect('/orders');
                }

                if (!refund) {
                    req.flash('error', 'Refund request not found.');
                    return res.redirect('/orders');
                }

                if (refund.status !== 'pending') {
                    req.flash('error', 'Refund request already processed.');
                    return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                }

                return Refunds.updateStatus(refundId, status, {
                    processedBy: req.session.user && req.session.user.id
                }, (updateErr, result) => {
                    if (updateErr) {
                        console.error('Refund update error:', updateErr);
                        req.flash('error', 'Could not update refund request.');
                        return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                    }

                    if (!result || result.affectedRows === 0) {
                        req.flash('error', 'Refund request was not updated.');
                        return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                    }

                    req.flash('success', 'Refund request rejected.');
                    return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                });
            });
        }

        Refunds.getRefundWithItem(refundId, (err, refund) => {
            if (err) {
                console.error('Refund lookup error:', err);
                req.flash('error', 'Could not load refund request.');
                return res.redirect('/orders');
            }

            if (!refund) {
                req.flash('error', 'Refund request not found.');
                return res.redirect('/orders');
            }

            if (refund.status !== 'pending') {
                req.flash('error', 'Refund request already processed.');
                return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
            }

            const itemSubtotal = Number(refund.itemPrice) * refund.itemQuantity;
            const requestedAmount = normalizeAmount(req.body.amount);
            const refundAmount = requestedAmount || Number(itemSubtotal.toFixed(2));

            if (!refundAmount || refundAmount > itemSubtotal) {
                req.flash('error', 'Refund amount must be positive and not exceed the item subtotal.');
                return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
            }

            return PayPalTransactions.findByOrderId(refund.orderId, async (txErr, tx) => {
                if (txErr) {
                    console.error('PayPal transaction lookup error:', txErr);
                    req.flash('error', 'Could not process refund.');
                    return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                }

                if (!tx || !tx.captureId) {
                    req.flash('error', 'No online payment found for this order. NETS refunds not configured.');
                    return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                }

                try {
                    const response = await paypal.refundCapture(tx.captureId, refundAmount.toFixed(2), tx.currency || 'USD');
                    if (!response || !response.id || (response.status !== 'COMPLETED' && response.status !== 'PENDING')) {
                        req.flash('error', 'Refund failed at payment gateway.');
                        return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                    }

                    return Refunds.updateStatus(refundId, status, {
                        refundAmount,
                        currency: tx.currency || 'USD',
                        paymentMethod: 'paypal',
                        refundTxnId: response.id,
                        processedBy: req.session.user && req.session.user.id
                    }, (updateErr, result) => {
                        if (updateErr) {
                            console.error('Refund update error:', updateErr);
                            req.flash('error', 'Could not update refund request.');
                            return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                        }

                        if (!result || result.affectedRows === 0) {
                            req.flash('error', 'Refund request was not updated.');
                            return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                        }

                        req.flash('success', `Refund ${refundAmount.toFixed(2)} processed via PayPal.`);
                        return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                    });
                } catch (gatewayErr) {
                    console.error('Refund gateway error:', gatewayErr);
                    req.flash('error', 'Refund failed at payment gateway.');
                    return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                }
            });
        });
    };
}

const refundController = {
    request(req, res) {
        const user = req.session.user;
        const orderItemId = parseInt(req.params.orderItemId, 10);
        const reason = (req.body.reason || '').trim();

        if (!user || !user.id) {
            req.flash('error', 'Please log in to request a refund.');
            return res.redirect('/login');
        }

        if (!orderItemId || Number.isNaN(orderItemId)) {
            req.flash('error', 'Invalid order item.');
            return res.redirect('/orders');
        }

        if (!reason) {
            req.flash('error', 'Please provide a reason for the refund request.');
            return res.redirect('/orders');
        }

        Refunds.getOrderItem(orderItemId, (err, item) => {
            if (err) {
                console.error('Refund item lookup error:', err);
                req.flash('error', 'Could not start refund request.');
                return res.redirect('/orders');
            }

            if (!item) {
                req.flash('error', 'Order item not found.');
                return res.redirect('/orders');
            }

            if (item.userId !== user.id) {
                req.flash('error', 'You can only request refunds for your own orders.');
                return res.redirect('/orders');
            }

            if (item.refundStatus) {
                req.flash('error', 'A refund request already exists for this item.');
                return res.redirect(`/orders?focus=${item.orderId}#order-${item.orderId}`);
            }

            Refunds.create({
                orderId: item.orderId,
                orderItemId: item.orderItemId,
                userId: item.userId,
                reason
            }, (createErr) => {
                if (createErr) {
                    console.error('Refund create error:', createErr);
                    req.flash('error', 'Could not submit refund request.');
                    return res.redirect(`/orders?focus=${item.orderId}#order-${item.orderId}`);
                }

                req.flash('success', 'Refund request submitted. We will review it shortly.');
                return res.redirect(`/orders?focus=${item.orderId}#order-${item.orderId}`);
            });
        });
    },
    approve: updateStatus('approved'),
    reject: updateStatus('rejected')
};

module.exports = refundController;
