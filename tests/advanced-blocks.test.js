import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { initDb } from '../db/index.js';
import {
  handleListOperations,
  handleStringFunctions,
} from '../handlers/integrationHandlers.js';

await initDb();

function createCtx(config, variables = {}) {
  const sentMessages = [];
  const sock = {
    sendMessage: async (_jid, payload) => {
      sentMessages.push(payload);
      return { ok: true };
    },
  };

  return {
    sentMessages,
    payload: {
      block: { id: 'block-1', type: 'test-block', config },
      session: {
        jid: 'test@s.whatsapp.net',
        blockIndex: 0,
        variables: { ...variables },
        status: 'active',
      },
      sock,
      jid: 'test@s.whatsapp.net',
      flow: { flowPath: '/tmp/test-flow.tmb' },
      runtime: {},
    },
  };
}

test('string-functions supports core deterministic operations', async () => {
  const sharedVars = {
    needle: 'ana',
    phrase: 'banana nana',
  };

  const deterministicCases = [
    { operation: 'Constant', inputValue: 'abc', expected: 'abc' },
    { operation: 'Base64Encode', inputValue: 'abc', expected: 'YWJj' },
    { operation: 'Base64Decode', inputValue: 'YWJj', expected: 'abc' },
    { operation: 'Hash', inputValue: 'abc', hashAlgorithm: 'SHA256', expected: crypto.createHash('sha256').update('abc').digest('hex') },
    { operation: 'HMAC', inputValue: 'abc', hashAlgorithm: 'SHA256', hmacKey: 'secret', expected: crypto.createHmac('sha256', 'secret').update('abc').digest('hex') },
    { operation: 'Translate', inputValue: 'ola', translationDictionary: '{"ola":"hello"}', expected: 'hello' },
    { operation: 'UnixTimeToISO8601', inputValue: '0', unixInputUnit: 'milliseconds', expected: '1970-01-01T00:00:00.000Z' },
    { operation: 'Length', inputValue: 'abcd', expected: 4 },
    { operation: 'ToLowercase', inputValue: 'AbC', expected: 'abc' },
    { operation: 'ToUppercase', inputValue: 'AbC', expected: 'ABC' },
    { operation: 'Replace', inputValue: 'hello world', replaceSearch: 'world', replaceValue: 'there', expected: 'hello there' },
    { operation: 'RegexMatch', inputValue: 'pedido #123', regexPattern: '#\\d+', expected: '#123' },
    { operation: 'URLEncode', inputValue: 'a b', expected: 'a%20b' },
    { operation: 'URLDecode', inputValue: 'a%20b', expected: 'a b' },
    { operation: 'Unescape', inputValue: '\\nabc', expected: '\nabc' },
    { operation: 'HTMLEntityEncode', inputValue: '<b>&</b>', expected: '&lt;b&gt;&amp;&lt;/b&gt;' },
    { operation: 'HTMLEntityDecode', inputValue: '&lt;b&gt;&amp;&lt;/b&gt;', expected: '<b>&</b>' },
    { operation: 'Ceil', inputValue: '1.2', expected: 2 },
    { operation: 'Floor', inputValue: '1.8', expected: 1 },
    { operation: 'Round', inputValue: '1.6', expected: 2 },
    { operation: 'Compute', inputValue: '3', computeExpression: '3 + 2', expected: 5 },
    { operation: 'CountOccurrences', inputValue: '{{$phrase}}', countNeedle: '{{$needle}}', countCaseSensitive: false, expected: 2 },
    { operation: 'CharAt', inputValue: 'abc', charIndex: 1, expected: 'b' },
    { operation: 'Substring', inputValue: 'abcdef', substringStart: 2, substringLength: 3, expected: 'cde' },
    { operation: 'ReverseString', inputValue: 'abc', expected: 'cba' },
    { operation: 'Trim', inputValue: '  abc  ', expected: 'abc' },
  ];

  for (const item of deterministicCases) {
    const { payload } = createCtx({
      outputVariable: 'out',
      onError: 'stop',
      ...item,
    }, sharedVars);

    const result = await handleStringFunctions(payload);
    assert.equal(result.done, false, `operation ${item.operation} should continue`);
    assert.equal(result.nextBlockIndex, 1, `operation ${item.operation} should advance`);
    assert.deepEqual(result.sessionPatch.variables.out, item.expected, `operation ${item.operation} returned unexpected value`);
  }
});

test('string-functions supports random, date and delay operations', async () => {
  const nowBefore = Date.now();

  const randomNumberCtx = createCtx({
    operation: 'RandomNum',
    randomMin: 5,
    randomMax: 10,
    outputVariable: 'out',
  });
  const randomNumberResult = await handleStringFunctions(randomNumberCtx.payload);
  assert.equal(randomNumberResult.done, false);
  assert.ok(randomNumberResult.sessionPatch.variables.out >= 5 && randomNumberResult.sessionPatch.variables.out <= 10);

  const randomStringCtx = createCtx({
    operation: 'RandomString',
    randomMask: '?A?A?0?0',
    outputVariable: 'out',
  });
  const randomStringResult = await handleStringFunctions(randomStringCtx.payload);
  assert.equal(randomStringResult.done, false);
  assert.match(String(randomStringResult.sessionPatch.variables.out), /^[A-Z]{2}[0-9]{2}$/);

  const currentUnixCtx = createCtx({
    operation: 'CurrentUnixTime',
    unixOutputUnit: 'milliseconds',
    outputVariable: 'out',
  });
  const currentUnixResult = await handleStringFunctions(currentUnixCtx.payload);
  assert.equal(currentUnixResult.done, false);
  assert.ok(Number(currentUnixResult.sessionPatch.variables.out) >= nowBefore);

  const dateToUnixCtx = createCtx({
    operation: 'DateToUnixTime',
    inputValue: '2024-01-02',
    dateFormat: 'YYYY-MM-DD',
    unixOutputUnit: 'milliseconds',
    outputVariable: 'out',
  });
  const dateToUnixResult = await handleStringFunctions(dateToUnixCtx.payload);
  assert.equal(dateToUnixResult.done, false);
  assert.ok(Number.isFinite(Number(dateToUnixResult.sessionPatch.variables.out)));

  const unixToDateCtx = createCtx({
    operation: 'UnixTimeToDate',
    inputValue: '0',
    unixInputUnit: 'milliseconds',
    dateFormat: 'YYYY-MM-DD',
    outputVariable: 'out',
  });
  const unixToDateResult = await handleStringFunctions(unixToDateCtx.payload);
  assert.equal(unixToDateResult.done, false);
  assert.match(String(unixToDateResult.sessionPatch.variables.out), /^\d{4}-\d{2}-\d{2}$/);

  const delayCtx = createCtx({
    operation: 'Delay',
    inputValue: 'ok',
    delayMs: 2,
    outputVariable: 'out',
  });
  const delayResult = await handleStringFunctions(delayCtx.payload);
  assert.equal(delayResult.done, false);
  assert.equal(delayResult.sessionPatch.variables.out, 'ok');
});

test('list-operations supports all documented actions', async () => {
  const vars = {
    listA: [3, 1, 2, 2],
    listB: ['a', 'b', 'c', 'd'],
    listText: 'x|y|z',
  };

  const run = async (cfg) => {
    const { payload } = createCtx({ outputVariable: 'out', onError: 'stop', ...cfg }, vars);
    const result = await handleListOperations(payload);
    assert.equal(result.done, false, `action ${cfg.action} should continue`);
    assert.equal(result.nextBlockIndex, 1, `action ${cfg.action} should advance`);
    return result.sessionPatch.variables.out;
  };

  assert.deepEqual(await run({ action: 'Create', inputValue: 'a,b,c', listSeparator: ',' }), ['a', 'b', 'c']);
  assert.equal(await run({ action: 'Length', sourceVariable: 'listA' }), 4);
  assert.equal(await run({ action: 'Join', sourceVariable: 'listB', joinSeparator: '-' }), 'a-b-c-d');
  assert.deepEqual(await run({ action: 'Sort', sourceVariable: 'listA', sortOrder: 'asc', sortMode: 'numeric' }), [1, 2, 2, 3]);
  assert.deepEqual(await run({ action: 'Concat', sourceVariable: 'listA', secondSourceVariable: 'listB' }), [3, 1, 2, 2, 'a', 'b', 'c', 'd']);
  assert.deepEqual(await run({ action: 'Zip', sourceVariable: 'listA', secondSourceVariable: 'listB', zipJoiner: ':' }), ['3:a', '1:b', '2:c', '2:d']);
  assert.deepEqual(await run({ action: 'Map', sourceVariable: 'listB', secondSourceVariable: 'listA' }), { a: 3, b: 1, c: 2, d: 2 });
  assert.deepEqual(await run({ action: 'Add', sourceVariable: 'listA', addValue: '9', addIndex: 1 }), [3, '9', 1, 2, 2]);
  assert.deepEqual(await run({ action: 'Remove', sourceVariable: 'listA', removeIndex: 1 }), [3, 2, 2]);
  assert.deepEqual(await run({ action: 'RemoveValues', sourceVariable: 'listB', removeCondition: 'Contains', removeConditionValue: 'a' }), ['b', 'c', 'd']);
  assert.deepEqual(await run({ action: 'RemoveDuplicates', sourceVariable: 'listA' }), [3, 1, 2]);
  assert.ok([3, 1, 2].includes(await run({ action: 'Random', sourceVariable: 'listA' })));

  const shuffled = await run({ action: 'Shuffle', sourceVariable: 'listA' });
  assert.equal(Array.isArray(shuffled), true);
  assert.equal(shuffled.length, 4);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), [1, 2, 2, 3]);

  assert.deepEqual(await run({ action: 'Create', sourceVariable: 'listText', listSeparator: '|' }), ['x', 'y', 'z']);
});

test('string-functions and list-operations respect onError stop/continue', async () => {
  const stringCtx = createCtx({
    operation: 'UnknownOperation',
    outputVariable: 'out',
    onError: 'stop',
    errorMessage: 'erro string',
  });

  const stringResult = await handleStringFunctions(stringCtx.payload);
  assert.equal(stringResult.done, true);
  assert.equal(stringResult.sessionPatch.status, 'ended');
  assert.equal(stringCtx.sentMessages.length, 1);
  assert.equal(stringCtx.sentMessages[0].text, 'erro string');

  const listCtx = createCtx({
    action: 'UnknownAction',
    outputVariable: 'out',
    onError: 'continue',
    errorMessage: 'erro lista',
  });

  const listResult = await handleListOperations(listCtx.payload);
  assert.equal(listResult.done, false);
  assert.equal(listResult.nextBlockIndex, 1);
  assert.equal(listCtx.sentMessages.length, 1);
  assert.equal(listCtx.sentMessages[0].text, 'erro lista');
});
