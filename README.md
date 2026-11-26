# YouTube™ Watched Marker

Firefox-first WebExtension for queuing YouTube™ videos and simulating watched playback in a short-lived worker window.

Install from Firefox Add-ons: https://addons.mozilla.org/firefox/addon/youtube-watched-marker/

## Behavior

- Adds a Firefox context menu item named **Mark as watched** on YouTube™ pages and links.
- Adds **Mark as watched** to YouTube™'s own video three-dot menus.
- Adds **Mark watched & remove** to those menus on playlist pages only, including Watch Later. It queues the video and reuses YouTube™'s own remove command, so the row disappears and the undo snackbar still works.
- Extracts video IDs from `youtube.com/watch?v=...`, `youtube.com/shorts/...`, `youtube.com/embed/...`, `youtube.com/live/...`, and `youtu.be/...`.
- Stores each video once in a local queue.
- Opens one queued video at a time in a dedicated worker browser window.
- Defaults the worker window to `1280x720` positioned by the browser, and remembers its position and size once moved or saved.
- Seeks near the last 30 seconds, plays for 5 seconds, then closes the worker window.
- Starts playback in the worker browser window, then returns focus to the previous tab while the 5-second run continues.
- Shows the queue in the extension popup.
- Adds a popup channel timeframe scanner that queues videos from the active channel Videos page between two entered dates.
- Adds a popup **Mark playlist as watched** action that loads every video in the open playlist, including Watch Later, and queues them in playlist order.
- Keeps playlist videos beyond the active queue limit in a stored backlog that refills the queue as earlier videos finish, so playlists of any size work without raising the limit. The popup shows `queued / total` progress with a cancel button, and the backlog survives a browser restart.
- Shows video titles in the popup when YouTube™ exposes them.
- Marks each local queue item as `pending`, `running`, `completed`, or `failed`.
- Lets you retry or remove individual completed/failed queue items.
- Includes a popup debug toggle for playback event timelines and an export button for a JSON debug log.
- Includes popup controls for worker mode, playback seconds, seek distance from the end, stopping the active worker (which also pauses the queue so the next item does not start), retrying failed items, and clearing completed/failed items.
- Includes a queue pause/resume control and a configurable active queue limit (`pending` + `running`).
- Includes a separate **Saved queue limit** for the total number of items kept in the queue history. When the queue grows past it, the oldest finished (`completed`/`failed`) items are removed automatically on every queue write, when the limit is lowered, and at browser startup. The default cap is `100` and `0` keeps everything; `pending`, `running` and the item with a live worker are never removed, so a busy queue can temporarily sit above the limit.
- Keeps playlist progress counts on the playlist job itself, so trimming finished items does not lose a long playlist's `done` count.
- Includes reset/save buttons for the remembered worker window bounds.
- Uses a stable Firefox add-on ID: `youtube-watched-marker@hayalet`.

## Popup layout

- The status card is always visible first. It shows whether the queue is working, paused, needs attention, or is empty, with progress and the current video. Its main button pauses/resumes or retries, and a compact version stays visible on the Add tab.
- **Queue** tab: filter by All / Pending / Watched / Failed, with contextual **Retry failed** and **Clear finished** actions. Queue items lead with the video title; the video ID and source URL remain in the item tooltip.
- **Add videos** tab: mark the open playlist as watched, scan a YouTube channel by date range, or watch backlog progress and cancel a running playlist job.
- **Settings** (gear): playback duration, start-near-end offset, active queue limit, saved queue limit, and playback window. Debug timeline, log export, failed-item cleanup and clear-all sit under **Advanced**.
- **Clear all** in the footer asks for confirmation before removing the queue and backlog.

## Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on...**.
3. Select `manifest.json` from this folder.
4. Open YouTube™, use a video's three-dot menu, and choose **Mark as watched**.

## Manual checks

- The context menu appears on YouTube™ watch pages, YouTube™ links, and `youtu.be` links.
- YouTube™ video three-dot menus include **Mark as watched**.
- Playlist pages, including `youtube.com/playlist?list=WL`, also include **Mark watched & remove**; it queues the video and removes the row. Other pages show only **Mark as watched**.
- Unsupported links do not create queue entries.
- The popup shows queued items after it is closed and reopened.
- The popup channel timeframe scanner accepts `DD.MM.YYYY`, `D.M.YYYY`, and `YYYY-MM-DD`, normalizes reversed ranges, and queues matching channel videos.
- The popup Playlist section reports how many videos it found while loading a long playlist, then marks every video in it.
- A playlist larger than the active queue limit keeps draining as items complete, and the active count never exceeds the limit.
- Cancelling a playlist stops adding the remaining videos but keeps the ones already queued; **Clear** drops both the queue and the backlog.
- Completed/failed queue items can be retried or removed individually.
- The clear button removes all queued items, while the cleanup buttons remove only completed or failed items.
- Pausing the queue allows new items to be added without starting worker playback until the queue is resumed.
- The max queue size applies to active items: `pending` plus `running`.
- The active queue limit can be raised up to 500 for larger channel timeframe scans.
- With the saved queue limit set to a small number, adding videos keeps only the newest items, removes the oldest `completed`/`failed` ones, and never drops `pending`/`running` items.
- Lowering the saved queue limit trims the existing queue immediately, and an oversized queue is trimmed again after a browser restart.
- The saved queue limit defaults to `100`; an existing queue is trimmed down to it on the next background start.
- Setting the saved queue limit to `0` keeps the full queue history.
- Playlist `done` counts stay correct even when finished items have been trimmed by the saved queue limit.
- A queued item briefly opens a muted worker window and then changes status.

## Development checks

Run JavaScript syntax checks, unit tests, and `web-ext lint`:

```powershell
npm run check
```

Run unit tests only:

```powershell
npm test
```

Optional Firefox extension lint/build, after installing dependencies:

```powershell
npm install
npm run lint
npm run build
```

## Publishing notes

- Include `PRIVACY.md` in the AMO listing or paste its text into the listing privacy field.
- Describe the feature as simulated playback, not a guaranteed YouTube™ API-backed watched state.
- Test the packaged artifact from `web-ext-artifacts`, not only the temporary extension folder.

This phase only simulates playback. YouTube™ may still decide not to record the video as watched.
Some videos may still fail if Firefox/YouTube™ refuses to start or advance playback in the worker window.
