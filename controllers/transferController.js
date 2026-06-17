const {
  costumes,
  borrowRecords,
  cleaningSchedule,
  allocationPlans,
  transferRecords,
  warehouses,
  transferIdCounter,
  acquireTransferLock,
  releaseTransferLock
} = require('../models/store');
const { generateResponse, hasDateOverlap, isDateInRange } = require('../utils/helpers');

function validateCostumeTransferEligibility(costume) {
  const conflicts = [];

  if (costume.status === 'borrowed') {
    conflicts.push({ code: 'borrowed', message: '服装正在借出中，无法调拨' });
  }
  if (costume.status === 'transferring') {
    conflicts.push({ code: 'transferring', message: '服装正在调拨中，无法再次调拨' });
  }
  if (costume.status === 'cleaning') {
    conflicts.push({ code: 'cleaning', message: '服装正在清洗中，无法调拨' });
  }
  if (costume.status === 'maintenance') {
    conflicts.push({ code: 'maintenance', message: '服装正在维修中，无法调拨' });
  }
  if (costume.cleaningStatus === 'dirty') {
    conflicts.push({ code: 'dirty', message: '服装待清洗，无法调拨' });
  }

  const activeBorrows = borrowRecords.filter(b =>
    b.costumeId === costume.id && b.status === 'borrowed'
  );
  if (activeBorrows.length > 0) {
    conflicts.push({ code: 'active_borrow', message: `服装有${activeBorrows.length}条未归还借用记录` });
  }

  const pendingCleanings = cleaningSchedule.filter(t =>
    t.costumeId === costume.id && t.status !== 'completed'
  );
  if (pendingCleanings.length > 0) {
    conflicts.push({ code: 'pending_cleaning', message: `服装有${pendingCleanings.length}条未完成清洗排期` });
  }

  const pendingReturns = borrowRecords.filter(b =>
    b.costumeId === costume.id && b.status === 'borrowed'
  );
  if (pendingReturns.length > 0) {
    conflicts.push({ code: 'pending_return', message: '服装有待归还借用记录' });
  }

  const pendingPlans = allocationPlans.filter(p =>
    p.status === 'pending' &&
    p.allocations.some(a => a.costumeId === costume.id)
  );
  if (pendingPlans.length > 0) {
    conflicts.push({
      code: 'pending_plan',
      message: `服装被${pendingPlans.length}个待确认方案占用`,
      details: pendingPlans.map(p => p.planId)
    });
  }

  return {
    eligible: conflicts.length === 0,
    conflicts
  };
}

function createTransfer(ctx) {
  const {
    costumeId,
    targetWarehouseId,
    targetLocation,
    reason,
    applicant,
    expectedDays
  } = ctx.request.body;

  if (!costumeId || !targetWarehouseId || !reason || !applicant) {
    ctx.body = generateResponse(400, '参数不完整：服装ID、目标仓库ID、调拨原因和申请人为必填', null);
    return;
  }

  const costume = costumes.find(c => c.id === costumeId);
  if (!costume) {
    ctx.body = generateResponse(404, '服装不存在', null);
    return;
  }

  const targetWarehouse = warehouses.find(w => w.id === targetWarehouseId);
  if (!targetWarehouse) {
    ctx.body = generateResponse(404, '目标仓库不存在', null);
    return;
  }

  if (targetWarehouse.status !== 'active') {
    ctx.body = generateResponse(400, '目标仓库未启用，无法调拨', null);
    return;
  }

  if (costume.warehouseId === targetWarehouseId) {
    ctx.body = generateResponse(400, '服装已在目标仓库中，无需调拨', null);
    return;
  }

  if (!acquireTransferLock(costumeId)) {
    ctx.body = generateResponse(409, '该服装正在处理调拨中，请稍后重试', null);
    return;
  }

  try {
    const eligibility = validateCostumeTransferEligibility(costume);
    if (!eligibility.eligible) {
      ctx.body = generateResponse(400, '服装当前状态不允许发起调拨', {
        conflicts: eligibility.conflicts
      });
      return;
    }

    const existingPending = transferRecords.find(t =>
      t.costumeId === costumeId &&
      (t.status === 'pending' || t.status === 'approved' || t.status === 'transferring')
    );
    if (existingPending) {
      ctx.body = generateResponse(400, '该服装已有进行中的调拨申请', {
        existingTransferId: existingPending.id,
        status: existingPending.status
      });
      return;
    }

    const sourceWarehouse = warehouses.find(w => w.id === costume.warehouseId);
    const transfer = {
      id: transferIdCounter(),
      costumeId,
      costumeNumber: costume.costumeNumber,
      sourceWarehouseId: costume.warehouseId || null,
      sourceWarehouseName: costume.warehouseName || (sourceWarehouse ? sourceWarehouse.name : '未知'),
      sourceRegion: costume.warehouseRegion || (sourceWarehouse ? sourceWarehouse.region : '未知'),
      targetWarehouseId,
      targetWarehouseName: targetWarehouse.name,
      targetRegion: targetWarehouse.region,
      targetLocation: targetLocation || null,
      reason,
      applicant,
      expectedDays: expectedDays || 3,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    transferRecords.push(transfer);

    ctx.body = generateResponse(200, '调拨申请创建成功', transfer);
  } finally {
    releaseTransferLock(costumeId);
  }
}

function approveTransfer(ctx) {
  const { id } = ctx.params;
  const { reviewer } = ctx.request.body;

  if (!reviewer) {
    ctx.body = generateResponse(400, '参数不完整：审核人为必填', null);
    return;
  }

  const transfer = transferRecords.find(t => t.id === parseInt(id));
  if (!transfer) {
    ctx.body = generateResponse(404, '调拨记录不存在', null);
    return;
  }

  if (transfer.status !== 'pending') {
    ctx.body = generateResponse(400, `调拨状态为${transfer.status}，无法审核（仅pending状态可审核）`, null);
    return;
  }

  const costume = costumes.find(c => c.id === transfer.costumeId);
  if (!costume) {
    ctx.body = generateResponse(404, '关联服装不存在', null);
    return;
  }

  if (!acquireTransferLock(transfer.costumeId)) {
    ctx.body = generateResponse(409, '该服装正在处理中，请稍后重试', null);
    return;
  }

  try {
    const eligibility = validateCostumeTransferEligibility(costume);
    if (!eligibility.eligible) {
      transfer.status = 'rejected';
      transfer.reviewer = reviewer;
      transfer.rejectionReason = '审核时服装状态已变化，不符合调拨条件';
      transfer.reviewedAt = new Date().toISOString();
      transfer.updatedAt = new Date().toISOString();

      ctx.body = generateResponse(400, '审核时发现服装状态已变化，自动驳回', {
        transfer: {
          id: transfer.id,
          status: transfer.status,
          rejectionReason: transfer.rejectionReason
        },
        conflicts: eligibility.conflicts
      });
      return;
    }

    transfer.status = 'approved';
    transfer.reviewer = reviewer;
    transfer.reviewedAt = new Date().toISOString();
    transfer.updatedAt = new Date().toISOString();

    costume.status = 'approved_transfer';
    costume.transferId = transfer.id;

    ctx.body = generateResponse(200, '调拨审核通过，服装已临时锁定', {
      transfer: {
        id: transfer.id,
        status: transfer.status,
        reviewer: transfer.reviewer,
        reviewedAt: transfer.reviewedAt
      },
      costume: {
        id: costume.id,
        costumeNumber: costume.costumeNumber,
        status: costume.status
      }
    });
  } finally {
    releaseTransferLock(transfer.costumeId);
  }
}

function rejectTransfer(ctx) {
  const { id } = ctx.params;
  const { reviewer, rejectionReason } = ctx.request.body;

  if (!reviewer) {
    ctx.body = generateResponse(400, '参数不完整：审核人为必填', null);
    return;
  }

  const transfer = transferRecords.find(t => t.id === parseInt(id));
  if (!transfer) {
    ctx.body = generateResponse(404, '调拨记录不存在', null);
    return;
  }

  if (transfer.status !== 'pending') {
    ctx.body = generateResponse(400, `调拨状态为${transfer.status}，无法驳回（仅pending状态可驳回）`, null);
    return;
  }

  transfer.status = 'rejected';
  transfer.reviewer = reviewer;
  transfer.rejectionReason = rejectionReason || '审核驳回';
  transfer.reviewedAt = new Date().toISOString();
  transfer.updatedAt = new Date().toISOString();

  ctx.body = generateResponse(200, '调拨申请已驳回', {
    id: transfer.id,
    status: transfer.status,
    reviewer: transfer.reviewer,
    rejectionReason: transfer.rejectionReason,
    reviewedAt: transfer.reviewedAt
  });
}

function outboundTransfer(ctx) {
  const { id } = ctx.params;
  const { operator } = ctx.request.body;

  if (!operator) {
    ctx.body = generateResponse(400, '参数不完整：操作人为必填', null);
    return;
  }

  const transfer = transferRecords.find(t => t.id === parseInt(id));
  if (!transfer) {
    ctx.body = generateResponse(404, '调拨记录不存在', null);
    return;
  }

  if (transfer.status !== 'approved') {
    ctx.body = generateResponse(400, `调拨状态为${transfer.status}，无法出库（仅approved状态可出库）`, null);
    return;
  }

  const costume = costumes.find(c => c.id === transfer.costumeId);
  if (!costume) {
    ctx.body = generateResponse(404, '关联服装不存在', null);
    return;
  }

  if (!acquireTransferLock(transfer.costumeId)) {
    ctx.body = generateResponse(409, '该服装正在处理中，请稍后重试', null);
    return;
  }

  try {
    transfer.status = 'transferring';
    transfer.outboundOperator = operator;
    transfer.outboundAt = new Date().toISOString();
    transfer.updatedAt = new Date().toISOString();

    costume.status = 'transferring';
    costume.transferId = transfer.id;

    ctx.body = generateResponse(200, '调拨出库成功，服装状态已变为transferring', {
      transfer: {
        id: transfer.id,
        status: transfer.status,
        outboundOperator: transfer.outboundOperator,
        outboundAt: transfer.outboundAt
      },
      costume: {
        id: costume.id,
        costumeNumber: costume.costumeNumber,
        status: costume.status
      }
    });
  } finally {
    releaseTransferLock(transfer.costumeId);
  }
}

function confirmInbound(ctx) {
  const { id } = ctx.params;
  const { operator, location } = ctx.request.body;

  if (!operator) {
    ctx.body = generateResponse(400, '参数不完整：操作人为必填', null);
    return;
  }

  const transfer = transferRecords.find(t => t.id === parseInt(id));
  if (!transfer) {
    ctx.body = generateResponse(404, '调拨记录不存在', null);
    return;
  }

  if (transfer.status !== 'transferring') {
    ctx.body = generateResponse(400, `调拨状态为${transfer.status}，无法入库确认（仅transferring状态可确认入库）`, null);
    return;
  }

  const costume = costumes.find(c => c.id === transfer.costumeId);
  if (!costume) {
    ctx.body = generateResponse(404, '关联服装不存在', null);
    return;
  }

  const targetWarehouse = warehouses.find(w => w.id === transfer.targetWarehouseId);
  if (!targetWarehouse) {
    ctx.body = generateResponse(404, '目标仓库不存在', null);
    return;
  }

  if (!acquireTransferLock(transfer.costumeId)) {
    ctx.body = generateResponse(409, '该服装正在处理中，请稍后重试', null);
    return;
  }

  try {
    transfer.status = 'completed';
    transfer.inboundOperator = operator;
    transfer.inboundAt = new Date().toISOString();
    transfer.updatedAt = new Date().toISOString();

    const finalLocation = location || transfer.targetLocation || null;

    costume.warehouseId = transfer.targetWarehouseId;
    costume.warehouseName = transfer.targetWarehouseName;
    costume.warehouseRegion = transfer.targetRegion;
    costume.location = finalLocation;
    costume.warehouseUpdatedAt = new Date().toISOString();
    costume.status = 'available';
    delete costume.transferId;

    ctx.body = generateResponse(200, '调拨入库确认成功，服装仓库和库位已更新', {
      transfer: {
        id: transfer.id,
        status: transfer.status,
        inboundOperator: transfer.inboundOperator,
        inboundAt: transfer.inboundAt
      },
      costume: {
        id: costume.id,
        costumeNumber: costume.costumeNumber,
        status: costume.status,
        warehouseId: costume.warehouseId,
        warehouseName: costume.warehouseName,
        warehouseRegion: costume.warehouseRegion,
        location: costume.location
      }
    });
  } finally {
    releaseTransferLock(transfer.costumeId);
  }
}

function getTransferList(ctx) {
  const {
    page = 1,
    pageSize = 10,
    status,
    sourceWarehouseId,
    targetWarehouseId,
    costumeNumber,
    applicant
  } = ctx.query;

  let filtered = [...transferRecords];

  if (status) {
    filtered = filtered.filter(t => t.status === status);
  }
  if (sourceWarehouseId) {
    filtered = filtered.filter(t => t.sourceWarehouseId === parseInt(sourceWarehouseId));
  }
  if (targetWarehouseId) {
    filtered = filtered.filter(t => t.targetWarehouseId === parseInt(targetWarehouseId));
  }
  if (costumeNumber) {
    filtered = filtered.filter(t => t.costumeNumber && t.costumeNumber.includes(costumeNumber));
  }
  if (applicant) {
    filtered = filtered.filter(t => t.applicant && t.applicant.includes(applicant));
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
  createTransfer,
  approveTransfer,
  rejectTransfer,
  outboundTransfer,
  confirmInbound,
  getTransferList
};
