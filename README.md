# Jiyan 記言

> 記言: the court historian who wrote down what was *said*. Jiyan does that for your recordings.

Turn meeting and lecture recordings (video or audio) into notes you can browse and search:
transcript, who spoke, highlights, AI summary, subtitles (with translation), and a chat agent.
Speech recognition and speaker detection run on your computer. Only the AI summary, translation
and chat use the assistant you choose (Claude Code, Codex or pi).

## Install (Linux)

**You need:** `ffmpeg`, `uv`, and about 3 GB of free disk (Python packages ~0.5 GB, speech model ~1.6 GB).
To get AI summaries and chat you also need one of **Claude Code**, **Codex** or **pi**, already signed in.

1. Install the two tools (skip any you already have):
   ```sh
   sudo pacman -S ffmpeg                          # Arch / CachyOS     (Debian/Ubuntu: sudo apt install ffmpeg)
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```
2. Install the app — pick one:
   - **AppImage** (any distro): `chmod +x Jiyan-*.AppImage && ./Jiyan-*.AppImage`
   - **Debian / Ubuntu**: `sudo apt install ./Jiyan-*.deb`, then start “Jiyan” from the menu.
3. On first launch a **Set up** window appears. Click **Install everything** and wait; it downloads the
   Python packages and models once (several minutes). After that it works offline except for the AI assistant.
4. Click **Import video or audio**, choose the type (Meeting / Lecture / Other), and pick a file.

If the AppImage does not start (a sandbox error on some Ubuntu versions), run it with `--no-sandbox`.

## Use it from Claude Code / Codex

Open **Settings → Use from Claude Code / Codex**, copy the command for your tool and run it once in a terminal.
The agent can then list recordings, search transcripts, read summaries, action items and hot spots.

## Where things are

| What | Where |
|---|---|
| Your recordings' notes | `~/MeetingNotes` (change under Settings → Project folder) |
| App settings | `~/.config/jiyan/` |
| Pipeline, Python environment, models | `~/.local/share/jiyan/pipeline` |
| Speech model cache | `~/.cache/huggingface` |

Your original video/audio files are never modified or moved.

## Build from source

```sh
cd app && npm install && npm run dist      # writes app/dist/Jiyan-<version>.AppImage and .deb
npm run dev                                # development window with hot reload
```

## License

[0BSD](LICENSE) — use, copy, modify and distribute for any purpose, no attribution required.
Jiyan downloads speech and speaker models on first run; each of those, and each dependency, keeps its own licence.
