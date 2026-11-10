# Google OAuth demo video review

Source: `/Users/sean/Documents/GOOGLE.mov` (394.538 seconds; no audio).

Review copy: `../moa-google-oauth-verification-en.mp4` (111.933 seconds, 1920×1080, H.264, 30 fps). English captions are burned into a separate bottom band; `../moa-google-oauth-verification-en.srt` is also supplied. The source file was not changed.

The recording shows English Google OpenID sign-in consent, English Calendar event read consent with the OAuth client ID visible in the address bar, a new one-member Moa destination calendar, import-range selection, sharing acknowledgment, and the copied sample event's title/time/description. The sample import returned one event. Calendar consent is a re-authorization of an existing permission, identified in the captions.

This recording predates the one-step import flow: it shows the demo calendar being created separately before the import. The current flow creates the new calendar from the import dialog. Re-record this portion before submitting the video so the walkthrough matches the production UI.

Editing removes the account chooser, passkey authentication and waits, the brief family-calendar view, and the long idle tail. Sign-in and Calendar consent are slowed for readability. Screen content is scaled uniformly and placed above the caption band; no app screen or successful result was fabricated. Exact retained source intervals and caption text are in `edit-plan.json`.

The Google source-event tab and the public homepage's sign-in button were not captured in this recording. It begins at Google's sign-in consent. The app name, requested event-read permission, client ID and actual imported fields are visible. No review approval is claimed.

Suggested YouTube title:

`Moa Calendar - Google OAuth Verification Demo`

Suggested YouTube description:

```text
Google OAuth verification demonstration for Moa Calendar.
Application: https://dwm.brightnetworks.kr/
Privacy policy: https://dwm.brightnetworks.kr/privacy

The demo shows Google OpenID sign-in, separate Google Calendar read authorization, destination-calendar creation, import-range selection, sharing acknowledgment, and importing a fictional sample event.

Requested sensitive scope: https://www.googleapis.com/auth/calendar.events.readonly
Calendar API method: events.list for the user's primary Google calendar.
Read fields: event title, start/end times and description.
Google events are not modified. Imported data is visible to authorized members of the selected Moa calendar.

The recording uses a previously authorized account and shows re-authorization. Authentication waits and unrelated calendar views were removed; consent screens were slowed for readability. English explanations are included on screen.
```

Upload visibility: Unlisted (일부 공개). YouTube upload and verification-form submission have not been performed.
