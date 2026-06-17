const Router = require('koa-router');
const costumeController = require('../controllers/costumeController');
const borrowController = require('../controllers/borrowController');
const returnController = require('../controllers/returnController');
const statsController = require('../controllers/statsController');
const projectController = require('../controllers/projectController');
const auditController = require('../controllers/auditController');
const warehouseController = require('../controllers/warehouseController');
const transferController = require('../controllers/transferController');
const availabilityController = require('../controllers/availabilityController');

const router = new Router({ prefix: '/api' });

router.get('/', async (ctx) => {
  ctx.body = {
    code: 200,
    message: '演出服装尺码匹配与借还核验 API 服务运行中',
    data: {
      version: '2.0.0',
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
        'POST /api/projects - 创建演出项目',
        'GET /api/projects - 演出项目列表',
        'GET /api/projects/:id - 演出项目详情',
        'PUT /api/projects/:id - 更新演出项目',
        'DELETE /api/projects/:id - 删除演出项目',
        'POST /api/projects/:projectId/generate-plan - 生成批量分配方案',
        'POST /api/plans/:planId/confirm - 确认方案并生成借用记录',
        'POST /api/plans/:planId/release - 释放待确认方案占用',
        'GET /api/leaders/:leaderName/projects - 领队查询项目方案',
        'GET /api/stats/size-gap - 尺码缺口统计',
        'GET /api/stats/turnover - 服装周转率统计',
        'GET /api/stats/accessory-loss - 配件缺失排行',
        'GET /api/stats/cleaning-wait - 清洗等待时长',
        'GET /api/stats/dashboard - 仪表盘概览',
        'GET /api/stats/daily-availability - 每日服装资源状态统计',
        'GET /api/stats/project-gap - 项目级缺口统计',
        'GET /api/stats/role-satisfaction - 角色满足率统计',
        'GET /api/stats/costume-occupancy - 服装占用率统计',
        'GET /api/stats/project-dashboard - 项目级仪表盘',
        'POST /api/audit/logs - 审计事件记录',
        'GET /api/audit/logs - 审计日志列表查询',
        'GET /api/audit/costumes/:id/timeline - 单件服装生命周期时间线',
        'GET /api/audit/anomalies/scan - 异常事件扫描',
        'GET /api/audit/anomalies/summary - 异常统计汇总',
        'POST /api/warehouses - 仓库建档',
        'GET /api/warehouses - 仓库列表',
        'GET /api/warehouses/:id - 仓库详情',
        'PUT /api/warehouses/:id - 更新仓库',
        'POST /api/warehouses/bind-costume - 服装绑定仓库与库位',
        'POST /api/transfers - 跨仓调拨申请',
        'GET /api/transfers - 调拨记录列表',
        'POST /api/transfers/:id/approve - 调拨审核通过',
        'POST /api/transfers/:id/reject - 调拨审核驳回',
        'POST /api/transfers/:id/outbound - 调拨出库',
        'POST /api/transfers/:id/inbound - 调拨入库确认',
        'POST /api/availability/regional - 区域可用性查询',
        'GET /api/transfers/statistics - 调拨统计汇总'
      ],
      newEndpoints: [
        {
          path: 'POST /api/projects',
          description: '管理端：创建演出项目，按角色分组配置服装数量、尺码约束、演出类型、必备配件、优先级和连续演出日期范围',
          params: {
            name: '项目名称',
            description: '项目描述（可选）',
            leaderName: '领队名称',
            roles: '角色配置数组，每项含 roleName, quantity, sizeConstraints[], performanceType, requiredAccessories[], priority(1/2/3), startDate, endDate'
          }
        },
        {
          path: 'POST /api/projects/:projectId/generate-plan',
          description: '管理端：从库存自动生成可执行的批量分配方案，保证同服装不跨角色/跨日期冲突，排除清洗/维修/dirty/缺配件/档期不完整的服装，返回缺口原因、候补服装和调整建议',
          params: { projectId: '项目ID' }
        },
        {
          path: 'POST /api/plans/:planId/confirm',
          description: '管理端：一键确认方案，批量生成多条借用记录（有冲突时自动回滚）',
          params: { planId: '方案ID' }
        },
        {
          path: 'POST /api/plans/:planId/release',
          description: '管理端：释放待确认方案占用的服装，方案作废',
          params: { planId: '方案ID' }
        },
        {
          path: 'GET /api/leaders/:leaderName/projects',
          description: '领队端：查询本领队所有演出项目的方案状态和分配明细',
          params: { leaderName: '领队名称' }
        },
        {
          path: 'GET /api/stats/project-gap',
          description: '管理端：项目级缺口统计，查看各项目/角色的缺口数量、原因和受影响角色',
          params: { status: '方案状态筛选 pending/confirmed（可选）' }
        },
        {
          path: 'GET /api/stats/role-satisfaction',
          description: '管理端：角色满足率统计，按角色维度汇总需求数、已分配数和满足率',
          params: {
            projectId: '按项目筛选（可选）',
            leaderName: '按领队筛选（可选）'
          }
        },
        {
          path: 'GET /api/stats/costume-occupancy',
          description: '管理端：服装占用率统计，指定日期范围内每件服装的占用天数、占用率及每日状态',
          params: {
            startDate: '开始日期 (YYYY-MM-DD)',
            endDate: '结束日期 (YYYY-MM-DD)',
            performanceType: '演出类型（可选）'
          }
        },
        {
          path: 'GET /api/stats/project-dashboard',
          description: '管理端：项目级仪表盘概览，含项目/方案状态分布、总体分配满足率、领队项目排行',
          params: {}
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

router.post('/audit/logs', auditController.createAuditLog);
router.get('/audit/logs', auditController.getAuditLogs);
router.get('/audit/costumes/:id/timeline', auditController.getCostumeTimeline);
router.get('/audit/anomalies/scan', auditController.scanAnomalies);
router.get('/audit/anomalies/summary', auditController.getAnomalyStats);

router.post('/warehouses', warehouseController.createWarehouse);
router.get('/warehouses', warehouseController.getWarehouseList);
router.get('/warehouses/:id', warehouseController.getWarehouseDetail);
router.put('/warehouses/:id', warehouseController.updateWarehouse);
router.post('/warehouses/bind-costume', warehouseController.bindCostumeWarehouse);

router.post('/transfers', transferController.createTransfer);
router.get('/transfers', transferController.getTransferList);
router.post('/transfers/:id/approve', transferController.approveTransfer);
router.post('/transfers/:id/reject', transferController.rejectTransfer);
router.post('/transfers/:id/outbound', transferController.outboundTransfer);
router.post('/transfers/:id/inbound', transferController.confirmInbound);

router.post('/availability/regional', availabilityController.queryRegionalAvailability);
router.get('/transfers/statistics', availabilityController.getTransferStatistics);

module.exports = router;
