export function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function sendText(res, statusCode, text) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}

export function decodePathComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isPathInsideRoot(rootPath, candidatePath, pathModule) {
  const relative = pathModule.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !pathModule.isAbsolute(relative));
}

export function tryServePublicAsset({ pathname, res, publicDir, staticMimeTypes, fsModule, pathModule }) {
  if (!pathname.startsWith('/assets/')) return false;

  const decodedPath = decodePathComponent(pathname);
  const absolutePath = pathModule.resolve(publicDir, `.${decodedPath}`);
  if (!isPathInsideRoot(publicDir, absolutePath, pathModule)) {
    sendText(res, 403, 'Forbidden');
    return true;
  }

  if (!fsModule.existsSync(absolutePath) || !fsModule.statSync(absolutePath).isFile()) {
    sendText(res, 404, 'Not found');
    return true;
  }

  const ext = pathModule.extname(absolutePath).toLowerCase();
  const contentType = staticMimeTypes[ext] || 'application/octet-stream';
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.end(fsModule.readFileSync(absolutePath));
  return true;
}

export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  const rawBody = Buffer.concat(chunks).toString('utf-8').trim();
  if (!rawBody) return {};

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error('Invalid JSON body');
  }
}
