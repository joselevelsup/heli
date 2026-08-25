# heli

> ⚠️ **NOT YET PUBLISHED** — this extension is still in development and has not
> been published to the VS Code / VSCodium Marketplace. To use it, build and
> install the `.vsix` locally (see [Develop](#develop)).

Helix-style modal keybindings for VS Code. Modal editing with Helix's
**select-first** model, a `:` command line, a `Space` leader layer, match mode
with surround & text objects, `Ctrl-w` window management, settings.json
remapping, and macros — built as a from-scratch extension (not a Dance patch),
delegating LSP and picker work to VS Code's native commands where they're
better.

## Activation & toggling

Activates on startup. In Normal mode, typing letters issues commands instead of
inserting text, like `hx`/Vim. Run **`heli: Toggle Helix keybindings`** from the
command palette to turn it off (drops into Insert mode and stops intercepting
keys). The setting `heli.enabled` persists this.

## Modes

| Mode | Indicator | Cursor | Meaning |
|------|-----------|--------|---------|
| Normal   | `NOR` | block | motions/commands; selections are zero-width cursors |
| Select   | `SEL` | block | motions **extend** the active selection |
| Insert   | `INS` | line  | native VS Code typing |

`Esc` → Normal (collapses selections to the cursor; a first `Esc` cancels any
pending sequence). `v` toggles Select. The indicator is colored per mode when
`heli.modeIndicatorColors` is on.

## What's implemented

| Phase | Area | Keys |
|-------|------|------|
| 1 | Mode engine | `NOR/INS/SEL` indicator, `helix.mode` context key, cursor style |
| 1 | Insert slice | `i a I A o O`, `Esc` |
| 2 | Motions | `h j k l`, `w b e`, `W B E`, `0 ^ $` (`Home`/`End`), `gg G ge`, `{ }`, `%`, `mm`, `Ctrl-d`/`Ctrl-u` half-page, count (`3w`, `12G`) |
| 2 | Find/till | `f F t T <char>`, `;` `,` |
| 2 | Selections | `x` line, `X` extend up, `%` whole buffer, `v` toggle select, `s` select matches, `S` split, `,` collapse cursors, VS Code multi-cursor composes |
| 3 | Operators | `d c y p P`, registers `"<reg>` |
| 3 | Undo/redo | `u U` |
| 4 | Command mode | `:w :write :q :quit :wq :x :o/:open <path> :new :bd/:buffer-close :reload :source :set :help` |
| 5 | Leader | `Space f` files, `Space b` buffers, `Space e` toggle explorer, `Space s` symbols, `Space Space` search |
| 6 | Goto / view | `gd gD gr gh`, `gg` top, `ge` end, `gn`/`gp` next/prev buffer, `Ctrl-o`/`Ctrl-i` jump back/forward, `zz zt zb` (sticky `Zt Zb Zz`) |
| 7 | Match mode | `mm` match bracket, `ms<char>` surround add, `mr<from><to>` replace, `md<char>` delete, `mi<obj>` inner, `ma<obj>` around |
| 7 | Text objects | `w W p ( ) [ ] { } < > " ' \`` |
| 8 | Windows | `Ctrl-w s` split down, `Ctrl-w v` split right, `Ctrl-w h j k l` focus, `Ctrl-w q/c` close, `Ctrl-w n` new |
| 9 | Config | `heli.keybindings` in VS Code `settings.json` (`normal`/`select`/`insert` → key sequence → action); auto-reload on save, or **`heli: Reload keybindings`** |
| 10 | Registers | named `"<reg>`, `*`/`+` → system clipboard |
| 10 | Macros | `Q` record/stop, `q` replay |
| 11 | Polish | theme-aware mode colors, cursor shape per mode |
| 11 | Tests | pure-module + editor parity suite (`pnpm test`, 21 checks) |
| 12 | Packaging | settings, command contributions, keybinding `when`-gating |

## which-key popup

When you press a prefix key — `g`, `m`, `z`, `Z`, `Space`, `Ctrl-w` — a popup
lists the possible next keys and what each does, so you never have to memorize
the sub-key map. Press the next key and the action fires immediately; `Esc`
cancels. Toggle with `heli.whichKey`.

| Prefix | Example popup entries |
|--------|-----------------------|
| `g`    | `g` go to file start · `e` go to file end · `d` go to definition · `n` next buffer · `p` prev buffer |
| `m`    | `m` match bracket · `s` surround add · `r` surround replace · `d` surround delete · `i` select inside · `a` select around |
| `z`    | `z` cursor to center · `t` cursor to top · `b` cursor to bottom |
| `Space`| `f` file picker · `b` buffer picker · `s` symbol picker · `Space` global search |
| `Ctrl-w`| `v` split right · `s` split down · `h/j/k/l` focus · `c` close |

The popup is a VS Code QuickPick, so focus briefly moves to it while you pick
the next key, then returns to the editor. `,` (collapse cursors), `:`
(command mode), and `"<reg>` (register) are not prefix menus.

## File explorer (`Space e` + Helix keys)

Press `Space e` to toggle the sidebar explorer. While the explorer has focus,
helix-style keys work for navigation and file operations (no which-key popup):

| Key | Action |
|-----|--------|
| `j` / `k` | move down / up |
| `h` | collapse folder (or go to parent) |
| `l` | expand folder |
| `Enter` | open file |
| `n` | new file |
| `N` (`Shift+n`) | new folder |
| `d` | delete |
| `r` | rename |
| `y` | copy |
| `p` | paste |
| `H` (`Shift+h`) | collapse all folders |
| `R` (`Shift+r`) | refresh explorer |

These are separate `package.json` keybindings scoped to `filesExplorerFocus`,
so they don't interfere with editor modal keys.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `heli.enabled` | `true` | Intercept keys modally. Off → native VS Code typing. |
| `heli.keybindings` | `{}` | Custom key remaps; object with `normal`/`select`/`insert` maps of key sequence → action name. See below. |
| `heli.modeIndicatorColors` | `true` | Color the `NOR/INS/SEL` indicator per mode. |
| `heli.whichKey` | `true` | Show a which-key popup on prefix keys (`g` `m` `z` `Z` `Space` `Ctrl-w`) listing the next keys + their actions. |

## Key remapping (settings.json)

Remap keys via `heli.keybindings` in your VS Code `settings.json`. Each mode is
an object mapping a key sequence to an action name. Sequences concatenate
tokens; special keys use `<...>`.

```jsonc
"heli.keybindings": {
  "normal": {
    "gg": "goto_start",
    "ge": "goto_end",
    "<space>f": "leader_file",
    "<C-w>v": "win_split_v"
  },
  "select": {
    "%": "select_all"
  }
}
```

Special-key tokens: `<space>` `<esc>` `<cr>` `<bs>` `<del>` `<up>` `<down>`
`<left>` `<right>` `<home>` `<end>` `<pageup>` `<pagedown>` `<C-w>` `<C-d>` `<C-u>`.

Changes apply automatically when you save `settings.json`, or run the
**`heli: Reload keybindings`** command.

## Known gaps / intentionally different

- **`d`/`c`/`y` on a bare cursor act on the character under it** (Helix treats
  a cursor as a 1-char selection). Select first (`x`, `mi`/`ma`, a motion) to
  operate on a larger range. Helix has no operator+motion.
- **No insert-session undo coalescing** — each edit is one VS Code undo step
  (Helix coalesces an insert session into one step).
- **Macros are a single slot**, not per-register.
- **No config.toml** — remapping is via `heli.keybindings` in `settings.json`.
- **LSP commands delegate to VS Code** (`gd` etc.) rather than reimplementing.
- **`Ctrl-w` chord** is captured via a `ctrl+w` keybinding routed to `heli.key`,
  then the next key completes it; VS Code's own `Ctrl-W` (close window) is
  overridden only while helix is active in Normal/Select mode.
- **Not conflict-audited against VSCodeVim** — don't run both at once (both
  intercept `type`).

## Architecture

```
src/
  motions.ts      pure motion helpers (word/bracket/line) + self-check
  textobjects.ts  pure text-object + surround helpers + self-check
  config.ts       (removed — remapping now lives in settings.json)
  mode.ts         ModeManager: state + `helix.mode` context key + status bar + cursor style
  actions.ts      action handlers (motions, selections, operators, surround,
                  text objects, insert, windows, delegates) + registry + capture map
  keymap.ts       default keymap tables (mode -> key sequence -> action name)
  extension.ts    activation, `type` interception, keystroke state machine,
                  `:` command mode, macros, config loading
  test/           mocha: pure-module tests + editor parity tests
```

The keystroke processor parses a count prefix, then a key sequence (handling
prefix keys `g m z Z Space " Ctrl-w`), resolves it through the effective keymap
(default merged with `heli.keybindings` overrides), and dispatches via the `actions`
registry. Find/till/surround/text-objects capture their target char(s) from the
next keystroke(s). `keymap.ts` is pure data so user remaps layer onto it.

## Develop

```sh
pnpm install
pnpm run compile      # check-types + lint + esbuild
pnpm test             # vscode-test (downloads VS Code, runs the parity suite)
```

## Credits

This repository was vibe-coded using [pi](https://github.com/earendil-works/pi-coding-agent),
an AI coding agent. With oversight and testing from me throughout the whole time.

## Requirements

**No additional extensions or dependencies are required.** heli is fully
self-contained — it ships its own mode engine, motion/selection/operator logic,
which-key popup, and file-explorer keybindings. It does not depend on Dance,
VSCodeVim, or any other extension. Just install and use.

Requires **VS Code / VSCodium 1.126.0 or newer**.

## License

[MIT](LICENSE) — do whatever you want with it.