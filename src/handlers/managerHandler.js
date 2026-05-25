import config from '../config.js';
import logger from '../utils/logger.js';

let botActive = true; // bisa di-toggle via Bot Manager

/**
 * Handler untuk request dari Bot Manager
 * POST /manager
 */
export async function handleManagerRequest(req, res, sock) {
  const secret = req.headers['x-manager-secret'];

  // Validasi secret
  if (secret !== config.managerSecret) {
    logger.warn('⚠️ Manager request dengan secret tidak valid');
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { action, key, value, to, message } = req.body;
  logger.info(`🎛️ Manager action: ${action}`);

  try {
    switch (action) {

      case 'status':
        const { getSessionCount } = await import('../services/sessionManager.js');
        const { getActiveConversations, getQuotaStatus } = await import('../services/groqAI.js');
        return res.json({
          success: true,
          botId: config.botId,
          active: botActive,
          sessions: getSessionCount(),
          aiConversations: getActiveConversations(),
          quota: getQuotaStatus(),
          model: config.groqModel,
          uptime: process.uptime(),
        });

      case 'restart':
        logger.info('🔄 Restart diminta oleh Bot Manager...');
        res.json({ success: true, message: 'Restarting...' });
        setTimeout(() => process.exit(0), 1000); // Railway auto-restart
        return;

      case 'config':
        return handleConfigUpdate(key, value, res);

      case 'send':
        if (!sock) return res.json({ success: false, error: 'Socket tidak tersedia' });
        const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        return res.json({ success: true });

      default:
        return res.status(400).json({ success: false, error: `Action tidak dikenal: ${action}` });
    }
  } catch (error) {
    logger.error(`❌ Manager handler error: ${error.message}`);
    return res.status(500).json({ success: false, error: error.message });
  }
}

function handleConfigUpdate(key, value, res) {
  const boolValue = value === 'true' || value === 'on';

  switch (key) {
    case 'active':
      botActive = boolValue;
      logger.info(`🎛️ Bot active: ${botActive}`);
      return res.json({ success: true, key, value: botActive });

    case 'antispam':
      config.spamMaxMessages = boolValue ? 5 : 999;
      logger.info(`🎛️ Anti-spam: ${boolValue ? 'aktif' : 'nonaktif'}`);
      return res.json({ success: true, key, value: boolValue });

    case 'ai':
      config.aiAutoReplyPrivate = boolValue;
      config.aiAutoReplyGroup = boolValue;
      logger.info(`🎛️ AI reply: ${boolValue ? 'aktif' : 'nonaktif'}`);
      return res.json({ success: true, key, value: boolValue });

    case 'cooldown':
      config.aiCooldownSeconds = parseInt(value) || 5;
      logger.info(`🎛️ Cooldown: ${config.aiCooldownSeconds}s`);
      return res.json({ success: true, key, value: config.aiCooldownSeconds });

    default:
      return res.json({ success: false, error: `Config key tidak dikenal: ${key}` });
  }
}

/**
 * Cek apakah bot sedang aktif (dipanggil di messageHandler)
 */
export function isBotActive() {
  return botActive;
}
