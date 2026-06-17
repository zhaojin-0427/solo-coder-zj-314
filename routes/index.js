const Router = require('koa-router');
const costumeController = require('../controllers/costumeController');
const borrowController = require('../controllers/borrowController');
const returnController = require('../controllers/returnController');
const statsController = require('../controllers/statsController');
const projectController = require('../controllers/projectController');

const router = new Router({ prefix: '/api' });

router.get('/', async (ctx) => {
  ctx.body = {
    code: 200,
    message: '演出服装尺码匹配与借还核验 API 服务运行中',
    data: {
      version: '1.1.0',
      endpoints: [
        'POST /api/costumes - 服装建档',
        'GET /api/costumes - 服装列表',
        'GET /api/costumes/:id - 服装详情',
        'PUT /api/costumes/:id - 更新服装',
        'DELETE /api/costumes/:id - 删除服装',
        'POST /api/match - 尺码匹配（单日）',
        'POST /api/estimate - 档期预估（领队提交匹配请求前预估可用性）',
        'POST /api/borrow - 借用锁定',
        'GET /api/borrows - 借用列表',
        'POST /api/return - 归还核验',
        'GET /api/returns - 归还列表',
        'POST /api/cleaning - 新增清洗排期',
        'GET /api/cleaning - 清洗排期列表',
        'PUT /api/cleaning/status - 更新清洗状态',
        'POST /api/maintenance/complete - 维修/补件完成',
        'GET /api/stats/size-gap - 尺码缺口统计',
        'GET /api/stats/turnover - 服装周转率统计',
        'GET /api/stats/accessory-loss - 配件缺失排行',
        'GET /api/stats/cleaning-wait - 清洗等待时长',
        'GET /api/stats/dashboard - 仪表盘概览',
        'GET /api/stats/daily-availability - 每日服装资源状态统计（管理端）'
      ],
      newEndpoints: [
        {
          path: 'GET /api/stats/daily-availability',
          description: '管理端：按日期范围、演出类型、尺码查询每天可借、已借、清洗中、维修中的服装数量，并查看当天存在档期冲突风险的服装清单',
          params: {
            startDate: '开始日期 (YYYY-MM-DD)',
            endDate: '结束日期 (YYYY-MM-DD)',
            performanceType: '演出类型（可选）',
            size: '尺码（可选）'
          }
        },
        {
          path: 'POST /api/estimate',
          description: '领队端：按身高、体重、角色类型、演出日期范围获取推荐服装及该档期可用性说明',
          params: {
            height: '身高 (cm)',
            weight: '体重 (kg)',
            roleType: '角色类型',
            startDate: '演出开始日期 (YYYY-MM-DD)',
            endDate: '演出结束日期 (YYYY-MM-DD)',
            performanceType: '演出类型（可选）'
          }
        }
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
router.post('/estimate', borrowController.estimateAvailability);
router.post('/borrow', borrowController.lockBorrow);
router.get('/borrows', borrowController.getBorrowList);

router.post('/return', returnController.returnCostume);
router.get('/returns', returnController.getReturnList);

router.post('/cleaning', returnController.addCleaningTask);
router.get('/cleaning', returnController.getCleaningSchedule);
router.put('/cleaning/status', returnController.updateCleaningStatus);
router.post('/maintenance/complete', returnController.completeMaintenance);

router.get('/stats/size-gap', statsController.getSizeGapStats);
router.get('/stats/turnover', statsController.getTurnoverStats);
router.get('/stats/accessory-loss', statsController.getAccessoryLossStats);
router.get('/stats/cleaning-wait', statsController.getCleaningWaitStats);
router.get('/stats/dashboard', statsController.getDashboardStats);
router.get('/stats/daily-availability', statsController.getDailyAvailabilityStats);

router.post('/projects', projectController.createProject);
router.get('/projects', projectController.getProjectList);
router.get('/projects/:id', projectController.getProjectDetail);
router.put('/projects/:id', projectController.updateProject);
router.delete('/projects/:id', projectController.deleteProject);
router.post('/projects/:projectId/generate-plan', projectController.generatePlan);
router.post('/plans/:planId/confirm', projectController.confirmPlan);
router.post('/plans/:planId/release', projectController.releasePlan);
router.get('/leaders/:leaderName/projects', projectController.getLeaderProjects);

router.get('/stats/project-gap', statsController.getProjectGapStats);
router.get('/stats/role-satisfaction', statsController.getRoleSatisfactionStats);
router.get('/stats/costume-occupancy', statsController.getCostumeOccupancyStats);
router.get('/stats/project-dashboard', statsController.getProjectDashboardStats);

module.exports = router;
