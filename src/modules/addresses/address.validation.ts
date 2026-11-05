import Joi from 'joi';

export interface AddressBody {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  barangay: string;
  city: string;
  province: string;
  postalCode: string;
}

export type UpdateAddressBody = Partial<AddressBody>;

export const addressParams = Joi.object({
  id: Joi.string().uuid().required(),
});

const recipientName = Joi.string().trim().min(1).max(100);
const line1 = Joi.string().trim().min(1).max(255);
const line2 = Joi.string().trim().max(255).allow('');
const place = Joi.string().trim().min(1).max(100);

// Accepts 09171234567 or +639171234567, with optional spaces or dashes, and stores the second form.
const phone = Joi.string()
  .replace(/[\s-]/g, '')
  .replace(/^0/, '+63')
  .pattern(/^\+639\d{9}$/)
  .messages({
    'string.pattern.base': 'Phone must be a Philippine mobile number, such as 09171234567',
  });

const postalCode = Joi.string()
  .trim()
  .pattern(/^\d{4}$/)
  .messages({ 'string.pattern.base': 'Postal code must be 4 digits' });

export const createAddressBody = Joi.object<AddressBody>({
  recipientName: recipientName.required(),
  phone: phone.required(),
  line1: line1.required(),
  line2,
  barangay: place.required(),
  city: place.required(),
  province: place.required(),
  postalCode: postalCode.required(),
});

export const updateAddressBody = Joi.object<UpdateAddressBody>({
  recipientName,
  phone,
  line1,
  line2,
  barangay: place,
  city: place,
  province: place,
  postalCode,
}).min(1);
