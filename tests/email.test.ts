import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
const close = vi.fn();
const createTransport = vi.fn((_options: unknown) => ({ sendMail, close }));

vi.mock('nodemailer', () => ({ default: { createTransport } }));

const message = { to: 'person@example.com', subject: 'Private subject', text: 'Private text' };

async function loadEmail() {
  vi.resetModules();

  const email = await import('../src/lib/email.js');
  const { logger } = await import('../src/lib/logger.js');

  return { ...email, logger };
}

function configure(settings: Record<string, string>) {
  for (const [key, value] of Object.entries({
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    EMAIL_FROM: 'Store <orders@example.com>',
    ...settings,
  })) {
    vi.stubEnv(key, value);
  }
}

beforeEach(() => {
  sendMail.mockReset();
  createTransport.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sending email', () => {
  it('explains itself when email is not configured', async () => {
    vi.stubEnv('SMTP_HOST', '');

    const { sendEmail } = await loadEmail();

    await expect(sendEmail(message)).rejects.toThrow('Email is not configured');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('sends from the configured address', async () => {
    configure({});

    const { sendEmail } = await loadEmail();
    await sendEmail(message);

    expect(sendMail).toHaveBeenCalledWith({ ...message, from: 'Store <orders@example.com>' });
  });

  it('keeps recipients and content out of the logs', async () => {
    configure({});

    const { sendEmail, logger } = await loadEmail();
    const info = vi.spyOn(logger, 'info');
    await sendEmail(message);

    const logged = JSON.stringify(info.mock.calls);

    expect(info).toHaveBeenCalledWith('Email sent');
    expect(logged).not.toContain('person@example.com');
    expect(logged).not.toContain('Private');
  });

  it('passes on a failure, so that callers can handle it', async () => {
    configure({});
    sendMail.mockRejectedValue(new Error('Connection refused'));

    const { sendEmail } = await loadEmail();

    await expect(sendEmail(message)).rejects.toThrow('Connection refused');
  });
});

describe('connecting to the mail server', () => {
  it('needs no login for a local server', async () => {
    configure({ SMTP_HOST: 'localhost', SMTP_PORT: '1025', SMTP_USER: '', SMTP_PASSWORD: '' });

    await loadEmail();

    expect(createTransport).toHaveBeenCalledWith({
      host: 'localhost',
      port: 1025,
      secure: false,
      requireTLS: false,
    });
  });

  it('requires encryption whenever it logs in', async () => {
    configure({ SMTP_USER: 'user', SMTP_PASSWORD: 'secret' });

    await loadEmail();

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        requireTLS: true,
        auth: { user: 'user', pass: 'secret' },
      }),
    );
  });

  it('connects securely from the start on port 465', async () => {
    configure({ SMTP_PORT: '465' });

    await loadEmail();

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
  });
});

describe('email settings', () => {
  const loadEnv = () => {
    vi.resetModules();
    return import('../src/config/env.js');
  };

  it('are optional', async () => {
    vi.stubEnv('SMTP_HOST', '');

    await expect(loadEnv()).resolves.toBeDefined();
  });

  it('need a sender once a server is set', async () => {
    configure({ EMAIL_FROM: '' });

    await expect(loadEnv()).rejects.toThrow('EMAIL_FROM');
  });

  it('need a password with a username', async () => {
    configure({ SMTP_USER: 'user', SMTP_PASSWORD: '' });

    await expect(loadEnv()).rejects.toThrow('SMTP_PASSWORD');
  });
});
