import rateLimit from 'express-rate-limit';

const isTest = process.env.NODE_ENV === 'test';

export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});

export const twoFactorRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,
  message: { error: 'Too many 2FA attempts. Please wait 10 minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});

export const inviteAcceptRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});

export const generalApiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});
