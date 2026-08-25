import * as assert from 'assert/strict';
import * as M from '../motions';
import * as T from '../textobjects';
import { buildWhichKeyItems } from '../extension';

suite('motions', () => {
	const doc = 'foo bar.baz\n  qux';
	// offsets: f0 o1 o2 sp3 b4 a5 r6 .7 b8 a9 z10 \n11 sp12 sp13 q14 u15 x16

	test('nextWordStart (small word)', () => {
		assert.equal(M.nextWordStart(doc, 0, false), 4);
		assert.equal(M.nextWordStart(doc, 4, false), 7); // bar -> . (punct is its own word)
		assert.equal(M.nextWordStart(doc, 7, false), 8); // . -> baz
	});

	test('nextWordStart (big word joins punctuation)', () => {
		assert.equal(M.nextWordStart(doc, 4, true), 14); // bar.baz is one WORD -> qux
	});

	test('prevWordStart', () => {
		assert.equal(M.prevWordStart(doc, 8, false), 7); // baz -> .
		assert.equal(M.prevWordStart(doc, 7, false), 4); // . -> bar
		assert.equal(M.prevWordStart(doc, 14, false), 8); // qux -> baz
	});

	test('nextWordEnd', () => {
		assert.equal(M.nextWordEnd(doc, 0, false), 2); // foo end
		assert.equal(M.nextWordEnd(doc, 4, true), 10); // bar.baz end (big word)
	});

	test('matchBracket', () => {
		assert.equal(M.matchBracket('(a(b)c)', 0), 6);
		assert.equal(M.matchBracket('(a(b)c)', 2), 4);
		assert.equal(M.matchBracket('(a(b)c)', 6), 0);
		assert.equal(M.matchBracket('abc', 0), -1);
	});

	test('line helpers', () => {
		assert.equal(M.firstNonWsOnLine(doc, 12), 14);
		assert.equal(M.lineStart(doc, 14), 12);
		assert.equal(M.lineEnd(doc, 0), 11); // newline offset
	});

	suite('text objects', () => {
		const doc = 'foo (bar baz) "hi there"';
		const eq = (r: T.Range | null, a: number, b: number) => r !== null && r[0] === a && r[1] === b;
		test('word inner/around', () => {
			assert.ok(eq(T.textObjectRange(doc, 5, 'w', false), 5, 8));
			assert.ok(eq(T.textObjectRange(doc, 5, 'w', true), 5, 9));
		});
		test('bracket inner/around', () => {
			assert.ok(eq(T.textObjectRange(doc, 4, '(', false), 5, 12));
			assert.ok(eq(T.textObjectRange(doc, 4, '(', true), 4, 13));
		});
		test('quote inner/around', () => {
			assert.ok(eq(T.textObjectRange(doc, 15, '"', false), 15, 23));
			assert.ok(eq(T.textObjectRange(doc, 15, '"', true), 14, 24));
		});
		test('surroundPair', () => {
			assert.deepEqual(T.surroundPair(')'), ['(', ')']);
			assert.deepEqual(T.surroundPair('"'), ['"', '"']);
			assert.equal(T.surroundPair('x'), null);
		});
	});
});

suite('which-key popup', () => {
	test('g prefix lists gd/ge/gg/gn/gp/gr/gh with descriptions', () => {
		const items = buildWhichKeyItems({
			gg: 'goto_start', ge: 'goto_end', gd: 'goto_definition',
			gn: 'next_editor', gp: 'prev_editor', x: 'delete',
		}, 'g');
		const labels = items.map(i => i.label).sort();
		assert.deepEqual(labels, ['d', 'e', 'g', 'n', 'p'].sort());
		const gg = items.find(i => i.token === 'g');
		assert.equal(gg?.description, 'go to file start');
		const ge = items.find(i => i.token === 'e');
		assert.equal(ge?.description, 'go to file end');
	});

	test('space prefix lists the leader keys', () => {
		const items = buildWhichKeyItems({
			'<space>f': 'leader_file', '<space>b': 'leader_buffer', '<space><space>': 'leader_search',
		}, '<space>');
		const tokens = items.map(i => i.token).sort();
		assert.deepEqual(tokens, ['<space>', 'b', 'f'].sort());
		const sp = items.find(i => i.token === '<space>');
		assert.equal(sp?.label, 'Space');
		assert.equal(sp?.description, 'global search');
	});
});
