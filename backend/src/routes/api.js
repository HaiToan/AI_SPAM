const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');

router.get('/stats', statsController.getStats);
router.get('/logs', statsController.getRecentLogs);
router.post('/rollback', statsController.rollbackEmail);
router.post('/mark-spam', statsController.markAsSpam);
router.get('/profile', statsController.getProfile);
router.get('/stream', statsController.sse);
router.post('/notify', statsController.notify);
router.get('/keywords', statsController.getKeywords);
router.post('/keywords', statsController.updateKeyword);
router.post('/retrain', statsController.retrainModel);
router.get('/email/:msg_id', statsController.getFullEmail);

module.exports = router;