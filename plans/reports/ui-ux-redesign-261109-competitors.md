# Similar products and what they teach

Date: 2026-11-10. Method: web search, then reading each vendor's own page. Most of this is vendor
copy, not hands-on testing, and the pages mostly describe features in words rather than layouts,
so the findings are about patterns of use, not pixels. Where a page did not say something, it is
listed as unknown.

## Products looked at

| Product                                                 | Kind                                  | Source                                                           |
| ------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| Google Meet, translated captions                        | Platform feature                      | https://support.google.com/meet/answer/10964115                  |
| Zoom, live voice translation                            | Platform feature                      | https://www.zoom.com/de/blog/voice-translation-zoom/             |
| DeepL Voice for Meetings                                | Add-on for Teams, Zoom, Meet          | https://www.deepl.com/en/products/voice/deepl-voice-for-meetings |
| Wordly                                                  | Events and meetings, browser join     | https://www.wordly.ai/how-it-works                               |
| Maestra Live                                            | Browser session with QR join          | https://live.maestra.ai/meeting-translation/                     |
| JotMe                                                   | Desktop caption and translation app   | https://www.jotme.io/tools/live-caption-translation              |
| KUDO, Interprefy                                        | Human and AI interpretation platforms | search listings only                                             |
| Microsoft Translator, Google Translate, Apple Translate | Conversation apps                     | search roundups only (the Microsoft page timed out)              |

## Patterns they share, and where Chatofy stands

| Pattern                                                      | Seen in                               | Chatofy                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Each person chooses their own language                       | Meet, Zoom, Wordly, Maestra           | Done (lobby)                                                                                                      |
| Join by link, no download                                    | Wordly, Maestra, JotMe                | Link join done; **no guest join without an account** (backend, not changed)                                       |
| **Join by QR code** for people in the same room              | Wordly, Maestra, JotMe                | Missing. Needs a QR generator dependency, so it is left for an owner decision                                     |
| **Caption size and style set by the reader**                 | Meet (font, size, colour, background) | **Added** (S to XL)                                                                                               |
| **Choose what to consume: listen, read or both**             | Wordly, Maestra                       | **Added** for captions (on or off); the translated voice level is played inside the call hook and was not exposed |
| **Original voice versus translated voice balance**           | Zoom (a balance slider)               | **Added** as an original-voices volume slider                                                                     |
| Change language during the session without leaving           | Wordly, Zoom, Meet                    | Missing: the call hook fixes the language at join, so it needs a signalling change                                |
| Speaker labels in captions and transcript                    | JotMe, Wordly                         | Done                                                                                                              |
| Custom glossary loaded in advance                            | Wordly, Maestra, JotMe                | Done (Glossary)                                                                                                   |
| Transcript and summary at the end, in each person's language | Wordly, JotMe, Maestra                | Meeting minutes exist; a per-person language is not confirmed                                                     |
| Scroll back through earlier captions                         | Meet                                  | Missing in the call (captions are a live overlay)                                                                 |
| An indicator next to the speaker visible only to you         | Zoom                                  | Partial: the local tile shows "Translating"                                                                       |
| Privacy stated plainly (what is stored, what is not)         | DeepL Voice                           | Done on the landing page                                                                                          |

## What was built

A **Captions and sound** menu beside the camera button in a call: show or hide captions, caption size
(S, M, L, XL, mapped onto the product's own type roles) and the volume of the other people's original voices.
It is personal and local, remembered per browser, outline like the buttons beside it, and keeps Leave as
the one filled control. Verified in a real browser with two people: the slider moves the other person's
actual audio volume (100% to 70% to 0%), the size choice disables with captions off, and the choice survives a reload.

## Not built, and why

| Item                          | Why                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| QR code to join               | Needs a QR library; a new dependency is an owner decision                              |
| Switch language mid-call      | The language is fixed when the call hook connects; this needs a server and hook change |
| Translated-voice volume       | That audio is played inside the call hook, not through an element the page can reach   |
| Guest join without an account | Backend and auth change                                                                |
| Caption history in the call   | A larger layout change; the chat column or a transcript drawer would be the place      |

## Caveat

Marketing pages do not show screens. Nothing here compares visual design; it compares what each product lets
the person do during a call. A hands-on trial of two or three of them would be the next step for visual comparison.
