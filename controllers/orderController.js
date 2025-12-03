const Orders = require('../models/orders');

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
            res.render('orders', {
                user: req.session.user,
                orders,
                messages: req.flash('success'),
                errors: req.flash('error'),
                searchTerm: term,
                focusId: req.query.focus
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
