const Router = require('koa-router');
const costumeController = require('../controllers/costumeController');
const borrowController = require('../controllers/borrowController');
const returnController = require('../controllers/returnController');
const statsController = require('../controllers/statsController');

const router = new Router({ prefix: '/api' });

router.get('/', async (ctx) => {
  ctx.body = {
    code: 200,
    message: '演出服装尺码匹配与借还核验 API 服务运行中',
    data: {
      version: '1.0.0',
      endpoints: [
        'POST /api/costumes - 服装建档',
        'GET /api/costumes - 服装列表',
        'GET /api/costumes/:id - 服装详情',
        'PUT /api/costumes/:id - 更新服装',
        'DELETE /api/costumes/:id - 删除服装',
        'POST /api/match - 尺码匹配',
        'POST /api/borrow - 借用锁定',
        'GET /api/borrows - 借用列表',
        'POST /api/return - 归还核验',
        'GET /api/returns - 归还列表',
        'POST /api/cleaning - 新增清洗排期',
        'GET /api/cleaning - 清洗排期列表',
        'PUT /api/cleaning/status - 更新清洗状态',
        'GET /api/stats/size-gap - 尺码缺口统计',
        'GET /api/stats/turnover - 服装周转率统计',
        'GET /api/stats/accessory-loss - 配件缺失排行',
        'GET /api/stats/cleaning-wait - 清洗等待时长',
        'GET /api/stats/dashboard - 仪表盘概览'
      ]
    }
  };
});

router.post('/costumes', costumeController.addCostume);
router.get('/costumes', costumeController.getCostumeList);
router.get('/costumes/:id', costumeController.getCostumeDetail);
router.put('/costumes/:id', costumeController.updateCostume);
router.delete('/costumes/:id', costumeController.deleteCostume);

router.post('/match', borrowController.matchCostumes);
router.post('/borrow', borrowController.lockBorrow);
router.get('/borrows', borrowController.getBorrowList);

router.post('/return', returnController.returnCostume);
router.get('/returns', returnController.getReturnList);

router.post('/cleaning', returnController.addCleaningTask);
router.get('/cleaning', returnController.getCleaningSchedule);
router.put('/cleaning/status', returnController.updateCleaningStatus);

router.get('/stats/size-gap', statsController.getSizeGapStats);
router.get('/stats/turnover', statsController.getTurnoverStats);
router.get('/stats/accessory-loss', statsController.getAccessoryLossStats);
router.get('/stats/cleaning-wait', statsController.getCleaningWaitStats);
router.get('/stats/dashboard', statsController.getDashboardStats);

module.exports = router;
