const {
  costumes,
  borrowRecords,
  cleaningSchedule,
  performanceProjects,
  allocationPlans,
  acquirePlanLock,
  releasePlanLock,
  acquireBorrowLock,
  releaseBorrowLock,
  projectIdCounter,
  planIdCounter,
  roleIdCounter,
  borrowIdCounter
} = require('../models/store');
const {
  generateResponse,
  formatDate,
  parseDate,
  hasDateOverlap,
  isDateInRange,
  daysBetween,
  matchSize,
  calculateSizeScore
} = require('../utils/helpers');

function validateProjectData(ctx, data, isUpdate = false) {
  if (!isUpdate) {
    if (!data.name) return '项目名称不能为空';
    if (!data.leaderName) return '领队名称不能为空';
    if (!Array.isArray(data.roles) || data.roles.length === 0) return '至少需要配置一个角色';
  }
  if (data.roles) {
    for (const role of data.roles) {
      if (!role.roleName) return '角色名称不能为空';
      if (!role.quantity || role.quantity < 1) return '角色服装数量必须大于0';
      if (!Array.isArray(role.sizeConstraints) || role.sizeConstraints.length === 0) return '至少需要配置一个尺码约束';
      if (!role.performanceType) return '演出类型不能为空';
      if (!role.startDate || !role.endDate) return '角色演出日期范围不能为空';
      const s = parseDate(role.startDate);
      const e = parseDate(role.endDate);
      if (isNaN(s.getTime()) || isNaN(e.getTime())) return '角色日期格式无效';
      if (s > e) return '角色开始日期不能晚于结束日期';
      if (!role.priority || ![1, 2, 3].includes(role.priority)) return '优先级必须为1(高)、2(中)、3(低)';
      if (!Array.isArray(role.requiredAccessories)) return '必备配件必须为数组';
    }
  }
  return null;
}

function isRangeFullyCovered(start, end, slots) {
  const s = parseDate(start);
  const e = parseDate(end);
  const totalDays = daysBetween(s, e) + 1;
  const covered = new Set();

  for (const slot of slots) {
    const slotS = parseDate(slot.startDate);
    const slotE = parseDate(slot.endDate);
    const slotDays = daysBetween(slotS, slotE) + 1;
    for (let i = 0; i < slotDays; i++) {
      const d = new Date(slotS);
      d.setDate(slotS.getDate() + i);
      const dStr = formatDate(d);
      if (isDateInRange(dStr, start, end)) {
        covered.add(dStr);
      }
    }
  }

  return covered.size === totalDays;
}

function checkCostumeEligibility(costume, startDate, endDate, excludePlanId = null) {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const issues = [];

  if (costume.status === 'maintenance') {
    issues.push({ code: 'maintenance', message: '服装处于维修中' });
  }
  if (costume.status === 'cleaning') {
    issues.push({ code: 'cleaning', message: '服装正在清洗中' });
  }
  if (costume.cleaningStatus === 'dirty') {
    issues.push({ code: 'dirty', message: '服装待清洗(dirty)' });
  }

  const fullyCovered = isRangeFullyCovered(start, end, costume.availableSlots);
  if (!fullyCovered) {
    issues.push({ code: 'partial_slot', message: '服装可借用时段无法覆盖完整连续档期' });
  }

  const overlappingBorrows = borrowRecords.filter(b => {
    if (b.costumeId !== costume.id) return false;
    if (b.status !== 'borrowed') return false;
    return hasDateOverlap(start, end, b.startDate, b.endDate);
  });
  if (overlappingBorrows.length > 0) {
    issues.push({ code: 'overlapping_borrow', message: `该档期内有${overlappingBorrows.length}条借用记录重叠`, details: overlappingBorrows });
  }

  const overlappingCleanings = cleaningSchedule.filter(t => {
    if (t.costumeId !== costume.id) return false;
    if (t.status === 'completed') return false;
    const s = parseDate(t.scheduledDate);
    return isDateInRange(formatDate(s), start, end);
  });
  if (overlappingCleanings.length > 0) {
    issues.push({ code: 'overlapping_cleaning', message: `该档期内有${overlappingCleanings.length}条清洗排期`, details: overlappingCleanings });
  }

  const overlappingPlans = allocationPlans.filter(p => {
    if (p.status !== 'pending') return false;
    if (excludePlanId && p.planId === excludePlanId) return false;
    return p.allocations.some(alloc => {
      if (alloc.costumeId !== costume.id) return false;
      return hasDateOverlap(start, end, alloc.startDate, alloc.endDate);
    });
  });
  if (overlappingPlans.length > 0) {
    issues.push({ code: 'overlapping_plan', message: `该档期内有${overlappingPlans.length}个待确认方案占用`, details: overlappingPlans.map(p => p.planId) });
  }

  return {
    eligible: issues.length === 0,
    issues
  };
}

function checkAccessories(costume, requiredAccessories) {
  const missing = [];
  for (const acc of requiredAccessories) {
    if (!costume.accessories.includes(acc)) {
      missing.push(acc);
    }
  }
  return {
    complete: missing.length === 0,
    missing
  };
}

function scoreCostumeForRole(costume, role) {
  let score = 0;

  if (costume.performanceType === role.performanceType) {
    score += 50;
  } else {
    score += 10;
  }

  const sizes = costume.sizeRange.split(',').map(s => s.trim());
  const matchedSizes = sizes.filter(s => role.sizeConstraints.includes(s));
  score += matchedSizes.length * 15;

  const accCheck = checkAccessories(costume, role.requiredAccessories);
  if (accCheck.complete) {
    score += 30;
  } else {
    score -= accCheck.missing.length * 5;
  }

  return score;
}

function buildDateRange(startDate, endDate) {
  const dates = [];
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const total = daysBetween(start, end) + 1;
  for (let i = 0; i < total; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(formatDate(d));
  }
  return dates;
}

function generateAllocationPlan(project) {
  const result = {
    projectId: project.id,
    planId: planIdCounter(),
    status: 'generated',
    generatedAt: new Date().toISOString(),
    allocations: [],
    gaps: [],
    alternates: [],
    roleSatisfaction: {},
    suggestion: null
  };

  const sortedRoles = [...project.roles].sort((a, b) => a.priority - b.priority);
  const costumeDateMap = {};

  function isCostumeAvailableInPlan(costumeId, startDate, endDate) {
    const dates = buildDateRange(startDate, endDate);
    const occupied = costumeDateMap[costumeId];
    if (!occupied) return true;
    for (const d of dates) {
      if (occupied.has(d)) return false;
    }
    return true;
  }

  for (const role of sortedRoles) {
    const roleStart = formatDate(role.startDate);
    const roleEnd = formatDate(role.endDate);
    const roleDates = buildDateRange(roleStart, roleEnd);
    const needed = role.quantity;
    const roleAllocations = [];
    const roleGaps = [];
    const roleAlternates = [];

    const candidates = costumes.filter(c => {
      if (c.performanceType !== role.performanceType) return false;
      return true;
    });

    const scored = candidates.map(c => {
      const eligibility = checkCostumeEligibility(c, roleStart, roleEnd, null);
      const accCheck = checkAccessories(c, role.requiredAccessories);
      const sizes = c.sizeRange.split(',').map(s => s.trim());
      const hasMatchingSize = sizes.some(s => role.sizeConstraints.includes(s));
      return {
        costume: c,
        eligibility,
        accCheck,
        hasMatchingSize,
        score: scoreCostumeForRole(c, role)
      };
    });

    const fullyEligible = scored.filter(s =>
      s.eligibility.eligible &&
      s.accCheck.complete &&
      s.hasMatchingSize &&
      isCostumeAvailableInPlan(s.costume.id, roleStart, roleEnd)
    ).sort((a, b) => b.score - a.score);

    const partiallyEligible = scored.filter(s =>
      !(s.eligibility.eligible && s.accCheck.complete && s.hasMatchingSize && isCostumeAvailableInPlan(s.costume.id, roleStart, roleEnd))
    ).sort((a, b) => b.score - a.score);

    for (let i = 0; i < needed && i < fullyEligible.length; i++) {
      const item = fullyEligible[i];
      roleAllocations.push({
        allocationId: `${result.planId}-${role.roleId}-${i + 1}`,
        roleId: role.roleId,
        roleName: role.roleName,
        costumeId: item.costume.id,
        costumeNumber: item.costume.costumeNumber,
        performanceType: item.costume.performanceType,
        sizeRange: item.costume.sizeRange,
        accessories: item.costume.accessories,
        startDate: roleStart,
        endDate: roleEnd,
        dates: roleDates,
        score: item.score
      });
      for (const d of roleDates) {
        if (!costumeDateMap[item.costume.id]) costumeDateMap[item.costume.id] = new Set();
        costumeDateMap[item.costume.id].add(d);
      }
    }

    const allocatedCount = roleAllocations.length;
    if (allocatedCount < needed) {
      const gapCount = needed - allocatedCount;

      for (const item of partiallyEligible) {
        const altReasons = [];
        if (!item.eligibility.eligible) {
          altReasons.push(...item.eligibility.issues.map(i => i.message));
        }
        if (!item.accCheck.complete) {
          altReasons.push(`缺失配件: ${item.accCheck.missing.join(', ')}`);
        }
        if (!item.hasMatchingSize) {
          altReasons.push('无匹配尺码');
        }
        roleAlternates.push({
          costumeId: item.costume.id,
          costumeNumber: item.costume.costumeNumber,
          performanceType: item.costume.performanceType,
          sizeRange: item.costume.sizeRange,
          reasons: altReasons,
          score: item.score
        });
      }

      roleGaps.push({
        roleId: role.roleId,
        roleName: role.roleName,
        needed: needed,
        allocated: allocatedCount,
        missing: gapCount,
        priority: role.priority,
        sizeConstraints: role.sizeConstraints,
        performanceType: role.performanceType,
        requiredAccessories: role.requiredAccessories,
        startDate: roleStart,
        endDate: roleEnd,
        reasons: [
          `完全满足条件的服装不足（仅${allocatedCount}/${needed}）`,
          ...roleAlternates.slice(0, 3).map(a => `${a.costumeNumber}: ${a.reasons.join('; ')}`)
        ]
      });
    }

    result.allocations.push(...roleAllocations);
    result.gaps.push(...roleGaps);
    result.alternates.push({
      roleId: role.roleId,
      roleName: role.roleName,
      alternates: roleAlternates.slice(0, 10)
    });

    result.roleSatisfaction[role.roleId] = {
      roleName: role.roleName,
      needed: needed,
      allocated: allocatedCount,
      satisfactionRate: needed > 0 ? ((allocatedCount / needed) * 100).toFixed(1) + '%' : '0%',
      priority: role.priority
    };
  }

  const totalNeeded = project.roles.reduce((s, r) => s + r.quantity, 0);
  const totalAllocated = result.allocations.length;
  const totalMissing = totalNeeded - totalAllocated;

  const affectedRoles = result.gaps.map(g => g.roleName);

  const suggestions = [];
  if (totalMissing > 0) {
    suggestions.push(`共缺口${totalMissing}套服装`);
    for (const gap of result.gaps) {
      suggestions.push(`${gap.roleName}: 缺${gap.missing}套，建议${gap.sizeConstraints.join('/')}码${gap.performanceType}服装${gap.requiredAccessories.length > 0 ? '（含' + gap.requiredAccessories.join('、') + '）' : ''}`);
    }
    suggestions.push('可考虑调整演出日期、放宽尺码/配件约束，或紧急采购/外租');
  } else {
    suggestions.push('所有角色服装需求已满足，可确认方案');
  }
  result.suggestion = suggestions;

  result.summary = {
    totalNeeded,
    totalAllocated,
    totalMissing,
    missingRate: totalNeeded > 0 ? ((totalMissing / totalNeeded) * 100).toFixed(1) + '%' : '0%',
    affectedRoles: affectedRoles.length > 0 ? affectedRoles : null,
    overallSatisfaction: totalNeeded > 0 ? ((totalAllocated / totalNeeded) * 100).toFixed(1) + '%' : '100%'
  };

  return result;
}

function createProject(ctx) {
  const { name, description, leaderName, roles } = ctx.request.body;

  const err = validateProjectData(ctx, ctx.request.body, false);
  if (err) {
    ctx.body = generateResponse(400, err, null);
    return;
  }

  const processedRoles = roles.map(r => ({
    roleId: roleIdCounter(),
    roleName: r.roleName,
    quantity: parseInt(r.quantity),
    sizeConstraints: r.sizeConstraints,
    performanceType: r.performanceType,
    requiredAccessories: r.requiredAccessories || [],
    priority: parseInt(r.priority),
    startDate: formatDate(r.startDate),
    endDate: formatDate(r.endDate)
  }));

  const project = {
    id: projectIdCounter(),
    name,
    description: description || '',
    leaderName,
    roles: processedRoles,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  performanceProjects.push(project);

  ctx.body = generateResponse(200, '演出项目创建成功', project);
}

function getProjectList(ctx) {
  const { page = 1, pageSize = 10, status, leaderName } = ctx.query;
  let filtered = [...performanceProjects];

  if (status) {
    filtered = filtered.filter(p => p.status === status);
  }
  if (leaderName) {
    filtered = filtered.filter(p => p.leaderName.includes(leaderName));
  }

  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const list = filtered.slice(start, start + parseInt(pageSize));

  const enriched = list.map(p => {
    const latestPlan = allocationPlans
      .filter(pl => pl.projectId === p.id)
      .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))[0];
    return {
      ...p,
      latestPlan: latestPlan ? {
        id: latestPlan.planId,
        status: latestPlan.status,
        summary: latestPlan.summary
      } : null
    };
  });

  ctx.body = generateResponse(200, '获取成功', {
    list: enriched,
    total,
    page: parseInt(page),
    pageSize: parseInt(pageSize)
  });
}

function getProjectDetail(ctx) {
  const { id } = ctx.params;
  const project = performanceProjects.find(p => p.id === parseInt(id));
  if (!project) {
    ctx.body = generateResponse(404, '项目不存在', null);
    return;
  }

  const plans = allocationPlans
    .filter(p => p.projectId === project.id)
    .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));

  ctx.body = generateResponse(200, '获取成功', {
    project,
    plans
  });
}

function updateProject(ctx) {
  const { id } = ctx.params;
  const project = performanceProjects.find(p => p.id === parseInt(id));
  if (!project) {
    ctx.body = generateResponse(404, '项目不存在', null);
    return;
  }

  if (project.status === 'confirmed') {
    ctx.body = generateResponse(400, '已确认的项目无法修改', null);
    return;
  }

  const err = validateProjectData(ctx, ctx.request.body, true);
  if (err) {
    ctx.body = generateResponse(400, err, null);
    return;
  }

  const fields = ['name', 'description', 'leaderName'];
  for (const field of fields) {
    if (ctx.request.body[field] !== undefined) {
      project[field] = ctx.request.body[field];
    }
  }

  if (ctx.request.body.roles) {
    project.roles = ctx.request.body.roles.map(r => ({
      roleId: r.roleId || roleIdCounter(),
      roleName: r.roleName,
      quantity: parseInt(r.quantity),
      sizeConstraints: r.sizeConstraints,
      performanceType: r.performanceType,
      requiredAccessories: r.requiredAccessories || [],
      priority: parseInt(r.priority),
      startDate: formatDate(r.startDate),
      endDate: formatDate(r.endDate)
    }));
  }

  project.updatedAt = new Date().toISOString();
  ctx.body = generateResponse(200, '更新成功', project);
}

function deleteProject(ctx) {
  const { id } = ctx.params;
  const idx = performanceProjects.findIndex(p => p.id === parseInt(id));
  if (idx === -1) {
    ctx.body = generateResponse(404, '项目不存在', null);
    return;
  }

  const project = performanceProjects[idx];
  if (project.status === 'confirmed') {
    ctx.body = generateResponse(400, '已确认的项目无法删除，请先取消已确认的借用记录', null);
    return;
  }

  const pendingPlans = allocationPlans.filter(p => p.projectId === project.id && p.status === 'pending');
  for (const plan of pendingPlans) {
    plan.status = 'cancelled';
    plan.cancelledAt = new Date().toISOString();
  }

  performanceProjects.splice(idx, 1);
  ctx.body = generateResponse(200, '删除成功', null);
}

function generatePlan(ctx) {
  const { projectId } = ctx.params;

  if (!acquirePlanLock(parseInt(projectId))) {
    ctx.body = generateResponse(409, '该项目正在生成方案中，请稍后重试', null);
    return;
  }

  try {
    const project = performanceProjects.find(p => p.id === parseInt(projectId));
    if (!project) {
      ctx.body = generateResponse(404, '项目不存在', null);
      return;
    }

    const prevPending = allocationPlans.find(p => p.projectId === project.id && p.status === 'pending');
    if (prevPending) {
      prevPending.status = 'superseded';
      prevPending.supersededAt = new Date().toISOString();
    }

    const plan = generateAllocationPlan(project);
    plan.status = 'pending';

    allocationPlans.push(plan);
    project.status = 'planned';
    project.updatedAt = new Date().toISOString();

    ctx.body = generateResponse(200, '分配方案生成成功', plan);
  } finally {
    releasePlanLock(parseInt(projectId));
  }
}

function confirmPlan(ctx) {
  const { planId } = ctx.params;

  const plan = allocationPlans.find(p => p.planId === parseInt(planId));
  if (!plan) {
    ctx.body = generateResponse(404, '方案不存在', null);
    return;
  }

  if (plan.status !== 'pending') {
    ctx.body = generateResponse(400, `方案状态为${plan.status}，无法确认`, null);
    return;
  }

  const project = performanceProjects.find(p => p.id === plan.projectId);
  if (!project) {
    ctx.body = generateResponse(404, '关联项目不存在', null);
    return;
  }

  if (plan.summary.totalMissing > 0) {
    ctx.body = generateResponse(400, `方案存在${plan.summary.totalMissing}个缺口，无法确认。请调整需求后重新生成方案，或手动处理缺口。`, {
      gaps: plan.gaps,
      suggestion: plan.suggestion
    });
    return;
  }

  const createdRecords = [];
  const failedLocks = [];

  for (const alloc of plan.allocations) {
    if (!acquireBorrowLock(alloc.costumeId)) {
      failedLocks.push(alloc);
      continue;
    }

    try {
      const costume = costumes.find(c => c.id === alloc.costumeId);
      if (!costume) {
        releaseBorrowLock(alloc.costumeId);
        continue;
      }

      const eligibility = checkCostumeEligibility(costume, alloc.startDate, alloc.endDate, plan.planId);
      if (!eligibility.eligible) {
        failedLocks.push({ ...alloc, issues: eligibility.issues });
        releaseBorrowLock(alloc.costumeId);
        continue;
      }

      const record = {
        id: borrowIdCounter(),
        costumeId: alloc.costumeId,
        costumeNumber: alloc.costumeNumber,
        leaderName: project.leaderName,
        actorName: `项目角色-${alloc.roleName}`,
        startDate: alloc.startDate,
        endDate: alloc.endDate,
        roleType: alloc.roleName,
        size: alloc.sizeRange.split(',')[0].trim(),
        status: 'borrowed',
        borrowDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        projectId: project.id,
        projectName: project.name,
        planId: plan.planId,
        allocationId: alloc.allocationId
      };

      borrowRecords.push(record);
      costume.status = 'borrowed';
      createdRecords.push(record);
    } finally {
      releaseBorrowLock(alloc.costumeId);
    }
  }

  if (failedLocks.length > 0) {
    for (const rec of createdRecords) {
      const idx = borrowRecords.findIndex(b => b.id === rec.id);
      if (idx !== -1) borrowRecords.splice(idx, 1);
      const costume = costumes.find(c => c.id === rec.costumeId);
      if (costume) costume.status = 'available';
    }

    ctx.body = generateResponse(409, '确认失败，部分服装在生成方案后被占用', {
      failedAllocations: failedLocks
    });
    return;
  }

  plan.status = 'confirmed';
  plan.confirmedAt = new Date().toISOString();
  plan.createdBorrowRecords = createdRecords.map(r => r.id);
  project.status = 'confirmed';
  project.confirmedAt = new Date().toISOString();
  project.updatedAt = new Date().toISOString();

  ctx.body = generateResponse(200, '方案确认成功，已生成借用记录', {
    plan: {
      planId: plan.planId,
      status: plan.status,
      confirmedAt: plan.confirmedAt
    },
    borrowRecords: createdRecords,
    count: createdRecords.length
  });
}

function releasePlan(ctx) {
  const { planId } = ctx.params;

  const plan = allocationPlans.find(p => p.planId === parseInt(planId));
  if (!plan) {
    ctx.body = generateResponse(404, '方案不存在', null);
    return;
  }

  if (plan.status !== 'pending') {
    ctx.body = generateResponse(400, `方案状态为${plan.status}，无法释放（仅pending状态可释放）`, null);
    return;
  }

  plan.status = 'released';
  plan.releasedAt = new Date().toISOString();

  const project = performanceProjects.find(p => p.id === plan.projectId);
  if (project && project.status === 'planned') {
    const hasOtherPending = allocationPlans.some(p => p.projectId === project.id && p.status === 'pending');
    if (!hasOtherPending) {
      project.status = 'draft';
    }
  }

  ctx.body = generateResponse(200, '方案占用已释放', {
    planId: plan.planId,
    status: plan.status,
    releasedAt: plan.releasedAt
  });
}

function getLeaderProjects(ctx) {
  const { leaderName } = ctx.params;

  const projects = performanceProjects.filter(p => p.leaderName === leaderName);
  const enriched = projects.map(p => {
    const plans = allocationPlans
      .filter(pl => pl.projectId === p.id)
      .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      leaderName: p.leaderName,
      roles: p.roles,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      latestPlan: plans.length > 0 ? {
        planId: plans[0].planId,
        status: plans[0].status,
        summary: plans[0].summary,
        allocations: plans[0].allocations.map(a => ({
          roleName: a.roleName,
          costumeNumber: a.costumeNumber,
          startDate: a.startDate,
          endDate: a.endDate
        })),
        gaps: plans[0].gaps,
        suggestion: plans[0].suggestion
      } : null
    };
  });

  ctx.body = generateResponse(200, '获取成功', {
    leaderName,
    total: enriched.length,
    projects: enriched
  });
}

module.exports = {
  createProject,
  getProjectList,
  getProjectDetail,
  updateProject,
  deleteProject,
  generatePlan,
  confirmPlan,
  releasePlan,
  getLeaderProjects
};
