// phone -> userId (first registrant with this number)
const phoneToUser = new Map();
// userId -> phone
const userToPhone = new Map();
// userId -> rejectedAt timestamp (for cooldown)
const rejectionCooldown = new Map();

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

function storePhone(userId, phone) {
  const normalized = phone.replace(/\D/g, '');
  userToPhone.set(String(userId), normalized);
  if (!phoneToUser.has(normalized)) {
    phoneToUser.set(normalized, String(userId));
  }
}

function getPhone(userId) {
  return userToPhone.get(String(userId)) || null;
}

function hasPhone(userId) {
  return userToPhone.has(String(userId));
}

// Returns the userId that previously registered with this phone, or null
function findDuplicatePhone(userId, phone) {
  const normalized = phone.replace(/\D/g, '');
  const existing = phoneToUser.get(normalized);
  if (existing && existing !== String(userId)) return existing;
  return null;
}

function setRejected(userId) {
  rejectionCooldown.set(String(userId), Date.now());
}

function getRejectionCooldownLeft(userId) {
  const ts = rejectionCooldown.get(String(userId));
  if (!ts) return 0;
  const left = COOLDOWN_MS - (Date.now() - ts);
  return left > 0 ? left : 0;
}

function clearRejection(userId) {
  rejectionCooldown.delete(String(userId));
}

module.exports = { storePhone, getPhone, hasPhone, findDuplicatePhone, setRejected, getRejectionCooldownLeft, clearRejection };
