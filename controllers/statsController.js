const { costumes, borrowRecords, returnRecords, cleaningSchedule } = require('../models/store');
const { generateResponse, daysBetween, parseDate } = require('../utils/helpers');

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

module.exports = {
  getSizeGapStats,
  getTurnoverStats,
  getAccessoryLossStats,
  getCleaningWaitStats,
  getDashboardStats
};
