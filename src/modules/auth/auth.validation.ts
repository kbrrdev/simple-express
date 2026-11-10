import Joi from 'joi';
import { commonPasswords } from './common-passwords';

export interface RegisterBody {
  email: string;
  password: string;
}

export interface LoginBody extends RegisterBody {
  client: 'web' | 'native';
}

export interface RefreshBody {
  refreshToken?: string;
}

export interface ForgotPasswordBody {
  email: string;
}

export interface ResetPasswordBody {
  token: string;
  newPassword: string;
}

export interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

const email = Joi.string().trim().lowercase().email({ tlds: false }).max(255).required();

const newPassword = Joi.string()
  .min(8)
  .max(128)
  .required()
  .custom((value: string, helpers) =>
    commonPasswords.has(value.toLowerCase()) ? helpers.error('password.common') : value,
  )
  .messages({ 'password.common': 'This password is too common' });

export const registerBody = Joi.object<RegisterBody>({
  email,
  password: newPassword,
});

export const loginBody = Joi.object<LoginBody>({
  email,
  password: Joi.string().max(128).required(),
  client: Joi.string().valid('web', 'native').required(),
});

export const changePasswordBody = Joi.object<ChangePasswordBody>({
  currentPassword: Joi.string().max(128).required(),
  newPassword,
});

export const forgotPasswordBody = Joi.object<ForgotPasswordBody>({ email });

export const resetPasswordBody = Joi.object<ResetPasswordBody>({
  token: Joi.string().max(128).required(),
  newPassword,
});

export const refreshBody = Joi.object<RefreshBody>({
  refreshToken: Joi.string().max(128),
});
