// Pure motion helpers operating on a flat document string.
// Helix word model: a "word" is a run of word-chars (alnum + _) OR a run of
// punctuation; whitespace separates. `W/B/E` treat any non-whitespace run as a word.
// Newlines count as whitespace. These are pure so they can be unit-tested without vscode.

export type CharClass = 'space' | 'word' | 'punct';

export function classify(ch: string | undefined, big: boolean): CharClass {
	if (ch === undefined || ch === '' || ch === '\n' || ch === '\r' || /\s/.test(ch)) {return 'space';}
	if (big) {return 'word';}
	if (/[A-Za-z0-9_]/.test(ch)) {return 'word';}
	return 'punct';
}

const last = (doc: string) => doc.length - 1;

/** Move to the start of the next word. */
export function nextWordStart(doc: string, i: number, big: boolean): number {
	const start = i;
	let p = i;
	const c = classify(doc[p], big);
	// consume the rest of the current word (if sitting on one)
	if (c !== 'space') {
		while (p < doc.length && classify(doc[p], big) === c) {p++;}
	}
	// skip whitespace
	while (p < doc.length && classify(doc[p], big) === 'space') {p++;}
	if (p >= doc.length) {return last(doc);}
	return p === start ? Math.min(p + 0, last(doc)) : p;
}

/** Move to the start of the previous word. */
export function prevWordStart(doc: string, i: number, big: boolean): number {
	let p = i - 1;
	// skip whitespace back
	while (p > 0 && classify(doc[p], big) === 'space') {p--;}
	if (p <= 0) {return 0;}
	const c = classify(doc[p], big);
	// skip back over the word to its start
	while (p > 0 && classify(doc[p - 1], big) === c) {p--;}
	return p;
}

/** Move to the end of the current/next word. */
export function nextWordEnd(doc: string, i: number, big: boolean): number {
	let p = i + 1;
	// skip whitespace forward
	while (p < doc.length && classify(doc[p], big) === 'space') {p++;}
	if (p >= doc.length) {return last(doc);}
	const c = classify(doc[p], big);
	// advance to last char of this word
	while (p + 1 < doc.length && classify(doc[p + 1], big) === c) {p++;}
	return p;
}

// ponytail: module-level so matchBracket doesn't allocate a lookup object per call.
const MATCH_BRACKETS: Record<string, string> = { '(': ')', '[': ']', '{': '}', ')': '(', ']': '[', '}': '{' };

/** Find the matching bracket for the char at `i`, or -1. */
export function matchBracket(doc: string, i: number): number {
	const open = doc[i];
	const close = MATCH_BRACKETS[open];
	if (!close) {return -1;}
	const isOpen = '([{'.includes(open);
	const dir = isOpen ? 1 : -1;
	let p = i + dir;
	let depth = 1;
	while (p >= 0 && p < doc.length) {
		const ch = doc[p];
		if (ch === open) {depth++;}
		else if (ch === close) {
			depth--;
			if (depth === 0) {return p;}
		}
		p += dir;
	}
	return -1;
}

/** First non-whitespace character index on a line (given line start offset). */
export function firstNonWsOnLine(doc: string, lineStart: number): number {
	let p = lineStart;
	while (p < doc.length && doc[p] !== '\n' && /\s/.test(doc[p])) {p++;}
	return p;
}

/** Offset of the start of the line containing `i`. */
export function lineStart(doc: string, i: number): number {
	let p = i;
	while (p > 0 && doc[p - 1] !== '\n') {p--;}
	return p;
}

/** Offset just past the end of the line containing `i` (at the newline, or EOF). */
export function lineEnd(doc: string, i: number): number {
	let p = i;
	while (p < doc.length && doc[p] !== '\n') {p++;}
	return p; // position of newline (or doc.length)
}

// --- self-check -------------------------------------------------------------
if (require.main === module) {
	const assert = (c: boolean, msg: string) => { if (!c) { console.error('FAIL: ' + msg); process.exit(1); } };
	const doc = 'foo bar.baz\n  qux';
	// offsets: f0 o1 o2 sp3 b4 a5 r6 .7 b8 a9 z10 \n11 sp12 sp13 q14 u15 x16
	assert(nextWordStart(doc, 0, false) === 4, 'w from foo -> bar');
	assert(nextWordStart(doc, 4, false) === 7, 'w from bar -> . (punct is its own word)');
	assert(nextWordStart(doc, 7, false) === 8, 'w from . -> baz');
	assert(nextWordEnd(doc, 0, false) === 2, 'e from foo start -> foo end (2)');
	assert(prevWordStart(doc, 8, false) === 7, 'b from baz -> . start');
	assert(prevWordStart(doc, 7, false) === 4, 'b from . -> bar start');
	assert(matchBracket('(a(b)c)', 0) === 6, 'match outer parens');
	assert(matchBracket('(a(b)c)', 2) === 4, 'match inner parens');
	// big-word: punctuation joins the word
	assert(nextWordStart(doc, 4, true) === 14, 'W from bar -> qux (punct joins, crosses line)');
	assert(nextWordEnd(doc, 4, true) === 10, 'E from bar -> baz end (10)');
	assert(prevWordStart(doc, 14, false) === 8, 'b from qux -> baz start');
	assert(firstNonWsOnLine(doc, 12) === 14, 'firstNonWs of 2nd line -> qux');
	console.log('motions self-check OK');
}
