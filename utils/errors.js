export function stringifyError(error) {
  if (!error) return '';

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function safeErrorMessage(error, fallback = 'Unknown error') {
  const message = stringifyError(error);
  return message || String(fallback ?? 'Unknown error');
}
