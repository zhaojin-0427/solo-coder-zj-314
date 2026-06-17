const sizeStandards = {
  XS: { minHeight: 150, maxHeight: 160, minWeight: 40, maxWeight: 50 },
  S: { minHeight: 155, maxHeight: 165, minWeight: 45, maxWeight: 55 },
  M: { minHeight: 160, maxHeight: 175, minWeight: 50, maxWeight: 65 },
  L: { minHeight: 170, maxHeight: 185, minWeight: 60, maxWeight: 80 },
  XL: { minHeight: 180, maxHeight: 195, minWeight: 75, maxWeight: 95 },
  XXL: { minHeight: 185, maxHeight: 205, minWeight: 85, maxWeight: 110 }
};

function matchSize(height, weight, sizeRange) {
  const sizes = sizeRange.split(',').map(s => s.trim());
  const matchedSizes = [];

  for (const size of sizes) {
    const std = sizeStandards[size];
    if (!std) continue;
    if (height >= std.minHeight && height <= std.maxHeight &&
        weight >= std.minWeight && weight <= std.maxWeight) {
      matchedSizes.push(size);
    }
  }

  return matchedSizes;
}

function calculateSizeScore(height, weight, size) {
  const std = sizeStandards[size];
  if (!std) return 0;

  const midHeight = (std.minHeight + std.maxHeight) / 2;
  const midWeight = (std.minWeight + std.maxWeight) / 2;

  const heightDiff = Math.abs(height - midHeight) / (std.maxHeight - std.minHeight);
  const weightDiff = Math.abs(weight - midWeight) / (std.maxWeight - std.minWeight);

  return 1 - (heightDiff + weightDiff) / 2;
}

function parseDate(dateStr) {
  if (dateStr instanceof Date) return dateStr;
  return new Date(dateStr);
}

function isDateInRange(date, startDate, endDate) {
  const d = parseDate(date);
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  return d >= start && d <= end;
}

function hasDateOverlap(start1, end1, start2, end2) {
  const s1 = parseDate(start1);
  const e1 = parseDate(end1);
  const s2 = parseDate(start2);
  const e2 = parseDate(end2);
  return s1 <= e2 && s2 <= e1;
}

function addDays(date, days) {
  const d = parseDate(date);
  d.setDate(d.getDate() + days);
  return d;
}

function daysBetween(date1, date2) {
  const d1 = parseDate(date1);
  const d2 = parseDate(date2);
  const diffTime = Math.abs(d2 - d1);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function formatDate(date) {
  const d = parseDate(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function generateResponse(code, message, data = null) {
  return { code, message, data };
}

module.exports = {
  sizeStandards,
  matchSize,
  calculateSizeScore,
  parseDate,
  isDateInRange,
  hasDateOverlap,
  addDays,
  daysBetween,
  formatDate,
  generateResponse
};
