const { costumes, borrowRecords, returnRecords, returnIdCounter, cleaningSchedule, cleaningIdCounter } = require('../models/store');
const { generateResponse, formatDate, addDays, daysBetween } = require('../utils/helpers');

function returnCostume(ctx) {
  const { borrowId, missingAccessories, stainLevel, cleaningDate } = ctx.request.body;

  if (!borrowId || stainLevel === undefined) {
    ctx.body = generateResponse(400, '参数不完整', null);
    return;
  }

  const borrowRecord = borrowRecords.find(b => b.id === borrowId);
  if (!borrowRecord) {
    ctx.body = generateResponse(404, '借用记录不存在', null);
    return;
  }

  if (borrowRecord.status === 'returned') {
    ctx.body = generateResponse(400, '该借用已归还', null);
    return;
  }

  const costume = costumes.find(c => c.id === borrowRecord.costumeId);
  if (!costume) {
    ctx.body = generateResponse(404, '服装不存在', null);
    return;
  }

  const missing = Array.isArray(missingAccessories) ? missingAccessories : [];
  const hasMissing = missing.length > 0;
  const hasStain = stainLevel > 0;

  const returnRecord = {
    id: returnIdCounter(),
    borrowId,
    costumeId: borrowRecord.costumeId,
    costumeNumber: borrowRecord.costumeNumber,
    missingAccessories: missing,
    stainLevel,
    returnDate: new Date().toISOString(),
    cleaningArranged: false,
    createdAt: new Date().toISOString()
  };

  returnRecords.push(returnRecord);
  borrowRecord.status = 'returned';
  borrowRecord.returnDate = new Date().toISOString();

  costume.cleaningStatus = hasStain ? 'dirty' : 'clean';

  if (hasMissing) {
    costume.status = 'maintenance';
    costume.missingAccessories = missing;
  } else if (hasStain) {
    costume.status = 'cleaning';
  } else {
    costume.status = 'available';
    if (costume.missingAccessories) {
      delete costume.missingAccessories;
    }
  }

  let cleaningTask = null;
  if (hasStain) {
    const scheduledDate = cleaningDate ? formatDate(cleaningDate) : formatDate(addDays(new Date(), 1));
    cleaningTask = {
      id: cleaningIdCounter(),
      costumeId: costume.id,
      costumeNumber: costume.costumeNumber,
      returnRecordId: returnRecord.id,
      stainLevel,
      scheduledDate,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    cleaningSchedule.push(cleaningTask);
    returnRecord.cleaningArranged = true;
  }

  ctx.body = generateResponse(200, '归还核验成功', {
    returnRecord,
    cleaningTask
  });
}

function getReturnList(ctx) {
  const { page = 1, pageSize = 10, costumeNumber } = ctx.query;
  let filtered = [...returnRecords];

  if (costumeNumber) {
    filtered = filtered.filter(r => r.costumeNumber.includes(costumeNumber));
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

function updateCleaningStatus(ctx) {
  const { cleaningId, status } = ctx.request.body;

  if (!cleaningId || !status) {
    ctx.body = generateResponse(400, '参数不完整', null);
    return;
  }

  const task = cleaningSchedule.find(t => t.id === cleaningId);
  if (!task) {
    ctx.body = generateResponse(404, '清洗任务不存在', null);
    return;
  }

  task.status = status;
  task.updatedAt = new Date().toISOString();

  if (status === 'completed') {
    task.completedDate = new Date().toISOString();
    const costume = costumes.find(c => c.id === task.costumeId);
    if (costume) {
      costume.cleaningStatus = 'clean';
      if (costume.status === 'cleaning') {
        if (costume.missingAccessories && costume.missingAccessories.length > 0) {
          costume.status = 'maintenance';
        } else {
          costume.status = 'available';
        }
      }
    }
  }

  ctx.body = generateResponse(200, '更新成功', task);
}

function getCleaningSchedule(ctx) {
  const { page = 1, pageSize = 10, status } = ctx.query;
  let filtered = [...cleaningSchedule];

  if (status) {
    filtered = filtered.filter(t => t.status === status);
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

function addCleaningTask(ctx) {
  const { costumeId, scheduledDate, stainLevel } = ctx.request.body;

  if (!costumeId || !scheduledDate || stainLevel === undefined) {
    ctx.body = generateResponse(400, '参数不完整', null);
    return;
  }

  const costume = costumes.find(c => c.id === costumeId);
  if (!costume) {
    ctx.body = generateResponse(404, '服装不存在', null);
    return;
  }

  const task = {
    id: cleaningIdCounter(),
    costumeId,
    costumeNumber: costume.costumeNumber,
    stainLevel,
    scheduledDate: formatDate(scheduledDate),
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  cleaningSchedule.push(task);
  costume.status = 'cleaning';
  costume.cleaningStatus = 'dirty';

  ctx.body = generateResponse(200, '清洗排期成功', task);
}

function completeMaintenance(ctx) {
  const { costumeId, replenishedAccessories } = ctx.request.body;

  if (!costumeId) {
    ctx.body = generateResponse(400, '参数不完整', null);
    return;
  }

  const costume = costumes.find(c => c.id === costumeId);
  if (!costume) {
    ctx.body = generateResponse(404, '服装不存在', null);
    return;
  }

  if (costume.status !== 'maintenance') {
    ctx.body = generateResponse(400, '服装不在维修状态', null);
    return;
  }

  const replenished = Array.isArray(replenishedAccessories) ? replenishedAccessories : [];

  if (replenished.length > 0) {
    const remaining = (costume.missingAccessories || []).filter(
      acc => !replenished.includes(acc)
    );
    costume.missingAccessories = remaining;

    if (remaining.length === 0 && costume.cleaningStatus === 'clean') {
      costume.status = 'available';
      delete costume.missingAccessories;
    } else if (remaining.length === 0 && costume.cleaningStatus === 'dirty') {
      costume.status = 'cleaning';
    }
  } else {
    if (costume.cleaningStatus === 'clean') {
      costume.status = 'available';
      delete costume.missingAccessories;
    } else {
      costume.status = 'cleaning';
    }
  }

  costume.maintenanceUpdatedAt = new Date().toISOString();

  ctx.body = generateResponse(200, '维修完成', {
    costumeId: costume.id,
    costumeNumber: costume.costumeNumber,
    status: costume.status,
    remainingMissingAccessories: costume.missingAccessories || []
  });
}

module.exports = {
  returnCostume,
  getReturnList,
  updateCleaningStatus,
  getCleaningSchedule,
  addCleaningTask,
  completeMaintenance
};
