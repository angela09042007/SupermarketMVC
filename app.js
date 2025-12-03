const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const { checkAuthenticated, checkAdmin, validateRegistration } = require('./middleware');
const authController = require('./controllers/authController');
const productController = require('./controllers/productController');
const cartController = require('./controllers/cartController');
const orderController = require('./controllers/orderController');
const discountCodeController = require('./controllers/discountCodeController');
const app = express();

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images'); // Directory to save uploaded files
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname); 
    }
});

const upload = multer({ storage: storage });

// Set up view engine 
app.set('view engine', 'ejs');
//  enable static files
app.use(express.static('public'));
// enable form processing
app.use(express.urlencoded({
    extended: false
}));

//TO DO: Insert code for Session Middleware below 
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    // Session expires after 1 week of inactivity
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } 
}));

app.use(flash());

// Expose session user and flash messages to all views
app.use((req, res, next) => {
    res.locals.user = req.session.user;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
});

// Define routes
app.get('/',  (req, res) => {
    res.render('index', {user: req.session.user} );
});

// Auth
app.get('/register', authController.showRegister);
app.post('/register', validateRegistration, authController.register);
app.get('/login', authController.showLogin);
app.post('/login', authController.login);
app.get('/logout', authController.logout);

// Product search + lists
app.get('/search', checkAuthenticated, productController.search);
app.get('/inventory', checkAuthenticated, checkAdmin, productController.list);
app.get('/shopping', checkAuthenticated, productController.list);
app.get('/product/:id', checkAuthenticated, productController.getById);

// Product CRUD (admin)
app.get('/addProduct', checkAuthenticated, checkAdmin, productController.showAddForm);
app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), productController.add);
app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, productController.edit);
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), productController.update);
app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, productController.delete);

// Cart
app.post('/add-to-cart/:id', checkAuthenticated, cartController.addToCart);
app.post('/cart/update/:id', checkAuthenticated, cartController.updateCartItem);
app.post('/cart/remove/:id', checkAuthenticated, cartController.removeCartItem);
app.post('/cart/clear', checkAuthenticated, cartController.clearCart);
app.post('/cart/checkout', checkAuthenticated, cartController.checkout);
app.get('/cart', checkAuthenticated, cartController.viewCart);
app.post('/cart/apply-code', checkAuthenticated, discountCodeController.apply);

// Invoice (last purchase in session)
app.get('/invoice', checkAuthenticated, (req, res) => {
    const invoice = req.session.lastInvoice;
    if (!invoice || !invoice.items || !invoice.items.length) {
        req.flash('cartError', 'No recent purchase to show.');
        return res.redirect('/cart');
    }
    res.render('invoice', {
        invoice,
        user: req.session.user,
        messages: req.flash('cartMessage'),
        errors: req.flash('cartError')
    });
});

// Orders
app.get('/orders', checkAuthenticated, orderController.list);

// Admin discount codes
app.get('/admin/discount-codes', checkAuthenticated, checkAdmin, discountCodeController.index);
app.get('/admin/discount-codes/create', checkAuthenticated, checkAdmin, discountCodeController.createForm);
app.post('/admin/discount-codes/create', checkAuthenticated, checkAdmin, discountCodeController.create);
app.get('/admin/discount-codes/edit/:id', checkAuthenticated, checkAdmin, discountCodeController.editForm);
app.post('/admin/discount-codes/edit/:id', checkAuthenticated, checkAdmin, discountCodeController.edit);
app.post('/admin/discount-codes/delete/:id', checkAuthenticated, checkAdmin, discountCodeController.delete);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
