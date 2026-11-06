import { Router, type RequestHandler } from 'express';
import multer, { MulterError } from 'multer';
import { AppError } from '../../lib/app-error';
import { requireAdmin, requireAuth } from '../../middleware/require-auth';
import { validate } from '../../middleware/validate';
import * as controller from './asset.controller';
import { assetParams, listAssetsQuery } from './asset.validation';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const readFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
}).single('file');

const uploadFile: RequestHandler = (req, res, next) => {
  readFile(req, res, (error: unknown) => {
    if (error instanceof MulterError) {
      next(
        error.code === 'LIMIT_FILE_SIZE'
          ? new AppError(413, 'File must be 5 MB or smaller')
          : new AppError(400, 'Attach one image in the file field'),
      );
      return;
    }

    next(error);
  });
};

export const assetRoutes = Router();

assetRoutes.use(requireAuth, requireAdmin);

assetRoutes.get('/', validate('query', listAssetsQuery), controller.list);
assetRoutes.post('/', uploadFile, controller.create);
assetRoutes.delete('/:id', validate('params', assetParams), controller.remove);
