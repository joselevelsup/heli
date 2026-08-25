import * as vscode from 'vscode';

export type Mode = 'normal' | 'insert' | 'select';

export const MODE_CONTEXT_KEY = 'helix.mode';

/**
 * Holds the current mode and mirrors it into a VS Code context key so
 * `package.json` `when` clauses can route non-printable keys. Also keeps a
 * status bar indicator (NOR / INS / SEL) with theme-aware colors and switches
 * cursor style per mode.
 */
export class ModeManager implements ModeLike {
	private mode: Mode = 'normal';
	private readonly status: vscode.StatusBarItem;

	constructor(context: vscode.ExtensionContext) {
		this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.status.show();
		context.subscriptions.push(this.status);
		void vscode.commands.executeCommand('setContext', MODE_CONTEXT_KEY, this.mode);
		this.refresh();
	}

	get current(): Mode { return this.mode; }

	set(mode: Mode): void {
		if (this.mode === mode) { return; }
		this.mode = mode;
		void vscode.commands.executeCommand('setContext', MODE_CONTEXT_KEY, mode);
		this.refresh();
	}

	refresh(): void {
		const colors = vscode.workspace.getConfiguration('heli').get<boolean>('modeIndicatorColors', true);
		this.status.text = this.mode === 'normal' ? 'NOR' : this.mode === 'insert' ? 'INS' : 'SEL';
		this.status.tooltip = `Helix mode: ${this.mode}`;
		if (colors) {
			// ponytail: fixed theme-aware-ish colors; not reacting to theme changes.
			// Upgrade path: pick from theme background via `editorGutter.background` contrast.
			this.status.backgroundColor =
				this.mode === 'insert' ? new vscode.ThemeColor('statusBarItem.prominentBackground')
				: this.mode === 'select' ? new vscode.ThemeColor('statusBarItem.warningBackground')
				: undefined;
		} else {
			this.status.backgroundColor = undefined;
		}
		const ed = vscode.window.activeTextEditor;
		if (ed) {
			ed.options.cursorStyle = this.mode === 'insert'
				? vscode.TextEditorCursorStyle.Line
				: vscode.TextEditorCursorStyle.Block;
		}
	}
}

// Interface re-exported for actions.ts to avoid a concrete-class dependency.
export interface ModeLike {
	readonly current: Mode;
	set(mode: Mode): void;
}
