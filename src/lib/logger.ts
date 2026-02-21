/**
 * Structured logging for Cloudflare Pages
 * Logs are automatically sent to Cloudflare Dashboard
 */
import pino from 'pino';

// For edge runtime, we use pino without pretty printing in production
const logger = pino({
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
    // Cloudflare logs JSON automatically
    browser: {
        asObject: true,
    },
});

export { logger };

// Helper for creating child loggers with context
export const createLogger = (context: Record<string, unknown>) => {
    return logger.child(context);
};
