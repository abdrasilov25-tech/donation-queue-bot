// In-memory store for pending submissions — NOT written to sheets until approved
const pendingCache = new Map();

function setPending(userId, data) {
  pendingCache.set(String(userId), { ...data, createdAt: new Date().toISOString() });
}

function getPending(userId) {
  return pendingCache.get(String(userId)) || null;
}

function deletePending(userId) {
  pendingCache.delete(String(userId));
}

function getAllPending() {
  return Array.from(pendingCache.entries()).map(([userId, data]) => ({ userId, ...data }));
}

function hasPending(userId) {
  return pendingCache.has(String(userId));
}

module.exports = { setPending, getPending, deletePending, getAllPending, hasPending };
