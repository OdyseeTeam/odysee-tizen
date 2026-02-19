# Odysee Samsung TV (Tizen)

Odysee TV app for Samsung Tizen devices.

This directory is the deployable Samsung Tizen web app.

## Screenshot

![Odysee Tizen App](/docs/images/screenshot.png)

## Project Layout

- `js/` - App logic, API integration, focus/navigation, playback
- `css/` - 10-foot UI styles
- `assets/` - Logos and static assets
- `index.html` - App shell and UI layers
- `config.xml` - Tizen app metadata, privileges, package/app IDs

## Current Feature Set

- Browse category feeds (with local category caching + endless scroll)
- Search videos
- Magic-link sign in
- Following + Watch Later categories (signed-in)
- AVPlay-based video playback with TV-friendly controls
- Channel views, follow actions, and claim reactions (Fire/Slime)

## Prerequisites

- Samsung Tizen Studio
- Samsung TV emulator or physical TV with Developer Mode enabled
- Certificate/profile configured in Tizen Studio for packaging/install

## Run & Deploy

### Recommended (Tizen Studio UI)

1. Open Tizen Studio.
2. Import this project.
3. Build the project.
4. Run on emulator or connected TV.

### CLI (optional)

```bash
tizen build-web
tizen package -t wgt
tizen install -n Odysee.wgt -t <device-name>
tizen run -p PJJ0oIIrmj.Odysee -t <device-name>
```

Note: exact signing/profile options vary by local Tizen Studio setup.

## Remote Controls

- D-pad: navigate sidebar, grid, modals, and player controls
- Enter: select / play-pause / activate focused action
- Left/Right: seek (hold accelerates)
- Back/Return: close modal/player or navigate back

## Troubleshooting

- If install fails, verify device certificate/profile and package signing.
- If playback differs between emulator and TV, validate on physical TV first (AVPlay behavior can differ).
- Enable verbose logs in app constants and inspect Web Inspector when running in debug mode.

## Contributing

Contributions are welcome. If you'd like to improve the Samsung TV experience, please open an issue to discuss the change or submit a pull request directly with a clear description of what was updated and why.

## License

MIT. See `LICENSE`.
