const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const authRoutes = require('./routes/authRoutes');
const createProductRoutes = require('./routes/productRoutes');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');
const productController = require('./controllers/productController');
const { checkAuthenticated } = require('./middleware');
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

// Search shortcut to jump directly to a product page
app.get('/search', checkAuthenticated, productController.search);

app.use(authRoutes);
app.use(createProductRoutes(upload));
app.use(cartRoutes);
app.use(orderRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
