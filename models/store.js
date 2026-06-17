const costumes = [];
const borrowRecords = [];
const returnRecords = [];
const cleaningSchedule = [];

let costumeIdCounter = 1;
let borrowIdCounter = 1;
let returnIdCounter = 1;
let cleaningIdCounter = 1;

module.exports = {
  costumes,
  borrowRecords,
  returnRecords,
  cleaningSchedule,
  costumeIdCounter: () => costumeIdCounter++,
  borrowIdCounter: () => borrowIdCounter++,
  returnIdCounter: () => returnIdCounter++,
  cleaningIdCounter: () => cleaningIdCounter++
};
