# ThinkingOut

A personal app for thinking out loud. You talk, and it writes down what you say. Then Claude sorts it into clear bullet points: what you're thinking, what you decided, what's still open, what you keep going round in circles on, and one small next step. Anything you need to do goes straight onto the calendar.

It's built for people who think by speaking rather than with an inner voice, and who want to stop looping through the same thoughts.

## What it does

The look takes its cues from Nothing OS: monochrome with one red accent, dot-matrix headings and icons (the free [Doto](https://fonts.google.com/specimen/Doto) font standing in for Nothing's own), Geist for reading, and small uppercase mono labels. It follows your phone's light or dark mode. Five tabs along the bottom: **Talk**, **Notes** (notes by topic, and collections), **To-do** (to-dos, and daily to-dos), **Calendar** and **Settings**. Where a tab has two pages, swipe left and right to flick between them.


- **Talk**: tap the mic to start and stop, or **hold it while you talk and let go to save**. You can type too. Add **screenshots or photos** from your gallery or camera, or share them in from any app. If you pick a topic first, its prompts show on screen.
- **Saved straight away**: a capture is saved the moment you finish, and Claude sorts it in the background ("Analyzing…") while you carry on.
- **Sorting**: Claude turns what you said and any images into a note:
  - **titled by the overarching topic** you kept talking about, and filed with your other notes on that topic (it reuses an existing topic when it's the same subject)
  - a short summary, with each separate thought as its own bullet
  - decisions, open questions and themes
  - **"You keep coming back to"**: the loops, including ones you repeated in earlier notes on the same topic
  - **One next step**: something small to do now instead of thinking more
  - to-dos, which go **straight onto your to-do list**. Dates you mention ("Friday", "next week") are worked out, and dated to-dos go on your calendar.
- **Notes**: every note, grouped under its topic, with image thumbnails. You can edit anything Claude wrote and share a note as Markdown, plus your loops from the last two weeks. You can re-file a note under a different topic, or start a topic with key notes to prompt you.
- **Collections**: folders you name yourself (film ideas, racing, general ideas…), under Notes → Collections. Add notes from a note's page, tick several at once from the collection, or pick a collection on the Talk screen to capture straight into it. A note can be in more than one collection.
- **Daily to-dos**: the second page of the To-do tab (tap **Daily** at the top, or swipe left) for things you do every day. Tick them off; they untick themselves at midnight, ready for the next day, and each shows how many days in a row you've kept it up. Tap one to edit or delete it. (They stay in the app and aren't sent to Google Calendar.)
- **To-do**: its own tab, with overdue / today / later counts at the top, a quick-add bar (tap the date, time and colour chips to set them) and everything sorted into overdue, today, upcoming and anytime. Give a to-do a date and it goes on your calendar (and Google Calendar); clear the date and it comes off again. Tap a to-do's dot to give it a colour; the colour shows on the calendar and on the event in Google Calendar (they're Google's own event colours).
- **Calendar**: a month view and a "next 7 days" agenda showing your to-dos (in their colours), your Google events (in their Google colours) and the days you made notes. Settings → Calendar colours changes the default to-do, "all done" and notes colours.

## Setup

```bash
npm install
npm run dev      # local dev server
npm run build    # production build in dist/
```

Then open **Settings** in the app and paste in a Claude API key from https://console.anthropic.com. The key stays in your browser's local storage and is only ever sent to Anthropic.

### Keeping Claude costs capped

Claude's API is billed separately from a Claude Pro/Max membership. Two layers stop it costing more than you choose:

1. **On your Anthropic account:** buy a small amount of prepaid credit (e.g. $5) and leave **auto-reload off**. Once it's used up, requests simply fail until you top up, so you can't be charged more than you loaded.
2. **In the app:** Settings has a **monthly spending limit** (default $2). Before each request the app works out the most it could possibly cost and won't send it if that could take the month over the limit. It counts the real cost from each reply, never retries on its own, and keeps the full estimate counted if a request fails in a way where it can't tell whether you were charged. The limit resets on the 1st.

Rough cost per sort: Opus 5.5 about 2–6¢, Sonnet 5.5 about 1–3¢, Haiku 5.5 under 0.1¢.

### Google Calendar (optional)

Settings → Google Calendar connects your main Google calendar. Dated to-dos are added as events: all-day if they have no time, one hour long if they do. Undated to-dos stay on the to-do list only. While the app is open it checks Google every minute, so new or changed events show up on their own. Your Google events show in the Calendar tab with a blue **G**. Sync works both ways, so moving or deleting one of your to-dos in Google changes it here too. Ticked-off items get a ✓ in Google.

It runs entirely in the browser, so it needs a free OAuth Client ID from your own Google Cloud project. The app shows the steps. While the Google project is in "Testing" mode, Google shows an "unverified app" warning when you sign in, which is expected for your own app. Sign-ins last about an hour; after that, the Calendar screen shows a **Sign in to sync** button, and changes you make in the meantime are saved and sent on the next sync.

### Put it on your phone

1. Push to `main`. The included GitHub Action builds the app and publishes it to GitHub Pages. You need to turn this on once under **Settings → Pages → Source: GitHub Actions**.
2. Open the Pages URL on your phone and choose **Add to Home Screen**. It then runs full-screen like an app.

### Share things in (Android)

Once the app is installed from Chrome, **ThinkingOut** appears in the Share menu. Take a screenshot (or pick a photo, link or bit of text), tap **Share → ThinkingOut**, and it opens as a new capture ready for you to say something about it.

Inspired by Nothing's Essential Space: one quick capture, saved instantly, sorted by AI in the background.

### Start from the side button

This link opens the app and starts listening straight away: `<your url>/#/talk?start=1`. You can copy it from the Settings screen.

- **iPhone (Action Button)**: in the Shortcuts app, make a new shortcut with **Open URLs** and that link. Then go to Settings → Action Button → Shortcut and pick it.
- **Android**: long-press the installed app icon to use the "Start talking" shortcut, or set a launcher gesture to open the link.

Some browsers need you to tap the mic once before they'll listen.

## Notes

- Voice uses the browser's built-in speech recognition (Chrome, Edge, and Safari on iOS/macOS). If that isn't available, type or use your keyboard's dictation mic.
- Everything is stored on the device. Use **Settings → Download backup** now and then. Restore from Settings to move to another device.
- The default model is Claude Opus 5.5. You can switch to Sonnet 5.5 or Haiku 5.5 in Settings to spend less.
