const {
  costumes,
  borrowRecords,
  returnRecords,
  cleaningSchedule,
  performanceProjects,
  allocationPlans,
  auditLogs,
  anomalyRecords,
  auditIdCounter,
  anomalyIdCounter
} = require('../models/store');
const {
  generateResponse,
  formatDate,
  parseDate,
  isDateInRange,
  hasDateOverlap,
  daysBetween
} = require('../utils/helpers');

const VALID_EVENT_TYPES = [
  'costume_create',
  'costume_update',
  'borrow_lock',
  'plan_generate',
  'plan_confirm',
  'plan_release',
  'return_verify',
  'cleaning_update',
  'maintenance_complete'
];

const ANOMALY_TYPES = {
  STATUS_INCONSISTENCY: 'status_inconsistency',
  SCHEDULE_CONFLICT: 'schedule_conflict',
  UNCLEAN_BUT_BORROWABLE: 'unclean_but_borrowable',
  MAINTENANCE_INCOMPLETE_BUT_BORROWABLE: 'maintenance_incomplete_but_borrowable',
  MISSING_ACCESSORY_BUT_AVAILABLE: 'missing_accessory_but_available',
  PROJECT_SHORTAGE: 'project_shortage'
};

function createAuditLog(ctx) {
  const {
    eventType,
    costumeId,
    costumeNumber,
    projectId,
    planId,
    borrowId,
    leaderName,
    operator,
    beforeData,
    afterData,
    eventData,
    remark
  } = ctx.request.body;

  if (!eventType) {
    ctx.body = generateResponse(400, 'eventType 不能为空', null);
    return;
  }

  if (!VALID_EVENT_TYPES.includes(eventType)) {
    ctx.body = generateResponse(400, `eventType 不合法，允许值: ${VALID_EVENT_TYPES.join(', ')}`, null);
    return;
  }

  const log = {
    id: auditIdCounter(),
    eventType,
    costumeId: costumeId || null,
    costumeNumber: costumeNumber || null,
    projectId: projectId || null,
    planId: planId || null,
    borrowId: borrowId || null,
    leaderName: leaderName || null,
    operator: operator || 'system',
    beforeData: beforeData || null,
    afterData: afterData || null,
    eventData: eventData || null,
    remark: remark || '',
    createdAt: new Date().toISOString()
  };

  auditLogs.push(log);

  ctx.body = generateResponse(200, '审计事件记录成功', log);
}

function getAuditLogs(ctx) {
  const {
    page = 1,
    pageSize = 10,
    costumeNumber,
    eventType,
    projectId,
    leaderName,
    startDate,
    endDate
  } = ctx.query;

  let filtered = [...auditLogs];

  if (costumeNumber) {
    filtered = filtered.filter(l =>
      l.costumeNumber && l.costumeNumber.includes(costumeNumber)
    );
  }

  if (eventType) {
    const types = eventType.split(',').map(t => t.trim());
    filtered = filtered.filter(l => types.includes(l.eventType));
  }

  if (projectId) {
    filtered = filtered.filter(l =>
      l.projectId && String(l.projectId) === String(projectId)
    );
  }

  if (leaderName) {
    filtered = filtered.filter(l =>
      l.leaderName && l.leaderName.includes(leaderName)
    );
  }

  if (startDate) {
    filtered = filtered.filter(l => {
      const logDate = new Date(l.createdAt);
      return logDate >= parseDate(startDate);
    });
  }

  if (endDate) {
    const end = parseDate(endDate);
    end.setHours(23, 59, 59, 999);
    filtered = filtered.filter(l => {
      const logDate = new Date(l.createdAt);
      return logDate <= end;
    });
  }

  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const list = filtered.slice(start, start + parseInt(pageSize));

  ctx.body = generateResponse(200, '获取成功', {
    list,
    total,
    page: parseInt(page),
    pageSize: parseInt(pageSize)
  });
}

function getCostumeTimeline(ctx) {
  const { id } = ctx.params;
  const costume = costumes.find(c => c.id === parseInt(id));

  if (!costume) {
    ctx.body = generateResponse(404, '服装不存在', null);
    return;
  }

  const timeline = [];

  timeline.push({
    eventType: 'costume_create',
    timestamp: costume.createdAt,
    description: '服装建档',
    costumeNumber: costume.costumeNumber,
    data: {
      performanceType: costume.performanceType,
      sizeRange: costume.sizeRange,
      accessories: costume.accessories
    }
  });

  if (costume.updatedAt) {
    timeline.push({
      eventType: 'costume_update',
      timestamp: costume.updatedAt,
      description: '服装信息更新',
      costumeNumber: costume.costumeNumber,
      data: {
        status: costume.status,
        cleaningStatus: costume.cleaningStatus
      }
    });
  }

  const costumeBorrows = borrowRecords.filter(b => b.costumeId === costume.id);
  for (const borrow of costumeBorrows) {
    timeline.push({
      eventType: 'borrow_lock',
      timestamp: borrow.createdAt,
      description: `借用锁定（${borrow.startDate} 至 ${borrow.endDate}）`,
      costumeNumber: borrow.costumeNumber,
      data: {
        borrowId: borrow.id,
        leaderName: borrow.leaderName,
        actorName: borrow.actorName,
        startDate: borrow.startDate,
        endDate: borrow.endDate,
        status: borrow.status,
        roleType: borrow.roleType
      }
    });
  }

  const costumeReturns = returnRecords.filter(r => r.costumeId === costume.id);
  for (const ret of costumeReturns) {
    timeline.push({
      eventType: 'return_verify',
      timestamp: ret.returnDate,
      description: `归还核验（污渍等级: ${ret.stainLevel}${ret.missingAccessories && ret.missingAccessories.length > 0 ? '，缺配件: ' + ret.missingAccessories.join(', ') : ''}）`,
      costumeNumber: ret.costumeNumber,
      data: {
        returnId: ret.id,
        borrowId: ret.borrowId,
        stainLevel: ret.stainLevel,
        missingAccessories: ret.missingAccessories || []
      }
    });
  }

  const costumeCleanings = cleaningSchedule.filter(t => t.costumeId === costume.id);
  for (const task of costumeCleanings) {
    timeline.push({
      eventType: 'cleaning_update',
      timestamp: task.status === 'completed' ? (task.completedDate || task.updatedAt || task.createdAt) : task.createdAt,
      description: `清洗${task.status === 'completed' ? '完成' : '排期'}（排期日期: ${task.scheduledDate}，污渍等级: ${task.stainLevel}）`,
      costumeNumber: task.costumeNumber,
      data: {
        cleaningId: task.id,
        scheduledDate: task.scheduledDate,
        status: task.status,
        stainLevel: task.stainLevel
      }
    });
  }

  if (costume.maintenanceUpdatedAt) {
    timeline.push({
      eventType: 'maintenance_complete',
      timestamp: costume.maintenanceUpdatedAt,
      description: '维修/补件完成',
      costumeNumber: costume.costumeNumber,
      data: {
        remainingMissingAccessories: costume.missingAccessories || [],
        status: costume.status
      }
    });
  }

  for (const plan of allocationPlans) {
    const hasCostume = plan.allocations && plan.allocations.some(a => a.costumeId === costume.id);
    if (hasCostume) {
      const project = performanceProjects.find(p => p.id === plan.projectId);
      timeline.push({
        eventType: 'plan_generate',
        timestamp: plan.generatedAt,
        description: `项目方案生成（项目: ${project ? project.name : '未知'}）`,
        costumeNumber: costume.costumeNumber,
        data: {
          planId: plan.planId,
          projectId: plan.projectId,
          projectName: project ? project.name : null,
          planStatus: plan.status
        }
      });

      if (plan.status === 'confirmed') {
        timeline.push({
          eventType: 'plan_confirm',
          timestamp: plan.confirmedAt,
          description: `项目方案确认`,
          costumeNumber: costume.costumeNumber,
          data: {
            planId: plan.planId,
            projectId: plan.projectId,
            projectName: project ? project.name : null
          }
        });
      }

      if (plan.status === 'released') {
        timeline.push({
          eventType: 'plan_release',
          timestamp: plan.releasedAt,
          description: `项目方案释放`,
          costumeNumber: costume.costumeNumber,
          data: {
            planId: plan.planId,
            projectId: plan.projectId,
            projectName: project ? project.name : null
          }
        });
      }
    }
  }

  timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  ctx.body = generateResponse(200, '获取成功', {
    costumeId: costume.id,
    costumeNumber: costume.costumeNumber,
    currentStatus: costume.status,
    cleaningStatus: costume.cleaningStatus,
    timeline
  });
}

function scanAnomalies(ctx) {
  const { rescan = 'false' } = ctx.query;
  const shouldRescan = rescan === 'true';

  if (!shouldRescan && anomalyRecords.length > 0) {
    const sorted = [...anomalyRecords].sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt));
    ctx.body = generateResponse(200, '获取成功', {
      list: sorted,
      total: sorted.length
    });
    return;
  }

  anomalyRecords.length = 0;
  const anomalies = [];

  for (const costume of costumes) {
    const activeBorrows = borrowRecords.filter(b =>
      b.costumeId === costume.id && b.status === 'borrowed'
    );

    if (costume.status === 'available' && activeBorrows.length > 0) {
      anomalies.push({
        id: anomalyIdCounter(),
        anomalyType: ANOMALY_TYPES.STATUS_INCONSISTENCY,
        severity: 'high',
        costumeId: costume.id,
        costumeNumber: costume.costumeNumber,
        description: `服装状态为 available，但存在 ${activeBorrows.length} 条进行中的借用记录`,
        details: {
          costumeStatus: costume.status,
          borrowRecords: activeBorrows.map(b => ({
            id: b.id,
            leaderName: b.leaderName,
            startDate: b.startDate,
            endDate: b.endDate
          }))
        },
        detectedAt: new Date().toISOString()
      });
    }

    if (costume.status === 'borrowed' && activeBorrows.length === 0) {
      anomalies.push({
        id: anomalyIdCounter(),
        anomalyType: ANOMALY_TYPES.STATUS_INCONSISTENCY,
        severity: 'high',
        costumeId: costume.id,
        costumeNumber: costume.costumeNumber,
        description: '服装状态为 borrowed，但无对应的借用记录',
        details: {
          costumeStatus: costume.status
        },
        detectedAt: new Date().toISOString()
      });
    }

    if (costume.status === 'available' && costume.cleaningStatus === 'dirty') {
      anomalies.push({
        id: anomalyIdCounter(),
        anomalyType: ANOMALY_TYPES.UNCLEAN_BUT_BORROWABLE,
        severity: 'medium',
        costumeId: costume.id,
        costumeNumber: costume.costumeNumber,
        description: '服装待清洗(dirty)，但状态为 available（可被借用）',
        details: {
          cleaningStatus: costume.cleaningStatus,
          costumeStatus: costume.status
        },
        detectedAt: new Date().toISOString()
      });
    }

    const hasPendingCleaning = cleaningSchedule.some(t =>
      t.costumeId === costume.id &&
      t.status !== 'completed'
    );

    if (costume.status === 'available' && hasPendingCleaning) {
      anomalies.push({
        id: anomalyIdCounter(),
        anomalyType: ANOMALY_TYPES.UNCLEAN_BUT_BORROWABLE,
        severity: 'medium',
        costumeId: costume.id,
        costumeNumber: costume.costumeNumber,
        description: '服装存在未完成的清洗任务，但状态为 available',
        details: {
          costumeStatus: costume.status,
          pendingCleanings: cleaningSchedule.filter(t =>
            t.costumeId === costume.id && t.status !== 'completed'
          ).map(t => ({
            id: t.id,
            scheduledDate: t.scheduledDate,
            status: t.status
          }))
        },
        detectedAt: new Date().toISOString()
      });
    }

    if (costume.status === 'available' && costume.missingAccessories && costume.missingAccessories.length > 0) {
      anomalies.push({
        id: anomalyIdCounter(),
        anomalyType: ANOMALY_TYPES.MISSING_ACCESSORY_BUT_AVAILABLE,
        severity: 'medium',
        costumeId: costume.id,
        costumeNumber: costume.costumeNumber,
        description: `服装缺失配件（${costume.missingAccessories.join(', ')}），但状态为 available`,
        details: {
          missingAccessories: costume.missingAccessories,
          costumeStatus: costume.status
        },
        detectedAt: new Date().toISOString()
      });
    }

    if (costume.status === 'available' && costume.status !== 'maintenance') {
      const incompleteMaintenances = [];
      if (costume.missingAccessories && costume.missingAccessories.length > 0) {
        incompleteMaintenances.push({
          type: 'missing_accessories',
          items: costume.missingAccessories
        });
      }
      if (costume.cleaningStatus === 'dirty') {
        incompleteMaintenances.push({
          type: 'cleaning_pending'
        });
      }
      if (incompleteMaintenances.length > 0) {
        anomalies.push({
          id: anomalyIdCounter(),
          anomalyType: ANOMALY_TYPES.MAINTENANCE_INCOMPLETE_BUT_BORROWABLE,
          severity: 'high',
          costumeId: costume.id,
          costumeNumber: costume.costumeNumber,
          description: '服装清洗/维修未完成，但状态为可借用',
          details: {
            incompleteItems: incompleteMaintenances,
            costumeStatus: costume.status
          },
          detectedAt: new Date().toISOString()
        });
      }
    }

    for (let i = 0; i < activeBorrows.length; i++) {
      for (let j = i + 1; j < activeBorrows.length; j++) {
        const b1 = activeBorrows[i];
        const b2 = activeBorrows[j];
        if (hasDateOverlap(b1.startDate, b1.endDate, b2.startDate, b2.endDate)) {
          anomalies.push({
            id: anomalyIdCounter(),
            anomalyType: ANOMALY_TYPES.SCHEDULE_CONFLICT,
            severity: 'critical',
            costumeId: costume.id,
            costumeNumber: costume.costumeNumber,
            projectId: b1.projectId || b2.projectId || null,
            description: '服装档期冲突：两条借用记录日期重叠',
            details: {
              borrow1: {
              id: b1.id,
              leaderName: b1.leaderName,
              startDate: b1.startDate,
              endDate: b1.endDate
            },
              borrow2: {
              id: b2.id,
              leaderName: b2.leaderName,
              startDate: b2.startDate,
              endDate: b2.endDate
            }
            },
            detectedAt: new Date().toISOString()
          });
        }
      }
    }

    for (const borrow of activeBorrows) {
      for (const task of cleaningSchedule) {
        if (task.costumeId !== costume.id) continue;
        if (task.status === 'completed') continue;
        if (isDateInRange(task.scheduledDate, borrow.startDate, borrow.endDate)) {
          anomalies.push({
            id: anomalyIdCounter(),
            anomalyType: ANOMALY_TYPES.SCHEDULE_CONFLICT,
            severity: 'high',
            costumeId: costume.id,
            costumeNumber: costume.costumeNumber,
            description: '服装档期冲突：借用日期与清洗排期重叠',
            details: {
              borrowRecord: {
              id: borrow.id,
              startDate: borrow.startDate,
              endDate: borrow.endDate
            },
              cleaningTask: {
              id: task.id,
              scheduledDate: task.scheduledDate,
              status: task.status
            }
            },
            detectedAt: new Date().toISOString()
          });
        }
      }
    }
  }

  for (const plan of allocationPlans) {
    if (plan.status === 'confirmed') {
      const project = performanceProjects.find(p => p.id === plan.projectId);
      if (!project) continue;

      const totalNeeded = project.roles.reduce((s, r) => s + r.quantity, 0);
      const confirmedAllocations = plan.allocations.length;
      const createdBorrows = borrowRecords.filter(b =>
        b.planId === plan.planId
      ).length;

      if (confirmedAllocations < totalNeeded) {
        anomalies.push({
          id: anomalyIdCounter(),
          anomalyType: ANOMALY_TYPES.PROJECT_SHORTAGE,
          severity: 'high',
          projectId: project.id,
          planId: plan.planId,
          leaderName: project.leaderName,
          description: `项目「${project.name}」方案确认后分配数量不足：需要 ${totalNeeded}，已分配 ${confirmedAllocations}`,
          details: {
            projectName: project.name,
            leaderName: project.leaderName,
            totalNeeded,
            confirmedAllocations,
            createdBorrowRecords: createdBorrows,
            shortage: totalNeeded - confirmedAllocations,
            roleDetails: project.roles.map(r => ({
              roleName: r.roleName,
              quantity: r.quantity,
              allocatedCount: plan.allocations.filter(a => a.roleId === r.roleId).length
            }))
          },
          detectedAt: new Date().toISOString()
        });
      }
    }
  }

  anomalyRecords.push(...anomalies);

  anomalies.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const sa = severityOrder[a.severity] || 99;
    const sb = severityOrder[b.severity] || 99;
    if (sa !== sb) return sa - sb;
    return new Date(b.detectedAt) - new Date(a.detectedAt);
  });

  ctx.body = generateResponse(200, '异常扫描完成', {
    list: anomalies,
    total: anomalies.length,
    summary: {
      critical: anomalies.filter(a => a.severity === 'critical').length,
      high: anomalies.filter(a => a.severity === 'high').length,
      medium: anomalies.filter(a => a.severity === 'medium').length,
      low: anomalies.filter(a => a.severity === 'low').length
    }
  });
}

function getAnomalyStats(ctx) {
  const { startDate, endDate, severity, anomalyType } = ctx.query;

  let records = [...anomalyRecords];

  if (startDate) {
    records = records.filter(r => new Date(r.detectedAt) >= parseDate(startDate));
  }
  if (endDate) {
    const end = parseDate(endDate);
    end.setHours(23, 59, 59, 999);
    records = records.filter(r => new Date(r.detectedAt) <= end);
  }
  if (severity) {
    records = records.filter(r => r.severity === severity);
  }
  if (anomalyType) {
    const types = anomalyType.split(',').map(t => t.trim());
    records = records.filter(r => types.includes(r.anomalyType));
  }

  const byType = {};
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const byCostume = {};
  const byProject = {};

  for (const r of records) {
    if (!byType[r.anomalyType]) {
      byType[r.anomalyType] = 0;
    }
    byType[r.anomalyType]++;

    if (bySeverity[r.severity] !== undefined) {
      bySeverity[r.severity]++;
    }

    if (r.costumeNumber) {
      if (!byCostume[r.costumeNumber]) {
        byCostume[r.costumeNumber] = { count: 0, types: new Set() };
      }
      byCostume[r.costumeNumber].count++;
      byCostume[r.costumeNumber].types.add(r.anomalyType);
    }

    if (r.projectId) {
      const key = String(r.projectId);
      if (!byProject[key]) {
        byProject[key] = { count: 0, leaderName: r.leaderName || null };
      }
      byProject[key].count++;
    }
  }

  const topCostumes = Object.entries(byCostume)
    .map(([number, info]) => ({
      costumeNumber: number,
      anomalyCount: info.count,
      anomalyTypes: Array.from(info.types)
    }))
    .sort((a, b) => b.anomalyCount - a.anomalyCount)
    .slice(0, 10);

  const typeLabels = {
    [ANOMALY_TYPES.STATUS_INCONSISTENCY]: '状态与业务记录不一致',
    [ANOMALY_TYPES.SCHEDULE_CONFLICT]: '档期冲突',
    [ANOMALY_TYPES.UNCLEAN_BUT_BORROWABLE]: '清洗未完成却可借',
    [ANOMALY_TYPES.MAINTENANCE_INCOMPLETE_BUT_BORROWABLE]: '维修未完成却可借',
    [ANOMALY_TYPES.MISSING_ACCESSORY_BUT_AVAILABLE]: '缺配件却进入可用候选',
    [ANOMALY_TYPES.PROJECT_SHORTAGE]: '项目确认后分配数量不足'
  };

  const byTypeWithLabel = {};
  for (const [type, count] of Object.entries(byType)) {
    byTypeWithLabel[type] = {
      count,
      label: typeLabels[type] || type
    };
  }

  ctx.body = generateResponse(200, '获取成功', {
    total: records.length,
    bySeverity,
    byType: byTypeWithLabel,
    topCostumes,
    projects: Object.entries(byProject).map(([pid, info]) => ({
      projectId: parseInt(pid),
      leaderName: info.leaderName,
      anomalyCount: info.count
    })).sort((a, b) => b.anomalyCount - a.anomalyCount)
  });
}

module.exports = {
  createAuditLog,
  getAuditLogs,
  getCostumeTimeline,
  scanAnomalies,
  getAnomalyStats
};
