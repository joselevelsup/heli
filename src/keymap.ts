// Default keymap, modelled on Helix's default keymap.
// Keys are tokens: printable chars are themselves; special keys use <...>:
//   <space> <esc> <cr> <bs> <del> <up> <down> <left> <right> <home> <end> <pageup> <pagedown> <C-w>
// Multi-key sequences concatenate tokens (e.g. "gg", "mm", "<space>f", "<C-w>s").
// This is pure data so Phase 9 user remaps (config.toml) can layer onto it.

export const keymap: Record<string, Record<string, string>> = {
	normal: {
		h: 'move_left', j: 'move_down', k: 'move_up', l: 'move_right',
		'<left>': 'move_left', '<down>': 'move_down', '<up>': 'move_up', '<right>': 'move_right',
		'0': 'line_start', '^': 'line_first_nonws', '$': 'line_end',
		'<home>': 'line_first_nonws', '<end>': 'line_end',
		w: 'word_fwd', b: 'word_back', e: 'word_end',
		W: 'WORD_fwd', B: 'WORD_back', E: 'WORD_end',
		G: 'goto_end', 'gg': 'goto_start', 'ge': 'goto_end',
		'gn': 'next_editor', 'gp': 'prev_editor',
		'{': 'paragraph_prev', '}': 'paragraph_next',
		'%': 'select_all',
		f: 'find_char', F: 'find_char_back', t: 'till_char', T: 'till_char_back',
		';': 'find_repeat',
		',': 'collapse_cursors', // drop all secondary cursors, keep primary
		x: 'select_line', X: 'select_line_up', v: 'toggle_select', V: 'select_line',
		s: 'select_matches', S: 'split_selection',
		d: 'delete', c: 'change', y: 'yank', p: 'paste_after', P: 'paste_before',
		i: 'insert_start', a: 'insert_after', I: 'insert_line_start', A: 'insert_line_end',
		o: 'open_below', O: 'open_above',
		u: 'undo', U: 'redo',
		'>': 'indent', '<': 'outdent',
		// g prefix (Phase 6)
		'gd': 'goto_definition', 'gD': 'goto_type_definition', 'gr': 'goto_references', 'gh': 'hover',
		// match mode `m` (Phase 7)
		'mm': 'match_bracket',
		'ms': 'surround_add', 'mr': 'surround_replace', 'md': 'surround_delete',
		'mi': 'text_object_inner', 'ma': 'text_object_around',
		// view mode z / sticky Z (Phase 6)
		'zz': 'reveal_center', 'zt': 'reveal_top', 'zb': 'reveal_bottom',
		'Zt': 'reveal_top', 'Zb': 'reveal_bottom', 'Zz': 'reveal_center',
		// space leader (Phase 5)
		'<space>f': 'leader_file', '<space>b': 'leader_buffer',
		'<space>e': 'toggle_explorer',
		'<space>s': 'leader_symbol', '<space><space>': 'leader_search',
		// window mode Ctrl-w (Phase 8)
		'<C-w>s': 'win_split_h', '<C-w>v': 'win_split_v', '<C-w>c': 'win_close', '<C-w>q': 'win_close',
		'<C-w>n': 'win_new',
		'<C-w>h': 'win_focus_left', '<C-w>l': 'win_focus_right',
		'<C-w>k': 'win_focus_up', '<C-w>j': 'win_focus_down',
		'<C-w><left>': 'win_focus_left', '<C-w><right>': 'win_focus_right',
		'<C-w><up>': 'win_focus_up', '<C-w><down>': 'win_focus_down',
		'<C-d>': 'scroll_down', '<C-u>': 'scroll_up',
		'<C-o>': 'navigate_back', '<C-i>': 'navigate_forward',
	},
	select: {
		h: 'move_left', j: 'move_down', k: 'move_up', l: 'move_right',
		'<left>': 'move_left', '<down>': 'move_down', '<up>': 'move_up', '<right>': 'move_right',
		'0': 'line_start', '^': 'line_first_nonws', '$': 'line_end',
		'<home>': 'line_first_nonws', '<end>': 'line_end',
		w: 'word_fwd', b: 'word_back', e: 'word_end',
		W: 'WORD_fwd', B: 'WORD_back', E: 'WORD_end',
		G: 'goto_end', 'gg': 'goto_start', 'ge': 'goto_end',
		'gn': 'next_editor', 'gp': 'prev_editor',
		'{': 'paragraph_prev', '}': 'paragraph_next',
		'%': 'select_all',
		f: 'find_char', F: 'find_char_back', t: 'till_char', T: 'till_char_back',
		';': 'find_repeat',
		',': 'collapse_cursors',
		x: 'select_line', X: 'select_line_up', v: 'toggle_select',
		s: 'select_matches', S: 'split_selection',
		d: 'delete', c: 'change', y: 'yank', p: 'paste_after', P: 'paste_before',
		i: 'insert_start', a: 'insert_after', I: 'insert_line_start', A: 'insert_line_end',
		o: 'open_below', O: 'open_above',
		u: 'undo', U: 'redo',
		'>': 'indent', '<': 'outdent',
		'mm': 'match_bracket',
		'ms': 'surround_add', 'mr': 'surround_replace', 'md': 'surround_delete',
		'mi': 'text_object_inner', 'ma': 'text_object_around',
		'gd': 'goto_definition', 'gh': 'hover',
		'<space>e': 'toggle_explorer',
		'zz': 'reveal_center', 'zt': 'reveal_top', 'zb': 'reveal_bottom',
		'<C-d>': 'scroll_down', '<C-u>': 'scroll_up',
		'<C-o>': 'navigate_back', '<C-i>': 'navigate_forward',
		'<esc>': 'escape',
	},
};

// Macros (Q/q) and <esc> are handled directly in the dispatcher before the
// keymap is consulted, so they are intentionally absent from these tables.
// In normal mode, <esc> cancels any pending sequence first.

// Human-readable action descriptions for the which-key popup.
export const descriptions: Record<string, string> = {
	move_left: 'move left', move_right: 'move right', move_down: 'move down', move_up: 'move up',
	line_start: 'line start', line_first_nonws: 'first non-whitespace', line_end: 'line end',
	word_fwd: 'next word', word_back: 'prev word', word_end: 'next word end',
	WORD_fwd: 'next WORD', WORD_back: 'prev WORD', WORD_end: 'next WORD end',
	goto_start: 'go to file start', goto_end: 'go to file end',
	paragraph_next: 'next paragraph', paragraph_prev: 'prev paragraph',
	match_bracket: 'match bracket',
	find_char: 'find char', find_char_back: 'find char back', till_char: 'till char', till_char_back: 'till char back',
	find_repeat: 'repeat find', find_repeat_rev: 'reverse find',
	select_line: 'select line', select_line_up: 'extend line up', select_all: 'select whole buffer',
	toggle_select: 'toggle select mode', collapse_cursors: 'collapse cursors',
	select_matches: 'select on regex', split_selection: 'split on regex',
	delete: 'delete selection', change: 'change selection', yank: 'yank selection',
	paste_after: 'paste after', paste_before: 'paste before',
	insert_start: 'insert before sel', insert_after: 'insert after sel',
	insert_line_start: 'insert at line start', insert_line_end: 'insert at line end',
	open_below: 'open line below', open_above: 'open line above',
	undo: 'undo', redo: 'redo', escape: 'exit to normal',
	indent: 'indent line', outdent: 'outdent line',
	goto_definition: 'go to definition', goto_type_definition: 'go to type def',
	goto_references: 'go to references', hover: 'show hover',
	leader_file: 'file picker', leader_buffer: 'buffer picker',
	leader_symbol: 'symbol picker', leader_search: 'global search',
	reveal_center: 'cursor to center', reveal_top: 'cursor to top', reveal_bottom: 'cursor to bottom',
	win_split_v: 'split right', win_split_h: 'split down',
	win_focus_left: 'focus left', win_focus_right: 'focus right',
	win_focus_up: 'focus up', win_focus_down: 'focus down',
	win_close: 'close editor', win_new: 'new editor group',
	scroll_down: 'half page down', scroll_up: 'half page up',
	next_editor: 'next buffer', prev_editor: 'prev buffer',
	navigate_back: 'jump back', navigate_forward: 'jump forward',
	toggle_explorer: 'toggle file explorer',
	surround_add: 'surround add', surround_replace: 'surround replace', surround_delete: 'surround delete',
	text_object_inner: 'select inside', text_object_around: 'select around',
};

// Display form for a key token in the popup.
export function prettyToken(tok: string): string {
	switch (tok) {
		case '<space>': return 'Space';
		case '<esc>': return 'Esc';
		case '<cr>': return 'Enter';
		case '<bs>': return 'Backspace';
		case '<del>': return 'Delete';
		case '<up>': return '↑'; case '<down>': return '↓';
		case '<left>': return '←'; case '<right>': return '→';
		case '<home>': return 'Home'; case '<end>': return 'End';
		case '<pageup>': return 'PgUp'; case '<pagedown>': return 'PgDn';
		case '<C-w>': return 'C-w'; case '<C-d>': return 'C-d'; case '<C-u>': return 'C-u';
		default: return tok;
	}
}
