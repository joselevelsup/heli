import * as vscode from 'vscode';
import { ModeManager, ModeLike } from './mode';
import { actions, CAPTURE_ACTIONS, PREFIX_KEYS, Ctx } from './actions';
import { keymap, descriptions, prettyToken } from './keymap';

let mode: ModeManager;
let enabled = true;

// Effective keymap: default merged with user remaps from settings.json.
let effectiveKeymap: Record<string, Record<string, string>> = { ...keymap };

// Prefixes that open the which-key popup (not `"`, which awaits a register name).
// Dynamic: any key sequence that has children in the effective keymap is a prefix.
function hasChildren(map: Record<string, string>, prefix: string): boolean {
	for (const key of Object.keys(map)) {
		if (key.startsWith(prefix) && key.length > prefix.length) { return true; }
	}
	return false;
}

// --- keystroke processor state (normal/select mode) ------------------------
let countStr = '';
let keyBuf = '';
let pendingRegister: string | null = null;
let awaitingRegister = false;
let pendingCapture: { action: string; count: number; register: string; chars: string[]; need: number } | null = null;

// --- macro recording (Phase 10) --------------------------------------------
// ponytail: single macro slot, not per-register. Upgrade path: named macro
// registers if multi-slot recording is needed.
let recording = false;
let macroBuffer: string[] = [];

function resetState(): void {
	countStr = '';
	keyBuf = '';
	pendingRegister = null;
	awaitingRegister = false;
	pendingCapture = null;
}

function dispatch(actionName: string, count: number, register: string): void {
	const fn = actions[actionName];
	if (fn) {
		const ed = vscode.window.activeTextEditor;
		if (!ed) { return; }
		const ctx: Ctx = { editor: ed, mode: mode as ModeLike, count, register, arg: undefined };
		fn(ctx);
		return;
	}
	// Not a heli action — treat it as a VS Code command ID (e.g. magit.status).
	// This lets users bind any installed extension's command via heli.keybindings.
	void vscode.commands.executeCommand(actionName);
}

/** Resolve an action name: if it captures target char(s), set pendingCapture;
 *  otherwise dispatch immediately. Always clears the count/register buffer. */
function commitAction(actionName: string, count: number, register: string): void {
	const need = CAPTURE_ACTIONS[actionName];
	if (need) {
		pendingCapture = { action: actionName, count, register, chars: [], need };
		keyBuf = '';
		countStr = '';
		pendingRegister = null;
		return;
	}
	dispatch(actionName, count, register);
	resetState();
}

/** Feed one logical key token into the processor. `replay` suppresses recording. */
export function processKey(token: string, replay = false): void {
	const ed = vscode.window.activeTextEditor;
	if (!ed) { return; }

	if (recording && !replay) { macroBuffer.push(token); }

	// Esc works from any mode: cancel pending state, collapse to head, normal.
	if (token === '<esc>') {
		if (pendingCapture || awaitingRegister || keyBuf !== '' || countStr !== '') {
			// first Esc cancels a pending sequence rather than escaping mode
			if (pendingCapture || awaitingRegister || keyBuf !== '') {
				resetState();
				return;
			}
		}
		const ctx: Ctx = { editor: ed, mode: mode as ModeLike, count: 1, register: '"', arg: undefined };
		actions.escape(ctx);
		resetState();
		return;
	}

	// Capture target char(s) for find/till/surround/text-objects.
	if (pendingCapture) {
		const pc = pendingCapture;
		if (token.startsWith('<') && token !== '<space>') {
			// special key cancels the capture
			resetState();
			return;
		}
		const ch = token === '<space>' ? ' ' : token;
		pc.chars.push(ch);
		if (pc.chars.length < pc.need) { return; }
		pendingCapture = null;
		const ctx: Ctx = { editor: ed, mode: mode as ModeLike, count: pc.count, register: pc.register, arg: pc.chars.join('') };
		actions[pc.action]?.(ctx);
		return;
	}

	// Only meaningful in normal/select; insert is handled by `type` passthrough.
	if (mode.current === 'insert') { return; }

	// ':' opens command mode (only when not mid-sequence).
	if (token === ':' && keyBuf === '' && countStr === '' && !awaitingRegister) {
		resetState();
		void openCommandMode();
		return;
	}

	// Register prefix: " then the next key is the register name.
	if (awaitingRegister) {
		pendingRegister = token === '<space>' ? ' ' : token;
		awaitingRegister = false;
		return;
	}
	if (token === '"' && keyBuf === '') {
		awaitingRegister = true;
		return;
	}

	// Macro toggle/replay: Q records, q replays (Helix default).
	if (keyBuf === '' && countStr === '' && !pendingRegister) {
		if (token === 'Q') {
			if (recording) {
				recording = false;
				// drop the trailing 'Q' that started... actually keep; fine
				void vscode.window.setStatusBarMessage('heli: macro recorded');
			} else {
				recording = true;
				macroBuffer = [];
				void vscode.window.setStatusBarMessage('heli: recording macro…');
			}
			return;
		}
		if (token === 'q') {
			const macro = macroBuffer.slice();
			for (const t of macro) { processKey(t, true); }
			return;
		}
	}

	// Count prefix (digits). '0' is a motion unless already building a count.
	if (keyBuf === '' && /^[0-9]$/.test(token) && (token !== '0' || countStr !== '')) {
		countStr += token;
		return;
	}

	keyBuf += token;

	const map = effectiveKeymap[mode.current];

	// Prefix keys wait for the next key (g, m, z, Z, <space>, ", <C-w>, or any
	// user-defined sub-prefix like <space>o).
	if (PREFIX_KEYS.has(keyBuf)) {
		// `"` just awaits a register name; others open the which-key popup if they have children.
		if (keyBuf !== '"' && hasChildren(map, keyBuf)) {
			const cfg = vscode.workspace.getConfiguration('heli');
			if (!cfg.get<boolean>('whichKey', true)) { return; }
			const prefix = keyBuf;
			const count = countStr ? parseInt(countStr, 10) : 1;
			const reg = pendingRegister ?? '"';
			resetState();
			void openWhichKey(prefix, count, reg);
		}
		return;
	}

	// Also handle user-defined sub-prefixes not in the hardcoded PREFIX_KEYS set
	// (e.g. <space>o). If keyBuf matches a prefix action AND has children, open popup.
	if (hasChildren(map, keyBuf) && !map[keyBuf]) {
		const cfg = vscode.workspace.getConfiguration('heli');
		if (cfg.get<boolean>('whichKey', true)) {
			const prefix = keyBuf;
			const count = countStr ? parseInt(countStr, 10) : 1;
			const reg = pendingRegister ?? '"';
			resetState();
			void openWhichKey(prefix, count, reg);
		}
		return;
	}

	const actionName = map[keyBuf];
	const rawCount = countStr ? parseInt(countStr, 10) : 1;
	const count = Math.min(Math.max(1, rawCount), 9999); // ponytail: cap to avoid editor freeze on huge counts
	if (actionName) {
		commitAction(actionName, count, pendingRegister ?? '"');
		return;
	}
	resetState();
}

// --- config: key remaps live in VS Code settings.json (heli.keybindings) ---
function applyConfig(): void {
	const cfg = vscode.workspace.getConfiguration('heli');
	enabled = cfg.get<boolean>('enabled', true);
	// deep-copy default then layer user remaps from settings.json
	effectiveKeymap = { normal: { ...keymap.normal }, select: { ...keymap.select }, insert: { ...keymap.insert } };
	const remaps = cfg.get<Record<string, Record<string, string>>>('keybindings', {});
	for (const mode of Object.keys(remaps)) {
		const table = effectiveKeymap[mode];
		if (table) { Object.assign(table, remaps[mode]); }
	}
}

// --- which-key popup -------------------------------------------------------
// ponytail: uses a QuickPick, which steals focus briefly. While open, `type`
// isn't routed to us (editor lacks focus), so we read the next key from the
// QuickPick's value via onDidChangeValue and act immediately, then hide it and
// focus returns to the editor. Special keys (arrows/Esc) are handled by the
// QuickPick itself (Esc cancels). Doesn't cover C-... completions typed via
// the popup — those prefixes (only <C-w>) have printable completions though.
// Upgrade path: a focus-preserving webview overlay if the flash is unwanted.
function openWhichKey(prefix: string, count: number, register: string): void {
	const m = mode.current;
	const map = effectiveKeymap[m];
	if (!map) { return; }

	const items = buildWhichKeyItems(map, prefix);
	if (items.length === 0) { return; }

	const qp = vscode.window.createQuickPick();
	qp.title = `heli  ${prettyToken(prefix)}  (${m})`;
	qp.placeholder = 'press a key…';
	qp.items = items;
	qp.matchOnDescription = false;
	qp.matchOnDetail = false;
	qp.ignoreFocusOut = true;
	let settled = false;

	let currentPrefix = prefix; // tracks descent into sub-menus
	const consume = (rawNext: string) => {
		if (settled) { return; }
		const nextTok = rawNext === ' ' ? '<space>' : rawNext;
		const full = currentPrefix + nextTok;
		if (map[full]) {
			settled = true;
			qp.hide();
			// Delay so the QuickPick fully releases focus before the command fires —
			// needed for focus-moving commands like toggle_explorer.
			setTimeout(() => commitAction(map[full], count, register), 50);
		} else if (hasChildren(map, full)) {
			// descend into sub-menu
			currentPrefix = full;
			qp.items = buildWhichKeyItems(map, full);
			qp.value = '';
		} else {
			settled = true;
			qp.hide();
			resetState();
		}
	};

	qp.onDidChangeValue(v => { if (v.length > 0) { consume(v[0]); } });
	qp.onDidAccept(() => {
		const it = qp.activeItems[0] as WhichKeyItem | undefined;
		if (it) { consume(it.token); }
	});
	qp.onDidHide(() => { if (!settled) { resetState(); } qp.dispose(); });
	qp.show();
}

export interface WhichKeyItem extends vscode.QuickPickItem { token: string }

export function buildWhichKeyItems(map: Record<string, string>, prefix: string): WhichKeyItem[] {
	// Collect the next single token after `prefix` for every key under it.
	// A token may be a multi-char special key like <space> or <C-w> — extract it.
	const seen = new Map<string, string>(); // token -> action (or '' if it's just a prefix)
	for (const key of Object.keys(map)) {
		if (!key.startsWith(prefix) || key.length <= prefix.length) { continue; }
		const rest = key.slice(prefix.length);
		// extract the first token: either <...> or a single char
		let tok: string;
		if (rest.startsWith('<')) {
			const close = rest.indexOf('>');
			tok = close >= 0 ? rest.slice(0, close + 1) : rest[0];
		} else {
			tok = rest[0];
		}
		// if the whole rest is just this token, it's a leaf action; otherwise it's a prefix
		if (rest === tok) {
			seen.set(tok, map[key]);
		} else if (!seen.has(tok)) {
			seen.set(tok, ''); // prefix only, no direct action
		}
	}
	const items: WhichKeyItem[] = [];
	for (const [tok, action] of seen) {
		items.push({
			token: tok,
			label: prettyToken(tok),
			description: action ? (descriptions[action] ?? action) : '…',
		});
	}
	items.sort((a, b) => a.label.localeCompare(b.label));
	return items;
}

// --- command mode (`:`) -----------------------------------------------------
async function openCommandMode(): Promise<void> {
	const input = await vscode.window.showInputBox({
		prompt: 'Helix command',
		placeHolder: ':w  :o <path>  :q  :wq  :new  :bd  :reload  :rl  :set',
		ignoreFocusOut: false,
	});
	if (input === undefined) { return; }
	await runCommand(input.trim());
}

async function runCommand(line: string): Promise<void> {
	if (!line) { return; }
	const sp = line.indexOf(' ');
	const head = (sp < 0 ? line : line.slice(0, sp)).toLowerCase();
	const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
	switch (head) {
		case 'w': case 'write':
			await vscode.commands.executeCommand('workbench.action.files.save');
			return;
		case 'q': case 'quit':
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
			return;
		case 'wq': case 'x':
			await vscode.commands.executeCommand('workbench.action.files.save');
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
			return;
		case 'o': case 'open': case 'e': case 'edit': {
			if (!rest) { return; }
			const uri = vscode.Uri.file(rest);
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc);
			return;
		}
		case 'new':
			await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
			return;
		case 'bd': case 'bc': case 'buffer-close': case 'q!':
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
			return;
		case 'reload':
			await vscode.commands.executeCommand('workbench.action.files.revert');
			return;
		case 'rl':
			await vscode.commands.executeCommand('workbench.action.reloadWindow');
			return;
		case 'set':
			// ponytail: thin subset only — `:set line-numbers` toggles the VS Code setting.
			return applySet(rest);
		case 'help':
			void vscode.window.showInformationMessage('heli: Helix-style keybindings for VS Code');
			return;
		default:
			void vscode.window.showWarningMessage(`heli: unknown command :${head}`);
	}
}

function applySet(rest: string): void {
	if (!rest) { return; }
	// ponytail: only a couple of common toggles; full :set parity is out of scope.
	const map: Record<string, [string, unknown]> = {
		'number': ['editor.lineNumbers', 'on'],
		'relativenumber': ['editor.lineNumbers', 'relative'],
		'nonumber': ['editor.lineNumbers', 'off'],
	};
	const entry = map[rest.toLowerCase()];
	if (entry) { void vscode.workspace.getConfiguration().update(entry[0], entry[1], vscode.ConfigurationTarget.Global); }
}

// --- `type` interception ----------------------------------------------------
async function onType(args: { text: string }): Promise<void> {
	const ed = vscode.window.activeTextEditor;
	if (!ed || !enabled) {
		return vscode.commands.executeCommand('default:type', args);
	}
	if (mode.current === 'insert') {
		return vscode.commands.executeCommand('default:type', args);
	}
	const token = args.text === ' ' ? '<space>' : args.text;
	processKey(token);
}

export function activate(context: vscode.ExtensionContext): void {
	mode = new ModeManager(context);
	applyConfig();

	const typeCmd = vscode.commands.registerCommand('type', onType);
	const keyCmd = vscode.commands.registerCommand('heli.key', (arg: unknown) => {
		const token = typeof arg === 'string' ? arg : (arg as { key?: string })?.key ?? '';
		if (token) { processKey(token); }
	});
	const toggleCmd = vscode.commands.registerCommand('heli.toggle', () => {
		enabled = !enabled;
		void vscode.workspace.getConfiguration('heli').update('enabled', enabled, vscode.ConfigurationTarget.Global);
		if (!enabled) { mode.set('insert'); } // restore native typing
		void vscode.window.showInformationMessage(`heli ${enabled ? 'enabled' : 'disabled'}`);
	});
	const reloadCmd = vscode.commands.registerCommand('heli.reloadConfig', () => {
		applyConfig();
		void vscode.window.showInformationMessage('heli: keybindings reloaded');
	});
	context.subscriptions.push(typeCmd, keyCmd, toggleCmd, reloadCmd);

	// Reapply cursor style when switching editors; reload config on settings change.
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => mode.refresh()));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('heli')) { applyConfig(); }
	}));
}

export function deactivate(): void { resetState(); recording = false; }
