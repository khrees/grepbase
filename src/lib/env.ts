export function shouldFailOpen(envOverride?: string): boolean {
    if (envOverride && envOverride !== 'false') {
        return true;
    }
    return process.env.NODE_ENV !== 'production';
}
