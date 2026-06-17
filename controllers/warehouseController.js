const { warehouses, costumes, warehouseIdCounter, transferRecords } = require('../models/store');
const { generateResponse } = require('../utils/helpers');

function createWarehouse(ctx) {
  const { name, address, region, contactPerson, contactPhone, capacity, description } = ctx.request.body;

  if (!name || !region) {
    ctx.body = generateResponse(400, '参数不完整：仓库名称和区域为必填', null);
    return;
  }

  const exists = warehouses.find(w => w.name === name);
  if (exists) {
    ctx.body = generateResponse(400, '仓库名称已存在', null);
    return;
  }

  const warehouse = {
    id: warehouseIdCounter(),
    name,
    address: address || '',
    region,
    contactPerson: contactPerson || '',
    contactPhone: contactPhone || '',
    capacity: capacity || null,
    description: description || '',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  warehouses.push(warehouse);
  ctx.body = generateResponse(200, '仓库建档成功', warehouse);
}

function getWarehouseList(ctx) {
  const { page = 1, pageSize = 10, region, status } = ctx.query;
  let filtered = [...warehouses];

  if (region) {
    filtered = filtered.filter(w => w.region === region);
  }
  if (status) {
    filtered = filtered.filter(w => w.status === status);
  }

  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const list = filtered.slice(start, start + parseInt(pageSize));

  const enriched = list.map(w => {
    const costumeCount = costumes.filter(c => c.warehouseId === w.id).length;
    const transferringIn = transferRecords.filter(t => t.targetWarehouseId === w.id && t.status === 'transferring').length;
    return {
      ...w,
      costumeCount,
      transferringInCount: transferringIn
    };
  });

  ctx.body = generateResponse(200, '获取成功', {
    list: enriched,
    total,
    page: parseInt(page),
    pageSize: parseInt(pageSize)
  });
}

function getWarehouseDetail(ctx) {
  const { id } = ctx.params;
  const warehouse = warehouses.find(w => w.id === parseInt(id));
  if (!warehouse) {
    ctx.body = generateResponse(404, '仓库不存在', null);
    return;
  }

  const warehouseCostumes = costumes.filter(c => c.warehouseId === warehouse.id);
  const transferringIn = transferRecords.filter(t => t.targetWarehouseId === warehouse.id && t.status === 'transferring');
  const transferringOut = transferRecords.filter(t => t.sourceWarehouseId === warehouse.id && t.status === 'transferring');

  ctx.body = generateResponse(200, '获取成功', {
    warehouse,
    costumeCount: warehouseCostumes.length,
    costumes: warehouseCostumes.map(c => ({
      id: c.id,
      costumeNumber: c.costumeNumber,
      performanceType: c.performanceType,
      sizeRange: c.sizeRange,
      status: c.status,
      location: c.location || null
    })),
    transferringIn: transferringIn.length,
    transferringOut: transferringOut.length
  });
}

function updateWarehouse(ctx) {
  const { id } = ctx.params;
  const warehouse = warehouses.find(w => w.id === parseInt(id));
  if (!warehouse) {
    ctx.body = generateResponse(404, '仓库不存在', null);
    return;
  }

  const fields = ['name', 'address', 'region', 'contactPerson', 'contactPhone', 'capacity', 'description', 'status'];
  for (const field of fields) {
    if (ctx.request.body[field] !== undefined) {
      warehouse[field] = ctx.request.body[field];
    }
  }

  warehouse.updatedAt = new Date().toISOString();
  ctx.body = generateResponse(200, '更新成功', warehouse);
}

function bindCostumeWarehouse(ctx) {
  const { costumeId, warehouseId, location } = ctx.request.body;

  if (!costumeId || !warehouseId) {
    ctx.body = generateResponse(400, '参数不完整：服装ID和仓库ID为必填', null);
    return;
  }

  const costume = costumes.find(c => c.id === costumeId);
  if (!costume) {
    ctx.body = generateResponse(404, '服装不存在', null);
    return;
  }

  const warehouse = warehouses.find(w => w.id === warehouseId);
  if (!warehouse) {
    ctx.body = generateResponse(404, '仓库不存在', null);
    return;
  }

  if (warehouse.status !== 'active') {
    ctx.body = generateResponse(400, '目标仓库未启用，无法绑定', null);
    return;
  }

  costume.warehouseId = warehouseId;
  costume.warehouseName = warehouse.name;
  costume.warehouseRegion = warehouse.region;
  if (location !== undefined) {
    costume.location = location;
  }
  costume.warehouseUpdatedAt = new Date().toISOString();

  ctx.body = generateResponse(200, '服装绑定仓库成功', {
    costumeId: costume.id,
    costumeNumber: costume.costumeNumber,
    warehouseId: warehouse.id,
    warehouseName: warehouse.name,
    warehouseRegion: warehouse.region,
    location: costume.location || null
  });
}

module.exports = {
  createWarehouse,
  getWarehouseList,
  getWarehouseDetail,
  updateWarehouse,
  bindCostumeWarehouse
};
