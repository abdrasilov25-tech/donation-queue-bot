// In-memory user session state for multi-step registration flow
const sessions = new Map();

const STEPS = {
  IDLE: 'idle',
  AWAITING_NAME: 'awaiting_name',
  AWAITING_AMOUNT: 'awaiting_amount',
  AWAITING_PAYMENT: 'awaiting_payment',
  AWAITING_PROOF: 'awaiting_proof',
  DONE: 'done',
};

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { step: STEPS.IDLE, data: {} });
  }
  return sessions.get(userId);
}

function setStep(userId, step) {
  const session = getSession(userId);
  session.step = step;
}

function setData(userId, key, value) {
  const session = getSession(userId);
  session.data[key] = value;
}

function clearSession(userId) {
  sessions.set(userId, { step: STEPS.IDLE, data: {} });
}

module.exports = { STEPS, getSession, setStep, setData, clearSession };
