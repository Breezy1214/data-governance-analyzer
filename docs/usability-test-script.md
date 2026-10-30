# Usability test script (SCRUM-17)

For the "representative non-specialist users" part of SCRUM-17. Plan for 15 minutes per person, with 3 people.

## Who to ask

People who have **not** worked on this project and are **not** privacy specialists. Classmates from another team are ideal. Do not use teammates: they know the wording already, so their times mean nothing.

## Before you start

1. Run the app with `./scripts/start-dev.sh`, open `http://localhost:3000/login`, and sign in with the team's test account before the participant arrives.
2. Have a timer ready.
3. Open a fresh tab for each person so no draft is restored.
4. Tell them: **"I'm testing the tool, not you. If you get stuck, that's useful — say what you're thinking out loud."**

## The scenario (read this aloud, then stop talking)

> Your company wants to share customer email addresses with a partner company so both can tell which customers they have in common. You've been asked to check whether that's risky before it goes ahead. Use this tool to find out, and get a copy of the result you could send to your manager.

Then **say nothing else**. Do not explain the steps. That is the point of the criterion: the flow has to work without instructions. If they are stuck for more than 60 seconds, note where, then help and mark the task as assisted.

## Time it

Start the timer when they first touch the keyboard or mouse. Stop it when the PDF has downloaded.

## Record for each person

| | Person 1 | Person 2 | Person 3 |
| --- | --- | --- | --- |
| Completion time | | | |
| Finished without help? (Y/N) | | | |
| Where they hesitated | | | |
| Words they did not understand | | | |
| What they said about the score | | | |
| Found the download? (Y/N) | | | |

**Median completion time:** ______ (target: under 5 minutes)

## Watch for these specifically

- Do they understand "Will raw identifiable values be exchanged?" without asking?
- Do they know what to do after reading the score, or do they stop there?
- Do they notice the Recommendations step, or do they think the score is the end?
- Do they understand that their answers are not saved?
- Can they tell what the risk level means without the colour, for example if they read it aloud?

## After each session, ask

1. In your own words, what did the tool tell you?
2. Was anything confusing or unclear?
3. If this were real, would you know what to do next?

## When you're done

Put the median time and the main observations into the "Completion time" section of `docs/accessibility-review.md`, and open a ticket for anything that needs a fix. Note who was tested, in general terms ("three students, no privacy background") — no names needed.
