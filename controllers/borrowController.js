const { costumes, borrowRecords, borrowIdCounter, acquireBorrowLock, releaseBorrowLock, cleaningSchedule } = require('../models/store');
const { generateResponse, matchSize, calculateSizeScore, hasDateOverlap, formatDate, parseDate, daysBetween, isDateInRange } = require('../utils/helpers');

function isCostumeAvailableForRange(costume, startDate, endDate) {
  const start = formatDate(startDate);
  const end = formatDate(endDate);

  if (costume.status === 'maintenance') {
    return { available: false, reason: '服装处于维修中', reasonCode: 'maintenance' };
  }
  if (costume.status === 'cleaning') {
    return { available: false, reason: '服装正在清洗中', reasonCode: 'cleaning' };
  }
  if (costume.cleaningStatus === 'dirty') {
    return { available: false, reason: '服装待清洗', reasonCode: 'dirty' };
  }

  const hasSlot = costume.availableSlots.some(slot => {
    return hasDateOverlap(start, end, slot.startDate, slot.endDate);
  });
  if (!hasSlot) {
    return { available: false, reason: '该档期不在可借用时段内', reasonCode: 'no_slot' };
  }

  const overlappingBorrows = borrowRecords.filter(borrow => {
    if (borrow.costumeId !== costume.id) return false;
    if (borrow.status !== 'borrowed') return false;
    return hasDateOverlap(start, end, borrow.startDate, borrow.endDate);
  });
  if (overlappingBorrows.length > 0) {
    return {
      available: false,
      reason: `该档期内有${overlappingBorrows.length}条借用记录重叠`,
      reasonCode: 'overlapping_borrow',
      overlappingBorrows
    };
  }

  const overlappingCleanings = cleaningSchedule.filter(task => {
    if (task.costumeId !== costume.id) return false;
    if (task.status === 'completed') return false;
    return isDateInRange(task.scheduledDate, start, end);
  });
  if (overlappingCleanings.length > 0) {
    return {
      available: false,
      reason: `该档期内有${overlappingCleanings.length}条清洗排期`,
      reasonCode: 'overlapping_cleaning',
      overlappingCleanings
    };
  }

  return { available: true, reason: '档期可用', reasonCode: 'available' };
}

function getAvailabilityDetails(costume, startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const totalDays = daysBetween(start, end) + 1;
  const details = [];

  let availableDays = 0;
  let borrowedDays = 0;
  let cleaningDays = 0;

  for (let i = 0; i < totalDays; i++) {
    const currentDate = new Date(start);
    currentDate.setDate(start.getDate() + i);
    const dateStr = formatDate(currentDate);

    const isBorrowed = borrowRecords.some(borrow => {
      if (borrow.costumeId !== costume.id) return false;
      if (borrow.status !== 'borrowed') return false;
      return isDateInRange(dateStr, borrow.startDate, borrow.endDate);
    });

    const isCleaning = cleaningSchedule.some(task => {
      if (task.costumeId !== costume.id) return false;
      if (task.status === 'completed') return false;
      return task.scheduledDate === dateStr;
    });

    const hasSlot = costume.availableSlots.some(slot => {
      return isDateInRange(dateStr, slot.startDate, slot.endDate);
    });

    let dayStatus = 'available';
    if (costume.status === 'maintenance') {
      dayStatus = 'maintenance';
    } else if (costume.status === 'cleaning' || isCleaning) {
      dayStatus = 'cleaning';
    } else if (costume.cleaningStatus === 'dirty') {
      dayStatus = 'dirty';
    } else if (isBorrowed) {
      dayStatus = 'borrowed';
    } else if (!hasSlot) {
      dayStatus = 'unavailable';
    }

    if (dayStatus === 'available') availableDays++;
    if (dayStatus === 'borrowed') borrowedDays++;
    if (dayStatus === 'cleaning') cleaningDays++;

    details.push({
      date: dateStr,
      status: dayStatus
    });
  }

  return {
    totalDays,
    availableDays,
    borrowedDays,
    cleaningDays,
    dailyDetails: details
  };
}

function estimateAvailability(ctx) {
  const { height, weight, roleType, startDate, endDate, performanceType } = ctx.request.body;

  if (!height || !weight || !roleType || !startDate || !endDate) {
    ctx.body = generateResponse(400, '参数不完整', null);
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

    let styleScore = 0;
    if (costume.performanceType === roleType) {
      styleScore = 100;
    } else {
      styleScore = 50;
    }

    const totalScore = bestScore * 60 + (styleScore / 100) * 40;
    const availability = isCostumeAvailableForRange(costume, start, end);
    const availabilityDetails = getAvailabilityDetails(costume, start, end);

    matched.push({
      costume: {
        id: costume.id,
        costumeNumber: costume.costumeNumber,
        performanceType: costume.performanceType,
        sizeRange: costume.sizeRange,
        accessories: costume.accessories,
        status: costume.status,
        cleaningStatus: costume.cleaningStatus
      },
      matchedSize: bestSize,
      sizeScore: (bestScore * 100).toFixed(1),
      styleScore,
      totalScore: totalScore.toFixed(1),
      availability: {
        isAvailable: availability.available,
        reason: availability.reason,
        reasonCode: availability.reasonCode,
        ...availabilityDetails
      }
    });
  }

  matched.sort((a, b) => parseFloat(b.totalScore) - parseFloat(a.totalScore));

  const availableCount = matched.filter(m => m.availability.isAvailable).length;
  const unavailableCount = matched.length - availableCount;

  ctx.body = generateResponse(200, '预估成功', {
    query: {
      height,
      weight,
      roleType,
      startDate: formatDate(start),
      endDate: formatDate(end),
      performanceType: performanceType || null
    },
    summary: {
      totalMatched: matched.length,
      availableCount,
      unavailableCount,
      dateRangeDays: daysBetween(start, end) + 1
    },
    results: matched
  });
}

function matchCostumes(ctx) {
  const { height, weight, roleType, performanceDate, performanceType } = ctx.request.body;

  if (!height || !weight || !roleType || !performanceDate) {
    ctx.body = generateResponse(400, '参数不完整', null);
    return;
  }

  const targetDate = formatDate(performanceDate);
  const matched = [];

  for (const costume of costumes) {
    if (costume.status !== 'available') continue;

    if (performanceType && costume.performanceType !== performanceType) continue;

    if (costume.cleaningStatus === 'dirty') continue;

    const sizeMatches = matchSize(height, weight, costume.sizeRange);
    if (sizeMatches.length === 0) continue;

    const isSlotAvailable = costume.availableSlots.some(slot => {
      return hasDateOverlap(targetDate, targetDate, slot.startDate, slot.endDate);
    });
    if (!isSlotAvailable) continue;

    const isBorrowed = borrowRecords.some(borrow => {
      if (borrow.costumeId !== costume.id) return false;
      if (borrow.status !== 'borrowed') return false;
      return hasDateOverlap(targetDate, targetDate, borrow.startDate, borrow.endDate);
    });
    if (isBorrowed) continue;

    let bestSize = sizeMatches[0];
    let bestScore = 0;
    for (const size of sizeMatches) {
      const score = calculateSizeScore(height, weight, size);
      if (score > bestScore) {
        bestScore = score;
        bestSize = size;
      }
    }

    let styleScore = 0;
    if (costume.performanceType === roleType) {
      styleScore = 100;
    } else {
      styleScore = 50;
    }

    const totalScore = bestScore * 60 + (styleScore / 100) * 40;

    matched.push({
      costume,
      matchedSize: bestSize,
      sizeScore: (bestScore * 100).toFixed(1),
      styleScore,
      totalScore: totalScore.toFixed(1)
    });
  }

  matched.sort((a, b) => parseFloat(b.totalScore) - parseFloat(a.totalScore));

  ctx.body = generateResponse(200, '匹配成功', {
    count: matched.length,
    results: matched
  });
}

function lockBorrow(ctx) {
  const { costumeId, leaderName, actorName, startDate, endDate, roleType, size } = ctx.request.body;

  if (!costumeId || !leaderName || !actorName || !startDate || !endDate || !roleType || !size) {
    ctx.body = generateResponse(400, '参数不完整', null);
    return;
  }

  if (!acquireBorrowLock(costumeId)) {
    ctx.body = generateResponse(409, '该服装正在处理中，请稍后重试', null);
    return;
  }

  try {
    const costume = costumes.find(c => c.id === costumeId);
    if (!costume) {
      ctx.body = generateResponse(404, '服装不存在', null);
      return;
    }

    if (costume.status !== 'available') {
      ctx.body = generateResponse(400, `服装当前状态为${costume.status}，无法借用`, null);
      return;
    }

    if (costume.cleaningStatus === 'dirty') {
      ctx.body = generateResponse(400, '服装待清洗，无法借用', null);
      return;
    }

    const start = formatDate(startDate);
    const end = formatDate(endDate);

    const isSlotAvailable = costume.availableSlots.some(slot => {
      return hasDateOverlap(start, end, slot.startDate, slot.endDate);
    });
    if (!isSlotAvailable) {
      ctx.body = generateResponse(400, '该档期不可借用', null);
      return;
    }

    const isBorrowed = borrowRecords.some(borrow => {
      if (borrow.costumeId !== costumeId) return false;
      if (borrow.status !== 'borrowed') return false;
      return hasDateOverlap(start, end, borrow.startDate, borrow.endDate);
    });
    if (isBorrowed) {
      ctx.body = generateResponse(400, '该档期已被借用', null);
      return;
    }

    const borrowRecord = {
      id: borrowIdCounter(),
      costumeId,
      costumeNumber: costume.costumeNumber,
      leaderName,
      actorName,
      startDate: start,
      endDate: end,
      roleType,
      size,
      status: 'borrowed',
      borrowDate: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    borrowRecords.push(borrowRecord);
    costume.status = 'borrowed';

    ctx.body = generateResponse(200, '借用锁定成功', borrowRecord);
  } finally {
    releaseBorrowLock(costumeId);
  }
}

function getBorrowList(ctx) {
  const { page = 1, pageSize = 10, status, leaderName } = ctx.query;
  let filtered = [...borrowRecords];

  if (status) {
    filtered = filtered.filter(b => b.status === status);
  }
  if (leaderName) {
    filtered = filtered.filter(b => b.leaderName.includes(leaderName));
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

module.exports = {
  matchCostumes,
  lockBorrow,
  getBorrowList,
  estimateAvailability
};
