// ...existing code...
const Product = require('../models/products');

const SupermarketController = {
    // Render add product form for admins
    showAddForm(req, res) {
        return res.render('addProduct', { user: req.session.user });
    },

    // List all products (renders inventory for admin, shopping for users)
    list(req, res) {
        const term = (req.query.q || '').trim();

        const handleResult = (err, products) => {
            if (err) {
                req.flash('error', 'Error fetching products');
                return res.status(500).render('index', { user: req.session.user, messages: req.flash('error') });
            }
            if (term && products && products.length > 0) {
                const target = products[0]; // already ordered by exact match in model
                return res.redirect(`/product/${target.id}`);
            }
            if (req.session.user && req.session.user.role === 'admin') {
                return res.render('inventory', { products, user: req.session.user, searchTerm: term });
            } else {
                return res.render('shopping', { products, user: req.session.user, searchTerm: term });
            }
        };

        if (term) {
            Product.searchByName(term, handleResult);
        } else {
            Product.getAll(handleResult);
        }
    },

    // Dedicated search endpoint to jump directly to a product page when found
    search(req, res) {
        const term = (req.query.q || '').trim();
        if (!term) return res.redirect('/shopping');

        Product.searchByName(term, (err, products) => {
            if (err) {
                req.flash('error', 'Error fetching products');
                return res.redirect('/shopping');
            }
            if (products && products.length > 0) {
                return res.redirect(`/product/${products[0].id}`);
            }
            req.flash('error', 'No matching products found');
            return res.redirect('/shopping');
        });
    },

    // Get product by ID and render product detail
    getById(req, res) {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            req.flash('error', 'Invalid id');
            return res.status(400).redirect('/');
        }

        Product.getById(id, (err, product) => {
            if (err) {
                req.flash('error', 'Error fetching product');
                return res.status(500).redirect('/');
            }
            if (!product) {
                req.flash('error', 'Product not found');
                return res.status(404).redirect(req.session.user && req.session.user.role === 'admin' ? '/inventory' : '/shopping');
            }
            return res.render('product', { product, user: req.session.user });
        });
    },

    // Render edit page for admin
    edit(req, res) {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            req.flash('error', 'Invalid id');
            return res.status(400).redirect('/inventory');
        }

        Product.getById(id, (err, product) => {
            if (err) {
                req.flash('error', 'Error fetching product');
                return res.status(500).redirect('/inventory');
            }
            if (!product) {
                req.flash('error', 'Product not found');
                return res.status(404).redirect('/inventory');
            }
            return res.render('updateProduct', { product, user: req.session.user });
        });
    },

    // Add a new product (expects upload middleware for image)
    add(req, res) {
        const product = {
            productName: req.body.name || req.body.productName,
            quantity: req.body.quantity,
            price: req.body.price,
            image: req.file ? req.file.filename : req.body.image || null
        };

        Product.add(product, (err, inserted) => {
            if (err) {
                req.flash('error', 'Error adding product');
                return res.status(500).redirect('/inventory');
            }
            return res.redirect('/inventory');
        });
    },

    // Update an existing product (expects upload middleware for image)
    update(req, res) {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            req.flash('error', 'Invalid id');
            return res.status(400).redirect('/inventory');
        }

        const image = req.file ? req.file.filename : req.body.currentImage || null;
        const product = {
            productName: req.body.name || req.body.productName,
            quantity: req.body.quantity,
            price: req.body.price,
            image: image
        };

        Product.update(id, product, (err, result) => {
            if (err) {
                req.flash('error', 'Error updating product');
                return res.status(500).redirect('/inventory');
            }
            if (result && result.affectedRows === 0) {
                req.flash('error', 'Product not found');
                return res.status(404).redirect('/inventory');
            }
            return res.redirect('/inventory');
        });
    },

    // Delete a product by ID
    delete(req, res) {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            req.flash('error', 'Invalid id');
            return res.status(400).redirect('/inventory');
        }

        Product.delete(id, (err, result) => {
            if (err) {
                req.flash('error', 'Error deleting product');
                return res.status(500).redirect('/inventory');
            }
            if (result && result.affectedRows === 0) {
                req.flash('error', 'Product not found');
                return res.status(404).redirect('/inventory');
            }
            return res.redirect('/inventory');
        });
    }
};

module.exports = SupermarketController;
// ...existing code...
