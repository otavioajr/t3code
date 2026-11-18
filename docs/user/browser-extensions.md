# Browser extensions

The desktop app can load unpacked Chromium extensions into the preview browser.

Open **Settings → Browser → Extensions → Add extension**, then either choose **Load unpacked
folder** (a folder containing `manifest.json`) or import one already installed in a Chrome, Brave,
or other Chromium profile. Imported extensions are copied, so updating or removing them in that
browser does not change them here. Use the switch to turn an extension off and the bin to remove
it. Reload open tabs after a change.

Limits:

- Electron implements only part of the `chrome.*` extension API, so some extensions will not work.
- There is no Chrome Web Store, and packed `.crx` files cannot be loaded.
- Extensions get no toolbar icon or popup.
- Extensions load into every non-incognito profile. Incognito profiles never load them.
