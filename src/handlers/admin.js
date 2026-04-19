const { Markup } = require('telegraf');
const { updateStatus, markAsPaid, getUserStatus, getPendingUsers, getStats } = require('../sheets');
const { notifyQueueMove } = require('../scheduler');

function getAdminIds() {
  return (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
}

function isAdmin(userId) {
  return getAdminIds().includes(String(userId));
}

function requireAdmin(ctx) {
  if (!isAdmin(ctx.from.id)) {
    ctx.reply('🚫 У вас нет прав для этой команды.');
    return false;
  }
  return true;
}

async function approveUser(ctx, targetUserId, isInline = false) {
  const userInfo = await getUserStatus(targetUserId);
  if (!userInfo) {
    const msg = `❌ Пользователь с ID ${targetUserId} не найден.`;
    return isInline ? ctx.answerCbQuery(msg) : ctx.reply(msg);
  }
  if (userInfo.status === 'approved') {
    const msg = `ℹ️ ${userInfo.name} уже одобрен (позиция #${userInfo.queuePosition}).`;
    return isInline ? ctx.answerCbQuery(msg) : ctx.reply(msg);
  }

  const result = await updateStatus(targetUserId, 'approved');
  const stats = await getStats();

  const adminMsg =
    `✅ *Одобрено!*\n\n` +
    `👤 ${userInfo.name}\n` +
    `💰 ${parseFloat(userInfo.amount).toLocaleString('ru-RU')} ₸\n` +
    `📍 Позиция: *#${result.queuePosition}*\n\n` +
    `📊 Общий счёт: *${stats.totalApprovedAmount.toLocaleString('ru-RU')} ₸* (${stats.approvedCount} участников)`;

  if (isInline) {
    await ctx.answerCbQuery('✅ Одобрено!');
    await ctx.editMessageCaption
      ? ctx.editMessageCaption(adminMsg, { parse_mode: 'Markdown' })
      : ctx.editMessageText(adminMsg, { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(adminMsg, { parse_mode: 'Markdown' });
  }

  // Broadcast to group if configured
  const groupId = process.env.GROUP_CHAT_ID;
  if (groupId) {
    try {
      await ctx.telegram.sendMessage(
        groupId,
        `🎉 *Новая донация подтверждена!*\n\n` +
        `👤 ${userInfo.name} — *${parseFloat(userInfo.amount).toLocaleString('ru-RU')} ₸*\n` +
        `📍 Позиция в очереди: #${result.queuePosition}\n\n` +
        `💵 Общая сумма заявок: *${stats.totalAllAmount.toLocaleString('ru-RU')} ₸*\n` +
        `✅ Одобрено: *${stats.totalApprovedAmount.toLocaleString('ru-RU')} ₸* (${stats.approvedCount} чел.)\n\n` +
        `/balance — полный счёт системы`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.warn('Group broadcast failed:', e.message);
    }
  }

  // Notify donor
  try {
    await ctx.telegram.sendMessage(
      targetUserId,
      `🎉 *Ваша донация подтверждена!*\n\n` +
      `💰 Сумма: *${parseFloat(userInfo.amount).toLocaleString('ru-RU')} ₸*\n` +
      `📍 Ваша позиция в очереди: *#${result.queuePosition}*\n\n` +
      `📊 *Счёт системы сейчас:*\n` +
      `💵 Общая сумма заявок: *${stats.totalAllAmount.toLocaleString('ru-RU')} ₸*\n` +
      `✅ Одобрено: *${stats.totalApprovedAmount.toLocaleString('ru-RU')} ₸* (${stats.approvedCount} чел.)\n\n` +
      `Используйте /balance чтобы видеть счёт в любое время.`,
      { parse_mode: 'Markdown' }
    );
  } catch {
    // User may have blocked bot
  }
}

async function rejectUser(ctx, targetUserId, isInline = false) {
  const userInfo = await getUserStatus(targetUserId);
  if (!userInfo) {
    const msg = `❌ Пользователь ${targetUserId} не найден.`;
    return isInline ? ctx.answerCbQuery(msg) : ctx.reply(msg);
  }

  await updateStatus(targetUserId, 'rejected');

  const adminMsg = `❌ *Отклонено.*\n\n👤 ${userInfo.name} — ${parseFloat(userInfo.amount).toLocaleString('ru-RU')} ₸`;

  if (isInline) {
    await ctx.answerCbQuery('❌ Отклонено');
    await ctx.editMessageCaption
      ? ctx.editMessageCaption(adminMsg, { parse_mode: 'Markdown' })
      : ctx.editMessageText(adminMsg, { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(adminMsg, { parse_mode: 'Markdown' });
  }

  try {
    await ctx.telegram.sendMessage(
      targetUserId,
      `❌ Ваша заявка была отклонена.\n\nОбратитесь к администратору за подробностями.`
    );
  } catch {
    // ignored
  }
}

// Inline button handlers (one-tap approve/reject from notification)
async function handleInlineApprove(ctx) {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('🚫 Нет доступа');
  const userId = ctx.callbackQuery.data.replace('adm_approve_', '');
  try {
    await approveUser(ctx, userId, true);
  } catch (err) {
    console.error('Inline approve error:', err);
    await ctx.answerCbQuery('❌ Ошибка');
  }
}

async function handleInlineReject(ctx) {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('🚫 Нет доступа');
  const userId = ctx.callbackQuery.data.replace('adm_reject_', '');
  try {
    await rejectUser(ctx, userId, true);
  } catch (err) {
    console.error('Inline reject error:', err);
    await ctx.answerCbQuery('❌ Ошибка');
  }
}

// Command-based handlers
async function handleApprove(ctx) {
  if (!requireAdmin(ctx)) return;
  const args = ctx.message.text.split(' ');
  if (args.length < 2) return ctx.reply('❌ Использование: /approve <user_id>');
  try {
    await approveUser(ctx, args[1].trim(), false);
  } catch (err) {
    console.error('Approve error:', err);
    await ctx.reply('❌ Ошибка при обновлении статуса.');
  }
}

async function handleReject(ctx) {
  if (!requireAdmin(ctx)) return;
  const args = ctx.message.text.split(' ');
  if (args.length < 2) return ctx.reply('❌ Использование: /reject <user_id>');
  try {
    await rejectUser(ctx, args[1].trim(), false);
  } catch (err) {
    console.error('Reject error:', err);
    await ctx.reply('❌ Ошибка при обновлении статуса.');
  }
}

async function handlePaid(ctx) {
  if (!requireAdmin(ctx)) return;
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply(
      '❌ Использование: /paid <user_id>\n\n' +
      'Отмечает донацию как выплаченную и уведомляет очередь.'
    );
  }

  const targetUserId = args[1].trim();
  try {
    const userInfo = await getUserStatus(targetUserId);
    if (!userInfo) return ctx.reply(`❌ Пользователь ${targetUserId} не найден.`);
    if (userInfo.status !== 'approved') {
      return ctx.reply(`⚠️ Статус ${userInfo.name}: *${userInfo.status}*. Выплата возможна только для одобренных.`, { parse_mode: 'Markdown' });
    }

    const result = await markAsPaid(targetUserId);
    const stats = await getStats();

    await ctx.reply(
      `✅ *Выплата отправлена!*\n\n` +
      `👤 ${result.name}\n` +
      `💰 ${parseFloat(result.amount).toLocaleString('ru-RU')} ₸\n` +
      `📍 Позиция #${result.queuePosition}\n\n` +
      `⏳ Ожидаем подтверждение от получателя (/confirm)\n` +
      `📊 Осталось в очереди: ${stats.approvedCount} чел.`,
      { parse_mode: 'Markdown' }
    );

    // Notify the paid user to confirm receipt
    try {
      await ctx.telegram.sendMessage(
        targetUserId,
        `💸 *Администратор отправил вам выплату!*\n\n` +
        `💰 ${parseFloat(result.amount).toLocaleString('ru-RU')} ₸\n\n` +
        `Пожалуйста, подтвердите получение командой:\n` +
        `👉 /confirm`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    // Notify others in queue that it moved
    await notifyQueueMove(ctx.telegram ? { telegram: ctx.telegram } : ctx, result.name, result.queuePosition);

  } catch (err) {
    console.error('Paid error:', err);
    await ctx.reply('❌ Ошибка при обновлении статуса.');
  }
}

async function handlePending(ctx) {
  if (!requireAdmin(ctx)) return;
  try {
    const pending = await getPendingUsers();
    if (pending.length === 0) return ctx.reply('✅ Нет заявок, ожидающих проверки.');

    for (const u of pending) {
      const isPhoto = u.proofLink && u.proofLink.startsWith('[фото:');
      const photoId = isPhoto ? u.proofLink.replace('[фото:', '').replace(']', '') : null;

      const msg =
        `⏳ *Заявка на проверке*\n\n` +
        `👤 ${u.name}\n` +
        `💰 *${parseFloat(u.amount).toLocaleString('ru-RU')} ₸*\n` +
        `💳 ${u.paymentMethod}\n` +
        `🆔 ID: \`${u.userId}\`\n` +
        (!isPhoto && u.proofLink ? `🔗 ${u.proofLink}` : !photoId ? '⚠️ Без доказательства' : '📸 Скриншот');

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Одобрить', `adm_approve_${u.userId}`),
          Markup.button.callback('❌ Отклонить', `adm_reject_${u.userId}`),
        ],
      ]);

      if (photoId) {
        await ctx.replyWithPhoto(photoId, { caption: msg, parse_mode: 'Markdown', ...keyboard });
      } else {
        await ctx.reply(msg, { parse_mode: 'Markdown', ...keyboard });
      }
    }
  } catch (err) {
    console.error('Pending error:', err);
    await ctx.reply('❌ Ошибка при загрузке.');
  }
}

async function handleAdminHelp(ctx) {
  if (!requireAdmin(ctx)) return;
  await ctx.reply(
    '🔧 *Команды администратора:*\n\n' +
    '/pending — список ожидающих (с кнопками ✅/❌)\n' +
    '/approve <user\\_id> — одобрить вручную\n' +
    '/reject <user\\_id> — отклонить вручную\n' +
    '/paid <user\\_id> — подтвердить выплату\n' +
    '/broadcast <текст> — рассылка всем\n' +
    '/export — выгрузить CSV файл\n' +
    '/health — статус бота и Sheets\n' +
    '/setlimit <N> — лимит очереди (0 = без лимита)\n' +
    '/setgoal <сумма> — цель сбора\n' +
    '/queue — полная очередь\n' +
    '/stats — статистика\n\n' +
    '🔄 *Цикл:* pending → approved → awaiting\\_confirm → paid\n' +
    '💡 При новой заявке вы получаете уведомление — просто нажмите ✅ или ❌',
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleApprove, handleReject, handlePaid, handlePending, handleAdminHelp, handleInlineApprove, handleInlineReject, isAdmin };
