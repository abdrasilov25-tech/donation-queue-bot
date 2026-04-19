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
  STATUS: 5,
  QUEUE_POSITION: 6,
  CREATED_AT: 7,
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
  getUserStatus,
  getApprovedQueue,
  getLastApproved,
  getStats,
  getPendingUsers,
  userExists,
  ensureHeaderRow,
};
