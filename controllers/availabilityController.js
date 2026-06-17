const {
  costumes,
  borrowRecords,
  cleaningSchedule,
  allocationPlans,
  warehouses,
  transferRecords
} = require('../models/store');
const {
  generateResponse,
  matchSize,
  calculateSizeScore,
  hasDateOverlap,
  isDateInRange,
  formatDate,
  parseDate,
  daysBetween
} = require('../utils/helpers');

const DEFAULT_TRANSFER_DAYS = 3;

function getRegionTransferDays(sourceRegion, targetRegion) {
  if (sourceRegion === targetRegion) return 0;
  return DEFAULT_TRANSFER_DAYS;
}

function isCostumeAvailableInRange(costume, startDate, endDate) {
  if (costume.status === 'maintenance') {
    return { available: false, reason: '维修中', code: 'maintenance' };
  }
  if (costume.status === 'cleaning') {
    return { available: false, reason: '清洗中', code: 'cleaning' };
  }
  if (costume.status === 'borrowed') {
    return { available: false, reason: '借出中', code: 'borrowed' };
  }
  if (costume.status === 'transferring') {
    return { available: false, reason: '调拨中', code: 'transferring' };
  }
  if (costume.status === 'approved_transfer') {
    return { available: false, reason: '调拨待出库', code: 'approved_transfer' };
  }
  if (costume.cleaningStatus === 'dirty') {
    return { available: false, reason: '待清洗', code: 'dirty' };
  }

  const start = formatDate(startDate);
  const end = formatDate(endDate);

  const hasSlot = costume.availableSlots.some(slot =>
    hasDateOverlap(start, end, slot.startDate, slot.endDate)
  );
  if (!hasSlot) {
    return { available: false, reason: '档期不可用', code: 'no_slot' };
  }

  const overlappingBorrows = borrowRecords.filter(b =>
    b.costumeId === costume.id &&
    b.status === 'borrowed' &&
    hasDateOverlap(start, end, b.startDate, b.endDate)
  );
  if (overlappingBorrows.length > 0) {
    return { available: false, reason: '档期已被借用', code: 'overlapping_borrow' };
  }

  const overlappingCleanings = cleaningSchedule.filter(t =>
    t.costumeId === costume.id &&
    t.status !== 'completed' &&
    isDateInRange(t.scheduledDate, start, end)
  );
  if (overlappingCleanings.length > 0) {
    return { available: false, reason: '档期有清洗排期', code: 'overlapping_cleaning' };
  }

  const overlappingPlans = allocationPlans.filter(p =>
    p.status === 'pending' &&
    p.allocations.some(a =>
      a.costumeId === costume.id &&
      hasDateOverlap(start, end, a.startDate, a.endDate)
    )
  );
  if (overlappingPlans.length > 0) {
    return { available: false, reason: '被待确认方案占用', code: 'overlapping_plan' };
  }

  return { available: true, reason: '可用', code: 'available' };
}

function queryRegionalAvailability(ctx) {
  const {
    height,
    weight,
    performanceType,
    startDate,
    endDate,
    region,
    projectId,
    leaderName
  } = ctx.request.body;

  if (!height || !weight || !startDate || !endDate) {
    ctx.body = generateResponse(400, '参数不完整：身高、体重、开始和结束日期为必填', null);
    return;
  }

  const start = parseDate(startDate);
  const end = parseDate(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    ctx.body = generateResponse(400, '日期格式无效', null);
    return;
  }

  if (start > end) {
    ctx.body = generateResponse(400, 'startDate 不能晚于 endDate', null);
    return;
  }

  let targetRegion = region;
  if (!targetRegion && leaderName) {
    const { performanceProjects } = require('../models/store');
    const leaderProject = performanceProjects.find(p => p.leaderName === leaderName);
    if (leaderProject) {
      const leaderBorrows = borrowRecords.filter(b =>
        b.leaderName === leaderName && b.status === 'borrowed'
      );
      if (leaderBorrows.length > 0) {
        const costume = costumes.find(c => c.id === leaderBorrows[0].costumeId);
        if (costume && costume.warehouseRegion) {
          targetRegion = costume.warehouseRegion;
        }
      }
    }
  }

  if (projectId) {
    const { performanceProjects } = require('../models/store');
    const project = performanceProjects.find(p => p.id === parseInt(projectId));
    if (project && !targetRegion) {
      const projectBorrows = borrowRecords.filter(b =>
        b.projectId === project.id && b.status === 'borrowed'
      );
      if (projectBorrows.length > 0) {
        const costume = costumes.find(c => c.id === projectBorrows[0].costumeId);
        if (costume && costume.warehouseRegion) {
          targetRegion = costume.warehouseRegion;
        }
      }
    }
  }

  const matched = [];

  for (const costume of costumes) {
    if (performanceType && costume.performanceType !== performanceType) continue;

    const sizeMatches = matchSize(height, weight, costume.sizeRange);
    if (sizeMatches.length === 0) continue;

    let bestSize = sizeMatches[0];
    let bestScore = 0;
    for (const size of sizeMatches) {
      const score = calculateSizeScore(height, weight, size);
      if (score > bestScore) {
        bestScore = score;
        bestSize = size;
      }
    }

    const availability = isCostumeAvailableInRange(costume, start, end);

    const costumeRegion = costume.warehouseRegion || null;
    const isSameRegion = targetRegion && costumeRegion === targetRegion;
    const estimatedTransferDays = targetRegion && costumeRegion
      ? getRegionTransferDays(costumeRegion, targetRegion)
      : (costumeRegion ? DEFAULT_TRANSFER_DAYS : 0);

    const regionPriority = isSameRegion ? 100 : 0;
    const totalScore = bestScore * 60 + regionPriority;

    matched.push({
      costume: {
        id: costume.id,
        costumeNumber: costume.costumeNumber,
        performanceType: costume.performanceType,
        sizeRange: costume.sizeRange,
        accessories: costume.accessories,
        status: costume.status,
        cleaningStatus: costume.cleaningStatus,
        warehouseId: costume.warehouseId || null,
        warehouseName: costume.warehouseName || null,
        warehouseRegion: costumeRegion,
        location: costume.location || null
      },
      matchedSize: bestSize,
      sizeScore: (bestScore * 100).toFixed(1),
      regionMatch: {
        isSameRegion,
        costumeRegion,
        targetRegion: targetRegion || null,
        estimatedTransferDays: isSameRegion ? 0 : estimatedTransferDays
      },
      availability: {
        isAvailable: availability.available,
        reason: availability.reason,
        code: availability.code
      },
      totalScore: totalScore.toFixed(1)
    });
  }

  matched.sort((a, b) => {
    if (a.availability.isAvailable !== b.availability.isAvailable) {
      return a.availability.isAvailable ? -1 : 1;
    }
    if (a.regionMatch.isSameRegion !== b.regionMatch.isSameRegion) {
      return a.regionMatch.isSameRegion ? -1 : 1;
    }
    return parseFloat(b.totalScore) - parseFloat(a.totalScore);
  });

  const sameRegionAvailable = matched.filter(
    m => m.availability.isAvailable && m.regionMatch.isSameRegion
  );
  const crossRegionAvailable = matched.filter(
    m => m.availability.isAvailable && !m.regionMatch.isSameRegion
  );
  const unavailable = matched.filter(m => !m.availability.isAvailable);

  ctx.body = generateResponse(200, '区域可用性查询成功', {
    query: {
      height,
      weight,
      performanceType: performanceType || null,
      startDate: formatDate(start),
      endDate: formatDate(end),
      targetRegion: targetRegion || null
    },
    summary: {
      totalMatched: matched.length,
      sameRegionAvailable: sameRegionAvailable.length,
      crossRegionAvailable: crossRegionAvailable.length,
      unavailable: unavailable.length
    },
    sameRegionResults: sameRegionAvailable,
    crossRegionResults: crossRegionAvailable.map(c => ({
      ...c,
      crossRegionNote: `跨仓候选，预计调拨${c.regionMatch.estimatedTransferDays}天`
    })),
    unavailableResults: unavailable
  });
}

function getTransferStatistics(ctx) {
  const { startDate, endDate } = ctx.query;

  let records = [...transferRecords];

  if (startDate) {
    const s = parseDate(startDate);
    records = records.filter(t => new Date(t.createdAt) >= s);
  }
  if (endDate) {
    const e = parseDate(endDate);
    e.setHours(23, 59, 59, 999);
    records = records.filter(t => new Date(t.createdAt) <= e);
  }

  const warehouseStats = {};
  for (const wh of warehouses) {
    warehouseStats[wh.id] = {
      warehouseId: wh.id,
      warehouseName: wh.name,
      region: wh.region,
      stockCount: 0,
      inTransitIn: 0,
      inTransitOut: 0,
      transferIn: 0,
      transferOut: 0,
      completedIn: 0,
      completedOut: 0
    };
  }

  for (const costume of costumes) {
    if (costume.warehouseId && warehouseStats[costume.warehouseId]) {
      warehouseStats[costume.warehouseId].stockCount++;
    }
  }

  const totalTransfers = records.length;
  const completedTransfers = records.filter(t => t.status === 'completed').length;
  const rejectedTransfers = records.filter(t => t.status === 'rejected').length;

  let statusConflictRejected = 0;
  for (const t of records) {
    if (t.status === 'rejected' && t.rejectionReason &&
        (t.rejectionReason.includes('状态') || t.rejectionReason.includes('不符合调拨条件'))) {
      statusConflictRejected++;
    }
  }

  let totalTransferDays = 0;
  let transferDaysCount = 0;
  for (const t of records) {
    if (t.status === 'completed' && t.outboundAt && t.inboundAt) {
      totalTransferDays += daysBetween(t.outboundAt, t.inboundAt);
      transferDaysCount++;
    }
  }

  const avgTransferDays = transferDaysCount > 0
    ? (totalTransferDays / transferDaysCount).toFixed(1)
    : 0;

  const completionRate = totalTransfers > 0
    ? ((completedTransfers / totalTransfers) * 100).toFixed(1) + '%'
    : '0%';

  for (const t of records) {
    if (t.sourceWarehouseId && warehouseStats[t.sourceWarehouseId]) {
      warehouseStats[t.sourceWarehouseId].transferOut++;
      if (t.status === 'transferring') {
        warehouseStats[t.sourceWarehouseId].inTransitOut++;
      }
      if (t.status === 'completed') {
        warehouseStats[t.sourceWarehouseId].completedOut++;
      }
    }
    if (t.targetWarehouseId && warehouseStats[t.targetWarehouseId]) {
      warehouseStats[t.targetWarehouseId].transferIn++;
      if (t.status === 'transferring') {
        warehouseStats[t.targetWarehouseId].inTransitIn++;
      }
      if (t.status === 'completed') {
        warehouseStats[t.targetWarehouseId].completedIn++;
      }
    }
  }

  const inTransitCount = records.filter(t => t.status === 'transferring').length;

  const byStatus = {
    pending: records.filter(t => t.status === 'pending').length,
    approved: records.filter(t => t.status === 'approved').length,
    transferring: inTransitCount,
    completed: completedTransfers,
    rejected: rejectedTransfers
  };

  const byRegion = {};
  for (const t of records) {
    const srcRegion = t.sourceRegion || '未知';
    const tgtRegion = t.targetRegion || '未知';
    const key = `${srcRegion}→${tgtRegion}`;
    if (!byRegion[key]) {
      byRegion[key] = {
        sourceRegion: srcRegion,
        targetRegion: tgtRegion,
        count: 0,
        completed: 0,
        avgDays: 0,
        _totalDays: 0,
        _daysCount: 0
      };
    }
    byRegion[key].count++;
    if (t.status === 'completed') {
      byRegion[key].completed++;
      if (t.outboundAt && t.inboundAt) {
        byRegion[key]._totalDays += daysBetween(t.outboundAt, t.inboundAt);
        byRegion[key]._daysCount++;
      }
    }
  }

  for (const key of Object.keys(byRegion)) {
    const item = byRegion[key];
    item.avgDays = item._daysCount > 0
      ? (item._totalDays / item._daysCount).toFixed(1)
      : 0;
    delete item._totalDays;
    delete item._daysCount;
  }

  ctx.body = generateResponse(200, '调拨统计获取成功', {
    summary: {
      totalTransfers,
      completionRate,
      avgTransferDays,
      inTransitCount,
      statusConflictRejected
    },
    byStatus,
    byRegion: Object.values(byRegion),
    warehouseDetails: Object.values(warehouseStats)
  });
}

module.exports = {
  queryRegionalAvailability,
  getTransferStatistics
};
