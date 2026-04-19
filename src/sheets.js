const { google } = require('googleapis');
const path = require('path');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SHEET_NAME = process.env.SHEET_NAME || 'Donations';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const COL = {
  USER_ID: 0,
  NAME: 1,
  AMOUNT: 2,
  PAYMENT_METHOD: 3,
  PROOF_LINK: 4,
  STATUS: 5,        // pending / approved / rejected / awaiting_confirm / paid
  QUEUE_POSITION: 6,
  CREATED_AT: 7,
  PAID_AT: 8,       // timestamp when confirmed paid
};

let sheetsClient = null;

async function getClient() {
  if (sheetsClient) return sheetsClient;

  let auth;
  // Support both file-based and env-based credentials (for Railway/cloud)
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  } else {
    auth = new google.auth.GoogleAuth({
      keyFile: path.resolve(process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json'),
      scopes: SCOPES,
    });
  }

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

async function getAllRows() {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:H`,
  });
  return res.data.values || [];
}

async function findUserRow(userId) {
  const rows = await getAllRows();
  const idx = rows.findIndex((r) => r[COL.USER_ID] === String(userId));
  return idx === -1 ? null : { rowIndex: idx + 2, data: rows[idx] };
}

async function addDonation({ userId, name, amount, paymentMethod, proofLink }) {
  const sheets = await getClient();
  const createdAt = new Date().toISOString();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:H`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[String(userId), name, amount, paymentMethod, proofLink || '', 'pending', '', createdAt]],
    },
  });
}

async function updateStatus(userId, status) {
  const found = await findUserRow(userId);
  if (!found) return false;

  const sheets = await getClient();

  let queuePosition = found.data[COL.QUEUE_POSITION] || '';
  if (status === 'approved') {
    const rows = await getAllRows();
    const approvedCount = rows.filter((r) => r[COL.STATUS] === 'approved').length;
    queuePosition = approvedCount + 1;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!F${found.rowIndex}:G${found.rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[status, queuePosition]] },
  });

  return {
    queuePosition,
    name: found.data[COL.NAME],
    amount: found.data[COL.AMOUNT],
    paymentMethod: found.data[COL.PAYMENT_METHOD],
  };
}

async function getUserStatus(userId) {
  const found = await findUserRow(userId);
  if (!found) return null;
  const d = found.data;
  return {
    userId: d[COL.USER_ID],
    name: d[COL.NAME],
    amount: d[COL.AMOUNT],
    paymentMethod: d[COL.PAYMENT_METHOD],
    proofLink: d[COL.PROOF_LINK],
    status: d[COL.STATUS] || 'pending',
    queuePosition: d[COL.QUEUE_POSITION] || '—',
    createdAt: d[COL.CREATED_AT],
  };
}

async function getApprovedQueue() {
  const rows = await getAllRows();
  return rows
    .filter((r) => r[COL.STATUS] === 'approved')
    .sort((a, b) => new Date(a[COL.CREATED_AT]) - new Date(b[COL.CREATED_AT]))
    .map((r, i) => ({
      position: r[COL.QUEUE_POSITION] || i + 1,
      name: r[COL.NAME],
      amount: r[COL.AMOUNT],
      paymentMethod: r[COL.PAYMENT_METHOD],
      createdAt: r[COL.CREATED_AT],
    }));
}

async function getLastApproved(limit = 10) {
  const queue = await getApprovedQueue();
  return queue.slice(0, limit);
}

async function getStats() {
  const rows = await getAllRows();
  const approved = rows.filter((r) => r[COL.STATUS] === 'approved');
  const pending = rows.filter((r) => r[COL.STATUS] === 'pending');
  const rejected = rows.filter((r) => r[COL.STATUS] === 'rejected');

  const totalApprovedAmount = approved.reduce((sum, r) => sum + (parseFloat(r[COL.AMOUNT]) || 0), 0);
  const totalAllAmount = rows.reduce((sum, r) => sum + (parseFloat(r[COL.AMOUNT]) || 0), 0);
  const avgAmount = approved.length > 0 ? Math.round(totalApprovedAmount / approved.length) : 0;

  // Last 5 approved for transparency log
  const recentApproved = approved
    .sort((a, b) => new Date(b[COL.CREATED_AT]) - new Date(a[COL.CREATED_AT]))
    .slice(0, 5)
    .map((r) => ({
      name: r[COL.NAME],
      amount: r[COL.AMOUNT],
      paymentMethod: r[COL.PAYMENT_METHOD],
      date: r[COL.CREATED_AT] ? new Date(r[COL.CREATED_AT]).toLocaleDateString('ru-RU') : '—',
    }));

  return {
    totalDonors: rows.length,
    approvedCount: approved.length,
    pendingCount: pending.length,
    rejectedCount: rejected.length,
    totalApprovedAmount,
    totalAllAmount,
    avgAmount,
    recentApproved,
  };
}

async function getPendingUsers() {
  const rows = await getAllRows();
  return rows
    .filter((r) => r[COL.STATUS] === 'pending')
    .map((r) => ({
      userId: r[COL.USER_ID],
      name: r[COL.NAME],
      amount: r[COL.AMOUNT],
      paymentMethod: r[COL.PAYMENT_METHOD],
      proofLink: r[COL.PROOF_LINK],
      createdAt: r[COL.CREATED_AT],
    }));
}

// Admin marks as sent → status becomes awaiting_confirm (user must /confirm)
async function markAsPaid(userId) {
  const found = await findUserRow(userId);
  if (!found) return false;

  const sheets = await getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!F${found.rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['awaiting_confirm']] },
  });

  return {
    name: found.data[COL.NAME],
    amount: found.data[COL.AMOUNT],
    queuePosition: found.data[COL.QUEUE_POSITION],
  };
}

// User confirms receipt → status becomes paid
async function confirmReceipt(userId) {
  const found = await findUserRow(userId);
  if (!found) return null;
  if (found.data[COL.STATUS] !== 'awaiting_confirm') return { status: found.data[COL.STATUS] };

  const sheets = await getClient();
  const paidAt = new Date().toISOString();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!F${found.rowIndex}:I${found.rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['paid', found.data[COL.QUEUE_POSITION], '', paidAt]] },
  });

  return {
    confirmed: true,
    name: found.data[COL.NAME],
    amount: found.data[COL.AMOUNT],
    queuePosition: found.data[COL.QUEUE_POSITION],
  };
}

// Get pending submissions older than X hours (for admin reminder)
async function getPendingOlderThan(hours = 24) {
  const rows = await getAllRows();
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return rows
    .filter((r) => {
      if (r[COL.STATUS] !== 'pending') return false;
      const created = new Date(r[COL.CREATED_AT]).getTime();
      return created < cutoff;
    })
    .map((r) => ({
      userId: r[COL.USER_ID],
      name: r[COL.NAME],
      amount: r[COL.AMOUNT],
      paymentMethod: r[COL.PAYMENT_METHOD],
      proofLink: r[COL.PROOF_LINK],
      createdAt: r[COL.CREATED_AT],
    }));
}

// Get all approved (not yet paid) users for position notifications
async function getApprovedActiveUsers() {
  const rows = await getAllRows();
  return rows
    .filter((r) => r[COL.STATUS] === 'approved')
    .sort((a, b) => parseInt(a[COL.QUEUE_POSITION]) - parseInt(b[COL.QUEUE_POSITION]))
    .map((r, i) => ({
      userId: r[COL.USER_ID],
      name: r[COL.NAME],
      amount: r[COL.AMOUNT],
      queuePosition: r[COL.QUEUE_POSITION],
      effectivePosition: i + 1, // real position after paid members removed
    }));
}

// Check for suspicious duplicate: same amount + payment method from different user recently
async function checkDuplicate(userId, amount, paymentMethod) {
  const rows = await getAllRows();
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;

  const suspicious = rows.filter((r) => {
    if (r[COL.USER_ID] === String(userId)) return false; // same user handled elsewhere
    if (r[COL.STATUS] === 'rejected') return false;
    const sameAmount = parseFloat(r[COL.AMOUNT]) === parseFloat(amount);
    const sameMethod = r[COL.PAYMENT_METHOD] === paymentMethod;
    const recent = new Date(r[COL.CREATED_AT]).getTime() > recentCutoff;
    return sameAmount && sameMethod && recent;
  });

  return suspicious.length > 0 ? suspicious[0] : null;
}

// Get all users for broadcast (all statuses except rejected)
async function getAllUsersForBroadcast() {
  const rows = await getAllRows();
  return rows
    .filter((r) => r[COL.STATUS] !== 'rejected')
    .map((r) => ({ userId: r[COL.USER_ID], name: r[COL.NAME] }));
}

// Reset rejected user back to pending for resubmission
async function resetToResubmit(userId) {
  const found = await findUserRow(userId);
  if (!found) return false;
  const sheets = await getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!F${found.rowIndex}:G${found.rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['pending', '']] },
  });
  return true;
}

// Get or set fundraising goal (stored in a named range or separate sheet cell)
async function getGoal() {
  const sheets = await getClient();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Config!A1',
    });
    const val = res.data.values?.[0]?.[0];
    return val ? parseFloat(val) : null;
  } catch {
    return null;
  }
}

async function setGoal(amount) {
  const sheets = await getClient();
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Config!A1',
      valueInputOption: 'RAW',
      requestBody: { values: [[amount]] },
    });
    return true;
  } catch {
    return false;
  }
}

async function userExists(userId) {
  const found = await findUserRow(userId);
  return found !== null;
}

async function ensureHeaderRow() {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:H1`,
  });
  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:H1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [['user_id', 'name', 'amount', 'payment_method', 'proof_link', 'status', 'queue_position', 'created_at']],
      },
    });
  }
}

module.exports = {
  addDonation,
  updateStatus,
  markAsPaid,
  confirmReceipt,
  getUserStatus,
  getApprovedQueue,
  getLastApproved,
  getStats,
  getPendingUsers,
  getPendingOlderThan,
  getApprovedActiveUsers,
  getAllUsersForBroadcast,
  resetToResubmit,
  getGoal,
  setGoal,
  checkDuplicate,
  userExists,
  ensureHeaderRow,
};
