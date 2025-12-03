const express = require('express');
const { checkAuthenticated, checkAdmin } = require('../middleware');
const productController = require('../controllers/productController');

/**
 * Factory so we can inject the multer upload middleware from app.js.
 */
module.exports = function createProductRoutes(upload) {
    const router = express.Router();

    router.get('/search', checkAuthenticated, productController.search);
    router.get('/inventory', checkAuthenticated, checkAdmin, productController.list);
    router.get('/shopping', checkAuthenticated, productController.list);
    router.get('/product/:id', checkAuthenticated, productController.getById);

    router.get('/addProduct', checkAuthenticated, checkAdmin, productController.showAddForm);
    router.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), productController.add);

    router.get('/updateProduct/:id', checkAuthenticated, checkAdmin, productController.edit);
    router.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), productController.update);

    router.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, productController.delete);

    return router;
};
