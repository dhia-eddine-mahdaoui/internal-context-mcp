import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ContextIndex } from '../src/index.js';
import { loadQuestions, runEval } from '../src/eval.js';
import { NOW, repoRoot } from './helpers.js';

test('retrieval quality on the labelled question set (hit@k) and zero permission leaks', () => {
  const index = new ContextIndex(join(repoRoot, 'kb'));
  index.reindex();
  const report = runEval(index, loadQuestions(join(repoRoot, 'eval', 'questions.json')), NOW);
  console.log(JSON.stringify({ questions: report.questions, modes: report.modes, leaks: report.leaks }, null, 2));
  assert.ok(report.questions >= 25);
  assert.equal(report.leaks, 0);
  assert.ok(report.modes.hybrid['hit@3'] >= 0.9, `hybrid hit@3 was ${report.modes.hybrid['hit@3']}`);
  assert.ok(report.modes.hybrid['hit@5'] >= 0.95, `hybrid hit@5 was ${report.modes.hybrid['hit@5']}`);
  assert.ok(report.modes.hybrid.mrr >= report.modes.bm25.mrr - 0.02, 'hybrid should not be worse than BM25 alone');
});
