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

	// Phase 0 characterization: lock current `classify` semantics across the
	// exact set of code points `/\s/` and `[A-Za-z0-9_]/` match today, so a
	// later char-code fast path can't silently drift word-motion behavior.
	suite('classify (character class) — Phase 0 characterization', () => {
		const space = (ch: string) => assert.equal(M.classify(ch, false), 'space', JSON.stringify(ch) + ' should be space');
		const word = (ch: string) => assert.equal(M.classify(ch, false), 'word', JSON.stringify(ch) + ' should be word');
		const punct = (ch: string) => assert.equal(M.classify(ch, false), 'punct', JSON.stringify(ch) + ' should be punct');
		test('ASCII whitespace is space', () => {
			space('\t'); space('\n'); space('\r'); space('\f'); space('\v'); space(' ');
		});
		test('Unicode whitespace is space (matches /\\s/)', () => {
			space('\u00a0'); // NBSP
			space('\u2003'); // em space
			space('\u2002'); // en space
			space('\u2009'); // thin space
			space('\u200A'); // hair space
			space('\u202F'); // narrow nbsp
			space('\u2028'); // line separator
			space('\u2029'); // paragraph separator
			space('\u3000'); // ideographic space
		});
		test('U+180E mongolian vowel separator is NOT space (excluded from /\\s/)', () => {
			punct('\u180E');
		});
		test('ASCII word chars are word', () => {
			word('a'); word('Z'); word('0'); word('9'); word('_');
		});
		test('non-ASCII letters are punct (word class is ASCII-only)', () => {
			punct('é'); punct('中'); punct('😀');
		});
		test('punctuation is punct', () => {
			punct('.'); punct('('); punct('-'); punct('/');
		});
		test('undefined/empty are space', () => {
			assert.equal(M.classify(undefined, false), 'space');
			assert.equal(M.classify('', false), 'space');
		});
		test('big=true collapses all non-space to word', () => {
			assert.equal(M.classify('.', true), 'word');
			assert.equal(M.classify('é', true), 'word');
			assert.equal(M.classify('中', true), 'word');
			assert.equal(M.classify(' ', true), 'space');
			assert.equal(M.classify('\u00a0', true), 'space');
		});
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

		// Phase 0 characterization: lock current `paragraphRange` offsets on
		// edge cases the existing self-check doesn't cover, so a single-split
		// rewrite can't silently drift paragraph text-object behavior.
		suite('paragraph (mip/map) — Phase 0 characterization', () => {
			test('empty doc -> [0,0]', () => {
				assert.ok(eq(T.textObjectRange('', 0, 'p', false), 0, 0));
				assert.ok(eq(T.textObjectRange('', 0, 'p', true), 0, 0));
			});
			test('single line -> whole line, inner==around', () => {
				assert.ok(eq(T.textObjectRange('aaa', 0, 'p', false), 0, 3));
				assert.ok(eq(T.textObjectRange('aaa', 1, 'p', true), 0, 3));
			});
			test('cursor on a blank separator line -> empty range', () => {
				// "aaa\nbbb\n\nccc": offset 8 is the blank line between paras
				const d = 'aaa\nbbb\n\nccc';
				assert.ok(eq(T.textObjectRange(d, 8, 'p', false), 8, 8));
				assert.ok(eq(T.textObjectRange(d, 8, 'p', true), 8, 8));
			});
			test('middle paragraph inner', () => {
				// "aaa\nbbb\n\nccc\nddd\n\neee": offsets 9..16 = "ccc\nddd"
				const d = 'aaa\nbbb\n\nccc\nddd\n\neee';
				assert.ok(eq(T.textObjectRange(d, 9, 'p', false), 9, 16));
				assert.ok(eq(T.textObjectRange(d, 14, 'p', false), 9, 16));
			});
			test('middle paragraph around includes trailing blank line', () => {
				const d = 'aaa\nbbb\n\nccc\nddd\n\neee';
				// around on middle para -> [9,17) = "ccc\nddd\n"
				assert.ok(eq(T.textObjectRange(d, 9, 'p', true), 9, 17));
			});
			test('last paragraph inner (no trailing newline)', () => {
				const d = 'aaa\nbbb\n\nccc';
				assert.ok(eq(T.textObjectRange(d, 9, 'p', false), 9, 12));
			});
			test('last paragraph around with trailing newline includes it', () => {
				// "aaa\nbbb\n\nccc\n": last para "ccc", around includes the final \n
				const d = 'aaa\nbbb\n\nccc\n';
				assert.ok(eq(T.textObjectRange(d, 9, 'p', true), 9, 13));
				assert.ok(eq(T.textObjectRange(d, 12, 'p', true), 9, 13));
			});
			test('first paragraph around includes trailing blank separator', () => {
				const d = 'aaa\nbbb\n\nccc';
				assert.ok(eq(T.textObjectRange(d, 0, 'p', true), 0, 8)); // "aaa\nbbb\n"
			});
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

	test('multi-level: <space>o sub-menu lists its children — issue #11', () => {
		const map = {
			'<space>op': 'magit.status',
			'<space>ol': 'magit.log',
			'<space>f': 'leader_file',
		};
		// <space>o is a sub-prefix: it has children but no direct action
		const topItems = buildWhichKeyItems(map, '<space>');
		const o = topItems.find(i => i.token === 'o');
		assert.ok(o, 'o should appear under <space>');
		// descending into <space>o shows p and l
		const subItems = buildWhichKeyItems(map, '<space>o');
		const subTokens = subItems.map(i => i.token).sort();
		assert.deepEqual(subTokens, ['l', 'p'].sort());
		assert.equal(subItems.find(i => i.token === 'p')?.description, 'magit.status');
	});
});
