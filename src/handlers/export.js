const { getAllRowsRaw } = require('../sheets');

function isAdmin(userId) {
  return (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).includes(String(userId));
}

function rowsToCsv(rows) {
  return rows.map((row) =>
    row.map((cell) => {
      const s = String(cell ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    }).join(',')
  ).join('\n');
}

async function handleExport(ctx) {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫 Нет доступа.');

  try {
    await ctx.reply('⏳ Генерирую CSV...');
    const rows = await getAllRowsRaw();
    const csv = rowsToCsv(rows);
    const buffer = Buffer.from('\uFEFF' + csv, 'utf-8'); // BOM for Excel

    const date = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
    await ctx.replyWithDocument(
      { source: buffer, filename: `donations_${date}.csv` },
      { caption: `📊 Экспорт донаций — ${rows.length - 1} записей\n${date}` }
    );
  } catch (err) {
    console.error('Export error:', err);
    await ctx.reply('❌ Ошибка при экспорте.');
  }
}

module.exports = { handleExport };
