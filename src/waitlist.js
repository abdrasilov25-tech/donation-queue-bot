const waitlist = [];

function addToWaitlist(userId, name) {
  if (waitlist.some((u) => u.userId === String(userId))) return false;
  waitlist.push({ userId: String(userId), name, addedAt: new Date().toISOString() });
  return true;
}

function removeFromWaitlist(userId) {
  const idx = waitlist.findIndex((u) => u.userId === String(userId));
  if (idx !== -1) waitlist.splice(idx, 1);
}

function getWaitlistPosition(userId) {
  const pos = waitlist.findIndex((u) => u.userId === String(userId));
  return pos === -1 ? null : pos + 1;
}

function shiftWaitlist() {
  return waitlist.shift() || null;
}

function isOnWaitlist(userId) {
  return waitlist.some((u) => u.userId === String(userId));
}

function getWaitlist() {
  return [...waitlist];
}

module.exports = { addToWaitlist, removeFromWaitlist, getWaitlistPosition, shiftWaitlist, isOnWaitlist, getWaitlist };
