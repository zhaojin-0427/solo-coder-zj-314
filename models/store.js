const costumes = [];
const borrowRecords = [];
const returnRecords = [];
const cleaningSchedule = [];

const borrowLocks = new Set();

let costumeIdCounter = 1;
let borrowIdCounter = 1;
let returnIdCounter = 1;
let cleaningIdCounter = 1;

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

module.exports = {
  costumes,
  borrowRecords,
  returnRecords,
  cleaningSchedule,
  borrowLocks,
  acquireBorrowLock,
  releaseBorrowLock,
  costumeIdCounter: () => costumeIdCounter++,
  borrowIdCounter: () => borrowIdCounter++,
  returnIdCounter: () => returnIdCounter++,
  cleaningIdCounter: () => cleaningIdCounter++
};
