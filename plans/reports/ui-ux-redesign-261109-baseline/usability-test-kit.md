# Usability test kit (steps 1.9a and 6.1a)

Needs 3 to 5 people who have never used Chatofy. This is the part an assistant cannot do;
everything else is ready. Run the same kit before the redesign (baseline) and after it.

## Setup

- Fresh account per tester, laptop with a microphone, Chrome, a quiet room.
- Say only: "Use this app to do the tasks I read out. Think aloud. I will not help."
- Stop a task after 3 minutes and mark it failed. Record the screen if they agree.

## Tasks

| #   | Task read to the tester                                          | Success means                 | Target                           |
| --- | ---------------------------------------------------------------- | ----------------------------- | -------------------------------- |
| T1  | "Say a sentence in Vietnamese and read its English translation." | Translation visible on screen | <= 3 steps from the first screen |
| T2  | "Start a meeting and give the link to a friend."                 | Meeting open, link copied     | <= 3 steps                       |
| T3  | "Find the conversation you just had and open it."                | History item open             | <= 3 steps                       |
| T4  | "Change the interface language to Vietnamese."                   | UI shows Vietnamese           | <= 3 steps                       |

## Record (one row per tester per task)

| Tester | Task | Finished unaided (y/n) | Steps | Seconds | Where they hesitated | What they said |
| ------ | ---- | ---------------------- | ----- | ------- | -------------------- | -------------- |

## Scoring

Success rate = unaided finishes / attempts, per task. Pass is >= 90%. List every
hesitation of 5 seconds or more; those are the defects to fix, ranked by how many
testers hit them. Add the table to the final report and compare baseline to after.
