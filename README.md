# 🥚 Tea Egg (tea-egg)

[繁體中文](README.zh-TW.md)

Raise an egg soaking in tea broth inside Claude Code while you code. Every task you finish lets the flavor sink in a little more; in about a week it's done marinating.

```
 🥚(•ᴗ•)  Eggy #3 | Flavor ██████░░░░ 62% | Broth ███░░ | Smells of tea…
```

## Install

In Claude Code, run:

```
/plugin marketplace add helenlin0621/tea-egg
/plugin install tea-egg@tea-egg
```

Requires Claude Code 2.1.289 or later (update with `claude update`).

## Update

```
/plugin marketplace update tea-egg
/plugin update tea-egg@tea-egg
```

Then restart Claude Code.

## Commands

| Command | What it does |
|---|---|
| `/egg` | Open/close the panel |
| `/egg refill` | Top up the broth |
| `/egg flip` | Flip the egg |
| `/egg dex` | Show the Eggdex |
| `/egg band` | Hide/show the band above the prompt (stays that way until you run it again; the × on the band hides it too) |
| `/egg name <name>` | Name the current egg |
| `/egg help` | Help |

How your egg turns out depends on your coding habits. Collect them all!

## Language

The UI follows your system language: Chinese locales get Traditional Chinese, everything else gets English. To choose one yourself, set `TEA_EGG_LANG` to `en` or `zh-TW` before starting Claude Code:

| Shell | Command |
|---|---|
| macOS / Linux | `TEA_EGG_LANG=en claude` |
| Windows cmd | `set TEA_EGG_LANG=en` then `claude` |
| Windows PowerShell | `$env:TEA_EGG_LANG = "en"` then `claude` |

The language is picked when a session starts. Eggs you already have keep their names.

## Security

| Network | Runs programs | Reads/writes files | Calls AI | Sends data | Blocks or changes commands |
|---|---|---|---|---|---|
| No | No | No | No | No | No |

- The Mod only "looks at" the text of Bash/PowerShell commands and whether they succeeded, to tell whether you ran tests or a dangerous command. The full list of patterns is public in `hooks/detect.ts`.
- All data stays in the local storage Claude Code sets aside for this Mod.
- The dex contents are encoded to avoid spoilers; see the note at the top of `hooks/spoilers.ts`.

## License

MIT. See [LICENSE](LICENSE).
