/**
 * Whop SDK client factory per user (shared by API routes and payment worker).
 */

import Whop from '@whop/sdk';
import * as db from '../db.js';
import { allowSharedWhopEnvFallback } from './security.js';

export async function getWhopConfig(userId) {
  if (!userId) return { apiKey: '', companyId: '' };
  const s = await db.getUserSettings(userId);
  const fromDb = {
    apiKey: (s?.whop_api_key || '').trim(),
    companyId: (s?.whop_company_id || '').trim(),
  };
  if (fromDb.apiKey && fromDb.companyId) {
    return fromDb;
  }
  if (allowSharedWhopEnvFallback()) {
    return {
      apiKey: fromDb.apiKey || (process.env.WHOP_API_KEY || '').trim(),
      companyId: fromDb.companyId || (process.env.WHOP_PARENT_COMPANY_ID || '').trim(),
    };
  }
  return fromDb;
}

export function getWhop(userId) {
  if (!userId) return Promise.resolve(null);
  return getWhopConfig(userId).then((c) => {
    if (c.apiKey && c.companyId) return new Whop({ apiKey: c.apiKey });
    return null;
  });
}

export async function getWhopCompanyId(userId) {
  const c = await getWhopConfig(userId);
  return c.companyId;
}
