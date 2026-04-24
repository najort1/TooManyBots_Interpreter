import fs from 'node:fs';
import path from 'node:path';

import {
  getActiveSessions,
  listConversationEvents,
  listConversationEventsByJid,
  listConversationEventsSinceByJid,
} from '../db/index.js';
import { loadFlow, getFlowBotType } from '../engine/flowLoader.js';
import { BROADCAST_LIMITS, INTERNAL_VAR } from '../config/constants.js';

export async function dispatchDashboardApiRoute({
  server,
  req,
  res,
  requestUrl,
  helpers,
  context,
}) {
  const {
    sendJson,
    sendText,
    readJsonBody,
    normalizeFlowBlocks,
    normalizeFlowPath,
    normalizeModeParam,
    resolveFlowPathsForMode,
    toInt,
    normalizeActor,
    listModeEvents,
    parseDataUrlImage,
    saveHandoffMedia,
    decodePathComponent,
    isPathInsideRoot,
    resolveBlockIndex,
  } = helpers;

  const {
    __dirname,
    HANDOFF_MEDIA_DIR,
    STATIC_MIME_TYPES,
  } = context;

  const pathname = requestUrl.pathname;
  const parseSurveyFilters = (source = requestUrl.searchParams) => {
    const read = key => {
      if (source && typeof source.get === 'function') {
        return source.get(key);
      }
      return source?.[key];
    };
    const toOptionalInt = raw => {
      const normalized = String(raw ?? '').trim();
      if (!normalized) return null;
      const parsed = toInt(normalized, Number.NaN);
      return Number.isFinite(parsed) ? parsed : null;
    };
    return {
      typeId: String(read('typeId') ?? '').trim(),
      flowPath: String(read('flowPath') ?? '').trim(),
      blockId: String(read('blockId') ?? '').trim(),
      from: toOptionalInt(read('from')),
      to: toOptionalInt(read('to')),
      granularity: String(read('granularity') ?? read('timeBucket') ?? '').trim() || 'day',
      limit: Math.max(1, Math.min(10000, toInt(read('limit'), 200))),
      offset: Math.max(0, toInt(read('offset'), 0)),
      status: String(read('status') ?? '').trim(),
    };
  };

  if (pathname === '/api/health') {
    const info = server.getRuntimeInfo();
    const mode = normalizeModeParam(info.mode || 'conversation');
    const availableModes = Array.isArray(info.availableModes)
      ? info.availableModes.map(item => normalizeModeParam(item, mode))
      : [mode];
    sendJson(res, 200, {
      status: 'ok',
      uptimeMs: Date.now() - server.startupTime,
      mode,
      flowFile: info.flowFile || 'unknown',
      flowPath: normalizeFlowPath(info.flowPath),
      needsInitialSetup: info.needsInitialSetup === true,
      availableModes,
      ingestion: info.ingestion || {},
      whatsapp: info.whatsapp || {},
      flowPathsByMode: {
        conversation: resolveFlowPathsForMode(info, 'conversation'),
        command: resolveFlowPathsForMode(info, 'command'),
      },
    });
    return true;
  }

  if (pathname === '/api/observability') {
    const quota = server.consumeRouteQuota(req, '/api/observability');
    if (!quota.ok) {
      sendJson(res, 429, {
        error: 'rate-limit-exceeded',
        retryAfterMs: quota.retryAfterMs,
      });
      return true;
    }
    sendJson(res, 200, server.buildObservabilitySnapshot());
    return true;
  }

  if (pathname === '/api/reload' && req.method === 'POST') {
    try {
      await server.onReload();
      sendJson(res, 200, { reloaded: true });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  if (pathname === '/api/handoff/blocks') {
    const blocks = normalizeFlowBlocks(server.getFlowBlocks());
    sendJson(res, 200, { blocks });
    return true;
  }

  if (pathname === '/api/bots' && req.method === 'GET') {
    try {
      const botsDir = path.resolve(__dirname, '..', 'bots');
      const tmbFiles = fs.existsSync(botsDir) ? fs.readdirSync(botsDir).filter(f => f.endsWith('.tmb')) : [];
      const activeFlowsInfo = server.getRuntimeInfo();

      const bots = tmbFiles.map(file => {
        const flowPath = path.join(botsDir, file);
        let botType = 'unknown';
        let totalBlocks = 0;
        let syntaxError = null;
        let isActive = false;

        const allActivePaths = [
          ...(activeFlowsInfo?.flowPathsByMode?.conversation || []),
          ...(activeFlowsInfo?.flowPathsByMode?.command || []),
        ].map(p => path.resolve(p));
        isActive = allActivePaths.includes(path.resolve(flowPath));

        try {
          const parsed = loadFlow(flowPath);
          botType = String(parsed.botType || getFlowBotType(parsed));
          totalBlocks = Array.isArray(parsed.blocks) ? parsed.blocks.length : 0;
        } catch (err) {
          syntaxError = err.message || 'Erro de sintaxe';
        }

        return {
          fileName: file,
          flowPath,
          botType,
          totalBlocks,
          syntaxValid: !syntaxError,
          syntaxError,
          status: syntaxError ? 'error' : (isActive ? 'active' : 'inactive'),
        };
      });

      sendJson(res, 200, { bots });
    } catch (error) {
      sendJson(res, 500, { error: `Failed to list bots: ${String(error.message)}` });
    }
    return true;
  }

  if (pathname === '/api/settings' && req.method === 'GET') {
    const settings = await server.onGetSettings();
    sendJson(res, 200, settings || {});
    return true;
  }

  if (pathname === '/api/setup-state' && req.method === 'GET') {
    const state = await server.onGetSetupState();
    sendJson(res, 200, state || {});
    return true;
  }

  if (pathname === '/api/setup-state' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = await server.onApplySetupState(body || {});
    if (!result?.ok) {
      sendJson(res, 400, { error: result?.error || 'failed-to-apply-setup-state' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === '/api/setup/targets' && req.method === 'GET') {
    const quota = server.consumeRouteQuota(req, '/api/setup/targets');
    if (!quota.ok) {
      sendJson(res, 429, {
        error: 'rate-limit-exceeded',
        retryAfterMs: quota.retryAfterMs,
      });
      return true;
    }
    const search = String(requestUrl.searchParams.get('search') ?? '').trim();
    const limit = Math.max(1, Math.min(1000, toInt(requestUrl.searchParams.get('limit'), 300)));
    const result = await server.onListSetupTargets({ search, limit });
    sendJson(res, 200, result || { contacts: [], groups: [], socketReady: false, updatedAt: Date.now() });
    return true;
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = await server.onUpdateSettings({
      autoReloadFlows: body?.autoReloadFlows,
      broadcastSendIntervalMs: body?.broadcastSendIntervalMs,
      dashboardTelemetryLevel: body?.dashboardTelemetryLevel,
      dbMaintenanceEnabled: body?.dbMaintenanceEnabled,
      dbMaintenanceIntervalMinutes: body?.dbMaintenanceIntervalMinutes,
      dbRetentionDays: body?.dbRetentionDays,
      dbRetentionArchiveEnabled: body?.dbRetentionArchiveEnabled,
      dbEventBatchEnabled: body?.dbEventBatchEnabled,
      dbEventBatchFlushMs: body?.dbEventBatchFlushMs,
      dbEventBatchSize: body?.dbEventBatchSize,
    });
    if (!result?.ok) {
      sendJson(res, 400, { error: result?.error || 'failed-to-update-settings' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === '/api/settings/cache/clear' && req.method === 'POST') {
    const result = await server.onClearRuntimeCache();
    if (!result?.ok) {
      sendJson(res, 500, { error: result?.error || 'failed-to-clear-cache' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === '/api/settings/db' && req.method === 'GET') {
    const info = await server.onGetDbInfo();
    sendJson(res, 200, info || {});
    return true;
  }

  if (pathname === '/api/settings/db/maintenance' && req.method === 'GET') {
    const info = await server.onGetDbMaintenance();
    if (!info?.ok) {
      sendJson(res, 500, { error: info?.error || 'failed-to-fetch-db-maintenance' });
      return true;
    }
    sendJson(res, 200, info);
    return true;
  }

  if (pathname === '/api/settings/db/maintenance' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = await server.onUpdateDbMaintenance({
      dbMaintenanceEnabled: body?.dbMaintenanceEnabled,
      dbMaintenanceIntervalMinutes: body?.dbMaintenanceIntervalMinutes,
      dbRetentionDays: body?.dbRetentionDays,
      dbRetentionArchiveEnabled: body?.dbRetentionArchiveEnabled,
      dbEventBatchEnabled: body?.dbEventBatchEnabled,
      dbEventBatchFlushMs: body?.dbEventBatchFlushMs,
      dbEventBatchSize: body?.dbEventBatchSize,
    });
    if (!result?.ok) {
      sendJson(res, 400, { error: result?.error || 'failed-to-update-db-maintenance' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === '/api/settings/db/maintenance/run' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = await server.onRunDbMaintenance({
      force: body?.force !== false,
    });
    if (!result?.ok) {
      sendJson(res, 500, { error: result?.error || 'failed-to-run-db-maintenance', result });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === '/api/surveys' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = await server.onCreateSurvey(body || {});
    if (!result?.ok) {
      sendJson(res, 400, { ok: false, error: result?.error || 'failed-to-create-survey' });
      return true;
    }
    sendJson(res, 201, result);
    return true;
  }

  if (pathname === '/api/surveys' && req.method === 'GET') {
    const activeOnly = requestUrl.searchParams.get('activeOnly') === '1';
    const items = await server.onListSurveyTypes({ activeOnly });
    sendJson(res, 200, { ok: true, data: Array.isArray(items) ? items : [] });
    return true;
  }

  if (pathname.startsWith('/api/surveys/') && pathname.endsWith('/broadcast') && req.method === 'POST') {
    const typeId = decodePathComponent(pathname.slice('/api/surveys/'.length, -'/broadcast'.length));
    const body = await readJsonBody(req);
    const selectedJids = Array.isArray(body?.jids) ? body.jids : [];
    const result = await server.onBroadcastSurvey({
      typeId,
      selectedJids,
      actor: normalizeActor(body?.agentId),
    });
    if (!result?.ok) {
      sendJson(res, 400, { ok: false, error: result?.error || 'survey-broadcast-failed' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname.startsWith('/api/surveys/') && pathname.endsWith('/duplicate') && req.method === 'POST') {
    const typeId = decodePathComponent(pathname.slice('/api/surveys/'.length, -'/duplicate'.length));
    const result = await server.onDuplicateSurvey({ typeId });
    if (!result?.ok) {
      sendJson(res, 400, { ok: false, error: result?.error || 'failed-to-duplicate-survey' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname.startsWith('/api/surveys/') && pathname.endsWith('/activate') && req.method === 'POST') {
    const typeId = decodePathComponent(pathname.slice('/api/surveys/'.length, -'/activate'.length));
    const result = await server.onSetSurveyStatus({ typeId, status: 'active' });
    if (!result?.ok) {
      sendJson(res, 400, { ok: false, error: result?.error || 'failed-to-activate-survey' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname.startsWith('/api/surveys/') && pathname.endsWith('/deactivate') && req.method === 'POST') {
    const typeId = decodePathComponent(pathname.slice('/api/surveys/'.length, -'/deactivate'.length));
    const result = await server.onSetSurveyStatus({ typeId, status: 'inactive' });
    if (!result?.ok) {
      sendJson(res, 400, { ok: false, error: result?.error || 'failed-to-deactivate-survey' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname.startsWith('/api/surveys/') && pathname.endsWith('/frequency') && req.method === 'GET') {
    const typeId = decodePathComponent(pathname.slice('/api/surveys/'.length, -'/frequency'.length));
    const result = await server.onGetSurveyFrequency({ typeId });
    if (!result?.ok) {
      sendJson(res, 400, { ok: false, error: result?.error || 'failed-to-get-frequency' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname.startsWith('/api/surveys/') && pathname.endsWith('/frequency') && req.method === 'PUT') {
    const typeId = decodePathComponent(pathname.slice('/api/surveys/'.length, -'/frequency'.length));
    const body = await readJsonBody(req);
    const result = await server.onUpdateSurveyFrequency({ typeId, frequency: body || {} });
    if (!result?.ok) {
      sendJson(res, 400, { ok: false, error: result?.error || 'failed-to-update-frequency' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname.startsWith('/api/surveys/') && req.method === 'PUT') {
    const typeId = decodePathComponent(pathname.slice('/api/surveys/'.length));
    const body = await readJsonBody(req);
    const result = await server.onUpdateSurvey({ typeId, ...(body || {}) });
    if (!result?.ok) {
      sendJson(res, 400, { ok: false, error: result?.error || 'failed-to-update-survey' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname.startsWith('/api/surveys/') && req.method === 'DELETE') {
    const typeId = decodePathComponent(pathname.slice('/api/surveys/'.length));
    const result = await server.onSetSurveyStatus({ typeId, status: 'inactive' });
    if (!result?.ok) {
      sendJson(res, 400, { ok: false, error: result?.error || 'failed-to-delete-survey' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname.startsWith('/api/bots/') && pathname.endsWith('/available-surveys') && req.method === 'GET') {
    const data = await server.onListAvailableSurveysForBot({});
    sendJson(res, 200, { ok: true, data: Array.isArray(data) ? data : [] });
    return true;
  }

  if (pathname.startsWith('/api/bots/') && pathname.endsWith('/link-survey') && req.method === 'POST') {
    const botId = decodePathComponent(pathname.slice('/api/bots/'.length, -'/link-survey'.length));
    const body = await readJsonBody(req);
    const result = await server.onLinkSurveyToBot({ botId, surveyConfig: body?.surveyConfig || body || {} });
    if (!result?.ok) {
      sendJson(res, 400, { ok: false, error: result?.error || 'failed-to-link-survey' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname.startsWith('/api/bots/') && pathname.endsWith('/unlink-survey') && req.method === 'DELETE') {
    const botId = decodePathComponent(pathname.slice('/api/bots/'.length, -'/unlink-survey'.length));
    const result = await server.onUnlinkSurveyFromBot({ botId });
    if (!result?.ok) {
      sendJson(res, 400, { ok: false, error: result?.error || 'failed-to-unlink-survey' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === '/api/surveys/types' && req.method === 'GET') {
    const quota = server.consumeRouteQuota(req, '/api/surveys/types');
    if (!quota.ok) {
      sendJson(res, 429, { ok: false, error: 'rate-limit-exceeded', retryAfterMs: quota.retryAfterMs });
      return true;
    }
    const activeOnly = requestUrl.searchParams.get('activeOnly') !== '0';
    const types = await server.onListSurveyTypes({ activeOnly });
    sendJson(res, 200, { ok: true, data: Array.isArray(types) ? types : [] });
    return true;
  }

  if (pathname.startsWith('/api/surveys/types/') && req.method === 'GET') {
    const typeId = decodePathComponent(pathname.slice('/api/surveys/types/'.length));
    if (!typeId) {
      sendJson(res, 400, { ok: false, error: 'typeId is required' });
      return true;
    }
    const result = await server.onGetSurveyType({ typeId });
    if (!result?.ok) {
      sendJson(res, 404, { ok: false, error: result?.error || 'survey type not found' });
      return true;
    }
    sendJson(res, 200, { ok: true, data: result.data || null });
    return true;
  }

  if (pathname === '/api/surveys/instances' && req.method === 'GET') {
    const quota = server.consumeRouteQuota(req, '/api/surveys/instances');
    if (!quota.ok) {
      sendJson(res, 429, { ok: false, error: 'rate-limit-exceeded', retryAfterMs: quota.retryAfterMs });
      return true;
    }
    const result = await server.onListSurveyInstances(parseSurveyFilters());
    sendJson(res, 200, {
      ok: true,
      data: result || { total: 0, items: [], limit: 200, offset: 0 },
    });
    return true;
  }

  if (pathname.startsWith('/api/surveys/instances/') && req.method === 'GET') {
    const instanceId = decodePathComponent(pathname.slice('/api/surveys/instances/'.length));
    if (!instanceId) {
      sendJson(res, 400, { ok: false, error: 'instanceId is required' });
      return true;
    }
    const result = await server.onGetSurveyInstance({ instanceId });
    if (!result?.ok) {
      sendJson(res, 404, { ok: false, error: result?.error || 'survey instance not found' });
      return true;
    }
    sendJson(res, 200, { ok: true, data: result.data || null });
    return true;
  }

  if (pathname === '/api/surveys/metrics/overview' && req.method === 'GET') {
    const quota = server.consumeRouteQuota(req, '/api/surveys/metrics/overview');
    if (!quota.ok) {
      sendJson(res, 429, { ok: false, error: 'rate-limit-exceeded', retryAfterMs: quota.retryAfterMs });
      return true;
    }
    const result = await server.onGetSurveyMetricsOverview(parseSurveyFilters());
    sendJson(res, 200, { ok: true, data: result || {} });
    return true;
  }

  if (pathname === '/api/surveys/metrics/trend' && req.method === 'GET') {
    const quota = server.consumeRouteQuota(req, '/api/surveys/metrics/trend');
    if (!quota.ok) {
      sendJson(res, 429, { ok: false, error: 'rate-limit-exceeded', retryAfterMs: quota.retryAfterMs });
      return true;
    }
    const result = await server.onGetSurveyMetricsTrend(parseSurveyFilters());
    sendJson(res, 200, { ok: true, data: Array.isArray(result) ? result : [] });
    return true;
  }

  if (pathname === '/api/surveys/metrics/distribution' && req.method === 'GET') {
    const quota = server.consumeRouteQuota(req, '/api/surveys/metrics/distribution');
    if (!quota.ok) {
      sendJson(res, 429, { ok: false, error: 'rate-limit-exceeded', retryAfterMs: quota.retryAfterMs });
      return true;
    }
    const result = await server.onGetSurveyMetricsDistribution(parseSurveyFilters());
    sendJson(res, 200, { ok: true, data: Array.isArray(result) ? result : [] });
    return true;
  }

  if (pathname === '/api/surveys/metrics/by-flow' && req.method === 'GET') {
    const quota = server.consumeRouteQuota(req, '/api/surveys/metrics/by-flow');
    if (!quota.ok) {
      sendJson(res, 429, { ok: false, error: 'rate-limit-exceeded', retryAfterMs: quota.retryAfterMs });
      return true;
    }
    const result = await server.onGetSurveyMetricsByFlow(parseSurveyFilters());
    sendJson(res, 200, { ok: true, data: Array.isArray(result) ? result : [] });
    return true;
  }

  if (pathname === '/api/surveys/export' && req.method === 'GET') {
    const quota = server.consumeRouteQuota(req, '/api/surveys/export');
    if (!quota.ok) {
      sendJson(res, 429, { ok: false, error: 'rate-limit-exceeded', retryAfterMs: quota.retryAfterMs });
      return true;
    }
    const filters = parseSurveyFilters();
    const format = String(requestUrl.searchParams.get('format') ?? 'json').trim().toLowerCase();
    const rows = await server.onExportSurveyResponses(filters);
    const safeRows = Array.isArray(rows) ? rows : [];

    if (format === 'csv') {
      const escapeCsv = value => {
        const raw = String(value ?? '');
        if (raw.includes(',') || raw.includes('\"') || raw.includes('\n')) {
          return `\"${raw.replace(/\"/g, '\"\"')}\"`;
        }
        return raw;
      };

      const headers = [
        'instanceId',
        'surveyTypeId',
        'flowPath',
        'blockId',
        'sessionId',
        'jid',
        'startedAt',
        'completedAt',
        'abandonedAt',
        'abandonmentReason',
        'responseId',
        'questionId',
        'questionType',
        'numericValue',
        'textValue',
        'choiceId',
        'choiceIds',
        'respondedAt',
      ];

      const csvRows = [headers.join(',')];
      for (const row of safeRows) {
        csvRows.push(headers.map(header => escapeCsv(row?.[header])).join(','));
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=\"surveys-export.csv\"');
      res.end(csvRows.join('\n'));
      return true;
    }

    sendJson(res, 200, { ok: true, data: safeRows });
    return true;
  }

  if (pathname === '/api/surveys/admin/cache/refresh' && req.method === 'POST') {
    const quota = server.consumeRouteQuota(req, '/api/surveys/admin/cache/refresh');
    if (!quota.ok) {
      sendJson(res, 429, { ok: false, error: 'rate-limit-exceeded', retryAfterMs: quota.retryAfterMs });
      return true;
    }
    const body = await readJsonBody(req);
    const result = await server.onRefreshSurveyMetricsCache({
      ...parseSurveyFilters(body || {}),
      force: true,
    });
    if (!result?.ok) {
      sendJson(res, 500, { ok: false, error: result?.error || 'failed-to-refresh-survey-cache' });
      return true;
    }
    sendJson(res, 200, { ok: true, data: result });
    return true;
  }

  if (pathname === '/api/sessions/overview' && req.method === 'GET') {
    const overview = await server.onGetSessionManagementOverview();
    sendJson(res, 200, overview || {});
    return true;
  }

  if (pathname === '/api/sessions/flows' && req.method === 'GET') {
    const flows = await server.onListSessionManagementFlows();
    sendJson(res, 200, { flows: Array.isArray(flows) ? flows : [] });
    return true;
  }

  if (pathname === '/api/sessions/active' && req.method === 'GET') {
    const search = String(requestUrl.searchParams.get('search') ?? '').trim();
    const limit = Math.max(1, Math.min(2000, toInt(requestUrl.searchParams.get('limit'), 200)));
    const sessions = await server.onListActiveSessionsForManagement({ search, limit });
    sendJson(res, 200, { sessions: Array.isArray(sessions) ? sessions : [] });
    return true;
  }

  if (pathname === '/api/sessions/clear-all' && req.method === 'POST') {
    const result = await server.onClearActiveSessionsAll();
    if (!result?.ok) {
      sendJson(res, 500, { error: result?.error || 'failed-to-clear-active-sessions' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === '/api/sessions/clear-flow' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const flowPath = String(body?.flowPath ?? '').trim();
    if (!flowPath) {
      sendJson(res, 400, { error: 'flowPath is required' });
      return true;
    }
    const result = await server.onClearActiveSessionsByFlow({ flowPath });
    if (!result?.ok) {
      sendJson(res, 500, { error: result?.error || 'failed-to-clear-flow-sessions' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === '/api/sessions/reset-jid' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const jid = String(body?.jid ?? '').trim();
    if (!jid) {
      sendJson(res, 400, { error: 'jid is required' });
      return true;
    }
    const result = await server.onResetSessionsByJid({ jid });
    if (!result?.ok) {
      sendJson(res, 500, { error: result?.error || 'failed-to-reset-session-by-jid' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === '/api/sessions/timeout' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const flowPath = String(body?.flowPath ?? '').trim();
    const sessionTimeoutMinutes = toInt(body?.sessionTimeoutMinutes, -1);
    if (!flowPath) {
      sendJson(res, 400, { error: 'flowPath is required' });
      return true;
    }
    if (sessionTimeoutMinutes < 0) {
      sendJson(res, 400, { error: 'sessionTimeoutMinutes must be >= 0' });
      return true;
    }
    const result = await server.onUpdateFlowSessionTimeout({
      flowPath,
      sessionTimeoutMinutes,
    });
    if (!result?.ok) {
      sendJson(res, 500, { error: result?.error || 'failed-to-update-flow-timeout' });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === '/api/broadcast/contacts') {
    const quota = server.consumeRouteQuota(req, '/api/broadcast/contacts');
    if (!quota.ok) {
      sendJson(res, 429, {
        error: 'rate-limit-exceeded',
        retryAfterMs: quota.retryAfterMs,
      });
      return true;
    }
    const limit = Math.max(
      1,
      Math.min(BROADCAST_LIMITS.CONTACT_LIST_MAX, toInt(requestUrl.searchParams.get('limit'), BROADCAST_LIMITS.CONTACT_SEARCH_MAX))
    );
    const search = String(requestUrl.searchParams.get('search') ?? '').trim();
    const contacts = await server.onBroadcastListContacts({ search, limit });
    sendJson(res, 200, { contacts: Array.isArray(contacts) ? contacts : [] });
    return true;
  }

  if (pathname === '/api/broadcast/send' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const actor = normalizeActor(body?.agentId);
    const target = String(body?.target ?? 'all').trim().toLowerCase();
    const selectedJids = Array.isArray(body?.jids) ? body.jids : [];
    const text = String(body?.text ?? '').trim();
    const declaredMimeType = String(body?.mimeType ?? '').trim();
    const imageDataUrl = String(body?.imageDataUrl ?? '').trim();
    const fileName = String(body?.fileName ?? '').trim();
    if (target !== 'all' && target !== 'selected') {
      sendJson(res, 400, { error: 'target must be all or selected' });
      return true;
    }

    const result = await server.onBroadcastSend({
      actor,
      target,
      selectedJids,
      message: {
        text,
        imageDataUrl: imageDataUrl || '',
        fileName,
        mimeType: declaredMimeType || '',
      },
    });

    if (!result?.ok) {
      sendJson(res, 500, { error: result?.error || 'failed-to-send-broadcast' });
      return true;
    }

    sendJson(res, 200, {
      ok: true,
      campaignId: result?.campaignId || 0,
      attempted: result?.attempted || 0,
      sent: result?.sent || 0,
      failed: result?.failed || 0,
      cancelled: result?.cancelled || 0,
      recipientCounts: result?.recipientCounts || null,
      failures: Array.isArray(result?.failures) ? result.failures : [],
      metrics: result?.metrics || null,
    });
    return true;
  }

  if (pathname === '/api/broadcast/status') {
    const quota = server.consumeRouteQuota(req, '/api/broadcast/status');
    if (!quota.ok) {
      sendJson(res, 429, {
        error: 'rate-limit-exceeded',
        retryAfterMs: quota.retryAfterMs,
      });
      return true;
    }
    const status = await server.onBroadcastStatus();
    sendJson(res, 200, {
      ok: true,
      active: Boolean(status?.active),
      campaign: status?.campaign || null,
    });
    return true;
  }

  if (pathname === '/api/broadcast/pause' && req.method === 'POST') {
    const result = await server.onBroadcastPause();
    if (!result?.ok) {
      sendJson(res, 409, { error: result?.error || 'failed-to-pause-broadcast', status: result?.status || null });
      return true;
    }
    sendJson(res, 200, { ok: true, status: result?.status || null });
    return true;
  }

  if (pathname === '/api/broadcast/resume' && req.method === 'POST') {
    const result = await server.onBroadcastResume();
    if (!result?.ok) {
      sendJson(res, 409, { error: result?.error || 'failed-to-resume-broadcast', status: result?.status || null });
      return true;
    }
    sendJson(res, 200, { ok: true, status: result?.status || null });
    return true;
  }

  if (pathname === '/api/broadcast/cancel' && req.method === 'POST') {
    const result = await server.onBroadcastCancel();
    if (!result?.ok) {
      sendJson(res, 409, { error: result?.error || 'failed-to-cancel-broadcast', status: result?.status || null });
      return true;
    }
    sendJson(res, 200, { ok: true, status: result?.status || null });
    return true;
  }

  if (pathname.startsWith('/api/handoff/media/')) {
    const mediaId = decodePathComponent(pathname.slice('/api/handoff/media/'.length));
    const safeId = path.basename(mediaId);
    const mediaPath = path.resolve(HANDOFF_MEDIA_DIR, safeId);
    if (!isPathInsideRoot(HANDOFF_MEDIA_DIR, mediaPath)) {
      sendText(res, 403, 'Forbidden');
      return true;
    }
    if (!fs.existsSync(mediaPath) || !fs.statSync(mediaPath).isFile()) {
      sendText(res, 404, 'Not found');
      return true;
    }

    const ext = path.extname(mediaPath).toLowerCase();
    const contentType = STATIC_MIME_TYPES[ext] || 'application/octet-stream';
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.end(fs.readFileSync(mediaPath));
    return true;
  }

  if (pathname === '/api/handoff/sessions') {
    const quota = server.consumeRouteQuota(req, '/api/handoff/sessions');
    if (!quota.ok) {
      sendJson(res, 429, {
        error: 'rate-limit-exceeded',
        retryAfterMs: quota.retryAfterMs,
      });
      return true;
    }
    const force = requestUrl.searchParams.get('refresh') === '1';
    const sessions = server.getCachedHandoffSessionsSnapshot({ force });
    sendJson(res, 200, { sessions });
    return true;
  }

  if (pathname === '/api/handoff/history') {
    const jid = String(requestUrl.searchParams.get('jid') ?? '').trim();
    const flowPathFilter = String(requestUrl.searchParams.get('flowPath') ?? '').trim();
    const limit = Math.max(1, Math.min(1000, toInt(requestUrl.searchParams.get('limit'), 200)));
    const since = toInt(requestUrl.searchParams.get('since'), 0);
    if (!jid) {
      sendJson(res, 400, { error: 'jid is required' });
      return true;
    }

    const activeSession = server.timedDbQuery(
      'getActiveSessions:handoff-history',
      () => getActiveSessions({ botType: 'conversation' })
    ).find(session => {
      if (session.jid !== jid) return false;
      if (flowPathFilter && String(session.flowPath) !== flowPathFilter) return false;
      return String(session.waitingFor || '').trim().toLowerCase() === 'human';
    });
    const sessionStartedAt = Number(activeSession?.variables?.[INTERNAL_VAR.SESSION_STARTED_AT]) || 0;
    const sessionFloorSince = sessionStartedAt > 0 ? Math.max(0, sessionStartedAt - 1) : 0;
    const effectiveSince = Math.max(since, sessionFloorSince);

    const logs = effectiveSince > 0
      ? server.timedDbQuery(
        'listConversationEventsSinceByJid',
        () => listConversationEventsSinceByJid(jid, effectiveSince, limit)
      )
      : server.timedDbQuery(
        'listConversationEventsByJid',
        () => listConversationEventsByJid(jid, limit)
      );
    sendJson(res, 200, { logs });
    return true;
  }

  if (pathname === '/api/handoff/send' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const jid = String(body?.jid ?? '').trim();
    const text = String(body?.text ?? '').trim();
    const actor = normalizeActor(body?.agentId);

    if (!jid || !text) {
      sendJson(res, 400, { error: 'jid and text are required' });
      return true;
    }

    const result = await server.onHumanSendMessage({ jid, text, actor });
    if (!result?.ok) {
      sendJson(res, 500, { error: result?.error || 'failed-to-send-human-message' });
      return true;
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/handoff/send-image' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const jid = String(body?.jid ?? '').trim();
    const actor = normalizeActor(body?.agentId);
    const caption = String(body?.caption ?? '').trim();
    const fileName = String(body?.fileName ?? '').trim();
    const declaredMimeType = String(body?.mimeType ?? '').trim();
    const imageDataUrl = String(body?.imageDataUrl ?? '').trim();

    if (!jid || !imageDataUrl) {
      sendJson(res, 400, { error: 'jid and imageDataUrl are required' });
      return true;
    }

    let parsedImage;
    try {
      parsedImage = parseDataUrlImage(imageDataUrl, declaredMimeType);
    } catch (error) {
      sendJson(res, 400, { error: String(error?.message || 'invalid-image') });
      return true;
    }

    const media = saveHandoffMedia({
      imageBuffer: parsedImage.buffer,
      mimeType: parsedImage.mimeType,
      fileName,
    });

    const result = await server.onHumanSendImage({
      jid,
      actor,
      caption,
      fileName: fileName || media.mediaId,
      imageBuffer: parsedImage.buffer,
      mimeType: parsedImage.mimeType,
      mediaId: media.mediaId,
      mediaPath: media.mediaPath,
      mediaUrl: media.mediaUrl,
    });

    if (!result?.ok) {
      sendJson(res, 500, { error: result?.error || 'failed-to-send-human-image' });
      return true;
    }

    sendJson(res, 200, {
      ok: true,
      mediaUrl: media.mediaUrl,
    });
    return true;
  }

  if (pathname === '/api/handoff/resume' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const jid = String(body?.jid ?? '').trim();
    const targetBlockId = String(body?.targetBlockId ?? '').trim();
    const actor = normalizeActor(body?.agentId);
    if (!jid) {
      sendJson(res, 400, { error: 'jid is required' });
      return true;
    }

    const flowBlocks = normalizeFlowBlocks(server.getFlowBlocks());
    const targetBlockIndex = resolveBlockIndex(body?.targetBlockIndex, targetBlockId, flowBlocks);
    if (targetBlockIndex < 0) {
      sendJson(res, 400, { error: 'invalid targetBlockId/targetBlockIndex' });
      return true;
    }

    const result = await server.onHumanResumeSession({
      jid,
      targetBlockIndex,
      targetBlockId: flowBlocks[targetBlockIndex]?.id || targetBlockId,
      actor,
    });

    if (!result?.ok) {
      sendJson(res, 500, { error: result?.error || 'failed-to-resume-session' });
      return true;
    }

    sendJson(res, 200, {
      ok: true,
      targetBlockIndex,
      targetBlockId: flowBlocks[targetBlockIndex]?.id || targetBlockId,
    });
    return true;
  }

  if (pathname === '/api/handoff/end' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const jid = String(body?.jid ?? '').trim();
    const actor = normalizeActor(body?.agentId);
    const reason = String(body?.reason ?? 'human-agent-ended').trim() || 'human-agent-ended';
    if (!jid) {
      sendJson(res, 400, { error: 'jid is required' });
      return true;
    }

    const result = await server.onHumanEndSession({ jid, reason, actor });
    if (!result?.ok) {
      sendJson(res, 500, { error: result?.error || 'failed-to-end-session' });
      return true;
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/export') {
    const logs = listConversationEvents(1000);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="analytics.csv"');
    let csv = 'id,occurred_at,event_type,direction,jid,message_text\n';
    for (const log of logs) {
      const text = (log.messageText || '').replace(/"/g, '""');
      csv += `${log.id},${log.occurredAt},${log.eventType},${log.direction},${log.jid},"${text}"\n`;
    }
    res.end(csv);
    return true;
  }

  if (pathname === '/api/stats') {
    const quota = server.consumeRouteQuota(req, '/api/stats');
    if (!quota.ok) {
      sendJson(res, 429, {
        error: 'rate-limit-exceeded',
        retryAfterMs: quota.retryAfterMs,
      });
      return true;
    }
    const runtimeInfo = server.getRuntimeInfo();
    const mode = normalizeModeParam(requestUrl.searchParams.get('mode') || runtimeInfo.mode || 'conversation');
    const force = requestUrl.searchParams.get('refresh') === '1';
    const stats = server.getCachedStatsSnapshot({ runtimeInfo, mode, force });
    sendJson(res, 200, stats);
    return true;
  }

  if (pathname === '/api/logs') {
    const quota = server.consumeRouteQuota(req, '/api/logs');
    if (!quota.ok) {
      sendJson(res, 429, {
        error: 'rate-limit-exceeded',
        retryAfterMs: quota.retryAfterMs,
      });
      return true;
    }
    const runtimeInfo = server.getRuntimeInfo();
    const mode = normalizeModeParam(requestUrl.searchParams.get('mode') || runtimeInfo.mode || 'conversation');
    const limit = Math.max(1, Math.min(500, toInt(requestUrl.searchParams.get('limit'), 150)));
    const since = toInt(requestUrl.searchParams.get('since'), 0);
    const logs = server.timedDbQuery(
      'listModeEvents:logs',
      () => listModeEvents({
        runtimeInfo,
        mode,
        since,
        limit,
      })
    );
    sendJson(res, 200, { logs });
    return true;
  }

  return false;
}
