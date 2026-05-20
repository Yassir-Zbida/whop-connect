/**
 * MySQL-backed express-session store (persists across restarts; supports multiple instances).
 */

import session from 'express-session';
import expressMysqlSession from 'express-mysql-session';

const MySQLStore = expressMysqlSession(session);

export function createSessionStore() {
  return new MySQLStore({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'whop_admin',
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: 24 * 60 * 60 * 1000,
    createDatabaseTable: true,
    schema: {
      tableName: 'sessions',
      columnNames: {
        session_id: 'session_id',
        expires: 'expires',
        data: 'data',
      },
    },
  });
}

export function buildSessionOptions(secret, useSecureCookies) {
  return {
    secret,
    store: createSessionStore(),
    resave: false,
    saveUninitialized: false,
    name: 'whop.sid',
    cookie: {
      httpOnly: true,
      secure: useSecureCookies,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    },
  };
}
