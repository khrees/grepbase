# Grepbase Project Guidelines

## React Patterns

### Hooks Usage

**Do NOT use `useEffect`** for derived state or side effects that can be handled declaratively.

- State initialization should use lazy initializers in `useState`, not `useEffect`
- Derived values should use `useMemo`, not `useEffect` + state
- Prefer event handlers over effects for user-triggered changes

If you think you need `useEffect`, consider:
1. Can this be computed during render?
2. Can this be handled in an event handler?
3. Is this truly a side effect that requires synchronization?
