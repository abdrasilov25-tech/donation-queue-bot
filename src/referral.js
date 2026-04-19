const refMap = new Map();    // code -> referrerId
const userRefMap = new Map(); // userId -> { code, referredBy, referrals[] }

function getOrCreateRef(userId) {
  const key = String(userId);
  if (!userRefMap.has(key)) {
    const code = `ref_${key}_${Math.random().toString(36).slice(2, 7)}`;
    userRefMap.set(key, { code, referredBy: null, referrals: [] });
    refMap.set(code, key);
  }
  return userRefMap.get(key);
}

function recordReferral(newUserId, code) {
  if (!code || !refMap.has(code)) return null;
  const referrerId = refMap.get(code);
  if (referrerId === String(newUserId)) return null; // no self-referral

  const newRef = getOrCreateRef(newUserId);
  if (newRef.referredBy) return null; // already referred

  newRef.referredBy = referrerId;
  const referrerRef = getOrCreateRef(referrerId);
  if (!referrerRef.referrals.includes(String(newUserId))) {
    referrerRef.referrals.push(String(newUserId));
  }
  return referrerId;
}

function getRefStats(userId) {
  return userRefMap.get(String(userId)) || null;
}

module.exports = { getOrCreateRef, recordReferral, getRefStats };
