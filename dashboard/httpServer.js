import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

import { handleDashboardApiRequest } from './apiController.js';
import { sendJson, sendText, tryServePublicAsset } from './staticFileHandler.js';

function serveDashboardIndex({ res, publicDir }) {
  const indexPath = path.join(publicDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    sendText(res, 503, 'Dashboard frontend build not found. Run: npm --prefix tmb_dashboard run build');
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(indexPath));
}

function canServeSpaFallback(req, pathname) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (pathname.startsWith('/api/') || pathname === '/api') return false;
  if (pathname.startsWith('/ws')) return false;
  return true;
}

export function createDashboardHttpServer({
  server,
  publicDir,
  handoffMediaDir,
  staticMimeTypes,
  helpers,
  context,
}) {
  return http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const requestStartedAt = Date.now();
      const requestPath = requestUrl.pathname;
      res.once('finish', () => {
        server.recordHttpRoute(requestPath, Date.now() - requestStartedAt, { statusCode: res.statusCode || 0 });
      });

      if (requestUrl.pathname === '/') {
        serveDashboardIndex({ res, publicDir });
        return;
      }

      if (tryServePublicAsset({
        pathname: requestUrl.pathname,
        res,
        publicDir,
        staticMimeTypes,
        fsModule: fs,
        pathModule: path,
      })) {
        return;
      }

      const apiHandled = await handleDashboardApiRequest({
        server,
        req,
        res,
        requestUrl,
        helpers,
        context: {
          ...context,
          HANDOFF_MEDIA_DIR: handoffMediaDir,
          STATIC_MIME_TYPES: staticMimeTypes,
        },
      });
      if (apiHandled) {
        return;
      }

      if (canServeSpaFallback(req, requestUrl.pathname)) {
        serveDashboardIndex({ res, publicDir });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      server.logger?.error?.(
        {
          err: {
            name: error?.name || 'Error',
            message: error?.message || 'Internal server error',
            stack: error?.stack || '',
          },
          method: req?.method || 'GET',
          url: req?.url || '',
        },
        'Dashboard HTTP request failed'
      );
      if (!res.headersSent) {
        sendJson(res, 500, { error: error?.message || 'Internal server error' });
      } else {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
    }
  });
}
