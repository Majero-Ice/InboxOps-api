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
});
