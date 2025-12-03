const DiscountCodes = require('../models/discountCodes');

const discountCodeController = {
    // Admin list
    index(req, res) {
        DiscountCodes.getAll((err, codes) => {
            if (err) {
                req.flash('error', 'Unable to load discount codes.');
                return res.redirect('/inventory');
            }
            res.render('discountCodes/index', { codes, user: req.session.user });
        });
    },

    // Admin create form
    createForm(req, res) {
        res.render('discountCodes/create', { user: req.session.user });
    },

    // Admin create
    create(req, res) {
        const data = mapForm(req.body);
        DiscountCodes.create(data, (err) => {
            if (err) {
                req.flash('error', 'Could not create discount code.');
                return res.redirect('/admin/discount-codes');
            }
            req.flash('success', 'Discount code created.');
            res.redirect('/admin/discount-codes');
        });
    },

    // Admin edit form
    editForm(req, res) {
        const id = parseInt(req.params.id, 10);
        DiscountCodes.getById(id, (err, code) => {
            if (err || !code) {
                req.flash('error', 'Discount code not found.');
                return res.redirect('/admin/discount-codes');
            }
            res.render('discountCodes/edit', { code, user: req.session.user });
        });
    },

    // Admin edit save
    edit(req, res) {
        const id = parseInt(req.params.id, 10);
        const data = mapForm(req.body);
        DiscountCodes.update(id, data, (err) => {
            if (err) {
                req.flash('error', 'Could not update discount code.');
                return res.redirect('/admin/discount-codes');
            }
            req.flash('success', 'Discount code updated.');
            res.redirect('/admin/discount-codes');
        });
    },

    // Admin delete
    delete(req, res) {
        const id = parseInt(req.params.id, 10);

        if (Number.isNaN(id)) {
            req.flash('error', 'Invalid discount code.');
            return res.redirect('/admin/discount-codes');
        }

        DiscountCodes.delete(id, (err) => {
            if (err) {
                req.flash('error', 'Could not delete discount code.');
                return res.redirect('/admin/discount-codes');
            }
            req.flash('success', 'Discount code deleted.');
            res.redirect('/admin/discount-codes');
        });
    },

    // Checkout apply
    apply(req, res) {
        const codeInput = (req.body.promoCode || '').trim();
        const subtotal = Number(req.body.subtotal || 0);

        if (!codeInput) {
            return res.json({ success: false, message: 'Enter a promo code.' });
        }

        DiscountCodes.getByCode(codeInput, (err, code) => {
            if (err || !code || !code.active) {
                return res.json({ success: false, message: 'Invalid or expired code.' });
            }

            const discountValue = computeDiscount(subtotal, code);
            const finalTotal = Math.max(0, subtotal - discountValue);

            // Decrement use (best-effort)
            DiscountCodes.decrementUse(code.id, () => {});

            return res.json({
                success: true,
                message: `Applied ${code.code}.`,
                discount: discountValue,
                total: finalTotal
            });
        });
    }
};

function mapForm(body) {
    return {
        code: (body.code || '').trim(),
        description: body.description || '',
        percent_off: body.percent_off ? Number(body.percent_off) : null,
        uses_remaining: body.uses_remaining ? Number(body.uses_remaining) : null,
        expires_at: body.expires_at || null,
        active: body.active === 'on' || body.active === 'true' || body.active === true
    };
}

function computeDiscount(subtotal, code) {
    const percent = code.percent_off ? Number(code.percent_off) : 0;
    const percentVal = percent > 0 ? (subtotal * (percent / 100)) : 0;
    return Math.min(subtotal, percentVal);
}

module.exports = discountCodeController;
