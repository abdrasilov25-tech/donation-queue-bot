const sessions = new Map();
const rateLimitMap = new Map(); // userId -> last message timestamp

const STEPS = {
  IDLE: 'idle',
  AWAITING_PHONE: 'awaiting_phone',
  AWAITING_NAME: 'awaiting_name',
  AWAITING_AMOUNT: 'awaiting_amount',
  AWAITING_PAYMENT: 'awaiting_payment',
  AWAITING_PROOF: 'awaiting_proof',
  DONE: 'done',
};

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RATE_LIMIT_MS = 1500;             // min gap between messages per user

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { step: STEPS.IDLE, data: {}, updatedAt: Date.now() });
  }
  return sessions.get(userId);
}

function setStep(userId, step) {
  const session = getSession(userId);
  session.step = step;
  session.updatedAt = Date.now();
}

function setData(userId, key, value) {
  const session = getSession(userId);
  session.data[key] = value;
  session.updatedAt = Date.now();
}

function clearSession(userId) {
  sessions.set(userId, { step: STEPS.IDLE, data: {}, updatedAt: Date.now() });
}

// Returns true if user is sending too fast
function isRateLimited(userId) {
  const now = Date.now();
  const last = rateLimitMap.get(userId) || 0;
  if (now - last < RATE_LIMIT_MS) return true;
  rateLimitMap.set(userId, now);
  return false;
}

// Clean up sessions older than TTL and stale rate limit entries
function cleanupStaleSessions() {
  const now = Date.now();
  let cleaned = 0;

  for (const [userId, session] of sessions) {
    const activeSteps = [STEPS.AWAITING_PHONE, STEPS.AWAITING_NAME, STEPS.AWAITING_AMOUNT, STEPS.AWAITING_PAYMENT, STEPS.AWAITING_PROOF];
    if (activeSteps.includes(session.step) && now - session.updatedAt > SESSION_TTL_MS) {
      clearSession(userId);
      cleaned++;
    }
  }

  for (const [userId, ts] of rateLimitMap) {
    if (now - ts > 60_000) rateLimitMap.delete(userId);
  }

  if (cleaned > 0) console.log(`🧹 Cleaned ${cleaned} stale sessions`);
}

module.exports = { STEPS, getSession, setStep, setData, clearSession, isRateLimited, cleanupStaleSessions };
