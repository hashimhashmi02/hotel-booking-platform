
import { Response } from 'express';

export function sendSuccess(res: Response, data: any, statusCode: number = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
    error: null,
  });
}

export function sendError(res: Response, error: string, statusCode: number = 400) {
  return res.status(statusCode).json({
    success: false,
    data: null,
    error,
  });
}
