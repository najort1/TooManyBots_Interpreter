import fs from 'fs';
import os from 'os';
import path from 'path';

const runToken = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const testDataDir = path.join(os.tmpdir(), 'tmb-interpreter-tests', runToken);

process.env.TMB_DATA_DIR = testDataDir;
// evita chamadas reais Zen/Ollama nos testes (flavor usa template ou mocks)
process.env.FUN_DISABLE_LIVE_LLM = process.env.FUN_DISABLE_LIVE_LLM || '1';
fs.mkdirSync(testDataDir, { recursive: true });
