import { Router } from 'express';
import { requireRole } from '../auth.js';
import { portal } from './service.js';

export const teacherRouter = Router();
teacherRouter.get('/portal', requireRole('teacher', 'director', 'principal', 'admin'), (req, res) => res.json(portal(req.user!)));
