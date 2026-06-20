import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  SERVICE_API_KEY: Joi.string().required(),
  ANTHROPIC_API_KEY: Joi.string().required(),
  CLAUDE_TEXT_MODEL: Joi.string().required(),
  CLAUDE_VISION_MODEL: Joi.string().required(),
  PDF_TEXT_MIN_CHARS: Joi.number().default(100),
  PDF_MAX_VISION_PAGES: Joi.number().default(5),
  CONFIDENCE_THRESHOLD: Joi.number().default(0.7),
  MAX_UPLOAD_MB: Joi.number().default(15),
  PORT: Joi.number().default(3000),
  FIRECRAWL_API_KEY: Joi.string().required(),
  ENRICH_MAX_CHARS: Joi.number().default(12000),
  ENRICH_ABOUT_PATHS: Joi.string().default('/about,/about-us'),
  PUBLIC_EMAIL_DOMAINS: Joi.string().default(
    'gmail.com,outlook.com,hotmail.com,yahoo.com,icloud.com,proton.me,protonmail.com,gmx.com,web.de,mail.ru,yandex.ru',
  ),
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_NAME: Joi.string().required(),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  ADMIN_PASSWORD: Joi.string().required(),
  ADMIN_JWT_SECRET: Joi.string().required(),
});
