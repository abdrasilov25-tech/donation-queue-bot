require('dotenv').config();

const express = require('express');
const { Telegraf } = require('telegraf');

// Prevent crashes from unhandled errors
process.on('uncaughtException', (err) => {
  console.error('💥 uncaughtException:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 unhandledRejection:', reason);
});
const { ensureHeaderRow, ensureConfigSheet } = require('./src/sheets');
const { handleStart, handleMessage, handlePhotoProof, handlePaymentChoice, handleSkipProof, handleJoinWaitlist, handleStartRegistration, handleContactShare } = require('./src/handlers/start');
const { handleRef } = require('./src/handlers/ref');
const { handleLang, handleLangCallback } = require('./src/handlers/language');
const { handleQueue } = require('./src/handlers/queue');
const { handleStatus } = require('./src/handlers/status');
const { handleApprove, handleReject, handlePaid, handlePending, handleAdminHelp, handleInlineApprove, handleInlineReject, handleBan, handleUnban } = require('./src/handlers/admin');
const { handleList } = require('./src/handlers/list');
const { handleBalance, handleStats, handleSetGoal } = require('./src/handlers/stats');
const { handleBroadcast } = require('./src/handlers/broadcast');
const { handleResubmit } = require('./src/handlers/resubmit');
const { handleConfirm } = require('./src/handlers/confirm');
const { handleExport } = require('./src/handlers/export');
const { handleHealth, handleSetLimit } = require('./src/handlers/health');
const { handleCancel } = require('./src/handlers/cancel');
const { handleTop } = require('./src/handlers/top');
const { handleEdit } = require('./src/handlers/edit');
const { handleSearch } = require('./src/handlers/search');
const { handleNote } = require('./src/handlers/note');
const { handlePause, handleResume } = require('./src/handlers/pause');
const { handleStartCounter, handleStopCounter } = require('./src/handlers/counter');
const { handleHistory } = require('./src/handlers/history');
const { handleFaq } = require('./src/handlers/faq');
const { handleNotify } = require('./src/handlers/notify');
const { handlePay } = require('./src/handlers/pay');
const { getSession, STEPS, isRateLimited } = require('./src/state');
const { startScheduler } = require('./src/scheduler');

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
bot.command('setgoal', handleSetGoal);
bot.command('resubmit', handleResubmit);
bot.command('confirm', handleConfirm);
bot.command('cancel', handleCancel);
bot.command('top', handleTop);
bot.command('edit', handleEdit);
bot.command('broadcast', handleBroadcast);
bot.command('export', handleExport);
bot.command('health', handleHealth);
bot.command('setlimit', handleSetLimit);
bot.command('search', handleSearch);
bot.command('note', handleNote);
bot.command('pause', handlePause);
bot.command('resume', handleResume);
bot.command('startcounter', handleStartCounter);
bot.command('stopcounter', handleStopCounter);
bot.command('history', handleHistory);
bot.command('faq', handleFaq);
bot.command('notify', handleNotify);
bot.command('pay', handlePay);
bot.command('ref', handleRef);
bot.command('lang', handleLang);

// Admin commands
bot.command('approve', handleApprove);
bot.command('reject', handleReject);
bot.command('paid', handlePaid);
bot.command('pending', handlePending);
bot.command('admin', handleAdminHelp);
bot.command('ban', handleBan);
bot.command('unban', handleUnban);

bot.command('help', (ctx) => {
  ctx.reply(
    '📖 *Команды:*\n\n' +
    '/start — подать заявку\n' +
    '/pay — реквизиты для перевода\n' +
    '/status — мой статус и позиция\n' +
    '/queue — текущая очередь\n' +
    '/top — топ-10 доноров\n' +
    '/balance — публичный счёт с прогресс-баром\n' +
    '/stats — статистика системы\n' +
    '/list — последние 10 донаций\n' +
    '/edit amount 5000 — изменить сумму (пока pending)\n' +
    '/edit method Kaspi — изменить способ оплаты\n' +
    '/cancel — отменить текущую регистрацию\n' +
    '/history — история моих заявок\n' +
    '/notify on|off — уведомления о позиции\n' +
    '/resubmit — повторная подача (для отклонённых)\n' +
    '/confirm — подтвердить получение выплаты\n' +
    '/faq — частые вопросы\n' +
    '/ref — реферальная ссылка\n' +
    '/help — помощь',
    { parse_mode: 'Markdown' }
  );
});

// Inline keyboard: payment method selection
bot.action(/^pay_/, handlePaymentChoice);

// Inline keyboard: skip proof
bot.action('skip_proof', handleSkipProof);

// Inline keyboard: join waitlist
bot.action('join_waitlist', handleJoinWaitlist);

// Inline keyboard: onboarding start
bot.action('start_registration', handleStartRegistration);

// Inline keyboard: language selection
bot.action(/^lang_(ru|kz)$/, handleLangCallback);

// Inline keyboard: admin one-tap approve/reject from notification
bot.action(/^adm_approve_/, handleInlineApprove);
bot.action(/^adm_reject_/, handleInlineReject);

// Contact share handler (phone verification)
bot.on('contact', (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  if (session.step === STEPS.AWAITING_PHONE) {
    return handleContactShare(ctx);
  }
});

// Photo proof handler (user sends screenshot)
bot.on('photo', (ctx) => {
  const userId = ctx.from.id;
  if (isRateLimited(userId)) return;
  const session = getSession(userId);
  if (session.step === STEPS.AWAITING_PROOF) {
    return handlePhotoProof(ctx);
  }
});

// Text message handler — registration steps + main menu buttons
const MENU_BUTTONS = ['📝 Подать заявку', '📊 Мой статус', '💰 Баланс', '📋 Очередь', '❓ FAQ', '🔗 Моя ссылка'];
bot.on('text', (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  const text = ctx.message.text?.trim();
  const activeSteps = [STEPS.AWAITING_NAME, STEPS.AWAITING_AMOUNT, STEPS.AWAITING_PROOF];
  if (MENU_BUTTONS.includes(text) || activeSteps.includes(session.step)) {
    return handleMessage(ctx);
  }
});

bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err.message);
  try {
    ctx.reply('⚠️ Произошла ошибка. Попробуйте ещё раз или напишите /start').catch(() => {});
  } catch {}
});

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // e.g. https://donation-queue-bot.onrender.com

app.get('/', (req, res) => res.send('Bot is running'));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

async function main() {
  try {
    await ensureHeaderRow();
    await ensureConfigSheet();
    console.log('✅ Google Sheets connected (Donations + Config sheets ready)');
  } catch (err) {
    console.warn('⚠️  Google Sheets error:', err.message);
  }

  startScheduler(bot);

  if (WEBHOOK_URL) {
    // Webhook mode — instant response, no polling conflicts
    const secretPath = `/webhook/${BOT_TOKEN}`;
    app.use(bot.webhookCallback(secretPath));
    app.listen(PORT, '0.0.0.0', () => console.log(`✅ HTTP server on port ${PORT}`));

    await bot.telegram.setWebhook(`${WEBHOOK_URL}${secretPath}`);
    console.log(`🔗 Webhook set: ${WEBHOOK_URL}${secretPath}`);
  } else {
    // Fallback: polling mode (local dev)
    app.listen(PORT, '0.0.0.0', () => console.log(`✅ HTTP server on port ${PORT}`));

    while (true) {
      try {
        console.log('🚀 Starting bot (polling)...');
        await bot.launch();
        break;
      } catch (err) {
        if (err.response && err.response.error_code === 409) {
          console.log('⏳ Another instance detected, retrying in 5s...');
          await new Promise((r) => setTimeout(r, 5000));
        } else {
          throw err;
        }
      }
    }
  }

  // Notify admins that bot (re)started
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
  for (const adminId of adminIds) {
    await bot.telegram.sendMessage(
      adminId,
      `🟢 *Бот запущен* (${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })})\n` +
      `Режим: ${WEBHOOK_URL ? 'Webhook ⚡' : 'Polling'} | Сервер: Render`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch(console.error);
