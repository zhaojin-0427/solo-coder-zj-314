const { costumes, costumeIdCounter, borrowRecords } = require('../models/store');
const { generateResponse, parseDate, formatDate } = require('../utils/helpers');

function addCostume(ctx) {
  const {
    costumeNumber,
    performanceType,
    sizeRange,
    accessories,
    cleaningStatus,
    availableSlots
  } = ctx.request.body;

  if (!costumeNumber || !performanceType || !sizeRange || !Array.isArray(accessories) || !cleaningStatus || !Array.isArray(availableSlots)) {
    ctx.body = generateResponse(400, '参数不完整', null);
    return;
  }

  const exists = costumes.find(c => c.costumeNumber === costumeNumber);
  if (exists) {
    ctx.body = generateResponse(400, '服装编号已存在', null);
    return;
  }

  const costume = {
    id: costumeIdCounter(),
    costumeNumber,
    performanceType,
    sizeRange,
    accessories,
    cleaningStatus,
    availableSlots: availableSlots.map(slot => ({
      startDate: formatDate(slot.startDate),
      endDate: formatDate(slot.endDate)
    })),
    status: 'available',
    createdAt: new Date().toISOString()
  };

  costumes.push(costume);
  ctx.body = generateResponse(200, '服装建档成功', costume);
}

function getCostumeList(ctx) {
  const { page = 1, pageSize = 10, performanceType, status } = ctx.query;
  let filtered = [...costumes];

  if (performanceType) {
    filtered = filtered.filter(c => c.performanceType === performanceType);
  }
  if (status) {
    filtered = filtered.filter(c => c.status === status);
  }

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

function getCostumeDetail(ctx) {
  const { id } = ctx.params;
  const costume = costumes.find(c => c.id === parseInt(id));
  if (!costume) {
    ctx.body = generateResponse(404, '服装不存在', null);
    return;
  }
  ctx.body = generateResponse(200, '获取成功', costume);
}

function updateCostume(ctx) {
  const { id } = ctx.params;
  const costume = costumes.find(c => c.id === parseInt(id));
  if (!costume) {
    ctx.body = generateResponse(404, '服装不存在', null);
    return;
  }

  const fields = ['performanceType', 'sizeRange', 'accessories', 'cleaningStatus', 'availableSlots'];
  for (const field of fields) {
    if (ctx.request.body[field] !== undefined) {
      if (field === 'availableSlots') {
        costume[field] = ctx.request.body[field].map(slot => ({
          startDate: formatDate(slot.startDate),
          endDate: formatDate(slot.endDate)
        }));
      } else {
        costume[field] = ctx.request.body[field];
      }
    }
  }

  costume.updatedAt = new Date().toISOString();
  ctx.body = generateResponse(200, '更新成功', costume);
}

function deleteCostume(ctx) {
  const { id } = ctx.params;
  const index = costumes.findIndex(c => c.id === parseInt(id));
  if (index === -1) {
    ctx.body = generateResponse(404, '服装不存在', null);
    return;
  }

  const hasBorrowed = borrowRecords.some(b => b.costumeId === parseInt(id) && b.status === 'borrowed');
  if (hasBorrowed) {
    ctx.body = generateResponse(400, '服装正在借用中，无法删除', null);
    return;
  }

  costumes.splice(index, 1);
  ctx.body = generateResponse(200, '删除成功', null);
}

module.exports = {
  addCostume,
  getCostumeList,
  getCostumeDetail,
  updateCostume,
  deleteCostume
};
