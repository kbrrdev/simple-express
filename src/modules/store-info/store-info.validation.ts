import Joi from 'joi';
import { socialPlatforms, type SocialLink } from './store-info.schema';

export const MAX_SOCIAL_LINKS = 10;

export interface StoreInfoBody {
  name: string;
  email: string | null;
  phone: string | null;
  line1: string | null;
  line2: string | null;
  barangay: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  businessHours: string | null;
  socialLinks: SocialLink[];
}

// Omitted fields are cleared, as the form is saved whole.
const optionalText = (max: number) => Joi.string().trim().min(1).max(max).allow(null).default(null);

const socialLink = Joi.object<SocialLink>({
  platform: Joi.string()
    .valid(...socialPlatforms)
    .required(),
  // Only https, so a link cannot run javascript: or another scheme.
  url: Joi.string()
    .trim()
    .max(500)
    .pattern(/^https:\/\/\S+$/)
    .required()
    .messages({ 'string.pattern.base': '{{#label}} must start with https://' }),
  label: optionalText(50),
});

export const storeInfoBody = Joi.object<StoreInfoBody>({
  name: Joi.string().trim().min(1).max(100).required(),
  email: Joi.string().trim().lowercase().email({ tlds: false }).max(255).allow(null).default(null),
  // Free text, as a store may list a landline or several numbers.
  phone: optionalText(30),
  line1: optionalText(255),
  line2: optionalText(255),
  barangay: optionalText(100),
  city: optionalText(100),
  province: optionalText(100),
  postalCode: Joi.string()
    .trim()
    .pattern(/^\d{4}$/)
    .allow(null)
    .default(null)
    .messages({ 'string.pattern.base': 'Postal code must be 4 digits' }),
  businessHours: optionalText(200),
  socialLinks: Joi.array().items(socialLink).max(MAX_SOCIAL_LINKS).default([]),
});
