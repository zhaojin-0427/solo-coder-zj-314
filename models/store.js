const costumes = [];
const borrowRecords = [];
const returnRecords = [];
const cleaningSchedule = [];
const performanceProjects = [];
const allocationPlans = [];
const auditLogs = [];
const anomalyRecords = [];
const warehouses = [];
const transferRecords = [];

const borrowLocks = new Set();
const planLocks = new Set();
const transferLocks = new Set();

let costumeIdCounter = 1;
let borrowIdCounter = 1;
let returnIdCounter = 1;
let cleaningIdCounter = 1;
let projectIdCounter = 1;
let planIdCounter = 1;
let roleIdCounter = 1;
let auditIdCounter = 1;
let anomalyIdCounter = 1;
let warehouseIdCounter = 1;
let transferIdCounter = 1;

function acquireBorrowLock(costumeId) {
  if (borrowLocks.has(costumeId)) {
    return false;
  }
  borrowLocks.add(costumeId);
  return true;
}

function releaseBorrowLock(costumeId) {
  borrowLocks.delete(costumeId);
}

function acquirePlanLock(projectId) {
  if (planLocks.has(projectId)) {
    return false;
  }
  planLocks.add(projectId);
  return true;
}

function releasePlanLock(projectId) {
  planLocks.delete(projectId);
}

function acquireTransferLock(costumeId) {
  if (transferLocks.has(costumeId)) {
    return false;
  }
  transferLocks.add(costumeId);
  return true;
}

function releaseTransferLock(costumeId) {
  transferLocks.delete(costumeId);
}

module.exports = {
  costumes,
  borrowRecords,
  returnRecords,
  cleaningSchedule,
  performanceProjects,
  allocationPlans,
  auditLogs,
  anomalyRecords,
  warehouses,
  transferRecords,
  borrowLocks,
  planLocks,
  transferLocks,
  acquireBorrowLock,
  releaseBorrowLock,
  acquirePlanLock,
  releasePlanLock,
  acquireTransferLock,
  releaseTransferLock,
  costumeIdCounter: () => costumeIdCounter++,
  borrowIdCounter: () => borrowIdCounter++,
  returnIdCounter: () => returnIdCounter++,
  cleaningIdCounter: () => cleaningIdCounter++,
  projectIdCounter: () => projectIdCounter++,
  planIdCounter: () => planIdCounter++,
  roleIdCounter: () => roleIdCounter++,
  auditIdCounter: () => auditIdCounter++,
  anomalyIdCounter: () => anomalyIdCounter++,
  warehouseIdCounter: () => warehouseIdCounter++,
  transferIdCounter: () => transferIdCounter++
};
