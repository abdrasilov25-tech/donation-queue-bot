const { Markup } = require('telegraf');
const { markAsPaid, getUserStatus, getStats, banUser, unbanUser, getBannedUsers, addApprovedDonation } = require('../sheets');
const { getPending, deletePending, getAllPending } = require('../pending');
const { shiftWaitlist, getWaitlist } = require('../waitlist');
const { setRejected, clearRejection } = require('../phonestore');
const { notifyQueueMove } = require('../scheduler');
const { refreshLiveCounter } = require('../livecounter');

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
  const pending = getPending(targetUserId);

  // If already approved (not in pending cache), check Sheets for info
  if (!pending) {
    const existing = await getUserStatus(targetUserId).catch(() => null);
    if (existing && existing.status === 'approved') {
      const msg = `ℹ️ ${existing.name} уже одобрен (позиция #${existing.queuePosition}).`;
      return isInline ? ctx.answerCbQuery(msg) : ctx.reply(msg);
    }
    const msg = `❌ Заявка от пользователя ${targetUserId} не найдена.`;
    return isInline ? ctx.answerCbQuery(msg) : ctx.reply(msg);
  }

  const queuePosition = await addApprovedDonation({
    userId: targetUserId,
    name: pending.name,
    amount: pending.amount,
    paymentMethod: pending.paymentMethod,
    proofLink: pending.proofLink,
  });
  deletePending(targetUserId);
  clearRejection(targetUserId); // clear any existing cooldown on approval

  const userInfo = { name: pending.name, amount: pending.amount };
  const result = { queuePosition };
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

  // Update live counter in group/channel
  refreshLiveCounter(ctx.telegram).catch(() => {});

  // Notify donor with receipt
  try {
    const now = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', dateStyle: 'short', timeStyle: 'short' });
    await ctx.telegram.sendMessage(
      targetUserId,
      `🎉 *Ваша донация подтверждена!*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🧾 *ЧЕК*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 ${userInfo.name}\n` +
      `💰 *${parseFloat(userInfo.amount).toLocaleString('ru-RU')} ₸*\n` +
      `📍 Позиция в очереди: *#${result.queuePosition}*\n` +
      `🕐 ${now}\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📊 Общий счёт: *${stats.totalApprovedAmount.toLocaleString('ru-RU')} ₸* (${stats.approvedCount} чел.)\n\n` +
      `Используйте /status чтобы следить за позицией.\n/balance — общий счёт системы`,
      { parse_mode: 'Markdown' }
    );
  } catch {
    // User may have blocked bot
  }
}

async function rejectUser(ctx, targetUserId, isInline = false, reason = '') {
  const pending = getPending(targetUserId);
  if (!pending) {
    const msg = `❌ Заявка от пользователя ${targetUserId} не найдена.`;
    return isInline ? ctx.answerCbQuery(msg) : ctx.reply(msg);
  }

  deletePending(targetUserId);
  setRejected(targetUserId); // start 24h cooldown

  const userInfo = { name: pending.name, amount: pending.amount };
  const reasonLine = reason ? `\n📝 Причина: ${reason}` : '';
  const adminMsg = `❌ *Отклонено.*\n\n👤 ${userInfo.name} — ${parseFloat(userInfo.amount).toLocaleString('ru-RU')} ₸${reasonLine}`;

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
      `❌ *Ваша заявка отклонена.*\n\n` +
      (reason
        ? `📝 *Причина:* ${reason}\n\n`
        : '') +
      `Если считаете это ошибкой — обратитесь к администратору.\n` +
      `Для повторной подачи: /resubmit`,
      { parse_mode: 'Markdown' }
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
  if (args.length < 2) return ctx.reply('❌ Использование: /reject <user_id> [причина]');
  const reason = args.slice(2).join(' ').trim();
  try {
    await rejectUser(ctx, args[1].trim(), false, reason);
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

    // Notify first person on waitlist that a spot opened
    const nextWaiting = shiftWaitlist();
    if (nextWaiting) {
      await ctx.telegram.sendMessage(
        nextWaiting.userId,
        `🔔 *Место в очереди освободилось!*\n\n` +
        `Вы были в листе ожидания — теперь можете подать заявку:\n\n` +
        `👉 /start`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});

      const remaining = getWaitlist();
      for (const [i, u] of remaining.entries()) {
        await ctx.telegram.sendMessage(
          u.userId,
          `📋 *Обновление листа ожидания*\n\nВаша позиция: *#${i + 1}*`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
    }

  } catch (err) {
    console.error('Paid error:', err);
    await ctx.reply('❌ Ошибка при обновлении статуса.');
  }
}

async function handlePending(ctx) {
  if (!requireAdmin(ctx)) return;
  try {
    const pending = getAllPending();
    if (pending.length === 0) return ctx.reply('✅ Нет заявок, ожидающих проверки.');

    for (const u of pending) {
      const isPhoto = u.proofLink && u.proofLink.startsWith('[фото:');
      const rawId = isPhoto ? u.proofLink.replace('[фото:', '').replace(/\|.*$/, '').replace(']', '') : null;
      const photoId = rawId || null;

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

async function handleBan(ctx) {
  if (!requireAdmin(ctx)) return;
  const args = ctx.message.text.split(' ');
  if (args.length < 2) return ctx.reply('❌ Использование: /ban <user_id>');

  const targetId = args[1].trim();
  try {
    const userInfo = await getUserStatus(targetId).catch(() => null);
    await banUser(targetId);

    await ctx.reply(
      `🚫 *Пользователь заблокирован*\n\n` +
      `🆔 ID: \`${targetId}\`\n` +
      (userInfo ? `👤 ${userInfo.name}` : '') +
      `\n\nОн больше не сможет подавать заявки.\n/unban ${targetId} — разблокировать`,
      { parse_mode: 'Markdown' }
    );

    // Notify the banned user
    await ctx.telegram.sendMessage(
      targetId,
      `🚫 Ваш аккаунт заблокирован администратором.\n\nВы не можете подавать новые заявки.`
    ).catch(() => {});
  } catch (err) {
    console.error('Ban error:', err);
    await ctx.reply('❌ Ошибка при блокировке.');
  }
}

async function handleUnban(ctx) {
  if (!requireAdmin(ctx)) return;
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    const banned = await getBannedUsers().catch(() => []);
    if (banned.length === 0) return ctx.reply('✅ Нет заблокированных пользователей.');
    return ctx.reply(
      `🚫 *Заблокированные:*\n\n` +
      banned.map((id, i) => `${i + 1}. \`${id}\``).join('\n') +
      `\n\n/unban <user_id> — разблокировать`,
      { parse_mode: 'Markdown' }
    );
  }

  const targetId = args[1].trim();
  try {
    await unbanUser(targetId);
    await ctx.reply(`✅ Пользователь \`${targetId}\` разблокирован.`, { parse_mode: 'Markdown' });
    await ctx.telegram.sendMessage(
      targetId,
      `✅ Ваш аккаунт разблокирован. Вы можете снова подавать заявки: /start`
    ).catch(() => {});
  } catch (err) {
    console.error('Unban error:', err);
    await ctx.reply('❌ Ошибка при разблокировке.');
  }
}

async function handleAdminHelp(ctx) {
  if (!requireAdmin(ctx)) return;
  await ctx.reply(
    '🔧 *Команды администратора:*\n\n' +
    '/pending — список ожидающих (с кнопками ✅/❌)\n' +
    '/approve <user\\_id> — одобрить вручную\n' +
    '/reject <user\\_id> [причина] — отклонить с причиной\n' +
    '/paid <user\\_id> — подтвердить выплату\n' +
    '/ban <user\\_id> — заблокировать пользователя\n' +
    '/unban [user\\_id] — разблокировать / список\n' +
    '/search <имя> — найти пользователя по имени\n' +
    '/note <user\\_id> <текст> — добавить заметку в таблицу\n' +
    '/pause [причина] — приостановить приём заявок\n' +
    '/resume — возобновить приём заявок\n' +
    '/broadcast <текст> — рассылка всем\n' +
    '/export — выгрузить CSV файл\n' +
    '/health — статус бота и Sheets\n' +
    '/setlimit <N> — лимит очереди (0 = без лимита)\n' +
    '/setgoal <сумма> — цель сбора\n' +
    '/queue — полная очередь\n' +
    '/stats — статистика\n\n' +
    '🔄 *Цикл:* pending → approved → awaiting\\_confirm → paid\n' +
    '🚨 Одинаковый скриншот от двух пользователей — автоматическое предупреждение\n' +
    '💡 При новой заявке вы получаете уведомление — просто нажмите ✅ или ❌',
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleApprove, handleReject, handlePaid, handlePending, handleAdminHelp, handleInlineApprove, handleInlineReject, handleBan, handleUnban, isAdmin };
