require('dotenv').config();

const { Telegraf } = require('telegraf');
const { ensureHeaderRow } = require('./src/sheets');
const { handleStart, handleMessage, handlePhotoProof, handlePaymentChoice, handleSkipProof } = require('./src/handlers/start');
const { handleQueue } = require('./src/handlers/queue');
const { handleStatus } = require('./src/handlers/status');
const { handleApprove, handleReject, handlePending, handleAdminHelp, handleInlineApprove, handleInlineReject } = require('./src/handlers/admin');
const { handleList } = require('./src/handlers/list');
const { handleBalance, handleStats } = require('./src/handlers/stats');
const { getSession, STEPS } = require('./src/state');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required in .env');

const bot = new Telegraf(BOT_TOKEN);

// Diagnostic ping (no Sheets needed)
bot.command('ping', (ctx) => ctx.reply('🟢 Бот работает! Сервер: Railway'));

// User commands
bot.start(handleStart);
bot.command('queue', handleQueue);
bot.command('status', handleStatus);
bot.command('list', handleList);
bot.command('balance', handleBalance);
bot.command('stats', handleStats);
bot.command('счет', handleBalance);

// Admin commands
bot.command('approve', handleApprove);
bot.command('reject', handleReject);
bot.command('pending', handlePending);
bot.command('admin', handleAdminHelp);

bot.command('help', (ctx) => {
  ctx.reply(
    '📖 *Команды:*\n\n' +
    '/start — подать заявку\n' +
    '/status — мой статус и позиция\n' +
    '/queue — текущая очередь\n' +
    '/balance — публичный счёт (виден всем)\n' +
    '/stats — статистика системы\n' +
    '/list — последние 10 донаций\n' +
    '/help — помощь',
    { parse_mode: 'Markdown' }
  );
});

// Inline keyboard: payment method selection
bot.action(/^pay_/, handlePaymentChoice);

// Inline keyboard: skip proof
bot.action('skip_proof', handleSkipProof);

// Inline keyboard: admin one-tap approve/reject from notification
bot.action(/^adm_approve_/, handleInlineApprove);
bot.action(/^adm_reject_/, handleInlineReject);

// Photo proof handler (user sends screenshot)
bot.on('photo', (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  if (session.step === STEPS.AWAITING_PROOF) {
    return handlePhotoProof(ctx);
  }
});

// Text message handler for multi-step registration
bot.on('text', (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  const activeSteps = [STEPS.AWAITING_NAME, STEPS.AWAITING_AMOUNT, STEPS.AWAITING_PROOF];
  if (activeSteps.includes(session.step)) {
    return handleMessage(ctx);
  }
});

bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err.message);
  try {
    ctx.reply('⚠️ Произошла ошибка. Попробуйте ещё раз или напишите /start').catch(() => {});
  } catch {}
});

async function main() {
  try {
    await ensureHeaderRow();
    console.log('✅ Google Sheets connected');
  } catch (err) {
    console.warn('⚠️  Google Sheets error:', err.message);
  }

  await bot.launch();

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch(console.error);
