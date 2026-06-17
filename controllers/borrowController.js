const { costumes, borrowRecords, borrowIdCounter } = require('../models/store');
const { generateResponse, matchSize, calculateSizeScore, hasDateOverlap, formatDate, parseDate } = require('../utils/helpers');

function matchCostumes(ctx) {
  const { height, weight, roleType, performanceDate, performanceType } = ctx.request.body;

  if (!height || !weight || !roleType || !performanceDate) {
    ctx.body = generateResponse(400, '参数不完整', null);
    return;
  }

  const targetDate = formatDate(performanceDate);
  const matched = [];

  for (const costume of costumes) {
    if (costume.status !== 'available' && costume.status !== 'cleaning') continue;

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

  const costume = costumes.find(c => c.id === costumeId);
  if (!costume) {
    ctx.body = generateResponse(404, '服装不存在', null);
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
  getBorrowList
};
