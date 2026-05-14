# YouTube™ Watched Marker

Firefox-first WebExtension for queuing YouTube™ videos and simulating watched playback in a short-lived worker window.

## Behavior

- Adds a Firefox context menu item named **Mark as watched** on YouTube™ pages and links.
- Adds **Mark as watched** to YouTube™'s own video three-dot menus.
- Extracts video IDs from `youtube.com/watch?v=...`, `youtube.com/shorts/...`, `youtube.com/embed/...`, `youtube.com/live/...`, and `youtu.be/...`.
- Stores each video once in a local queue.
- Opens one queued video at a time in a dedicated worker browser window.
- Defaults the worker window to `1280x720` at `left=2176, top=144`, based on the tested secondary-screen preset for a 4K 200% primary monitor with a 1920x1080 125% laptop monitor to the right.
- Seeks near the last 30 seconds, plays for 5 seconds, then closes the tab.
- Starts playback in the worker browser window, then returns focus to the previous tab while the 5-second run continues.
- Shows the queue in the extension popup.
- Adds a popup channel timeframe scanner that queues videos from the active channel Videos page between two entered dates.
- Shows video titles in the popup when YouTube™ exposes them.
- Marks each local queue item as `pending`, `running`, `completed`, or `failed`.
- Lets you retry or remove individual completed/failed queue items.
- Includes a popup debug toggle for playback event timelines and an export button for a JSON debug log.
- Includes popup controls for worker mode, playback seconds, seek distance from the end, low-quality requests, stopping the active worker, retrying failed items, and clearing completed/failed items.
- Includes a queue pause/resume control and a configurable active queue limit.
- Shows a popup warning that marking opens a muted worker browser window while signed in.
- Includes reset/save buttons for the remembered worker window bounds.
- Uses a stable Firefox add-on ID: `youtube-watched-marker@example.com`.

## Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on...**.
3. Select `manifest.json` from this folder.
4. Open YouTube™, use a video's three-dot menu, and choose **Mark as watched**.

## Manual checks

- The context menu appears on YouTube™ watch pages, YouTube™ links, and `youtu.be` links.
- YouTube™ video three-dot menus include **Mark as watched**.
- Unsupported links do not create queue entries.
- The popup shows queued items after it is closed and reopened.
- The popup channel timeframe scanner accepts `DD.MM.YYYY`, `D.M.YYYY`, and `YYYY-MM-DD`, normalizes reversed ranges, and queues matching channel videos.
- Completed/failed queue items can be retried or removed individually.
- The clear button removes all queued items, while the cleanup buttons remove only completed or failed items.
- Pausing the queue allows new items to be added without starting worker playback until the queue is resumed.
- The max queue size applies to active items: `pending` plus `running`.
- The active queue limit can be raised up to 500 for larger channel timeframe scans.
- A queued item briefly opens a muted background tab and then changes status.

## Development checks

Run JavaScript syntax checks:

```powershell
npm run check
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
