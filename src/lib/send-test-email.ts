import { closeEmail, sendEmail } from './email';

async function main() {
  const to = process.argv[2];

  if (!to) throw new Error('Usage: npm run email:test -- <email>');

  await sendEmail({
    to,
    subject: 'Test email',
    text: 'Email is working. This message was sent by npm run email:test.',
  });

  console.log(`Test email sent to ${to}`);
}

main()
  .catch((error: unknown) => {
    // Connection failures can have an empty message, with the reason in their code.
    const { message, code } = error as { message?: string; code?: string };
    console.error(`Email failed: ${message || code || 'unknown error'}`);
    process.exitCode = 1;
  })
  .finally(closeEmail);
