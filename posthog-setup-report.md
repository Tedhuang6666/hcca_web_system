<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of the campus platform API with PostHog product analytics. The existing PostHog SDK initialization (`api/core/posthog.py`) was already in place using the instance-based `Posthog()` constructor; it has been enhanced with `enable_exception_autocapture=True`. Environment variables `POSTHOG_API_KEY` and `POSTHOG_HOST` were written to `apps/api/.env`. Eight business-critical events were instrumented across six router files, covering the complete user lifecycle (login/logout), the petition submission flow, survey participation, and the full document approval workflow. User identification (`posthog_client.set()`) is called on every login, associating the user's UUID as the distinct ID with their `is_superuser` flag.

| Event | Description | File |
|---|---|---|
| `user_logged_in` | User authenticated via Google OAuth2 redirect or One Tap | `apps/api/src/api/routers/auth.py` |
| `user_logged_out` | User explicitly logged out, invalidating their tokens | `apps/api/src/api/routers/auth.py` |
| `petition_submitted` | A petition case was submitted (logged-in or guest user) | `apps/api/src/api/routers/petitions.py` |
| `survey_response_submitted` | A user submitted answers to an open survey | `apps/api/src/api/routers/survey.py` |
| `document_created` | A new draft document was created in the document system | `apps/api/src/api/routers/documents.py` |
| `document_submitted_for_approval` | A draft document was submitted into the approval workflow | `apps/api/src/api/routers/documents_approve.py` |
| `document_approved` | A document completed its final approval step | `apps/api/src/api/routers/documents_approve.py` |
| `meeting_created` | A new meeting was created in the meeting system | `apps/api/src/api/routers/meetings.py` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics dashboard](/dashboard/1650063)
- [Daily Login Activity](/insights/kvE8mnNQ) — logins over time
- [Document Approval Funnel](/insights/e72VJdXY) — conversion: created → submitted → approved
- [Petition Submissions](/insights/bghnpGeS) — unique users filing petitions daily
- [Survey Response Volume](/insights/GgEG3vig) — total responses over time
- [Business Activity Overview](/insights/v88clHtD) — logins, petitions, surveys, meetings side-by-side

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
