import * as vscode from 'vscode';
import * as M from './motions';
import * as T from './textobjects';
import type { Mode, ModeLike } from './mode';

export interface Ctx {
	editor: vscode.TextEditor;
	mode: ModeLike;
	count: number;
	register: string;
	arg?: string; // captured target char(s) for find/till/surround/text-objects
}

export type Action = (ctx: Ctx) => void;

// --- registers --------------------------------------------------------------
// ponytail: in-memory only; not persisted across sessions. `*`/`+` map to the
// system clipboard via vscode.env.clipboard so yank/paste interop with the OS.
// Upgrade path: file-backed register store if cross-session persistence is wanted.
interface Reg { text: string; linewise: boolean; }
const registers = new Map<string, Reg>();
const CLIPBOARD_REGS = new Set(['*', '+']);

async function setReg(name: string, text: string, linewise: boolean): Promise<void> {
	if (CLIPBOARD_REGS.has(name)) { await vscode.env.clipboard.writeText(text); }
	registers.set(name, { text, linewise });
}
async function getReg(name: string): Promise<Reg> {
	if (CLIPBOARD_REGS.has(name)) { return { text: await vscode.env.clipboard.readText(), linewise: false }; }
	return registers.get(name) ?? { text: '', linewise: false };
}

// --- helpers ----------------------------------------------------------------
const clampi = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Apply a position-returning motion, repeating `count` times.
 * Helix select-first: in Normal mode, `keepRange` motions leave a selection
 * over [old active, new]; collapsing motions (h/j/k/l/gg/G) leave a single char.
 * In Select mode the anchor is preserved and the head extends. */
function movePos(ctx: Ctx, fn: (ed: vscode.TextEditor, head: vscode.Position) => vscode.Position, keepRange = true): void {
	const ed = ctx.editor;
	const sel = ctx.mode.current === 'select';
	ed.selections = ed.selections.map(s => {
		const old = s.active;
		let p = old;
		for (let k = 0; k < ctx.count; k++) {p = fn(ed, p);}
		return sel ? new vscode.Selection(s.anchor, p) : (keepRange ? new vscode.Selection(old, p) : new vscode.Selection(p, p));
	});
	revealActive(ed);
}

/** Apply a flat-offset motion, repeating `count` times. Same keepRange rule as movePos. */
function moveFlat(ctx: Ctx, fn: (doc: string, i: number) => number, keepRange = true): void {
	const ed = ctx.editor;
	const doc = ed.document.getText();
	const sel = ctx.mode.current === 'select';
	ed.selections = ed.selections.map(s => {
		const oldOff = ed.document.offsetAt(s.active);
		let i = oldOff;
		for (let k = 0; k < ctx.count; k++) {i = fn(doc, i);}
		i = clampi(i, 0, doc.length);
		const p = ed.document.positionAt(i);
		return sel ? new vscode.Selection(s.anchor, p) : (keepRange ? new vscode.Selection(s.active, p) : new vscode.Selection(p, p));
	});
	revealActive(ed);
}

function edit(ed: vscode.TextEditor, cb: (b: vscode.TextEditorEdit) => void): Thenable<boolean> {
	return ed.edit(cb, { undoStopBefore: true, undoStopAfter: true });
}

/** Reveal the active cursor so it stays on screen after a programmatic move.
 * VS Code does not auto-reveal selections set via the API (only native kbd input),
 * so every motion must call this or the cursor walks off the viewport.
 * InCenterIfOutsideViewport only scrolls when needed — no fighting the user. */
function revealActive(ed: vscode.TextEditor): void {
	const at = ed.selection.active;
	ed.revealRange(new vscode.Range(at, at), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

const isLinewise = (text: string) => text.endsWith('\n');

// --- motions ----------------------------------------------------------------
function lineEndPos(ed: vscode.TextEditor, head: vscode.Position): vscode.Position {
	const line = ed.document.lineAt(head.line);
	return line.range.end.character > 0 ? line.range.end.translate(0, -1) : line.range.end;
}
function firstNonWs(ed: vscode.TextEditor, head: vscode.Position): vscode.Position {
	const line = ed.document.lineAt(head.line);
	return new vscode.Position(head.line, line.firstNonWhitespaceCharacterIndex);
}

// h/j/k/l are collapsing motions (single-char selection at destination),
// matching Helix where arrow keys don't drag a range.
const moveLeft = (ctx: Ctx) => movePos(ctx, (ed, h) => h.character === 0 ? h : h.translate(0, -1), false);
const moveRight = (ctx: Ctx) => movePos(ctx, (ed, h) => {
	const end = ed.document.lineAt(h.line).range.end;
	return h.isEqual(end) ? h : h.translate(0, 1);
}, false);
const moveDown = (ctx: Ctx) => movePos(ctx, (ed, h) => {
	if (h.line >= ed.document.lineCount - 1) {return h;}
	const next = ed.document.lineAt(h.line + 1);
	const ch = Math.min(h.character, next.range.end.character);
	return new vscode.Position(h.line + 1, ch);
}, false);
const moveUp = (ctx: Ctx) => movePos(ctx, (ed, h) => {
	if (h.line === 0) {return h;}
	const prev = ed.document.lineAt(h.line - 1);
	const ch = Math.min(h.character, prev.range.end.character);
	return new vscode.Position(h.line - 1, ch);
}, false);

const lineStart = (ctx: Ctx) => movePos(ctx, (_ed, h) => new vscode.Position(h.line, 0));
const lineFirstNonWs = (ctx: Ctx) => movePos(ctx, firstNonWs);
const lineEnd = (ctx: Ctx) => movePos(ctx, lineEndPos);

const wordFwd = (ctx: Ctx) => moveFlat(ctx, (d, i) => M.nextWordStart(d, i, false));
const wordBack = (ctx: Ctx) => moveFlat(ctx, (d, i) => M.prevWordStart(d, i, false));
const wordEndFwd = (ctx: Ctx) => moveFlat(ctx, (d, i) => M.nextWordEnd(d, i, false));
const WORDFwd = (ctx: Ctx) => moveFlat(ctx, (d, i) => M.nextWordStart(d, i, true));
const WORDBack = (ctx: Ctx) => moveFlat(ctx, (d, i) => M.prevWordStart(d, i, true));
const WORDEndFwd = (ctx: Ctx) => moveFlat(ctx, (d, i) => M.nextWordEnd(d, i, true));

function gotoStart(ctx: Ctx): void {
	const ed = ctx.editor;
	const targetLine = ctx.count > 1 ? clampi(ctx.count - 1, 0, ed.document.lineCount - 1) : 0;
	const line = ed.document.lineAt(targetLine);
	const p = new vscode.Position(targetLine, line.firstNonWhitespaceCharacterIndex);
	ed.selections = [new vscode.Selection(p, p)];
	revealActive(ed);
}
function gotoEnd(ctx: Ctx): void {
	const ed = ctx.editor;
	const targetLine = ctx.count > 1 ? clampi(ctx.count - 1, 0, ed.document.lineCount - 1) : ed.document.lineCount - 1;
	const line = ed.document.lineAt(targetLine);
	const p = lineEndPos(ed, new vscode.Position(targetLine, 0));
	ed.selections = [new vscode.Selection(p, p)];
	revealActive(ed);
}

function paragraphNext(ctx: Ctx): void {
	const ed = ctx.editor;
	movePos(ctx, (_ed, h) => {
		let line = h.line;
		// skip current block
		while (line < ed.document.lineCount - 1 && !ed.document.lineAt(line).isEmptyOrWhitespace) {line++;}
		while (line < ed.document.lineCount - 1 && ed.document.lineAt(line).isEmptyOrWhitespace) {line++;}
		const target = ed.document.lineAt(line);
		return new vscode.Position(line, target.firstNonWhitespaceCharacterIndex);
	});
}
function paragraphPrev(ctx: Ctx): void {
	const ed = ctx.editor;
	movePos(ctx, (_ed, h) => {
		let line = h.line;
		while (line > 0 && !ed.document.lineAt(line).isEmptyOrWhitespace) {line--;}
		while (line > 0 && ed.document.lineAt(line).isEmptyOrWhitespace) {line--;}
		const target = ed.document.lineAt(line);
		return new vscode.Position(line, target.firstNonWhitespaceCharacterIndex);
	});
}

function matchBracket(ctx: Ctx): void {
	moveFlat(ctx, (d, i) => {
		const m = M.matchBracket(d, i);
		return m >= 0 ? m : i;
	});
}

// --- find / till ------------------------------------------------------------
interface FindState { ch: string; forward: boolean; till: boolean; }
let lastFind: FindState | null = null;

export function findChar(ctx: Ctx, forward: boolean, till: boolean, ch: string): void {
	lastFind = { ch, forward, till };
	const ed = ctx.editor;
	ed.selections = ed.selections.map(s => {
		const startOffset = ed.document.offsetAt(s.active);
		const doc = ed.document.getText();
		let p = startOffset;
		for (let n = 0; n < ctx.count; n++) {
			const dir = forward ? 1 : -1;
			let i = p + dir;
			while (i >= 0 && i < doc.length && doc[i] !== '\n') {
				if (doc[i] === ch) {
					const target = till ? i - dir : i;
					p = clampi(target, 0, doc.length);
					break;
				}
				i += dir;
			}
			if (i < 0 || i >= doc.length || doc[i] === '\n') {break;}
		}
		const np = ed.document.positionAt(p);
		return ctx.mode.current === 'select' ? new vscode.Selection(s.anchor, np) : new vscode.Selection(s.active, np); // extend in normal mode (Helix select-first)
	});
	revealActive(ed);
}

export function findRepeat(ctx: Ctx, reverse: boolean): void {
	if (!lastFind) {return;}
	const f = lastFind;
	findChar(ctx, reverse ? !f.forward : f.forward, f.till, f.ch);
}

// --- selection ops ----------------------------------------------------------
function selectLine(ctx: Ctx): void {
	// Helix x: select current line (incl. newline); if already a linewise
	// selection, extend down by one line. Count extends by N lines.
	const ed = ctx.editor;
	ed.selections = ed.selections.map(s => {
		const startLine = s.start.line;
		let endLine = s.end.line;
		// detect existing linewise selection (starts at col 0, ends at col 0 of a later line)
		const alreadyLine = !s.isEmpty && s.start.character === 0 && s.end.character === 0 && s.end.line > s.start.line;
		if (alreadyLine) {endLine = s.end.line + ctx.count - 1;} // extend from the trailing empty line
		else {endLine = startLine + ctx.count - 1;}
		endLine = clampi(endLine, 0, ed.document.lineCount - 1);
		const isLast = endLine === ed.document.lineCount - 1;
		const endPos = isLast ? ed.document.lineAt(endLine).range.end : new vscode.Position(endLine + 1, 0);
		const startPos = new vscode.Position(startLine, 0);
		return new vscode.Selection(startPos, endPos);
	});
}

function selectLineUp(ctx: Ctx): void {
	const ed = ctx.editor;
	const lastLine = ed.document.lineCount - 1;
	ed.selections = ed.selections.map(s => {
		const endLine = s.end.line;
		const startLine = Math.max(0, s.start.line - ctx.count);
		const startPos = new vscode.Position(startLine, 0);
		const endPos = endLine >= lastLine ? ed.document.lineAt(endLine).range.end : new vscode.Position(endLine + 1, 0);
		return new vscode.Selection(endPos, startPos); // anchor at bottom, cursor at top
	});
}

function selectAll(ctx: Ctx): void {
	const ed = ctx.editor;
	const last = ed.document.lineAt(ed.document.lineCount - 1);
	ed.selections = [new vscode.Selection(new vscode.Position(0, 0), last.range.end)];
}

function toggleSelect(ctx: Ctx): void {
	ctx.mode.set(ctx.mode.current === 'select' ? 'normal' : 'select');
}

// --- select-within-selection (s) and split-on-regex (S) -------------------
// Helix `s`: prompt for a regex, replace each selection with one selection per
// match found inside it (multi-cursor on every match).
// Helix `S`: split each selection on regex matches into separate selections.
async function selectInSelection(ctx: Ctx, split: boolean): Promise<void> {
	const ed = ctx.editor;
	const prompt = split ? 'Split selection on regex' : 'Select within selection (regex)';
	const pattern = await vscode.window.showInputBox({ prompt, placeHolder: 'e.g. \\w+ or [a-z]+' });
	if (pattern === undefined || pattern === '') { return; }
	let re: RegExp;
	try { re = new RegExp(pattern, 'g'); }
	catch (e) { void vscode.window.showWarningMessage(`heli: bad regex: ${(e as Error).message}`); return; }
	const doc = ed.document.getText();
	const newSels: vscode.Selection[] = [];
	for (const s of ed.selections) {
		const startOff = ed.document.offsetAt(s.start);
		const endOff = ed.document.offsetAt(s.end);
		const text = doc.slice(startOff, endOff);
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		let last = 0;
		while ((m = re.exec(text)) !== null) {
			const mStart = startOff + m.index;
			const mEnd = mStart + m[0].length;
			if (split) {
				// selection for the gap before this match
				if (mStart > last) { newSels.push(new vscode.Selection(ed.document.positionAt(last), ed.document.positionAt(mStart))); }
			} else {
				newSels.push(new vscode.Selection(ed.document.positionAt(mStart), ed.document.positionAt(mEnd)));
			}
			last = mEnd;
			if (m[0].length === 0) { re.lastIndex++; } // avoid zero-width infinite loop
		}
		if (split && last < endOff) {
			newSels.push(new vscode.Selection(ed.document.positionAt(last), ed.document.positionAt(endOff)));
		}
	}
	if (newSels.length > 0) {
		ed.selections = newSels;
		if (ctx.mode.current === 'normal') { ctx.mode.set('select'); }
	}
}
const selectMatches = (ctx: Ctx) => { void selectInSelection(ctx, false); };
const splitSelection = (ctx: Ctx) => { void selectInSelection(ctx, true); };

// --- operators --------------------------------------------------------------
function deleteOp(ctx: Ctx): void {
	const ed = ctx.editor;
	const ranges = ed.selections.map(s => {
		if (s.isEmpty) {return null;} // Helix: d on a bare cursor is a no-op
		return s;
	}).filter(Boolean) as vscode.Selection[];
	if (ranges.length === 0) {return;}
	const text = ranges.map(r => ed.document.getText(r)).join('');
	void setReg(ctx.register, text, isLinewise(text));
	void edit(ed, b => {
		for (const r of ranges) {b.delete(r);}
	}).then(() => {
		// collapse each to the start of its deleted range
		ed.selections = ranges.map(r => {
			const p = r.start;
			return new vscode.Selection(p, p);
		});
	});
}

function changeOp(ctx: Ctx): void {
	const ed = ctx.editor;
	const ranges = ed.selections;
	const text = ranges.map(r => ed.document.getText(r)).join('');
	if (text) {void setReg(ctx.register, text, isLinewise(text));}
	void edit(ed, b => {
		for (const r of ranges) {
			if (r.isEmpty) {continue;}
			b.delete(r);
		}
	}).then(() => {
		ed.selections = ranges.map(r => new vscode.Selection(r.start, r.start));
		ctx.mode.set('insert');
	});
}

function yankOp(ctx: Ctx): void {
	const ed = ctx.editor;
	for (const s of ed.selections) {
		let text: string, linewise: boolean;
		if (s.isEmpty) {
			const line = ed.document.lineAt(s.active.line);
			text = ed.document.getText(line.rangeIncludingLineBreak);
			linewise = true;
		} else {
			text = ed.document.getText(s);
			linewise = isLinewise(text);
		}
		void setReg(ctx.register, text, linewise);
	}
	// collapse to selection start (Helix leaves cursor at yank start)
	ed.selections = ed.selections.map(s => new vscode.Selection(s.start, s.start));
}

function pasteOp(ctx: Ctx, before: boolean): void {
	const ed = ctx.editor;
	void getReg(ctx.register).then(reg => {
		if (!reg.text) {return;}
		const insertText = reg.text.repeat(ctx.count);
		void edit(ed, b => {
			for (const s of ed.selections) {
				if (reg.linewise) {
					const line = ed.document.lineAt(s.active.line);
					const pos = before ? line.range.start : line.range.end;
					b.insert(pos, insertText);
				} else {
					const atEnd = ed.document.offsetAt(s.active) >= ed.document.getText().length;
					const pos = before ? s.active : (atEnd ? s.active : s.active.translate(0, 1));
					b.insert(pos, insertText);
				}
			}
		});
	});
}

const pasteAfter = (ctx: Ctx) => pasteOp(ctx, false);
const pasteBefore = (ctx: Ctx) => pasteOp(ctx, true);

// --- insert entries ---------------------------------------------------------
function collapseTo(ctx: Ctx, posOf: (s: vscode.Selection) => vscode.Position): void {
	ctx.editor.selections = ctx.editor.selections.map(s => {
		const p = posOf(s);
		return new vscode.Selection(p, p);
	});
}
const insertStart = (ctx: Ctx) => { collapseTo(ctx, s => s.start); ctx.mode.set('insert'); };
function insertAfter(ctx: Ctx): void {
	const ed = ctx.editor;
	ed.selections = ed.selections.map(s => {
		if (s.isEmpty) {
			const line = ed.document.lineAt(s.active.line);
			const p = s.active.isEqual(line.range.end) ? s.active : s.active.translate(0, 1);
			return new vscode.Selection(p, p);
		}
		return new vscode.Selection(s.end, s.end);
	});
	ctx.mode.set('insert');
}
function insertLineStart(ctx: Ctx): void {
	const ed = ctx.editor;
	ed.selections = ed.selections.map(s => {
		const line = ed.document.lineAt(s.start.line);
		return new vscode.Selection(new vscode.Position(s.start.line, line.firstNonWhitespaceCharacterIndex), new vscode.Position(s.start.line, line.firstNonWhitespaceCharacterIndex));
	});
	ctx.mode.set('insert');
}
function insertLineEnd(ctx: Ctx): void {
	const ed = ctx.editor;
	ed.selections = ed.selections.map(s => {
		const line = ed.document.lineAt(s.active.line);
		return new vscode.Selection(line.range.end, line.range.end);
	});
	ctx.mode.set('insert');
}
function openBelow(ctx: Ctx): void {
	const ed = ctx.editor;
	const positions: vscode.Position[] = [];
	void edit(ed, b => {
		for (const s of ed.selections) {
			const line = ed.document.lineAt(s.active.line);
			b.insert(line.range.end, '\n'.repeat(ctx.count));
			positions.push(line.range.end);
		}
	}).then(() => {
		ed.selections = positions.map(p => new vscode.Selection(p, p));
		ctx.mode.set('insert');
	});
}
function openAbove(ctx: Ctx): void {
	const ed = ctx.editor;
	const positions: vscode.Position[] = [];
	void edit(ed, b => {
		for (const s of ed.selections) {
			const line = ed.document.lineAt(s.active.line);
			b.insert(line.range.start, '\n'.repeat(ctx.count));
			positions.push(line.range.start);
		}
	}).then(() => {
		ed.selections = positions.map(p => new vscode.Selection(p, p));
		ctx.mode.set('insert');
	});
}

// --- undo / redo ------------------------------------------------------------
const undo = (_ctx: Ctx) => { void vscode.commands.executeCommand('undo'); };
const redo = (_ctx: Ctx) => { void vscode.commands.executeCommand('redo'); };

// --- delegates to VS Code native commands (LSP / pickers / view) ------------
function execVsCmd(name: string): Action {
	return () => { void vscode.commands.executeCommand(name); };
}
function reveal(center: boolean, top?: boolean): Action {
	return (ctx) => {
		const ed = ctx.editor;
		const sel = ed.selection;
		const at = sel.isEmpty ? sel.active : sel.start;
		const range = new vscode.Range(at, at.translate(0, 1));
		ed.revealRange(range, center ? vscode.TextEditorRevealType.InCenter : (top ? vscode.TextEditorRevealType.AtTop : vscode.TextEditorRevealType.InCenterIfOutsideViewport));
	};
}

// --- text objects & surround ----------------------------------------------
function selectTextObject(ctx: Ctx, around: boolean): void {
	if (!ctx.arg) {return;}
	const ed = ctx.editor;
	const doc = ed.document.getText();
	const newSels: vscode.Selection[] = [];
	for (const s of ed.selections) {
		const i = ed.document.offsetAt(s.active);
		const r = T.textObjectRange(doc, i, ctx.arg, around);
		if (!r) { newSels.push(s); continue; }
		const start = ed.document.positionAt(r[0]);
		const end = ed.document.positionAt(r[1]);
		newSels.push(new vscode.Selection(start, end));
	}
	ed.selections = newSels;
	if (ctx.mode.current === 'normal') { ctx.mode.set('select'); }
}
const textObjectInner = (ctx: Ctx) => selectTextObject(ctx, false);
const textObjectAround = (ctx: Ctx) => selectTextObject(ctx, true);

function surroundAdd(ctx: Ctx): void {
	if (!ctx.arg) {return;}
	const pair = T.surroundPair(ctx.arg);
	if (!pair) {return;}
	const [o, c] = pair;
	const ed = ctx.editor;
	void edit(ed, b => {
		for (const s of ed.selections) {
			if (s.isEmpty) {
				// empty cursor: insert an empty pair and leave cursor inside
				b.insert(s.active, o + c);
			} else {
				// wrap: insert close first (later offset) then open, so an empty
				// selection's two inserts don't collide and order is open...close
				b.insert(s.end, c);
				b.insert(s.start, o);
			}
		}
	}).then(() => {
		// place cursors inside the surround, at the original selection start
		ed.selections = ed.selections.map(s => {
			const p = s.start;
			return new vscode.Selection(p, p);
		});
	});
}

function surroundReplace(ctx: Ctx): void {
	// arg is two chars: from, to
	if (!ctx.arg || ctx.arg.length < 2) {return;}
	const from = ctx.arg[0], to = ctx.arg[1];
	const fromPair = T.surroundPair(from), toPair = T.surroundPair(to);
	if (!fromPair || !toPair) {return;}
	const [fO, fC] = fromPair, [tO, tC] = toPair;
	const ed = ctx.editor;
	const doc = ed.document.getText();
	const edits: Array<{ pos: vscode.Position; oldLen: number; text: string }> = [];
	for (const s of ed.selections) {
		const i = ed.document.offsetAt(s.active);
		const pair = T.findEnclosingPair(doc, i, fO, fC);
		if (!pair) {continue;}
		const openPos = ed.document.positionAt(pair[0]);
		const closePos = ed.document.positionAt(pair[1]);
		edits.push({ pos: openPos, oldLen: 1, text: tO });
		edits.push({ pos: closePos, oldLen: 1, text: tC });
	}
	if (edits.length === 0) {return;}
	// apply from bottom to top so earlier offsets stay valid
	edits.sort((a, b) => b.pos.compareTo(a.pos));
	void edit(ed, b => {
		for (const e of edits) {
			b.replace(new vscode.Range(e.pos, e.pos.translate(0, e.oldLen)), e.text);
		}
	});
}

function surroundDelete(ctx: Ctx): void {
	if (!ctx.arg) {return;}
	const pair = T.surroundPair(ctx.arg);
	if (!pair) {return;}
	const [o, c] = pair;
	const ed = ctx.editor;
	const doc = ed.document.getText();
	const dels: vscode.Range[] = [];
	for (const s of ed.selections) {
		const i = ed.document.offsetAt(s.active);
		const found = T.findEnclosingPair(doc, i, o, c);
		if (!found) {continue;}
		dels.push(new vscode.Range(ed.document.positionAt(found[0]), ed.document.positionAt(found[0] + 1)));
		dels.push(new vscode.Range(ed.document.positionAt(found[1]), ed.document.positionAt(found[1] + 1)));
	}
	if (dels.length === 0) {return;}
	dels.sort((a, b) => b.start.compareTo(a.start));
	void edit(ed, b => {
		for (const r of dels) { b.delete(r); }
	});
}

// --- window management (Ctrl-w) --------------------------------------------
// Thin wrappers over VS Code editor-group commands. Helix `Ctrl-w` sub-keys.
const winSplitV = execVsCmd('workbench.action.splitEditor');          // split right
const winSplitH = execVsCmd('workbench.action.splitEditorOrthogonal'); // split down
const winFocusLeft = execVsCmd('workbench.action.focusLeftEditorGroup');
const winFocusRight = execVsCmd('workbench.action.focusRightEditorGroup');
const winFocusUp = execVsCmd('workbench.action.focusAboveEditorGroup');
const winFocusDown = execVsCmd('workbench.action.focusBelowEditorGroup');
const winClose = execVsCmd('workbench.action.closeActiveEditor');
const winNew = execVsCmd('workbench.action.newGroupDown');

// --- half-page scroll (Ctrl-d / Ctrl-u, neovim-style) ---------------------
// Move the cursor by half the visible viewport lines and reveal so the cursor
// stays in view. Collapsing (like h/j/k/l) — no selection dragged.
function scrollHalfPage(ctx: Ctx, dir: 1 | -1): void {
	const ed = ctx.editor;
	let visibleLines = 1;
	if (ed.visibleRanges.length > 0) {
		visibleLines = ed.visibleRanges.reduce((n, r) => n + (r.end.line - r.start.line + 1), 0);
	}
	const half = Math.max(1, Math.floor(visibleLines / 2));
	const lastLine = ed.document.lineCount - 1;
	const sel = ctx.mode.current === 'select';
	ed.selections = ed.selections.map(s => {
		const line = clampi(s.active.line + dir * half * ctx.count, 0, lastLine);
		const target = ed.document.lineAt(line);
		const ch = Math.min(s.active.character, target.range.end.character);
		const p = new vscode.Position(line, ch);
		return sel ? new vscode.Selection(s.anchor, p) : new vscode.Selection(p, p);
	});
	const at = ed.selection.active;
	ed.revealRange(new vscode.Range(at, at), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
const scrollDown = (ctx: Ctx) => scrollHalfPage(ctx, 1);
const scrollUp = (ctx: Ctx) => scrollHalfPage(ctx, -1);

// --- collapse multi-cursors (`,`) -----------------------------------------
// Drop all secondary selections, keep the primary. No-op with one cursor.
function collapseCursors(_ctx: Ctx): void {
	const ed = _ctx.editor;
	if (ed.selections.length > 1) { ed.selections = [ed.selection]; }
}

const nextEditor = execVsCmd('workbench.action.nextEditor');
const prevEditor = execVsCmd('workbench.action.previousEditor');

// --- jump back / forward (Ctrl-o / Ctrl-i) after gd etc. ------------------
const navigateBack = execVsCmd('workbench.action.navigateBack');
const navigateForward = execVsCmd('workbench.action.navigateForward');

// --- file explorer toggle (Space-e) ---------------------------------------
// `workbench.view.explorer` reveals AND focuses the explorer tree.
const toggleExplorer = execVsCmd('workbench.view.explorer');

// --- escape (collapse to head) ----------------------------------------------
export function escapeToNormal(ctx: Ctx): void {
	const ed = ctx.editor;
	ed.selections = ed.selections.map(s => new vscode.Selection(s.active, s.active));
	ctx.mode.set('normal');
}

// --- registry ---------------------------------------------------------------
export const actions: Record<string, Action> = {
	move_left: moveLeft,
	move_right: moveRight,
	move_down: moveDown,
	move_up: moveUp,
	line_start: lineStart,
	line_first_nonws: lineFirstNonWs,
	line_end: lineEnd,
	word_fwd: wordFwd,
	word_back: wordBack,
	word_end: wordEndFwd,
	WORD_fwd: WORDFwd,
	WORD_back: WORDBack,
	WORD_end: WORDEndFwd,
	goto_start: gotoStart,
	goto_end: gotoEnd,
	paragraph_next: paragraphNext,
	paragraph_prev: paragraphPrev,
	match_bracket: matchBracket,
	find_char: (ctx) => { if (ctx.arg) {findChar(ctx, true, false, ctx.arg);} },
	find_char_back: (ctx) => { if (ctx.arg) {findChar(ctx, false, false, ctx.arg);} },
	till_char: (ctx) => { if (ctx.arg) {findChar(ctx, true, true, ctx.arg);} },
	till_char_back: (ctx) => { if (ctx.arg) {findChar(ctx, false, true, ctx.arg);} },
	find_repeat: (ctx) => findRepeat(ctx, false),
	find_repeat_rev: (ctx) => findRepeat(ctx, true),
	select_line: selectLine,
	select_line_up: selectLineUp,
	select_all: selectAll,
	toggle_select: toggleSelect,
	select_matches: selectMatches,
	split_selection: splitSelection,
	delete: deleteOp,
	change: changeOp,
	yank: yankOp,
	paste_after: pasteAfter,
	paste_before: pasteBefore,
	insert_start: insertStart,
	insert_after: insertAfter,
	insert_line_start: insertLineStart,
	insert_line_end: insertLineEnd,
	open_below: openBelow,
	open_above: openAbove,
	undo,
	redo,
	escape: escapeToNormal,
	goto_definition: execVsCmd('editor.action.revealDefinition'),
	goto_type_definition: execVsCmd('editor.action.goToTypeDefinition'),
	goto_references: execVsCmd('editor.action.referenceSearch.trigger'),
	hover: execVsCmd('editor.action.showHover'),
	leader_file: execVsCmd('workbench.action.quickOpen'),
	leader_buffer: execVsCmd('workbench.action.showAllEditorsByMostRecentlyUsed'),
	leader_symbol: execVsCmd('workbench.action.gotoSymbol'),
	leader_search: execVsCmd('workbench.action.findInFiles'),
	reveal_center: reveal(true),
	reveal_top: reveal(false, true),
	reveal_bottom: reveal(false, false),
	// text objects & surround (Phase 7)
	text_object_inner: textObjectInner,
	text_object_around: textObjectAround,
	surround_add: surroundAdd,
	surround_replace: surroundReplace,
	surround_delete: surroundDelete,
	// window management (Phase 8)
	win_split_v: winSplitV,
	win_split_h: winSplitH,
	win_focus_left: winFocusLeft,
	win_focus_right: winFocusRight,
	win_focus_up: winFocusUp,
	win_focus_down: winFocusDown,
	win_close: winClose,
	win_new: winNew,
	// half-page scroll (Ctrl-d / Ctrl-u)
	scroll_down: scrollDown,
	scroll_up: scrollUp,
	// collapse multi-cursors
	collapse_cursors: collapseCursors,
	// g-prefix buffer nav
	next_editor: nextEditor,
	prev_editor: prevEditor,
	navigate_back: navigateBack,
	navigate_forward: navigateForward,
	toggle_explorer: toggleExplorer,
};

// Actions that capture the next N typed keys as arguments (find/till/surround/text-objects).
export const CAPTURE_ACTIONS: Record<string, number> = {
	find_char: 1, find_char_back: 1, till_char: 1, till_char_back: 1,
	surround_add: 1, surround_replace: 2, surround_delete: 1,
	text_object_inner: 1, text_object_around: 1,
};

// Keys that begin a multi-key sequence (the dispatcher waits for more).
export const PREFIX_KEYS = new Set(['g', 'm', 'z', 'Z', '<space>', '"', '<C-w>']);
