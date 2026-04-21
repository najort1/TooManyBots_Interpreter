import { dispatchDashboardApiRoute } from './apiRouter.js';

export async function handleDashboardApiRequest({ server, req, res, requestUrl, helpers, context }) {
  return dispatchDashboardApiRoute({
    server,
    req,
    res,
    requestUrl,
    helpers,
    context,
  });
}
