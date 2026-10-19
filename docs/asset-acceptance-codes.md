Driver, trailer, and vehicle registrations use their own built-in acceptance
templates: `acceptance-driver`, `acceptance-trailer`, and `acceptance-vehicle`.
The application matches these templates to the corresponding registration type
and excludes the company welcome email from asset acceptance choices. Custom
codes retain their existing shared behavior.

Create the templates and assign them to every currently active port:

```sh
npm run setup:asset-acceptance
npm run setup:asset-acceptance -- --apply
```

The first command previews the changes. The second writes them. Codes use the
first available ACC number (ACC002, ACC003, ACC004 when only ACC001 exists).
Rerunning preserves existing template content and adds missing active-port
assignments. No schema migration is required.

The existing preview and send handlers attach the registration details PDF
automatically. These PDFs use the saved driver, trailer, or vehicle details and
the registration reference as the filename. They are generated per submission,
so they do not appear as uploaded attachments in the template editor. Additional
uploaded template attachments are still supported.

Deploy the updated frontend and API together so that the new codes are filtered
by registration type in both the queue and User Registration. Creating templates
does not send email; an administrator still previews and sends each message.

Verification:

```sh
npm run lint
npm run build
npx tsx --test tests/asset-acceptance.test.ts
```
