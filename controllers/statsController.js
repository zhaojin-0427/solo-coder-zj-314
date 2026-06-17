const { costumes, borrowRecords, returnRecords, cleaningSchedule, performanceProjects, allocationPlans } = require('../models/store');
const { generateResponse, daysBetween, parseDate, formatDate, hasDateOverlap, isDateInRange } = require('../utils/helpers');

function getSizeGapStats(ctx) {
  const allSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const sizeStats = {};

  for (const size of allSizes) {
    sizeStats[size] = {
      total: 0,
      available: 0,
      borrowed: 0,
      cleaning: 0,
      maintenance: 0
    };
  }

  for (const costume of costumes) {
    const sizes = costume.sizeRange.split(',').map(s => s.trim());
    for (const size of sizes) {
      if (sizeStats[size]) {
        sizeStats[size].total++;
        if (costume.status === 'available') {
          sizeStats[size].available++;
        } else if (costume.status === 'borrowed') {
          sizeStats[size].borrowed++;
        } else if (costume.status === 'cleaning') {
          sizeStats[size].cleaning++;
        } else if (costume.status === 'maintenance') {
          sizeStats[size].maintenance++;
        }
      }
    }
  }

  const borrowedCount = borrowRecords.filter(b => b.status === 'borrowed').length;
  const sizeGaps = [];
  for (const size of allSizes) {
    const stat = sizeStats[size];
    const gap = stat.borrowed > 0 ? Math.max(0, stat.borrowed - stat.available) : 0;
    sizeGaps.push({
      size,
      total: stat.total,
      available: stat.available,
      borrowed: stat.borrowed,
      cleaning: stat.cleaning,
      maintenance: stat.maintenance,
      gap: gap,
      gapLevel: gap === 0 ? 'normal' : gap < 3 ? 'low' : gap < 5 ? 'medium' : 'high'
    });
  }

  sizeGaps.sort((a, b) => b.gap - a.gap);

  const topGap = sizeGaps[0]?.gap || 0;
  const maxGapSize = topGap > 0 ? sizeGaps[0].size : 'N/A';

  ctx.body = generateResponse(200, '获取成功', {
    sizeGaps,
    summary: {
      totalCostumes: costumes.length,
      totalBorrowed: borrowedCount,
      maxGapSize,
      maxGap: topGap
    }
  });
}

function getTurnoverStats(ctx) {
  const totalCostumes = costumes.length;
  const totalBorrows = borrowRecords.length;
  const returnedBorrows = borrowRecords.filter(b => b.status === 'returned');

  let totalBorrowDays = 0;
  for (const borrow of returnedBorrows) {
    if (borrow.startDate && borrow.endDate) {
      totalBorrowDays += daysBetween(borrow.startDate, borrow.endDate);
    }
  }

  const turnoverRate = totalCostumes > 0 ? (totalBorrows / totalCostumes).toFixed(2) : 0;
  const avgBorrowDays = returnedBorrows.length > 0 ? (totalBorrowDays / returnedBorrows.length).toFixed(1) : 0;

  const costumeTurnover = {};
  for (const borrow of borrowRecords) {
    if (!costumeTurnover[borrow.costumeId]) {
      costumeTurnover[borrow.costumeId] = {
        costumeId: borrow.costumeId,
        costumeNumber: borrow.costumeNumber,
        borrowCount: 0
      };
    }
    costumeTurnover[borrow.costumeId].borrowCount++;
  }

  const turnoverRanking = Object.values(costumeTurnover)
    .sort((a, b) => b.borrowCount - a.borrowCount)
    .slice(0, 10);

  ctx.body = generateResponse(200, '获取成功', {
    summary: {
      totalCostumes,
      totalBorrows,
      returnedBorrows: returnedBorrows.length,
      turnoverRate,
      avgBorrowDays
    },
    turnoverRanking
  });
}

function getAccessoryLossStats(ctx) {
  const accessoryCount = {};

  for (const returnRecord of returnRecords) {
    if (returnRecord.missingAccessories && returnRecord.missingAccessories.length > 0) {
      for (const accessory of returnRecord.missingAccessories) {
        if (!accessoryCount[accessory]) {
          accessoryCount[accessory] = {
            accessoryName: accessory,
            missingCount: 0,
            affectedReturns: 0
          };
        }
        accessoryCount[accessory].missingCount++;
      }
      accessoryCount[returnRecord.missingAccessories[0]].affectedReturns++;
    }
  }

  const ranking = Object.values(accessoryCount)
    .sort((a, b) => b.missingCount - a.missingCount)
    .map((item, index) => ({
      rank: index + 1,
      ...item
    }));

  const totalMissing = ranking.reduce((sum, item) => sum + item.missingCount, 0);
  const totalReturnsWithMissing = returnRecords.filter(
    r => r.missingAccessories && r.missingAccessories.length > 0
  ).length;

  ctx.body = generateResponse(200, '获取成功', {
    ranking,
    summary: {
      totalReturns: returnRecords.length,
      totalReturnsWithMissing,
      totalMissingAccessories: totalMissing,
      missingRate: returnRecords.length > 0
        ? ((totalReturnsWithMissing / returnRecords.length) * 100).toFixed(1) + '%'
        : '0%'
    }
  });
}

function getCleaningWaitStats(ctx) {
  const pendingCleanings = cleaningSchedule.filter(t => t.status === 'pending');
  const completedCleanings = cleaningSchedule.filter(t => t.status === 'completed');

  let totalWaitDays = 0;
  for (const task of completedCleanings) {
    if (task.createdAt && task.completedDate) {
      totalWaitDays += daysBetween(task.createdAt, task.completedDate);
    }
  }

  let currentWaitDays = 0;
  const now = new Date();
  for (const task of pendingCleanings) {
    currentWaitDays += daysBetween(task.createdAt, now);
  }

  const avgWaitDays = completedCleanings.length > 0
    ? (totalWaitDays / completedCleanings.length).toFixed(1)
    : 0;

  const avgCurrentWait = pendingCleanings.length > 0
    ? (currentWaitDays / pendingCleanings.length).toFixed(1)
    : 0;

  const stainLevelStats = {};
  for (const task of cleaningSchedule) {
    const level = task.stainLevel || 0;
    if (!stainLevelStats[level]) {
      stainLevelStats[level] = {
        stainLevel: level,
        count: 0,
        avgWaitDays: 0
      };
    }
    stainLevelStats[level].count++;
  }

  const stainWaitDistribution = Object.values(stainLevelStats).sort((a, b) => a.stainLevel - b.stainLevel);

  ctx.body = generateResponse(200, '获取成功', {
    summary: {
      totalCleaningTasks: cleaningSchedule.length,
      pendingCount: pendingCleanings.length,
      completedCount: completedCleanings.length,
      avgWaitDays,
      avgCurrentWait,
      longestWaitDays: pendingCleanings.length > 0 ? Math.ceil(currentWaitDays / pendingCleanings.length) : 0
    },
    stainWaitDistribution,
    pendingList: pendingCleanings
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(0, 10)
  });
}

function filterCostumesByCriteria(performanceType, size) {
  let filtered = [...costumes];
  if (performanceType) {
    filtered = filtered.filter(c => c.performanceType === performanceType);
  }
  if (size) {
    filtered = filtered.filter(c => {
      const sizes = c.sizeRange.split(',').map(s => s.trim());
      return sizes.includes(size);
    });
  }
  return filtered;
}

function getCostumeStatusOnDate(costume, date) {
  const dateStr = formatDate(date);

  const isBorrowed = borrowRecords.some(borrow => {
    if (borrow.costumeId !== costume.id) return false;
    if (borrow.status !== 'borrowed') return false;
    return isDateInRange(dateStr, borrow.startDate, borrow.endDate);
  });
  if (isBorrowed) return 'borrowed';

  const isCleaning = cleaningSchedule.some(task => {
    if (task.costumeId !== costume.id) return false;
    if (task.status !== 'pending' && task.status !== 'in_progress') return false;
    return task.scheduledDate === dateStr;
  });
  if (isCleaning) return 'cleaning';

  if (costume.status === 'maintenance') return 'maintenance';
  if (costume.status === 'cleaning') return 'cleaning';
  if (costume.cleaningStatus === 'dirty') return 'dirty';

  const hasSlot = costume.availableSlots.some(slot => {
    return isDateInRange(dateStr, slot.startDate, slot.endDate);
  });
  if (!hasSlot) return 'unavailable';

  return 'available';
}

function findConflictRiskCostumes(date, filteredCostumes) {
  const dateStr = formatDate(date);
  const conflicts = [];

  for (const costume of filteredCostumes) {
    const borrowsOnDate = borrowRecords.filter(borrow => {
      if (borrow.costumeId !== costume.id) return false;
      if (borrow.status !== 'borrowed') return false;
      return isDateInRange(dateStr, borrow.startDate, borrow.endDate);
    });

    if (borrowsOnDate.length > 1) {
      conflicts.push({
        costumeId: costume.id,
        costumeNumber: costume.costumeNumber,
        performanceType: costume.performanceType,
        sizeRange: costume.sizeRange,
        conflictType: 'overlapping_borrows',
        conflictDescription: `该服装在${dateStr}有${borrowsOnDate.length}条借用记录重叠`,
        borrowCount: borrowsOnDate.length
      });
      continue;
    }

    const hasCleaningOnDate = cleaningSchedule.some(task => {
      if (task.costumeId !== costume.id) return false;
      if (task.status === 'completed') return false;
      return task.scheduledDate === dateStr;
    });

    const hasBorrowOnDate = borrowsOnDate.length > 0;

    if (hasCleaningOnDate && hasBorrowOnDate) {
      conflicts.push({
        costumeId: costume.id,
        costumeNumber: costume.costumeNumber,
        performanceType: costume.performanceType,
        sizeRange: costume.sizeRange,
        conflictType: 'borrow_cleaning_conflict',
        conflictDescription: `该服装在${dateStr}既有借用又有清洗排期`,
        borrowCount: borrowsOnDate.length
      });
    }
  }

  return conflicts;
}

function getDailyAvailabilityStats(ctx) {
  const { startDate, endDate, performanceType, size } = ctx.query;

  if (!startDate || !endDate) {
    ctx.body = generateResponse(400, '参数不完整：请提供 startDate 和 endDate', null);
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

  const filteredCostumes = filterCostumesByCriteria(performanceType, size);
  const dailyStats = [];
  const totalDays = daysBetween(start, end) + 1;

  for (let i = 0; i < totalDays; i++) {
    const currentDate = new Date(start);
    currentDate.setDate(start.getDate() + i);
    const dateStr = formatDate(currentDate);

    let availableCount = 0;
    let borrowedCount = 0;
    let cleaningCount = 0;
    let maintenanceCount = 0;
    let dirtyCount = 0;

    for (const costume of filteredCostumes) {
      const status = getCostumeStatusOnDate(costume, currentDate);
      switch (status) {
        case 'available':
          availableCount++;
          break;
        case 'borrowed':
          borrowedCount++;
          break;
        case 'cleaning':
          cleaningCount++;
          break;
        case 'maintenance':
          maintenanceCount++;
          break;
        case 'dirty':
          dirtyCount++;
          break;
      }
    }

    const conflictRiskCostumes = findConflictRiskCostumes(currentDate, filteredCostumes);

    dailyStats.push({
      date: dateStr,
      totalCount: filteredCostumes.length,
      availableCount,
      borrowedCount,
      cleaningCount,
      maintenanceCount,
      dirtyCount,
      conflictRiskCount: conflictRiskCostumes.length,
      conflictRiskCostumes
    });
  }

  ctx.body = generateResponse(200, '获取成功', {
    query: { startDate: formatDate(start), endDate: formatDate(end), performanceType: performanceType || null, size: size || null },
    totalDays: dailyStats.length,
    totalCostumesFiltered: filteredCostumes.length,
    dailyStats
  });
}

function getDashboardStats(ctx) {
  const totalCostumes = costumes.length;
  const availableCount = costumes.filter(c => c.status === 'available').length;
  const borrowedCount = costumes.filter(c => c.status === 'borrowed').length;
  const cleaningCount = costumes.filter(c => c.status === 'cleaning').length;
  const maintenanceCount = costumes.filter(c => c.status === 'maintenance').length;

  const today = new Date().toISOString().split('T')[0];
  const todayBorrows = borrowRecords.filter(b => {
    return b.createdAt && b.createdAt.split('T')[0] === today;
  }).length;

  const todayReturns = returnRecords.filter(r => {
    return r.createdAt && r.createdAt.split('T')[0] === today;
  }).length;

  const pendingCleaning = cleaningSchedule.filter(t => t.status === 'pending').length;

  ctx.body = generateResponse(200, '获取成功', {
    costumeStats: {
      total: totalCostumes,
      available: availableCount,
      borrowed: borrowedCount,
      cleaning: cleaningCount,
      maintenance: maintenanceCount
    },
    todayStats: {
      borrows: todayBorrows,
      returns: todayReturns
    },
    cleaningStats: {
      pending: pendingCleaning
    }
  });
}

function getLatestValidPlans() {
  const projectPlanMap = {};
  const validStatuses = ['pending', 'confirmed'];

  for (const plan of allocationPlans) {
    if (!validStatuses.includes(plan.status)) continue;
    const projId = plan.projectId;
    const current = projectPlanMap[projId];
    if (!current) {
      projectPlanMap[projId] = plan;
    } else {
      if (plan.status === 'confirmed' && current.status !== 'confirmed') {
        projectPlanMap[projId] = plan;
      } else if (plan.status === current.status) {
        if (new Date(plan.generatedAt) > new Date(current.generatedAt)) {
          projectPlanMap[projId] = plan;
        }
      }
    }
  }

  return Object.values(projectPlanMap);
}

function getProjectGapStats(ctx) {
  const { status } = ctx.query;

  let plans = getLatestValidPlans();

  if (status) {
    plans = plans.filter(p => p.status === status);
  }

  const projectGaps = [];
  let totalMissingAll = 0;
  let totalNeededAll = 0;

  for (const plan of plans) {
    const project = performanceProjects.find(p => p.id === plan.projectId);
    if (!project) continue;

    const totalNeeded = project.roles.reduce((s, r) => s + r.quantity, 0);
    const totalAllocated = plan.allocations.length;
    const totalMissing = plan.summary.totalMissing;

    totalNeededAll += totalNeeded;
    totalMissingAll += totalMissing;

    const roleGaps = plan.gaps.map(g => ({
      roleId: g.roleId,
      roleName: g.roleName,
      needed: g.needed,
      allocated: g.allocated,
      missing: g.missing,
      priority: g.priority,
      sizeConstraints: g.sizeConstraints,
      performanceType: g.performanceType,
      requiredAccessories: g.requiredAccessories,
      reasons: g.reasons
    }));

    projectGaps.push({
      planId: plan.planId,
      planStatus: plan.status,
      projectId: project.id,
      projectName: project.name,
      leaderName: project.leaderName,
      generatedAt: plan.generatedAt,
      summary: {
        totalNeeded,
        totalAllocated,
        totalMissing,
        missingRate: plan.summary.missingRate,
        overallSatisfaction: plan.summary.overallSatisfaction,
        affectedRoles: plan.summary.affectedRoles
      },
      roleGaps
    });
  }

  projectGaps.sort((a, b) => b.summary.totalMissing - a.summary.totalMissing);

  ctx.body = generateResponse(200, '获取成功', {
    summary: {
      totalPlans: plans.length,
      totalProjects: new Set(projectGaps.map(p => p.projectId)).size,
      totalNeeded: totalNeededAll,
      totalMissing: totalMissingAll,
      overallMissingRate: totalNeededAll > 0
        ? ((totalMissingAll / totalNeededAll) * 100).toFixed(1) + '%'
        : '0%'
    },
    projectGaps
  });
}

function getRoleSatisfactionStats(ctx) {
  const { projectId, leaderName } = ctx.query;

  let plans = allocationPlans.filter(p => p.status === 'pending' || p.status === 'confirmed');
  const result = [];

  if (projectId) {
    plans = plans.filter(p => p.projectId === parseInt(projectId));
  }

  const roleMap = {};

  for (const plan of plans) {
    const project = performanceProjects.find(p => p.id === plan.projectId);
    if (!project) continue;
    if (leaderName && project.leaderName !== leaderName) continue;

    for (const [roleId, info] of Object.entries(plan.roleSatisfaction)) {
      if (!roleMap[roleId]) {
        roleMap[roleId] = {
          roleId,
          roleName: info.roleName,
          totalNeeded: 0,
          totalAllocated: 0,
          projectCount: 0,
          priority: info.priority
        };
      }
      roleMap[roleId].totalNeeded += info.needed;
      roleMap[roleId].totalAllocated += info.allocated;
      roleMap[roleId].projectCount++;
    }
  }

  const roleList = Object.values(roleMap).map(r => ({
    ...r,
    satisfactionRate: r.totalNeeded > 0
      ? ((r.totalAllocated / r.totalNeeded) * 100).toFixed(1) + '%'
      : '0%',
    missing: r.totalNeeded - r.totalAllocated
  }));

  roleList.sort((a, b) => {
    const rateA = parseFloat(a.satisfactionRate);
    const rateB = parseFloat(b.satisfactionRate);
    return rateA - rateB;
  });

  const totalNeeded = roleList.reduce((s, r) => s + r.totalNeeded, 0);
  const totalAllocated = roleList.reduce((s, r) => s + r.totalAllocated, 0);

  ctx.body = generateResponse(200, '获取成功', {
    summary: {
      totalRoles: roleList.length,
      totalNeeded,
      totalAllocated,
      overallSatisfaction: totalNeeded > 0
        ? ((totalAllocated / totalNeeded) * 100).toFixed(1) + '%'
        : '100%'
    },
    roles: roleList
  });
}

function getCostumeOccupancyStats(ctx) {
  const { startDate, endDate, performanceType } = ctx.query;

  if (!startDate || !endDate) {
    ctx.body = generateResponse(400, '参数不完整：请提供 startDate 和 endDate', null);
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

  const startStr = formatDate(start);
  const endStr = formatDate(end);
  const totalDays = daysBetween(start, end) + 1;
  const totalCostumeDays = costumes.length * totalDays;

  let occupiedCostumeDays = 0;
  const costumeOccupancy = [];

  let filteredCostumes = [...costumes];
  if (performanceType) {
    filteredCostumes = filteredCostumes.filter(c => c.performanceType === performanceType);
  }

  for (const costume of filteredCostumes) {
    let occupiedDays = 0;
    const dailyDetails = [];

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dateStr = formatDate(d);

      let status = 'available';

      const isBorrowed = borrowRecords.some(b => {
        if (b.costumeId !== costume.id) return false;
        if (b.status !== 'borrowed') return false;
        return isDateInRange(dateStr, b.startDate, b.endDate);
      });

      if (isBorrowed) {
        status = 'borrowed';
        occupiedDays++;
      } else {
        const isInPlan = allocationPlans.some(p => {
          if (p.status !== 'pending' && p.status !== 'confirmed') return false;
          return p.allocations.some(a => {
            if (a.costumeId !== costume.id) return false;
            return isDateInRange(dateStr, a.startDate, a.endDate);
          });
        });

        if (isInPlan) {
          status = 'planned';
          occupiedDays++;
        } else if (costume.status === 'cleaning') {
          status = 'cleaning';
        } else if (costume.status === 'maintenance') {
          status = 'maintenance';
        }
      }

      dailyDetails.push({ date: dateStr, status });
    }

    occupiedCostumeDays += occupiedDays;

    costumeOccupancy.push({
      costumeId: costume.id,
      costumeNumber: costume.costumeNumber,
      performanceType: costume.performanceType,
      sizeRange: costume.sizeRange,
      totalDays,
      occupiedDays,
      availableDays: totalDays - occupiedDays,
      occupancyRate: ((occupiedDays / totalDays) * 100).toFixed(1) + '%',
      dailyDetails
    });
  }

  costumeOccupancy.sort((a, b) => parseFloat(b.occupancyRate) - parseFloat(a.occupancyRate));

  ctx.body = generateResponse(200, '获取成功', {
    query: {
      startDate: startStr,
      endDate: endStr,
      performanceType: performanceType || null,
      totalDays
    },
    summary: {
      totalCostumes: filteredCostumes.length,
      totalCostumeDays: filteredCostumes.length * totalDays,
      occupiedCostumeDays,
      availableCostumeDays: filteredCostumes.length * totalDays - occupiedCostumeDays,
      overallOccupancyRate: filteredCostumes.length > 0
        ? ((occupiedCostumeDays / (filteredCostumes.length * totalDays)) * 100).toFixed(1) + '%'
        : '0%'
    },
    costumes: costumeOccupancy
  });
}

function getProjectDashboardStats(ctx) {
  const totalProjects = performanceProjects.length;
  const draftProjects = performanceProjects.filter(p => p.status === 'draft').length;
  const plannedProjects = performanceProjects.filter(p => p.status === 'planned').length;
  const confirmedProjects = performanceProjects.filter(p => p.status === 'confirmed').length;

  const totalPlans = allocationPlans.length;
  const pendingPlans = allocationPlans.filter(p => p.status === 'pending').length;
  const confirmedPlans = allocationPlans.filter(p => p.status === 'confirmed').length;

  let totalNeeded = 0;
  let totalAllocated = 0;
  for (const plan of allocationPlans) {
    if (plan.summary) {
      totalNeeded += plan.summary.totalNeeded || 0;
      totalAllocated += plan.summary.totalAllocated || 0;
    }
  }

  const confirmedBorrows = borrowRecords.filter(b => b.projectId);

  const leaderStats = {};
  for (const project of performanceProjects) {
    if (!leaderStats[project.leaderName]) {
      leaderStats[project.leaderName] = {
        leaderName: project.leaderName,
        projectCount: 0,
        confirmedCount: 0
      };
    }
    leaderStats[project.leaderName].projectCount++;
    if (project.status === 'confirmed') {
      leaderStats[project.leaderName].confirmedCount++;
    }
  }

  ctx.body = generateResponse(200, '获取成功', {
    projectStats: {
      total: totalProjects,
      draft: draftProjects,
      planned: plannedProjects,
      confirmed: confirmedProjects
    },
    planStats: {
      total: totalPlans,
      pending: pendingPlans,
      confirmed: confirmedPlans
    },
    allocationStats: {
      totalNeeded,
      totalAllocated,
      totalMissing: totalNeeded - totalAllocated,
      overallSatisfaction: totalNeeded > 0
        ? ((totalAllocated / totalNeeded) * 100).toFixed(1) + '%'
        : '100%'
    },
    leaderRanking: Object.values(leaderStats)
      .sort((a, b) => b.projectCount - a.projectCount)
      .slice(0, 10)
  });
}

module.exports = {
  getSizeGapStats,
  getTurnoverStats,
  getAccessoryLossStats,
  getCleaningWaitStats,
  getDashboardStats,
  getDailyAvailabilityStats,
  getProjectGapStats,
  getRoleSatisfactionStats,
  getCostumeOccupancyStats,
  getProjectDashboardStats
};
