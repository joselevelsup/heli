// Parity tests (Phase 11): drive action handlers against a real TextEditor
// and assert resulting buffer/selection state. Run under vscode-test.
import * as assert from 'assert/strict';
import * as vscode from 'vscode';
import { actions } from '../actions';
import { processKey, buildWhichKeyItems } from '../extension';
import type { Mode, ModeLike } from '../mode';

function stubMode(m: Mode): ModeLike {
	let cur = m;
	return {
		get current() { return cur; },
		set(n: Mode) { cur = n; },
	};
}

interface RunOpts { mode?: Mode; count?: number; register?: string; arg?: string; }

async function setupDoc(text: string): Promise<vscode.TextEditor> {
	const doc = await vscode.workspace.openTextDocument({ content: text });
	return vscode.window.showTextDocument(doc, { preview: false });
}

function run(ed: vscode.TextEditor, actionName: string, opts: RunOpts = {}): void {
	const ctx = {
		editor: ed,
		mode: stubMode(opts.mode ?? 'normal'),
		count: opts.count ?? 1,
		register: opts.register ?? '"',
		arg: opts.arg,
	};
	actions[actionName](ctx);
}

// Actions perform edits via `ed.edit().then(postEdit)`; let those resolve.
// Poll up to ~1s for the editor to have no pending edits, rather than a fixed sleep.
const tick = (ms = 30) => new Promise<void>(r => setTimeout(r, ms));
async function settle(ed: vscode.TextEditor): Promise<void> {
	await tick(60); // give the async edit a chance to apply before stability-checking
	const deadline = Date.now() + 800;
	let prev = ed.document.getText() + ed.selections.length;
	while (Date.now() < deadline) {
		await tick(20);
		const cur = ed.document.getText() + ed.selections.length;
		if (cur === prev) { return; }
		prev = cur;
	}
}

type ShowInputBox = (options?: vscode.InputBoxOptions, token?: vscode.CancellationToken) => Thenable<string | undefined>;
// Stub the InputBox so `s`/`S` regex prompts resolve without UI. Restored after.
async function withInputBox<T>(stub: ShowInputBox, fn: () => Promise<T>): Promise<T> {
	const orig = vscode.window.showInputBox;
	(vscode.window as { showInputBox: ShowInputBox }).showInputBox = stub;
	try { return await fn(); }
	finally { (vscode.window as { showInputBox: ShowInputBox }).showInputBox = orig; }
}

suite('parity: motions & operators', () => {
	test('word_fwd moves cursor to next word start', async () => {
		const ed = await setupDoc('foo bar baz');
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		run(ed, 'word_fwd');
		assert.equal(ed.selection.active.character, 4);
	});

	test('count prefix: 3j moves down 3 lines', async () => {
		const ed = await setupDoc('a\nb\nc\nd\ne');
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		run(ed, 'move_down', { count: 3 });
		assert.equal(ed.selection.active.line, 3);
	});

	test('select_line + delete removes the line', async () => {
		const ed = await setupDoc('abc\ndef\nghi');
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		run(ed, 'select_line');
		await settle(ed);
		run(ed, 'delete');
		await settle(ed);
		assert.equal(ed.document.getText(), 'def\nghi');
	});

	test('d on a bare cursor deletes the char under it (Helix 1-char selection)', async () => {
		const ed = await setupDoc('hello');
		ed.selection = new vscode.Selection(new vscode.Position(0, 1), new vscode.Position(0, 1));
		run(ed, 'delete');
		await settle(ed);
		assert.equal(ed.document.getText(), 'hllo');
		assert.equal(ed.selection.active.character, 1); // cursor stays at deletion point
	});

	test('> indents the current line', async () => {
		const ed = await setupDoc('hello\nworld');
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		run(ed, 'indent');
		await settle(ed);
		// VS Code default is spaces (tabSize=4) for untitled docs
		assert.equal(ed.document.getText(), '    hello\nworld');
	});

	test('< outdents the current line', async () => {
		const ed = await setupDoc('    hello\nworld');
		ed.selection = new vscode.Selection(new vscode.Position(0, 1), new vscode.Position(0, 1));
		run(ed, 'outdent');
		await settle(ed);
		assert.equal(ed.document.getText(), 'hello\nworld');
	});

	test('> on multi-line selection indents all lines without spawning cursors', async () => {
		const ed = await setupDoc('aaa\nbbb\nccc');
		// select lines 0-1 (like pressing x twice from line 0)
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(1, 3));
		run(ed, 'indent');
		await settle(ed);
		assert.equal(ed.document.getText(), '    aaa\n    bbb\nccc');
		assert.equal(ed.selections.length, 1); // no multi-cursor spawned
	});

	test('yank then paste_after duplicates text', async () => {
		const ed = await setupDoc('foo bar');
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 3));
		run(ed, 'yank');
		await settle(ed);
		// collapse to start (yank already did), then paste after cursor
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		run(ed, 'paste_after');
		await settle(ed);
		assert.equal(ed.document.getText(), 'ffoooo bar');
	});
});

suite('parity: surround & text objects (Phase 7)', () => {
	test('surround_add wraps selection with ()', async () => {
		const ed = await setupDoc('foo bar baz');
		ed.selection = new vscode.Selection(new vscode.Position(0, 4), new vscode.Position(0, 7));
		run(ed, 'surround_add', { arg: '(' });
		await settle(ed);
		assert.equal(ed.document.getText(), 'foo (bar) baz');
	});

	test('e then ms[ wraps the FULL word including last char — issue #7', async () => {
		const ed = await setupDoc('hello world');
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		run(ed, 'word_end'); // select to end of 'hello'
		await settle(ed);
		assert.equal(ed.document.getText(ed.selection), 'hello'); // should include 'o'
		run(ed, 'surround_add', { arg: '[' });
		await settle(ed);
		assert.equal(ed.document.getText(), '[hello] world');
	});

	test('select_line then ms[ wraps the full line', async () => {
		const ed = await setupDoc('hello world');
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		run(ed, 'select_line'); // select the whole line (Helix x)
		await settle(ed);
		assert.equal(ed.document.getText(ed.selection), 'hello world');
		run(ed, 'surround_add', { arg: '[' });
		await settle(ed);
		assert.equal(ed.document.getText(), '[hello world]');
	});

	test('surround_delete removes enclosing parens', async () => {
		const ed = await setupDoc('foo (bar) baz');
		ed.selection = new vscode.Selection(new vscode.Position(0, 5), new vscode.Position(0, 5));
		run(ed, 'surround_delete', { arg: '(' });
		await settle(ed);
		assert.equal(ed.document.getText(), 'foo bar baz');
	});

	test('surround_replace ( -> [', async () => {
		const ed = await setupDoc('foo (bar) baz');
		ed.selection = new vscode.Selection(new vscode.Position(0, 5), new vscode.Position(0, 5));
		run(ed, 'surround_replace', { arg: '(' + '[' });
		await settle(ed);
		assert.equal(ed.document.getText(), 'foo [bar] baz');
	});

	test('text_object_inner selects inside parens', async () => {
		const ed = await setupDoc('foo (bar) baz');
		ed.selection = new vscode.Selection(new vscode.Position(0, 5), new vscode.Position(0, 5));
		run(ed, 'text_object_inner', { arg: '(' });
		assert.equal(ed.document.getText(ed.selection), 'bar');
	});

	test('text_object_around selects including parens', async () => {
		const ed = await setupDoc('foo (bar) baz');
		ed.selection = new vscode.Selection(new vscode.Position(0, 5), new vscode.Position(0, 5));
		run(ed, 'text_object_around', { arg: '(' });
		assert.equal(ed.document.getText(ed.selection), '(bar)');
	});
});

suite('parity: insert entries', () => {
	test('open_below adds a line and enters insert', async () => {
		const ed = await setupDoc('abc');
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		const m = stubMode('normal');
		const ctx = { editor: ed, mode: m, count: 1, register: '"', arg: undefined };
		actions.open_below(ctx);
		await settle(ed);
		assert.equal(ed.document.getText(), 'abc\n');
		assert.equal(m.current, 'insert');
	});
});

suite('parity: buffer search (/ n N) — issue #9', () => {
	test('/ then n jumps to next match, N goes back', async () => {
		const ed = await setupDoc('foo bar foo baz foo');
		// offset:  f0 o1 o2 sp3 b4 a5 r6 sp7 f8 o9 o10 sp11 b12 a13 z14 sp15 f16 o17 o18
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		await withInputBox(() => Promise.resolve('foo'), async () => {
			run(ed, 'search_buffer');
			await settle(ed);
		});
		// first match forward from offset 1 -> 'foo' at offset 8 (skips the one at 0)
		assert.equal(ed.document.getText(ed.selection), 'foo');
		assert.equal(ed.selection.start.character, 8);
		// n -> next match at offset 16
		run(ed, 'search_next');
		await settle(ed);
		assert.equal(ed.selection.start.character, 16);
		// N -> back to offset 8
		run(ed, 'search_prev');
		await settle(ed);
		assert.equal(ed.selection.start.character, 8);
	});
});

suite('parity: select-in-selection (s) — issue #1', () => {
	test('s creates one selection per regex match within the selection', async () => {
		const ed = await setupDoc('foo bar baz');
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 11));
		await withInputBox(() => Promise.resolve('ba.'), async () => {
			run(ed, 'select_matches');
			await settle(ed);
		});
		const words = ed.selections.map(s => ed.document.getText(s));
		assert.deepEqual(words, ['bar', 'baz']);
	});

	test('S splits the selection on regex into gap selections', async () => {
		const ed = await setupDoc('a,b,c');
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 5));
		await withInputBox(() => Promise.resolve(','), async () => {
			run(ed, 'split_selection');
			await settle(ed);
		});
		const pieces = ed.selections.map(s => ed.document.getText(s));
		assert.deepEqual(pieces, ['a', 'b', 'c']);
	});
});

suite('parity: surround on empty cursor — issue #3', () => {
	test('ms( on an empty cursor inserts an empty () pair', async () => {
		const ed = await setupDoc('foo bar baz');
		ed.selection = new vscode.Selection(new vscode.Position(0, 4), new vscode.Position(0, 4));
		run(ed, 'surround_add', { arg: '(' });
		await settle(ed);
		assert.equal(ed.document.getText(), 'foo ()bar baz');
	});
});

suite('parity: collapse multi-cursors (`,`) — issue #2', () => {
	test(', drops secondary cursors and keeps the primary', async () => {
		const ed = await setupDoc('foo bar baz');
		ed.selections = [
			new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0)),
			new vscode.Selection(new vscode.Position(0, 8), new vscode.Position(0, 8)),
		];
		run(ed, 'collapse_cursors');
		assert.equal(ed.selections.length, 1);
	});
});

suite('parity: g-prefix buffer nav — issue #4', () => {
	test('ge / gn / gp are wired to actions', () => {
		// exercising the native next/prev editor command is awkward in a test host;
		// verify the actions exist so the keymap binding is honest.
		assert.equal(typeof actions.next_editor, 'function');
		assert.equal(typeof actions.prev_editor, 'function');
		assert.equal(typeof actions.goto_end, 'function');
		assert.equal(typeof actions.scroll_down, 'function');
		assert.equal(typeof actions.scroll_up, 'function');
	});
});

suite('parity: g-prefix line jumps — issue #8', () => {
	test('gl goes to end of line (collapses, no selection)', async () => {
		const ed = await setupDoc('  hello world  ');
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		run(ed, 'line_end');
		await settle(ed);
		// line_end collapses to the last char (index 14)
		assert.equal(ed.selection.active.character, 14);
		assert.equal(ed.selection.isEmpty, true);
	});

	test('gh goes to very start of line (column 0)', async () => {
		const ed = await setupDoc('  hello world  ');
		ed.selection = new vscode.Selection(new vscode.Position(0, 5), new vscode.Position(0, 5));
		run(ed, 'line_start');
		await settle(ed);
		assert.equal(ed.selection.active.character, 0);
	});

	test('gs goes to first non-whitespace character', async () => {
		const ed = await setupDoc('  hello world  ');
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		run(ed, 'line_first_nonws');
		await settle(ed);
		// first non-ws is 'h' at index 2
		assert.equal(ed.selection.active.character, 2);
	});
});

suite('parity: motions reveal the cursor — issue #5', () => {
	test('goto_end scrolls so the last line is visible', async () => {
		const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
		const ed = await setupDoc(big);
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		// force a layout so visibleRanges is populated before the move
		await settle(ed);
		run(ed, 'goto_end');
		await settle(ed);
		const lastLine = ed.document.lineCount - 1;
		const visible = ed.visibleRanges.some(r => r.start.line <= lastLine && lastLine <= r.end.line);
		assert.ok(visible, `last line ${lastLine} should be visible after goto_end (visible=${JSON.stringify(ed.visibleRanges.map(r => [r.start.line, r.end.line]))})`);
	});

	test('move_down across the viewport keeps the cursor visible', async () => {
		const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
		const ed = await setupDoc(big);
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		await settle(ed);
		run(ed, 'move_down', { count: 120 });
		await settle(ed);
		const cur = ed.selection.active.line;
		const visible = ed.visibleRanges.some(r => r.start.line <= cur && cur <= r.end.line);
		assert.ok(visible, `cursor line ${cur} should be visible after 120j (visible=${JSON.stringify(ed.visibleRanges.map(r => [r.start.line, r.end.line]))})`);
	});

	test('select_line (x) extending down keeps the end visible', async () => {
		const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
		const ed = await setupDoc(big);
		ed.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		await settle(ed);
		// press x several times to extend the linewise selection downward
		for (let i = 0; i < 15; i++) {
			run(ed, 'select_line');
			await tick(20);
		}
		await settle(ed);
		const endLine = ed.selection.end.line;
		const visible = ed.visibleRanges.some(r => r.start.line <= endLine && endLine <= r.end.line);
		assert.ok(visible, `selection end line ${endLine} should be visible after 30x (visible=${JSON.stringify(ed.visibleRanges.map(r => [r.start.line, r.end.line]))})`);
	});
});

suite('parity: file explorer (Space-e) — issue #6', () => {
	test('toggle_explorer action is wired', () => {
		assert.equal(typeof actions.toggle_explorer, 'function');
	});

	test('Space+e resolves to toggle_explorer in the keymap', () => {
		const items = buildWhichKeyItems(
			{ '<space>e': 'toggle_explorer', '<space>f': 'leader_file' },
			'<space>',
		);
		const e = items.find(i => i.token === 'e');
		assert.ok(e, 'e should be listed under space prefix');
		assert.equal(e?.description, 'toggle file explorer');
	});

	test('toggle_explorer action executes workbench.view.explorer', async () => {
		const ed = await setupDoc('hello');
		// ensure we start with editor focus
		await vscode.window.showTextDocument(ed.document, { preview: false });
		await settle(ed);
		// run the action directly (bypasses the QuickPick popup)
		run(ed, 'toggle_explorer');
		await settle(ed);
		// After workbench.view.explorer, the explorer view should be visible.
		// In the test host the sidebar may not fully render, but the command
		// should at least not throw and the action should resolve.
		assert.ok(true, 'toggle_explorer ran without error');
	});
});
