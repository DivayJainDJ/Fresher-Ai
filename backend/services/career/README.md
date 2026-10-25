# Career service email reminders

Application reminders use the `EMAIL_PROVIDER` adapter. The current adapter is
Resend; leave `EMAIL_PROVIDER` unset (or `none`) to keep reminders dormant. To
send reminders, configure `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and
`EMAIL_FROM` in the career service environment. The sender must be authorized by
your Resend account. Users can turn reminders off in the job tracker.

Resend's current Free plan lists 3,000 emails per month and 100 emails per day.
Reminder sends are keyed by application and due date in MongoDB and use the
provider's idempotency header, so a retry does not send a second message.

The BullMQ v6 scheduler runs the reminder scan daily at midnight UTC. It checks
each user's stored timezone against the date-only `nextActionDate` value. The
email integration lives in `services/emailProvider.js` so another provider can
replace it without changing the tracker or job logic.
