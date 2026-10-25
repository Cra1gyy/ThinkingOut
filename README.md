# ThinkingOut

A personal app for thinking out loud. You talk, and it writes down what you say. Then Claude sorts it into clear bullet points: what you're thinking, what you decided, what's still open, what you keep going round in circles on, and one small next step. Anything you need to do goes straight onto the calendar.

It's built for people who think by speaking rather than with an inner voice, and who want to stop looping through the same thoughts.

## What it does

- **Talk**: tap the mic and speak, or type. The words appear as you go. If you pick a topic first, its prompts show on screen.
- **Make sense of it**: Claude turns the messy transcript into:
  - a short summary, with each separate thought as its own bullet
  - decisions, open questions and themes
  - **"You keep coming back to"**: the loops, including ones you repeated in earlier sessions on the same topic
  - **One next step**: something small to do now instead of thinking more
  - to-dos with the dates worked out ("Friday", "next week"). One tap adds each one to the calendar.
- **Thoughts**: every session, grouped by day and searchable, plus your loops from the last two weeks.
- **Topics**: things you want to think about, with key notes to prompt you. Each topic collects what you've decided so far, what's still open and the loops that keep coming up.
- **Calendar**: a month view and a "next 7 days" agenda. You can add things directly, tick them off and see which days you had thinking sessions. Anything you haven't finished carries over to the next days.

## Setup

```bash
npm install
npm run dev      # local dev server
npm run build    # production build in dist/
```

Then open **Settings** in the app and paste in a Claude API key from https://console.anthropic.com. The key stays in your browser's local storage and is only ever sent to Anthropic.

### Google Calendar (optional)

Settings → Google Calendar connects your main Google calendar. Your ThinkingOut to-dos are added as events: all-day if they have no time, one hour long if they do. Your Google events show in the Calendar tab with a blue **G**. Sync works both ways, so moving or deleting one of your to-dos in Google changes it here too. Ticked-off items get a ✓ in Google.

It runs entirely in the browser, so it needs a free OAuth Client ID from your own Google Cloud project. The app shows the steps. While the Google project is in "Testing" mode, Google shows an "unverified app" warning when you sign in, which is expected for your own app. Sign-ins last about an hour; after that, the Calendar screen shows a **Sign in to sync** button, and changes you make in the meantime are saved and sent on the next sync.

### Put it on your phone

1. Push to `main`. The included GitHub Action builds the app and publishes it to GitHub Pages. You need to turn this on once under **Settings → Pages → Source: GitHub Actions**.
2. Open the Pages URL on your phone and choose **Add to Home Screen**. It then runs full-screen like an app.

### Start from the side button

This link opens the app and starts listening straight away: `<your url>/#/talk?start=1`. You can copy it from the Settings screen.

- **iPhone (Action Button)**: in the Shortcuts app, make a new shortcut with **Open URLs** and that link. Then go to Settings → Action Button → Shortcut and pick it.
- **Android**: long-press the installed app icon to use the "Start talking" shortcut, or set a launcher gesture to open the link.

Some browsers need you to tap the mic once before they'll listen.

## Notes

- Voice uses the browser's built-in speech recognition (Chrome, Edge, and Safari on iOS/macOS). If that isn't available, type or use your keyboard's dictation mic.
- Everything is stored on the device. Use **Settings → Download backup** now and then. Restore from Settings to move to another device.
- The default model is Claude Opus 5.5. You can switch to Sonnet 5.5 or Haiku 5.5 in Settings to spend less.
