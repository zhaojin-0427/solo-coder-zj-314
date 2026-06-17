const costumes = [];
const borrowRecords = [];
const returnRecords = [];
const cleaningSchedule = [];
const performanceProjects = [];
const allocationPlans = [];

const borrowLocks = new Set();
const planLocks = new Set();

let costumeIdCounter = 1;
let borrowIdCounter = 1;
let returnIdCounter = 1;
let cleaningIdCounter = 1;
let projectIdCounter = 1;
let planIdCounter = 1;
let roleIdCounter = 1;

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

module.exports = {
  costumes,
  borrowRecords,
  returnRecords,
  cleaningSchedule,
  performanceProjects,
  allocationPlans,
  borrowLocks,
  planLocks,
  acquireBorrowLock,
  releaseBorrowLock,
  acquirePlanLock,
  releasePlanLock,
  costumeIdCounter: () => costumeIdCounter++,
  borrowIdCounter: () => borrowIdCounter++,
  returnIdCounter: () => returnIdCounter++,
  cleaningIdCounter: () => cleaningIdCounter++,
  projectIdCounter: () => projectIdCounter++,
  planIdCounter: () => planIdCounter++,
  roleIdCounter: () => roleIdCounter++
};
