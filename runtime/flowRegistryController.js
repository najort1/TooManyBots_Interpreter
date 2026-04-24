import path from 'path';

export function createFlowRegistryController({
  getCurrentFlowRegistry,
  getConfig,
  loadFlows,
  runtimeModeDevelopment,
} = {}) {
  function isDevelopmentMode(currentConfig) {
    const mode = String(currentConfig?.runtimeMode ?? '').toLowerCase();
    // Hot-reload deve funcionar em qualquer modo nao-producao.
    // No setup atual, "restricted-test" e tratado como ambiente iterativo.
    if (!mode) return false;
    return mode !== 'production';
  }

  function getActiveFlows() {
    const currentFlowRegistry = getCurrentFlowRegistry();
    return Array.isArray(currentFlowRegistry?.all) ? currentFlowRegistry.all : [];
  }

  function getConversationFlow() {
    const currentFlowRegistry = getCurrentFlowRegistry();
    return currentFlowRegistry?.conversationFlow ?? null;
  }

  function getCommandFlows() {
    const currentFlowRegistry = getCurrentFlowRegistry();
    return Array.isArray(currentFlowRegistry?.commandFlows) ? currentFlowRegistry.commandFlows : [];
  }

  function getDashboardFlow() {
    const conversationFlow = getConversationFlow();
    if (conversationFlow) return conversationFlow;
    return getActiveFlows()[0] ?? null;
  }

  function currentPrimaryFlowPathForLogs() {
    const config = getConfig();
    return getDashboardFlow()?.flowPath ?? String(config?.flowPath ?? '');
  }

  function resolveConfiguredFlowPaths(currentConfig) {
    const selectedPaths = Array.isArray(currentConfig?.flowPaths) ? currentConfig.flowPaths : [];
    const fallback = String(currentConfig?.flowPath ?? '').trim();
    const unique = new Set();
    const result = [];

    for (const item of selectedPaths) {
      const value = String(item ?? '').trim();
      if (!value || unique.has(value)) continue;
      unique.add(value);
      result.push(value);
    }

    if (!result.length && fallback) {
      result.push(fallback);
    }

    return result;
  }

  function loadFlowRegistryFromConfig(currentConfig) {
    const flowPaths = resolveConfiguredFlowPaths(currentConfig);
    const registry = loadFlows(flowPaths);
    const surveyConfigsByFlowPath =
      currentConfig?.surveyConfigsByFlowPath && typeof currentConfig.surveyConfigsByFlowPath === 'object'
        ? currentConfig.surveyConfigsByFlowPath
        : {};

    for (const flow of registry.all) {
      const candidates = [
        flow.flowPath,
        path.resolve(flow.flowPath || ''),
        path.relative(process.cwd(), flow.flowPath || ''),
        `./${path.relative(process.cwd(), flow.flowPath || '').replace(/\\/g, '/')}`,
      ].map(item => String(item || '').trim()).filter(Boolean);
      const surveyConfigKey = candidates.find(candidate => surveyConfigsByFlowPath[candidate]);
      if (surveyConfigKey) {
        flow.surveyConfig = surveyConfigsByFlowPath[surveyConfigKey];
      }
    }

    return registry;
  }

  return {
    isDevelopmentMode,
    getActiveFlows,
    getConversationFlow,
    getCommandFlows,
    getDashboardFlow,
    currentPrimaryFlowPathForLogs,
    resolveConfiguredFlowPaths,
    loadFlowRegistryFromConfig,
  };
}
