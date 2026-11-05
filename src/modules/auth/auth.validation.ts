import Joi from 'joi';

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

const email = Joi.string().trim().lowercase().email({ tlds: false }).max(255).required();

export const registerBody = Joi.object<RegisterBody>({
  email,
  password: Joi.string().min(8).max(128).required(),
});

export const loginBody = Joi.object<LoginBody>({
  email,
  password: Joi.string().max(128).required(),
  client: Joi.string().valid('web', 'native').required(),
});

export const refreshBody = Joi.object<RefreshBody>({
  refreshToken: Joi.string().max(128),
});
