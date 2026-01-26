const Cart = require('../models/cart');
const nets = require('../services/nets');
const cartController = require('./cartController');
const Wallets = require('../models/wallets');

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

const generateQrCode = (req, res) => {
  const userId = req.session.user && (req.session.user.id || req.session.user.user_id || req.session.user.userId);
  if (!userId) {
    req.flash('cartError', 'Please log in to pay with NETS.');
    return res.redirect('/login');
  }

  Cart.getCart(userId, async (cartErr, cart) => {
    if (cartErr) {
      console.error('Cart load error:', cartErr);
      req.flash('cartError', 'Could not load cart.');
      return res.redirect('/cart');
    }

    if (!cart.length) {
      req.flash('cartError', 'Your cart is empty.');
      return res.redirect('/cart');
    }

    const total = getCartTotal(cart);

    Wallets.getOrCreate(userId, async (walletErr, wallet) => {
      if (walletErr) {
        console.error('Wallet load error:', walletErr);
        req.flash('cartError', 'Could not load wallet.');
        return res.redirect('/cart');
      }
      const walletBalance = wallet ? Number(wallet.balance) : 0;
      const walletApplied = resolveWalletApplied(req, total, walletBalance);
      if (walletApplied > 0) {
        req.session.walletAppliedAmount = walletApplied;
      } else {
        delete req.session.walletAppliedAmount;
      }
      const payableTotal = Number(Math.max(0, total - walletApplied).toFixed(2));
      if (payableTotal <= 0) {
        return cartController.checkout(req, res);
      }

      try {
        const response = await nets.requestQrCode(payableTotal.toFixed(2));
      const qrData = response && response.result && response.result.data ? response.result.data : {};

      if (qrData.response_code === '00' && qrData.txn_status === 1 && qrData.qr_code) {
        req.session.netsTxnRetrievalRef = qrData.txn_retrieval_ref;
        req.session.netsCartTotal = payableTotal.toFixed(2);

        return res.render('netsQr', {
          title: 'Scan to Pay',
          total: payableTotal.toFixed(2),
          qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
          txnRetrievalRef: qrData.txn_retrieval_ref,
          timer: 300,
          backUrl: '/cart',
          successUrl: '/nets-qr/success',
          failUrl: '/nets-qr/fail'
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
      } catch (error) {
        console.error('Error in generateQrCode:', error.message);
        return res.redirect('/nets-qr/fail');
      }
    });
  });
};

const ssePaymentStatus = async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const txnRetrievalRef = req.params.txnRetrievalRef;
  let pollCount = 0;
  const maxPolls = 60;
  let frontendTimeoutStatus = 0;

  const interval = setInterval(async () => {
    pollCount += 1;
    try {
      const response = await nets.queryPayment(txnRetrievalRef, frontendTimeoutStatus);
      res.write(`data: ${JSON.stringify(response)}\n\n`);

      const resData = response && response.result && response.result.data ? response.result.data : {};
      if (resData.response_code === '00' && resData.txn_status === 1) {
        res.write(`data: ${JSON.stringify({ success: true })}\n\n`);
        clearInterval(interval);
        res.end();
        return;
      }

      if (frontendTimeoutStatus === 1 && (resData.response_code !== '00' || resData.txn_status === 2)) {
        res.write(`data: ${JSON.stringify({ fail: true, ...resData })}\n\n`);
        clearInterval(interval);
        res.end();
      }
    } catch (err) {
      clearInterval(interval);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }

    if (pollCount >= maxPolls) {
      clearInterval(interval);
      frontendTimeoutStatus = 1;
      res.write(`data: ${JSON.stringify({ fail: true, error: 'Timeout' })}\n\n`);
      res.end();
    }
  }, 5000);

  req.on('close', () => {
    clearInterval(interval);
  });
};

const success = (req, res) => {
  return cartController.checkout(req, res);
};

const fail = (req, res) => {
  return res.render('netsTxnFailStatus', {
    title: 'NETS QR Failed',
    message: 'Transaction Failed. Please try again.'
  });
};

module.exports = {
  generateQrCode,
  ssePaymentStatus,
  success,
  fail
};
