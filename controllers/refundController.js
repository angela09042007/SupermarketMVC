const Refunds = require('../models/refunds');
const paypal = require('../services/paypal');
const PayPalTransactions = require('../models/paypalTransactions');
const Wallets = require('../models/wallets');
const OrderPayments = require('../models/orderPayments');
const OrderDiscounts = require('../models/orderDiscounts');

function normalizeAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    if (amount <= 0) return null;
    return Number(amount.toFixed(2));
}

function roundCurrency(value) {
    return Number(Number(value || 0).toFixed(2));
}

function prorateDiscount(discountAmount, itemSubtotal, orderSubtotal) {
    if (!discountAmount || !orderSubtotal) return 0;
    return roundCurrency(discountAmount * (itemSubtotal / orderSubtotal));
}

function buildRefundBreakdown(refundTotal, payments) {
    const totals = payments.reduce((acc, payment) => {
        if (payment.method === 'paypal') acc.paypal += payment.amount;
        if (payment.method === 'wallet') acc.wallet += payment.amount;
        if (payment.method === 'nets') acc.nets += payment.amount;
        return acc;
    }, { paypal: 0, wallet: 0, nets: 0 });

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

function handleRefundDecision(req, res, status, refundId) {
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

            return Refunds.getRefundsForOrder(refund.orderId, (orderErr, refundsForOrder) => {
                if (orderErr) {
                    console.error('Refund order lookup error:', orderErr);
                    req.flash('error', 'Could not load refund request.');
                    return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                }

                const nonPending = refundsForOrder.filter(r => r.status !== 'pending');
                if (nonPending.length) {
                    req.flash('error', 'Refund request already processed.');
                    return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                }

                const isFullOrderRefund = refundsForOrder.length > 1;
                const data = {
                    processedBy: req.session.user && req.session.user.id
                };
                const onUpdate = (updateErr, result) => {
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
                };

                if (isFullOrderRefund) {
                    return Refunds.updateStatusForOrder(refund.orderId, status, data, onUpdate);
                }
                return Refunds.updateStatus(refundId, status, data, onUpdate);
            });
        });
    }

    return Refunds.getRefundWithItem(refundId, (err, refund) => {
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

        return Refunds.getRefundsForOrder(refund.orderId, (orderErr, refundsForOrder) => {
            if (orderErr) {
                console.error('Refund order lookup error:', orderErr);
                req.flash('error', 'Could not load refund request.');
                return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
            }

            const nonPending = refundsForOrder.filter(r => r.status !== 'pending');
            if (nonPending.length) {
                req.flash('error', 'Refund request already processed.');
                return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
            }

            const isFullOrderRefund = refundsForOrder.length > 1;
            const itemSubtotal = Number(refund.itemPrice) * refund.itemQuantity;
            const orderSubtotal = refundsForOrder.reduce((sum, item) => sum + (item.itemPrice * item.itemQuantity), 0);

            return OrderDiscounts.getByOrderId(refund.orderId, (discountErr, discount) => {
                if (discountErr) {
                    console.error('Order discount lookup error:', discountErr);
                    req.flash('error', 'Could not process refund.');
                    return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                }

                const discountAmount = discount ? Number(discount.amount) : 0;
                let refundTotal = itemSubtotal;

                if (isFullOrderRefund) {
                    refundTotal = roundCurrency(orderSubtotal - discountAmount);
                } else {
                    const requestedAmount = normalizeAmount(req.body.amount);
                    refundTotal = requestedAmount || roundCurrency(itemSubtotal);
                    if (!refundTotal || refundTotal > itemSubtotal) {
                        req.flash('error', 'Refund amount must be positive and not exceed the item subtotal.');
                        return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                    }
                    const discountShare = prorateDiscount(discountAmount, itemSubtotal, orderSubtotal);
                    refundTotal = roundCurrency(Math.max(0, refundTotal - discountShare));
                }

                return OrderPayments.listByOrderId(refund.orderId, (payErr, payments) => {
                    if (payErr) {
                        console.error('Order payment lookup error:', payErr);
                        req.flash('error', 'Could not process refund.');
                        return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                    }

                    const hasPaypal = payments.some(p => p.method === 'paypal');
                    const processPayments = (finalPayments) => {
                        const finalizeStatusUpdate = (paymentMethod, refundTxnId, message, actualRefundTotal) => {
                            const data = {
                                refundAmount: roundCurrency(actualRefundTotal),
                                currency: 'SGD',
                                paymentMethod,
                                refundTxnId,
                                processedBy: req.session.user && req.session.user.id
                            };
                            const onUpdate = (updateErr, result) => {
                                if (updateErr) {
                                    console.error('Refund update error:', updateErr);
                                    req.flash('error', 'Could not update refund request.');
                                    return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                                }

                                if (!result || result.affectedRows === 0) {
                                    req.flash('error', 'Refund request was not updated.');
                                    return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                                }

                                req.flash('success', message);
                                return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                            };

                            if (isFullOrderRefund) {
                                return Refunds.updateStatusForOrder(refund.orderId, status, data, onUpdate);
                            }
                            return Refunds.updateStatus(refundId, status, data, onUpdate);
                        };

                        const fallbackPayPalOrWallet = () => {
                            return PayPalTransactions.findByOrderId(refund.orderId, async (txErr, tx) => {
                                if (txErr) {
                                    console.error('PayPal transaction lookup error:', txErr);
                                    req.flash('error', 'Could not process refund.');
                                    return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                                }

                                if (!tx || !tx.captureId) {
                                    return Wallets.credit(refund.userId, refundTotal, {
                                        description: `Refund for order #${refund.orderId}`,
                                        referenceType: 'refund',
                                        referenceId: refund.id
                                    }, (walletErr, walletTxnId) => {
                                        if (walletErr) {
                                            console.error('Wallet credit error:', walletErr);
                                            req.flash('error', 'Could not credit wallet for refund.');
                                            return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                                        }

                                        return finalizeStatusUpdate('wallet', walletTxnId, `Refund S$${roundCurrency(refundTotal).toFixed(2)} credited to wallet.`, refundTotal);
                                    });
                                }

                                const cappedAmount = roundCurrency(Math.min(refundTotal, Number(tx.amount) || refundTotal));
                                try {
                                    const response = await paypal.refundCapture(tx.captureId, cappedAmount.toFixed(2), tx.currency || 'SGD');
                                    if (!response || !response.id || (response.status !== 'COMPLETED' && response.status !== 'PENDING')) {
                                        req.flash('error', 'Refund failed at payment gateway.');
                                        return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                                    }

                                    return finalizeStatusUpdate('paypal', response.id, `Refund S$${roundCurrency(cappedAmount).toFixed(2)} processed via PayPal.`, cappedAmount);
                                } catch (gatewayErr) {
                                    console.error('Refund gateway error:', gatewayErr);
                                    req.flash('error', 'Refund failed at payment gateway.');
                                    return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                                }
                            });
                        };

                        if (!finalPayments || !finalPayments.length) {
                            return fallbackPayPalOrWallet();
                        }

                        const breakdown = buildRefundBreakdown(roundCurrency(refundTotal), finalPayments);
                        const paypalAmount = breakdown.paypal;
                        const walletAmount = breakdown.wallet;
                        const actualRefundTotal = roundCurrency(paypalAmount + walletAmount);
                        const paymentMethod = paypalAmount > 0 && walletAmount > 0
                            ? 'mixed'
                            : (paypalAmount > 0 ? 'paypal' : 'wallet');

                        const paypalPayment = finalPayments.find(p => p.method === 'paypal');
                        const captureId = paypalPayment && paypalPayment.referenceId;

                        const processWalletCredit = (amount, callback) => {
                            if (!amount) return callback(null, null);
                            return Wallets.credit(refund.userId, amount, {
                                description: `Refund for order #${refund.orderId}`,
                                referenceType: 'refund',
                                referenceId: refund.id
                            }, (walletErr, walletTxnId) => {
                                if (walletErr) return callback(walletErr);
                                return callback(null, walletTxnId);
                            });
                        };

                        const processPayPalRefund = async (amount) => {
                            if (!amount) return null;
                            let targetCaptureId = captureId;
                            if (!targetCaptureId) {
                                const tx = await new Promise((resolve, reject) => {
                                    PayPalTransactions.findByOrderId(refund.orderId, (txErr, record) => {
                                        if (txErr) return reject(txErr);
                                        return resolve(record);
                                    });
                                });
                                targetCaptureId = tx && tx.captureId;
                            }
                            if (!targetCaptureId) {
                                throw new Error('PAYPAL_CAPTURE_MISSING');
                            }
                            const response = await paypal.refundCapture(targetCaptureId, amount.toFixed(2), 'SGD');
                            if (!response || !response.id || (response.status !== 'COMPLETED' && response.status !== 'PENDING')) {
                                throw new Error('PAYPAL_REFUND_FAILED');
                            }
                            return response.id;
                        };

                        return (async () => {
                            let paypalRefundId = null;
                            let walletTxnId = null;

                            if (paypalAmount > 0) {
                                try {
                                    paypalRefundId = await processPayPalRefund(paypalAmount);
                                } catch (gatewayErr) {
                                    console.error('Refund gateway error:', gatewayErr);
                                    req.flash('error', 'Refund failed at payment gateway.');
                                    return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                                }
                            }

                            if (walletAmount > 0) {
                                return processWalletCredit(walletAmount, (walletErr, walletId) => {
                                    if (walletErr) {
                                        console.error('Wallet credit error:', walletErr);
                                        req.flash('error', 'Could not credit wallet for refund.');
                                        return res.redirect(`/orders?focus=${refund.orderId}#order-${refund.orderId}`);
                                    }
                                    walletTxnId = walletId;
                                    const txnParts = [];
                                    if (paypalRefundId) txnParts.push(`paypal:${paypalRefundId}`);
                                    if (walletTxnId) txnParts.push(`wallet:${walletTxnId}`);
                                    const txnId = txnParts.length ? txnParts.join('|') : null;
                                    const message = `Refund S$${roundCurrency(actualRefundTotal).toFixed(2)} processed (${paymentMethod}).`;
                                    return finalizeStatusUpdate(paymentMethod, txnId, message, actualRefundTotal);
                                });
                            }

                            const txnParts = [];
                            if (paypalRefundId) txnParts.push(`paypal:${paypalRefundId}`);
                            const txnId = txnParts.length ? txnParts.join('|') : null;
                            const message = `Refund S$${roundCurrency(actualRefundTotal).toFixed(2)} processed via PayPal.`;
                            return finalizeStatusUpdate('paypal', txnId, message, actualRefundTotal);
                        })();
                    };

                    if (hasPaypal) {
                        return processPayments(payments);
                    }

                    return PayPalTransactions.findByOrderId(refund.orderId, (txErr, tx) => {
                        if (!txErr && tx && tx.amount) {
                            payments = payments.concat([{
                                method: 'paypal',
                                amount: Number(tx.amount),
                                currency: tx.currency || 'SGD',
                                referenceId: tx.captureId || null
                            }]);
                        }
                        return processPayments(payments);
                    });
                });
            });
        });
    });
}

function updateStatus(status) {
    return (req, res) => {
        const refundId = parseInt(req.params.refundId, 10);
        if (!refundId || Number.isNaN(refundId)) {
            req.flash('error', 'Invalid refund request.');
            return res.redirect('/orders');
        }
        return handleRefundDecision(req, res, status, refundId);
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

            Refunds.getMaxAttemptForOrder(item.orderId, user.id, (attemptErr, attempts) => {
                if (attemptErr) {
                    console.error('Refund attempt lookup error:', attemptErr);
                    req.flash('error', 'Could not verify refund attempts.');
                    return res.redirect(`/orders?focus=${item.orderId}#order-${item.orderId}`);
                }

                if (attempts >= 3) {
                    req.flash('error', 'Refund request limit reached for this order.');
                    return res.redirect(`/orders?focus=${item.orderId}#order-${item.orderId}`);
                }

                if (item.refundStatus && item.refundStatus !== 'rejected') {
                    req.flash('error', 'A refund request already exists for this item.');
                    return res.redirect(`/orders?focus=${item.orderId}#order-${item.orderId}`);
                }

                Refunds.hasRefundForOrder(item.orderId, (orderErr, exists) => {
                    if (orderErr) {
                        console.error('Refund order lookup error:', orderErr);
                        req.flash('error', 'Could not verify refund status.');
                        return res.redirect(`/orders?focus=${item.orderId}#order-${item.orderId}`);
                    }

                    if (exists) {
                        req.flash('error', 'A refund request already exists for this order.');
                        return res.redirect(`/orders?focus=${item.orderId}#order-${item.orderId}`);
                    }

                    const resetRejected = item.refundStatus === 'rejected';
                    const onComplete = (createErr) => {
                        if (createErr) {
                            console.error('Refund create error:', createErr);
                            req.flash('error', 'Could not submit refund request.');
                            return res.redirect(`/orders?focus=${item.orderId}#order-${item.orderId}`);
                        }

                        req.flash('success', 'Refund request submitted. We will review it shortly.');
                        return res.redirect(`/orders?focus=${item.orderId}#order-${item.orderId}`);
                    };

                    if (resetRejected) {
                        return Refunds.resetRejectedForOrderItem(item.orderItemId, item.userId, reason, (resetErr) => {
                            if (resetErr) {
                                return onComplete(resetErr);
                            }
                            return onComplete(null);
                        });
                    }

                    return Refunds.create({
                        orderId: item.orderId,
                        orderItemId: item.orderItemId,
                        userId: item.userId,
                        reason
                    }, onComplete);
                });
            });
        });
    },
    requestFullOrder(req, res) {
        const user = req.session.user;
        const orderId = parseInt(req.params.orderId, 10);
        const reason = (req.body.reason || '').trim();

        if (!user || !user.id) {
            req.flash('error', 'Please log in to request a refund.');
            return res.redirect('/login');
        }

        if (!orderId || Number.isNaN(orderId)) {
            req.flash('error', 'Invalid order.');
            return res.redirect('/orders');
        }

        if (!reason) {
            req.flash('error', 'Please provide a reason for the refund request.');
            return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
        }

        Refunds.getMaxAttemptForOrder(orderId, user.id, (attemptErr, attempts) => {
            if (attemptErr) {
                console.error('Refund attempt lookup error:', attemptErr);
                req.flash('error', 'Could not verify refund attempts.');
                return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
            }

            if (attempts >= 3) {
                req.flash('error', 'Refund request limit reached for this order.');
                return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
            }

            Refunds.hasRefundForOrder(orderId, (existsErr, exists) => {
                if (existsErr) {
                    console.error('Refund order lookup error:', existsErr);
                    req.flash('error', 'Could not verify refund status.');
                    return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
                }

                if (exists) {
                    req.flash('error', 'A refund request already exists for this order.');
                    return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
                }

                Refunds.getOrderItemsForOrder(orderId, user.id, (itemsErr, items) => {
                    if (itemsErr) {
                        console.error('Order items lookup error:', itemsErr);
                        req.flash('error', 'Could not load order items.');
                        return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
                    }

                    if (!items || !items.length) {
                        req.flash('error', 'Order not found.');
                        return res.redirect('/orders');
                    }

                    return Refunds.getRefundsForOrder(orderId, (refundsErr, refunds) => {
                        if (refundsErr) {
                            console.error('Refund order lookup error:', refundsErr);
                            req.flash('error', 'Could not load refund request.');
                            return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
                        }

                        const refundedItemIds = new Set((refunds || []).map(r => r.orderItemId));
                        const missingItems = items.filter(item => !refundedItemIds.has(item.orderItemId));

                        const onComplete = (createErr) => {
                            if (createErr) {
                                console.error('Refund create error:', createErr);
                                req.flash('error', 'Could not submit refund request.');
                                return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
                            }

                            req.flash('success', 'Full order refund request submitted. We will review it shortly.');
                            return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
                        };

                        return Refunds.resetRejectedForOrder(orderId, user.id, reason, (resetErr) => {
                            if (resetErr) {
                                return onComplete(resetErr);
                            }
                            if (!missingItems.length) {
                                return onComplete(null);
                            }
                            return Refunds.createMany(orderId, user.id, reason, missingItems, onComplete);
                        });
                    });
                });
            });
        });
    },
    approve: updateStatus('approved'),
    reject: updateStatus('rejected'),
    approveOrder(req, res) {
        const orderId = parseInt(req.params.orderId, 10);
        if (!orderId || Number.isNaN(orderId)) {
            req.flash('error', 'Invalid order.');
            return res.redirect('/orders');
        }
        return Refunds.getRefundsForOrder(orderId, (err, refunds) => {
            if (err) {
                console.error('Refund order lookup error:', err);
                req.flash('error', 'Could not load refund request.');
                return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
            }
            const pending = refunds.filter(r => r.status === 'pending');
            if (!pending.length) {
                req.flash('error', 'No pending refund request found.');
                return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
            }
            return handleRefundDecision(req, res, 'approved', pending[0].id);
        });
    },
    rejectOrder(req, res) {
        const orderId = parseInt(req.params.orderId, 10);
        if (!orderId || Number.isNaN(orderId)) {
            req.flash('error', 'Invalid order.');
            return res.redirect('/orders');
        }
        return Refunds.getRefundsForOrder(orderId, (err, refunds) => {
            if (err) {
                console.error('Refund order lookup error:', err);
                req.flash('error', 'Could not load refund request.');
                return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
            }
            const pending = refunds.filter(r => r.status === 'pending');
            if (!pending.length) {
                req.flash('error', 'No pending refund request found.');
                return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
            }
            return Refunds.updateStatusForOrder(orderId, 'rejected', {
                processedBy: req.session.user && req.session.user.id
            }, (updateErr, result) => {
                if (updateErr) {
                    console.error('Refund update error:', updateErr);
                    req.flash('error', 'Could not update refund request.');
                    return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
                }

                if (!result || result.affectedRows === 0) {
                    req.flash('error', 'Refund request was not updated.');
                    return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
                }

                req.flash('success', 'Refund request rejected.');
                return res.redirect(`/orders?focus=${orderId}#order-${orderId}`);
            });
        });
    }
};

module.exports = refundController;
