# Import browser sessions

The desktop app can import cookies from another browser so you can reuse its signed-in sessions
in the preview browser.

Open **Settings → Browser → Browser profiles → Add profile**, then choose a browser under
**Import from**. Close the source browser before importing, and allow an operating-system keyring
unlock prompt if one appears.

This is a one-time copy. Later login changes stay separate between the two browsers, and some
sites may still require you to sign in again.

On macOS, Safari imports need Full Disk Access. Choose **Allow**, drag T3 Code into the
System Settings permission list, and turn access on. **Continue** becomes available when access
is detected. macOS may require you to quit and reopen T3 Code before the grant applies; reopen
the import wizard afterward. You can revoke Full Disk Access once the import is done.

On Windows, import supports Firefox, Zen, and Helium profiles that use standard profile encryption.
Other Chromium-based browsers use app-bound encryption and cannot be imported. Partitioned cookies
are skipped on all platforms.

## Suggest history in the address bar

Open **Settings → Browser → Suggest history from** and pick a Chromium browser profile, such as
Chrome or Brave, to get its visited pages as suggestions while you type in the preview browser's
address bar. It is off by default, works while that browser is open, and reads the history live
without importing or storing it. Suggestions appear in the desktop app only.
