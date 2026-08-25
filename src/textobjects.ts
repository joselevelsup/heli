// Pure text-object + surround helpers operating on a flat document string.
// These are pure so they can be unit-tested without vscode.
//
// Helix text objects (`mi`/`ma`):
//   w W   word / WORD
//   p     paragraph
//   ( ) b   parens
//   [ ]     brackets
//   { }     braces
//   < >     angle brackets
//   " ' `   quotes
// `inner` excludes the delimiters; `around` includes them (and for words,
// trailing whitespace on the same line).

import * as M from './motions';

export type Range = readonly [number, number]; // [start, end) offsets

const BRACKET_PAIRS: Record<string, string> = {
	'(': ')', ')': '(',
	'[': ']', ']': '[',
	'{': '}', '}': '{',
	'<': '>', '>': '<',
};

export function isBracket(ch: string): boolean { return ch in BRACKET_PAIRS; }
export function isQuote(ch: string): boolean { return ch === '"' || ch === "'" || ch === '`'; }

/** The open/close pair for a surround char, e.g. `)` -> `['(', ')']`. `null` for non-surround chars. */
export function surroundPair(ch: string): readonly [string, string] | null {
	if (isBracket(ch)) {
		const open = BRACKET_PAIRS[ch] === ch ? ch : (ch === ')' || ch === ']' || ch === '}' || ch === '>') ? BRACKET_PAIRS[ch] : ch;
		const close = BRACKET_PAIRS[open];
		return [open, close];
	}
	if (isQuote(ch)) { return [ch, ch]; }
	return null;
}

/** Find the bracket pair enclosing offset `i`, scanning outward. `null` if none. */
export function findEnclosingPair(doc: string, i: number, open: string, close: string): Range | null {
	// If sitting on an open bracket, match from here.
	if (doc[i] === open) {
		const c = M.matchBracket(doc, i);
		return c >= 0 ? [i, c] : null;
	}
	if (doc[i] === close) {
		const o = M.matchBracket(doc, i);
		return o >= 0 ? [o, i] : null;
	}
	// Scan left for an unmatched open of this type.
	let depth = 0;
	let openPos = -1;
	for (let p = i - 1; p >= 0; p--) {
		const ch = doc[p];
		if (ch === close) { depth++; }
		else if (ch === open) {
			if (depth === 0) { openPos = p; break; }
			depth--;
		}
	}
	if (openPos < 0) { return null; }
	const closePos = M.matchBracket(doc, openPos);
	if (closePos < 0) { return null; }
	return [openPos, closePos];
}

function findQuotePairOnLine(doc: string, i: number, q: string): Range | null {
	const ls = M.lineStart(doc, i);
	const le = M.lineEnd(doc, i);
	const positions: number[] = [];
	for (let p = ls; p < le; p++) { if (doc[p] === q) { positions.push(p); } }
	// pair them up (0,1),(2,3),...
	for (let k = 0; k + 1 < positions.length; k += 2) {
		const a = positions[k], b = positions[k + 1];
		if (i >= a && i <= b) { return [a, b]; }
	}
	// cursor before the first quote on the line -> use the first pair
	if (positions.length >= 2 && i <= positions[0]) { return [positions[0], positions[1]]; }
	return null;
}

function wordInnerRange(doc: string, i: number, big: boolean): Range {
	const cls = M.classify(doc[i], big);
	let s = i;
	while (s > 0 && M.classify(doc[s - 1], big) === cls) { s--; }
	let e = i;
	while (e < doc.length && M.classify(doc[e], big) === cls) { e++; }
	return [s, e];
}

function paragraphRange(doc: string, i: number, around: boolean): Range | null {
	const lineCount = doc.split('\n').length;
	const lineStartOf = (off: number) => {
		let p = off;
		while (p > 0 && doc[p - 1] !== '\n') { p--; }
		return p;
	};
	const lineIndexOf = (off: number) => doc.slice(0, off).split('\n').length - 1;
	const lineIsBlank = (ln: number) => {
		const lines = doc.split('\n');
		return ln >= 0 && ln < lines.length && lines[ln].trim() === '';
	};
	const li = lineIndexOf(i);
	if (li < 0 || li >= lineCount) { return null; }
	let s = li, e = li;
	const blank = lineIsBlank(li);
	while (s > 0 && lineIsBlank(s - 1) === blank) { s--; }
	while (e < lineCount - 1 && lineIsBlank(e + 1) === blank) { e++; }
	const lines = doc.split('\n');
	const startOff = lines.slice(0, s).join('\n').length + (s > 0 ? 1 : 0);
	let endOff = lines.slice(0, e + 1).join('\n').length;
	if (around) {
		// include one trailing blank line if present
		if (e + 1 < lineCount && lineIsBlank(e + 1)) { endOff = lines.slice(0, e + 2).join('\n').length; }
	}
	void lineStartOf;
	return [startOff, endOff];
}

/**
 * Compute a text-object range. `spec` is the object char, `around` selects
 * around vs inner. Returns `null` if no object found at `i`.
 */
export function textObjectRange(doc: string, i: number, spec: string, around: boolean): Range | null {
	if (spec === 'w' || spec === 'W') {
		const big = spec === 'W';
		const [s, e] = wordInnerRange(doc, i, big);
		if (around) {
			// extend to trailing whitespace (same line, not crossing newline)
			let ne = e;
			while (ne < doc.length && doc[ne] !== '\n' && M.classify(doc[ne], big) === 'space') { ne++; }
			return [s, ne];
		}
		return [s, e];
	}
	if (spec === 'p') { return paragraphRange(doc, i, around); }
	if (isBracket(spec)) {
		const open = (spec === ')' || spec === ']' || spec === '}' || spec === '>') ? BRACKET_PAIRS[spec] : spec;
		const close = BRACKET_PAIRS[open];
		const pair = findEnclosingPair(doc, i, open, close);
		if (!pair) { return null; }
		return around ? [pair[0], pair[1] + 1] : [pair[0] + 1, pair[1]];
	}
	if (isQuote(spec)) {
		const pair = findQuotePairOnLine(doc, i, spec);
		if (!pair) { return null; }
		return around ? [pair[0], pair[1] + 1] : [pair[0] + 1, pair[1]];
	}
	return null;
}

// --- self-check -------------------------------------------------------------
if (require.main === module) {
	const assert = (c: boolean, msg: string) => { if (!c) { console.error('FAIL: ' + msg); process.exit(1); } };
	const eq = (r: Range | null, a: number, b: number) => r !== null && r[0] === a && r[1] === b;
	const doc = 'foo (bar baz) "hi there"';
	// offsets: f0 o1 o2 sp3 (4 b5 a6 r7 sp8 b9 a10 z11 )12 sp13 "14 h15 i16 sp17 t18 h19 e20 r21 e22 "23
	assert(eq(textObjectRange(doc, 5, 'w', false), 5, 8), 'miw on bar -> [5,8)');
	assert(eq(textObjectRange(doc, 5, 'w', true), 5, 9), 'maw on bar -> [5,9) (trailing space)');
	assert(eq(textObjectRange(doc, 4, '(', false), 5, 12), 'mi( from open -> inner [5,12)');
	assert(eq(textObjectRange(doc, 4, '(', true), 4, 13), 'ma( from open -> around [4,13)');
	assert(eq(textObjectRange(doc, 9, '(', false), 5, 12), 'mi( from inside -> inner [5,12)');
	assert(eq(textObjectRange(doc, 15, '"', false), 15, 23), 'mi" -> inner [15,23)');
	assert(eq(textObjectRange(doc, 15, '"', true), 14, 24), 'ma" -> around [14,24)');
	assert(eq(textObjectRange(doc, 9, ')', false), 5, 12), 'mi) alias works from inside');
	assert(findEnclosingPair(doc, 0, '(', ')') === null, 'no enclosing parens at f');
	assert(surroundPair(')')?.[0] === '(' && surroundPair(')')?.[1] === ')', 'surroundPair )');
	assert(surroundPair('"')?.[0] === '"' && surroundPair('"')?.[1] === '"', 'surroundPair "');
	// paragraph
	const pdoc = 'aaa\nbbb\n\nccc';
	// a0 a1 a2 \n3 b4 b5 b6 \n7 \n8 c9 c10 c11
	assert(eq(textObjectRange(pdoc, 1, 'p', false), 0, 7), 'mip inner first para [0,7)');
	assert(eq(textObjectRange(pdoc, 1, 'p', true), 0, 8), 'map around first para [0,8) incl blank line');
	console.log('textobjects self-check OK');
}
